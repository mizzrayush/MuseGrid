import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import * as Tone from 'tone'
import { useStore, type Track } from '../engine/store'
import { SYNTH_PRESETS, SYNTH_PRESET_PARAMS, type SynthPreset } from '../utils/instruments'
import { audioEngine } from '../engine/AudioEngine'
import { saveFileWithDialog } from '../utils/fileExport'
import { IconX, IconShuffle, IconZap, IconPlay, IconDownload, IconSync, IconUpload, IconWaveform, IconLoop, IconMic, IconSave } from './Icons'
import { CHROMATIC_SAMPLE_PRESETS, bufferToDataUri, type ChromaticSamplePreset } from '../utils/chromaticSamplePresets'
import { QuickMicRecorder } from '../utils/micRecorder'
import { resolveSamplerLoopMode, resolveSamplerRegion } from '../utils/audioPlayback'
import type { SynthSamplerConfig } from '../engine/store'
import { evaluateMathExpression, calculateFourierPartials, MATH_FORMULA_PRESETS } from '../utils/mathWaveform'
import {
  generateCurveLut,
  sampleCurveLut,
  CURVE_FORMULA_PRESETS,
  type EnvelopeCurveType
} from '../utils/envelopeCurves'
import { AppSlider } from './AppSlider'

const reversedBufferCache = new WeakMap<AudioBuffer, AudioBuffer>()
function getReversedAudioBuffer(audioCtx: AudioContext, buffer: AudioBuffer): AudioBuffer {
  const cached = reversedBufferCache.get(buffer)
  if (cached) return cached

  const reversed = audioCtx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  )
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const dst = reversed.getChannelData(ch)
    const len = src.length
    for (let i = 0; i < len; i++) {
      dst[i] = src[len - 1 - i]
    }
  }
  reversedBufferCache.set(buffer, reversed)
  return reversed
}

const KEYBOARD_NOTES = [
  { note: 'C3', midi: 48, isBlack: false },
  { note: 'C#3', midi: 49, isBlack: true },
  { note: 'D3', midi: 50, isBlack: false },
  { note: 'D#3', midi: 51, isBlack: true },
  { note: 'E3', midi: 52, isBlack: false },
  { note: 'F3', midi: 53, isBlack: false },
  { note: 'F#3', midi: 54, isBlack: true },
  { note: 'G3', midi: 55, isBlack: false },
  { note: 'G#3', midi: 56, isBlack: true },
  { note: 'A3', midi: 57, isBlack: false },
  { note: 'A#3', midi: 58, isBlack: true },
  { note: 'B3', midi: 59, isBlack: false },
  { note: 'C4', midi: 60, isBlack: false },
  { note: 'C#4', midi: 61, isBlack: true },
  { note: 'D4', midi: 62, isBlack: false },
  { note: 'D#4', midi: 63, isBlack: true },
  { note: 'E4', midi: 64, isBlack: false },
  { note: 'F4', midi: 65, isBlack: false },
  { note: 'F#4', midi: 66, isBlack: true },
  { note: 'G4', midi: 67, isBlack: false },
  { note: 'G#4', midi: 68, isBlack: true },
  { note: 'A4', midi: 69, isBlack: false },
  { note: 'A#4', midi: 70, isBlack: true },
  { note: 'B4', midi: 71, isBlack: false },
  { note: 'C5', midi: 72, isBlack: false }]

const DEFAULT_SAMPLER: SynthSamplerConfig = {
  name: '',
  rootNote: 60,
  tuning: 0,
  fineTune: 0,
  startOffset: 0,
  endOffset: 1,
  loopStartOffset: 0,
  loopEndOffset: 1,
  loopMode: 'sustain',
  loop: false,
  reverse: false,
  attack: 0.005,
  decay: 0.25,
  sustain: 0.6,
  release: 0.35,
  volume: 1,
  pan: 0
}

const midiToNoteName = (midi: number) => {
  try { return Tone.Frequency(midi, 'midi').toNote() } catch (_) { return `MIDI ${midi}` }
}

type SamplerAuditionVoice = {
  source: AudioBufferSourceNode
  gain: GainNode
  loopGain?: GainNode
  startTime: number
  firstPassSeconds: number
  tail?: {
    buffer: AudioBuffer
    rate: number
    tailStartSeconds: number
    tailDurationSeconds: number
  }
}

const SamplerCard: React.FC<{ title: string; accent?: string; hint?: string; children: React.ReactNode }> = ({ title, accent = '#00e6ff', hint, children }) => (
  <div
    style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: '12px',
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '11px', fontWeight: 800, color: accent, letterSpacing: '0.04em' }}>{title}</span>
      {hint && <span style={{ fontSize: '9px', color: '#666' }}>{hint}</span>}
    </div>
    {children}
  </div>
)

const SamplerSlider: React.FC<{
  label: string
  value: number
  min: number
  max: number
  step: number
  display?: string
  accent?: string
  onChange: (v: number) => void
}> = ({ label, value, min, max, step, display, accent = '#00e6ff', onChange }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', fontWeight: 700, marginBottom: '4px' }}>
      <span>{label}</span>
      <span style={{ color: accent, fontFamily: 'monospace' }}>{display ?? value}</span>
    </div>
    <AppSlider value={value} min={min} max={max} step={step} color={accent} onChange={onChange} />
  </div>
)

const SamplerPill: React.FC<{ label: string; active: boolean; accent?: string; title?: string; onClick: () => void }> = ({ label, active, accent = '#00e6ff', title, onClick }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      background: active ? 'rgba(0, 230, 255, 0.18)' : 'rgba(255, 255, 255, 0.05)',
      border: `1px solid ${active ? accent : 'rgba(255, 255, 255, 0.08)'}`,
      color: active ? '#ffffff' : '#bbb',
      borderRadius: '6px',
      padding: '6px 8px',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase',
      cursor: 'pointer',
      transition: 'all 0.15s ease'
    }}
  >
    {label}
  </button>
)

