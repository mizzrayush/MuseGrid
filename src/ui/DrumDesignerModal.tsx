import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import * as Tone from 'tone'
import { useStore, type DrumPadSample } from '../engine/store'
import { DRUM_KITS, type DrumKit } from '../utils/instruments'
import { audioEngine } from '../engine/AudioEngine'
import { saveFileWithDialog } from '../utils/fileExport'
import {
  IconX,
  IconSliders,
  IconPlay,
  IconStop,
  IconDownload,
  IconSync,
  IconUpload,
  IconTrash,
  IconWaveform,
  IconMic,
  IconSave
} from './Icons'
import { DRUM_SAMPLE_PRESETS, bufferToDataUri } from '../utils/drumSamplePresets'
import { QuickMicRecorder } from '../utils/micRecorder'
import { AppSlider } from './AppSlider'
import {
  generateCurveLut,
  sampleCurveLut,
  CURVE_FORMULA_PRESETS,
  type EnvelopeCurveType
} from '../utils/envelopeCurves'

// Reversed buffer cache for drum sample playback & audition
const reversedBufferCache = new WeakMap<AudioBuffer, AudioBuffer>()
function getReversedAudioBuffer(audioCtx: AudioContext, original: AudioBuffer): AudioBuffer {
  const cached = reversedBufferCache.get(original)
  if (cached) return cached
  const rev = audioCtx.createBuffer(original.numberOfChannels, original.length, original.sampleRate)
  for (let ch = 0; ch < original.numberOfChannels; ch++) {
    const src = original.getChannelData(ch)
    const dst = rev.getChannelData(ch)
    for (let i = 0, j = original.length - 1; i < original.length; i++, j--) {
      dst[i] = src[j]
    }
  }
  reversedBufferCache.set(original, rev)
  return rev
}

// 16 Pads configuration matching MPC bottom-to-top layout
interface PadDefinition {
  pitch: number
  name: string
  shortName: string
  hotkey: string
  color: string
  synthType: 'membrane' | 'noise' | 'metal'
  baseFreq: string
}

const PAD_DEFINITIONS: PadDefinition[] = [
  // Row 3 (Top)
  { pitch: 12, name: 'Low Conga', shortName: 'L-CONG', hotkey: '1', color: '#ae3ec9', synthType: 'membrane', baseFreq: 'E2' },
  { pitch: 13, name: 'High Conga', shortName: 'H-CONG', hotkey: '2', color: '#da77f2', synthType: 'membrane', baseFreq: 'G2' },
  { pitch: 14, name: 'Claves', shortName: 'CLAV', hotkey: '3', color: '#f06595', synthType: 'membrane', baseFreq: 'C4' },
  { pitch: 15, name: 'Rimshot', shortName: 'RIM', hotkey: '4', color: '#ff6b6b', synthType: 'noise', baseFreq: 'Noise' },
  
  // Row 2
  { pitch: 8, name: 'Crash Cymbal', shortName: 'CRASH', hotkey: 'Q', color: '#15aabf', synthType: 'metal', baseFreq: '300Hz' },
  { pitch: 9, name: 'Ride Cymbal', shortName: 'RIDE', hotkey: 'W', color: '#228be6', synthType: 'metal', baseFreq: '400Hz' },
  { pitch: 10, name: 'Cowbell', shortName: 'COWBL', hotkey: 'E', color: '#4c6ef5', synthType: 'metal', baseFreq: '800Hz' },
  { pitch: 11, name: 'Tambourine', shortName: 'TAMB', hotkey: 'R', color: '#7048e8', synthType: 'noise', baseFreq: 'Noise' },
  
  // Row 1
  { pitch: 4, name: 'Hand Clap', shortName: 'CLAP', hotkey: 'A', color: '#fab005', synthType: 'noise', baseFreq: 'Noise' },
  { pitch: 5, name: 'Low Tom', shortName: 'L-TOM', hotkey: 'S', color: '#82c91e', synthType: 'membrane', baseFreq: 'G1' },
  { pitch: 6, name: 'Mid Tom', shortName: 'M-TOM', hotkey: 'D', color: '#40c057', synthType: 'membrane', baseFreq: 'C2' },
  { pitch: 7, name: 'High Tom', shortName: 'H-TOM', hotkey: 'F', color: '#12b886', synthType: 'membrane', baseFreq: 'E2' },
  
  // Row 0 (Bottom)
  { pitch: 0, name: 'Kick / 808', shortName: 'KICK', hotkey: 'Z', color: '#ff4d4d', synthType: 'membrane', baseFreq: 'C1/A0' },
  { pitch: 1, name: 'Snare Drum', shortName: 'SNARE', hotkey: 'X', color: '#fa5252', synthType: 'noise', baseFreq: 'Noise' },
  { pitch: 2, name: 'Closed Hat', shortName: 'C-HAT', hotkey: 'C', color: '#ff922b', synthType: 'metal', baseFreq: 'Hi-Metal' },
  { pitch: 3, name: 'Open Hat', shortName: 'O-HAT', hotkey: 'V', color: '#fd7e14', synthType: 'metal', baseFreq: 'Open-Metal' },
]

// Default decays per pitch
const DEFAULT_DECAYS: Record<number, number> = {
  0: 0.45, 1: 0.14, 2: 0.08, 3: 0.35,
  4: 0.18, 5: 0.4, 6: 0.3, 7: 0.22,
  8: 2.2, 9: 2.8, 10: 0.45, 11: 0.12,
  12: 0.3, 13: 0.22, 14: 0.1, 15: 0.06
}

// Default punch octaves per membrane pitch
const DEFAULT_OCTAVES: Record<number, number> = {
  0: 7, 5: 4, 6: 4, 7: 4, 12: 2, 13: 2, 14: 1
}

// Default filter resonance / cutoff per pitch (Cowbell sweet spot at 800Hz)
const DEFAULT_RESONANCES: Record<number, number> = {
  1: 2500, // Snare
  2: 5000, // C-Hat
  3: 4500, // O-Hat
  4: 1500, // Clap
  8: 3500, // Crash
  9: 4000, // Ride
  10: 800, // Cowbell (800Hz Sweet Spot)
  11: 3000, // Tambourine
  15: 2500  // Rimshot
}

// Preset Kit Sound Profiles
const KIT_PRESETS: Record<string, {
  name: string
  kit: DrumKit
  decays: Record<number, number>
  pitches: Record<number, number>
  description: string
}> = {
  trap808: {
    name: '808 Sub Heavy',
    kit: 'eightOhEight',
    decays: { 0: 0.85, 1: 0.18, 2: 0.05, 3: 0.25, 4: 0.15, 5: 0.5, 6: 0.4, 7: 0.3, 8: 1.5, 9: 2.0, 10: 0.35, 11: 0.1, 12: 0.25, 13: 0.2, 14: 0.08, 15: 0.05 },
    pitches: { 0: 0, 1: 0, 2: 2, 3: 2, 4: 0, 5: -2, 6: 0, 7: 3, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 },
    description: 'Deep booming 808 sub, snappy claps and tight hats.'
  },
  tightFunk: {
    name: 'Studio Funk Break',
    kit: 'tight',
    decays: { 0: 0.22, 1: 0.08, 2: 0.04, 3: 0.16, 4: 0.1, 5: 0.18, 6: 0.14, 7: 0.11, 8: 0.9, 9: 1.2, 10: 0.25, 11: 0.08, 12: 0.18, 13: 0.14, 14: 0.06, 15: 0.04 },
    pitches: { 0: 2, 1: 3, 2: 4, 3: 4, 4: 1, 5: 2, 6: 4, 7: 6, 8: 2, 9: 2, 10: 2, 11: 2, 12: 2, 13: 3, 14: 2, 15: 1 },
    description: 'Damped, punchy studio drums ideal for fast breakbeats.'
  },
  electro909: {
    name: 'Electronic 909',
    kit: 'electro',
    decays: { 0: 0.42, 1: 0.16, 2: 0.07, 3: 0.32, 4: 0.22, 5: 0.35, 6: 0.28, 7: 0.2, 8: 1.8, 9: 2.2, 10: 0.4, 11: 0.12, 12: 0.3, 13: 0.22, 14: 0.1, 15: 0.05 },
    pitches: { 0: 0, 1: -1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 },
    description: 'Crisp synthetic percussion and resonant dance energy.'
  },
  ethnicTabla: {
    name: 'Ethnic & Tabla',
    kit: 'tabla',
    decays: { 0: 0.35, 1: 0.12, 2: 0.06, 3: 0.2, 4: 0.14, 5: 0.45, 6: 0.35, 7: 0.25, 8: 1.2, 9: 1.5, 10: 0.3, 11: 0.15, 12: 0.4, 13: 0.3, 14: 0.12, 15: 0.08 },
    pitches: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: -3, 6: 0, 7: 4, 8: 0, 9: 0, 10: 0, 11: 0, 12: -1, 13: 2, 14: 0, 15: 0 },
    description: 'Resonant bayan bass modulation, wooden hits and accents.'
  }
}

