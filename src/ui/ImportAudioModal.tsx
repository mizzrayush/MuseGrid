import React, { useState, useEffect, useRef, useMemo } from 'react'
import * as Tone from 'tone'
import { transcribeAudio } from '../utils/aiLab'
import { useStore } from '../engine/store'
import { snapToScale, snapTick } from '../utils/musicTheory'
import { IconX, IconSpeaker, IconDownload, IconStop, IconPlay, IconTrash } from './Icons'
import { sliderProgress } from './AppSlider'

// Simple autocorrelation algorithm to track dominant pitch in an audio chunk
function detectPitchAutocorrelation(signal: Float32Array, sampleRate: number): number {
  const SIZE = signal.length
  const r = new Float32Array(SIZE)

  for (let lag = 0; lag < SIZE; lag++) {
    let sum = 0
    for (let i = 0; i < SIZE - lag; i++) {
      sum += signal[i] * signal[i + lag]
    }
    r[lag] = sum
  }

  // Find peak after initial zero descent
  const thresh = 0.15
  let peak = -1
  let maxVal = -1

  let startLag = 0
  while (startLag < SIZE - 1 && r[startLag] >= r[startLag + 1]) {
    startLag++
  }

  for (let lag = startLag; lag < SIZE; lag++) {
    if (r[lag] > r[lag - 1] && r[lag] > r[lag + 1]) {
      if (r[lag] > maxVal) {
        maxVal = r[lag]
        peak = lag
      }
    }
  }

  if (peak !== -1 && maxVal > r[0] * thresh) {
    const freq = sampleRate / peak
    // Standard melodic frequency range: 45Hz to 1600Hz
    if (freq >= 45 && freq <= 1600) {
      return freq
    }
  }

  return 0
}

// Optimized in-place Radix-2 Real FFT for power-of-2 sizes (used for percussive spectral extraction)
function runRadix2FFT(re: Float32Array, im: Float32Array) {
  const n = re.length
  
  // Bit-reversal permutation
  for (let i = 0; i < n; i++) {
    let j = 0
    for (let temp = i, bits = n - 1; bits > 0; temp >>= 1, bits >>= 1) {
      j = (j << 1) | (temp & 1)
    }
    if (j > i) {
      let temp = re[i]; re[i] = re[j]; re[j] = temp
      temp = im[i]; im[i] = im[j]; im[j] = temp
    }
  }
  
  // Radix-2 FFT decimation-in-time
  for (let size = 2; size <= n; size <<= 1) {
    const halfsize = size >> 1
    const tablestep = n / size
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
        const angle = (-2 * Math.PI * k) / n
        const tpre = re[j + halfsize] * Math.cos(angle) - im[j + halfsize] * Math.sin(angle)
        const tpim = re[j + halfsize] * Math.sin(angle) + im[j + halfsize] * Math.cos(angle)
        re[j + halfsize] = re[j] - tpre
        im[j + halfsize] = im[j] - tpim
        re[j] += tpre
        im[j] += tpim
      }
    }
  }
}

interface ParameterSliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  color?: string
  suffix?: string
  onChange: (val: number) => void
}