export const SynthStudioModal: React.FC = () => {
  const isVisible = useStore(state => state.isSynthStudioModalVisible)
  const setIsVisible = useStore(state => state.setIsSynthStudioModalVisible)
  const tracks = useStore(state => state.tracks)
  const activeTrackId = useStore(state => state.activeTrackId)
  const updateTrack = useStore(state => state.updateTrack)

  // Find target synth track
  const targetTrack = useMemo(() => {
    const active = tracks.find(t => t.id === activeTrackId)
    if (active && active.instrument === 'synth') return active
    return tracks.find(t => t.instrument === 'synth') || null
  }, [tracks, activeTrackId])

  // Local Sound Design State synced with Track
  const [oscType, setOscType] = useState<'sine' | 'sawtooth' | 'square' | 'triangle' | 'custom'>('triangle')
  const [synthFormula, setSynthFormula] = useState<string>('sin(t) + 0.6 * sin(3 * t) + 0.3 * sin(5 * t)')
  const [synthPartialsCount, setSynthPartialsCount] = useState<number>(16)
  const [unison, setUnison] = useState<number>(1)
  const [detuneSpread, setDetuneSpread] = useState<number>(12)
  const [octave, setOctave] = useState<number>(0)
  const [semitone, setSemitone] = useState<number>(0)
  const [fineDetune, setFineDetune] = useState<number>(0)

  // ADSR State
  const [attack, setAttack] = useState<number>(0.02)
  const [decay, setDecay] = useState<number>(0.25)
  const [sustain, setSustain] = useState<number>(0.5)
  const [release, setRelease] = useState<number>(0.35)

  // Alien Envelope Curve State (Supports Exponential Acoustic, Linear, Logarithmic, S-Curve, Tension Warping, and Arbitrary Math Expressions f(x))
  const [decayCurveType, setDecayCurveType] = useState<EnvelopeCurveType>('exponential')
  const [decayTension, setDecayTension] = useState<number>(0)
  const [decayFormula, setDecayFormula] = useState<string>('exp(-4.8 * x)')

  // 256-point curve LUT computed for real-time visualizer & audio engine dispatch
  const currentCurveLut = useMemo(() => {
    return generateCurveLut(decayCurveType, decayTension, decayFormula, 256)
  }, [decayCurveType, decayTension, decayFormula])

  // Filter State
  const [filterFreq, setFilterFreq] = useState<number>(2500)
  const [filterQ, setFilterQ] = useState<number>(2.5)
  const [filterType, setFilterType] = useState<'lowpass' | 'highpass' | 'bandpass' | 'notch'>('lowpass')
  const [filterDrive] = useState<number>(0.1)

  // Portamento / Glide
  const [portamento, setPortamento] = useState<number>(0)

  // Audition state
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // Canvas Refs
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const adsrCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const filterCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // ---- Single-sample chromatic sampler (SAMPLER mode) ----
  const [samplerMode, setSamplerMode] = useState<boolean>(false)
  const [sampler, setSampler] = useState<SynthSamplerConfig>(DEFAULT_SAMPLER)
  const [samplerBuffer, setSamplerBuffer] = useState<AudioBuffer | null>(null)
  const [samplerDragOver, setSamplerDragOver] = useState<boolean>(false)
  const samplerFileInputRef = useRef<HTMLInputElement | null>(null)
  const samplerCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplerDragEdge = useRef<'start' | 'end' | null>(null)
  const samplerAuditionRef = useRef<SamplerAuditionVoice | null>(null)

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false)
  const lastLoadedTrackIdRef = useRef<string | null>(null)

  const commitSampler = useCallback((updates: Partial<SynthSamplerConfig>) => {
    setSampler(prev => {
      const next = { ...prev, ...updates }
      const start = Math.max(0, Math.min(0.99, next.startOffset))
      const end = Math.max(start + 0.01, Math.min(1, next.endOffset))
      const loopStart = Math.min(Math.max(next.loopStartOffset ?? start, start), end - 0.005)
      const loopEnd = Math.max(Math.min(next.loopEndOffset ?? end, end), loopStart + 0.005)
      return { ...next, startOffset: start, endOffset: end, loopStartOffset: loopStart, loopEndOffset: loopEnd }
    })
    setSamplerMode(true)
    setHasUnsavedChanges(true)
  }, [])

  const setStudioMode = useCallback((mode: 'synth' | 'sampler') => {
    setSamplerMode(mode === 'sampler')
    setHasUnsavedChanges(true)
  }, [])

  const loadSamplerFile = useCallback(async (file: File) => {
    try {
      const audioCtx = Tone.getContext().rawContext as AudioContext
      const decoded = await audioCtx.decodeAudioData(await file.arrayBuffer())
      const base64Uri = await bufferToDataUri(decoded)
      commitSampler({ name: file.name.replace(/\.[^/.]+$/, ''), audioBase64: base64Uri })
      useStore.getState().showToast(`Chromatic sampler loaded "${file.name}"`, 'success')
    } catch (err) {
      console.error('Sampler file load failed:', err)
      useStore.getState().showToast('Could not decode audio file. Use WAV, AIFF, MP3 or OGG.', 'error')
    }
  }, [commitSampler])

  const loadSamplerPreset = useCallback(async (preset: ChromaticSamplePreset) => {
    try {
      const audioCtx = Tone.getContext().rawContext as AudioContext
      const buffer = preset.generate(audioCtx)
      const base64Uri = await bufferToDataUri(buffer)
      commitSampler({ name: preset.name, audioBase64: base64Uri, rootNote: preset.rootNote })
      useStore.getState().showToast(`Sampler preset "${preset.name}" loaded on ${midiToNoteName(preset.rootNote)}`, 'success')
    } catch (err) {
      console.error('Sampler preset load failed:', err)
    }
  }, [commitSampler])

  // Live Microphone Quick-Sampler (OP-1 / SP-404 style voice & acoustic instrument sampler)
  const [isRecordingMic, setIsRecordingMic] = useState<boolean>(false)
  const [micSeconds, setMicSeconds] = useState<number>(0)
  const micRecorderRef = useRef<QuickMicRecorder | null>(null)
  const micTimerRef = useRef<any>(null)

  const stopMicRecording = useCallback(async () => {
    if (micTimerRef.current) {
      clearInterval(micTimerRef.current)
      micTimerRef.current = null
    }
    if (!micRecorderRef.current) return

    try {
      const result = await micRecorderRef.current.stop()
      setIsRecordingMic(false)
      const base64Uri = await bufferToDataUri(result.buffer)
      const assignedRoot = result.detectedMidiNote ?? 60
      commitSampler({
        name: `Mic Voice (${midiToNoteName(assignedRoot)})`,
        audioBase64: base64Uri,
        rootNote: assignedRoot
      })
      useStore.getState().showToast(
        `Recorded live vocal/mic sample! Root mapped to ${midiToNoteName(assignedRoot)} (${result.durationSec.toFixed(2)}s)`,
        'success'
      )
    } catch (err) {
      console.error('Error stopping mic recording:', err)
      setIsRecordingMic(false)
    }
  }, [commitSampler])

  const startMicRecording = useCallback(async () => {
    try {
      if (!micRecorderRef.current) {
        micRecorderRef.current = new QuickMicRecorder()
      }
      await micRecorderRef.current.start()
      setIsRecordingMic(true)
      setMicSeconds(0)
      if (micTimerRef.current) clearInterval(micTimerRef.current)
      micTimerRef.current = setInterval(() => {
        setMicSeconds(s => {
          if (s >= 15) {
            void stopMicRecording()
            return s
          }
          return s + 1
        })
      }, 1000)
    } catch (err: any) {
      console.error('Microphone recording failed:', err)
      useStore.getState().showToast('Could not access microphone. Please allow audio permission in settings.', 'error')
      setIsRecordingMic(false)
    }
  }, [stopMicRecording])

  useEffect(() => {
    return () => {
      if (micTimerRef.current) clearInterval(micTimerRef.current)
      if (micRecorderRef.current) micRecorderRef.current.cancel()
    }
  }, [])

  // Decode the stored payload for the waveform display (engine cache avoids repeat work)
  useEffect(() => {
    const uri = sampler.audioBase64
    if (!uri) {
      setSamplerBuffer(null)
      return
    }
    let alive = true
    audioEngine.loadSynthSamplerBuffer(uri).then(buf => {
      if (alive && buf) setSamplerBuffer(buf)
    })
    return () => { alive = false }
  }, [sampler.audioBase64])

  const drawSamplerWaveform = useCallback(() => {
    const canvas = samplerCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#090a10'
    ctx.fillRect(0, 0, w, h)

    const startPx = sampler.startOffset * w
    const endPx = Math.max(startPx + 2, sampler.endOffset * w)
    const loopStartPx = (sampler.loopStartOffset ?? sampler.startOffset) * w
    const loopEndPx = Math.max(loopStartPx + 2, (sampler.loopEndOffset ?? sampler.endOffset) * w)

    ctx.fillStyle = 'rgba(0, 230, 255, 0.07)'
    ctx.fillRect(startPx, 0, endPx - startPx, h)
    ctx.fillStyle = 'rgba(105, 219, 124, 0.10)'
    ctx.fillRect(loopStartPx, 0, loopEndPx - loopStartPx, h)
    ctx.fillStyle = 'rgba(105, 219, 124, 0.7)'
    ctx.fillRect(loopStartPx, 0, loopEndPx - loopStartPx, 3)

    if (samplerBuffer) {
      const data = samplerBuffer.getChannelData(0)
      const step = Math.max(1, Math.floor(data.length / w))
      ctx.strokeStyle = sampler.reverse ? '#ff3366' : '#00e6ff'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x < w; x++) {
        let min = 1
        let max = -1
        const col = sampler.reverse ? (w - 1 - x) : x
        const end = Math.min(data.length, (col + 1) * step)
        for (let i = col * step; i < end; i++) {
          const s = data[i]
          if (s < min) min = s
          if (s > max) max = s
        }
        if (min > max) { min = 0; max = 0 }
        ctx.moveTo(x + 0.5, h / 2 - max * h * 0.45)
        ctx.lineTo(x + 0.5, h / 2 - min * h * 0.45)
      }
      ctx.stroke()
    } else {
      ctx.fillStyle = '#556'
      ctx.font = '700 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('DROP AN AUDIO FILE OR LOAD A ROOT-NOTE PRESET', w / 2, h / 2 - 4)
      ctx.textAlign = 'left'
    }

    // Region handles
    ctx.strokeStyle = '#00e6ff'
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(startPx, 0); ctx.lineTo(startPx, h)
    ctx.moveTo(endPx, 0); ctx.lineTo(endPx, h)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = '#00e6ff'
    ctx.fillRect(startPx - 1.5, 0, 3, h)
    ctx.fillRect(endPx - 1.5, 0, 3, h)

    // Sustain loop span (independent from the trim)
    ctx.strokeStyle = '#69db7c'
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(loopStartPx, 0); ctx.lineTo(loopStartPx, h)
    ctx.moveTo(loopEndPx, 0); ctx.lineTo(loopEndPx, h)
    ctx.stroke()
    ctx.setLineDash([])

    if (resolveSamplerLoopMode(sampler.loopMode) === 'releaseTail' && loopEndPx < endPx) {
      ctx.fillStyle = 'rgba(105, 219, 124, 0.06)'
      ctx.fillRect(loopEndPx, 0, endPx - loopEndPx, h)
      ctx.fillStyle = 'rgba(105, 219, 124, 0.35)'
      ctx.fillRect(loopEndPx, h - 3, endPx - loopEndPx, 3)
    }
  }, [samplerBuffer, sampler.startOffset, sampler.endOffset, sampler.loopStartOffset, sampler.loopEndOffset, sampler.loopMode, sampler.reverse])

  useEffect(() => {
    if (isVisible && samplerMode) drawSamplerWaveform()
  }, [isVisible, samplerMode, drawSamplerWaveform])

  const handleSamplerWavePointer = (e: React.MouseEvent<HTMLCanvasElement>, phase: 'down' | 'move') => {
    const canvas = samplerCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const norm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (phase === 'down') {
      const startN = sampler.startOffset
      const endN = sampler.endOffset
      samplerDragEdge.current = Math.abs(norm - startN) <= Math.abs(norm - endN) ? 'start' : 'end'
      commitSampler(samplerDragEdge.current === 'start' ? { startOffset: +Math.min(norm, 0.99).toFixed(3) } : { endOffset: +Math.max(norm, 0.01).toFixed(3) })
      return
    }
    if (!samplerDragEdge.current) return
    commitSampler(samplerDragEdge.current === 'start'
      ? { startOffset: +Math.min(norm, sampler.endOffset - 0.01).toFixed(3) }
      : { endOffset: +Math.max(norm, sampler.startOffset + 0.01).toFixed(3) })
  }


  // Sync with track when modal opens or targetTrack changes
  // Sync with track when modal opens or targetTrack ID changes
  useEffect(() => {
    if (!isVisible || !targetTrack) {
      if (!isVisible) {
        lastLoadedTrackIdRef.current = null
      }
      return
    }
    if (lastLoadedTrackIdRef.current === targetTrack.id) return
    lastLoadedTrackIdRef.current = targetTrack.id
    setHasUnsavedChanges(false)

    if (targetTrack.synthOscillator) setOscType(targetTrack.synthOscillator)
    if (targetTrack.synthFormula) setSynthFormula(targetTrack.synthFormula)
    if (targetTrack.synthPartialsCount) setSynthPartialsCount(targetTrack.synthPartialsCount)
    if (targetTrack.synthAttack !== undefined) setAttack(targetTrack.synthAttack)
    if (targetTrack.synthDecay !== undefined) setDecay(targetTrack.synthDecay)
    if (targetTrack.synthSustain !== undefined) setSustain(targetTrack.synthSustain)
    if (targetTrack.synthRelease !== undefined) setRelease(targetTrack.synthRelease)
    if (targetTrack.synthFilterType) setFilterType(targetTrack.synthFilterType)
    if (targetTrack.synthFilterFreq !== undefined) setFilterFreq(targetTrack.synthFilterFreq)
    if (targetTrack.synthFilterQ !== undefined) setFilterQ(targetTrack.synthFilterQ)
    if (targetTrack.synthUnison !== undefined) setUnison(targetTrack.synthUnison)
    if (targetTrack.synthDetuneSpread !== undefined) setDetuneSpread(targetTrack.synthDetuneSpread)
    if (targetTrack.synthPortamento !== undefined) setPortamento(targetTrack.synthPortamento)
    if (targetTrack.synthDetune !== undefined) setFineDetune(targetTrack.synthDetune)
    if (targetTrack.synthDecayCurveType) setDecayCurveType(targetTrack.synthDecayCurveType)
    if (targetTrack.synthDecayTension !== undefined) setDecayTension(targetTrack.synthDecayTension)
    if (targetTrack.synthDecayFormula) setDecayFormula(targetTrack.synthDecayFormula)
    setSamplerMode(targetTrack.synthMode === 'sampler')
    setSampler({ ...DEFAULT_SAMPLER, ...(targetTrack.synthSampler || {}) })
  }, [isVisible, targetTrack?.id])

  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible) {
        setIsVisible(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, setIsVisible])

  // Local state edit tracker (Testing mode)
  const applySettingsToTrack = useCallback((_updates: Partial<Track>) => {
    setHasUnsavedChanges(true)
  }, [])

  // A preset rewrites the engine's oscillator and envelope
  const applyPreset = useCallback((preset: SynthPreset) => {
    const params = SYNTH_PRESET_PARAMS[preset]
    if (!params) return
    setOscType(params.oscillator)
    setAttack(params.attack)
    setDecay(params.decay)
    setSustain(params.sustain)
    setRelease(params.release)
    setHasUnsavedChanges(true)
  }, [])

  // Save studio edits to project track
  const handleSaveToTrack = () => {
    if (!targetTrack) return

    // Saving studio edits must not silently swap a physical/vocal track back to the
    // generic custom synth; only an explicit sampler save changes the engine.
    const keepSpecializedPreset = !samplerMode &&
      (targetTrack.synthPreset === 'physical' || targetTrack.synthPreset === 'vocal')
    const savedPreset = keepSpecializedPreset ? targetTrack.synthPreset! : 'custom'

    let partials: number[] | undefined
    if (oscType === 'custom' && synthFormula) {
      try { partials = calculateFourierPartials(synthFormula, synthPartialsCount || 16) } catch { partials = undefined }
    }

    updateTrack(targetTrack.id, {
      synthPreset: savedPreset,
      synthMode: samplerMode ? 'sampler' : 'synth',
      // Flat fields are now the portable patch; drop a stale imported subtractive blob so
      // the web engine does not keep playing an older .muzins config. FM/Mono imports keep
      // their config because that engine topology cannot be expressed by flat fields.
      customMuxins: !samplerMode &&
        (targetTrack.customMuxins?.engineType === 'FMSynth' || targetTrack.customMuxins?.engineType === 'MonoSynth')
        ? targetTrack.customMuxins
        : undefined,
      synthOscillator: oscType,
      synthFormula: oscType === 'custom' ? synthFormula : undefined,
      synthPartialsCount: oscType === 'custom' ? synthPartialsCount : undefined,
      synthPartials: partials,
      synthAttack: attack,
      synthDecay: decay,
      synthSustain: sustain,
      synthRelease: release,
      synthFilterType: filterType,
      synthFilterFreq: filterFreq,
      synthFilterQ: filterQ,
      synthUnison: unison,
      synthDetuneSpread: detuneSpread,
      synthPortamento: portamento,
      synthDetune: fineDetune,
      synthDecayCurveType: decayCurveType,
      synthDecayTension: decayTension,
      synthDecayFormula: decayFormula,
      synthSampler: samplerMode ? { ...sampler } : undefined
    })

    audioEngine.createInstrument(targetTrack.id, 'synth')
    audioEngine.setTrackCurve(targetTrack.id, decayCurveType, decayTension, currentCurveLut)
    if (samplerMode && sampler.audioBase64) {
      audioEngine.setTrackSamplerConfig(targetTrack.id, sampler)
    }

    setHasUnsavedChanges(false)
    const savedLabel = savedPreset === 'physical' ? 'physical model' : savedPreset === 'vocal' ? 'vocal engine' : 'custom synth sound'
    useStore.getState().showToast(`Saved ${savedLabel} to track "${targetTrack.name}"!`, 'success')
  }

  // --- Waveform Animation ---
  useEffect(() => {
    if (!isVisible || samplerMode) return
    const canvas = waveformCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let phase = 0

    const render = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Background grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      ctx.stroke()

      // Wave cycles
      const cycles = 3
      const numLines = unison > 1 ? Math.min(unison, 5) : 1

      for (let layer = 0; layer < numLines; layer++) {
        const spreadOffset = (layer - (numLines - 1) / 2) * (detuneSpread / 100) * 0.15
        const layerPhase = phase + spreadOffset

        ctx.beginPath()
        ctx.strokeStyle = layer === 0 ? '#4dabf7' : `rgba(77, 171, 247, ${0.4 - layer * 0.08})`
        ctx.lineWidth = layer === 0 ? 1.8 : 1.0
        ctx.shadowBlur = 0

        for (let x = 0; x < w; x++) {
          const t = (x / w) * cycles * Math.PI * 2 + layerPhase
          let y = 0

          if (oscType === 'sine') {
            y = Math.sin(t)
          } else if (oscType === 'sawtooth') {
            y = 2 * ((t / (Math.PI * 2)) % 1) - 1
          } else if (oscType === 'square') {
            y = Math.sin(t) >= 0 ? 0.85 : -0.85
          } else if (oscType === 'triangle') {
            y = (2 / Math.PI) * Math.asin(Math.sin(t))
          } else if (oscType === 'custom') {
            y = Math.max(-1.5, Math.min(1.5, evaluateMathExpression(synthFormula, t % (Math.PI * 2))))
          }

          const py = h / 2 - y * (h * 0.38)
          if (x === 0) ctx.moveTo(x, py)
          else ctx.lineTo(x, py)
        }
        ctx.stroke()
      }

      phase += 0.035
      animId = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(animId)
  }, [isVisible, samplerMode, oscType, synthFormula, unison, detuneSpread])

  // --- Interactive ADSR Graph ---
  const isDraggingADSR = useRef<string | null>(null)

  const drawADSR = useCallback(() => {
    const canvas = adsrCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Background & grid
    ctx.fillStyle = '#10121a'
    ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
    ctx.lineWidth = 1
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }

    const padding = 16
    const usableW = w - padding * 2
    const usableH = h - padding * 2

    // Proportions
    const totalTime = Math.max(0.5, attack + decay + 0.4 + release)
    const attackX = padding + (attack / totalTime) * usableW
    const decayX = attackX + (decay / totalTime) * usableW
    const sustainX = decayX + (0.4 / totalTime) * usableW
    const releaseX = Math.min(w - padding, sustainX + (release / totalTime) * usableW)

    const peakY = padding
    const sustainY = padding + (1 - sustain) * usableH
    const baseY = h - padding

    // Subtle monochromatic area under curve
    const grad = ctx.createLinearGradient(0, peakY, 0, baseY)
    grad.addColorStop(0, 'rgba(77, 171, 247, 0.16)')
    grad.addColorStop(1, 'rgba(77, 171, 247, 0.02)')

    // Helper to trace full curved trajectory
    const traceCurvedPath = () => {
      ctx.beginPath()
      ctx.moveTo(padding, baseY)
      ctx.lineTo(attackX, peakY)

      // Decay segment with true curvature
      const decaySegments = 36
      for (let i = 1; i <= decaySegments; i++) {
        const p = i / decaySegments
        const curX = attackX + p * (decayX - attackX)
        const curveFactor = sampleCurveLut(currentCurveLut, p)
        const amp = sustain + (1.0 - sustain) * curveFactor
        const curY = padding + (1.0 - amp) * usableH
        ctx.lineTo(curX, curY)
      }

      // Sustain plateau
      ctx.lineTo(sustainX, sustainY)

      // Release segment with true curvature
      const releaseSegments = 36
      for (let i = 1; i <= releaseSegments; i++) {
        const p = i / releaseSegments
        const curX = sustainX + p * (releaseX - sustainX)
        const curveFactor = sampleCurveLut(currentCurveLut, p)
        const amp = sustain * curveFactor
        const curY = padding + (1.0 - amp) * usableH
        ctx.lineTo(curX, curY)
      }
    }

    // Fill
    traceCurvedPath()
    ctx.lineTo(releaseX, baseY)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // Clean, crisp stroke
    traceCurvedPath()
    ctx.strokeStyle = '#4dabf7'
    ctx.lineWidth = 1.8
    ctx.shadowBlur = 0
    ctx.stroke()

    // Handles
    const drawHandle = (x: number, y: number, label: string) => {
      ctx.beginPath()
      ctx.arc(x, y, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#4dabf7'
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.fillStyle = '#888'
      ctx.font = '600 9px sans-serif'
      ctx.fillText(label, x - 3, y - 7)
    }

    drawHandle(attackX, peakY, 'A')
    drawHandle(decayX, sustainY, 'D')
    drawHandle(sustainX, sustainY, 'S')
    drawHandle(releaseX, baseY, 'R')
  }, [attack, decay, sustain, release, currentCurveLut, decayCurveType, decayTension])

  useEffect(() => {
    if (isVisible && !samplerMode) drawADSR()
  }, [isVisible, samplerMode, drawADSR])

  // Mouse interaction on ADSR Canvas
  const handleADSRMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = adsrCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width

    const padding = 16
    const usableW = canvas.width - padding * 2
    const totalTime = attack + decay + 0.4 + release
    const attackX = padding + (attack / totalTime) * usableW
    const decayX = attackX + (decay / totalTime) * usableW
    const sustainX = decayX + (0.4 / totalTime) * usableW

    if (Math.abs(x - attackX) < 18) isDraggingADSR.current = 'A'
    else if (Math.abs(x - decayX) < 18) isDraggingADSR.current = 'D'
    else if (Math.abs(x - sustainX) < 18) isDraggingADSR.current = 'S'
    else isDraggingADSR.current = 'R'
  }

  const handleADSRMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingADSR.current) return
    const canvas = adsrCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const yRatio = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const movementX = e.movementX

    if (isDraggingADSR.current === 'A') {
      const newVal = Math.max(0.001, Math.min(2.0, attack + movementX * 0.008))
      setAttack(newVal)
      applySettingsToTrack({ synthAttack: newVal })
    } else if (isDraggingADSR.current === 'D') {
      const newVal = Math.max(0.01, Math.min(3.0, decay + movementX * 0.01))
      setDecay(newVal)
      setSustain(Math.max(0, Math.min(1, yRatio)))
      applySettingsToTrack({ synthDecay: newVal, synthSustain: Math.max(0, Math.min(1, yRatio)) })
    } else if (isDraggingADSR.current === 'S') {
      const newVal = Math.max(0, Math.min(1, yRatio))
      setSustain(newVal)
      applySettingsToTrack({ synthSustain: newVal })
    } else if (isDraggingADSR.current === 'R') {
      const newVal = Math.max(0.01, Math.min(4.0, release + movementX * 0.012))
      setRelease(newVal)
      applySettingsToTrack({ synthRelease: newVal })
    }
  }

  const handleADSRMouseUp = () => {
    isDraggingADSR.current = null
  }

  // --- Interactive Filter Graph ---
  const isDraggingFilter = useRef(false)

  const drawFilter = useCallback(() => {
    const canvas = filterCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Dark background
    ctx.fillStyle = '#10121a'
    ctx.fillRect(0, 0, w, h)

    // Freq Grid (100Hz, 1kHz, 10kHz)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
    ctx.lineWidth = 1
    const freqs = [100, 500, 1000, 5000, 10000]
    freqs.forEach(f => {
      const normX = (Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))
      const x = normX * w
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()

      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
      ctx.font = '8px monospace'
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, h - 4)
    })

    // Filter Response Curve
    const cutoffNormX = (Math.log10(filterFreq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))
    const cutoffX = Math.max(10, Math.min(w - 10, cutoffNormX * w))
    const peakNormY = Math.min(1, filterQ / 12)
    const cutoffY = h * 0.45 - peakNormY * (h * 0.35)

    // A quadratic curve never reaches its control point, so the handle used to float above the peak.
    // Offset the control point so the curve passes exactly through (cutoffX, cutoffY) at t = 0.5.
    const apexCurveTo = (ax: number, ay: number, bx: number, by: number) => {
      ctx.quadraticCurveTo(
        2 * cutoffX - (ax + bx) / 2,
        2 * cutoffY - (ay + by) / 2,
        bx,
        by
      )
    }

    ctx.beginPath()
    ctx.moveTo(0, h * 0.45)

    if (filterType === 'lowpass') {
      const ax = Math.max(0, cutoffX - 40)
      const ay = h * 0.45
      const bx = cutoffX + 50
      const by = h * 0.85
      ctx.lineTo(ax, ay)
      apexCurveTo(ax, ay, bx, by)
      ctx.lineTo(w, h * 0.95)
    } else if (filterType === 'highpass') {
      const ax = Math.max(0, cutoffX - 50)
      const ay = h * 0.85
      const bx = cutoffX + 40
      const by = h * 0.45
      ctx.lineTo(0, h * 0.95)
      ctx.lineTo(ax, ay)
      apexCurveTo(ax, ay, bx, by)
      ctx.lineTo(w, h * 0.45)
    } else {
      const ax = Math.max(0, cutoffX - 60)
      const ay = h * 0.9
      const bx = cutoffX + 60
      const by = h * 0.9
      ctx.lineTo(ax, ay)
      apexCurveTo(ax, ay, bx, by)
      ctx.lineTo(w, h * 0.9)
    }

    ctx.strokeStyle = '#51cf66'
    ctx.lineWidth = 1.8
    ctx.shadowBlur = 0
    ctx.stroke()

    // Draggable cutoff/resonance handle
    ctx.beginPath()
    ctx.arc(cutoffX, cutoffY, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#51cf66'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }, [filterFreq, filterQ, filterType])

  useEffect(() => {
    if (isVisible && !samplerMode) drawFilter()
  }, [isVisible, samplerMode, drawFilter])

  const handleFilterMouseDown = () => {
    isDraggingFilter.current = true
  }

  const handleFilterMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingFilter.current) return
    const canvas = filterCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    // Same vertical mapping the graph draws with, so the handle stays under the cursor.
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const peakNorm = Math.max(0, Math.min(1, (0.45 - yNorm) / 0.35))

    const freq = Math.round(Math.pow(10, Math.log10(20) + normX * (Math.log10(20000) - Math.log10(20))))
    const q = +(peakNorm * 12).toFixed(1)

    setFilterFreq(freq)
    setFilterQ(q)
    applySettingsToTrack({ synthFilterFreq: freq, synthFilterQ: q })
  }

  const handleFilterMouseUp = () => {
    isDraggingFilter.current = false
  }

  // Live Audition Key
  const releaseSamplerVoice = (voice: SamplerAuditionVoice, releaseSeconds = 0.12, allowTail = true) => {
    const audioCtx = Tone.getContext().rawContext as AudioContext
    const now = audioCtx.currentTime
    try {
      if (allowTail && voice.tail && now - voice.startTime >= voice.firstPassSeconds) {
        // Release-tail: fade the loop out, resume loop end -> trim end, then fade the tail.
        const { buffer, rate, tailStartSeconds, tailDurationSeconds } = voice.tail
        const fade = Math.max(0.01, sampler.release ?? 0.35)
        const tailSource = audioCtx.createBufferSource()
        tailSource.buffer = buffer
        tailSource.playbackRate.value = rate
        const tailGain = audioCtx.createGain()
        tailGain.gain.setValueAtTime(0.0001, now)
        tailGain.gain.linearRampToValueAtTime(1, now + 0.008)
        tailSource.connect(tailGain)
        tailGain.connect(voice.gain)
        tailSource.start(now, tailStartSeconds)
        tailSource.stop(now + tailDurationSeconds + fade + 0.02)
        if (voice.loopGain) {
          voice.loopGain.gain.cancelScheduledValues(now)
          voice.loopGain.gain.setValueAtTime(1, now)
          voice.loopGain.gain.linearRampToValueAtTime(0.0001, now + 0.008)
        }
        voice.source.stop(now + 0.02)
        const level = Math.max(0.0001, voice.gain.gain.value)
        voice.gain.gain.cancelScheduledValues(now)
        voice.gain.gain.setValueAtTime(level, now)
        voice.gain.gain.setValueAtTime(level, now + tailDurationSeconds)
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + tailDurationSeconds + fade)
        tailSource.onended = () => {
          try {
            tailSource.disconnect()
            tailGain.disconnect()
            voice.gain.disconnect()
          } catch (_) {}
        }
        return
      }
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds)
      voice.source.stop(now + releaseSeconds + 0.01)
    } catch (_) {}
  }

  const stopSamplerAudition = (releaseSeconds = 0.12, allowTail = true) => {
    const voice = samplerAuditionRef.current
    samplerAuditionRef.current = null
    if (voice) releaseSamplerVoice(voice, releaseSeconds, allowTail)
  }

  // Region + loop aware preview: the audition should sound like the sampler will in the grid,
  // where a held note wraps the trimmed region instead of always playing a fixed 0.8s blip.
  const createSamplerVoice = (shiftedMidi: number, velocity: number, startAt?: number): SamplerAuditionVoice | null => {
    if (!samplerBuffer) return null
    try {
      const audioCtx = Tone.getContext().rawContext as AudioContext
      const bufferToPlay = sampler.reverse ? getReversedAudioBuffer(audioCtx, samplerBuffer) : samplerBuffer
      const source = audioCtx.createBufferSource()
      source.buffer = bufferToPlay
      const semitoneDiff = shiftedMidi - (sampler.rootNote ?? 60) + (sampler.tuning ?? 0) + (sampler.fineTune ?? 0) / 100 + fineDetune / 100
      const rate = Math.pow(2, semitoneDiff / 12)
      source.playbackRate.value = rate

      const now = Math.max(audioCtx.currentTime, startAt ?? 0)
      const gainNode = audioCtx.createGain()
      const attack = Math.max(0.001, sampler.attack ?? 0.005)
      const decay = Math.max(0.01, sampler.decay ?? 0.25)
      const sustain = Math.max(0.0001, velocity * Math.max(0, Math.min(1, sampler.sustain ?? 0.6)))
      gainNode.gain.setValueAtTime(0.0001, now)
      gainNode.gain.linearRampToValueAtTime(velocity, now + attack)
      gainNode.gain.exponentialRampToValueAtTime(sustain, now + attack + decay)

      const region = resolveSamplerRegion(sampler)
      const playStartSec = region.playStart * bufferToPlay.duration
      const loopStartSec = region.loopStart * bufferToPlay.duration
      const loopEndSec = region.loopEnd * bufferToPlay.duration
      const loopMode = resolveSamplerLoopMode(sampler.loopMode)
      const firstPassSeconds = Math.max(0, loopEndSec - playStartSec) / rate
      const tailDurationSeconds = Math.max(0, region.playEnd - region.loopEnd) * bufferToPlay.duration / rate

      let loopGain: GainNode | undefined
      if (loopMode === 'releaseTail') {
        loopGain = audioCtx.createGain()
        loopGain.gain.setValueAtTime(1, now)
        source.connect(loopGain)
        loopGain.connect(gainNode)
      } else {
        source.connect(gainNode)
      }
      gainNode.connect(audioCtx.destination)

      // A held key is a long note: play the trim into the loop span, then keep wrapping it
      // until release. Short taps never reach the loop end, so they still sound one-shot.
      source.loop = true
      source.loopStart = loopStartSec
      source.loopEnd = loopEndSec
      source.start(now, playStartSec)
      return {
        source,
        gain: gainNode,
        loopGain,
        startTime: now,
        firstPassSeconds,
        tail: loopMode === 'releaseTail' && tailDurationSeconds > 0.01
          ? { buffer: bufferToPlay, rate, tailStartSeconds: loopEndSec, tailDurationSeconds }
          : undefined
      }
    } catch (err) {
      console.warn('Sampler audition error:', err)
      return null
    }
  }

  const startSamplerAudition = (shiftedMidi: number, velocity = 0.9) => {
    stopSamplerAudition(0.03, false)
    const voice = createSamplerVoice(shiftedMidi, velocity)
    if (voice) samplerAuditionRef.current = voice
  }

  // Previews are scheduled on the audio clock with a lead instead of firing on the spot: the
  // lead is what absorbs IPC/render latency so repeated hits keep a steady distance apart.
  const previewLead = () => Math.max(0, useStore.getState().studioSettings.previewLookaheadMs ?? 20) / 1000

  const handleAuditionKey = (note: string) => {
    if (!targetTrack) return
    setActiveKey(note)
    const effectiveMidi = KEYBOARD_NOTES.find(k => k.note === note)?.midi || 60
    const shiftedMidi = effectiveMidi + octave * 12 + semitone

    if (samplerMode && samplerBuffer) {
      startSamplerAudition(shiftedMidi)
      return
    }

    const noteSound = Tone.Frequency(shiftedMidi, 'midi').toNote()
    audioEngine.playNote(targetTrack.id, 'synth', noteSound, '8n', Tone.now() + previewLead(), 1, undefined, fineDetune)
    setTimeout(() => setActiveKey(null), 250)
  }

  const handleAuditionKeyUp = () => {
    setActiveKey(null)
    if (samplerMode) stopSamplerAudition()
  }

  useEffect(() => () => {
    const voice = samplerAuditionRef.current
    samplerAuditionRef.current = null
    if (voice) {
      try { voice.source.stop() } catch (_) {}
    }
  }, [])

  // Randomize Patch
  const handleRandomizePatch = () => {
    const waveforms: ('sine' | 'sawtooth' | 'square' | 'triangle' | 'custom')[] = ['sine', 'sawtooth', 'square', 'triangle', 'custom']
    const newOsc = waveforms[Math.floor(Math.random() * waveforms.length)]
    const randomPreset = MATH_FORMULA_PRESETS[Math.floor(Math.random() * MATH_FORMULA_PRESETS.length)]
    const newFormula = randomPreset.formula
    const newAttack = +(Math.random() * 0.15 + 0.005).toFixed(3)
    const newDecay = +(Math.random() * 0.8 + 0.1).toFixed(2)
    const newSustain = +(Math.random() * 0.8 + 0.1).toFixed(2)
    const newRelease = +(Math.random() * 1.2 + 0.1).toFixed(2)
    const newFreq = Math.round(Math.random() * 6000 + 400)
    const newQ = +(Math.random() * 6 + 1).toFixed(1)
    const newUnison = Math.floor(Math.random() * 4) + 1

    setOscType(newOsc)
    if (newOsc === 'custom') setSynthFormula(newFormula)
    setAttack(newAttack)
    setDecay(newDecay)
    setSustain(newSustain)
    setRelease(newRelease)
    setFilterFreq(newFreq)
    setFilterQ(newQ)
    setUnison(newUnison)

    applySettingsToTrack({
      synthOscillator: newOsc,
      synthFormula: newFormula,
      synthPartialsCount,
      synthAttack: newAttack,
      synthDecay: newDecay,
      synthSustain: newSustain,
      synthRelease: newRelease,
      synthFilterFreq: newFreq,
      synthFilterQ: newQ
    })
    useStore.getState().showToast('Randomized Synth Patch', 'success')
  }

  // Audition preview chords. Every step is booked on the audio clock up front, so the arpeggio
  // keeps its spacing even when the main thread is busy rendering the editor.
  const handlePreview = () => {
    if (!targetTrack) return
    const audioCtx = Tone.getContext().rawContext as AudioContext
    const lead = previewLead()
    const stepSeconds = 0.13
    const notes = [60, 64, 67, 72] // C4, E4, G4, C5 arpeggio
    notes.forEach((midi, idx) => {
      const shiftedMidi = midi + octave * 12 + semitone
      if (samplerMode && samplerBuffer) {
        const at = audioCtx.currentTime + lead + idx * stepSeconds
        const voice = createSamplerVoice(shiftedMidi, 0.85, at)
        if (voice) {
          setTimeout(
            () => releaseSamplerVoice(voice, 0.25),
            Math.max(0, (at + 0.65 - audioCtx.currentTime) * 1000)
          )
        }
      } else {
        const noteSound = Tone.Frequency(shiftedMidi, 'midi').toNote()
        audioEngine.playNote(
          targetTrack.id,
          'synth',
          noteSound,
          '8n',
          Tone.now() + lead + idx * stepSeconds,
          0.85,
          undefined,
          fineDetune
        )
      }
    })
  }

  // Export to .muzins
  const handleSaveMuzins = async () => {
    const patchName = targetTrack ? `${targetTrack.name}` : 'Custom_Synth'
    const muzinsData = {
      name: patchName,
      engineType: 'Synth',
      config: {
        oscillator: { type: oscType, formula: synthFormula, partialsCount: synthPartialsCount },
        envelope: { attack, decay, sustain, release, curveType: decayCurveType, tension: decayTension, formula: decayFormula },
        filter: { frequency: filterFreq, Q: filterQ, type: filterType },
        portamento,
        unison,
        detuneSpread,
        octave,
        semitone,
        fineDetune
      }
    }
    const jsonStr = JSON.stringify(muzinsData, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const filename = `${patchName.toLowerCase().replace(/\s+/g, '_')}.muzins`
    const saved = await saveFileWithDialog(blob, {
      filename,
      title: 'Save Synth Patch',
      filters: [{ name: 'MuseGrid Instrument Patch', extensions: ['muzins'] }]
    })
    if (saved) {
      useStore.getState().showToast(`Saved patch: ${patchName}.muzins`, 'success')
    }
  }

  // Reset to original factory defaults
  const handleResetToDefault = () => {
    setOscType('triangle')
    setUnison(1)
    setDetuneSpread(12)
    setOctave(0)
    setSemitone(0)
    setFineDetune(0)
    setAttack(0.004)
    setDecay(0.28)
    setSustain(0.16)
    setRelease(0.36)
    setDecayCurveType('exponential')
    setDecayTension(0)
    setDecayFormula('exp(-4.8 * x)')
    setFilterFreq(2500)
    setFilterQ(2.5)
    setFilterType('lowpass')
    setPortamento(0)
    setSamplerMode(false)
    setSampler({ ...DEFAULT_SAMPLER })
    setHasUnsavedChanges(true)
    useStore.getState().showToast('Reset working synth to defaults (Click "Save to Track" to apply)', 'info')
  }

  if (!isVisible) return null

  return (
    <div
      className="animate-modal-bg"
      style={{
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
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsVisible(false)
      }}
    >
      <div
        className="animate-modal-card"
        style={{
          width: '100%',
          maxWidth: '1120px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden',
          background: '#12131a'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.02)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: '#161822',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <IconZap size={16} color="#4dabf7" />
            </div>
            <div>
              <span style={{ fontSize: '15px', fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>
                SYNTHESIZER STUDIO
              </span>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '1px' }}>
                Sculpting Track: <strong style={{ color: targetTrack?.color || '#aaa' }}>{targetTrack?.name || 'No synth track'}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Engine Mode Toggle */}
            <div
              style={{
                display: 'flex',
                gap: '2px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '7px',
                padding: '2px'
              }}
            >
              <button
                onClick={() => setStudioMode('synth')}
                title="Wavetable / formula synthesizer engine"
                style={{
                  background: !samplerMode ? '#2b4c7e' : 'transparent',
                  border: !samplerMode ? '1px solid #4dabf7' : '1px solid transparent',
                  color: !samplerMode ? '#ffffff' : '#888',
                  borderRadius: '5px',
                  padding: '4px 10px',
                  fontSize: '10px',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                SYNTH
              </button>
              <button
                onClick={() => setStudioMode('sampler')}
                title="Single-sample chromatic sampler (one file repitched across the keyboard)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: samplerMode ? 'rgba(0, 230, 255, 0.2)' : 'transparent',
                  border: samplerMode ? '1px solid #00e6ff' : '1px solid transparent',
                  color: samplerMode ? '#ffffff' : '#888',
                  borderRadius: '5px',
                  padding: '4px 10px',
                  fontSize: '10px',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <IconWaveform size={11} /> SAMPLER
              </button>
            </div>

            {/* Preview Button */}
            <button
              onClick={handlePreview}
              title="Audition chord arpeggio preview"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                borderRadius: '6px',
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
            >
              <IconPlay size={12} fill="#fff" /> PREVIEW
            </button>

            {/* Save to Track / Testing Mode Button */}
            <button
              onClick={handleSaveToTrack}
              title="Save all custom synth/sampler settings to the project track"
              style={{
                background: hasUnsavedChanges ? 'rgba(0, 230, 255, 0.18)' : 'rgba(105, 219, 124, 0.12)',
                border: `1px solid ${hasUnsavedChanges ? '#00e6ff' : '#69db7c'}`,
                color: hasUnsavedChanges ? '#00e6ff' : '#69db7c',
                borderRadius: '6px',
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                boxShadow: hasUnsavedChanges ? '0 0 12px rgba(0, 230, 255, 0.35)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <IconSave size={13} color={hasUnsavedChanges ? '#00e6ff' : '#69db7c'} />
              {hasUnsavedChanges ? 'SAVE TO TRACK' : 'SAVED TO TRACK'}
            </button>

            {/* Reset to Default Button */}
            <button
              onClick={handleResetToDefault}
              title="Reset synth to original factory defaults"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#aaa',
                borderRadius: '6px',
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
            >
              <IconSync size={12} /> DEFAULT
            </button>

            {/* Save .muzins Button */}
            <button
              onClick={handleSaveMuzins}
              title="Export instrument preset to .muzins file"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#aaa',
                borderRadius: '6px',
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
            >
              <IconDownload size={12} /> SAVE .MUZINS
            </button>

            {/* Preset Selector */}
            {!samplerMode && (
            <select
              value={targetTrack?.synthPreset || 'piano'}
              onChange={e => applyPreset(e.target.value as SynthPreset)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px',
                fontWeight: 700,
                borderRadius: '6px',
                padding: '6px 10px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {SYNTH_PRESETS.map(p => (
                <option key={p.value} value={p.value} style={{ background: '#12141c', color: 'white' }}>
                  {p.label}
                </option>
              ))}
            </select>
            )}

            {/* Randomize Button */}
            {!samplerMode && (
            <button
              onClick={handleRandomizePatch}
              title="Randomize sound design parameters"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#aaa',
                borderRadius: '6px',
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
            >
              <IconShuffle size={12} /> RANDOM
            </button>
            )}

            {/* Close Button */}
            <button
              onClick={() => setIsVisible(false)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#aaa',
                borderRadius: '6px',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* Studio Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {!samplerMode && (
          <>
          {/* Top Row: Waveform Visualizer & Oscillator Controls */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1fr',
              gap: '16px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              padding: '16px'
            }}
          >
            {/* Animated Canvas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#00e6ff', letterSpacing: '0.04em' }}>
                  WAVETABLE OSCILLATOR A
                </span>
                <span style={{ fontSize: '10px', color: '#666', fontFamily: 'monospace' }}>
                  {unison > 1 ? `${unison} Voices Supersaw` : 'Mono Cycle'}
                </span>
              </div>
              <div style={{ height: '140px', background: '#090a10', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <canvas ref={waveformCanvasRef} width={500} height={140} style={{ width: '100%', height: '100%' }} />
              </div>
            </div>

            {/* Waveform & Unison Tuning */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '10px', fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>
                  Waveform Geometry
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                  {(['sine', 'triangle', 'sawtooth', 'square', 'custom'] as const).map(w => (
                    <button
                      key={w}
                      onClick={() => {
                        setOscType(w)
                        applySettingsToTrack({ synthOscillator: w, synthFormula, synthPartialsCount })
                      }}
                      style={{
                        background: oscType === w ? '#2b4c7e' : 'rgba(255, 255, 255, 0.05)',
                        color: oscType === w ? '#ffffff' : '#bbb',
                        border: oscType === w ? '1px solid #4dabf7' : '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '6px 4px',
                        fontSize: '10px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {w === 'custom' ? 'Formula f(t)' : w}
                    </button>
                  ))}
                </div>

                {/* Custom Math Formula Expression Editor */}
                {oscType === 'custom' && (
                  <div
                    style={{
                      marginTop: '8px',
                      background: 'rgba(0, 230, 255, 0.04)',
                      border: '1px solid rgba(0, 230, 255, 0.2)',
                      borderRadius: '8px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: '#00e6ff', fontWeight: 800, letterSpacing: '0.04em' }}>
                        MATHEMATICAL FORMULA f(t)
                      </span>
                      <span style={{ fontSize: '9px', color: '#888' }}>
                        t = phase (0 to 2*PI). Math.* functions available
                      </span>
                    </div>

                    <input
                      type="text"
                      value={synthFormula}
                      onChange={e => {
                        const val = e.target.value
                        setSynthFormula(val)
                        applySettingsToTrack({ synthOscillator: 'custom', synthFormula: val, synthPartialsCount })
                      }}
                      placeholder="e.g. sin(t) + 0.6 * sin(3*t) + tanh(sin(2*t))"
                      style={{
                        background: '#0a0c14',
                        color: '#00e6ff',
                        border: '1px solid rgba(0, 230, 255, 0.35)',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box'
                      }}
                    />

                    {/* Quick Formula Presets */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {MATH_FORMULA_PRESETS.map(p => (
                        <button
                          key={p.name}
                          onClick={() => {
                            setSynthFormula(p.formula)
                            applySettingsToTrack({ synthOscillator: 'custom', synthFormula: p.formula, synthPartialsCount })
                          }}
                          title={p.description}
                          style={{
                            background: synthFormula === p.formula ? 'rgba(0, 230, 255, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                            border: `1px solid ${synthFormula === p.formula ? '#00e6ff' : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: '4px',
                            color: synthFormula === p.formula ? '#ffffff' : '#aaa',
                            fontSize: '9px',
                            fontWeight: 600,
                            padding: '3px 7px',
                            cursor: 'pointer',
                            transition: 'all 0.12s ease'
                          }}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>

                    {/* Harmonics Resolution */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                      <span style={{ fontSize: '9px', color: '#888' }}>
                        Harmonics Resolution: <strong style={{ color: '#00e6ff' }}>{synthPartialsCount} partials</strong>
                      </span>
                      <AppSlider
                        value={synthPartialsCount}
                        min={4}
                        max={64}
                        step={2}
                        color="#00e6ff"
                        width="130px"
                        onChange={count => {
                          setSynthPartialsCount(count)
                          applySettingsToTrack({ synthOscillator: 'custom', synthFormula, synthPartialsCount: count })
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', fontWeight: 700, marginBottom: '4px' }}>
                    <span>UNISON VOICES</span>
                    <span style={{ color: '#00e6ff' }}>{unison}x</span>
                  </div>
                  <AppSlider value={unison} min={1} max={8} step={1} color="#00e6ff" onChange={setUnison} />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', fontWeight: 700, marginBottom: '4px' }}>
                    <span>DETUNE SPREAD</span>
                    <span style={{ color: '#00e6ff' }}>{detuneSpread}c</span>
                  </div>
                  <AppSlider value={detuneSpread} min={0} max={50} step={1} color="#00e6ff" onChange={setDetuneSpread} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', fontWeight: 700 }}>OCTAVE</div>
                  <input
                    type="number"
                    min={-2}
                    max={2}
                    value={octave}
                    onChange={e => setOctave(+e.target.value)}
                    style={{ width: '100%', background: '#13151f', border: '1px solid rgba(255,255,255,0.08)', color: 'white', borderRadius: '4px', padding: '4px', fontSize: '11px', textAlign: 'center' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', fontWeight: 700 }}>SEMITONE</div>
                  <input
                    type="number"
                    min={-12}
                    max={12}
                    value={semitone}
                    onChange={e => setSemitone(+e.target.value)}
                    style={{ width: '100%', background: '#13151f', border: '1px solid rgba(255,255,255,0.08)', color: 'white', borderRadius: '4px', padding: '4px', fontSize: '11px', textAlign: 'center' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', fontWeight: 700 }}>GLIDE (PORTA)</div>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={portamento}
                    onChange={e => {
                      const v = +e.target.value
                      setPortamento(v)
                      applySettingsToTrack({ synthPortamento: v })
                    }}
                    style={{ width: '100%', background: '#13151f', border: '1px solid rgba(255,255,255,0.08)', color: 'white', borderRadius: '4px', padding: '4px', fontSize: '11px', textAlign: 'center' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Middle Row: Interactive ADSR Graph & Filter Response Curve */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* ADSR Envelope Visualizer */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#ff3366', letterSpacing: '0.04em' }}>
                  AMP ENVELOPE (ADSR)
                </span>
                <span style={{ fontSize: '10px', color: '#888' }}>
                  Drag nodes on graph
                </span>
              </div>

              <div style={{ height: '140px', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255, 51, 102, 0.15)', cursor: 'crosshair' }}>
                <canvas
                  ref={adsrCanvasRef}
                  width={500}
                  height={140}
                  onMouseDown={handleADSRMouseDown}
                  onMouseMove={handleADSRMouseMove}
                  onMouseUp={handleADSRMouseUp}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>

              {/* Sliders row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '9px', color: '#888', fontWeight: 700 }}>ATTACK</div>
                  <div style={{ fontSize: '11px', color: '#ff3366', fontWeight: 800 }}>{attack.toFixed(3)}s</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#888', fontWeight: 700 }}>DECAY</div>
                  <div style={{ fontSize: '11px', color: '#ff3366', fontWeight: 800 }}>{decay.toFixed(2)}s</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#888', fontWeight: 700 }}>SUSTAIN</div>
                  <div style={{ fontSize: '11px', color: '#ff3366', fontWeight: 800 }}>{sustain.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#888', fontWeight: 700 }}>RELEASE</div>
                  <div style={{ fontSize: '11px', color: '#ff3366', fontWeight: 800 }}>{release.toFixed(2)}s</div>
                </div>
              </div>

              {/* ALIEN QUANTUM ENVELOPE CURVE MATRIX */}
              <div
                style={{
                  marginTop: '6px',
                  background: 'rgba(0, 230, 255, 0.04)',
                  border: '1px solid rgba(0, 230, 255, 0.25)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)'
                }}
              >
                {/* Header with Alien Badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', fontWeight: 900, color: '#00e6ff', letterSpacing: '0.06em' }}>
                    ALIEN CURVE WARP MATRIX
                  </span>
                  <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#00ff88', background: 'rgba(0, 255, 136, 0.1)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(0, 255, 136, 0.2)' }}>
                    256-PT ZERO-LATENCY LUT
                  </span>
                </div>

                {/* Curve Type Selector Pills */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                  {(['exponential', 'linear', 'logarithmic', 'scurve', 'custom'] as const).map(ct => {
                    const isSelected = decayCurveType === ct
                    const labels: Record<string, string> = {
                      exponential: 'ACOUSTIC EXP',
                      linear: 'LINEAR',
                      logarithmic: 'LOG PUNCH',
                      scurve: 'SIGMOID S',
                      custom: 'NEURAL f(x)'
                    }
                    return (
                      <button
                        key={ct}
                        onClick={() => {
                          setDecayCurveType(ct)
                          applySettingsToTrack({ synthDecayCurveType: ct, synthDecayTension: decayTension, synthDecayFormula: decayFormula })
                        }}
                        style={{
                          background: isSelected ? '#2b4c7e' : 'rgba(255, 255, 255, 0.04)',
                          color: isSelected ? '#ffffff' : '#bbb',
                          border: `1px solid ${isSelected ? '#4dabf7' : 'rgba(255, 255, 255, 0.08)'}`,
                          borderRadius: '5px',
                          padding: '5px 2px',
                          fontSize: '9px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {labels[ct]}
                      </button>
                    )
                  })}
                </div>

                {/* Continuous Tension Morphing Slider */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#888', fontWeight: 700, marginBottom: '3px' }}>
                    <span style={{ color: '#00e6ff' }}>WARP TENSION</span>
                    <span style={{ fontFamily: 'monospace', color: '#ffffff' }}>
                      {decayTension > 0 ? `+${decayTension.toFixed(2)}` : decayTension.toFixed(2)}
                      {' '}({decayTension < -0.2 ? 'Steep Exp' : decayTension > 0.2 ? 'Log Bulge' : 'Linear/Natural'})
                    </span>
                  </div>
                  <AppSlider
                    value={decayTension}
                    min={-1}
                    max={1}
                    step={0.02}
                    color="#00e6ff"
                    onChange={t => {
                      setDecayTension(t)
                      applySettingsToTrack({ synthDecayCurveType: decayCurveType, synthDecayTension: t, synthDecayFormula: decayFormula })
                    }}
                  />
                </div>

                {/* Custom Expression Editor f(x) (Always accessible or when custom selected) */}
                {decayCurveType === 'custom' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '9px', fontWeight: 800, color: '#00ff88', letterSpacing: '0.04em' }}>
                        MATHEMATICAL FORMULA f(x)
                      </span>
                      <span style={{ fontSize: '8px', color: '#777', fontFamily: 'monospace' }}>
                        x ∈ [0, 1] • Math.* in scope
                      </span>
                    </div>

                    <input
                      type="text"
                      value={decayFormula}
                      onChange={e => {
                        const val = e.target.value
                        setDecayFormula(val)
                        applySettingsToTrack({ synthDecayCurveType: 'custom', synthDecayTension: decayTension, synthDecayFormula: val })
                      }}
                      placeholder="e.g. exp(-4.8 * x) or pow(1 - x, 3)"
                      style={{
                        background: '#090a10',
                        color: '#00ff88',
                        border: '1px solid rgba(0, 255, 136, 0.35)',
                        borderRadius: '6px',
                        padding: '5px 8px',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box'
                      }}
                    />

                    {/* Quick Formula Presets */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {CURVE_FORMULA_PRESETS.map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setDecayFormula(p.formula)
                            applySettingsToTrack({ synthDecayCurveType: 'custom', synthDecayTension: decayTension, synthDecayFormula: p.formula })
                          }}
                          title={p.description}
                          style={{
                            background: decayFormula === p.formula ? 'rgba(0, 255, 136, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                            border: `1px solid ${decayFormula === p.formula ? '#00ff88' : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: '4px',
                            color: decayFormula === p.formula ? '#ffffff' : '#aaa',
                            fontSize: '8px',
                            fontWeight: 700,
                            padding: '3px 6px',
                            cursor: 'pointer',
                            transition: 'all 0.12s ease'
                          }}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Filter Visualizer */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#69db7c', letterSpacing: '0.04em' }}>
                  FILTER RESPONSE CURVE
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(['lowpass', 'highpass', 'bandpass'] as const).map(ft => (
                    <button
                      key={ft}
                      onClick={() => setFilterType(ft)}
                      style={{
                        background: filterType === ft ? '#69db7c' : 'rgba(255, 255, 255, 0.05)',
                        color: filterType === ft ? '#000000' : '#888',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '9px',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        cursor: 'pointer'
                      }}
                    >
                      {ft === 'lowpass' ? 'LP' : ft === 'highpass' ? 'HP' : 'BP'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ height: '140px', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(105, 219, 124, 0.15)', cursor: 'crosshair' }}>
                <canvas
                  ref={filterCanvasRef}
                  width={500}
                  height={140}
                  onMouseDown={handleFilterMouseDown}
                  onMouseMove={handleFilterMouseMove}
                  onMouseUp={handleFilterMouseUp}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '9px', color: '#888', fontWeight: 700 }}>CUTOFF</div>
                  <div style={{ fontSize: '11px', color: '#69db7c', fontWeight: 800 }}>{filterFreq} Hz</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#888', fontWeight: 700 }}>RESONANCE (Q)</div>
                  <div style={{ fontSize: '11px', color: '#69db7c', fontWeight: 800 }}>{filterQ}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#888', fontWeight: 700 }}>DRIVE</div>
                  <div style={{ fontSize: '11px', color: '#69db7c', fontWeight: 800 }}>{(filterDrive * 100).toFixed(0)}%</div>
                </div>
              </div>
            </div>
          </div>
          </>
          )}

          {samplerMode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Sample Source Row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.2fr 1fr',
                  gap: '16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '12px',
                  padding: '16px'
                }}
              >
                {/* Waveform + drop zone */}
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                  onDragOver={e => { e.preventDefault(); setSamplerDragOver(true) }}
                  onDragLeave={() => setSamplerDragOver(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setSamplerDragOver(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) void loadSamplerFile(file)
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#00e6ff', letterSpacing: '0.04em' }}>
                      SAMPLE SOURCE · CHROMATIC MAP
                    </span>
                    <span style={{ fontSize: '10px', color: '#666', fontFamily: 'monospace' }}>
                      {samplerBuffer ? `${samplerBuffer.duration.toFixed(2)}s · ${samplerBuffer.sampleRate / 1000}kHz · ${midiToNoteName(sampler.rootNote)} root` : 'no sample loaded'}
                    </span>
                  </div>
                  <div
                    style={{
                      height: '140px',
                      background: '#090a10',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: `1px solid ${samplerDragOver ? '#00e6ff' : 'rgba(255, 255, 255, 0.08)'}`,
                      boxShadow: samplerDragOver ? '0 0 18px rgba(0, 230, 255, 0.35)' : 'none',
                      cursor: samplerBuffer ? 'crosshair' : 'default'
                    }}
                  >
                    <canvas
                      ref={samplerCanvasRef}
                      width={500}
                      height={140}
                      onMouseDown={e => handleSamplerWavePointer(e, 'down')}
                      onMouseMove={e => handleSamplerWavePointer(e, 'move')}
                      onMouseUp={() => { samplerDragEdge.current = null }}
                      onMouseLeave={() => { samplerDragEdge.current = null }}
                      style={{ width: '100%', height: '100%' }}
                    />
                  </div>
                  <div style={{ fontSize: '9px', color: '#666' }}>
                    Drag the dashed markers to trim start / end. One file is repitched across the whole keyboard at 2^((note − {midiToNoteName(sampler.rootNote)}) / 12).
                  </div>
                </div>

                {/* Loader */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>
                      Audio File / Voice Mic
                    </label>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <button
                        onClick={() => samplerFileInputRef.current?.click()}
                        style={{
                          background: 'rgba(0, 230, 255, 0.12)',
                          border: '1px solid rgba(0, 230, 255, 0.4)',
                          color: '#ffffff',
                          borderRadius: '6px',
                          padding: '7px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        <IconUpload size={12} color="#00e6ff" /> BROWSE
                      </button>
                      <button
                        onClick={isRecordingMic ? stopMicRecording : startMicRecording}
                        style={{
                          background: isRecordingMic ? 'rgba(255, 77, 77, 0.22)' : 'rgba(255, 77, 77, 0.10)',
                          border: `1px solid ${isRecordingMic ? '#ff4d4d' : 'rgba(255, 77, 77, 0.35)'}`,
                          color: isRecordingMic ? '#ff4d4d' : '#ff8787',
                          borderRadius: '6px',
                          padding: '7px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          boxShadow: isRecordingMic ? '0 0 12px rgba(255, 77, 77, 0.45)' : 'none',
                          transition: 'all 0.15s ease'
                        }}
                        title={isRecordingMic ? "Click to stop recording and map voice chromatically" : "Record live voice or acoustic sound from microphone"}
                      >
                        <IconMic size={12} color={isRecordingMic ? '#ff4d4d' : '#ff8787'} />
                        {isRecordingMic ? `STOP (${micSeconds}s)` : 'RECORD MIC'}
                      </button>
                      <input
                        ref={samplerFileInputRef}
                        type="file"
                        accept="audio/*,.wav,.aiff,.mp3,.ogg,.flac"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (file) void loadSamplerFile(file)
                          e.target.value = ''
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          fontSize: '10px',
                          color: sampler.name ? '#fff' : '#666',
                          background: '#0a0c14',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '6px',
                          padding: '7px 10px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {sampler.name || 'drop file here'}
                      </span>
                      {sampler.audioBase64 && (
                        <button
                          onClick={() => commitSampler({ name: '', audioBase64: undefined })}
                          title="Unload sample"
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#aaa',
                            borderRadius: '6px',
                            padding: '7px 8px',
                            fontSize: '10px',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          <IconX size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>
                      Root Note Presets
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {CHROMATIC_SAMPLE_PRESETS.map(p => (
                        <button
                          key={p.id}
                          onClick={() => void loadSamplerPreset(p)}
                          title={`${p.description} · root ${midiToNoteName(p.rootNote)}`}
                          style={{
                            background: sampler.name === p.name ? 'rgba(0, 230, 255, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                            border: `1px solid ${sampler.name === p.name ? '#00e6ff' : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: '4px',
                            color: sampler.name === p.name ? '#ffffff' : '#aaa',
                            fontSize: '9px',
                            fontWeight: 600,
                            padding: '4px 7px',
                            cursor: 'pointer',
                            transition: 'all 0.12s ease'
                          }}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <SamplerPill label="Loop while held" active={!!sampler.loop} onClick={() => commitSampler({ loop: !sampler.loop })} />
                    <SamplerPill label="Reverse" active={!!sampler.reverse} accent="#ff3366" onClick={() => commitSampler({ reverse: !sampler.reverse })} />
                  </div>

                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>
                      Loop Mode
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <SamplerPill
                        label="Sustain"
                        active={resolveSamplerLoopMode(sampler.loopMode) === 'sustain'}
                        title="The green span repeats until the note lets go"
                        onClick={() => commitSampler({ loopMode: 'sustain' })}
                      />
                      <SamplerPill
                        label="Release tail"
                        active={resolveSamplerLoopMode(sampler.loopMode) === 'releaseTail'}
                        accent="#69db7c"
                        title="On note off, resume from loop end to the trim end"
                        onClick={() => commitSampler({ loopMode: 'releaseTail' })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Pitch / Region / Envelope / Output Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <SamplerCard title="PITCH" accent="#00e6ff" hint="repitch map">
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', fontWeight: 700, marginBottom: '4px' }}>
                      <span>ROOT NOTE</span>
                      <span style={{ color: '#00e6ff', fontFamily: 'monospace' }}>{midiToNoteName(sampler.rootNote)}</span>
                    </div>
                    <AppSlider value={sampler.rootNote} min={21} max={108} step={1} color="#00e6ff" onChange={v => commitSampler({ rootNote: v })} />
                  </div>
                  <SamplerSlider label="TUNING" value={sampler.tuning} min={-24} max={24} step={1} display={`${sampler.tuning > 0 ? '+' : ''}${sampler.tuning} st`} onChange={v => commitSampler({ tuning: v })} />
                  <SamplerSlider label="FINE TUNE" value={sampler.fineTune} min={-100} max={100} step={1} display={`${sampler.fineTune > 0 ? '+' : ''}${sampler.fineTune} ct`} onChange={v => commitSampler({ fineTune: v })} />
                </SamplerCard>

                <SamplerCard title="PLAYBACK" accent="#4dabf7" hint="trim + loop">
                  <SamplerSlider
                    label="START OFFSET"
                    value={sampler.startOffset}
                    min={0}
                    max={0.99}
                    step={0.01}
                    display={`${(sampler.startOffset * 100).toFixed(0)}%`}
                    accent="#4dabf7"
                    onChange={v => commitSampler({ startOffset: Math.min(v, sampler.endOffset - 0.01) })}
                  />
                  <SamplerSlider
                    label="END OFFSET"
                    value={sampler.endOffset}
                    min={0.01}
                    max={1}
                    step={0.01}
                    display={`${(sampler.endOffset * 100).toFixed(0)}%`}
                    accent="#4dabf7"
                    onChange={v => commitSampler({ endOffset: Math.max(v, sampler.startOffset + 0.01) })}
                  />
                  <SamplerSlider
                    label="LOOP START"
                    value={sampler.loopStartOffset ?? sampler.startOffset}
                    min={sampler.startOffset}
                    max={sampler.endOffset}
                    step={0.005}
                    display={`${((sampler.loopStartOffset ?? sampler.startOffset) * 100).toFixed(1)}%`}
                    accent="#69db7c"
                    onChange={v => commitSampler({ loopStartOffset: v })}
                  />
                  <SamplerSlider
                    label="LOOP END"
                    value={sampler.loopEndOffset ?? sampler.endOffset}
                    min={sampler.startOffset}
                    max={sampler.endOffset}
                    step={0.005}
                    display={`${((sampler.loopEndOffset ?? sampler.endOffset) * 100).toFixed(1)}%`}
                    accent="#69db7c"
                    onChange={v => commitSampler({ loopEndOffset: v })}
                  />
                  <div style={{ fontSize: '9px', color: '#666', fontFamily: 'monospace' }}>
                    trim {((sampler.endOffset - sampler.startOffset) * (samplerBuffer?.duration || 0)).toFixed(3)}s
                    {' · '}loop {(((sampler.loopEndOffset ?? sampler.endOffset) - (sampler.loopStartOffset ?? sampler.startOffset)) * (samplerBuffer?.duration || 0)).toFixed(3)}s
                    {resolveSamplerLoopMode(sampler.loopMode) === 'releaseTail' && (
                      <>{' · '}tail {(Math.max(0, sampler.endOffset - (sampler.loopEndOffset ?? sampler.endOffset)) * (samplerBuffer?.duration || 0)).toFixed(3)}s</>
                    )}
                  </div>
                </SamplerCard>

                <SamplerCard title="AMP ENVELOPE" accent="#ff3366" hint="per voice">
                  <SamplerSlider label="ATTACK" value={sampler.attack ?? 0.005} min={0.001} max={2} step={0.001} display={`${(sampler.attack ?? 0.005).toFixed(3)}s`} accent="#ff3366" onChange={v => commitSampler({ attack: v })} />
                  <SamplerSlider label="DECAY" value={sampler.decay ?? 0.25} min={0.01} max={5} step={0.01} display={`${(sampler.decay ?? 0.25).toFixed(2)}s`} accent="#ff3366" onChange={v => commitSampler({ decay: v })} />
                  <SamplerSlider label="SUSTAIN" value={sampler.sustain ?? 0.6} min={0} max={1} step={0.01} display={(sampler.sustain ?? 0.6).toFixed(2)} accent="#ff3366" onChange={v => commitSampler({ sustain: v })} />
                  <SamplerSlider label="RELEASE" value={sampler.release ?? 0.35} min={0.01} max={5} step={0.01} display={`${(sampler.release ?? 0.35).toFixed(2)}s`} accent="#ff3366" onChange={v => commitSampler({ release: v })} />
                </SamplerCard>

                <SamplerCard title="OUTPUT" accent="#69db7c" hint="per voice">
                  <SamplerSlider label="VOLUME" value={sampler.volume ?? 1} min={0} max={2} step={0.01} display={(sampler.volume ?? 1).toFixed(2)} accent="#69db7c" onChange={v => commitSampler({ volume: v })} />
                  <SamplerSlider label="PAN" value={sampler.pan ?? 0} min={-1} max={1} step={0.01} display={(sampler.pan ?? 0).toFixed(2)} accent="#69db7c" onChange={v => commitSampler({ pan: v })} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', color: '#666' }}>
                    <IconLoop size={11} color="#69db7c" />
                    {sampler.loop
                      ? (resolveSamplerLoopMode(sampler.loopMode) === 'releaseTail'
                        ? 'Loops until note off, then plays loop end → trim end'
                        : 'Loops the green span until note off')
                      : 'Plays trim once; long notes repeat the green loop span'}
                  </div>
                </SamplerCard>
              </div>
            </div>
          )}

          {/* Bottom Section: 2-Octave Audition Keyboard */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#ffcc00', letterSpacing: '0.04em' }}>
                LIVE AUDITION KEYBOARD
              </span>
              <span style={{ fontSize: '10px', color: '#666' }}>
                {samplerMode && samplerBuffer
                  ? 'Hold keys to preview: trim plays once, then the green loop span repeats (LOOP holds it)'
                  : 'Click keys to test your synth patch in real time'}
              </span>
            </div>

            <div style={{ display: 'flex', position: 'relative', height: '100px', width: '100%', userSelect: 'none' }}>
              {KEYBOARD_NOTES.map(k => {
                const isPressed = activeKey === k.note
                if (!k.isBlack) {
                  return (
                    <button
                      key={k.note}
                      onPointerDown={e => { e.preventDefault(); handleAuditionKey(k.note) }}
                      onPointerUp={handleAuditionKeyUp}
                      onPointerLeave={handleAuditionKeyUp}
                      onPointerCancel={handleAuditionKeyUp}
                      style={{
                        flex: 1,
                        height: '100%',
                        background: isPressed ? '#00e6ff' : '#ffffff',
                        border: '1px solid #1a1a24',
                        borderRadius: '0 0 5px 5px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-end',
                        paddingBottom: '6px',
                        alignItems: 'center',
                        fontSize: '9px',
                        fontWeight: 700,
                        color: isPressed ? '#000' : '#888',
                        zIndex: 1,
                        boxShadow: isPressed ? '0 0 12px #00e6ff' : 'none',
                        transition: 'background 0.08s'
                      }}
                    >
                      {k.note}
                    </button>
                  )
                }
                return (
                  <button
                    key={k.note}
                    onPointerDown={e => { e.preventDefault(); handleAuditionKey(k.note) }}
                    onPointerUp={handleAuditionKeyUp}
                    onPointerLeave={handleAuditionKeyUp}
                    onPointerCancel={handleAuditionKeyUp}
                    style={{
                      width: '24px',
                      height: '60px',
                      background: isPressed ? '#ff3366' : '#141620',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '0 0 4px 4px',
                      position: 'relative',
                      marginLeft: '-12px',
                      marginRight: '-12px',
                      zIndex: 2,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      paddingBottom: '4px',
                      alignItems: 'center',
                      fontSize: '8px',
                      color: isPressed ? '#fff' : '#aaa',
                      boxShadow: isPressed ? '0 0 12px #ff3366' : '0 4px 8px rgba(0,0,0,0.6)',
                      transition: 'background 0.08s'
                    }}
                  >
                    {k.note}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
