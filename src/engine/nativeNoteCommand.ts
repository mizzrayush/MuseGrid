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
  /** Note id: per-note VST3 overrides own one plugin instance each. */
  instanceKey?: string
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
  /** Morph crossfade lengths in seconds, measured from note start. */
  morphFadeIn?: number
  morphFadeOut?: number
  /** Per-note pan trim (-1..1) added to the track pan. */
  pan?: number
  /** Per-note volume from the volume automation lane (0..1). */
  gain?: number
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

  // The Drum Designer tunes pads on the track instead of per note, and four of those records were
  // read by nothing. Resolving them as the note's fallback is what makes the panel agree with
  // playback; a note that carries its own value still wins.
  const isDrumVoice = effectiveInstrument === 'drum'
  const padPitchOffset = isDrumVoice ? (track?.drumPitches?.[startMidi] ?? 0) : 0
  const padDetuneCents = isDrumVoice ? (track?.drumDetunes?.[startMidi] ?? 0) : 0
  const padSlideSemitones = isDrumVoice ? (track?.drumSlides?.[startMidi] ?? 0) : 0

  let endMidi: number | undefined = undefined
  let slideTime = 0
  if (pitchEnd !== undefined) {
    endMidi = typeof pitchEnd === 'number' ? pitchEnd : Tone.Frequency(pitchEnd).toMidi()
  }
  const slideSemitones = noteData?.pitchSlide ?? padSlideSemitones
  if (slideSemitones) {
    endMidi = startMidi + slideSemitones
    // A pad's own slide length is stored in ticks, and the designer defaults it to 120.
    const slideTicks = noteData?.pitchSlide ? noteData.pitchSlideTime : (track?.drumSlideTimes?.[startMidi] ?? 120)
    // 0 ticks means "glide across the whole note"; the JUCE voice applies that fallback.
    slideTime = slideTicks ? Tone.Time(slideTicks + 'i').toSeconds() : 0
  }

  const durSec = typeof duration === 'number' ? duration : Tone.Time(duration).toSeconds()
  const trackGlideStyle = useStore.getState().glideStyle
  const hasSlide = !!slideSemitones
  const hasFilterSweep = noteData?.filterStart !== undefined

  const totalPitchOffset = (noteData?.pitchOffset ?? 0) + padPitchOffset + (detune ? detune / 100 : 0)
    + (padDetuneCents / 100) + (track?.transpose ?? 0) + (src.extraPitchOffset ?? 0)

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
    filterCurve: noteData?.laneFilterCurve
      ? noteData.laneFilterCurve.slice(0, 33)
      : (hasFilterSweep ? buildCurveLut(noteData?.filterSweepRamp) : undefined),
    overrideKind,
    overrideValue,
    instanceKey: overrideKind === 'vst3' && noteData?.id ? String(noteData.id) : undefined,
    fxChainId: fxChain?.chainId,
    fxChainSignature: fxChain?.signature,
    fxChainEffects: fxChain?.effects,
    lyric: noteData?.lyric || 'a',
    pitchOffset: totalPitchOffset,
    // JUCE reads -1 as "use the kit default". The designer tunes pads on the track, not notes,
    // so the pad records have to be the fallback or native ignores what the panel shows.
    drumDecay: noteData?.decay ?? track?.drumDecays?.[startMidi] ?? -1,
    slideSemitones: slideSemitones ?? 0,
    punchOctaves: noteData?.octaves ?? track?.drumOctaves?.[startMidi] ?? -1,
    resonanceHz: noteData?.resonance ?? track?.drumResonances?.[startMidi] ?? -1,
    morphFadeIn: noteData?.morphFadeIn ? Tone.Time(noteData.morphFadeIn + 'i').toSeconds() : undefined,
    morphFadeOut: noteData?.morphFadeOut ? Tone.Time(noteData.morphFadeOut + 'i').toSeconds() : undefined,
    pan: noteData?.pan !== undefined ? Math.max(-1, Math.min(1, noteData.pan)) : undefined,
    gain: noteData?.automationGain !== undefined ? Math.max(0, Math.min(1, noteData.automationGain)) : 1
  }
}