function ParameterSlider({
  label,
  value,
  min,
  max,
  step = 1,
  color = '#da77f2',
  suffix = '',
  onChange
}: ParameterSliderProps) {
  const [inputValue, setInputValue] = useState(value.toString())
  const [prevValue, setPrevValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!isFocused) {
      setInputValue(Number.isInteger(value) ? value.toString() : value.toFixed(3))
    }
  }

  const progress = sliderProgress(value, min, max)

  const handleCommit = () => {
    const val = parseFloat(inputValue)
    if (!isNaN(val)) {
      onChange(val)
    } else {
      setInputValue(value.toString())
    }
  }

  return (
    <div style={{ marginBottom: '12px' }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <input
            type="text"
            value={inputValue}
            onFocus={() => setIsFocused(true)}
            onBlur={() => { setIsFocused(false); handleCommit() }}
            onChange={e => setInputValue(e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            onMouseUp={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            style={{
              fontSize: '10px',
              color,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '4px',
              width: '46px',
              textAlign: 'right',
              outline: 'none',
              padding: '1px 4px',
              cursor: 'text',
              transition: 'all 0.2s',
              borderColor: isFocused ? color : 'rgba(255,255,255,0.08)',
              boxShadow: isFocused ? `0 0 8px ${color}33` : 'none',
              fontFamily: 'monospace'
            } as React.CSSProperties}
          />
          {suffix && <span style={{ fontSize: '10px', color, marginLeft: '2px', opacity: 0.8, fontFamily: 'monospace' }}>{suffix}</span>}
        </div>
      </div>
      <input
        className="modern-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, value))}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{
          '--slider-color': color,
          '--slider-progress': progress,
          accentColor: color
        } as React.CSSProperties}
      />
    </div>
  )
}

interface PitchBlob {
  pitch: number
  startTime: number // in seconds
  duration: number  // in seconds
  amplitude: number
}

export default function ImportAudioModal() {
  const showImportAudioModal = useStore(state => state.showImportAudioModal)
  const importAudioTrackId = useStore(state => state.importAudioTrackId)
  const importAudioBuffer = useStore(state => state.importAudioBuffer)
  const setShowImportAudioModal = useStore(state => state.setShowImportAudioModal)

  const tracks = useStore(state => state.tracks)
  const bpm = useStore(state => state.bpm)
  const scaleLock = useStore(state => state.scaleLock)
  const vocalVelocityMin = useStore(state => state.vocalVelocityMin)
  const vocalVelocityMax = useStore(state => state.vocalVelocityMax)
  const vocalVelocityScale = useStore(state => state.vocalVelocityScale)
  const vocalVelocityEnabled = useStore(state => state.vocalVelocityEnabled)
  const setVocalVelocityEnabled = useStore(state => state.setVocalVelocityEnabled)
  const setVocalVelocityMin = useStore(state => state.setVocalVelocityMin)
  const setVocalVelocityMax = useStore(state => state.setVocalVelocityMax)
  const setVocalVelocityScale = useStore(state => state.setVocalVelocityScale)
  const [constantVelocity, setConstantVelocity] = useState<number>(100)

  const targetTrack = useMemo(() => tracks.find(t => t.id === importAudioTrackId), [tracks, importAudioTrackId])

  // UI state
  const [transcriptionEngine, setTranscriptionEngine] = useState<'melodyne' | 'magenta'>('melodyne')
  const [isClosing, setIsClosing] = useState(false)
  const [mountTick, setMountTick] = useState(0)

  useEffect(() => {
    // Ensure fonts are fully loaded before rendering canvas text
    document.fonts.ready.then(() => {
      setMountTick(t => t + 1)
    })
  }, [])

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [audioFileName, setAudioFileName] = useState<string>('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [pitchBlobs, setPitchBlobs] = useState<PitchBlob[]>([])
  const [zoom, setZoom] = useState(1.0)
  const [panOffset, setPanOffset] = useState(0)

  // Recording State
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [micLevel, setMicLevel] = useState(0)

  const micSettings = useStore(s => s.micSettings)
  const updateMicSettings = useStore(s => s.updateMicSettings)

  // Melodyne parameter sliders (synced with global micSettings)
  const [gateThreshold, setGateThresholdState] = useState<number>(micSettings?.gateThreshold ?? 0.02) // Min amplitude
  const [pitchSensitivity, setPitchSensitivityState] = useState<number>(micSettings?.pitchSensitivity ?? 50) // 0 - 100
  const [minNoteDuration, setMinNoteDurationState] = useState<number>(micSettings?.minNoteDuration ?? 0.1) // seconds
  const [lockToScale, setLockToScale] = useState<boolean>(scaleLock.enabled)
  const [quantizeResolution, setQuantizeResolution] = useState<number>(48) // 16th note (48 ticks), 0 represents None
  const [freqFilterLow, setFreqFilterLowState] = useState<number>(micSettings?.freqFilterLow ?? 60) // Hz
  const [freqFilterHigh, setFreqFilterHighState] = useState<number>(micSettings?.freqFilterHigh ?? 1200) // Hz

  const setGateThreshold = (val: number) => {
    setGateThresholdState(val)
    updateMicSettings({ gateThreshold: val })
  }
  const setPitchSensitivity = (val: number) => {
    setPitchSensitivityState(val)
    updateMicSettings({ pitchSensitivity: val })
  }
  const setMinNoteDuration = (val: number) => {
    setMinNoteDurationState(val)
    updateMicSettings({ minNoteDuration: val })
  }
  const setFreqFilterLow = (val: number) => {
    setFreqFilterLowState(val)
    updateMicSettings({ freqFilterLow: val })
  }
  const setFreqFilterHigh = (val: number) => {
    setFreqFilterHighState(val)
    updateMicSettings({ freqFilterHigh: val })
  }
  const [transposeSemitones, setTransposeSemitones] = useState<number>(0)
  const [shiftToStart, setShiftToStart] = useState<boolean>(true)

  // EDO Tuning Extraction State (default set to target track's EDO)
  const [extractionEdo, setExtractionEdo] = useState<number>(targetTrack?.edoDivision || 12)
  const [customEdoInput, setCustomEdoInput] = useState<number>(targetTrack?.edoDivision || 19)

  useEffect(() => {
    if (targetTrack?.edoDivision) {
      setExtractionEdo(targetTrack.edoDivision)
      if (targetTrack.edoDivision !== 12 && targetTrack.edoDivision !== 19 && targetTrack.edoDivision !== 24 && targetTrack.edoDivision !== 31 && targetTrack.edoDivision !== 53) {
        setCustomEdoInput(targetTrack.edoDivision)
      }
    }
  }, [targetTrack?.id, targetTrack?.edoDivision])

  // Debounced Melodyne slider parameters (prevents UI hanging on drag)
  const [debouncedGateThreshold, setDebouncedGateThreshold] = useState<number>(0.02)
  const [debouncedPitchSensitivity, setDebouncedPitchSensitivity] = useState<number>(50)
  const [debouncedMinNoteDuration, setDebouncedMinNoteDuration] = useState<number>(0.1)
  const [debouncedFreqFilterLow, setDebouncedFreqFilterLow] = useState<number>(60)
  const [debouncedFreqFilterHigh, setDebouncedFreqFilterHigh] = useState<number>(1200)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedGateThreshold(gateThreshold)
      setDebouncedPitchSensitivity(pitchSensitivity)
      setDebouncedMinNoteDuration(minNoteDuration)
      setDebouncedFreqFilterLow(freqFilterLow)
      setDebouncedFreqFilterHigh(freqFilterHigh)
    }, 120)
    return () => clearTimeout(timer)
  }, [gateThreshold, pitchSensitivity, minNoteDuration, freqFilterLow, freqFilterHigh])

  const isDrumTrack = targetTrack?.instrument === 'drum'

  const [drumPieceFilters, setDrumPieceFilters] = useState(() => [
    { pitch: 0, name: 'Kick Drum', enabled: true, minFreq: 20, maxFreq: 150, sensitivity: 45, color: '#ff6b6b' },
    { pitch: 1, name: 'Snare Drum', enabled: true, minFreq: 180, maxFreq: 600, sensitivity: 45, color: '#fa5252' },
    { pitch: 2, name: 'Closed Hi-Hat', enabled: true, minFreq: 5000, maxFreq: 20000, sensitivity: 40, color: '#ff922b' },
    { pitch: 3, name: 'Open Hi-Hat', enabled: true, minFreq: 3500, maxFreq: 14000, sensitivity: 45, color: '#fd7e14' },
    { pitch: 4, name: 'Hand Clap', enabled: false, minFreq: 800, maxFreq: 2500, sensitivity: 50, color: '#fab005' },
    { pitch: 5, name: 'Low Tom', enabled: false, minFreq: 80, maxFreq: 180, sensitivity: 50, color: '#82c91e' },
    { pitch: 6, name: 'Mid Tom', enabled: false, minFreq: 120, maxFreq: 250, sensitivity: 50, color: '#40c057' },
    { pitch: 7, name: 'High Tom', enabled: false, minFreq: 180, maxFreq: 400, sensitivity: 50, color: '#12b886' },
    { pitch: 8, name: 'Crash Cymbal', enabled: false, minFreq: 3000, maxFreq: 16000, sensitivity: 55, color: '#15aabf' },
    { pitch: 9, name: 'Ride Cymbal', enabled: false, minFreq: 2000, maxFreq: 8000, sensitivity: 55, color: '#228be6' },
    { pitch: 10, name: 'Cowbell', enabled: false, minFreq: 800, maxFreq: 1600, sensitivity: 50, color: '#4c6ef5' },
    { pitch: 11, name: 'Tambourine', enabled: false, minFreq: 4500, maxFreq: 12000, sensitivity: 45, color: '#7048e8' },
    { pitch: 12, name: 'Lo-Conga', enabled: false, minFreq: 120, maxFreq: 280, sensitivity: 55, color: '#ae3ec9' },
    { pitch: 13, name: 'Hi-Conga', enabled: false, minFreq: 250, maxFreq: 600, sensitivity: 55, color: '#da77f2' },
    { pitch: 14, name: 'Claves', enabled: false, minFreq: 1500, maxFreq: 3500, sensitivity: 50, color: '#f06595' },
    { pitch: 15, name: 'Rimshot', enabled: false, minFreq: 700, maxFreq: 2000, sensitivity: 50, color: '#ff6b6b' },
  ])

  const [debouncedDrumPieceFilters, setDebouncedDrumPieceFilters] = useState(drumPieceFilters)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedDrumPieceFilters(drumPieceFilters)
    }, 200)
    return () => clearTimeout(handler)
  }, [drumPieceFilters])

  // Playback engine states & refs
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [playbackTime, setPlaybackTime] = useState(0) // in seconds
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const playbackStartTimeRef = useRef<number>(0)
  const playbackOffsetRef = useRef<number>(0)
  const playbackAnimFrameRef = useRef<number | null>(null)
  const playCtxRef = useRef<AudioContext | null>(null)

  // Region Selection states
  const [selectionStart, setSelectionStart] = useState<number | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null)
  const [isSelectingRegion, setIsSelectingRegion] = useState(false)

  // Interactive note blob editor states & refs
  const [selectedBlobIndex, setSelectedBlobIndex] = useState<number | null>(null)
  const [dragMode, setDragMode] = useState<'move' | 'resize-left' | 'resize-right' | 'pan' | null>(null)
  const [dragStartInfo, setDragStartInfo] = useState<{
    mouseX: number
    mouseY: number
    blobIndex: number
    initialBlob: PitchBlob
  } | null>(null)
  const lastPlayedPitchRef = useRef<number | null>(null)
  const isClickRef = useRef<boolean>(true)

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<any>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const micAnimFrameRef = useRef<number | null>(null)

  // Helper functions to stop playing audio
  const stopPlayback = () => {
    if (playbackSourceRef.current) {
      try {
        playbackSourceRef.current.stop()
      } catch {
        // ignore
      }
      playbackSourceRef.current = null
    }
    if (playCtxRef.current) {
      try {
        playCtxRef.current.close()
      } catch {
        // ignore
      }
      playCtxRef.current = null
    }
    if (playbackAnimFrameRef.current) {
      cancelAnimationFrame(playbackAnimFrameRef.current)
      playbackAnimFrameRef.current = null
    }
    setIsPlayingAudio(false)
  }

  // Reset modal state on close or when tracks are initialized (like starting a new project)
  useEffect(() => {
    if (!showImportAudioModal || tracks.length === 0) {
      Promise.resolve().then(() => {
        setAudioBuffer(null)
        setAudioFileName('')
        setPitchBlobs([])
        setIsRecording(false)
        setRecordingSeconds(0)
        setMicLevel(0)
        setSelectionStart(null)
        setSelectionEnd(null)
        setSelectedBlobIndex(null)
        stopPlayback()
        setPlaybackTime(0)
      })
      playbackOffsetRef.current = 0
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      if (micAnimFrameRef.current) cancelAnimationFrame(micAnimFrameRef.current)
    } else if (showImportAudioModal && importAudioBuffer && tracks.length > 0) {
      Promise.resolve().then(() => {
        setAudioBuffer(importAudioBuffer)
        setAudioFileName('Extracted Stem')
      })
    }
  }, [showImportAudioModal, importAudioBuffer, tracks])

  // Handle closing modal
  const handleClose = () => {
    cancelAnalysisRef.current = true
    setIsClosing(true)
    setTimeout(() => {
      setShowImportAudioModal(false)
      setIsClosing(false)
    }, 200)
  }

  // Load an array buffer into our Web Audio context
  const loadAudioBuffer = async (arrayBuffer: ArrayBuffer, name: string) => {
    try {
      setIsAnalyzing(true)
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioCtx()
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      setAudioBuffer(decoded)
      setAudioFileName(name)
    } catch (err) {
      console.error("Failed to decode audio file:", err)
      useStore.getState().showToast("Failed to decode audio file. Make sure it is a valid MP3/WAV.", "error")
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Handle File Input
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const arrayBuffer = await file.arrayBuffer()
    await loadAudioBuffer(arrayBuffer, file.name)
  }

  // Handle Drag & Drop
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const arrayBuffer = await file.arrayBuffer()
    await loadAudioBuffer(arrayBuffer, file.name)
  }

  // Microphone recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: micSettings?.echoCancellation ?? false,
          noiseSuppression: micSettings?.noiseSuppression ?? false,
          autoGainControl: micSettings?.autoGainControl ?? false
        }
      })
      audioChunksRef.current = []

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioCtx()
      audioCtxRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      micAnalyserRef.current = analyser

      // Record media
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' })
        const buffer = await audioBlob.arrayBuffer()
        await loadAudioBuffer(buffer, "Live Hum Recording.wav")
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingSeconds(0)

      // Recording timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1)
      }, 1000)

      // Volume visualizer loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateMicLevel = () => {
        if (!analyser) return
        analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        setMicLevel(avg / 255)
        micAnimFrameRef.current = requestAnimationFrame(updateMicLevel)
      }
      updateMicLevel()

    } catch (err) {
      console.error("Microphone access denied:", err)
      useStore.getState().showToast("Could not access microphone. Check permissions.", "error")
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      if (micAnimFrameRef.current) cancelAnimationFrame(micAnimFrameRef.current)
      setMicLevel(0)
    }
  }

  const cancelAnalysisRef = useRef<boolean>(false)

  // Run Melodyne Transcription Algorithm on decoded Audio Buffer
  const handleAnalyzeAudio = async () => {
    if (!audioBuffer) return

    cancelAnalysisRef.current = true
    await new Promise(r => setTimeout(r, 10))
    cancelAnalysisRef.current = false

    setIsAnalyzing(true)

    let analysisBuffer = audioBuffer
    let analysisOffset = 0
    if (selectionStart !== null && selectionEnd !== null && Math.abs(selectionStart - selectionEnd) > 0.05) {
      const sStart = Math.min(selectionStart, selectionEnd)
      const sEnd = Math.max(selectionStart, selectionEnd)
      analysisOffset = sStart

      const startFrame = Math.max(0, Math.floor(sStart * audioBuffer.sampleRate))
      const endFrame = Math.min(audioBuffer.length, Math.ceil(sEnd * audioBuffer.sampleRate))
      const frameCount = endFrame - startFrame

      if (frameCount > 0) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        const ctx = new AudioCtx()
        analysisBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, frameCount, audioBuffer.sampleRate)
        for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
          analysisBuffer.getChannelData(i).set(audioBuffer.getChannelData(i).subarray(startFrame, endFrame))
        }
      }
    }

    if (transcriptionEngine === 'magenta' && !isDrumTrack) {
      try {
        useStore.getState().showToast('AI Analyzing audio... this may take a moment.', 'info')
        const notes = await transcribeAudio(analysisBuffer, bpm)
        if (cancelAnalysisRef.current) return
        
        const ticksPerSecond = 192 * (bpm / 60)
        
        const filteredNotes = notes.filter(n => {
          const freq = 440 * Math.pow(2, (n.pitch - 69) / 12)
          if (freq < debouncedFreqFilterLow || freq > debouncedFreqFilterHigh) return false
          const durationSec = n.duration / ticksPerSecond
          if (durationSec < debouncedMinNoteDuration) return false
          return true
        })

        const blobs: PitchBlob[] = filteredNotes.map(n => {
          let finalPitch = n.pitch
          if (extractionEdo !== 12) {
            const root = targetTrack?.edoRootNote ?? 60
            const stepSize = 12 / Math.max(1, extractionEdo)
            const steps = Math.round((n.pitch - root) / stepSize)
            finalPitch = Math.round((root + steps * stepSize) * 1000) / 1000
          } else if (lockToScale) {
            finalPitch = snapToScale(finalPitch, scaleLock.root, scaleLock.mode, scaleLock.customIntervals)
          }
          return {
            pitch: finalPitch,
            startTime: (n.time / ticksPerSecond) + analysisOffset,
            duration: n.duration / ticksPerSecond,
            amplitude: n.velocity / 127
          }
        })
        
        if (!cancelAnalysisRef.current) {
          setPitchBlobs(blobs)
          setSelectedBlobIndex(null)
          setIsAnalyzing(false)
        }
      } catch (err) {
        console.error(err)
        if (!cancelAnalysisRef.current) setIsAnalyzing(false)
      }
      return
    }

    if (isDrumTrack) {
      const channelData = analysisBuffer.getChannelData(0)
      const sampleRate = analysisBuffer.sampleRate
      const frameSize = 1024
      const hopSize = 256
      const N = frameSize

      const detectedHits: { time: number; pitch: number; amp: number }[] = []
      const prevRms: number[] = []
      const maxPrevRmsCount = 6
      
      for (let offset = 0; offset < channelData.length - frameSize; offset += hopSize) {
        if (cancelAnalysisRef.current) return
        // Yield occasionally to keep UI responsive
        if (offset % (hopSize * 40) === 0) {
          await new Promise(r => setTimeout(r, 0))
        }

        const frame = channelData.subarray(offset, offset + frameSize)
        const time = offset / sampleRate
        
        let rms = 0
        for (let i = 0; i < frame.length; i++) {
          rms += frame[i] * frame[i]
        }
        rms = Math.sqrt(rms / frame.length)
        
        if (prevRms.length >= maxPrevRmsCount) {
          prevRms.shift()
        }
        
        const runningAvgRms = prevRms.length > 0 ? prevRms.reduce((a, b) => a + b, 0) / prevRms.length : 0.005
        prevRms.push(rms)
        
        const onsetSensitivity = debouncedPitchSensitivity
        const multiplier = 1.1 + (1 - onsetSensitivity / 100) * 1.5
        
        if (rms > debouncedGateThreshold && rms > runningAvgRms * multiplier) {
          const re = new Float32Array(N)
          const im = new Float32Array(N)
          for (let i = 0; i < N; i++) {
            const hanning = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
            re[i] = frame[i] * hanning
            im[i] = 0
          }
          
          runRadix2FFT(re, im)
          
          const magnitudes = new Float32Array(N / 2)
          for (let i = 0; i < N / 2; i++) {
            magnitudes[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i])
          }
          
          const binHz = sampleRate / N
          
          debouncedDrumPieceFilters.forEach(filter => {
            if (!filter.enabled) return
            const binLow = Math.floor(filter.minFreq / binHz)
            const binHigh = Math.min(N/2 - 1, Math.ceil(filter.maxFreq / binHz))
            
            let bandSum = 0
            let count = 0
            for (let bin = binLow; bin <= binHigh; bin++) {
              bandSum += magnitudes[bin]
              count++
            }
            const avgBandMag = count > 0 ? bandSum / count : 0
            const threshold = (101 - filter.sensitivity) * 0.00015
            
            if (avgBandMag > threshold) {
              detectedHits.push({
                time,
                pitch: filter.pitch,
                amp: Math.min(1.0, avgBandMag * 15)
              })
            }
          })
          offset += Math.round(sampleRate * 0.04)
        }
      }
      
      const drumBlobs: PitchBlob[] = detectedHits.map(hit => ({
        pitch: hit.pitch,
        startTime: hit.time + analysisOffset,
        duration: 0.1,
        amplitude: hit.amp
      }))
      
      if (!cancelAnalysisRef.current) {
        setPitchBlobs(drumBlobs)
        setSelectedBlobIndex(null)
        setIsAnalyzing(false)
      }
      return
    }

    const channelData = analysisBuffer.getChannelData(0)
    const sampleRate = analysisBuffer.sampleRate
    const frameSize = 2048
    const hopSize = Math.max(256, Math.min(1024, Math.round(1024 - (debouncedPitchSensitivity * 7.68))))

    const detected: { time: number; pitch: number; amp: number }[] = []

    for (let offset = 0; offset < channelData.length - frameSize; offset += hopSize) {
      if (cancelAnalysisRef.current) return
      if (offset % (hopSize * 20) === 0) {
        await new Promise(r => setTimeout(r, 0))
      }

      const frame = channelData.subarray(offset, offset + frameSize)
      const time = offset / sampleRate

      let rms = 0
      for (let i = 0; i < frame.length; i++) {
        rms += frame[i] * frame[i]
      }
      rms = Math.sqrt(rms / frame.length)

      if (rms < debouncedGateThreshold) continue

      const freq = detectPitchAutocorrelation(frame, sampleRate)
      if (freq > 20 && isFinite(freq)) {
        if (freq >= debouncedFreqFilterLow && freq <= debouncedFreqFilterHigh) {
          const exactPitch = 12 * Math.log2(freq / 440) + 69
          let midiPitch = exactPitch
          if (extractionEdo === 12) {
            midiPitch = Math.round(exactPitch)
            if (lockToScale) {
              midiPitch = snapToScale(midiPitch, scaleLock.root, scaleLock.mode, scaleLock.customIntervals)
            }
          } else {
            const root = targetTrack?.edoRootNote ?? 60
            const stepSize = 12 / Math.max(1, extractionEdo)
            const steps = Math.round((exactPitch - root) / stepSize)
            midiPitch = Math.round((root + steps * stepSize) * 1000) / 1000
          }
          if (midiPitch >= 12 && midiPitch <= 108) {
            detected.push({ time, pitch: midiPitch, amp: rms })
          }
        }
      }
    }

    const blobs: PitchBlob[] = []
    let currentBlob: { pitch: number; startTime: number; times: number[]; amps: number[] } | null = null

    for (let i = 0; i < detected.length; i++) {
      const pt = detected[i]
      if (!currentBlob) {
        currentBlob = { pitch: pt.pitch, startTime: pt.time, times: [pt.time], amps: [pt.amp] }
      } else if (Math.abs(pt.pitch - currentBlob.pitch) < 0.005 && pt.time - currentBlob.times[currentBlob.times.length - 1] < 0.25) {
        currentBlob.times.push(pt.time)
        currentBlob.amps.push(pt.amp)
      } else {
        const duration = currentBlob.times[currentBlob.times.length - 1] - currentBlob.startTime
        if (duration >= debouncedMinNoteDuration) {
          const avgAmp = currentBlob.amps.reduce((a, b) => a + b, 0) / currentBlob.amps.length
          blobs.push({
            pitch: currentBlob.pitch,
            startTime: currentBlob.startTime,
            duration: Math.max(0.01, duration),
            amplitude: avgAmp
          })
        }
        currentBlob = { pitch: pt.pitch, startTime: pt.time, times: [pt.time], amps: [pt.amp] }
      }
    }

    if (currentBlob) {
      const duration = currentBlob.times[currentBlob.times.length - 1] - currentBlob.startTime
      if (duration >= debouncedMinNoteDuration) {
        const avgAmp = currentBlob.amps.reduce((a, b) => a + b, 0) / currentBlob.amps.length
        blobs.push({
          pitch: currentBlob.pitch,
          startTime: currentBlob.startTime + analysisOffset,
          duration: Math.max(0.01, duration),
          amplitude: avgAmp
        })
      }
    }

    // Also offset any blobs pushed in the loop
    const offsetBlobs = blobs.map(b => ({
      ...b,
      startTime: b.startTime + (b.startTime >= analysisOffset ? 0 : analysisOffset) 
    }))

    if (!cancelAnalysisRef.current) {
      setPitchBlobs(offsetBlobs)
      setSelectedBlobIndex(null)
      setIsAnalyzing(false)
    }
  }

  // Start playback
  const startPlayback = (offsetSeconds = 0) => {
    if (!audioBuffer) return
    stopPlayback()

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioCtx()
      playCtxRef.current = ctx

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)

      const actualOffset = Math.max(0, Math.min(audioBuffer.duration, offsetSeconds))
      source.start(0, actualOffset)
      playbackSourceRef.current = source

      playbackStartTimeRef.current = ctx.currentTime
      playbackOffsetRef.current = actualOffset
      setIsPlayingAudio(true)
      setPlaybackTime(actualOffset)

      const updatePlayhead = () => {
        if (!source || ctx.state === 'closed') return
        const elapsed = ctx.currentTime - playbackStartTimeRef.current
        const currentTime = actualOffset + elapsed

        if (currentTime >= audioBuffer.duration) {
          setIsPlayingAudio(false)
          setPlaybackTime(0)
          playbackOffsetRef.current = 0
          return
        }

        setPlaybackTime(currentTime)
        playbackAnimFrameRef.current = requestAnimationFrame(updatePlayhead)
      }
      updatePlayhead()

      source.onended = () => {
        if (playbackSourceRef.current === source) {
          setIsPlayingAudio(false)
          setPlaybackTime(0)
          playbackOffsetRef.current = 0
          if (playbackAnimFrameRef.current) cancelAnimationFrame(playbackAnimFrameRef.current)
        }
      }

    } catch (err) {
      console.error("Playback failed:", err)
    }
  }

  // Keyboard events to delete selected note
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedBlobIndex !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (document.activeElement?.tagName === 'INPUT') return
        const updated = pitchBlobs.filter((_, idx) => idx !== selectedBlobIndex)
        setPitchBlobs(updated)
        setSelectedBlobIndex(null)
        useStore.getState().showToast("Deleted selected note blob", "success")
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedBlobIndex, pitchBlobs])

  // Mouse Helper: get mouse position on canvas
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height
    return { x, y }
  }

  // Helper functions for zoom & pan math
  const timeToX = (time: number, canvasWidth: number, duration: number) => {
    return ((time - panOffset) / duration) * canvasWidth * zoom
  }
  
  const xToTime = (x: number, canvasWidth: number, duration: number) => {
    return (x / (canvasWidth * zoom)) * duration + panOffset
  }

  // Find blob at canvas coordinates
  const findBlobAtMouse = (mouseX: number, mouseY: number, canvasWidth: number, canvasHeight: number, duration: number) => {
    if (isDrumTrack) {
      const laneHeight = canvasHeight / 16
      for (let i = 0; i < pitchBlobs.length; i++) {
        const blob = pitchBlobs[i]
        const xStart = timeToX(blob.startTime, canvasWidth, duration)
        const xWidth = (blob.duration / duration) * canvasWidth * zoom
        const y = canvasHeight - (blob.pitch * laneHeight) - laneHeight

        if (mouseY >= y && mouseY <= y + laneHeight) {
          if (mouseX >= xStart && mouseX <= xStart + Math.max(12, xWidth)) {
            return { index: i, part: 'move' as const }
          }
        }
      }
      return null
    }

    const minMidi = 36
    const noteHeight = 12

    for (let i = 0; i < pitchBlobs.length; i++) {
      const blob = pitchBlobs[i]
      const xStart = timeToX(blob.startTime, canvasWidth, duration)
      const xWidth = (blob.duration / duration) * canvasWidth * zoom
      const y = canvasHeight - ((blob.pitch - minMidi) * noteHeight) - 20

      if (Math.abs(mouseY - y) <= 6) {
        if (mouseX >= xStart && mouseX <= xStart + Math.max(12, xWidth)) {
          const edgeThreshold = 8
          if (Math.abs(mouseX - xStart) <= edgeThreshold) {
            return { index: i, part: 'resize-left' as const }
          }
          if (Math.abs(mouseX - (xStart + Math.max(12, xWidth))) <= edgeThreshold) {
            return { index: i, part: 'resize-right' as const }
          }
          return { index: i, part: 'move' as const }
        }
      }
    }
    return null
  }

  // Preview Pitch Sound trigger (Debounced / Throttled per pitch changes)
  const playPitchPreview = (midiNote: number) => {
    if (lastPlayedPitchRef.current === midiNote) return
    lastPlayedPitchRef.current = midiNote
    try {
      const freq = 440 * Math.pow(2, (midiNote - 69) / 12)
      const synth = new Tone.Synth().toDestination()
      synth.volume.value = -12 // quiet preview
      synth.triggerAttackRelease(freq, "8n")
    } catch (e) {
      console.error(e)
    }
  }

  // Right-click context handler: Add new note blob OR delete clicked note blob
  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault() // Prevent standard browser menu
    if (!audioBuffer) return
    const canvas = canvasRef.current
    if (!canvas) return
    const { x, y } = getCanvasCoords(e)
    const duration = audioBuffer.duration

    // Find if click hit an existing blob to delete it easily!
    const hit = findBlobAtMouse(x, y, canvas.width, canvas.height, duration)
    if (hit) {
      const updated = pitchBlobs.filter((_, idx) => idx !== hit.index)
      setPitchBlobs(updated)
      setSelectedBlobIndex(null)
      useStore.getState().showToast(isDrumTrack ? "Removed percussive hit" : "Removed note blob", "success")
      return
    }

    if (isDrumTrack) {
      const laneHeight = canvas.height / 16
      const laneIndex = Math.floor((canvas.height - y) / laneHeight)
      const clickedRow = Math.max(0, Math.min(15, laneIndex))
      const clickTime = xToTime(x, canvas.width, duration)

      const newBlob: PitchBlob = {
        pitch: clickedRow,
        startTime: clickTime,
        duration: 0.1, // Fixed percussion trigger duration
        amplitude: 0.15
      }

      const updated = [...pitchBlobs, newBlob]
      setPitchBlobs(updated)
      setSelectedBlobIndex(updated.length - 1)
      useStore.getState().showToast("Added new percussive hit! Drag to move.", "success")
      return
    }

    // Otherwise, create a new blob at the clicked location!
    const minMidi = 36
    const noteHeight = 12
    const noteIndex = Math.round((canvas.height - y - 20) / noteHeight)
    let clickPitch = minMidi + noteIndex

    // Ensure it is in a valid MIDI range
    clickPitch = Math.max(12, Math.min(108, clickPitch))
    if (lockToScale) {
      clickPitch = snapToScale(clickPitch, scaleLock.root, scaleLock.mode, scaleLock.customIntervals)
    }

    const clickTime = xToTime(x, canvas.width, duration)

    const newBlob: PitchBlob = {
      pitch: clickPitch,
      startTime: clickTime,
      duration: Math.max(0.01, minNoteDuration), // default duration based on current slider
      amplitude: 0.15 // default amplitude
    }

    const updated = [...pitchBlobs, newBlob]
    setPitchBlobs(updated)
    setSelectedBlobIndex(updated.length - 1)
    playPitchPreview(clickPitch)
    useStore.getState().showToast("Added new note blob! Drag or resize to edit.", "success")
  }

  // Canvas Mouse Interaction handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioBuffer) return
    const canvas = canvasRef.current
    if (!canvas) return
    const { x, y } = getCanvasCoords(e)
    const duration = audioBuffer.duration

    isClickRef.current = true

    // Middle click or shift click = Pan mode
    if (e.button === 1 || e.shiftKey) {
      setDragMode('pan')
      setDragStartInfo({
        mouseX: x,
        mouseY: y,
        blobIndex: -1,
        initialBlob: { pitch: 0, startTime: 0, duration: 0, amplitude: 0 }
      })
      return
    }

    // Check note blob hit
    const hit = findBlobAtMouse(x, y, canvas.width, canvas.height, duration)
    if (hit) {
      setSelectedBlobIndex(hit.index)
      setDragMode(hit.part)
      setDragStartInfo({
        mouseX: x,
        mouseY: y,
        blobIndex: hit.index,
        initialBlob: pitchBlobs[hit.index]
      })
      lastPlayedPitchRef.current = pitchBlobs[hit.index].pitch
    } else {
      // Empty space: region selection OR seeking playhead
      setSelectedBlobIndex(null)
      const clickTime = xToTime(x, canvas.width, duration)
      setSelectionStart(clickTime)
      setSelectionEnd(clickTime)
      setIsSelectingRegion(true)
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioBuffer) return
    const canvas = canvasRef.current
    if (!canvas) return
    const { x, y } = getCanvasCoords(e)
    const duration = audioBuffer.duration

    // If dragging a blob
    if (dragStartInfo && dragMode) {
      isClickRef.current = false
      const deltaX = x - dragStartInfo.mouseX
      const deltaY = y - dragStartInfo.mouseY
      const deltaTime = (deltaX / (canvas.width * zoom)) * duration

      const updated = [...pitchBlobs]
      const initial = dragStartInfo.initialBlob

      if (dragMode === 'pan') {
        const panDelta = xToTime(dragStartInfo.mouseX, canvas.width, duration) - xToTime(x, canvas.width, duration)
        setPanOffset(Math.max(0, Math.min(panOffset + panDelta, duration - duration / zoom)))
        // Update drag start X so delta is relative
        setDragStartInfo({ ...dragStartInfo, mouseX: x })
        return
      }

      if (isDrumTrack) {
        if (dragMode === 'move') {
          const laneHeight = canvas.height / 16
          const deltaPitch = Math.round(-deltaY / laneHeight)
          let newPitch = initial.pitch + deltaPitch
          newPitch = Math.max(0, Math.min(15, newPitch))

          let newStart = initial.startTime + deltaTime
          newStart = Math.max(0, Math.min(duration - 0.05, newStart))

          updated[dragStartInfo.blobIndex] = {
            ...updated[dragStartInfo.blobIndex],
            pitch: newPitch,
            startTime: newStart
          }
        }
      } else {
        const noteHeight = 12
        const deltaPitch = Math.round(-deltaY / noteHeight)

        if (dragMode === 'move') {
          let newPitch = initial.pitch + deltaPitch
          newPitch = Math.max(12, Math.min(108, newPitch))
          if (lockToScale) {
            newPitch = snapToScale(newPitch, scaleLock.root, scaleLock.mode, scaleLock.customIntervals)
          }
          let newStart = initial.startTime + deltaTime
          newStart = Math.max(0, Math.min(duration - 0.05, newStart))

          updated[dragStartInfo.blobIndex] = {
            ...updated[dragStartInfo.blobIndex],
            pitch: newPitch,
            startTime: newStart
          }
          playPitchPreview(newPitch)
        } else if (dragMode === 'resize-right') {
          let newDuration = initial.duration + deltaTime
          newDuration = Math.max(0.01, newDuration)
          updated[dragStartInfo.blobIndex] = {
            ...updated[dragStartInfo.blobIndex],
            duration: newDuration
          }
        } else if (dragMode === 'resize-left') {
          let newStart = initial.startTime + deltaTime
          newStart = Math.max(0, Math.min(initial.startTime + initial.duration - 0.01, newStart))
          const newDuration = initial.startTime + initial.duration - newStart
          updated[dragStartInfo.blobIndex] = {
            ...updated[dragStartInfo.blobIndex],
            startTime: newStart,
            duration: newDuration
          }
        }
      }

      setPitchBlobs(updated)
    }
    // If drawing regional selection
    else if (isSelectingRegion && selectionStart !== null) {
      isClickRef.current = false
      const clickTime = (x / canvas.width) * duration
      setSelectionEnd(clickTime)
    }
    // If hovering (update mouse cursor style)
    else {
      const hit = findBlobAtMouse(x, y, canvas.width, canvas.height, duration)
      if (hit) {
        if (hit.part === 'resize-left' || hit.part === 'resize-right') {
          canvas.style.cursor = 'ew-resize'
        } else {
          canvas.style.cursor = 'move'
        }
      } else {
        canvas.style.cursor = 'crosshair'
      }
    }
  }

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioBuffer) return
    const canvas = canvasRef.current
    if (!canvas) return
    const { x } = getCanvasCoords(e)
    const duration = audioBuffer.duration

    if (dragStartInfo) {
      if (dragMode === 'pan') {
        isClickRef.current = false // Prevent seek on pan release
      }
      setDragStartInfo(null)
      setDragMode(null)
    }

    if (isSelectingRegion) {
      setIsSelectingRegion(false)
      // If drag distance was extremely small, treat as seek or clear selection
      if (selectionStart !== null && selectionEnd !== null && Math.abs(selectionStart - selectionEnd) < 0.05) {
        setSelectionStart(null)
        setSelectionEnd(null)
      }
    }

    // Seek playback on empty space single click
    if (isClickRef.current) {
      const clickTime = xToTime(x, canvas.width, duration)
      if (isPlayingAudio) {
        startPlayback(clickTime)
      } else {
        setPlaybackTime(clickTime)
        playbackOffsetRef.current = clickTime
      }
    }
  }

  // Zoom handler
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!audioBuffer) return
    e.preventDefault()
    
    if (e.deltaY < 0) {
      // zoom in
      const newZoom = Math.min(zoom * 1.2, 50)
      setZoom(newZoom)
      // Adjust pan to zoom towards mouse
      const { x } = getCanvasCoords(e as any)
      const timeAtMouse = xToTime(x, canvasRef.current!.width, audioBuffer.duration)
      const newPan = timeAtMouse - (x / canvasRef.current!.width) * (audioBuffer.duration / newZoom)
      setPanOffset(Math.max(0, Math.min(newPan, audioBuffer.duration - audioBuffer.duration / newZoom)))
    } else {
      // zoom out
      const newZoom = Math.max(zoom / 1.2, 1)
      setZoom(newZoom)
      if (newZoom === 1) {
        setPanOffset(0)
      } else {
        const { x } = getCanvasCoords(e as any)
        const timeAtMouse = xToTime(x, canvasRef.current!.width, audioBuffer.duration)
        const newPan = timeAtMouse - (x / canvasRef.current!.width) * (audioBuffer.duration / newZoom)
        setPanOffset(Math.max(0, Math.min(newPan, audioBuffer.duration - audioBuffer.duration / newZoom)))
      }
    }
  }

  // Render the beautiful Melodyne Spectrogram & Pitch Blobs inside the Center Panel canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const container = canvas.parentElement
    if (!container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number

    const draw = () => {
      // Sync internal resolution with CSS display size to prevent blurring/scaling issues
      const { clientWidth, clientHeight } = container
      if (canvas.width !== clientWidth || canvas.height !== clientHeight) {
        canvas.width = clientWidth
        canvas.height = clientHeight
      }

      // Clear background
      ctx.fillStyle = '#0f1015'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      if (!audioBuffer) {
        // Empty display text
        ctx.fillStyle = '#aaa'
        ctx.font = '500 14px "Inter", "Outfit", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText("Upload an audio file or record voice to visualize pitch blobs", canvas.width / 2, canvas.height / 2)
        return
      }

      const duration = audioBuffer.duration

    // 1. Draw regional selection overlay first (background layer)
    if (selectionStart !== null && selectionEnd !== null) {
      const sStart = Math.min(selectionStart, selectionEnd)
      const sEnd = Math.max(selectionStart, selectionEnd)
      const xStart = (sStart / duration) * canvas.width
      const xWidth = ((sEnd - sStart) / duration) * canvas.width

      ctx.fillStyle = 'rgba(218, 119, 242, 0.08)' // Translucent purple highlight
      ctx.fillRect(xStart, 0, xWidth, canvas.height)

      ctx.strokeStyle = 'rgba(218, 119, 242, 0.25)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(xStart, 0)
      ctx.lineTo(xStart, canvas.height)
      ctx.moveTo(xStart + xWidth, 0)
      ctx.lineTo(xStart + xWidth, canvas.height)
      ctx.stroke()
    }

    // 2. Draw the underlying audio waveform contour
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    const channelData = audioBuffer.getChannelData(0)
    const step = Math.ceil(channelData.length / canvas.width)
    const midY = canvas.height / 2

    ctx.beginPath()
    for (let x = 0; x < canvas.width; x++) {
      let min = 1.0
      let max = -1.0
      for (let j = 0; j < step; j++) {
        const val = channelData[x * step + j] || 0
        if (val < min) min = val
        if (val > max) max = val
      }
      ctx.fillRect(x, midY + (min * midY * 0.7), 1, Math.max(1, (max - min) * midY * 0.7))
    }

    if (isDrumTrack) {
      // Draw 16 horizontal drum lanes
      const laneHeight = canvas.height / 16
      
      // Draw grid lines and labels
      for (let i = 0; i < 16; i++) {
        const y = canvas.height - (i * laneHeight) - laneHeight
        const filter = drumPieceFilters.find(f => f.pitch === i)
        
        ctx.strokeStyle = 'rgba(255,255,255,0.025)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, y + laneHeight)
        ctx.lineTo(canvas.width, y + laneHeight)
        ctx.stroke()
        
        // Draw label background sidebar
        ctx.fillStyle = 'rgba(15,16,21,0.85)'
        ctx.fillRect(0, y, 92, laneHeight)
        
        // Draw separate vertical divider line
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'
        ctx.beginPath()
        ctx.moveTo(92, y)
        ctx.lineTo(92, y + laneHeight)
        ctx.stroke()
        
        // Text label
        ctx.fillStyle = filter?.enabled ? (filter.color || '#fff') : '#555'
        ctx.font = 'bold 9px Outfit, sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(filter?.name || '', 8, y + laneHeight / 2 + 3)
      }

      // Draw percussive hits
      ctx.shadowBlur = 0
      pitchBlobs.forEach((blob, idx) => {
        const xStart = (blob.startTime / duration) * canvas.width
        const xWidth = (blob.duration / duration) * canvas.width
        const y = canvas.height - (blob.pitch * laneHeight) - laneHeight
        const filter = drumPieceFilters.find(f => f.pitch === blob.pitch)
        const color = filter?.color || '#da77f2'
        
        const isSelected = selectedBlobIndex === idx
        
        ctx.save()
        if (isSelected) {
          ctx.fillStyle = 'rgba(77,171,247,0.6)'
          ctx.strokeStyle = '#4dabf7'
          ctx.lineWidth = 2
          ctx.shadowColor = '#4dabf7'
          ctx.shadowBlur = 8
        } else {
          ctx.fillStyle = color + '55' // Translucent percussive color
          ctx.strokeStyle = color
          ctx.lineWidth = 1.5
          ctx.shadowColor = color
          ctx.shadowBlur = 6
        }
        
        ctx.beginPath()
        ctx.roundRect(xStart, y + 2, Math.max(12, xWidth), laneHeight - 4, 3)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      })

    } else {
      // Render horizontal grid lines representing note pitches
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'
      ctx.lineWidth = 1
      const noteHeight = 12
      const totalPitches = 48 // Focus on range C2 to C6
      const minMidi = 36 // C2

      for (let i = 0; i < totalPitches; i++) {
        const y = canvas.height - (i * noteHeight) - 20
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(canvas.width, y)
        ctx.stroke()

        // Pitch labels
        if ((minMidi + i) % 12 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.15)'
          ctx.font = '8px monospace'
          ctx.fillText(`C${Math.floor((minMidi + i) / 12) - 1}`, 5, y - 2)
        }
      }

      // Draw Melodyne Pitch Blobs
      ctx.shadowBlur = 0

      pitchBlobs.forEach((blob, idx) => {
        const xStart = (blob.startTime / duration) * canvas.width
        const xWidth = (blob.duration / duration) * canvas.width
        const pitchIndex = (blob.pitch + transposeSemitones) - minMidi
        const y = canvas.height - (pitchIndex * noteHeight) - 20

        // Skip drawing if out of canvas viewport bounds
        if (y < 0 || y > canvas.height) return

        const isSelected = selectedBlobIndex === idx

        // Melodyne bubble neon pill style
        ctx.save()
        if (isSelected) {
          ctx.fillStyle = 'rgba(77,171,247,0.55)' // Neon blue for selected
          ctx.strokeStyle = '#4dabf7'
          ctx.lineWidth = 2
          ctx.shadowColor = '#4dabf7'
          ctx.shadowBlur = 8
        } else {
          ctx.fillStyle = 'rgba(218,119,242,0.45)' // Purple neon tint
          ctx.strokeStyle = '#da77f2'
          ctx.lineWidth = 1.5
          ctx.shadowColor = '#da77f2'
          ctx.shadowBlur = 6
        }

        // Draw beautiful pill shape
        const radius = 4
        ctx.beginPath()
        ctx.roundRect(xStart, y - 5, Math.max(12, xWidth), 10, radius)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      })
    }

    // 4. Draw the real-time sweeping playhead
    if (playbackTime > 0) {
      const playheadX = (playbackTime / duration) * canvas.width
      ctx.save()
      ctx.strokeStyle = '#4dabf7' // Bright neon blue
      ctx.lineWidth = 1.5
      ctx.shadowColor = '#4dabf7'
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, canvas.height)
      ctx.stroke()
      ctx.restore()
    }
    }

    draw() // Initial draw

    // Listen to container resizing
    const resizeObserver = new ResizeObserver(() => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      animationFrameId = requestAnimationFrame(draw)
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
    }
  }, [audioBuffer, pitchBlobs, selectionStart, selectionEnd, selectedBlobIndex, playbackTime, isDrumTrack, drumPieceFilters, transposeSemitones, mountTick])

  // Inject converted MIDI Notes onto the Synth Grid
  const handleAddToGrid = () => {
    if (pitchBlobs.length === 0 || !audioBuffer) {
      useStore.getState().showToast("No pitch blobs detected. Try humming clearly or lowering gate threshold.", "info")
      return
    }

    // Filter by regional selection start and end boundaries if active
    let targetBlobs = pitchBlobs
    if (selectionStart !== null && selectionEnd !== null) {
      const minS = Math.min(selectionStart, selectionEnd)
      const maxS = Math.max(selectionStart, selectionEnd)
      targetBlobs = pitchBlobs.filter(b => b.startTime >= minS && (b.startTime + b.duration) <= maxS)

      if (targetBlobs.length === 0) {
        useStore.getState().showToast("No pitch blobs inside your selection bounds! Clear region selection or expand it.", "info")
        return
      }
    }

    // Calculate conversion factor: seconds to ticks
    const ticksPerSecond = (bpm / 60) * 192

    let startOffsetTicks = 0
    if (shiftToStart && targetBlobs.length > 0) {
      startOffsetTicks = Math.min(...targetBlobs.map(b => b.startTime * ticksPerSecond))
    }

    const newMidiNotes = targetBlobs.map(blob => {
      const rawStartTick = (blob.startTime * ticksPerSecond) - startOffsetTicks
      const rawDurationTicks = blob.duration * ticksPerSecond

      // Quantize snap based on slider (skip if resolution is 0 representing None)
      let snappedStartTick: number
      let snappedDurationTicks: number

      if (quantizeResolution > 0) {
        snappedStartTick = snapTick(rawStartTick, quantizeResolution)
        snappedDurationTicks = Math.max(quantizeResolution, snapTick(rawDurationTicks, quantizeResolution))
      } else {
        snappedStartTick = Math.round(rawStartTick)
        snappedDurationTicks = Math.max(1, Math.round(rawDurationTicks))
      }

      let finalPitch = blob.pitch
      if (!isDrumTrack) {
        if (extractionEdo !== 12) {
          const stepSize = 12 / Math.max(1, extractionEdo)
          finalPitch = blob.pitch + transposeSemitones * stepSize
        } else {
          finalPitch = blob.pitch + transposeSemitones
          if (lockToScale) {
            finalPitch = snapToScale(finalPitch, scaleLock.root, scaleLock.mode, scaleLock.customIntervals)
          }
        }
        finalPitch = Math.max(12, Math.min(108, finalPitch))
        finalPitch = Math.round(finalPitch * 1000) / 1000
      }

      return {
        id: `note_transcribed_${Math.random().toString(36).substr(2, 9)}`,
        trackId: importAudioTrackId || '',
        pitch: finalPitch,
        time: snappedStartTick,
        duration: snappedDurationTicks,
        velocity: vocalVelocityEnabled ? Math.min(vocalVelocityMax, Math.max(vocalVelocityMin, Math.round(blob.amplitude * vocalVelocityScale))) : constantVelocity
      }
    })

    // Commit current state to undo history
    const commitHistory = useStore.getState().commitHistory
    if (commitHistory) commitHistory()

    // Add note items to the global Zustand notes array
    const currentNotes = useStore.getState().notes
    const filteredNotes = currentNotes.filter(n => n.trackId !== importAudioTrackId) // Clear old patterns

    useStore.setState({
      notes: [...filteredNotes, ...newMidiNotes]
    })

    // If target track's EDO doesn't match the extraction EDO, update the track EDO
    if (targetTrack && targetTrack.instrument === 'synth' && extractionEdo !== (targetTrack.edoDivision || 12)) {
      useStore.getState().updateTrack(targetTrack.id, {
        edoDivision: extractionEdo,
        edoPreset: (extractionEdo === 12 || extractionEdo === 19 || extractionEdo === 24 || extractionEdo === 31 || extractionEdo === 53) ? `${extractionEdo}-edo` as any : 'custom'
      })
    }

    useStore.getState().showToast(`Successfully transcribed ${newMidiNotes.length} notes (${extractionEdo}-EDO) onto track!`, "success")
    handleClose()
  }

  if (!showImportAudioModal) return null

  return (
    <div className={isClosing ? "animate-modal-bg-exit" : "animate-modal-bg"} style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(8, 9, 14, 0.78)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      zIndex: 100000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }} onClick={handleClose}>
      <div
        className={isClosing ? "animate-modal-card-exit" : "animate-modal-card"}
        style={{
          width: '100%',
          maxWidth: '1200px',
          height: '80%',
          background: '#12131a',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '24px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header bar */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255,255,255,0.01)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(218,119,242,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(218,119,242,0.3)' }}>
              <IconSpeaker size={16} style={{ color: '#da77f2' }} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', color: 'white', fontWeight: 800, letterSpacing: '-0.5px' }}>Import Audio</h3>
              <p style={{ margin: 0, fontSize: '10px', color: '#888', fontWeight: 500 }}>Target: <span style={{ color: targetTrack?.color || '#fff', fontWeight: 700 }}>{targetTrack?.name || 'Active Synth'}</span></p>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#555'}
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Modal Columns */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

          {/* Left panel: Input Options */}
          <div style={{ width: '280px', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', padding: '20px', background: 'rgba(0,0,0,0.1)' }}>
            <span style={{ fontSize: '10px', color: '#666', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px', display: 'block' }}>Audio Source</span>

            {/* File Drop Area */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              style={{
                border: '1.5px dashed rgba(255,255,255,0.12)',
                borderRadius: '12px',
                padding: '24px 16px',
                textAlign: 'center',
                background: 'rgba(255,255,255,0.01)',
                cursor: 'pointer',
                marginBottom: '16px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#da77f2'
                e.currentTarget.style.background = 'rgba(218,119,242,0.02)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                e.currentTarget.style.background = 'rgba(255,255,255,0.01)'
              }}
              onClick={() => document.getElementById('audio-modal-file')?.click()}
            >
              <IconDownload size={22} style={{ color: '#aaa', marginBottom: '8px' }} />
              <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>Upload Audio File</span>
              <span style={{ display: 'block', fontSize: '9px', color: '#666' }}>Drag & Drop .wav / .mp3</span>
              <input
                id="audio-modal-file"
                type="file"
                accept="audio/wav,audio/mp3,audio/mpeg"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            {/* Realtime voice recorder */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '24px 16px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              {isRecording ? (
                <>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255,80,80,0.15)', border: '1px solid rgba(255,80,80,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', animation: 'pulse 1.5s infinite', marginBottom: '12px' }} onClick={stopRecording}>
                    <IconStop size={18} style={{ color: '#ff6b6b' }} />
                  </div>
                  <span style={{ fontSize: '12px', color: '#ff6b6b', fontWeight: 700 }}>Recording Voice...</span>
                  <span style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>Time: {recordingSeconds}s</span>
                  {/* Reactive DB bar */}
                  <div style={{ width: '80%', height: '4px', background: '#252530', borderRadius: '2px', overflow: 'hidden', marginTop: '12px' }}>
                    <div style={{ width: `${micLevel * 100}%`, height: '100%', background: '#ff6b6b', transition: 'width 0.05s' }} />
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s', marginBottom: '12px' }}
                    onClick={startRecording}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255,80,80,0.1)'
                      e.currentTarget.style.borderColor = 'rgba(255,80,80,0.3)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                    }}
                  >
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff6b6b' }} />
                  </div>
                  <span style={{ fontSize: '12px', color: '#ccc', fontWeight: 700 }}>Record Hum / Whistle</span>
                  <span style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>Transcribe vocals instantly</span>
                </>
              )}
            </div>

            {audioFileName && (
              <div style={{ marginTop: '16px', background: 'rgba(77,171,247,0.05)', border: '1px solid rgba(77,171,247,0.15)', borderRadius: '8px', padding: '10px', fontSize: '10px', color: '#4dabf7', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <IconSpeaker size={12} style={{ color: '#4dabf7' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{audioFileName}</span>
              </div>
            )}

            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                disabled={!audioBuffer || isAnalyzing}
                onClick={handleAnalyzeAudio}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: (!audioBuffer || isAnalyzing) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)',
                  color: (!audioBuffer || isAnalyzing) ? '#555' : 'white',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: (!audioBuffer || isAnalyzing) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  if (audioBuffer && !isAnalyzing) e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                }}
                onMouseLeave={e => {
                  if (audioBuffer && !isAnalyzing) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                }}
              >
                {isAnalyzing ? 'Analyzing...' : (pitchBlobs.length > 0 ? 'Re-Analyze Audio' : 'Detect Blobs')}
              </button>
            </div>
          </div>

          {/* Center Panel: Visual Spectrogram & Pitch Blobs Canvas */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0 }}>
            {isAnalyzing && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,16,21,0.8)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <div style={{ width: '28px', height: '28px', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#da77f2', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Decoding audio contents...</span>
              </div>
            )}
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: '100%', display: 'block', cursor: dragMode === 'pan' || isSelectingRegion ? 'grabbing' : 'crosshair' }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              onContextMenu={handleCanvasContextMenu}
              onWheel={handleWheel}
            />

            {/* Zoom Controls Overlay */}
            {audioBuffer && (
              <div style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 10 }}>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => setZoom(Math.min(zoom * 1.5, 50))}
                  style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
                >+</button>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => { setZoom(Math.max(zoom / 1.5, 1)); if (zoom / 1.5 <= 1) setPanOffset(0); }}
                  style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
                >−</button>
              </div>
            )}

            {/* Playback Controls & Action Deck overlay */}
            {audioBuffer && (
              <div style={{
                position: 'absolute',
                bottom: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(20, 21, 28, 0.85)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '30px',
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                zIndex: 5
              }}>
                {/* Play/Stop Toggle */}
                {isPlayingAudio ? (
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={stopPlayback}
                    style={{ background: 'rgba(255,80,80,0.15)', border: '1px solid rgba(255,80,80,0.3)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', cursor: 'pointer', transition: 'all 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    title="Stop Playback"
                  >
                    <IconStop size={14} />
                  </button>
                ) : (
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => startPlayback(playbackTime)}
                    style={{ background: 'rgba(77,171,247,0.15)', border: '1px solid rgba(77,171,247,0.3)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4dabf7', cursor: 'pointer', transition: 'all 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    title="Start Playback"
                  >
                    <IconPlay size={14} style={{ marginLeft: '2px' }} />
                  </button>
                )}

                <div style={{ height: '16px', width: '1px', background: 'rgba(255,255,255,0.15)' }} />

                {/* Time Info */}
                <span style={{ fontSize: '10px', color: '#aaa', fontFamily: 'monospace', fontWeight: 600 }}>
                  {playbackTime.toFixed(2)}s / {audioBuffer.duration.toFixed(2)}s
                </span>

                {/* Delete selected blob */}
                {selectedBlobIndex !== null && (
                  <>
                    <div style={{ height: '16px', width: '1px', background: 'rgba(255,255,255,0.15)' }} />
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => {
                        const updated = pitchBlobs.filter((_, idx) => idx !== selectedBlobIndex)
                        setPitchBlobs(updated)
                        setSelectedBlobIndex(null)
                        useStore.getState().showToast("Deleted selected note blob", "success")
                      }}
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px', color: '#ff6b6b', fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255,80,80,0.1)'
                        e.currentTarget.style.borderColor = 'rgba(255,80,80,0.2)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                      }}
                      title="Delete Selected Blob (Backspace/Delete)"
                    >
                      <IconTrash size={10} /> Delete Note
                    </button>
                  </>
                )}

                {/* Selection Info */}
                {selectionStart !== null && selectionEnd !== null && (
                  <>
                    <div style={{ height: '16px', width: '1px', background: 'rgba(255,255,255,0.15)' }} />
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => {
                        setSelectionStart(null)
                        setSelectionEnd(null)
                      }}
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '4px 8px', color: '#da77f2', fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(218,119,242,0.1)'
                        e.currentTarget.style.borderColor = 'rgba(218,119,242,0.2)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                      }}
                      title="Clear active region filter"
                    >
                      Clear Selection ({Math.abs(selectionStart - selectionEnd).toFixed(2)}s)
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right panel: Controls */}
          <div style={{ width: '330px', borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', padding: '20px', background: 'rgba(0,0,0,0.1)', overflowY: 'auto' }} className="thin-scroll">
            <span style={{ fontSize: '10px', color: '#666', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px', display: 'block' }}>
              {isDrumTrack ? "Drum Extraction Deck" : "Melody Controls"}
            </span>

            {!isDrumTrack && (
              <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '8px' }}>
                <button
                  onClick={() => setTranscriptionEngine('melodyne')}
                  style={{ flex: 1, padding: '6px 8px', fontSize: '11px', fontWeight: 600, background: transcriptionEngine === 'melodyne' ? '#da77f2' : 'transparent', color: transcriptionEngine === 'melodyne' ? '#fff' : '#aaa', border: 'none', borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  Melodyne (Fast)
                </button>
                <button
                  onClick={() => setTranscriptionEngine('magenta')}
                  style={{ flex: 1, padding: '6px 8px', fontSize: '11px', fontWeight: 600, background: transcriptionEngine === 'magenta' ? '#da77f2' : 'transparent', color: transcriptionEngine === 'magenta' ? '#fff' : '#aaa', border: 'none', borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  Magenta AI (Deep)
                </button>
              </div>
            )}

            {/* EDO Tuning Extraction Grid Controls */}
            {!isDrumTrack && (
              <div style={{
                background: 'rgba(0, 230, 255, 0.05)',
                border: '1px solid rgba(0, 230, 255, 0.2)',
                borderRadius: '8px',
                padding: '10px',
                marginBottom: '14px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: '#00e6ff', letterSpacing: '0.5px' }}>
                    TUNING EXTRACTION GRID
                  </span>
                  <span style={{ fontSize: '9px', color: '#aaa', fontWeight: 600 }}>
                    {(1200 / extractionEdo).toFixed(1)}¢ / step
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <select
                    value={
                      extractionEdo === 12 ? '12-edo' :
                      extractionEdo === 19 ? '19-edo' :
                      extractionEdo === 24 ? '24-edo' :
                      extractionEdo === 31 ? '31-edo' :
                      extractionEdo === 53 ? '53-edo' : 'custom'
                    }
                    onChange={e => {
                      const val = e.target.value
                      if (val === '12-edo') setExtractionEdo(12)
                      else if (val === '19-edo') setExtractionEdo(19)
                      else if (val === '24-edo') setExtractionEdo(24)
                      else if (val === '31-edo') setExtractionEdo(31)
                      else if (val === '53-edo') setExtractionEdo(53)
                      else setExtractionEdo(customEdoInput || 19)
                    }}
                    style={{
                      flex: 1,
                      background: '#161720',
                      color: 'white',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '4px',
                      padding: '5px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="12-edo">12-EDO (Standard Western)</option>
                    <option value="19-edo">19-EDO (Meantone / Equal)</option>
                    <option value="24-edo">24-EDO (Quarter-Tone Arabic)</option>
                    <option value="31-edo">31-EDO (Huygens-Fokker)</option>
                    <option value="53-edo">53-EDO (Turkish Makam)</option>
                    <option value="custom">Custom N-EDO</option>
                  </select>
                  {extractionEdo !== 12 && extractionEdo !== 19 && extractionEdo !== 24 && extractionEdo !== 31 && extractionEdo !== 53 && (
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={customEdoInput}
                      onChange={e => {
                        const n = Math.max(1, Math.min(120, parseInt(e.target.value) || 12))
                        setCustomEdoInput(n)
                        setExtractionEdo(n)
                      }}
                      style={{
                        width: '48px',
                        background: '#12121a',
                        color: '#00e6ff',
                        border: '1px solid rgba(0, 230, 255, 0.3)',
                        borderRadius: '4px',
                        padding: '4px',
                        fontSize: '11px',
                        fontWeight: 700,
                        textAlign: 'center'
                      }}
                      title="Number of equal divisions per octave"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Slider Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>


              <ParameterSlider
                label="Noise Gate (Threshold)"
                value={gateThreshold}
                min={0.001}
                max={0.2}
                step={0.001}
                color="#da77f2"
                onChange={setGateThreshold}
              />

              <ParameterSlider
                label={isDrumTrack ? "Transient Sensitivity" : "Pitch Sensitivity"}
                value={pitchSensitivity}
                min={10}
                max={100}
                step={1}
                color="#da77f2"
                suffix="%"
                onChange={setPitchSensitivity}
              />

              {!isDrumTrack && (
                <ParameterSlider
                  label="Min Note Duration"
                  value={minNoteDuration}
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  color="#da77f2"
                  suffix="s"
                  onChange={setMinNoteDuration}
                />
              )}

              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

              {/* Quantization Snap */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#aaa', fontWeight: 600, marginBottom: '6px' }}>
                  <span>Quantize Grid Snap</span>
                  <span style={{ color: '#da77f2', fontWeight: 700 }}>
                    {quantizeResolution === 0 ? 'None (Raw)' : quantizeResolution === 192 ? '1/4 Beat' : quantizeResolution === 96 ? '1/8 Beat' : '1/16 Beat'}
                  </span>
                </div>
                <select
                  value={quantizeResolution}
                  onChange={e => setQuantizeResolution(parseInt(e.target.value))}
                  style={{ width: '100%', background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '11px', outline: 'none' }}
                >
                  <option value={0}>None (Raw Time)</option>
                  <option value={192}>Quarter Note (1/4)</option>
                  <option value={96}>Eighth Note (1/8)</option>
                  <option value={48}>Sixteenth Note (1/16)</option>
                </select>
              </div>

              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

              {/* Import Placement Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }} title="When enabled, extracted notes will be shifted to start at the beginning of the grid. When disabled, they keep their absolute timestamp from the audio file.">Place Notes at Start of Grid</span>
                <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={shiftToStart}
                    onChange={e => setShiftToStart(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                  />
                  <span style={{ display: 'inline-block', width: '34px', height: '18px', borderRadius: '9px', background: shiftToStart ? 'rgba(218,119,242,0.25)' : '#252530', border: `1px solid ${shiftToStart ? '#da77f2' : '#333'}`, position: 'relative', transition: 'all 0.2s' }}>
                    <span style={{ position: 'absolute', top: '2px', left: shiftToStart ? '17px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: shiftToStart ? '#da77f2' : '#666', transition: 'all 0.2s' }} />
                  </span>
                </label>
              </div>

              {isDrumTrack ? (
                <>
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />
                  <span style={{ fontSize: '10px', color: '#666', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', display: 'block' }}>Percussion Filters Matrix</span>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {drumPieceFilters.map((filter, index) => (
                      <div key={filter.pitch} style={{
                        background: 'rgba(255,255,255,0.015)',
                        border: `1px solid ${filter.enabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)'}`,
                        borderRadius: '10px',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        transition: 'all 0.15s'
                      }}>
                        {/* Row 1: Checkbox + Name + Color Tag */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: filter.enabled ? 'white' : '#555' }}>
                            <input
                              type="checkbox"
                              checked={filter.enabled}
                              onChange={e => {
                                const updated = [...drumPieceFilters]
                                updated[index].enabled = e.target.checked
                                setDrumPieceFilters(updated)
                              }}
                              style={{ accentColor: filter.color || '#da77f2', cursor: 'pointer' }}
                            />
                            {filter.name}
                          </label>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: filter.color || '#da77f2' }} />
                        </div>

                        {filter.enabled && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                              <ParameterSlider
                                label="Min Frequency"
                                value={filter.minFreq}
                                min={20}
                                max={20000}
                                step={50}
                                color={filter.color || '#da77f2'}
                                suffix="Hz"
                                onChange={val => {
                                  const updated = [...drumPieceFilters]
                                  updated[index].minFreq = Math.min(val, filter.maxFreq - 50)
                                  setDrumPieceFilters(updated)
                                }}
                              />
                              <ParameterSlider
                                label="Max Frequency"
                                value={filter.maxFreq}
                                min={20}
                                max={20000}
                                step={50}
                                color={filter.color || '#da77f2'}
                                suffix="Hz"
                                onChange={val => {
                                  const updated = [...drumPieceFilters]
                                  updated[index].maxFreq = Math.max(val, filter.minFreq + 50)
                                  setDrumPieceFilters(updated)
                                }}
                              />
                              <ParameterSlider
                                label="Sensitivity"
                                value={filter.sensitivity}
                                min={5}
                                max={95}
                                step={1}
                                color={filter.color || '#da77f2'}
                                suffix="%"
                                onChange={val => {
                                  const updated = [...drumPieceFilters]
                                  updated[index].sensitivity = val
                                  setDrumPieceFilters(updated)
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {/* Pitch Shift Transposition */}
                  <ParameterSlider
                    label="Pitch Transpose"
                    value={transposeSemitones}
                    min={-24}
                    max={24}
                    step={1}
                    color="#da77f2"
                    suffix="st"
                    onChange={setTransposeSemitones}
                  />

                  {/* Pitch Range Filters */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#aaa', fontWeight: 600, marginBottom: '6px' }}>
                      <span>Isolate Frequency Filter</span>
                      <span style={{ color: '#fff' }}>{freqFilterLow}Hz - {freqFilterHigh}Hz</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="number"
                        value={freqFilterLow}
                        onChange={e => setFreqFilterLow(Math.max(40, parseInt(e.target.value) || 40))}
                        style={{ flex: 1, background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '5px', fontSize: '10px', textAlign: 'center' }}
                        title="Low frequency cutoff (Highpass)"
                      />
                      <input
                        type="number"
                        value={freqFilterHigh}
                        onChange={e => setFreqFilterHigh(Math.min(2000, parseInt(e.target.value) || 2000))}
                        style={{ flex: 1, background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '5px', fontSize: '10px', textAlign: 'center' }}
                        title="High frequency cutoff (Lowpass)"
                      />
                    </div>
                  </div>

                  {/* Lock to Scale Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }} title="Force all transcribed notes to align with active project key and scale.">Lock To Project Scale</span>
                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={lockToScale}
                        onChange={e => setLockToScale(e.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                      />
                      <span style={{ display: 'inline-block', width: '34px', height: '18px', borderRadius: '9px', background: lockToScale ? 'rgba(218,119,242,0.25)' : '#252530', border: `1px solid ${lockToScale ? '#da77f2' : '#333'}`, position: 'relative', transition: 'all 0.2s' }}>
                        <span style={{ position: 'absolute', top: '2px', left: lockToScale ? '17px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: lockToScale ? '#da77f2' : '#666', transition: 'all 0.2s' }} />
                      </span>
                    </label>
                  </div>

                  {/* Vocal Velocity Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
                    <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }} title="When enabled, notes will use the recorded amplitude as velocity. When disabled, notes will use a constant velocity.">Track Vocal Velocity</span>
                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={vocalVelocityEnabled}
                        onChange={e => setVocalVelocityEnabled(e.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                      />
                      <span style={{ display: 'inline-block', width: '34px', height: '18px', borderRadius: '9px', background: vocalVelocityEnabled ? 'rgba(218,119,242,0.25)' : '#252530', border: `1px solid ${vocalVelocityEnabled ? '#da77f2' : '#333'}`, position: 'relative', transition: 'all 0.2s' }}>
                        <span style={{ position: 'absolute', top: '2px', left: vocalVelocityEnabled ? '17px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: vocalVelocityEnabled ? '#da77f2' : '#666', transition: 'all 0.2s' }} />
                      </span>
                    </label>
                  </div>

                  {vocalVelocityEnabled ? (
                    <div style={{ marginTop: '12px' }}>
                      <ParameterSlider
                        label="Velocity Sensitivity"
                        value={vocalVelocityScale}
                        min={50}
                        max={1500}
                        step={5}
                        color="#da77f2"
                        onChange={setVocalVelocityScale}
                      />
                      <ParameterSlider
                        label="Min Velocity Limit"
                        value={vocalVelocityMin}
                        min={1}
                        max={127}
                        step={1}
                        color="#da77f2"
                        onChange={setVocalVelocityMin}
                      />
                      <ParameterSlider
                        label="Max Velocity Limit"
                        value={vocalVelocityMax}
                        min={1}
                        max={127}
                        step={1}
                        color="#da77f2"
                        onChange={setVocalVelocityMax}
                      />
                    </div>
                  ) : (
                    <div style={{ marginTop: '12px' }}>
                      <ParameterSlider
                        label="Constant Velocity"
                        value={constantVelocity}
                        min={1}
                        max={127}
                        step={1}
                        color="#da77f2"
                        onChange={setConstantVelocity}
                      />
                    </div>
                  )}
                </>
              )}

            </div>

            {/* Bottom Add button */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                disabled={pitchBlobs.length === 0}
                onClick={handleAddToGrid}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: pitchBlobs.length === 0 ? 'rgba(255,255,255,0.03)' : '#9b4dca',
                  color: pitchBlobs.length === 0 ? '#555' : 'white',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: pitchBlobs.length === 0 ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={e => {
                  if (pitchBlobs.length > 0) {
                    e.currentTarget.style.background = '#ab5fdb'
                  }
                }}
                onMouseLeave={e => {
                  if (pitchBlobs.length > 0) {
                    e.currentTarget.style.background = '#9b4dca'
                  }
                }}
              >
                Add Converted MIDI to Grid
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  )
}
