import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../engine/store'
import * as ort from 'onnxruntime-web'
// @ts-ignore
import { DemucsProcessor, CONSTANTS, type DemucsProcessorProgressInfo, type DemucsProcessorLogPhase } from 'demucs-web'
import { IconMic, IconDrum, IconSpeaker, IconMusic, IconDownload, IconTimeline, IconHeadphones } from './Icons'
import JSZip from 'jszip'
import { audioBufferToWav } from '../utils/wavEncoder'
import { transcribeAudio } from '../utils/aiLab'
import { type Note } from '../engine/store'
import { DEFAULT_SYNTH_PRESET } from '../utils/instruments'
import { audioEngine } from '../engine/AudioEngine'
import { saveFileWithDialog } from '../utils/fileExport'

function newId() {
  return Math.random().toString(36).substr(2, 9)
}

// Local caching removed in favor of offline bundled models

function buttonStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: '8px',
    border: `1px solid ${color}44`,
    borderRadius: '5px',
    background: `${color}12`,
    color,
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px'
  }
}

// Need to set correct path for ONNX WASM binaries if they are bundled or hosted.
// For now, we rely on the default behavior of onnxruntime-web.

export default function StemSplitterPane() {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [fileName, setFileName] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [isImporting, setIsImporting] = useState<string | null>(null)
  const [separationMode, setSeparationMode] = useState<'4-stem' | '2-stem'>('4-stem')
  const [executionBackend, setExecutionBackend] = useState<'wasm' | 'webgpu'>('wasm')
  const [isTranscribing, setIsTranscribing] = useState<string | null>(null)
  
  // Stems available for import
  const [separatedStems, setSeparatedStems] = useState<{
    drums?: AudioBuffer
    bass?: AudioBuffer
    other?: AudioBuffer
    vocals?: AudioBuffer
    instrumental?: AudioBuffer // Used for 2-stem mode
  }>({})
  
  // Stems selected for ZIP export
  const [selectedForExport, setSelectedForExport] = useState<Record<string, boolean>>({})
  const [isZipping, setIsZipping] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<DemucsProcessor | null>(null)

  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(console.error)
      }
      // Clean up processor if it supports it
      if (processorRef.current && typeof (processorRef.current as any).terminate === 'function') {
        (processorRef.current as any).terminate()
      }
    }
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setSeparatedStems({})
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioCtx({ sampleRate: CONSTANTS.SAMPLE_RATE })
      audioCtxRef.current = ctx
      const arrayBuffer = await file.arrayBuffer()
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      setAudioBuffer(decoded)
    } catch (err) {
      console.error(err)
      useStore.getState().showToast("Failed to decode audio file", "error")
    }
  }

  const handleProcess = async () => {
    if (!audioBuffer) return
    setIsProcessing(true)
    setProgress(0)
    setStatusText('Initializing Model...')
    setSeparatedStems({})

    try {
      // Initialize Demucs
      const processor = new DemucsProcessor({
        ort,
        sessionOptions: {
          executionProviders: [executionBackend]
        },
        onProgress: (info: { progress: number; currentSegment: number; totalSegments: number }) => {
          setProgress(info.progress * 100)
          setStatusText(`Processing Segment ${info.currentSegment}/${info.totalSegments}`)
        },
        onLog: (phase: string, msg: string) => {
          console.log(`[${phase}] ${msg}`)
        },
        onDownloadProgress: (loaded: number, total: number) => {
          const p = total > 0 ? (loaded / total) * 100 : 100;
          setProgress(p)
          setStatusText(`Downloading AI Model (${(loaded/1024/1024).toFixed(1)}MB)`)
        }
      })
      processorRef.current = processor

      setStatusText('Loading AI Model...')
      
      const response = await fetch('/ai_models/demucs/htdemucs_embedded.onnx')
      if (!response.ok) {
        throw new Error('Failed to load bundled Demucs model')
      }
      
      const cachedBuffer = await response.arrayBuffer()

      setStatusText('Loading AI Model...')
      await processor.loadModel(cachedBuffer)

      setStatusText('Separating Stems...')
      const leftChannel = audioBuffer.getChannelData(0)
      const rightChannel = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel

      const result = await processor.separate(leftChannel, rightChannel)

      setStatusText('Finalizing...')
      
      // Convert Float32Arrays back to AudioBuffers
      const createBuffer = (left: Float32Array, right: Float32Array) => {
        const ctx = audioCtxRef.current
        if (!ctx) return null
        const buf = ctx.createBuffer(2, left.length, CONSTANTS.SAMPLE_RATE)
        buf.copyToChannel(new Float32Array(left), 0)
        buf.copyToChannel(new Float32Array(right), 1)
        return buf
      }

      if (separationMode === '2-stem') {
        // Merge drums, bass, and other into "instrumental"
        const len = result.vocals.left.length
        const mergedLeft = new Float32Array(len)
        const mergedRight = new Float32Array(len)
        for (let i = 0; i < len; i++) {
          mergedLeft[i] = result.drums.left[i] + result.bass.left[i] + result.other.left[i]
          mergedRight[i] = result.drums.right[i] + result.bass.right[i] + result.other.right[i]
        }
        setSeparatedStems({
          vocals: createBuffer(result.vocals.left, result.vocals.right) || undefined,
          instrumental: createBuffer(mergedLeft, mergedRight) || undefined
        })
        setSelectedForExport({ vocals: true, instrumental: true })
      } else {
        setSeparatedStems({
          drums: createBuffer(result.drums.left, result.drums.right) || undefined,
          bass: createBuffer(result.bass.left, result.bass.right) || undefined,
          other: createBuffer(result.other.left, result.other.right) || undefined,
          vocals: createBuffer(result.vocals.left, result.vocals.right) || undefined,
        })
        setSelectedForExport({ drums: true, bass: true, other: true, vocals: true })
      }

      setStatusText('Done!')
      setProgress(100)
      useStore.getState().showToast("Stem separation complete!", "success")

    } catch (err) {
      console.error(err)
      useStore.getState().showToast("Error processing audio. Check console.", "error")
      setStatusText('Error occurred')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleImportStem = (name: string, buffer: AudioBuffer | undefined) => {
    if (!buffer) return
    setIsImporting(name)
    
    // Determine target track: Active track, or first track
    const state = useStore.getState()
    const targetTrackId = state.activeTrackId || (state.tracks.length > 0 ? state.tracks[0].id : null)

    setTimeout(() => {
      state.setShowImportAudioModal(true, targetTrackId, buffer)
      setIsImporting(null)
    }, 50)
  }

  const handleTranscribeStem = async (name: string, buffer: AudioBuffer | undefined) => {
    if (!buffer) return
    setIsTranscribing(name)
    try {
      const store = useStore.getState()
      const bpm = store.bpm
      const generatedNotes = await transcribeAudio(buffer, bpm)
      
      if (generatedNotes.length === 0) {
        store.showToast(`No notes detected in ${name} stem.`, 'info')
        return
      }

      store.commitHistory()
      const newTrackId = newId()
      
      store.addTrack({
        id: newTrackId,
        name: `${name} (MIDI)`,
        instrument: 'synth',
        color: '#ff922b', // Orange for transcribed
        synthPreset: DEFAULT_SYNTH_PRESET,
        volume: 100,
        pan: 0,
        muted: false,
        soloed: false,
      })
      
      audioEngine.createInstrument(newTrackId, 'synth')
      
      generatedNotes.forEach((n: Note) => {
        n.trackId = newTrackId
        store.addNote(n)
      })
      
      store.showToast(`Transcribed ${name} to MIDI!`, 'success')
      
    } catch (err) {
      console.error(err)
      useStore.getState().showToast(`Failed to transcribe ${name}`, 'error')
    } finally {
      setIsTranscribing(null)
    }
  }

  const handleSaveZip = async () => {
    setIsZipping(true)
    try {
      const zip = new JSZip()
      
      const addStem = async (name: string, buffer: AudioBuffer | undefined) => {
        if (!buffer || !selectedForExport[name]) return
        const wavData = audioBufferToWav(buffer)
        zip.file(`${name}.wav`, new Blob([wavData], { type: 'audio/wav' }))
      }

      await Promise.all([
        addStem('vocals', separatedStems.vocals),
        addStem('drums', separatedStems.drums),
        addStem('bass', separatedStems.bass),
        addStem('other', separatedStems.other),
        addStem('instrumental', separatedStems.instrumental)
      ])

      const content = await zip.generateAsync({ type: 'blob' })
      const baseName = fileName ? fileName.replace(/\.[^/.]+$/, "") : "audio"
      const filename = `${baseName}_stems.zip`
      const saved = await saveFileWithDialog(content, {
        filename,
        title: 'Save Stems Archive',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      })
      if (saved) {
        useStore.getState().showToast(`Saved stems archive: ${filename}`, 'success')
      }
    } catch (e) {
      console.error(e)
      useStore.getState().showToast("Failed to create ZIP file", "error")
    } finally {
      setIsZipping(false)
    }
  }

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.4' }}>
        Extract vocals, drums, or instruments directly from any audio file using AI.
      </p>

      {/* File Upload Area */}
      <div 
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        style={{
          border: '2px dashed rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '24px 12px',
          textAlign: 'center',
          cursor: isProcessing ? 'not-allowed' : 'pointer',
          background: 'rgba(0,0,0,0.2)',
          transition: 'border-color 0.2s',
          opacity: isProcessing ? 0.5 : 1
        }}
      >
        <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px', color: '#fff' }}>
          <IconHeadphones size={24} />
        </span>
        <div style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
          {fileName ? fileName : 'Click to Upload Audio'}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>
          Supports MP3, WAV
        </div>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept="audio/*"
          onChange={handleFileChange}
        />
      </div>

      {/* Hardware / Mode Selection */}
      {!isProcessing && Object.keys(separatedStems).length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={() => setSeparationMode('4-stem')} 
              style={buttonStyle(separationMode === '4-stem' ? '#da77f2' : '#888888')}
            >
              4-Stem
            </button>
            <button 
              onClick={() => setSeparationMode('2-stem')} 
              style={buttonStyle(separationMode === '2-stem' ? '#da77f2' : '#888888')}
            >
              2-Stem (Vocal/Inst)
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={() => setExecutionBackend('wasm')} 
              style={buttonStyle(executionBackend === 'wasm' ? '#4dabf7' : '#888888')}
            >
              CPU (WASM)
            </button>
            <button 
              onClick={() => setExecutionBackend('webgpu')} 
              style={buttonStyle(executionBackend === 'webgpu' ? '#4dabf7' : '#888888')}
              title="Requires supported browser"
            >
              GPU (WebGPU)
            </button>
          </div>
        </div>
      )}

      {/* Process Button */}
      {audioBuffer && !isProcessing && Object.keys(separatedStems).length === 0 && (
        <button 
          onClick={handleProcess}
          style={{ ...buttonStyle('#da77f2'), padding: '10px', marginTop: '4px' }}
        >
          <IconMusic size={16} />
          Start Stem Separation
        </button>
      )}

      {/* Progress Indicator */}
      {isProcessing && (
        <div style={{ background: 'var(--bg-lighter)', padding: '12px', borderRadius: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
            <span style={{ color: '#fff' }}>{statusText}</span>
            <span style={{ color: 'var(--primary)' }}>{progress.toFixed(0)}%</span>
          </div>
          <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ 
              height: '100%', 
              background: '#00e6ff', 
              width: `${progress === Infinity || isNaN(progress) ? 100 : progress}%`,
              transition: 'width 0.2s ease-out'
            }} />
          </div>
          <button 
            onClick={() => {
              setIsProcessing(false)
              setProgress(0)
              setStatusText('')
              // We could potentially abort the XHR or demucs process here if they were exposed
            }}
            style={{ ...buttonStyle('#ff3366'), padding: '6px', marginTop: '12px' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Results / Import Actions */}
      {Object.keys(separatedStems).length > 0 && !isProcessing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Available Stems
          </div>
          
          {['vocals', 'drums', 'bass', 'other', 'instrumental'].map(key => {
            const buf = separatedStems[key as keyof typeof separatedStems]
            if (!buf) return null
            
            let color = '#ffffff'
            let icon = <IconMusic size={14} />
            if (key === 'vocals') { color = '#ff6b6b'; icon = <IconMic size={14} /> }
            if (key === 'drums') { color = '#20c997'; icon = <IconDrum size={14} /> }
            if (key === 'bass') { color = '#339af0'; icon = <IconSpeaker size={14} /> }
            if (key === 'other') { color = '#fcc419'; icon = <IconMusic size={14} /> }
            if (key === 'instrumental') { color = '#da77f2'; icon = <IconMusic size={14} /> }

            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input 
                  type="checkbox" 
                  checked={!!selectedForExport[key]}
                  onChange={(e) => setSelectedForExport({ ...selectedForExport, [key]: e.target.checked })}
                />
                <button onClick={() => handleImportStem(key, buf)} style={{ ...buttonStyle(color), flex: 1, textTransform: 'capitalize' }}>
                  {icon}
                  {isImporting === key ? 'Adding...' : `Import ${key}`}
                </button>
                {/* Don't usually transcribe drums, but we can allow it for all or limit it */}
                {key !== 'drums' && (
                  <button onClick={() => handleTranscribeStem(key, buf)} disabled={isTranscribing === key} style={{ ...buttonStyle('#ff922b'), flex: 1, textTransform: 'capitalize' }}>
                    <IconTimeline size={14} />
                    {isTranscribing === key ? 'Transcribing...' : `To MIDI`}
                  </button>
                )}
              </div>
            )
          })}

          <button 
            onClick={handleSaveZip} 
            disabled={isZipping || !Object.values(selectedForExport).some(Boolean)}
            style={{ ...buttonStyle('#4dabf7'), marginTop: '8px' }}
          >
            <IconDownload size={14} />
            {isZipping ? 'Zipping...' : 'Save Selected Stems (.zip)'}
          </button>
        </div>
      )}

    </div>
  )
}