export const DrumDesignerModal: React.FC = () => {
  const isVisible = useStore(state => state.isDrumDesignerModalVisible)
  const setIsVisible = useStore(state => state.setIsDrumDesignerModalVisible)
  const tracks = useStore(state => state.tracks)
  const activeTrackId = useStore(state => state.activeTrackId)
  const updateTrack = useStore(state => state.updateTrack)

  // Find target drum track
  const targetTrack = useMemo(() => {
    const active = tracks.find(t => t.id === activeTrackId)
    if (active && active.instrument === 'drum') return active
    return tracks.find(t => t.instrument === 'drum') || null
  }, [tracks, activeTrackId])

  // Selected pad pitch (0 = Kick by default)
  const [selectedPitch, setSelectedPitch] = useState<number>(0)
  const [activePadTriggers, setActivePadTriggers] = useState<Record<number, boolean>>({})

  // Pad voice customization states: pitch offsets, detunes, slides, punch
  const [padPitches, setPadPitches] = useState<Record<number, number>>({})
  const [padDetunes, setPadDetunes] = useState<Record<number, number>>({})
  const [padSlides, setPadSlides] = useState<Record<number, number>>({})
  const [padSlideTimes, setPadSlideTimes] = useState<Record<number, number>>({})
  const [padDecays, setPadDecays] = useState<Record<number, number>>(DEFAULT_DECAYS)
  const [padOctaves, setPadOctaves] = useState<Record<number, number>>(DEFAULT_OCTAVES)
  const [padResonances, setPadResonances] = useState<Record<number, number>>(DEFAULT_RESONANCES)

  // Refs that always hold latest values (avoids stale closures)
  const padPitchesRef = useRef(padPitches)
  padPitchesRef.current = padPitches
  const padDetunesRef = useRef(padDetunes)
  padDetunesRef.current = padDetunes
  const padSlidesRef = useRef(padSlides)
  padSlidesRef.current = padSlides
  const padSlideTimesRef = useRef(padSlideTimes)
  padSlideTimesRef.current = padSlideTimes
  const padDecaysRef = useRef(padDecays)
  padDecaysRef.current = padDecays
  const padOctavesRef = useRef(padOctaves)
  padOctavesRef.current = padOctaves
  const padResonancesRef = useRef(padResonances)
  padResonancesRef.current = padResonances

  // Pad Sampler Engine States
  const [padModes, setPadModes] = useState<Record<number, 'synth' | 'sample'>>({})
  const [padSamples, setPadSamples] = useState<Record<number, DrumPadSample>>({})
  const [padBuffers, setPadBuffers] = useState<Map<number, AudioBuffer>>(new Map())
  const padModesRef = useRef(padModes)
  padModesRef.current = padModes
  const padSamplesRef = useRef(padSamples)
  padSamplesRef.current = padSamples
  const padBuffersRef = useRef(padBuffers)
  padBuffersRef.current = padBuffers
  const [dragOverPad, setDragOverPad] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileTargetPitchRef = useRef<number>(0)
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sampleHitTransientRef = useRef<number>(0)
  const isDraggingSampleHandle = useRef<'start' | 'end' | null>(null)
  const [sampleCursor, setSampleCursor] = useState<'default' | 'ew-resize' | 'pointer'>('default')

  const currentPadMode: 'synth' | 'sample' = padModes[selectedPitch] || (padSamples[selectedPitch] ? 'sample' : 'synth')
  const currentSample = padSamples[selectedPitch]
  const currentBuffer = padBuffers.get(selectedPitch)

  // Pad Alien Envelope Curve States (Exponential acoustic, 808 sub plunge, logarithmic, S-curve, custom f(x))
  const [padCurveTypes, setPadCurveTypes] = useState<Record<number, EnvelopeCurveType>>({})
  const [padTensions, setPadTensions] = useState<Record<number, number>>({})
  const [padFormulas, setPadFormulas] = useState<Record<number, string>>({})

  // Current selected pad's curve parameters
  const currentCurveType: EnvelopeCurveType = padCurveTypes[selectedPitch] ?? 'exponential'
  const currentTension: number = padTensions[selectedPitch] ?? (selectedPitch === 0 ? -0.2 : 0)
  const currentFormula: string = padFormulas[selectedPitch] ?? (selectedPitch === 0 ? 'pow(1 - x, 4.2)' : 'exp(-5.5 * x)')

  // 256-point LUT for currently selected drum pad
  const currentPadLut = useMemo(() => {
    return generateCurveLut(currentCurveType, currentTension, currentFormula, 256)
  }, [currentCurveType, currentTension, currentFormula])

  // Kit Test Groove player state
  const [isPlayingGroove, setIsPlayingGroove] = useState<boolean>(false)
  const grooveIntervalRef = useRef<number | null>(null)
  const grooveStepRef = useRef<number>(0)

  // Transient / Envelope Canvas ref & Interactive Dragging
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const hitTransientRef = useRef<number>(0)
  const isDraggingDrumGraph = useRef<'decay' | 'punch' | null>(null)
  const [canvasCursor, setCanvasCursor] = useState<'default' | 'ew-resize' | 'ns-resize' | 'pointer'>('default')

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false)
  const lastLoadedTrackIdRef = useRef<string | null>(null)

  // Sync state from targetTrack ONLY once when modal opens or track ID changes
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

    if (targetTrack.drumDecays) {
      setPadDecays(targetTrack.drumDecays)
      padDecaysRef.current = { ...targetTrack.drumDecays }
    } else {
      setPadDecays({ ...DEFAULT_DECAYS })
      padDecaysRef.current = { ...DEFAULT_DECAYS }
    }
    if (targetTrack.drumOctaves) {
      setPadOctaves(targetTrack.drumOctaves)
      padOctavesRef.current = { ...targetTrack.drumOctaves }
    } else {
      setPadOctaves({ ...DEFAULT_OCTAVES })
      padOctavesRef.current = { ...DEFAULT_OCTAVES }
    }
    if (targetTrack.drumResonances) {
      setPadResonances(targetTrack.drumResonances)
      padResonancesRef.current = { ...targetTrack.drumResonances }
    } else {
      setPadResonances({ ...DEFAULT_RESONANCES })
      padResonancesRef.current = { ...DEFAULT_RESONANCES }
    }
    if (targetTrack.drumPitches) {
      setPadPitches(targetTrack.drumPitches)
      padPitchesRef.current = { ...targetTrack.drumPitches }
    } else {
      setPadPitches({})
      padPitchesRef.current = {}
    }
    if (targetTrack.drumDetunes) {
      setPadDetunes(targetTrack.drumDetunes)
      padDetunesRef.current = { ...targetTrack.drumDetunes }
    } else {
      setPadDetunes({})
      padDetunesRef.current = {}
    }
    if (targetTrack.drumSlides) {
      setPadSlides(targetTrack.drumSlides)
      padSlidesRef.current = { ...targetTrack.drumSlides }
    } else {
      setPadSlides({})
      padSlidesRef.current = {}
    }
    if (targetTrack.drumSlideTimes) {
      setPadSlideTimes(targetTrack.drumSlideTimes)
      padSlideTimesRef.current = { ...targetTrack.drumSlideTimes }
    } else {
      setPadSlideTimes({})
      padSlideTimesRef.current = {}
    }
    if (targetTrack.drumPadModes) {
      setPadModes(targetTrack.drumPadModes)
      padModesRef.current = { ...targetTrack.drumPadModes }
    } else {
      setPadModes({})
      padModesRef.current = {}
    }
    if (targetTrack.drumPadSamples) {
      setPadSamples(targetTrack.drumPadSamples)
      padSamplesRef.current = { ...targetTrack.drumPadSamples }
      const ctx = Tone.getContext().rawContext as AudioContext
      for (const [pStr, s] of Object.entries(targetTrack.drumPadSamples)) {
        const p = Number(pStr)
        if (s?.audioBase64 && !padBuffersRef.current.has(p)) {
          fetch(s.audioBase64)
            .then(r => r.arrayBuffer())
            .then(ab => ctx.decodeAudioData(ab))
            .then(ab => {
              setPadBuffers(prev => {
                const next = new Map(prev).set(p, ab)
                padBuffersRef.current = next
                return next
              })
            })
            .catch(e => console.warn('Sample decode error:', e))
        }
      }
    } else {
      setPadSamples({})
      padSamplesRef.current = {}
    }
    if (targetTrack.drumPadCurves) {
      const types: Record<number, EnvelopeCurveType> = {}
      const tensions: Record<number, number> = {}
      const formulas: Record<number, string> = {}
      for (const [pStr, c] of Object.entries(targetTrack.drumPadCurves)) {
        const p = Number(pStr)
        if (c.type) types[p] = c.type as EnvelopeCurveType
        if (c.tension !== undefined) tensions[p] = c.tension
        if (c.formula) formulas[p] = c.formula
      }
      setPadCurveTypes(types)
      setPadTensions(tensions)
      setPadFormulas(formulas)
    } else {
      setPadCurveTypes({})
      setPadTensions({})
      setPadFormulas({})
    }
  }, [isVisible, targetTrack?.id])

  // Commit pad curve changes to local studio state (Testing mode)
  const commitPadCurve = useCallback((pitch: number, type: EnvelopeCurveType, tension: number, formula: string) => {
    setPadCurveTypes(prev => ({ ...prev, [pitch]: type }))
    setPadTensions(prev => ({ ...prev, [pitch]: tension }))
    setPadFormulas(prev => ({ ...prev, [pitch]: formula }))
    setHasUnsavedChanges(true)
  }, [])

  // Get active pad definition
  const currentPadDef = useMemo(() => {
    return PAD_DEFINITIONS.find(p => p.pitch === selectedPitch) || PAD_DEFINITIONS[12]
  }, [selectedPitch])

  // Trigger Pad Audio & Flash Animation (Reads from refs or explicit real-time overrides)
  const triggerPad = useCallback((
    pitch: number,
    vel = 1,
    overrides?: {
      pitchOffset?: number
      detune?: number
      slide?: number
      slideTime?: number
      octaves?: number
      resonance?: number
      decay?: number
    }
  ) => {
    if (!targetTrack) return

    // Visual trigger flash
    setActivePadTriggers(prev => ({ ...prev, [pitch]: true }))
    setTimeout(() => {
      setActivePadTriggers(prev => ({ ...prev, [pitch]: false }))
    }, 120)

    // Bump hit transient for canvas visualization if this is current pad
    if (pitch === selectedPitch) {
      hitTransientRef.current = 1.0
      sampleHitTransientRef.current = 1.0
    }

    // Trigger audio parameters — read from overrides or latest refs
    const pitchOffset = (overrides?.pitchOffset !== undefined ? overrides.pitchOffset : (padPitchesRef.current[pitch] ?? 0)) + (targetTrack.transpose ?? 0)
    const detune = overrides?.detune !== undefined ? overrides.detune : (padDetunesRef.current[pitch] ?? 0)
    const slide = overrides?.slide !== undefined ? overrides.slide : (padSlidesRef.current[pitch] ?? 0)
    const slideTime = overrides?.slideTime !== undefined ? overrides.slideTime : (padSlideTimesRef.current[pitch] ?? 120)
    const octaves = overrides?.octaves !== undefined ? overrides.octaves : (padOctavesRef.current[pitch] ?? DEFAULT_OCTAVES[pitch] ?? (pitch === 0 ? 7 : 4))
    const resonance = overrides?.resonance !== undefined ? overrides.resonance : (padResonancesRef.current[pitch] ?? DEFAULT_RESONANCES[pitch] ?? 4000)
    const decay = overrides?.decay !== undefined ? overrides.decay : (padDecaysRef.current[pitch] ?? DEFAULT_DECAYS[pitch] ?? 0.3)

    // Direct WebAudio Audition for Sample Mode (Instant preview for recorded voice / loaded sample)
    const isSampleMode = (padModesRef.current[pitch] === 'sample') || (targetTrack.drumPadModes?.[pitch] === 'sample')
    const sampleBuffer = padBuffersRef.current.get(pitch)
    const sampleConfig = padSamplesRef.current[pitch] || targetTrack.drumPadSamples?.[pitch]

    if (isSampleMode && sampleBuffer) {
      try {
        const audioCtx = Tone.getContext().rawContext as AudioContext
        if (audioCtx.state === 'suspended') {
          void audioCtx.resume()
        }
        const now = audioCtx.currentTime

        // Reversal handling
        const bufToPlay = sampleConfig?.reverse
          ? getReversedAudioBuffer(audioCtx, sampleBuffer)
          : sampleBuffer

        const source = audioCtx.createBufferSource()
        source.buffer = bufToPlay

        // Playback rate from tuning semitones + fineTune cents + track transpose
        const tuningSemitones = (sampleConfig?.tuning ?? 0) + pitchOffset
        const fineTuneCents = (sampleConfig?.fineTune ?? 0) + detune
        const totalSemitones = tuningSemitones + (fineTuneCents / 100)
        const rate = Math.max(0.05, Math.min(16.0, Math.pow(2, totalSemitones / 12)))
        source.playbackRate.setValueAtTime(rate, now)

        const gainNode = audioCtx.createGain()
        const sampleVol = sampleConfig?.volume !== undefined ? sampleConfig.volume : 1.0
        const peakGain = Math.max(0.0001, Math.min(2.5, vel * sampleVol))
        gainNode.gain.setValueAtTime(peakGain, now)

        // Envelope decay
        const bufDuration = bufToPlay.duration / rate
        const decayTime = sampleConfig?.decay ?? (overrides?.decay ?? padDecaysRef.current[pitch] ?? bufDuration)
        const effectiveDuration = Math.min(bufDuration, decayTime)
        if (effectiveDuration < bufDuration) {
          gainNode.gain.setValueAtTime(peakGain, now + Math.max(0.005, effectiveDuration * 0.75))
          gainNode.gain.exponentialRampToValueAtTime(0.0001, now + effectiveDuration)
        }

        // Stereo Panning
        let outputNode: AudioNode = gainNode
        const panVal = Math.max(-1, Math.min(1, sampleConfig?.pan ?? 0))
        if (panVal !== 0 && (audioCtx as any).createStereoPanner) {
          const panner = (audioCtx as any).createStereoPanner()
          panner.pan.setValueAtTime(panVal, now)
          gainNode.connect(panner)
          outputNode = panner
        }

        outputNode.connect(audioCtx.destination)

        // Trimming offset slices
        const startOffset = Math.max(0, Math.min(0.99, sampleConfig?.startOffset ?? 0))
        const endOffset = Math.max(startOffset + 0.01, Math.min(1.0, sampleConfig?.endOffset ?? 1.0))
        const startTimeInBuf = startOffset * bufToPlay.duration
        const playDuration = ((endOffset - startOffset) * bufToPlay.duration) / rate

        source.connect(gainNode)
        source.start(now, startTimeInBuf, Math.min(playDuration, effectiveDuration + 0.05))

        source.onended = () => {
          try {
            source.disconnect()
            gainNode.disconnect()
            if (outputNode !== gainNode) outputNode.disconnect()
          } catch (_) {}
        }
        return
      } catch (err) {
        console.warn('Direct pad sample audition failed, falling back to audioEngine:', err)
      }
    }

    // Fallback or Physical Synth Mode: Play through AudioEngine
    audioEngine.playNote(
      targetTrack.id,
      'drum',
      pitch,
      '16n',
      undefined,
      vel,
      undefined,
      detune,
      undefined,
      {
        pitchOffset,
        pitchSlide: slide,
        pitchSlideTime: slideTime,
        detune,
        octaves,
        resonance,
        decay
      }
    )
  }, [targetTrack, selectedPitch])

  const handleLoadSampleFile = async (pitch: number, file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const audioCtx = Tone.getContext().rawContext as AudioContext
      const decoded = await audioCtx.decodeAudioData(arrayBuffer)
      const base64Uri = await bufferToDataUri(decoded)

      const sampleData: DrumPadSample = {
        name: file.name.replace(/\.[^/.]+$/, ''),
        audioBase64: base64Uri,
        tuning: 0,
        fineTune: 0,
        decay: Math.min(4.0, +(decoded.duration).toFixed(2)),
        startOffset: 0,
        endOffset: 1,
        volume: 1.0,
        pan: 0,
        chokeGroup: (pitch === 2 || pitch === 3) ? 1 : 0,
        reverse: false
      }

      setPadSamples(prev => ({ ...prev, [pitch]: sampleData }))
      setPadModes(prev => ({ ...prev, [pitch]: 'sample' }))
      setPadBuffers(prev => new Map(prev).set(pitch, decoded))

      if (targetTrack) {
        audioEngine.setDrumPadSample(targetTrack.id, pitch, sampleData, decoded)
      }
      useStore.getState().showToast(`Loaded sample "${sampleData.name}" on Pad ${pitch}`, 'success')
      triggerPad(pitch, 1)
    } catch (err) {
      console.error('Failed to load sample:', err)
      useStore.getState().showToast('Could not load audio file. Ensure it is valid WAV/MP3.', 'error')
    }
  }

  // Live Microphone Quick-Sampler (OP-1 / SP-404 style instant acoustic sampling)
  const [isRecordingMic, setIsRecordingMic] = useState<boolean>(false)
  const [micSeconds, setMicSeconds] = useState<number>(0)
  const micRecorderRef = useRef<QuickMicRecorder | null>(null)
  const micTimerRef = useRef<any>(null)

  const stopMicRecording = async () => {
    if (micTimerRef.current) {
      clearInterval(micTimerRef.current)
      micTimerRef.current = null
    }
    if (!micRecorderRef.current) return

    try {
      const result = await micRecorderRef.current.stop()
      setIsRecordingMic(false)
      const file = new File([result.blob], `Mic_Pad_${selectedPitch + 1}.wav`, { type: 'audio/wav' })
      await handleLoadSampleFile(selectedPitch, file)
      useStore.getState().showToast(`Recorded live mic sample onto Pad ${selectedPitch + 1} (${result.durationSec.toFixed(2)}s)`, 'success')
    } catch (err) {
      console.error('Error stopping mic recording:', err)
      setIsRecordingMic(false)
    }
  }

  const startMicRecording = async () => {
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
          if (s >= 10) {
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
  }

  useEffect(() => {
    return () => {
      if (micTimerRef.current) clearInterval(micTimerRef.current)
      if (micRecorderRef.current) micRecorderRef.current.cancel()
    }
  }, [])

  const handleLoadPresetSample = async (pitch: number, presetId: string) => {
    const preset = DRUM_SAMPLE_PRESETS.find(p => p.id === presetId)
    if (!preset) return
    try {
      const audioCtx = Tone.getContext().rawContext as AudioContext
      const buffer = preset.generate(audioCtx)
      const base64Uri = await bufferToDataUri(buffer)

      const sampleData: DrumPadSample = {
        name: preset.name,
        audioBase64: base64Uri,
        tuning: 0,
        fineTune: 0,
        decay: preset.durationSec,
        startOffset: 0,
        endOffset: 1,
        volume: 1.0,
        pan: 0,
        chokeGroup: (pitch === 2 || pitch === 3) ? 1 : 0,
        reverse: false
      }

      setPadSamples(prev => ({ ...prev, [pitch]: sampleData }))
      setPadModes(prev => ({ ...prev, [pitch]: 'sample' }))
      setPadBuffers(prev => new Map(prev).set(pitch, buffer))

      if (targetTrack) {
        audioEngine.setDrumPadSample(targetTrack.id, pitch, sampleData, buffer)
      }
      useStore.getState().showToast(`Loaded "${preset.name}" on Pad ${pitch}`, 'info')
      triggerPad(pitch, 1)
    } catch (err) {
      console.error('Preset loading error:', err)
    }
  }

  const handleSetPadMode = (pitch: number, mode: 'synth' | 'sample') => {
    setPadModes(prev => ({ ...prev, [pitch]: mode }))
    if (targetTrack) {
      audioEngine.setDrumPadMode(targetTrack.id, pitch, mode)
    }
    if (mode === 'sample' && !padSamples[pitch]) {
      const defaultPresetMap: Record<number, string> = {
        0: '808_sub_punch',
        1: 'trap_snare_crisp',
        2: 'closed_hat_tight',
        3: 'open_hat_sizzle',
        4: 'hand_clap_909',
        5: 'acoustic_punch_kick',
        6: 'acoustic_punch_kick',
        7: 'percussion_low_conga',
        8: 'crash_splash_cymbal',
        9: 'crash_splash_cymbal',
        10: 'closed_hat_tight',
        11: 'closed_hat_tight',
        12: 'percussion_low_conga',
        13: 'percussion_low_conga',
        14: 'percussion_rimshot',
        15: 'percussion_rimshot'
      }
      const presetId = defaultPresetMap[pitch] || '808_sub_punch'
      handleLoadPresetSample(pitch, presetId)
    }
  }

  const handleClearSample = (pitch: number) => {
    setPadSamples(prev => {
      const next = { ...prev }
      delete next[pitch]
      return next
    })
    setPadModes(prev => ({ ...prev, [pitch]: 'synth' }))
    setPadBuffers(prev => {
      const next = new Map(prev)
      next.delete(pitch)
      return next
    })
    if (targetTrack) {
      audioEngine.setDrumPadSample(targetTrack.id, pitch, null)
    }
    useStore.getState().showToast(`Cleared sample from Pad ${pitch}`, 'info')
  }

  const updateSampleParam = useCallback((pitch: number, updates: Partial<DrumPadSample>) => {
    setPadSamples(prev => {
      const existing = prev[pitch] || { name: 'Sample' }
      const updated = { ...existing, ...updates }
      if (targetTrack) {
        audioEngine.setDrumPadSample(targetTrack.id, pitch, updated, padBuffers.get(pitch))
      }
      return { ...prev, [pitch]: updated }
    })
  }, [targetTrack, padBuffers])

  const handleNormalizeSample = (pitch: number) => {
    const buf = padBuffers.get(pitch)
    if (!buf) return
    let peak = 0
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch)
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i])
        if (abs > peak) peak = abs
      }
    }
    if (peak > 0.0001) {
      const targetGain = +(1.0 / peak).toFixed(2)
      updateSampleParam(pitch, { volume: Math.min(2.0, targetGain) })
      useStore.getState().showToast(`Normalized Pad ${pitch} peak to 0 dB (Gain: ${(targetGain * 100).toFixed(0)}%)`, 'info')
      triggerPad(pitch, 1)
    }
  }

  // Sample peaks extraction cache for waveform visualization
  const samplePeaks = useMemo(() => {
    if (!currentBuffer) return null
    const samples = 240
    const rawData = currentBuffer.getChannelData(0)
    const blockSize = Math.floor(rawData.length / samples)
    const peaks: { min: number; max: number }[] = []

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize
      let min = 0
      let max = 0
      for (let j = 0; j < blockSize; j += 4) {
        const val = rawData[start + j] || 0
        if (val < min) min = val
        if (val > max) max = val
      }
      peaks.push({ min, max })
    }
    return peaks
  }, [currentBuffer])

  // Global Keyboard Hotkey Handler
  useEffect(() => {
    if (!isVisible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        setIsVisible(false)
        return
      }

      const key = e.key.toUpperCase()
      const pad = PAD_DEFINITIONS.find(p => p.hotkey === key)
      if (pad) {
        e.preventDefault()
        setSelectedPitch(pad.pitch)
        triggerPad(pad.pitch, 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, triggerPad, setIsVisible])

  // Update pad parameter locally (Testing mode, not modifying track until Save)
  const commitPadDecay = useCallback((pitch: number, val: number) => {
    padDecaysRef.current[pitch] = val
    setPadDecays(prev => ({ ...prev, [pitch]: val }))
    setHasUnsavedChanges(true)
  }, [])

  const commitPadOctave = useCallback((pitch: number, val: number) => {
    padOctavesRef.current[pitch] = val
    setPadOctaves(prev => ({ ...prev, [pitch]: val }))
    setHasUnsavedChanges(true)
  }, [])

  const commitPadResonance = useCallback((pitch: number, val: number) => {
    padResonancesRef.current[pitch] = val
    setPadResonances(prev => ({ ...prev, [pitch]: val }))
    setHasUnsavedChanges(true)
  }, [])

  const commitPadPitch = useCallback((pitch: number, val: number) => {
    padPitchesRef.current[pitch] = val
    setPadPitches(prev => ({ ...prev, [pitch]: val }))
    setHasUnsavedChanges(true)
  }, [])

  const commitPadDetune = useCallback((pitch: number, val: number) => {
    padDetunesRef.current[pitch] = val
    setPadDetunes(prev => ({ ...prev, [pitch]: val }))
    setHasUnsavedChanges(true)
  }, [])

  const commitPadSlide = useCallback((pitch: number, val: number) => {
    padSlidesRef.current[pitch] = val
    setPadSlides(prev => ({ ...prev, [pitch]: val }))
    setHasUnsavedChanges(true)
  }, [])

  const commitPadSlideTime = useCallback((pitch: number, val: number) => {
    padSlideTimesRef.current[pitch] = val
    setPadSlideTimes(prev => ({ ...prev, [pitch]: val }))
    setHasUnsavedChanges(true)
  }, [])

  // Canvas Transient & Envelope Visualizer Animation + Draggable Handles
  useEffect(() => {
    if (!isVisible) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let isRunning = true

    const render = () => {
      if (!isRunning) return

      const width = canvas.width
      const height = canvas.height
      ctx.clearRect(0, 0, width, height)

      // Background subtle grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
      ctx.lineWidth = 1
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += 30) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      const decayVal = padDecays[selectedPitch] ?? DEFAULT_DECAYS[selectedPitch] ?? 0.3
      const pitchOffset = padPitches[selectedPitch] ?? 0
      const isMembrane = currentPadDef.synthType === 'membrane'
      const isMetal = currentPadDef.synthType === 'metal'

      // Apex peak Y based on membrane punch octaves or synth resonance
      const octVal = padOctaves[selectedPitch] ?? DEFAULT_OCTAVES[selectedPitch] ?? (selectedPitch === 0 ? 7 : 4)
      const resVal = padResonances[selectedPitch] ?? DEFAULT_RESONANCES[selectedPitch] ?? 800
      const peakX = 30
      const peakY = isMembrane
        ? Math.max(16, Math.min(85, 16 + (1 - octVal / 8) * 65))
        : Math.max(16, Math.min(85, 16 + (1 - (resVal - 100) / 5900) * 65))
      const baseY = height - 16

      // Decay End X based on decay length
      const curveEndX = Math.max(80, Math.min(width - 40, 80 + (decayVal / 3.0) * (width - 120)))

      // Envelope Curve Path with exact LUT curvature
      const tracePadPath = () => {
        ctx.beginPath()
        ctx.moveTo(10, baseY)
        ctx.lineTo(peakX, peakY) // Fast attack to apex
        const curveSegments = 48
        for (let i = 1; i <= curveSegments; i++) {
          const p = i / curveSegments
          const x = peakX + p * (curveEndX - peakX)
          const factor = sampleCurveLut(currentPadLut, p)
          const y = baseY - (baseY - peakY) * factor
          ctx.lineTo(x, y)
        }
        ctx.lineTo(width - 10, baseY)
      }

      // Subtle Area Fill (Clean, crisp, no glow)
      const grad = ctx.createLinearGradient(0, 0, 0, height)
      grad.addColorStop(0, `${currentPadDef.color}20`)
      grad.addColorStop(0.8, `${currentPadDef.color}05`)
      grad.addColorStop(1, 'transparent')
      tracePadPath()
      ctx.fillStyle = grad
      ctx.fill()

      // Crisp stroke path (no neon shadow blur)
      tracePadPath()
      ctx.strokeStyle = currentPadDef.color
      ctx.lineWidth = 1.8
      ctx.shadowBlur = 0
      ctx.stroke()

      // Draggable Handle 1: Punch Apex Node
      ctx.beginPath()
      ctx.arc(peakX, peakY, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = currentPadDef.color
      ctx.lineWidth = 2
      ctx.shadowBlur = 0
      ctx.stroke()

      ctx.fillStyle = '#aaa'
      ctx.font = '600 10px sans-serif'
      ctx.fillText(isMembrane ? `PEAK/PUNCH: ${octVal}oct` : `PEAK/RES: ${resVal}Hz`, peakX + 10, peakY + 3)

      // Draggable Handle 2: Decay End Node
      ctx.beginPath()
      ctx.arc(curveEndX, baseY, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = currentPadDef.color
      ctx.lineWidth = 2
      ctx.shadowBlur = 0
      ctx.stroke()

      ctx.fillStyle = '#aaa'
      ctx.font = '600 10px sans-serif'
      ctx.fillText(`DECAY: ${(decayVal * 1000).toFixed(0)}ms`, Math.max(60, curveEndX - 55), baseY - 10)

      // Dynamic Transient Hit Burst on pad trigger (Clean, sharp highlight - no glow)
      if (hitTransientRef.current > 0.01) {
        hitTransientRef.current *= 0.88 // exponential decay

        // Crisp apex ring
        ctx.beginPath()
        ctx.arc(peakX, peakY, 6 + hitTransientRef.current * 5, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255, 255, 255, ${hitTransientRef.current * 0.7})`
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Synth waveform burst line
        ctx.beginPath()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        const samples = 100
        for (let i = 0; i < samples; i++) {
          const x = peakX + (i / samples) * (curveEndX - peakX)
          const env = Math.exp(-i / (samples * 0.35))
          let wave = 0
          if (isMembrane) {
            const freqMult = 1 + (pitchOffset / 12)
            wave = Math.sin(i * 0.45 * freqMult) * 30 * env * hitTransientRef.current
          } else if (isMetal) {
            wave = (Math.sin(i * 1.8) + Math.sin(i * 4.2) * 0.5) * 22 * env * hitTransientRef.current
          } else {
            wave = (Math.random() * 2 - 1) * 25 * env * hitTransientRef.current
          }
          const y = (height * 0.5) + wave
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      // Draw Help / Direct Drag instruction
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
      ctx.font = '10px sans-serif'
      ctx.fillText('Drag handles to sculpt Decay & Peak/Punch in real time', 15, 22)

      animFrameRef.current = requestAnimationFrame(render)
    }

    animFrameRef.current = requestAnimationFrame(render)
    return () => {
      isRunning = false
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isVisible, selectedPitch, currentPadDef, padDecays, padPitches, padOctaves, padResonances, currentPadLut, currentCurveType, currentTension])

  // Mouse drag handlers on Drum Canvas Graph
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height

    const decayVal = padDecays[selectedPitch] ?? DEFAULT_DECAYS[selectedPitch] ?? 0.3
    const curveEndX = Math.max(80, Math.min(canvas.width - 40, 80 + (decayVal / 3.0) * (canvas.width - 120)))
    const isMembrane = currentPadDef.synthType === 'membrane'
    const octVal = padOctaves[selectedPitch] ?? DEFAULT_OCTAVES[selectedPitch] ?? (selectedPitch === 0 ? 7 : 4)
    const resVal = padResonances[selectedPitch] ?? DEFAULT_RESONANCES[selectedPitch] ?? 800
    const peakY = isMembrane
      ? Math.max(16, Math.min(85, 16 + (1 - octVal / 8) * 65))
      : Math.max(16, Math.min(85, 16 + (1 - (resVal - 100) / 5900) * 65))

    // Proximity check for Punch apex handle (large 35px radius or click anywhere in attack zone x <= 65)
    if (Math.hypot(x - 30, y - peakY) < 35 || x <= 65) {
      isDraggingDrumGraph.current = 'punch'
      if (isMembrane) {
        const newOct = Math.round(Math.max(1, Math.min(8, (1 - (y - 16) / 65) * 8)))
        commitPadOctave(selectedPitch, newOct)
        triggerPad(selectedPitch, 0.9, { octaves: newOct })
      } else {
        const newRes = Math.round(Math.max(100, Math.min(6000, 100 + (1 - (y - 16) / 65) * 5900)))
        commitPadResonance(selectedPitch, newRes)
        triggerPad(selectedPitch, 0.9, { resonance: newRes })
      }
      return
    }
    // Proximity check for Decay handle or anywhere on the decay slope (but not near punch handle)
    if (Math.hypot(x - curveEndX, y - (canvas.height - 16)) < 25 || (x >= 80 && y >= canvas.height - 50)) {
      isDraggingDrumGraph.current = 'decay'
      const newDecay = +(Math.max(0.02, Math.min(3.0, ((x - 80) / (canvas.width - 120)) * 3.0))).toFixed(2)
      commitPadDecay(selectedPitch, newDecay)
      return
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height

    const decayVal = padDecays[selectedPitch] ?? DEFAULT_DECAYS[selectedPitch] ?? 0.3
    const curveEndX = Math.max(80, Math.min(canvas.width - 40, 80 + (decayVal / 3.0) * (canvas.width - 120)))
    const isMembrane = currentPadDef.synthType === 'membrane'
    const octVal = padOctaves[selectedPitch] ?? DEFAULT_OCTAVES[selectedPitch] ?? (selectedPitch === 0 ? 7 : 4)
    const resVal = padResonances[selectedPitch] ?? DEFAULT_RESONANCES[selectedPitch] ?? 800
    const peakY = isMembrane
      ? Math.max(16, Math.min(85, 16 + (1 - octVal / 8) * 65))
      : Math.max(16, Math.min(85, 16 + (1 - (resVal - 100) / 5900) * 65))

    if (!isDraggingDrumGraph.current) {
      if (Math.hypot(x - 30, y - peakY) < 25 || (x <= 50 && Math.abs(y - peakY) < 20)) {
        setCanvasCursor('ns-resize')
      } else if (Math.hypot(x - curveEndX, y - (canvas.height - 16)) < 22 || (x >= 70 && y >= canvas.height - 35)) {
        setCanvasCursor('ew-resize')
      } else {
        setCanvasCursor('pointer')
      }
      return
    }

    if (isDraggingDrumGraph.current === 'decay') {
      const newDecay = +(Math.max(0.02, Math.min(3.0, ((x - 80) / (canvas.width - 120)) * 3.0))).toFixed(2)
      commitPadDecay(selectedPitch, newDecay)
    } else if (isDraggingDrumGraph.current === 'punch') {
      if (isMembrane) {
        const newOct = Math.round(Math.max(1, Math.min(8, (1 - (y - 16) / 65) * 8)))
        commitPadOctave(selectedPitch, newOct)
      } else {
        const newRes = Math.round(Math.max(100, Math.min(6000, 100 + (1 - (y - 16) / 65) * 5900)))
        commitPadResonance(selectedPitch, newRes)
      }
    }
  }

  const handleCanvasMouseUp = () => {
    if (isDraggingDrumGraph.current) {
      const mode = isDraggingDrumGraph.current
      isDraggingDrumGraph.current = null
      if (mode === 'punch') {
        if (currentPadDef.synthType === 'membrane') {
          triggerPad(selectedPitch, 1, { octaves: padOctavesRef.current[selectedPitch] })
        } else {
          triggerPad(selectedPitch, 1, { resonance: padResonancesRef.current[selectedPitch] })
        }
      } else {
        triggerPad(selectedPitch, 1, { decay: padDecaysRef.current[selectedPitch] })
      }
    }
  }

  const handleCanvasMouseLeave = () => {
    if (isDraggingDrumGraph.current) {
      const mode = isDraggingDrumGraph.current
      isDraggingDrumGraph.current = null
      if (mode === 'punch') {
        if (currentPadDef.synthType === 'membrane') {
          triggerPad(selectedPitch, 1, { octaves: padOctavesRef.current[selectedPitch] })
        } else {
          triggerPad(selectedPitch, 1, { resonance: padResonancesRef.current[selectedPitch] })
        }
      } else {
        triggerPad(selectedPitch, 1, { decay: padDecaysRef.current[selectedPitch] })
      }
    }
  }

  // Sample Waveform Canvas Visualizer & Interactive Trimming
  useEffect(() => {
    if (!isVisible || currentPadMode !== 'sample') return

    const canvas = sampleCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let isRunning = true
    let frameId: number | null = null

    const render = () => {
      if (!isRunning) return

      const width = canvas.width
      const height = canvas.height
      ctx.clearRect(0, 0, width, height)

      // Background subtle dark grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
      ctx.lineWidth = 1
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += 25) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // Centerline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()

      const startOff = currentSample?.startOffset ?? 0
      const endOff = currentSample?.endOffset ?? 1
      const startX = Math.round(startOff * width)
      const endX = Math.round(endOff * width)

      if (samplePeaks && samplePeaks.length > 0) {
        const barW = width / samplePeaks.length
        const midY = height / 2
        const ampScale = (height / 2) * 0.88

        // Draw waveform peaks (horizontally reversed when reverse mode is active)
        const isReversed = !!currentSample?.reverse
        for (let i = 0; i < samplePeaks.length; i++) {
          const x = i * barW
          const p = samplePeaks[isReversed ? (samplePeaks.length - 1 - i) : i]
          const topY = midY + p.min * ampScale
          const botY = midY + p.max * ampScale
          const inRange = x >= startX && x <= endX

          ctx.fillStyle = inRange
            ? (isReversed ? '#da77f2' : '#00e6ff')
            : 'rgba(255, 255, 255, 0.12)'

          ctx.fillRect(x, topY, Math.max(1, barW - 0.5), Math.max(1.5, botY - topY))
        }

        // Dimmed unselected regions
        if (startX > 0) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
          ctx.fillRect(0, 0, startX, height)
        }
        if (endX < width) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
          ctx.fillRect(endX, 0, width - endX, height)
        }

        // Draggable Start Marker (Green line + handle)
        ctx.strokeStyle = '#00ff88'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(startX, 0)
        ctx.lineTo(startX, height)
        ctx.stroke()

        ctx.fillStyle = '#00ff88'
        ctx.beginPath()
        ctx.arc(startX, 14, 5, 0, Math.PI * 2)
        ctx.fill()

        ctx.font = '700 9px monospace'
        ctx.fillText(`START: ${(startOff * 100).toFixed(0)}%`, Math.max(4, startX + 8), 16)

        // Draggable End Marker (Red line + handle)
        ctx.strokeStyle = '#ff4d4d'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(endX, 0)
        ctx.lineTo(endX, height)
        ctx.stroke()

        ctx.fillStyle = '#ff4d4d'
        ctx.beginPath()
        ctx.arc(endX, height - 14, 5, 0, Math.PI * 2)
        ctx.fill()

        ctx.font = '700 9px monospace'
        ctx.fillText(`END: ${(endOff * 100).toFixed(0)}%`, Math.max(30, endX - 60), height - 12)

        // Dynamic transient hit flash
        if (sampleHitTransientRef.current > 0.02) {
          sampleHitTransientRef.current *= 0.88
          ctx.fillStyle = `rgba(0, 230, 255, ${sampleHitTransientRef.current * 0.25})`
          ctx.fillRect(startX, 0, endX - startX, height)
        }
      } else {
        // Empty state instruction
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
        ctx.font = '600 11px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Drop WAV/MP3 sample here or pick a studio preset below', width / 2, height / 2 + 4)
        ctx.textAlign = 'left'
      }

      frameId = requestAnimationFrame(render)
    }

    frameId = requestAnimationFrame(render)

    return () => {
      isRunning = false
      if (frameId) cancelAnimationFrame(frameId)
    }
  }, [isVisible, currentPadMode, samplePeaks, currentSample, currentBuffer])

  // Mouse drag handlers on Sample Canvas
  const handleSampleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sampleCanvasRef.current
    if (!canvas || !currentSample) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width
    const startX = (currentSample.startOffset ?? 0) * canvas.width
    const endX = (currentSample.endOffset ?? 1) * canvas.width

    if (Math.abs(x - startX) < 20) {
      isDraggingSampleHandle.current = 'start'
      return
    }
    if (Math.abs(x - endX) < 20) {
      isDraggingSampleHandle.current = 'end'
      return
    }
  }

  const handleSampleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sampleCanvasRef.current
    if (!canvas || !currentSample) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width
    const normX = Math.max(0, Math.min(1, x / canvas.width))
    const startX = (currentSample.startOffset ?? 0) * canvas.width
    const endX = (currentSample.endOffset ?? 1) * canvas.width

    if (!isDraggingSampleHandle.current) {
      if (Math.abs(x - startX) < 18 || Math.abs(x - endX) < 18) {
        setSampleCursor('ew-resize')
      } else {
        setSampleCursor('default')
      }
      return
    }

    if (isDraggingSampleHandle.current === 'start') {
      const curEnd = currentSample.endOffset ?? 1
      const newStart = Math.min(normX, curEnd - 0.02)
      updateSampleParam(selectedPitch, { startOffset: +newStart.toFixed(3) })
    } else if (isDraggingSampleHandle.current === 'end') {
      const curStart = currentSample.startOffset ?? 0
      const newEnd = Math.max(normX, curStart + 0.02)
      updateSampleParam(selectedPitch, { endOffset: +newEnd.toFixed(3) })
    }
  }

  const handleSampleCanvasMouseUp = () => {
    if (isDraggingSampleHandle.current) {
      isDraggingSampleHandle.current = null
      triggerPad(selectedPitch, 1)
    }
  }

  const handleSampleCanvasMouseLeave = () => {
    if (isDraggingSampleHandle.current) {
      isDraggingSampleHandle.current = null
      triggerPad(selectedPitch, 1)
    }
  }

  // Kit Test Groove Engine
  useEffect(() => {
    if (!isPlayingGroove || !targetTrack) {
      if (grooveIntervalRef.current) {
        clearInterval(grooveIntervalRef.current)
        grooveIntervalRef.current = null
      }
      return
    }

    const stepDurationMs = 125 // ~120 BPM 16th notes
    grooveStepRef.current = 0

    grooveIntervalRef.current = window.setInterval(() => {
      const step = grooveStepRef.current % 16

      // Closed Hat on 8th notes
      if (step % 2 === 0 && step !== 14) {
        triggerPad(2, step % 4 === 0 ? 0.9 : 0.6)
      }
      // Open Hat on step 14
      if (step === 14) {
        triggerPad(3, 0.85)
      }
      // Kick on 0, 6, 10
      if (step === 0 || step === 6 || step === 10) {
        triggerPad(0, 1.0)
      }
      // Snare & Clap on 4, 12
      if (step === 4 || step === 12) {
        triggerPad(1, 0.95)
        triggerPad(4, 0.7)
      }
      // Tom fill on 15
      if (step === 15) {
        triggerPad(7, 0.8)
      }

      grooveStepRef.current++
    }, stepDurationMs)

    return () => {
      if (grooveIntervalRef.current) {
        clearInterval(grooveIntervalRef.current)
        grooveIntervalRef.current = null
      }
    }
  }, [isPlayingGroove, targetTrack, triggerPad])

  const applyPreset = (presetKey: string) => {
    const p = KIT_PRESETS[presetKey]
    if (!p || !targetTrack) return

    setPadDecays(p.decays)
    setPadPitches(p.pitches)
    updateTrack(targetTrack.id, {
      drumKit: p.kit,
      drumDecays: p.decays
    })
    audioEngine.createInstrument(targetTrack.id, 'drum')
  }

  // Audition selected pad
  const handlePreview = () => {
    triggerPad(selectedPitch, 1)
  }

  // Export to .muzins
  const handleSaveMuzins = async () => {
    const kitName = targetTrack ? `${targetTrack.name}` : 'Custom_Drum_Kit'
    const muzinsData = {
      name: kitName,
      engineType: 'DrumKit',
      config: {
        kit: targetTrack?.drumKit ?? 'classic',
        decays: padDecays,
        pitches: padPitches,
        detunes: padDetunes,
        slides: padSlides,
        slideTimes: padSlideTimes,
        octaves: padOctaves,
        resonances: padResonances,
        curves: { types: padCurveTypes, tensions: padTensions, formulas: padFormulas },
        padModes,
        padSamples
      }
    }
    const jsonStr = JSON.stringify(muzinsData, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const filename = `${kitName.toLowerCase().replace(/\s+/g, '_')}.muzins`
    const saved = await saveFileWithDialog(blob, {
      filename,
      title: 'Save Drum Kit Patch',
      filters: [{ name: 'MuseGrid Instrument Patch', extensions: ['muzins'] }]
    })
    if (saved) {
      useStore.getState().showToast(`Saved kit: ${kitName}.muzins`, 'success')
    }
  }

  // Load .muzins drum kit file
  const handleLoadMuzins = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.muzins'
    input.onchange = (evt: any) => {
      const file = evt.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = async (re: any) => {
        try {
          const parsed = JSON.parse(re.target.result)
          if (!parsed || parsed.engineType !== 'DrumKit' || !parsed.config) {
            useStore.getState().showToast('Invalid .muzins Drum Kit format', 'error')
            return
          }
          const cfg = parsed.config
          if (cfg.decays) setPadDecays(cfg.decays)
          if (cfg.pitches) setPadPitches(cfg.pitches)
          if (cfg.detunes) setPadDetunes(cfg.detunes)
          if (cfg.slides) setPadSlides(cfg.slides)
          if (cfg.slideTimes) setPadSlideTimes(cfg.slideTimes)
          if (cfg.octaves) setPadOctaves(cfg.octaves)
          if (cfg.resonances) setPadResonances(cfg.resonances)
          if (cfg.curves) {
            if (cfg.curves.types) setPadCurveTypes(cfg.curves.types)
            if (cfg.curves.tensions) setPadTensions(cfg.curves.tensions)
            if (cfg.curves.formulas) setPadFormulas(cfg.curves.formulas)
          }
          if (cfg.padModes) setPadModes(cfg.padModes)
          if (cfg.padSamples) {
            setPadSamples(cfg.padSamples)
            // Decode and cache sample buffers into Web Audio
            const ctx = Tone.getContext().rawContext as AudioContext
            for (const [pStr, s] of Object.entries(cfg.padSamples as Record<string, DrumPadSample>)) {
              const pitch = parseInt(pStr)
              const srcUri = s?.dataUri || s?.audioBase64
              if (srcUri) {
                try {
                  const resp = await fetch(srcUri)
                  const ab = await resp.arrayBuffer()
                  const buf = await ctx.decodeAudioData(ab)
                  setPadBuffers(prev => {
                    const next = new Map(prev)
                    next.set(pitch, buf)
                    return next
                  })
                  if (targetTrack) {
                    audioEngine.setDrumPadSample(targetTrack.id, pitch, s)
                  }
                } catch (e) {
                  console.warn(`Failed to decode sample for pad ${pitch}`, e)
                }
              }
            }
          }
          if (targetTrack) {
            updateTrack(targetTrack.id, {
              drumKit: cfg.kit || targetTrack.drumKit || 'classic',
              customMuxins: parsed,
              drumDecays: cfg.decays || padDecays,
              drumPadModes: cfg.padModes || padModes,
              drumPadSamples: cfg.padSamples || padSamples
            })
          }
          useStore.getState().showToast(`Loaded Drum Kit: ${parsed.name || file.name}`, 'success')
        } catch {
          useStore.getState().showToast('Failed to parse .muzins Drum Kit file', 'error')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  // Save studio edits to project track
  const handleSaveToTrack = () => {
    if (!targetTrack) return

    // Compile LUT curves
    const compiledCurves: Record<number, { type?: string; tension?: number; formula?: string; lut?: number[] }> = {}
    for (let p = 0; p < 16; p++) {
      const type = padCurveTypes[p]
      const tension = padTensions[p]
      const formula = padFormulas[p]
      if (type) {
        const lut = generateCurveLut(type, tension ?? 0, formula || '', 256)
        compiledCurves[p] = { type, tension, formula, lut }
        audioEngine.setPadCurve(targetTrack.id, p, lut, tension ?? 0)
      }
    }

    // Set samples on audio engine
    for (const [pStr, s] of Object.entries(padSamples)) {
      const p = Number(pStr)
      const buf = padBuffers.get(p)
      audioEngine.setDrumPadSample(targetTrack.id, p, s, buf)
    }

    updateTrack(targetTrack.id, {
      drumKit: 'custom',
      drumDecays: { ...padDecays },
      drumOctaves: { ...padOctaves },
      drumResonances: { ...padResonances },
      drumPitches: { ...padPitches },
      drumDetunes: { ...padDetunes },
      drumSlides: { ...padSlides },
      drumSlideTimes: { ...padSlideTimes },
      drumPadCurves: compiledCurves,
      drumPadModes: { ...padModes },
      drumPadSamples: { ...padSamples }
    })
    audioEngine.createInstrument(targetTrack.id, 'drum')
    setHasUnsavedChanges(false)
    useStore.getState().showToast(`Saved drum kit settings to track "${targetTrack.name}"!`, 'success')
  }

  // Reset entire kit to factory defaults
  const handleResetToDefault = () => {
    setPadDecays({ ...DEFAULT_DECAYS })
    padDecaysRef.current = { ...DEFAULT_DECAYS }
    setPadPitches({})
    padPitchesRef.current = {}
    setPadDetunes({})
    padDetunesRef.current = {}
    setPadSlides({})
    padSlidesRef.current = {}
    setPadSlideTimes({})
    padSlideTimesRef.current = {}
    setPadOctaves({})
    padOctavesRef.current = {}
    setPadResonances({})
    padResonancesRef.current = {}
    setPadCurveTypes({})
    setPadTensions({})
    setPadFormulas({})
    setPadModes({})
    padModesRef.current = {}
    setPadSamples({})
    padSamplesRef.current = {}
    setPadBuffers(new Map())
    padBuffersRef.current = new Map()
    setHasUnsavedChanges(true)
    useStore.getState().showToast('Reset working kit to defaults (Click "Save to Track" to apply)', 'info')
  }

  if (!isVisible) return null

  return (
    <div
      className="animate-modal-bg"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(8, 9, 14, 0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        padding: '24px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsVisible(false)
      }}
    >
      <div
        className="animate-modal-card"
        style={{
          width: '1180px',
          maxWidth: '96vw',
          height: '840px',
          maxHeight: '92vh',
          background: '#12131a',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#fff',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
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
              <IconSliders size={16} color="#ff6b6b" />
            </div>
            <div>
              <span style={{ fontSize: '15px', fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>
                DRUM STUDIO
              </span>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '1px' }}>
                {targetTrack ? `Sculpting active track: ${targetTrack.name}` : 'No drum track selected'}
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Preview Selected Voice Button */}
            <button
              onClick={handlePreview}
              title="Audition current selected drum pad voice"
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
              title="Save all pad sounds, samples, curves, and settings to the project track"
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
              {hasUnsavedChanges ? 'SAVE TO TRACK ●' : 'SAVED TO TRACK ✓'}
            </button>

            {/* Reset to Default Kit Button */}
            <button
              onClick={handleResetToDefault}
              title="Reset entire drum kit to original factory defaults"
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
              title="Export drum kit configuration to .muzins file"
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

            {/* Load .muzins Button */}
            <button
              onClick={handleLoadMuzins}
              title="Import drum kit configuration from .muzins file"
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
              <IconUpload size={12} /> LOAD .MUZINS
            </button>

            {/* Load .WAV / Audio Sample Button */}
            <button
              onClick={() => {
                fileTargetPitchRef.current = selectedPitch
                fileInputRef.current?.click()
              }}
              title={`Load .WAV or audio sample directly into Pad ${selectedPitch} (${currentPadDef.shortName})`}
              style={{
                background: 'rgba(0, 230, 255, 0.12)',
                border: '1px solid #00e6ff',
                color: '#00e6ff',
                borderRadius: '6px',
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0, 230, 255, 0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0, 230, 255, 0.12)' }}
            >
              <IconUpload size={12} color="#00e6ff" />
              LOAD .WAV
            </button>

            {/* Kit Selector */}
            <select
              value={targetTrack?.drumKit ?? 'classic'}
              onChange={(e) => {
                if (targetTrack) {
                  updateTrack(targetTrack.id, { drumKit: e.target.value as DrumKit })
                  audioEngine.createInstrument(targetTrack.id, 'drum')
                }
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                padding: '6px 10px',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {DRUM_KITS.map(k => (
                <option key={k.value} value={k.value} style={{ background: '#181822', color: '#fff' }}>
                  Kit: {k.label}
                </option>
              ))}
            </select>

            {/* Test Groove Button */}
            <button
              onClick={() => setIsPlayingGroove(!isPlayingGroove)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: isPlayingGroove ? 'rgba(255, 77, 77, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${isPlayingGroove ? '#ff4d4d' : 'rgba(255, 255, 255, 0.1)'}`,
                color: isPlayingGroove ? '#ff6b6b' : '#eee',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {isPlayingGroove ? <IconStop size={12} /> : <IconPlay size={12} />}
              {isPlayingGroove ? 'STOP GROOVE' : 'TEST GROOVE'}
            </button>

            {/* Close Button */}
            <button
              onClick={() => setIsVisible(false)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#aaa',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#fff'
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#aaa'
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
              }}
            >
              <IconX size={15} />
            </button>
          </div>
        </div>

        {/* Main Studio Body: 2 Columns */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left: 16-Pad Grid (46% width) */}
          <div
            style={{
              width: '46%',
              borderRight: '1px solid rgba(255, 255, 255, 0.06)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              background: 'rgba(10, 10, 16, 0.35)',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', letterSpacing: '0.08em' }}>
                16-PAD MATRIX
              </span>
              <span style={{ fontSize: '10px', color: '#666' }}>
                HOTKEYS: 1-4, Q-R, A-F, Z-V
              </span>
            </div>

            {/* 4x4 Pads Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gridTemplateRows: 'repeat(4, 1fr)',
                gap: '10px',
                aspectRatio: '1 / 1',
                width: '100%',
                maxHeight: '430px'
              }}
            >
              {PAD_DEFINITIONS.map(pad => {
                const isSelected = selectedPitch === pad.pitch
                const isTriggered = activePadTriggers[pad.pitch]
                const isPadSample = (padModes[pad.pitch] === 'sample') || !!padSamples[pad.pitch]
                const sampleInfo = padSamples[pad.pitch]
                const isDraggedOver = dragOverPad === pad.pitch
                const customDecay = isPadSample
                  ? (sampleInfo?.decay ?? padDecays[pad.pitch] ?? DEFAULT_DECAYS[pad.pitch])
                  : (padDecays[pad.pitch] ?? DEFAULT_DECAYS[pad.pitch])
                const customPitch = isPadSample
                  ? (sampleInfo?.tuning ?? 0)
                  : (padPitches[pad.pitch] ?? 0)

                return (
                  <div
                    key={pad.pitch}
                    onClick={() => {
                      setSelectedPitch(pad.pitch)
                      triggerPad(pad.pitch, 1)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverPad(pad.pitch)
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverPad(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverPad(null)
                      const file = e.dataTransfer.files?.[0]
                      if (file) {
                        setSelectedPitch(pad.pitch)
                        handleLoadSampleFile(pad.pitch, file)
                      }
                    }}
                    style={{
                      background: isDraggedOver
                        ? 'rgba(0, 230, 255, 0.22)'
                        : isTriggered
                        ? 'rgba(255, 255, 255, 0.14)'
                        : isSelected
                        ? (isPadSample ? 'rgba(0, 230, 255, 0.08)' : 'rgba(255, 255, 255, 0.06)')
                        : 'rgba(255, 255, 255, 0.03)',
                      border: `1.5px solid ${
                        isDraggedOver
                          ? '#00e6ff'
                          : isTriggered
                          ? '#ffffff'
                          : isSelected
                          ? (isPadSample ? '#00e6ff' : pad.color)
                          : isPadSample
                          ? 'rgba(0, 230, 255, 0.35)'
                          : 'rgba(255, 255, 255, 0.08)'
                      }`,
                      borderRadius: '8px',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                      transition: 'transform 0.05s ease, background 0.08s ease, border-color 0.1s ease',
                      transform: isTriggered ? 'scale(0.97)' : isSelected ? 'scale(1.01)' : 'scale(1)',
                      boxShadow: 'none',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Top Row: Pitch Index & Badges */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            color: isSelected ? (isPadSample ? '#00e6ff' : pad.color) : '#777',
                            letterSpacing: '0.05em'
                          }}
                        >
                          P{pad.pitch}
                        </span>
                        <span
                          style={{
                            fontSize: '8px',
                            fontWeight: 800,
                            padding: '1px 4px',
                            borderRadius: '3px',
                            background: isPadSample ? 'rgba(0, 230, 255, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                            color: isPadSample ? '#00e6ff' : '#888',
                            letterSpacing: '0.04em'
                          }}
                        >
                          {isPadSample ? 'SMP' : 'SYN'}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          background: 'rgba(255, 255, 255, 0.08)',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          color: '#bbb'
                        }}
                      >
                        {pad.hotkey}
                      </span>
                    </div>

                    {/* Middle: Short Name */}
                    <div style={{ textAlign: 'center', margin: '2px 0' }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 800,
                          color: isTriggered ? '#ffffff' : isSelected ? '#ffffff' : '#dddddd',
                          letterSpacing: '0.04em'
                        }}
                      >
                        {pad.shortName}
                      </div>
                      <div
                        style={{
                          fontSize: '9px',
                          color: isPadSample ? '#00e6ff' : '#888',
                          marginTop: '2px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={isPadSample ? (sampleInfo?.name || 'Sample') : pad.name}
                      >
                        {isPadSample ? (sampleInfo?.name || 'Sample') : pad.name}
                      </div>
                    </div>

                    {/* Bottom Status / Tuning Readout */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '9px',
                        color: '#666',
                        borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                        paddingTop: '3px'
                      }}
                    >
                      <span>{customPitch >= 0 ? `+${customPitch}` : customPitch}st</span>
                      <span>{(customDecay * 1000).toFixed(0)}ms</span>
                    </div>

                    {/* Left LED Color Bar */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: '3px',
                        background: isPadSample ? '#00e6ff' : pad.color
                      }}
                    />
                  </div>
                )
              })}
            </div>

            {/* Kit Presets Carousel */}
            <div
              style={{
                marginTop: 'auto',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '12px',
                padding: '10px 12px'
              }}
            >
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Kit Presets
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                {Object.entries(KIT_PRESETS).map(([key, p]) => (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '8px',
                      padding: '8px',
                      color: '#ddd',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.09)'
                      e.currentTarget.style.color = '#fff'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
                      e.currentTarget.style.color = '#ddd'
                    }}
                  >
                    <div>{p.name}</div>
                    <div style={{ fontSize: '9px', color: '#777', marginTop: '2px', fontWeight: 400 }}>
                      {p.description.slice(0, 32)}...
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Deep Voice Sculptor (54% width) */}
          <div
            style={{
              width: '54%',
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              overflowY: 'auto'
            }}
          >
            {/* Selected Pad Title & Engine Mode Selector Card */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '3px',
                      background: currentPadMode === 'sample' ? '#00e6ff' : currentPadDef.color
                    }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 800 }}>
                    PAD {currentPadDef.pitch}: {currentPadDef.name.toUpperCase()}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      background: currentPadMode === 'sample' ? 'rgba(0, 230, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)',
                      color: currentPadMode === 'sample' ? '#00e6ff' : '#bbb',
                      fontWeight: 700
                    }}
                  >
                    {currentPadMode === 'sample' ? 'SAMPLE ENGINE' : currentPadDef.synthType.toUpperCase()}
                  </span>
                </div>

                {/* Audition Hit Button */}
                <button
                  onClick={() => triggerPad(currentPadDef.pitch, 1)}
                  style={{
                    background: currentPadMode === 'sample' ? '#00e6ff' : currentPadDef.color,
                    border: 'none',
                    borderRadius: '6px',
                    padding: '5px 12px',
                    color: currentPadMode === 'sample' ? '#000' : '#fff',
                    fontSize: '11px',
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <IconPlay size={12} fill="currentColor" /> AUDITION [HOTKEY {currentPadDef.hotkey}]
                </button>
              </div>

              {/* Pad Sound Source / Sample Chooser Selector (Always Visible) */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  gap: '8px'
                }}
              >
                {/* Row 1: Dropdown Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                  <IconWaveform size={14} color={currentPadMode === 'sample' ? '#00e6ff' : '#aaa'} />
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', whiteSpace: 'nowrap' }}>
                    PAD SOUND:
                  </span>
                  <select
                    value={currentPadMode === 'sample' ? (currentSample?.name || 'custom') : 'synth'}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val === 'synth') {
                        handleSetPadMode(selectedPitch, 'synth')
                      } else if (val === 'upload') {
                        fileTargetPitchRef.current = selectedPitch
                        fileInputRef.current?.click()
                      } else {
                        handleLoadPresetSample(selectedPitch, val)
                      }
                    }}
                    style={{
                      background: '#161922',
                      color: currentPadMode === 'sample' ? '#00e6ff' : '#ffffff',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '6px',
                      padding: '6px 10px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      flex: 1,
                      outline: 'none'
                    }}
                  >
                    <option value="synth">Built-in Synth ({currentPadDef.synthType.toUpperCase()})</option>
                    <optgroup label="Studio Sample Presets">
                      {DRUM_SAMPLE_PRESETS.map(preset => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name} ({preset.durationSec}s)
                        </option>
                      ))}
                    </optgroup>
                    <option value="upload">Choose Audio File (WAV/MP3)...</option>
                  </select>
                </div>

                {/* Row 2: Action Buttons (Load, Record Mic, Clear) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      fileTargetPitchRef.current = selectedPitch
                      fileInputRef.current?.click()
                    }}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '6px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#fff',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'all 0.15s ease'
                    }}
                    title="Choose and load your own WAV or MP3 audio file"
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }}
                  >
                    <IconUpload size={12} color="#fff" />
                    Load Sample
                  </button>
                  <button
                    onClick={isRecordingMic ? stopMicRecording : startMicRecording}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '6px',
                      background: isRecordingMic ? 'rgba(255, 77, 77, 0.22)' : 'rgba(255, 77, 77, 0.08)',
                      border: `1px solid ${isRecordingMic ? '#ff4d4d' : 'rgba(255, 77, 77, 0.35)'}`,
                      color: isRecordingMic ? '#ff4d4d' : '#ff8787',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      boxShadow: isRecordingMic ? '0 0 12px rgba(255, 77, 77, 0.45)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                    title={isRecordingMic ? "Click to stop recording and assign to this drum pad" : "Record live sample from microphone onto this drum pad"}
                  >
                    <IconMic size={12} color={isRecordingMic ? '#ff4d4d' : '#ff8787'} />
                    {isRecordingMic ? `Stop REC (${micSeconds}s)` : 'Record Mic'}
                  </button>
                  {currentPadMode === 'sample' && (
                    <button
                      onClick={() => handleClearSample(selectedPitch)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        background: 'rgba(255, 77, 77, 0.1)',
                        border: '1px solid rgba(255, 77, 77, 0.25)',
                        color: '#ff6b6b',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 77, 77, 0.2)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 77, 77, 0.1)' }}
                      title="Reset pad back to physical synth"
                    >
                      <IconTrash size={12} color="#ff6b6b" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Mode Switcher: Physical Synthesis vs Drum Sampler */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'rgba(0, 0, 0, 0.45)',
                  padding: '3px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  gap: '4px'
                }}
              >
                <button
                  onClick={() => handleSetPadMode(selectedPitch, 'synth')}
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: currentPadMode === 'synth'
                      ? 'rgba(255, 255, 255, 0.12)'
                      : 'transparent',
                    color: currentPadMode === 'synth' ? '#ffffff' : '#888',
                    fontWeight: 800,
                    fontSize: '11px',
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                    boxShadow: 'none'
                  }}
                >
                  <IconSliders size={13} color={currentPadMode === 'synth' ? currentPadDef.color : '#888'} />
                  SYNTHESIS MODEL
                </button>
                <button
                  onClick={() => handleSetPadMode(selectedPitch, 'sample')}
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    borderRadius: '6px',
                    border: currentPadMode === 'sample' ? '1px solid rgba(0, 230, 255, 0.4)' : 'none',
                    background: currentPadMode === 'sample'
                      ? 'rgba(0, 230, 255, 0.18)'
                      : 'transparent',
                    color: currentPadMode === 'sample' ? '#00e6ff' : '#888',
                    fontWeight: 800,
                    fontSize: '11px',
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                    boxShadow: 'none'
                  }}
                >
                  <IconWaveform size={13} color={currentPadMode === 'sample' ? '#00e6ff' : '#888'} />
                  DRUM SAMPLER {currentSample ? `(${currentSample.name})` : ''}
                </button>
              </div>
            </div>

            {/* --- SYNTHESIS MODEL VIEW --- */}
            {currentPadMode === 'synth' && (
              <>
                {/* Interactive Draggable Transient Waveform Card */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', letterSpacing: '0.06em' }}>
                      TRANSIENT & DECAY GRAPH
                    </span>
                    <span style={{ fontSize: '10px', color: '#666' }}>
                      Drag peak for punch, end for decay
                    </span>
                  </div>

                  <div
                    style={{
                      width: '100%',
                      height: '135px',
                      background: 'rgba(0, 0, 0, 0.45)',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      overflow: 'hidden',
                      position: 'relative'
                    }}
                  >
                    <canvas
                      ref={canvasRef}
                      width={580}
                      height={135}
                      style={{ width: '100%', height: '100%', display: 'block', cursor: canvasCursor }}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseLeave}
                    />
                  </div>
                </div>

                {/* Section 1: Pitch & 808 Sub Tuning */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', letterSpacing: '0.06em' }}>
                      PITCH TUNING & 808 SUB GLIDE
                    </span>
                    <span style={{ fontSize: '10px', color: '#666' }}>
                      Base: {currentPadDef.baseFreq}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Pitch Transpose</span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>
                          {(padPitches[selectedPitch] ?? 0) >= 0 ? '+' : ''}
                          {padPitches[selectedPitch] ?? 0} st
                        </span>
                      </div>
                      <AppSlider
                        min={-24}
                        max={24}
                        step={1}
                        value={padPitches[selectedPitch] ?? 0}
                        color={currentPadDef.color}
                        onChange={(val) => {
                          commitPadPitch(selectedPitch, val)
                          triggerPad(selectedPitch, 0.9, { pitchOffset: val })
                        }}
                      />
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Fine Detune</span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>
                          {(padDetunes[selectedPitch] ?? 0) >= 0 ? '+' : ''}
                          {padDetunes[selectedPitch] ?? 0} cents
                        </span>
                      </div>
                      <AppSlider
                        min={-100}
                        max={100}
                        step={1}
                        value={padDetunes[selectedPitch] ?? 0}
                        color={currentPadDef.color}
                        onChange={(val) => {
                          commitPadDetune(selectedPitch, val)
                          triggerPad(selectedPitch, 0.9, { detune: val })
                        }}
                      />
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>808 Pitch Slide</span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>
                          {(padSlides[selectedPitch] ?? 0) >= 0 ? '+' : ''}
                          {padSlides[selectedPitch] ?? 0} st
                        </span>
                      </div>
                      <AppSlider
                        min={-24}
                        max={24}
                        step={1}
                        value={padSlides[selectedPitch] ?? 0}
                        color={currentPadDef.color}
                        onChange={(val) => {
                          commitPadSlide(selectedPitch, val)
                          triggerPad(selectedPitch, 0.9, { slide: val })
                        }}
                      />
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Slide Time</span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>
                          {padSlideTimes[selectedPitch] ?? 120} ms
                        </span>
                      </div>
                      <AppSlider
                        min={20}
                        max={500}
                        step={10}
                        value={padSlideTimes[selectedPitch] ?? 120}
                        color={currentPadDef.color}
                        onChange={(val) => {
                          commitPadSlideTime(selectedPitch, val)
                          triggerPad(selectedPitch, 0.9, { slideTime: val })
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Amplitude Decay & Punch Envelope */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', letterSpacing: '0.06em' }}>
                      ENVELOPE & TRANSIENT PUNCH (DRAGGABLE ON GRAPH)
                    </span>
                    <span style={{ fontSize: '10px', color: '#666' }}>
                      Decay Tail Length
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Decay Length</span>
                        <span style={{ fontWeight: 700, color: '#fff' }}>
                          {((padDecays[selectedPitch] ?? DEFAULT_DECAYS[selectedPitch] ?? 0.3) * 1000).toFixed(0)} ms
                        </span>
                      </div>
                      <AppSlider
                        min={0.02}
                        max={3.0}
                        step={0.01}
                        value={padDecays[selectedPitch] ?? DEFAULT_DECAYS[selectedPitch] ?? 0.3}
                        color={currentPadDef.color}
                        onChange={(val) => {
                          commitPadDecay(selectedPitch, val)
                          triggerPad(selectedPitch, 0.9, { decay: val })
                        }}
                      />
                    </div>

                    {currentPadDef.synthType === 'membrane' ? (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                          <span style={{ color: '#bbb' }}>Peak / Punch (Apex)</span>
                          <span style={{ fontWeight: 700, color: '#00e6ff' }}>
                            {padOctaves[selectedPitch] ?? (selectedPitch === 0 ? 7 : (DEFAULT_OCTAVES[selectedPitch] ?? 4))} oct
                          </span>
                        </div>
                        <AppSlider
                          min={1}
                          max={8}
                          step={1}
                          value={padOctaves[selectedPitch] ?? (selectedPitch === 0 ? 7 : (DEFAULT_OCTAVES[selectedPitch] ?? 4))}
                          color={currentPadDef.color}
                          onChange={(val) => {
                            commitPadOctave(selectedPitch, val)
                            triggerPad(selectedPitch, 0.9, { octaves: val })
                          }}
                        />
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                          <span style={{ color: '#bbb' }}>Peak / Resonance (Apex)</span>
                          <span style={{ fontWeight: 700, color: '#00e6ff' }}>
                            {padResonances[selectedPitch] ?? (DEFAULT_RESONANCES[selectedPitch] ?? 800)} Hz
                          </span>
                        </div>
                        <AppSlider
                          min={100}
                          max={6000}
                          step={25}
                          value={padResonances[selectedPitch] ?? (DEFAULT_RESONANCES[selectedPitch] ?? 800)}
                          color={currentPadDef.color}
                          onChange={(val) => {
                            commitPadResonance(selectedPitch, val)
                            triggerPad(selectedPitch, 0.9, { resonance: val })
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 3: Alien Transient Curve & Dynamics Matrix */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    boxShadow: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 900, color: '#00e6ff', letterSpacing: '0.06em' }}>
                        ALIEN TRANSIENT CURVE MATRIX • PAD {selectedPitch} ({currentPadDef.shortName})
                      </span>
                    </div>
                    <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#00ff88', background: 'rgba(0, 255, 136, 0.1)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(0, 255, 136, 0.2)' }}>
                      C++ ENGINE LUT
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                    {(['exponential', 'linear', 'logarithmic', 'scurve', 'custom'] as const).map(ct => {
                      const isSelected = currentCurveType === ct
                      const labels: Record<string, string> = {
                        exponential: 'ACOUSTIC EXP',
                        linear: 'LINEAR',
                        logarithmic: 'PUNCH LOG',
                        scurve: 'SIGMOID S',
                        custom: 'BIO f(x)'
                      }
                      return (
                        <button
                          key={ct}
                          onClick={() => {
                            commitPadCurve(selectedPitch, ct, currentTension, currentFormula)
                            triggerPad(selectedPitch, 0.9)
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = isSelected ? '#34598f' : 'rgba(255, 255, 255, 0.08)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = isSelected ? '#2b4c7e' : 'rgba(255, 255, 255, 0.04)'
                          }}
                          style={{
                            background: isSelected ? '#2b4c7e' : 'rgba(255, 255, 255, 0.04)',
                            color: isSelected ? '#ffffff' : '#bbb',
                            border: `1px solid ${isSelected ? '#4dabf7' : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: '6px',
                            padding: '6px 4px',
                            fontSize: '9px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                            boxShadow: 'none'
                          }}
                        >
                          {labels[ct]}
                        </button>
                      )
                    })}
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', fontWeight: 700, marginBottom: '3px' }}>
                      <span style={{ color: '#00e6ff' }}>TRANSIENT WARP TENSION</span>
                      <span style={{ fontFamily: 'monospace', color: '#ffffff' }}>
                        {currentTension > 0 ? `+${currentTension.toFixed(2)}` : currentTension.toFixed(2)}
                        {' '}({currentTension < -0.2 ? 'Steep Drop' : currentTension > 0.2 ? 'Boom / Fat' : 'Natural Shell'})
                      </span>
                    </div>
                    <AppSlider
                      min={-1}
                      max={1}
                      step={0.02}
                      value={currentTension}
                      color="#00e6ff"
                      onChange={(t) => commitPadCurve(selectedPitch, currentCurveType, t, currentFormula)}
                    />
                  </div>

                  {currentCurveType === 'custom' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, color: '#00ff88', letterSpacing: '0.04em' }}>
                          CUSTOM TRANSIENT FORMULA f(x)
                        </span>
                        <span style={{ fontSize: '9px', color: '#777', fontFamily: 'monospace' }}>
                          x ∈ [0, 1] • Math.* functions supported
                        </span>
                      </div>

                      <input
                        type="text"
                        value={currentFormula}
                        onChange={(e) => {
                          const val = e.target.value
                          commitPadCurve(selectedPitch, 'custom', currentTension, val)
                        }}
                        placeholder="e.g. pow(1 - x, 4.2) or exp(-5.5 * x)"
                        style={{
                          background: '#090a10',
                          color: '#00ff88',
                          border: '1px solid rgba(0, 255, 136, 0.35)',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          outline: 'none',
                          width: '100%',
                          boxSizing: 'border-box'
                        }}
                      />

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {CURVE_FORMULA_PRESETS.map(p => (
                          <button
                            key={p.id}
                            onClick={() => {
                              commitPadCurve(selectedPitch, 'custom', currentTension, p.formula)
                              triggerPad(selectedPitch, 0.9)
                            }}
                            title={p.description}
                            style={{
                              background: currentFormula === p.formula ? 'rgba(0, 255, 136, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                              border: `1px solid ${currentFormula === p.formula ? '#00ff88' : 'rgba(255, 255, 255, 0.08)'}`,
                              borderRadius: '4px',
                              color: currentFormula === p.formula ? '#ffffff' : '#aaa',
                              fontSize: '9px',
                              fontWeight: 700,
                              padding: '3px 7px',
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
              </>
            )}

            {/* --- DRUM SAMPLER VIEW --- */}
            {currentPadMode === 'sample' && (
              <>
                {/* 1. Waveform Viewport Card with Draggable Trim Markers */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    boxShadow: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <IconWaveform size={14} color="#00e6ff" />
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#00e6ff', letterSpacing: '0.06em' }}>
                        SAMPLE WAVEFORM & SAMPLE TRIMMING
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', color: '#888' }}>
                      Drag green handle for Start • red handle for End
                    </span>
                  </div>

                  {/* Interactive Waveform Canvas */}
                  <div
                    style={{
                      width: '100%',
                      height: '135px',
                      background: 'rgba(0, 0, 0, 0.55)',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      overflow: 'hidden',
                      position: 'relative'
                    }}
                  >
                    <canvas
                      ref={sampleCanvasRef}
                      width={580}
                      height={135}
                      style={{ width: '100%', height: '100%', display: 'block', cursor: sampleCursor }}
                      onMouseDown={handleSampleCanvasMouseDown}
                      onMouseMove={handleSampleCanvasMouseMove}
                      onMouseUp={handleSampleCanvasMouseUp}
                      onMouseLeave={handleSampleCanvasMouseLeave}
                    />
                  </div>

                  {/* Waveform Controls Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', fontFamily: 'monospace' }}>
                      <span style={{ color: '#00ff88' }}>
                        START: {((currentSample?.startOffset ?? 0) * 100).toFixed(0)}%
                        {currentBuffer && ` (${((currentSample?.startOffset ?? 0) * currentBuffer.duration * 1000).toFixed(0)}ms)`}
                      </span>
                      <span style={{ color: '#ff4d4d' }}>
                        END: {((currentSample?.endOffset ?? 1) * 100).toFixed(0)}%
                        {currentBuffer && ` (${((currentSample?.endOffset ?? 1) * currentBuffer.duration * 1000).toFixed(0)}ms)`}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Reverse Button */}
                      <button
                        onClick={() => {
                          const rev = !(currentSample?.reverse)
                          updateSampleParam(selectedPitch, { reverse: rev })
                          triggerPad(selectedPitch, 1)
                        }}
                        style={{
                          background: currentSample?.reverse ? 'rgba(218, 119, 242, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                          border: `1px solid ${currentSample?.reverse ? '#da77f2' : 'rgba(255, 255, 255, 0.1)'}`,
                          color: currentSample?.reverse ? '#da77f2' : '#bbb',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        ⇄ REVERSE {currentSample?.reverse ? 'ON' : 'OFF'}
                      </button>

                      {/* Normalize Button */}
                      <button
                        onClick={() => handleNormalizeSample(selectedPitch)}
                        title="Peak-normalize sample amplitude to 0 dB"
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#bbb',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#bbb'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                      >
                        ⇪ NORMALIZE
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. Audio Sample Source & One-Shot Presets Card */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', letterSpacing: '0.06em' }}>
                        SAMPLE FILE & PRESET ONE-SHOTS
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Browse File Button */}
                      <button
                        onClick={() => {
                          fileTargetPitchRef.current = selectedPitch
                          fileInputRef.current?.click()
                        }}
                        style={{
                          background: 'rgba(0, 230, 255, 0.15)',
                          border: '1px solid rgba(0, 230, 255, 0.4)',
                          color: '#00e6ff',
                          borderRadius: '6px',
                          padding: '5px 12px',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0, 230, 255, 0.25)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0, 230, 255, 0.15)' }}
                      >
                        <IconUpload size={12} /> BROWSE .WAV / .MP3
                      </button>

                      {/* Clear / Revert Sample Button */}
                      <button
                        onClick={() => handleClearSample(selectedPitch)}
                        title="Remove sample and revert pad back to physical synth"
                        style={{
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          color: '#888',
                          borderRadius: '6px',
                          padding: '5px 10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#ff6b6b' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#888' }}
                      >
                        <IconTrash size={12} /> REVERT
                      </button>
                    </div>
                  </div>

                  {/* Active Sample Meta Banner */}
                  <div
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '11px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#666' }}>Active File:</span>
                      <span style={{ color: '#ffffff', fontWeight: 800, fontFamily: 'monospace' }}>
                        {currentSample?.name || 'No Audio Sample Loaded'}
                      </span>
                    </div>
                    {currentBuffer && (
                      <div style={{ color: '#888', fontSize: '10px', fontFamily: 'monospace' }}>
                        {(currentBuffer.duration).toFixed(2)}s • {currentBuffer.sampleRate} Hz • {currentBuffer.numberOfChannels} ch
                      </div>
                    )}
                  </div>

                  {/* Quick Studio One-Shot Preset Pills */}
                  <div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#888', marginBottom: '6px', textTransform: 'uppercase' }}>
                      Studio Preset One-Shots (Instant Load)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                      {DRUM_SAMPLE_PRESETS.map(preset => {
                        const isCurrent = currentSample?.name === preset.name
                        return (
                          <button
                            key={preset.id}
                            onClick={() => handleLoadPresetSample(selectedPitch, preset.id)}
                            style={{
                              background: isCurrent ? 'rgba(0, 230, 255, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                              border: `1px solid ${isCurrent ? '#00e6ff' : 'rgba(255, 255, 255, 0.08)'}`,
                              borderRadius: '6px',
                              padding: '6px 8px',
                              color: isCurrent ? '#00e6ff' : '#ccc',
                              fontSize: '10px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              textAlign: 'left',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={e => {
                              if (!isCurrent) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'
                                e.currentTarget.style.color = '#fff'
                              }
                            }}
                            onMouseLeave={e => {
                              if (!isCurrent) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
                                e.currentTarget.style.color = '#ccc'
                              }
                            }}
                          >
                            <span>{preset.name}</span>
                            <span style={{ fontSize: '9px', color: '#666', fontFamily: 'monospace' }}>
                              {preset.durationSec}s
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* 3. Pitch & Fine Tuning Card */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', letterSpacing: '0.06em' }}>
                      SAMPLE PITCH & FINE DETUNING
                    </span>
                    <span style={{ fontSize: '10px', color: '#666' }}>
                      Resamples playback rate in real time
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    {/* Pitch Transpose Slider */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Pitch Transpose</span>
                        <span style={{ fontWeight: 700, color: '#00e6ff', fontFamily: 'monospace' }}>
                          {(currentSample?.tuning ?? 0) >= 0 ? '+' : ''}
                          {currentSample?.tuning ?? 0} st
                        </span>
                      </div>
                      <AppSlider
                        min={-24}
                        max={24}
                        step={1}
                        value={currentSample?.tuning ?? 0}
                        color="#00e6ff"
                        onChange={(val) => {
                          updateSampleParam(selectedPitch, { tuning: val })
                          triggerPad(selectedPitch, 0.9, { pitchOffset: val })
                        }}
                      />
                    </div>

                    {/* Fine Detune Slider */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Fine Detune</span>
                        <span style={{ fontWeight: 700, color: '#00e6ff', fontFamily: 'monospace' }}>
                          {(currentSample?.fineTune ?? 0) >= 0 ? '+' : ''}
                          {currentSample?.fineTune ?? 0} cents
                        </span>
                      </div>
                      <AppSlider
                        min={-100}
                        max={100}
                        step={1}
                        value={currentSample?.fineTune ?? 0}
                        color="#00e6ff"
                        onChange={(val) => {
                          updateSampleParam(selectedPitch, { fineTune: val })
                          triggerPad(selectedPitch, 0.9, { detune: val })
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Dynamics, Envelope Decay Trim & Stereo Panning Card */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', letterSpacing: '0.06em' }}>
                      SAMPLE DYNAMICS, ENVELOPE DECAY & PANNING
                    </span>
                    <span style={{ fontSize: '10px', color: '#666' }}>
                      Routes to Track FX Rack
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                    {/* Linear Gain / Volume */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Gain / Vol</span>
                        <span style={{ fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                          {(((currentSample?.volume ?? 1.0)) * 100).toFixed(0)}%
                        </span>
                      </div>
                      <AppSlider
                        min={0.0}
                        max={2.0}
                        step={0.05}
                        value={currentSample?.volume ?? 1.0}
                        color="#00e6ff"
                        onChange={(val) => {
                          updateSampleParam(selectedPitch, { volume: val })
                          triggerPad(selectedPitch, val)
                        }}
                      />
                    </div>

                    {/* Stereo Pan */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Stereo Pan</span>
                        <span style={{ fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                          {(currentSample?.pan ?? 0) === 0 ? 'C' : (currentSample?.pan ?? 0) < 0 ? `${Math.abs(Math.round((currentSample?.pan ?? 0) * 100))}%L` : `${Math.round((currentSample?.pan ?? 0) * 100)}%R`}
                        </span>
                      </div>
                      <AppSlider
                        min={-1.0}
                        max={1.0}
                        step={0.05}
                        value={currentSample?.pan ?? 0}
                        color="#00e6ff"
                        onChange={(val) => updateSampleParam(selectedPitch, { pan: val })}
                      />
                    </div>

                    {/* Envelope Decay Tail */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#bbb' }}>Decay Tail</span>
                        <span style={{ fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                          {(((currentSample?.decay ?? 0.8)) * 1000).toFixed(0)} ms
                        </span>
                      </div>
                      <AppSlider
                        min={0.02}
                        max={4.0}
                        step={0.02}
                        value={currentSample?.decay ?? 0.8}
                        color="#00e6ff"
                        onChange={(val) => {
                          updateSampleParam(selectedPitch, { decay: val })
                          triggerPad(selectedPitch, 0.9, { decay: val })
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* 5. Choke Group Assignment Card */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', letterSpacing: '0.06em' }}>
                      CHOKE GROUP ASSIGNMENT
                    </span>
                    <span style={{ fontSize: '10px', color: '#666' }}>
                      Pads in same group mute each other (e.g. Closed Hat cuts Open Hat)
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                    {[
                      { id: 0, label: 'OFF (NONE)' },
                      { id: 1, label: 'CHOKE 1 (HATS)' },
                      { id: 2, label: 'CHOKE 2' },
                      { id: 3, label: 'CHOKE 3' },
                      { id: 4, label: 'CHOKE 4' }
                    ].map(grp => {
                      const isCurrent = (currentSample?.chokeGroup ?? 0) === grp.id
                      return (
                        <button
                          key={grp.id}
                          onClick={() => {
                            updateSampleParam(selectedPitch, { chokeGroup: grp.id })
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = isCurrent ? '#34598f' : 'rgba(255, 255, 255, 0.08)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = isCurrent ? '#2b4c7e' : 'rgba(255, 255, 255, 0.04)'
                          }}
                          style={{
                            background: isCurrent ? '#2b4c7e' : 'rgba(255, 255, 255, 0.04)',
                            color: isCurrent ? '#ffffff' : '#bbb',
                            border: `1px solid ${isCurrent ? '#4dabf7' : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: '6px',
                            padding: '7px 4px',
                            fontSize: '9px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                            boxShadow: 'none'
                          }}
                        >
                          {grp.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Bottom Actions: Reset Pad & Apply All to Track */}
            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px' }}>
              <button
                onClick={() => {
                  if (currentPadMode === 'sample') {
                    handleClearSample(selectedPitch)
                  } else {
                    commitPadDecay(selectedPitch, DEFAULT_DECAYS[selectedPitch] ?? 0.3)
                    setPadPitches(prev => ({ ...prev, [selectedPitch]: 0 }))
                    setPadDetunes(prev => ({ ...prev, [selectedPitch]: 0 }))
                    setPadSlides(prev => ({ ...prev, [selectedPitch]: 0 }))
                    commitPadCurve(selectedPitch, 'exponential', selectedPitch === 0 ? -0.2 : 0, selectedPitch === 0 ? 'pow(1 - x, 4.2)' : 'exp(-5.5 * x)')
                  }
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '7px 14px',
                  color: '#aaa',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {currentPadMode === 'sample' ? 'Reset / Revert Pad Sample' : 'Reset Selected Pad'}
              </button>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => {
                    if (targetTrack) {
                      updateTrack(targetTrack.id, {
                        drumDecays: padDecays,
                        drumPadModes: padModes,
                        drumPadSamples: padSamples
                      })
                      setIsVisible(false)
                    }
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = '#34598f'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = '#2b4c7e'
                  }}
                  style={{
                    background: '#2b4c7e',
                    border: '1px solid #4dabf7',
                    borderRadius: '6px',
                    padding: '8px 20px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 800,
                    letterSpacing: '0.03em',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                >
                  SAVE & CLOSE
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Hidden Audio Sample File Input */}
        <input
          type="file"
          ref={fileInputRef}
          accept="audio/*,.wav,.mp3,.ogg,.flac"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              handleLoadSampleFile(fileTargetPitchRef.current, file)
              e.target.value = ''
            }
          }}
        />
      </div>
    </div>
  )
}
