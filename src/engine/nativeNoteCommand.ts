import * as Tone from 'tone'
import { useStore, type Track } from './store'
import { buildCurveLut } from '../utils/glideCurves'
import { buildNoteFxChain, type NoteFxEffectSpec } from '../utils/noteFxChain'

export interface NativeNoteOnCommand {
  type: 'noteOn'
  trackId: string
  instrument: string
  pitch: number
  velocity: number
  duration: number
  slideEnd?: number
  slideTime: number
  slideCurve?: number[]
  steppedGlide?: boolean
  vibratoDepth?: number
  vibratoRate?: number
  vibratoWave?: number
  vibratoDelay?: number
  vibratoFade?: number
  tremoloDepth?: number
  tremoloRate?: number
  tremoloWave?: number
  filterStart?: number
  filterEnd?: number
  filterSweepTime?: number
  filterCurve?: number[]
  /** Per-note sound override. Kind tells JUCE which engine to route the note to. */
  overrideKind?: 'preset' | 'kit' | 'vst3'
  overrideValue?: string
  /** Per-note FX chain, registered by JUCE before the note is triggered. */
  fxChainId?: number
  fxChainSignature?: string
  fxChainEffects?: NoteFxEffectSpec[]
  lyric: string
  pitchOffset: number
  drumDecay: number
  slideSemitones: number
  punchOctaves: number
  resonanceHz: number
}

const waveformIndex = (wave?: string) => wave === 'triangle' ? 1 : wave === 'square' ? 2 : 0

interface NoteCommandSource {
  trackId: string
  type: string
  pitch: string | number
  duration: string | number
  velocity: number
  detune?: number
  pitchEnd?: string | number
  noteData?: any
  track?: Track | undefined
  /** Export-only transposition added on top of what live playback would send. */
  extraPitchOffset?: number
}

/**
 * Builds the exact `noteOn` payload the JUCE engine receives for one note, shared by live
 * playback and the offline bounce so a WAV export triggers the same voices as the transport.
 */
export function buildNativeNoteOnCommand(src: NoteCommandSource): NativeNoteOnCommand {
  const { trackId, type, pitch, duration, velocity, detune, pitchEnd, noteData, track } = src

  const effectiveInstrument = (type === 'drum' || track?.instrument === 'drum') ? 'drum' : (type || track?.instrument || 'synth')

  let startMidi = 0
  if (typeof pitch === 'number') {
    startMidi = pitch
  } else if (typeof pitch === 'string') {
    const num = Number(pitch)
    if (!isNaN(num)) {
      startMidi = num
    } else {
      startMidi = Tone.Frequency(pitch).toMidi()
    }
  }

  let endMidi: number | undefined = undefined
  let slideTime = 0
  if (pitchEnd !== undefined) {
    endMidi = typeof pitchEnd === 'number' ? pitchEnd : Tone.Frequency(pitchEnd).toMidi()
  }
  if (noteData?.pitchSlide) {
    endMidi = startMidi + noteData.pitchSlide
    // 0 ticks means "glide across the whole note"; the JUCE voice applies that fallback.
    slideTime = noteData.pitchSlideTime ? Tone.Time(noteData.pitchSlideTime + 'i').toSeconds() : 0
  }

  const durSec = typeof duration === 'number' ? duration : Tone.Time(duration).toSeconds()
  const trackGlideStyle = useStore.getState().glideStyle
  const hasSlide = !!noteData?.pitchSlide
  const hasFilterSweep = noteData?.filterStart !== undefined

  const totalPitchOffset = (noteData?.pitchOffset ?? 0) + (detune ? detune / 100 : 0) + (track?.transpose ?? 0) + (src.extraPitchOffset ?? 0)

  const rawOverride = noteData?.instrumentOverride
  let overrideKind: 'preset' | 'kit' | 'vst3' | undefined
  let overrideValue: string | undefined
  if (typeof rawOverride === 'string' && rawOverride.length > 0) {
    if (rawOverride.startsWith('vst3:')) {
      overrideKind = 'vst3'
      overrideValue = rawOverride.slice(5)
    } else {
      overrideKind = (track?.instrument === 'drum' || type === 'drum') ? 'kit' : 'preset'
      overrideValue = rawOverride
    }
  }

  const fxChain = noteData?.fxInstances?.length ? buildNoteFxChain(noteData) : undefined

  return {
    type: 'noteOn',
    trackId,
    instrument: effectiveInstrument,
    pitch: startMidi,
    velocity,
    duration: durSec,
    slideEnd: endMidi,
    slideTime,
    slideCurve: hasSlide ? buildCurveLut(noteData?.pitchSlideRamp, noteData?.pitchSlideCustomCurve || 't * t') : undefined,
    steppedGlide: (noteData?.glideStyle ?? trackGlideStyle) === 'stepped',
    vibratoDepth: noteData?.vibratoDepth,
    vibratoRate: noteData?.vibratoRate,
    vibratoWave: waveformIndex(noteData?.vibratoWave),
    vibratoDelay: (noteData?.vibratoDelay || 0) / 1000,
    vibratoFade: (noteData?.vibratoFade || 0) / 1000,
    tremoloDepth: noteData?.tremoloDepth,
    tremoloRate: noteData?.tremoloRate,
    tremoloWave: waveformIndex(noteData?.tremoloWave),
    filterStart: noteData?.filterStart,
    filterEnd: noteData?.filterEnd,
    filterSweepTime: noteData?.filterSweepTime ? Tone.Time(noteData.filterSweepTime + 'i').toSeconds() : undefined,
    filterCurve: hasFilterSweep ? buildCurveLut(noteData?.filterSweepRamp) : undefined,
    overrideKind,
    overrideValue,
    fxChainId: fxChain?.chainId,
    fxChainSignature: fxChain?.signature,
    fxChainEffects: fxChain?.effects,
    lyric: noteData?.lyric || 'a',
    pitchOffset: totalPitchOffset,
    drumDecay: noteData?.decay ?? -1,
    slideSemitones: noteData?.pitchSlide ?? 0,
    punchOctaves: noteData?.octaves ?? -1,
    resonanceHz: noteData?.resonance ?? -1
  }
}
