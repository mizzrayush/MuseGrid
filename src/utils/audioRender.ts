import * as Tone from 'tone'
import type { AppState, CustomFxConfig, Note, Track, TrackGroup, AutomationTarget } from '../engine/store'
import { getLaneValueAtTick, applyExpressionLaneToNote, laneFallbackValue, laneIsActive, laneValueToPan } from './automation'
import { parseAutomationTarget } from '../engine/store'
import { getEffectiveTrackLevel } from './groupAudio'
import { buildGlideIntoMap, resolveGlidePlayback } from './midiEditing'
import { buildCurveLut, evaluateGlideCurve } from './glideCurves'
import { attachDrumHitModulation, resolveDrumHitModulation, type DrumHitModulation } from './drumModulation'
import { DEFAULT_DRUM_KIT, DEFAULT_SYNTH_PRESET, type SynthPreset, type DrumKit } from './instruments'
import { CustomScriptProcessorNode, DPreverbNode, audioEngine, VocalModelVoice, PhysicalModelVoice, type DrumOutputOptions } from '../engine/AudioEngine'
import { getActiveDPreverbInstances, getTrackFxInstances, getTrackFxSetting as readTrackFxSetting, type BuiltInFxType } from '../engine/fxDefaults'
import { createTrackChannel } from './toneChannel'
import { drumSampleShouldLoop, getSamplerPlayPlan, resolveSamplerLoopMode, resolveSamplerRegion } from './audioPlayback'

const PPQ = 192

// Global safety monkey-patch for Tone.Param.prototype.setValueAtTime and rampTo to guarantee
// undefined, null, or non-finite values never cause "Invalid argument(s) to setValueAtTime" crashes.
const origParamSetValueAtTime = Tone.Param.prototype.setValueAtTime
Tone.Param.prototype.setValueAtTime = function (value: any, time: any) {
  const safeTime = typeof time === 'number' && isFinite(time) ? time : 0
  let safeValue = value
  if (safeValue === undefined || safeValue === null || (typeof safeValue === 'number' && !isFinite(safeValue))) {
    const initial = (this as any)._initialValue
    safeValue = typeof initial === 'number' && isFinite(initial) ? initial : 0
  }
  return origParamSetValueAtTime.call(this, safeValue, safeTime)
}

const origParamRampTo = Tone.Param.prototype.rampTo
Tone.Param.prototype.rampTo = function (value: any, rampTime: any, startTime: any) {
  let safeVal = value
  if (safeVal === undefined || safeVal === null || (typeof safeVal === 'number' && !isFinite(safeVal))) {
    const initial = (this as any)._initialValue
    safeVal = typeof initial === 'number' && isFinite(initial) ? initial : 0
  }
  const safeRamp = typeof rampTime === 'number' && isFinite(rampTime) && rampTime > 0 ? rampTime : 0.05
  return origParamRampTo.call(this, safeVal, safeRamp, startTime)
}

function gainToDb(gain: number | undefined): number {
  const g = typeof gain === 'number' && isFinite(gain) ? (gain > 1 ? gain / 100 : gain) : 1
  return Tone.gainToDb(Math.max(0.0001, g))
}

function shouldRenderTrack(track: Track, tracks: Track[], groups: TrackGroup[] = []): boolean {
  const effective = getEffectiveTrackLevel(track, groups)
  const hasSolo = tracks.some(t => getEffectiveTrackLevel(t, groups).soloed)
  if (hasSolo && !effective.soloed) return false
  return !effective.muted
}


function createSynthForPreset(preset: SynthPreset): Tone.PolySynth {
  switch (preset) {
    case 'piano':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' as const },
        envelope: { attack: 0.004, decay: 0.28, sustain: 0.16, release: 0.36 },
      })
    case 'electricPiano':
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2.4,
        modulationIndex: 5.8,
        envelope: { attack: 0.01, decay: 0.32, sustain: 0.22, release: 0.45 },
        modulationEnvelope: { attack: 0.01, decay: 0.18, sustain: 0.1, release: 0.2 },
      })
    case 'marimba':
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.6,
        modulationIndex: 9,
        envelope: { attack: 0.003, decay: 0.28, sustain: 0.05, release: 0.22 },
        modulationEnvelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.12 },
      })
    case 'bright':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' as const },
        envelope: { attack: 0.01, decay: 0.08, sustain: 0.42, release: 0.18 },
      })
    case 'pluck':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' as const },
        envelope: { attack: 0.002, decay: 0.16, sustain: 0.12, release: 0.12 },
      })
    case 'pad':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' as const },
        envelope: { attack: 0.18, decay: 0.25, sustain: 0.7, release: 0.9 },
      })
    case 'bass':
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: 'square' as const },
        filter: { Q: 2, type: 'lowpass' as const, rolloff: -24 },
        envelope: { attack: 0.01, decay: 0.16, sustain: 0.55, release: 0.18 },
        filterEnvelope: { attack: 0.01, decay: 0.14, sustain: 0.2, release: 0.18, baseFrequency: 80, octaves: 3 },
      })
    case 'bell':
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.5,
        modulationIndex: 12,
        envelope: { attack: 0.002, decay: 0.7, sustain: 0.05, release: 1.2 },
        modulationEnvelope: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.4 },
      })
    case 'glass':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' as const },
        envelope: { attack: 0.004, decay: 0.45, sustain: 0.24, release: 0.55 },
      })
    default:
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' as const },
        envelope: { attack: 0.02, decay: 0.12, sustain: 0.48, release: 0.35 },
      })
  }
}

const PITCH_TO_PIECE: Record<number, string> = {
  0: 'kick', 1: 'snare', 2: 'hihatClosed', 3: 'hihatOpen', 4: 'clap',
  5: 'tomLow', 6: 'tomMid', 7: 'tomHigh', 8: 'crash', 9: 'ride',
  10: 'cowbell', 11: 'tambourine', 12: 'congaLow', 13: 'congaHigh', 14: 'claves', 15: 'rimshot'
}

function getDecayDefaultByPitch(pitch: number): number {
  const defaults: Record<number, number> = {
    0: 0.42, 1: 0.14, 2: 0.10, 3: 0.30, 4: 0.20,
    5: 0.40, 6: 0.30, 7: 0.20, 8: 2.00, 9: 3.00,
    10: 0.50, 11: 0.10, 12: 0.30, 13: 0.20, 14: 0.10, 15: 0.05
  }
  return defaults[pitch] ?? 0.40
}

interface DrumSlideOptions {
  targetPitchOffset: number
  slideTime?: number
  ramp?: 'linear' | 'exponential' | 'logarithmic' | 'sigmoid' | 'custom'
  customCurve?: string
}

function getReversedAudioBuffer(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const rev = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate)
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const inData = src.getChannelData(ch)
    const outData = rev.getChannelData(ch)
    for (let i = 0, j = src.length - 1; i < src.length; i++, j--) {
      outData[i] = inData[j]
    }
  }
  return rev
}

/**
 * One drum hit in the offline bounce. The arguments carry exactly what the live engine hands to
 * DrumMachine.triggerAttackRelease - tuning offset, slide, pad tone, output trim and expression -
 * so an exported WAV cannot drift from the transport.
 */
function triggerDrum(
  pitch: number,
  duration: number,
  time: number,
  velocity: number,
  input: Tone.Gain,
  track: Track,
  drumKitOverride: DrumKit | undefined,
  cache: Record<string, any>,
  pitchOffset = 0,
  slide?: DrumSlideOptions,
  padCustom?: {
    octaves?: number
    resonance?: number
    decay?: number
  },
  output?: DrumOutputOptions,
  ticksPerSecond = 192,
  mod?: DrumHitModulation,
  sampleBuffersCache?: Map<string, AudioBuffer>
): void {
  const kit = drumKitOverride ?? track.drumKit ?? DEFAULT_DRUM_KIT
  const tight = kit === 'tight'
  const electro = kit === 'electro'
  const eightOhEight = kit === 'eightOhEight'
  const tabla = kit === 'tabla'

  // The Drum Designer tunes and slides pads on the track. Both the live engine and the JUCE
  // voice fold those records into every hit, so the bounce reads them here too; a note that
  // carries its own value still decides the pitch it plays at.
  pitchOffset += (track.drumPitches?.[pitch] ?? 0) + (track.drumDetunes?.[pitch] ?? 0) / 100
  if ((!slide || !slide.targetPitchOffset) && (track.drumSlides?.[pitch] ?? 0) !== 0) {
    slide = {
      targetPitchOffset: track.drumSlides![pitch],
      slideTime: track.drumSlideTimes?.[pitch] ?? 120
    }
  }

  // Per-note volume automation, pan and morph fades get a private output chain, so the
  // exported drum hit is trimmed the same way the JUCE drum engine trims it.
  const perNoteOutput = !!output && (
    !!output.pan ||
    (output.gain !== undefined && Math.abs(output.gain - 1) > 0.001) ||
    (output.fadeIn ?? 0) > 0 ||
    (output.fadeOut ?? 0) > 0
  )
  let dest: Tone.ToneAudioNode = input
  // A wobbling or sweeping hit needs a voice of its own: an LFO attached to a pooled pad instance
  // would modulate every later hit that reuses it, exactly like the shared live voice would.
  const privateVoice = perNoteOutput || !!mod
  if (perNoteOutput && output) {
    const g = new Tone.Gain(1)
    const target = Math.max(0, Math.min(2, output.gain ?? 1))
    const fadeIn = Math.max(0, output.fadeIn ?? 0)
    const fadeOut = Math.max(0, output.fadeOut ?? 0)
    g.gain.setValueAtTime(fadeIn > 0 ? 0 : target, time)
    if (fadeIn > 0) g.gain.linearRampToValueAtTime(target, time + fadeIn)
    if (fadeOut > 0) g.gain.linearRampToValueAtTime(0, time + fadeOut)
    const pan = Math.max(-1, Math.min(1, output.pan ?? 0))
    // A centred panner would fold the mono pad and cost 3 dB; only pan when asked to.
    if (pan !== 0) {
      const p = new Tone.Panner(pan)
      g.chain(p, input)
    } else {
      g.connect(input)
    }
    dest = g
  }

  // Sample-based Pad Playback in Offline Render
  const padSample = track.drumPadSamples?.[pitch]
  const padMode = track.drumPadModes?.[pitch] || (padSample ? 'sample' : 'synth')
  const sampleBuf = sampleBuffersCache?.get(`drum:${track.id}:${pitch}`)
  if (padMode === 'sample' && padSample && sampleBuf) {
    const rawCtx = Tone.getContext().rawContext as AudioContext
    const bufToPlay = padSample.reverse ? getReversedAudioBuffer(rawCtx, sampleBuf) : sampleBuf
    const now = time

    const tuningSemitones = (padSample.tuning ?? 0) + pitchOffset
    const fineTuneCents = (padSample.fineTune ?? 0)
    const totalSemitones = tuningSemitones + (fineTuneCents / 100)
    const rate = Math.max(0.05, Math.min(16.0, Math.pow(2, totalSemitones / 12)))

    const noteSec = Math.max(0.02, duration)
    const loopMode = padSample.loopMode ?? 'off'
    const region = resolveSamplerRegion(padSample)
    const shouldLoop = drumSampleShouldLoop(noteSec, region, bufToPlay.duration, rate, loopMode)
    const plan = getSamplerPlayPlan(noteSec, region, bufToPlay.duration, rate, false, resolveSamplerLoopMode(loopMode))
    const tailMode = shouldLoop && plan.loopMode === 'releaseTail' && plan.tailDurationSeconds > 0.01
    const noteEnd = now + noteSec

    const source = rawCtx.createBufferSource()
    source.buffer = bufToPlay
    source.playbackRate.setValueAtTime(rate, now)
    if (shouldLoop) {
      source.loop = true
      source.loopStart = region.loopStart * bufToPlay.duration
      source.loopEnd = region.loopEnd * bufToPlay.duration
    }

    const gainNode = rawCtx.createGain()
    const sampleVol = padSample.volume !== undefined ? padSample.volume : 1.0
    const peakGain = Math.max(0.0001, Math.min(2.5, velocity * sampleVol))
    gainNode.gain.setValueAtTime(peakGain, now)

    const bufDuration = bufToPlay.duration / rate
    const decayTime = padSample.decay ?? (padCustom?.decay ?? track.drumDecays?.[pitch] ?? bufDuration)
    const effectiveDuration = Math.min(bufDuration, decayTime)

    let loopFadeEnd = noteEnd
    if (shouldLoop) {
      const fade = Math.max(0.02, decayTime)
      const holdEnd = tailMode ? noteEnd + plan.tailDurationSeconds : noteEnd
      gainNode.gain.setValueAtTime(peakGain, noteEnd)
      gainNode.gain.setValueAtTime(peakGain, holdEnd)
      gainNode.gain.linearRampToValueAtTime(0.0001, holdEnd + fade)
      loopFadeEnd = holdEnd + fade
    } else if (effectiveDuration < bufDuration) {
      gainNode.gain.setValueAtTime(peakGain, now + Math.max(0.005, effectiveDuration * 0.75))
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + effectiveDuration)
    }

    let outNode: AudioNode = gainNode
    const panVal = Math.max(-1, Math.min(1, (padSample.pan ?? 0) + (output?.pan ?? 0)))
    if (panVal !== 0 && (rawCtx as any).createStereoPanner) {
      const panner = (rawCtx as any).createStereoPanner()
      panner.pan.setValueAtTime(panVal, now)
      gainNode.connect(panner)
      outNode = panner
    }

    const targetDest: AudioNode = (dest as any).input ? (dest as any).input : (dest as any)
    outNode.connect(targetDest)

    const startTimeInBuf = region.playStart * bufToPlay.duration
    const playDuration = (region.playEnd - region.playStart) * bufToPlay.duration / rate

    if (shouldLoop) {
      const loopGain = rawCtx.createGain()
      loopGain.gain.setValueAtTime(1, now)
      source.connect(loopGain)
      loopGain.connect(gainNode)
      source.start(now, startTimeInBuf)
      if (tailMode) {
        const tailSource = rawCtx.createBufferSource()
        tailSource.buffer = bufToPlay
        tailSource.playbackRate.setValueAtTime(rate, now)
        const tailGain = rawCtx.createGain()
        tailGain.gain.setValueAtTime(0.0001, noteEnd)
        tailGain.gain.linearRampToValueAtTime(1, noteEnd + 0.008)
        tailSource.connect(tailGain)
        tailGain.connect(gainNode)
        tailSource.start(noteEnd, plan.tailStartSeconds)
        loopGain.gain.setValueAtTime(1, noteEnd)
        loopGain.gain.linearRampToValueAtTime(0.0001, noteEnd + 0.008)
        source.stop(noteEnd + 0.02)
      } else {
        source.stop(loopFadeEnd + 0.02)
      }
    } else {
      source.connect(gainNode)
      source.start(now, startTimeInBuf, Math.min(playDuration, effectiveDuration + 0.05))
    }
    return
  }

  let defaultDecay = getDecayDefaultByPitch(pitch)
  if (kit === 'custom' && track.customMuxins?.config) {
    const pieceKey = pitch <= 15 ? (PITCH_TO_PIECE[pitch] || '') : pitch.toString()
    const cfg = track.customMuxins.config[pieceKey]
    if (cfg?.envelope?.decay !== undefined) {
      defaultDecay = cfg.envelope.decay
    }
  }
  const customDecay = padCustom?.decay ?? track.drumDecays?.[pitch] ?? defaultDecay
  // A longer note lengthens the hit: the decay floor is the note length, which is the same
  // extend-only rule the live engine and the JUCE voice apply. Short notes keep the pad's decay.
  const holdDecay = Math.max(customDecay, duration)
  // The Drum Designer stores pad tone per pad, and the live engine applies all three records.
  // Spreading only when a pad has a record keeps every untuned pad byte-identical.
  const padOctave = padCustom?.octaves ?? track.drumOctaves?.[pitch]
  const padResonance = padCustom?.resonance ?? track.drumResonances?.[pitch]
  const padOctaveSet = padOctave !== undefined ? { octaves: padOctave } : {}
  const padResonanceSet = padResonance !== undefined ? { resonance: padResonance } : {}

  const isCustomKit = kit === 'custom'
  const isCustomPitch = pitch >= 16

  const cacheKey = `${kit}_${pitch}_${holdDecay}_${padOctave ?? -1}_${padResonance ?? -1}`

  // Pool-based synth allocator. Tone.js requires strictly increasing event times
  // on each synth instance (oscillator.start, volume.setValueAtTime, etc).
  // We track last start/end times and add epsilon to handle float boundaries.
  // If a reused synth still fails due to internal Tone.js state, we fall back
  // to creating a fresh instance — keeping performance high (2-3 synths per piece
  // in typical cases) while guaranteeing zero crashes.
  const EPSILON = 0.002
  const getPooledSynth = <T extends any>(createFn: () => T): T => {
    if (privateVoice) {
      const s = createFn()
      if (mod) attachDrumHitModulation(s as any, mod, time, holdDecay, dest)
      else (s as any).connect(dest)
      return s
    }
    if (!cache[cacheKey]) cache[cacheKey] = []
    const pool = cache[cacheKey] as Array<{ synth: T, lastStart: number, lastEnd: number }>
    let entry = pool.find(item => time > item.lastEnd + EPSILON && time > item.lastStart + EPSILON)
    if (!entry) {
      const s = createFn()
        ; (s as any).connect(dest)
      entry = { synth: s, lastStart: -1, lastEnd: -1 }
      pool.push(entry)
    }
    entry.lastStart = time
    entry.lastEnd = time + duration
    return entry.synth
  }

  const tunedFreq = (baseNote: string, semitones: number) =>
    Tone.Frequency(baseNote).toFrequency() * Math.pow(2, semitones / 12)

  // A slide moves the pitch the pad actually has. A membrane pad keeps its punch delay, a metal pad
  // glides its whole cluster, and a noise-only pad has no pitch parameter, so it is skipped here
  // and takes its tuning from the playback rate in its own case instead - the live engine's rule.
  const applySlide = (synth: any, startF: number) => {
    const semitones = slide?.targetPitchOffset
    const param = synth?.frequency
    if (!semitones || !param || typeof param.setValueAtTime !== 'function') return
    const isMembrane = synth instanceof Tone.MembraneSynth
    const punchOffset = isMembrane ? (eightOhEight ? 0.05 : 0.02) : 0.005
    const startTime = time + punchOffset
    // A pad slide is stored in ticks. Dividing by the note's own ticks-per-second keeps the length
    // right at any BPM, which the fixed 192-ticks assumption this replaced did not.
    const slideDur = slide!.slideTime
      ? Math.min(duration, slide!.slideTime / ticksPerSecond)
      : Math.max(0.04, duration - punchOffset)
    const endF = startF * Math.pow(2, semitones / 12)
    try {
      param.setValueAtTime(startF, startTime)
      const ramp = slide!.ramp
      if (!ramp || ramp === 'linear') {
        param.rampTo(endF, slideDur, startTime)
      } else {
        // A shaped glide is stepped, the same way a synth glide is, so the equation chosen for the
        // note reaches the pad instead of collapsing into a straight ramp.
        const steps = Math.max(10, Math.min(200, Math.round(slideDur * 100)))
        for (let i = 1; i <= steps; i++) {
          const y = evaluateGlideCurve(i / steps, ramp, slide!.customCurve || 't * t')
          param.setValueAtTime(startF * Math.pow(2, (semitones * y) / 12), startTime + (i / steps) * slideDur)
        }
      }
    } catch (_err) { }
  }

  // Wrapper to safely schedule MetalSynth events (volume + trigger). MetalSynth inherits
  // Instrument's (note, duration, time, velocity) order, so the pad pitch comes first; the
  // NoiseSynth shape this used to call it with made the note length the pitch and fired at t=0.
  const safeMetalTrigger = (createFn: () => any, volDb: number, freq: number) => {
    const safeVol = typeof volDb === 'number' && isFinite(volDb) ? volDb : 0
    const safeTime = typeof time === 'number' && isFinite(time) ? time : 0
    try {
      const synth = createFn()
      if (mod) attachDrumHitModulation(synth, mod, safeTime, holdDecay, dest)
      else (synth as any).connect(dest)
      synth.volume.setValueAtTime(safeVol, safeTime)
      synth.triggerAttackRelease(freq, duration, safeTime, velocity)
      applySlide(synth, freq)
    } catch (_err) {
      // Suppress
    }
  }

  if ((isCustomKit || isCustomPitch) && track.customMuxins?.config) {
    const cfg = track.customMuxins.config
    const pieceKey = pitch <= 15 ? (PITCH_TO_PIECE[pitch] || '') : pitch.toString()
    const pieceConfig = cfg[pieceKey]

    if (pieceConfig) {
      const isMembrane = ['kick', 'tomLow', 'tomMid', 'tomHigh', 'congaLow', 'congaHigh', 'claves'].includes(pieceKey) || (pitch >= 16 && (pieceConfig.noise === undefined && pieceConfig.harmonicity === undefined))
      const isNoise = ['snare', 'clap', 'tambourine', 'rimshot'].includes(pieceKey) || (pitch >= 16 && pieceConfig.noise !== undefined)

      if (isMembrane) {
        const synth = getPooledSynth(() => {
          const s = new Tone.MembraneSynth(pieceConfig)
          s.envelope.decay = holdDecay
          if (padOctave !== undefined) s.octaves = padOctave
          return s
        })
        const pitchVal = pieceKey === 'kick' ? 'C2' : pieceKey === 'claves' ? 'C4' : (pieceKey === 'tomLow' ? 'G1' : pieceKey === 'tomMid' ? 'C2' : pieceKey === 'tomHigh' ? 'E2' : (pieceKey === 'congaLow' ? 'E2' : (pieceKey === 'congaHigh' ? 'G2' : 'C2')))
        const f = tunedFreq(pitchVal, pitchOffset)
        synth.triggerAttackRelease(f, duration, time, velocity)
        applySlide(synth, f)
      } else if (isNoise) {
        const synth = getPooledSynth(() => {
          const s = new Tone.NoiseSynth(pieceConfig)
          s.envelope.decay = holdDecay
          return s
        })
        // A NoiseSynth has no pitch parameter; the rate of its noise is the only tuning lever, and
        // it has to be set on every hit because a pooled instance keeps the previous one's rate.
        try { (synth.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) { }
        synth.triggerAttackRelease(duration, time, velocity)
      } else {
        const cymFreq = (pieceKey === 'cowbell' ? 800 : pieceKey === 'crash' ? 300 : pieceKey === 'ride' ? 400 : 400)
          * Math.pow(2, pitchOffset / 12)
        safeMetalTrigger(() => {
          const s = new Tone.MetalSynth(pieceConfig)
          s.envelope.decay = holdDecay
          if (padResonance !== undefined) s.resonance = padResonance
          if (padOctave !== undefined) s.octaves = padOctave
          return s
        }, Tone.gainToDb(velocity) + (pieceKey === 'hihatClosed' ? 8 : pieceKey === 'hihatOpen' ? 7 : 6), cymFreq)
      }
      return
    }
  }

  // Fallback for custom pitch index >= 16 if no custom config is present
  if (pitch >= 16) {
    const synth = getPooledSynth(() => {
      return new Tone.MembraneSynth({
        octaves: 3,
        pitchDecay: 0.05,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: holdDecay, sustain: 0, release: 0.1 },
        ...padOctaveSet
      })
    })
    const f = tunedFreq('C2', pitchOffset)
    synth.triggerAttackRelease(f, duration, time, velocity)
    applySlide(synth, f)
    return
  }

  switch (pitch) {
    case 0: { // Kick
      const synth = getPooledSynth(() => {
        return new Tone.MembraneSynth({
          octaves: track.drumKickOctaves ?? (eightOhEight ? 7 : electro ? 5 : tabla ? 2 : 3),
          pitchDecay: track.drumKickPitchDecay ?? (tight ? 0.025 : eightOhEight ? 0.09 : tabla ? 0.018 : 0.05),
          envelope: { attack: 0.001, decay: holdDecay, release: 0.08 },
          ...padOctaveSet
        })
      })
      const baseNote = kit === 'tabla' ? 'G2' : (eightOhEight ? 'A0' : 'C1')
      const targetFreq = tunedFreq(baseNote, pitchOffset)
      synth.triggerAttackRelease(targetFreq, duration, time, velocity)
      applySlide(synth, targetFreq)
      break
    }
    case 1: { // Snare
      const synth = getPooledSynth(() => {
        return new Tone.NoiseSynth({
          noise: { type: track.drumSnareTone !== undefined ? (track.drumSnareTone > 0.5 ? 'white' : 'brown') : (electro || eightOhEight ? 'brown' : 'white') },
          envelope: { attack: 0.004, decay: holdDecay, sustain: 0 },
        })
      })
      try { (synth.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) { }
      synth.triggerAttackRelease(duration, time, velocity)
      break
    }
    case 2: // HH Closed
    case 3: { // HH Open
      safeMetalTrigger(() => {
        return new Tone.MetalSynth({
          envelope: {
            attack: 0.001,
            decay: holdDecay,
            release: pitch === 3 ? 0.1 : 0.01,
          },
          harmonicity: track.drumHihatTone ?? (electro || eightOhEight ? 7.2 : 5.1),
          modulationIndex: electro || eightOhEight ? 46 : 32,
          resonance: track.drumHihatResonance ?? (electro || eightOhEight ? 5200 : 4000),
          ...padResonanceSet,
          ...padOctaveSet
        })
      }, Tone.gainToDb(velocity) + (pitch === 3 ? 7 : 8), 400 * Math.pow(2, pitchOffset / 12))
      break
    }
    case 4: { // Clap
      const synth = getPooledSynth(() => {
        return new Tone.NoiseSynth({
          noise: { type: track.drumClapTone !== undefined ? (track.drumClapTone > 0.5 ? 'white' : 'pink') : (electro || eightOhEight ? 'white' : 'pink') },
          envelope: { attack: 0.005, decay: holdDecay, sustain: 0 },
        })
      })
      try { (synth.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) { }
      synth.triggerAttackRelease(duration, time, velocity)
      break
    }
    case 5: // Tom Low
    case 6: // Tom Mid
    case 7: { // Tom High
      const synth = getPooledSynth(() => {
        return new Tone.MembraneSynth({
          octaves: eightOhEight ? 6 : 4,
          pitchDecay: 0.05,
          envelope: { attack: 0.01, decay: holdDecay, sustain: 0, release: 0.1 },
          ...padOctaveSet
        })
      })
      const tomFreq = pitch === 5 ? 'G1' : (pitch === 6 ? 'C2' : 'E2')
      const f = tunedFreq(tomFreq, pitchOffset)
      synth.triggerAttackRelease(f, duration, time, velocity)
      applySlide(synth, f)
      break
    }
    case 8: // Crash
    case 9: { // Ride
      const cymFreq = (pitch === 8 ? 300 : 400) * Math.pow(2, pitchOffset / 12)
      safeMetalTrigger(() => {
        const s = new Tone.MetalSynth({
          envelope: { attack: 0.001, decay: holdDecay, release: 0.5 },
          harmonicity: track.drumCymbalTone ?? 5.1,
          modulationIndex: 32,
          resonance: track.drumCymbalResonance ?? 4000,
          octaves: 1.5,
          ...padResonanceSet,
          ...padOctaveSet
        })
        return s
      }, Tone.gainToDb(velocity) + 6, cymFreq)
      break
    }
    case 10: { // Cowbell
      safeMetalTrigger(() => {
        const s = new Tone.MetalSynth({
          envelope: { attack: 0.001, decay: holdDecay, release: 0.1 },
          harmonicity: track.drumCowbellTone ?? (eightOhEight ? 0.5 : 0.2),
          modulationIndex: 10,
          resonance: 800,
          octaves: 0.5,
          ...padResonanceSet,
          ...padOctaveSet
        })
        return s
      }, Tone.gainToDb(velocity) + 4, 800 * Math.pow(2, pitchOffset / 12))
      break
    }
    case 11: { // Tambourine
      const synth = getPooledSynth(() => {
        return new Tone.NoiseSynth({
          noise: { type: track.drumTambourineTone !== undefined ? (track.drumTambourineTone > 0.5 ? 'white' : 'pink') : 'white' },
          envelope: { attack: 0.005, decay: holdDecay, sustain: 0 }
        })
      })
      try { (synth.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) { }
      synth.triggerAttackRelease(duration, time, velocity)
      break
    }
    case 12: // Conga Low
    case 13: { // Conga High
      const synth = getPooledSynth(() => {
        return new Tone.MembraneSynth({
          pitchDecay: 0.01,
          octaves: track.drumCongaPitch ?? 2,
          envelope: { attack: 0.005, decay: holdDecay, sustain: 0, release: 0.1 },
          ...padOctaveSet
        })
      })
      const congaNote = pitch === 12 ? 'E2' : 'G2'
      const f = tunedFreq(congaNote, pitchOffset)
      synth.triggerAttackRelease(f, duration, time, velocity)
      applySlide(synth, f)
      break
    }
    case 14: { // Claves
      const synth = getPooledSynth(() => {
        return new Tone.MembraneSynth({
          pitchDecay: 0.01,
          octaves: track.drumClavesPitch ?? 1,
          envelope: { attack: 0.001, decay: holdDecay, sustain: 0, release: 0.1 },
          ...padOctaveSet
        })
      })
      const f = tunedFreq('C4', pitchOffset)
      synth.triggerAttackRelease(f, duration, time, velocity)
      applySlide(synth, f)
      break
    }
    case 15: { // Rimshot
      const synth = getPooledSynth(() => {
        return new Tone.NoiseSynth({
          noise: { type: track.drumRimshotTone !== undefined ? (track.drumRimshotTone > 0.5 ? 'brown' : 'white') : 'brown' },
          envelope: { attack: 0.001, decay: holdDecay, sustain: 0 }
        })
      })
      try { (synth.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) { }
      synth.triggerAttackRelease(duration, time, velocity)
      break
    }
  }
}

/**
 * The per-note modulation nodes, built in the same order and from the same fields the live
 * preview chains them: vibrato, then tremolo, then filter. They only ever sit on an ephemeral
 * voice, because a shared poly synth cannot shape one note without affecting the rest.
 */
function buildModulationNodes(
  noteData: any,
  start: number,
  durationSeconds: number,
  ticksPerSecond: number,
): Tone.ToneAudioNode[] {
  const nodes: Tone.ToneAudioNode[] = []

  if (noteData?.vibratoDepth) {
    const vibrato = new Tone.Vibrato({
      frequency: noteData.vibratoRate || 5,
      depth: 0,
      type: noteData.vibratoWave || 'sine'
    })
    const depthDelay = Math.max(0, (noteData.vibratoDelay || 0) / 1000)
    const depthFade = Math.max(0, (noteData.vibratoFade || 0) / 1000)
    const fullDepth = Math.max(0, Math.min(1, noteData.vibratoDepth / 100))
    vibrato.depth.setValueAtTime(0, start)
    vibrato.depth.linearRampToValueAtTime(fullDepth, start + depthDelay + Math.max(0.001, depthFade))
    nodes.push(vibrato)
  }

  if (noteData?.tremoloDepth) {
    // Offline the LFO has to be started at the note's own time; live it is created as the note plays.
    nodes.push(new Tone.Tremolo({
      frequency: noteData.tremoloRate || 5,
      depth: noteData.tremoloDepth,
      type: noteData.tremoloWave || 'sine'
    }).start(start))
  }

  if (noteData?.filterStart) {
    const filter = new Tone.Filter(noteData.filterStart, 'lowpass')
    nodes.push(filter)
    if (noteData.filterEnd) {
      // No sweep time means the lane spans the whole note, which is what the native voice does.
      const sweepTime = noteData.filterSweepTime ? noteData.filterSweepTime / ticksPerSecond : durationSeconds
      filter.frequency.setValueAtTime(noteData.filterStart, start)
      filter.frequency.rampTo(noteData.filterEnd, sweepTime, start)
    }
  }

  return nodes
}

export interface RenderOptions {
  trackId?: string;
  trackIds?: string[];
  octaveOffset: number;
  semitoneOffset: number;
  normalize: boolean;
  includeMetronome: boolean;
  autoFade: boolean;
  startTick?: number;
  endTick?: number;
  includeProceduralFx?: boolean;
  exportRegionMode?: boolean;
  exportRegions?: Array<{ id: string; startTick: number; endTick: number; gap: number }>;
  skipOfflineCustomFx?: boolean;
}

export function applyAudioBufferFadeOut(buffer: AudioBuffer, fadeDuration: number): void {
  if (fadeDuration <= 0 || buffer.length === 0) return

  const fadeSamples = Math.min(buffer.length, Math.max(1, Math.round(fadeDuration * buffer.sampleRate)))
  const fadeStart = buffer.length - fadeSamples

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = fadeStart; i < buffer.length; i++) {
      const progress = (i - fadeStart) / fadeSamples
      data[i] *= Math.max(0, 1 - progress)
    }
  }
}

export function normalizeAudioBuffer(buffer: AudioBuffer, targetDb: number): void {
  let maxAmp = 0

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i])
      if (abs > maxAmp) maxAmp = abs
    }
  }

  if (maxAmp <= 0) return

  const targetAmp = Math.pow(10, targetDb / 20)
  const ratio = targetAmp / maxAmp

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) {
      data[i] *= ratio
    }
  }
}

function createSynthFromMuzins(muxins: any): Tone.PolySynth {
  let SynthClass: any = Tone.Synth
  if (muxins.engineType === 'FMSynth') SynthClass = Tone.FMSynth
  if (muxins.engineType === 'MonoSynth') SynthClass = Tone.MonoSynth

  const config = muxins.config || {}
  return new Tone.PolySynth(SynthClass, config)
}

function renderTrackNotesWithTransform(
  track: Track,
  notes: Note[],
  state: AppState,
  trackInput: Tone.Gain,
  options: RenderOptions,
  sampleBuffersCache?: Map<string, AudioBuffer>
): void {
  const totalTranspose = (options.octaveOffset * 12) + options.semitoneOffset + (track.transpose ?? 0)

  // Use track-specific targetTempo if defined, otherwise use global state BPM
  const trackBpm = track.targetTempo ?? state.bpm
  const startOffset = options.startTick ?? 0

  if (track.instrument === 'synth') {
    let synth: Tone.PolySynth
    if (track.synthPreset === 'custom' && track.customMuxins) {
      synth = createSynthFromMuzins(track.customMuxins).connect(trackInput)
    } else {
      synth = createSynthForPreset(track.synthPreset ?? DEFAULT_SYNTH_PRESET).connect(trackInput)
      if (track.synthAttack !== undefined) synth.set({ envelope: { attack: track.synthAttack } })
      if (track.synthDecay !== undefined) synth.set({ envelope: { decay: track.synthDecay } })
      if (track.synthSustain !== undefined) synth.set({ envelope: { sustain: track.synthSustain } })
      if (track.synthRelease !== undefined) synth.set({ envelope: { release: track.synthRelease } })

      if (track.synthOscillator !== undefined) synth.set({ oscillator: { type: track.synthOscillator } })
      if (track.synthDetune !== undefined) synth.set({ detune: track.synthDetune })
      if (track.synthPortamento !== undefined) synth.set({ portamento: track.synthPortamento })

      const anySynth = synth as any
      if (track.synthFilterFreq !== undefined || track.synthFilterQ !== undefined) {
        if (anySynth.filter) {
          if (track.synthFilterFreq !== undefined) anySynth.filter.frequency.value = track.synthFilterFreq
          if (track.synthFilterQ !== undefined) anySynth.filter.Q.value = track.synthFilterQ
        } else if (anySynth.options?.filter) {
          (synth as any).set({ filter: { frequency: track.synthFilterFreq, Q: track.synthFilterQ } })
        }
      }
    }

    // Cache for offline synth preset overrides
    const overrideSynthsCached: Record<string, Tone.PolySynth> = {}

    // Destination / morph glide transforms are shared by live playback and every export
    // path, so the Tone bounce triggers the same voices, pitches and crossfades.
    const glideIntoMap = buildGlideIntoMap(state.notes)
    const automationTarget = state.automationTargets?.[track.id] ?? 'velocity'

    const applyTrackSynthParams = (s: Tone.PolySynth) => {
      if (track.synthAttack !== undefined) s.set({ envelope: { attack: track.synthAttack } })
      if (track.synthDecay !== undefined) s.set({ envelope: { decay: track.synthDecay } })
      if (track.synthSustain !== undefined) s.set({ envelope: { sustain: track.synthSustain } })
      if (track.synthRelease !== undefined) s.set({ envelope: { release: track.synthRelease } })
      if (track.synthOscillator !== undefined) s.set({ oscillator: { type: track.synthOscillator } })
      if (track.synthDetune !== undefined) s.set({ detune: track.synthDetune })
      if (track.synthPortamento !== undefined) s.set({ portamento: track.synthPortamento })
    }

    const sortedNotes = [...notes].sort((a, b) => a.time - b.time)
    sortedNotes.forEach(note => {
      const playback = resolveGlidePlayback(note, glideIntoMap.get(note.id))
      let playNoteData = playback.note
      const noteTime = playback.startTick
      const noteLength = playback.durationTicks

      const relativeTime = noteTime - startOffset
      if (relativeTime + noteLength < 0) return // Before range
      if (options.endTick !== undefined && noteTime >= options.endTick) return // After range

      // Use note-specific TPS for timing and duration if defined
      const noteBpm = note.bpm ?? trackBpm
      const noteTicksPerSecond = (noteBpm / 60) * PPQ

      const start = Math.max(0, relativeTime / noteTicksPerSecond)
      const duration = Math.max(0.01, noteLength / noteTicksPerSecond)

      // The automation lane drives velocity, per-note volume, per-note pan or expression parameters.
      let velocity = note.velocity / 127
      let autoGain = 1
      let notePan = 0

      const allCurves = state.automationCurves || {}
      const trackCurves = Object.entries(allCurves).filter(([key, pts]) =>
        (key === track.id || key.startsWith(`${track.id}::`)) && pts && pts.length > 0
      )

      if (trackCurves.length > 0) {
        for (const [key, pts] of trackCurves) {
          const targetStr = (key.includes('::') ? key.split('::').slice(1).join('::') : automationTarget) as AutomationTarget
          const laneVal = getLaneValueAtTick({
            points: pts,
            lane: state.automationLanes?.[track.id],
            target: targetStr,
            tick: note.time + note.duration / 2,
            fallback: laneFallbackValue(targetStr, note),
            bpm: state.bpm,
          })
          if (targetStr === 'volume') autoGain = Math.max(0, Math.min(1, laneVal / 127))
          else if (targetStr === 'pan') notePan = laneValueToPan(laneVal)
          else if (targetStr === 'velocity') velocity = laneVal / 127
          else if (parseAutomationTarget(targetStr)?.kind === 'expr' && laneIsActive(pts, state.automationLanes?.[track.id])) {
            playNoteData = applyExpressionLaneToNote(playNoteData, targetStr, laneVal, {
              lane: state.automationLanes?.[track.id], points: pts, bpm: state.bpm,
            })
          }
        }
      } else {
        const laneValue = getLaneValueAtTick({
          points: state.automationCurves[track.id],
          lane: state.automationLanes?.[track.id],
          target: automationTarget,
          tick: note.time + note.duration / 2,
          fallback: laneFallbackValue(automationTarget, note),
          bpm: state.bpm,
        })
        if (parseAutomationTarget(automationTarget)?.kind === 'expr' && laneIsActive(state.automationCurves[track.id], state.automationLanes?.[track.id])) {
          playNoteData = applyExpressionLaneToNote(playNoteData, automationTarget, laneValue, {
            lane: state.automationLanes?.[track.id], points: state.automationCurves[track.id], bpm: state.bpm,
          })
        }
        if (automationTarget === 'volume') autoGain = Math.max(0, Math.min(1, laneValue / 127))
        else if (automationTarget === 'pan') notePan = laneValueToPan(laneValue)
        else if (automationTarget === 'velocity') velocity = laneValue / 127
      }
      velocity = typeof velocity === 'number' && isFinite(velocity) ? Math.max(0, Math.min(1, velocity)) : 0.8

      const fadeInSec = playNoteData.morphFadeIn ? playNoteData.morphFadeIn / noteTicksPerSecond : 0
      const fadeOutSec = playNoteData.morphFadeOut ? playNoteData.morphFadeOut / noteTicksPerSecond : 0
      const slideSemis = playNoteData.pitchSlide ?? 0
      // A plain pitchEnd (no explicit slide) still ramps across the note, matching live playback.
      const glideSemis = slideSemis
        || (playNoteData.pitchEnd !== undefined ? playNoteData.pitchEnd - playback.pitch : 0)
      const glideSeconds = playNoteData.pitchSlideTime
        ? playNoteData.pitchSlideTime / noteTicksPerSecond
        : duration
      const glideCurveLut = slideSemis
        ? buildCurveLut(playNoteData.pitchSlideRamp, playNoteData.pitchSlideCustomCurve || 't * t')
        : undefined
      const hasExpressionOut = fadeInSec > 0 || fadeOutSec > 0 || autoGain !== 1 || notePan !== 0
      const noteDetune = playNoteData.detune ?? 0
      const hasModulation = !!playNoteData.vibratoDepth || !!playNoteData.tremoloDepth || !!playNoteData.filterStart

      const isVocal = note.instrumentOverride === 'vocal' || (track.synthPreset === 'vocal' && !note.instrumentOverride)
      if (isVocal) {
        try {
          const rawCtx = Tone.getContext().rawContext
          const voice = new VocalModelVoice(trackInput.input as GainNode, rawCtx)
          const baseFreq = Tone.Frequency(playback.pitch + totalTranspose, 'midi').toFrequency()
          const freq = playNoteData.detune ? baseFreq * Math.pow(2, playNoteData.detune / 1200) : baseFreq
          const endFreq = glideSemis
            ? freq * Math.pow(2, glideSemis / 12)
            : (note.pitchEnd !== undefined ? Tone.Frequency(note.pitchEnd + totalTranspose, 'midi').toFrequency() : undefined)
          const lyric = note.lyric || 'a'
          const voicePresetId = note.voicePresetId || 'soprano'
          const preset = state.voicePresets?.find(p => p.id === voicePresetId) || state.voicePresets?.[0] || {
            id: 'soprano',
            name: 'Soprano',
            vocalTractLength: 1.15,
            breathiness: 0.1,
            glottalTension: 0.85,
            vibratoDepth: 35,
            vibratoRate: 6.2,
            jitter: 0.15,
            shimmer: 0.1,
            formantShiftF1: 0,
            formantShiftF2: 0,
            formantShiftF3: 0,
            consonantVolume: 1.0,
            consonantLength: 1.0,
            articulationSpeed: 1.0
          }
          voice.trigger(freq, duration, start, velocity, preset, lyric, endFreq, {
            glideSeconds: glideSemis ? glideSeconds : undefined,
            glideCurve: glideCurveLut,
            pan: notePan,
            gain: autoGain,
            fadeIn: fadeInSec || undefined,
            fadeOut: fadeOutSec || undefined
          })
        } catch (e) {
          console.error("Offline vocal render error:", e)
        }
        return
      }

      const isPhysical = note.instrumentOverride === 'physical' || (track.synthPreset === 'physical' && !note.instrumentOverride)
      if (isPhysical) {
        try {
          const rawCtx = Tone.getContext().rawContext
          const voice = new PhysicalModelVoice(trackInput.input as GainNode, rawCtx)
          const baseFreq = Tone.Frequency(playback.pitch + totalTranspose, 'midi').toFrequency()
          const freq = playNoteData.detune ? baseFreq * Math.pow(2, playNoteData.detune / 1200) : baseFreq
          voice.trigger(freq, duration, start, velocity, track, {
            targetFrequency: glideSemis ? freq * Math.pow(2, glideSemis / 12) : undefined,
            glideSeconds: glideSemis ? glideSeconds : undefined,
            glideCurve: glideCurveLut,
            pan: notePan,
            gain: autoGain,
            fadeIn: fadeInSec || undefined,
            fadeOut: fadeOutSec || undefined
          })
        } catch (e) {
          console.error("Offline physical render error:", e)
        }
        return
      }

      // Chromatic Sampler in Offline Render
      const isSampler = track.synthMode === 'sampler' && track.synthSampler && !note.instrumentOverride
      if (isSampler) {
        const sampleBuf = sampleBuffersCache?.get(`synth:${track.id}`)
        if (sampleBuf && track.synthSampler) {
          try {
            const cfg = track.synthSampler
            const rawCtx = Tone.getContext().rawContext as AudioContext
            const now = start

            const semis = (playback.pitch - (cfg.rootNote || 60)) + (cfg.tuning || 0) + totalTranspose + (cfg.fineTune || 0) / 100 + (noteDetune / 100)
            const rate = Math.max(0.05, Math.min(16.0, Math.pow(2, semis / 12)))

            const bufToPlay = cfg.reverse ? getReversedAudioBuffer(rawCtx, sampleBuf) : sampleBuf
            const durationBuf = bufToPlay.duration
            const region = resolveSamplerRegion(cfg)
            const playStart = region.playStart * durationBuf
            const loopStart = region.loopStart * durationBuf
            const loopEnd = region.loopEnd * durationBuf
            const regionSec = Math.max(0.005, (region.playEnd - region.playStart) * durationBuf)

            const source = rawCtx.createBufferSource()
            source.buffer = bufToPlay
            source.playbackRate.setValueAtTime(rate, now)
            let tailRate = rate

            if (glideSemis && glideSeconds > 0) {
              const targetSemis = (playback.pitch + glideSemis - (cfg.rootNote || 60)) + (cfg.tuning || 0) + totalTranspose + (cfg.fineTune || 0) / 100 + (noteDetune / 100)
              const targetRate = Math.max(0.05, Math.min(16.0, Math.pow(2, targetSemis / 12)))
              tailRate = targetRate
              if (Math.abs(targetRate - rate) > 1e-6) {
                if (glideCurveLut && glideCurveLut.length >= 2) {
                  const steps = Math.max(8, Math.min(120, Math.round(glideSeconds * 60)))
                  for (let i = 1; i <= steps; i++) {
                    const t = i / steps
                    const pos = t * (glideCurveLut.length - 1)
                    const i0 = Math.floor(pos)
                    const i1 = Math.min(i0 + 1, glideCurveLut.length - 1)
                    const shape = glideCurveLut[i0] + (glideCurveLut[i1] - glideCurveLut[i0]) * (pos - i0)
                    source.playbackRate.setValueAtTime(rate + (targetRate - rate) * shape, now + glideSeconds * t)
                  }
                } else {
                  source.playbackRate.linearRampToValueAtTime(targetRate, now + glideSeconds)
                }
              }
            }

            const gainNode = rawCtx.createGain()
            const targetGain = Math.max(0.0001, Math.min(2.0, (cfg.volume ?? 1.0) * velocity * autoGain))
            const atk = Math.max(0.001, cfg.attack ?? 0.01)
            const dec = Math.max(0.01, cfg.decay ?? 0.3)
            const sus = Math.max(0, Math.min(1, cfg.sustain ?? 0.8))
            const rel = Math.max(0.01, cfg.release ?? 0.2)

            const plan = getSamplerPlayPlan(duration, region, durationBuf, rate, !!cfg.loop, resolveSamplerLoopMode(cfg.loopMode))
            const tailMode = plan.shouldLoop && plan.loopMode === 'releaseTail' && plan.tailDurationSeconds > 0.01

            gainNode.gain.setValueAtTime(0, now)
            gainNode.gain.linearRampToValueAtTime(targetGain, now + atk)
            gainNode.gain.linearRampToValueAtTime(targetGain * sus, now + atk + dec)
            const tailEndAt = now + duration + (tailMode ? plan.tailDurationSeconds : 0)
            gainNode.gain.setValueAtTime(targetGain * sus, now + duration)
            if (tailMode) gainNode.gain.setValueAtTime(targetGain * sus, tailEndAt)
            gainNode.gain.linearRampToValueAtTime(0.0001, tailEndAt + rel)

            let outNode: AudioNode = gainNode
            const finalPan = Math.max(-1, Math.min(1, (cfg.pan ?? 0) + notePan))
            if (finalPan !== 0 && (rawCtx as any).createStereoPanner) {
              const panner = (rawCtx as any).createStereoPanner()
              panner.pan.setValueAtTime(finalPan, now)
              gainNode.connect(panner)
              outNode = panner
            }

            outNode.connect(trackInput.input as GainNode)

            if (tailMode) {
              const loopGain = rawCtx.createGain()
              loopGain.gain.setValueAtTime(1, now)
              loopGain.gain.setValueAtTime(1, now + duration)
              loopGain.gain.linearRampToValueAtTime(0.0001, now + duration + 0.008)
              source.connect(loopGain)
              loopGain.connect(gainNode)

              const tailSource = rawCtx.createBufferSource()
              tailSource.buffer = bufToPlay
              tailSource.playbackRate.setValueAtTime(tailRate, now)
              const tailGain = rawCtx.createGain()
              tailGain.gain.setValueAtTime(0.0001, now + duration)
              tailGain.gain.linearRampToValueAtTime(1, now + duration + 0.008)
              tailSource.connect(tailGain)
              tailGain.connect(gainNode)
              tailSource.start(now + duration, plan.tailStartSeconds)
              tailSource.stop(now + duration + plan.tailDurationSeconds + rel + 0.02)

              source.loop = true
              source.loopStart = loopStart
              source.loopEnd = loopEnd
              source.start(now, playStart)
              source.stop(now + duration + 0.02)
            } else {
              source.connect(gainNode)
              source.loop = plan.shouldLoop
              if (plan.shouldLoop) {
                source.loopStart = loopStart
                source.loopEnd = loopEnd
                source.start(now, playStart, duration + rel)
              } else {
                source.start(now, playStart, Math.min(regionSec / rate, duration + rel))
              }
            }
          } catch (e) {
            console.error("Offline synth sampler render error:", e)
          }
          return
        }
      }

      // VST3 overrides are hosted by JUCE only; the Tone bounce keeps the track synth.
      const overridePreset = note.instrumentOverride && !note.instrumentOverride.startsWith('vst3:')
        ? note.instrumentOverride as SynthPreset
        : undefined

      // A glide, morph fade, per-note pan/gain or modulation needs its own voice: the shared poly
      // synth's output cannot be ramped, panned or voice-shaped for a single note.
      if (glideSemis || hasExpressionOut || hasModulation) {
        let ephem: Tone.PolySynth
        if (!overridePreset && track.synthPreset === 'custom' && track.customMuxins) {
          ephem = createSynthFromMuzins(track.customMuxins)
        } else {
          ephem = createSynthForPreset((overridePreset ?? track.synthPreset ?? DEFAULT_SYNTH_PRESET) as SynthPreset)
          if (!overridePreset) applyTrackSynthParams(ephem)
        }

        let out: Tone.ToneAudioNode = ephem
        buildModulationNodes(playNoteData, start, duration, noteTicksPerSecond).forEach(node => {
          out.chain(node)
          out = node
        })
        if (hasExpressionOut) {
          const g = new Tone.Gain(1)
          g.gain.setValueAtTime(fadeInSec > 0 ? 0 : autoGain, start)
          if (fadeInSec > 0) g.gain.linearRampToValueAtTime(autoGain, start + fadeInSec)
          if (fadeOutSec > 0) g.gain.linearRampToValueAtTime(0, start + Math.min(fadeOutSec, Math.max(0.005, duration)))
          out.chain(g)
          out = g
          if (notePan !== 0) {
            const p = new Tone.Panner(notePan)
            out.chain(p)
            out = p
          }
        }
        out.connect(trackInput)

        const raw = playback.pitch + totalTranspose
        const isMicro = Math.abs(raw % 1) > 0.0001
        // A detuned note goes out as a frequency, the same way the live preview resolves it, so
        // the cents offset is not lost to the note-name round trip.
        const rawHz = Tone.Frequency(raw, 'midi').toFrequency() * (noteDetune ? Math.pow(2, noteDetune / 1200) : 1)
        let voicePitch: any = isMicro || noteDetune
          ? rawHz
          : Tone.Frequency(Math.round(raw), 'midi').toNote()
        if (typeof voicePitch === 'number' && voicePitch > 0 && voicePitch < 35) {
          while (voicePitch < 35) voicePitch *= 2
        }

        if (glideSemis) {
          try {
            ephem.triggerAttack(voicePitch, start, velocity)
            const cents = glideSemis * 100
            const detuneParam: any = (ephem as any).detune
            if (detuneParam?.setValueAtTime) {
              detuneParam.setValueAtTime(0, start)
              const rampType = playNoteData.pitchSlideRamp || 'linear'
              const customEquation = playNoteData.pitchSlideCustomCurve || 't * t'
              if (rampType === 'linear') {
                detuneParam.linearRampToValueAtTime(cents, start + glideSeconds)
              } else {
                const stepCount = Math.max(10, Math.min(200, Math.round(glideSeconds * 100)))
                const stepTime = glideSeconds / stepCount
                for (let i = 1; i <= stepCount; i++) {
                  const t = i / stepCount
                  detuneParam.setValueAtTime(evaluateGlideCurve(t, rampType, customEquation) * cents, start + i * stepTime)
                }
              }
            }
            ephem.triggerRelease(voicePitch, start + duration)
          } catch (e) {
            console.error("Offline synth glide render error:", e)
          }
        } else {
          ephem.triggerAttackRelease(voicePitch, duration, start, velocity)
        }
        return
      }

      let noteSynth = synth
      if (overridePreset) {
        if (!overrideSynthsCached[overridePreset]) {
          overrideSynthsCached[overridePreset] = createSynthForPreset(overridePreset).connect(trackInput)
        }
        noteSynth = overrideSynthsCached[overridePreset]
      }

      const isMicrotonal = (playback.pitch % 1 !== 0) || (track?.edoDivision !== undefined && track.edoDivision !== 12)
      const noteHz = Tone.Frequency(playback.pitch + totalTranspose, 'midi').toFrequency() * (noteDetune ? Math.pow(2, noteDetune / 1200) : 1)
      let noteFreq: any = isMicrotonal || noteDetune
        ? noteHz
        : Tone.Frequency(playback.pitch + totalTranspose, 'midi').toNote()
      if (typeof noteFreq === 'number' && noteFreq > 0 && noteFreq < 35) {
        while (noteFreq < 35) noteFreq *= 2
      }
      const safeDuration = typeof duration === 'number' && isFinite(duration) ? duration : 0.1
      const safeStart = typeof start === 'number' && isFinite(start) ? start : 0
      const safeVel = typeof velocity === 'number' && isFinite(velocity) ? velocity : 0.8
      noteSynth.triggerAttackRelease(noteFreq, safeDuration, safeStart, safeVel)
    })
    return
  }

  const drumSynthsCache: Record<string, any> = {}
  const glideIntoMap = buildGlideIntoMap(state.notes)
  const automationTarget = state.automationTargets?.[track.id] ?? 'velocity'
  const sortedNotes = [...notes].sort((a, b) => a.time - b.time)
  sortedNotes.forEach(note => {
    const relativeTime = note.time - startOffset
    if (relativeTime + note.duration < 0) return // Before range
    if (options.endTick !== undefined && note.time >= options.endTick) return // After range

    // Use note-specific TPS for timing and duration if defined
    const noteBpm = note.bpm ?? trackBpm
    const noteTicksPerSecond = (noteBpm / 60) * PPQ

    const start = Math.max(0, relativeTime / noteTicksPerSecond)
    const duration = Math.max(0.01, note.duration / noteTicksPerSecond)
    let laneNote = note
    let velocity = note.velocity / 127
    let autoGain = 1
    let notePan = 0

    const allCurves = state.automationCurves || {}
    const trackCurves = Object.entries(allCurves).filter(([key, pts]) =>
      (key === track.id || key.startsWith(`${track.id}::`)) && pts && pts.length > 0
    )

    if (trackCurves.length > 0) {
      for (const [key, pts] of trackCurves) {
        const targetStr = (key.includes('::') ? key.split('::').slice(1).join('::') : automationTarget) as AutomationTarget
        const laneVal = getLaneValueAtTick({
          points: pts,
          lane: state.automationLanes?.[track.id],
          target: targetStr,
          tick: note.time + note.duration / 2,
          fallback: laneFallbackValue(targetStr, note),
          bpm: state.bpm,
        })
        if (targetStr === 'volume') autoGain = Math.max(0, Math.min(1, laneVal / 127))
        else if (targetStr === 'pan') notePan = laneValueToPan(laneVal)
        else if (targetStr === 'velocity') velocity = laneVal / 127
        else if (parseAutomationTarget(targetStr)?.kind === 'expr' && laneIsActive(pts, state.automationLanes?.[track.id])) {
          laneNote = applyExpressionLaneToNote(laneNote, targetStr, laneVal, {
            lane: state.automationLanes?.[track.id], points: pts, bpm: state.bpm,
          })
        }
      }
    } else {
      const laneValue = getLaneValueAtTick({
        points: state.automationCurves[track.id],
        lane: state.automationLanes?.[track.id],
        target: automationTarget,
        tick: note.time + note.duration / 2,
        fallback: laneFallbackValue(automationTarget, note),
        bpm: state.bpm,
      })
      laneNote = parseAutomationTarget(automationTarget)?.kind === 'expr'
        && laneIsActive(state.automationCurves[track.id], state.automationLanes?.[track.id])
        ? applyExpressionLaneToNote(note, automationTarget, laneValue, {
          lane: state.automationLanes?.[track.id], points: state.automationCurves[track.id], bpm: state.bpm,
        })
        : note
      if (automationTarget === 'volume') autoGain = Math.max(0, Math.min(1, laneValue / 127))
      else if (automationTarget === 'pan') notePan = laneValueToPan(laneValue)
      else if (automationTarget === 'velocity') velocity = laneValue / 127
    }
    velocity = typeof velocity === 'number' && isFinite(velocity) ? Math.max(0, Math.min(1, velocity)) : 0.8

    // Morph crossfades link drums too: a destination hit fades in, a source hit fades out.
    const glideInto = glideIntoMap.get(note.id)
    const fadeInTicks = glideInto?.morph ? glideInto.slideTicks : 0
    const fadeOutTicks = note.glideVoice === 'morph' && note.glideToNoteId
      ? (note.pitchSlideTime ?? note.duration)
      : 0

    const totalTranspose = (track.transpose ?? 0) + (options.semitoneOffset ?? 0) + ((options.octaveOffset ?? 0) * 12)
    const notePitchOffset = (laneNote.pitchOffset ?? 0) + ((laneNote.detune ?? 0) / 100)
    const drumOffset = totalTranspose + notePitchOffset
    const drumOutput: DrumOutputOptions = {
      pan: notePan,
      gain: autoGain,
      fadeIn: fadeInTicks > 0 ? fadeInTicks / noteTicksPerSecond : undefined,
      fadeOut: fadeOutTicks > 0 ? fadeOutTicks / noteTicksPerSecond : undefined
    }
    const drumSlide: DrumSlideOptions | undefined = laneNote.pitchSlide
      ? {
        targetPitchOffset: laneNote.pitchSlide,
        slideTime: laneNote.pitchSlideTime,
        ramp: laneNote.pitchSlideRamp,
        customCurve: laneNote.pitchSlideCustomCurve
      }
      : undefined
    // The same resolver the live preview uses, so a wobbling or sweeping pad leaves the bounce with
    // the expression it had on the transport - and the sweep length comes from this note's own BPM.
    const drumMod = resolveDrumHitModulation(laneNote, {
      pad: note.pitch,
      durationSeconds: duration,
      tickToSeconds: ticks => ticks / noteTicksPerSecond,
      centreCutoffHz: track.drumResonances?.[note.pitch]
    })
    triggerDrum(note.pitch, duration, start, velocity, trackInput, track, note.instrumentOverride as DrumKit,
      drumSynthsCache, drumOffset, drumSlide,
      { octaves: laneNote.octaves, resonance: laneNote.resonance, decay: laneNote.decay },
      drumOutput, noteTicksPerSecond, drumMod, sampleBuffersCache)
  })
}

function renderMetronome(duration: number, ticksPerSecond: number, state: AppState, startTick = 0): void {
  const settings = state.metronomeSettings
  const metronome = new Tone.MembraneSynth({
    pitchDecay: settings.pitchDecay,
    octaves: settings.octaves,
    envelope: {
      attack: settings.attack,
      decay: settings.decay,
      sustain: settings.sustain,
      release: settings.release,
    }
  }).toDestination()
  metronome.volume.value = settings.volume

  const beatsPerMeasure = parseInt(state.timeSignature.split('/')[0]) || 4
  const ticksPerBeat = PPQ
  const endTick = startTick + duration * ticksPerSecond
  // Clicks stay on the project beat grid, matching live playback, so a loop export that starts
  // mid-bar still accents the real downbeats instead of restarting the count at the loop start.
  const firstBeat = Math.ceil(startTick / ticksPerBeat)

  for (let beatIndex = firstBeat; beatIndex * ticksPerBeat < endTick; beatIndex++) {
    const tick = beatIndex * ticksPerBeat
    const time = (tick - startTick) / ticksPerSecond
    const isDownbeat = beatIndex % beatsPerMeasure === 0
    const note = isDownbeat ? settings.downbeatPitch : settings.upbeatPitch
    const velBase = isDownbeat ? settings.downbeatVel : settings.upbeatVel
    const velocity = Math.max(0, Math.min(1, state.metronomeVolume * velBase))
    metronome.triggerAttackRelease(note, '32n', time, velocity)
  }
}

function getTrackFxSetting(track: Track, instId: string, instType: string, paramName: string, fallback: number): number {
  return readTrackFxSetting(track as any, instId, instType, paramName, fallback)
}

function scheduleTrackDPreverb(
  track: Track,
  notes: Note[],
  state: AppState,
  fxNodes: Record<string, Tone.ToneAudioNode> | undefined,
  options: RenderOptions
): void {
  if (!fxNodes) return

  const dpreverbs = getActiveDPreverbInstances(track as any)
    .map(({ inst, settings }) => ({ inst, settings, node: fxNodes[inst.id] }))
    .filter(({ node }) => node instanceof DPreverbNode) as Array<{
      inst: { id: string; type: string }
      settings: { wet: number; tail: number; decay: number; tone: number }
      node: DPreverbNode
    }>

  if (dpreverbs.length === 0) return

  const trackBpm = track.targetTempo ?? state.bpm
  const startOffset = options.startTick ?? 0
  const endTick = options.endTick
  const sortedNotes = [...notes].sort((a, b) => a.time - b.time)

  sortedNotes.forEach(note => {
    if (endTick !== undefined && note.time >= endTick) return

    const noteBpm = note.bpm ?? trackBpm
    const noteTicksPerSecond = (noteBpm / 60) * PPQ
    const noteStartSeconds = Math.max(0, (note.time - startOffset) / noteTicksPerSecond)

    dpreverbs.forEach(({ settings, node }) => {
      const idealPreStartTick = note.time - (settings.tail * noteTicksPerSecond)
      const preStartTick = Math.max(startOffset, idealPreStartTick)
      if (endTick !== undefined && preStartTick >= endTick) return

      const preStartSeconds = Math.max(0, (preStartTick - startOffset) / noteTicksPerSecond)
      const effectiveDuration = noteStartSeconds - preStartSeconds
      if (effectiveDuration <= 0.015) return

      node.trigger(effectiveDuration, preStartSeconds, settings.wet, settings.decay, settings.tone)
    })
  })
}

function getOfflineCustomFxInstances(track: Track, state: AppState): Array<{ inst: { id: string; type: string }; config: CustomFxConfig }> {
  return getTrackFxInstances(track.fxInstances)
    .map(inst => ({ inst, config: state.customFxConfigs.find(c => c.id === inst.type) }))
    .filter((entry): entry is { inst: { id: string; type: string }; config: CustomFxConfig } => {
      return entry.config?.mode === 'offline'
    })
}

function getCustomFxParams(config: CustomFxConfig, track: Track, instanceId: string): Record<string, number> {
  const settings = track.fxSettings?.[instanceId] ?? {}
  return config.params.reduce<Record<string, number>>((acc, param) => {
    acc[param.name] = settings[param.name] ?? param.defaultVal
    return acc
  }, {})
}

function cloneAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const ctx = Tone.context
  const cloned = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    cloned.getChannelData(channel).set(buffer.getChannelData(channel))
  }
  return cloned
}

export function mixAudioBuffers(buffers: AudioBuffer[]): AudioBuffer {
  if (buffers.length === 0) {
    const ctx = Tone.context
    return ctx.createBuffer(2, 1, ctx.sampleRate)
  }
  if (buffers.length === 1) {
    return buffers[0]
  }

  const sampleRate = buffers[0].sampleRate
  const numberOfChannels = Math.max(...buffers.map(buffer => buffer.numberOfChannels))
  const length = Math.max(...buffers.map(buffer => buffer.length))
  const ctx = Tone.context
  const mixed = ctx.createBuffer(numberOfChannels, length, sampleRate)

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const output = mixed.getChannelData(channel)
    buffers.forEach(buffer => {
      const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
      const count = Math.min(output.length, source.length)
      for (let i = 0; i < count; i++) {
        output[i] += source[i]
      }
    })
  }

  return mixed
}

function applyOfflineCustomFx(
  buffer: AudioBuffer,
  track: Track,
  state: AppState,
  options: RenderOptions
): AudioBuffer {
  let currentBuffer = cloneAudioBuffer(buffer)
  const fxEntries = getOfflineCustomFxInstances(track, state)
  if (fxEntries.length === 0) return currentBuffer

  fxEntries.forEach(({ inst, config }) => {
    const sampleRate = currentBuffer.sampleRate
    const channelCount = currentBuffer.numberOfChannels
    const length = currentBuffer.length
    const duration = length / sampleRate
    const input = Array.from({ length: channelCount }, (_, channel) => {
      return new Float32Array(currentBuffer.getChannelData(channel))
    })
    const output = input.map(channelData => new Float32Array(channelData))
    const params = getCustomFxParams(config, track, inst.id)
    const scriptState: Record<string, unknown> = {}
    const context = {
      track,
      notes: state.notes.filter(note => note.trackId === track.id),
      project: {
        bpm: state.bpm,
        timeSignature: state.timeSignature,
        startTick: options.startTick ?? 0,
        endTick: options.endTick,
      },
      fx: {
        id: inst.id,
        type: inst.type,
        name: config.name,
        mode: config.mode ?? 'realtime'
      },
      sampleRate,
      duration,
      length,
      channelCount,
      clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
    }

    try {
      const fn = new Function(
        'input',
        'output',
        'params',
        'state',
        'sampleRate',
        'duration',
        'currentTime',
        'context',
        config.code
      )
      fn(input, output, params, scriptState, sampleRate, duration, 0, context)
    } catch (err) {
      throw new Error(`Offline FX "${config.name}" failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
    }

    const ctx = Tone.context
    const processed = ctx.createBuffer(channelCount, length, sampleRate)
    for (let channel = 0; channel < channelCount; channel++) {
      const target = processed.getChannelData(channel)
      const source = output[channel] ?? input[channel]
      target.set(source.subarray(0, length))
    }
    currentBuffer = processed
  })

  return currentBuffer
}

async function renderWithOfflineCustomFx(
  state: AppState,
  options: RenderOptions,
  renderableTracks: Track[]
): Promise<AudioBuffer> {
  const tracksWithOfflineFx = renderableTracks.filter(track => getOfflineCustomFxInstances(track, state).length > 0)
  const offlineTrackIds = new Set(tracksWithOfflineFx.map(track => track.id))
  const buffers: AudioBuffer[] = []
  const componentOptions: RenderOptions = {
    ...options,
    normalize: false,
    autoFade: false,
    skipOfflineCustomFx: true,
    exportRegionMode: false,
    exportRegions: []
  }

  const baseTracks = renderableTracks.filter(track => !offlineTrackIds.has(track.id))
  const baseTrackIds = new Set(baseTracks.map(track => track.id))
  const baseHasNotes = state.notes.some(note => !note.muted && baseTrackIds.has(note.trackId))
  if (baseHasNotes || options.includeMetronome) {
    const baseState: AppState = {
      ...state,
      tracks: baseTracks,
      notes: state.notes.filter(note => !note.muted && baseTrackIds.has(note.trackId)),
      automationCurves: Object.fromEntries(
        baseTracks.map(track => [track.id, state.automationCurves[track.id] ?? []])
      )
    }

    try {
      buffers.push(await renderProjectAudio(baseState, {
        ...componentOptions,
        trackId: undefined,
        trackIds: undefined
      }))
    } catch (err) {
      if (baseHasNotes || options.includeMetronome) throw err
    }
  }

  for (const track of tracksWithOfflineFx) {
    const trackState: AppState = {
      ...state,
      tracks: [track],
      notes: state.notes.filter(note => !note.muted && note.trackId === track.id),
      automationCurves: { [track.id]: state.automationCurves[track.id] ?? [] }
    }

    try {
      const dryBuffer = await renderProjectAudio(trackState, {
        ...componentOptions,
        trackId: track.id,
        trackIds: undefined,
        includeMetronome: false
      })
      buffers.push(applyOfflineCustomFx(dryBuffer, track, state, options))
    } catch (err) {
      const hasTrackNotes = state.notes.some(note => note.trackId === track.id)
      if (hasTrackNotes) throw err
    }
  }

  if (buffers.length === 0) throw new Error('No audible notes to export in selected range')

  const mixedBuffer = mixAudioBuffers(buffers)
  if (options.autoFade) {
    applyAudioBufferFadeOut(mixedBuffer, state.studioSettings.renderFadeDuration)
  }
  if (options.normalize) {
    normalizeAudioBuffer(mixedBuffer, state.studioSettings.normalizationTarget)
  }
  return mixedBuffer
}

export function stitchAudioBuffers(buffers: AudioBuffer[], gaps: number[]): AudioBuffer {
  if (buffers.length === 0) {
    const ctx = Tone.context;
    return ctx.createBuffer(1, 1, ctx.sampleRate);
  }

  const sampleRate = buffers[0].sampleRate;
  const numberOfChannels = Math.max(...buffers.map(b => b.numberOfChannels));

  let totalLength = 0;
  for (let i = 0; i < buffers.length; i++) {
    totalLength += buffers[i].length;
    if (i < gaps.length) {
      totalLength += Math.round(gaps[i] * sampleRate);
    }
  }

  const ctx = Tone.context;
  const stitchedBuffer = ctx.createBuffer(numberOfChannels, totalLength, sampleRate);

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = stitchedBuffer.getChannelData(channel);
    let writeOffset = 0;

    for (let i = 0; i < buffers.length; i++) {
      const buf = buffers[i];
      if (channel < buf.numberOfChannels) {
        channelData.set(buf.getChannelData(channel), writeOffset);
      }
      writeOffset += buf.length;

      if (i < gaps.length) {
        writeOffset += Math.round(gaps[i] * sampleRate);
      }
    }
  }

  return stitchedBuffer;
}

export async function renderProjectAudio(state: AppState, options: RenderOptions): Promise<AudioBuffer> {
  if (options.exportRegionMode && options.exportRegions && options.exportRegions.length > 0) {
    const buffers: AudioBuffer[] = [];
    const gaps: number[] = [];

    // Copy to avoid mutating original
    const sortedRegions = [...options.exportRegions].sort((a, b) => a.startTick - b.startTick);

    for (const region of sortedRegions) {
      const regionOptions: RenderOptions = {
        ...options,
        exportRegionMode: false,
        exportRegions: [],
        startTick: region.startTick,
        endTick: region.endTick,
        // Normalize/fade once over the stitched result so regions keep their relative level.
        normalize: false,
        autoFade: false
      };
      try {
        const buf = await renderProjectAudio(state, regionOptions);
        buffers.push(buf);
        gaps.push(region.gap);
      } catch (err) {
        // Handle empty region gracefully by exporting silence
        const durationTicks = region.endTick - region.startTick;
        const globalTPS = (state.bpm / 60) * PPQ;
        const durationSeconds = Math.max(0.1, durationTicks / globalTPS);
        const ctx = Tone.context;
        const sampleRate = ctx.sampleRate;
        const silentBuf = ctx.createBuffer(2, Math.round(durationSeconds * sampleRate), sampleRate);
        buffers.push(silentBuf);
        gaps.push(region.gap);
      }
    }

    const stitched = stitchAudioBuffers(buffers, gaps);
    if (options.autoFade) {
      applyAudioBufferFadeOut(stitched, state.studioSettings.renderFadeDuration)
    }
    if (options.normalize) {
      normalizeAudioBuffer(stitched, state.studioSettings.normalizationTarget)
    }
    return stitched;
  }

  const { notes, tracks, bpm } = state
  const groups = state.groups ?? []
  let renderableTracks = tracks.filter(track => shouldRenderTrack(track, tracks, groups))

  if (options.trackId) {
    renderableTracks = renderableTracks.filter(t => t.id === options.trackId)
  } else if (options.trackIds && options.trackIds.length > 0) {
    renderableTracks = renderableTracks.filter(t => options.trackIds!.includes(t.id))
  }

  const startTick = options.startTick ?? 0
  const endTick = options.endTick ?? Math.max(768, ...notes.map(n => n.time + n.duration))

  const renderableTrackIds = new Set(renderableTracks.map(track => track.id))
  const renderableNotes = notes.filter(note =>
    !note.muted &&
    renderableTrackIds.has(note.trackId) &&
    (note.time + note.duration) > startTick &&
    note.time < endTick
  )

  if (renderableNotes.length === 0 && !options.includeMetronome) {
    throw new Error(`No audible notes found in selected export range (ticks ${startTick} to ${endTick}). Please check that your track contains notes within this range.`)
  }

  // Calculate real-time duration by checking every note against its track's tempo
  let maxSeconds = 0
  renderableNotes.forEach(note => {
    const track = tracks.find(t => t.id === note.trackId)
    const trackBpm = track?.targetTempo ?? state.bpm
    const trackTPS = (trackBpm / 60) * PPQ
    const noteEnd = (note.time + note.duration - startTick) / trackTPS
    if (noteEnd > maxSeconds) maxSeconds = noteEnd
  })

  // Also consider the absolute duration of the selected tick range at global BPM
  const globalTPS = (bpm / 60) * PPQ
  const rangeDuration = (endTick - startTick) / globalTPS
  if (rangeDuration > maxSeconds) {
    // If the requested range is longer than the notes (e.g. exporting a silent tail)
    maxSeconds = rangeDuration
  }

  const endBufferSeconds = state.studioSettings.loopEndBuffer / globalTPS
  const fadeDuration = state.studioSettings.renderFadeDuration
  const renderDuration = Math.max(maxSeconds + endBufferSeconds + (options.autoFade ? fadeDuration : 0.5), 1)

  if (!options.skipOfflineCustomFx && renderableTracks.some(track => getOfflineCustomFxInstances(track, state).length > 0)) {
    return renderWithOfflineCustomFx(state, options, renderableTracks)
  }

  const originalContext = Tone.getContext()
  const targetSampleRate = (originalContext && typeof (originalContext as any).sampleRate === 'number' && (originalContext as any).sampleRate > 0)
    ? (originalContext as any).sampleRate
    : 44100

  const sampleBuffersCache = new Map<string, AudioBuffer>()
  const rawLiveCtx = (originalContext?.rawContext || Tone.getContext().rawContext) as AudioContext

  // Pre-decode all synth and drum sample buffers before starting offline render
  for (const track of renderableTracks) {
    if (track.synthMode === 'sampler' && track.synthSampler?.audioBase64) {
      const uri = track.synthSampler.audioBase64
      try {
        const ab = await (await fetch(uri)).arrayBuffer()
        const decoded = await rawLiveCtx.decodeAudioData(ab)
        sampleBuffersCache.set(`synth:${track.id}`, decoded)
      } catch (err) {
        console.warn(`Failed to pre-decode synth sampler for track ${track.id}:`, err)
      }
    }
    if (track.drumPadSamples) {
      for (const [pStr, s] of Object.entries(track.drumPadSamples)) {
        if (s?.audioBase64) {
          try {
            const ab = await (await fetch(s.audioBase64)).arrayBuffer()
            const decoded = await rawLiveCtx.decodeAudioData(ab)
            sampleBuffersCache.set(`drum:${track.id}:${pStr}`, decoded)
          } catch (err) {
            console.warn(`Failed to pre-decode drum pad sample ${pStr} on track ${track.id}:`, err)
          }
        }
      }
    }
  }

  const offlineContext = new Tone.OfflineContext(2, renderDuration, targetSampleRate)
  Tone.setContext(offlineContext)

  let nativeBuffer: AudioBuffer | null = null

  try {
    // Apply master volume to match live playback levels
    Tone.Destination.volume.value = Tone.gainToDb(Math.max(0.0001, state.studioSettings.masterVolume))

    // Master limiter matching the live AudioEngine's masterLimiter
    const limiterThreshold = state.studioSettings.limiterEnabled
      ? state.studioSettings.limiterThreshold
      : 0 // bypass at 0 dBFS when disabled
    const masterLimiter = new Tone.Limiter(limiterThreshold).toDestination()

    const racks: Record<string, Tone.Gain> = {}
    const channels: Record<string, Tone.Channel> = {}
    const allFxNodes: Record<string, Record<string, Tone.ToneAudioNode>> = {}

    // First pass: Create all racks asynchronously to allow AudioWorklet loading
    const rackPromises = tracks.map(async track => {
      const input = new Tone.Gain()

      const allInstances = getTrackFxInstances(track.fxInstances, track.fxOrder)
      // Filter out completely inactive / bypassed effects to maximize offline render throughput
      const activeFxInstances = allInstances.filter(inst => {
        if (Array.isArray(track.fxOrder) && !track.fxOrder.includes(inst.type as BuiltInFxType)) {
          return false
        }
        if (track.fxModulators?.[inst.id] && Object.keys(track.fxModulators[inst.id]).length > 0) {
          return true
        }
        if (inst.type === 'eq') {
          const low = readTrackFxSetting(track, inst.id, 'eq', 'lowGain', 0)
          const mid = readTrackFxSetting(track, inst.id, 'eq', 'midGain', 0)
          const high = readTrackFxSetting(track, inst.id, 'eq', 'highGain', 0)
          return low !== 0 || mid !== 0 || high !== 0
        }
        const wetVal = readTrackFxSetting(track, inst.id, inst.type as BuiltInFxType, 'wet', 0)
        return wetVal > 0.001
      })
      const fxNodesMap: Record<string, Tone.ToneAudioNode> = {}

      for (const inst of activeFxInstances) {
        let node: Tone.ToneAudioNode
        const settings = track.fxSettings?.[inst.id] ?? {}

        if (inst.type === 'eq') {
          node = new Tone.EQ3({
            low: readTrackFxSetting(track, inst.id, 'eq', 'lowGain', 0),
            mid: readTrackFxSetting(track, inst.id, 'eq', 'midGain', 0),
            high: readTrackFxSetting(track, inst.id, 'eq', 'highGain', 0),
          })
        } else if (inst.type === 'distortion') {
          node = new Tone.Distortion({
            distortion: Math.max(0, Math.min(1, readTrackFxSetting(track, inst.id, 'distortion', 'amount', 0.4))),
            wet: Math.max(0, Math.min(1, readTrackFxSetting(track, inst.id, 'distortion', 'wet', 0)))
          })
        } else if (inst.type === 'chorus') {
          node = new Tone.Chorus({
            frequency: Math.max(0.1, readTrackFxSetting(track, inst.id, 'chorus', 'frequency', 1.5)),
            delayTime: Math.max(0.5, readTrackFxSetting(track, inst.id, 'chorus', 'delayTime', 3.5)),
            depth: Math.max(0, Math.min(1, readTrackFxSetting(track, inst.id, 'chorus', 'depth', 0.7))),
            feedback: Math.max(0, Math.min(0.9, readTrackFxSetting(track, inst.id, 'chorus', 'feedback', 0))),
            wet: Math.max(0, Math.min(1, readTrackFxSetting(track, inst.id, 'chorus', 'wet', 0)))
          }).start()
        } else if (inst.type === 'phaser') {
          node = new Tone.Phaser({
            frequency: Math.max(0.1, readTrackFxSetting(track, inst.id, 'phaser', 'frequency', 0.5)),
            octaves: Math.max(0.5, readTrackFxSetting(track, inst.id, 'phaser', 'octaves', 3)),
            baseFrequency: Math.max(20, readTrackFxSetting(track, inst.id, 'phaser', 'baseFreq', 350)),
            wet: Math.max(0, Math.min(1, readTrackFxSetting(track, inst.id, 'phaser', 'wet', 0)))
          })
        } else if (inst.type === 'delay') {
          node = new Tone.FeedbackDelay({
            delayTime: Math.max(0.01, readTrackFxSetting(track, inst.id, 'delay', 'time', 0.25)),
            feedback: Math.max(0, Math.min(0.95, readTrackFxSetting(track, inst.id, 'delay', 'feedback', 0.25))),
            wet: Math.max(0, Math.min(1, readTrackFxSetting(track, inst.id, 'delay', 'wet', 0)))
          })
        } else if (inst.type === 'dpreverb') {
          node = new DPreverbNode()
        } else if (inst.type === 'reverb') {
          const decayVal = Math.max(0.1, readTrackFxSetting(track, inst.id, 'reverb', 'decay', 2.5))
          const preDelayVal = Math.max(0, readTrackFxSetting(track, inst.id, 'reverb', 'preDelay', 0.01))
          const wetVal = Math.max(0, Math.min(1, readTrackFxSetting(track, inst.id, 'reverb', 'wet', 0)))

          const liveReverb = audioEngine.getLiveFxNode(track.id, inst.id) as any
          const precompiledBuffer = liveReverb?.buffer

          if (precompiledBuffer) {
            const reverbNode = new Tone.Reverb({
              decay: decayVal,
              preDelay: preDelayVal,
              wet: wetVal
            })
              ; (reverbNode as any).buffer = precompiledBuffer
            node = reverbNode
          } else {
            // Fallback to Freeverb to guarantee it never hangs if live buffer is not ready
            node = new Tone.Freeverb({
              roomSize: Math.min(0.95, Math.max(0.1, decayVal / 10)),
              dampening: 4000,
              wet: wetVal
            })
          }
        } else if (inst.type === 'freeverb') {
          node = new Tone.Freeverb({
            roomSize: Math.max(0.01, Math.min(0.95, readTrackFxSetting(track, inst.id, 'freeverb', 'roomSize', 0.7))),
            dampening: readTrackFxSetting(track, inst.id, 'freeverb', 'dampening', 4000),
            wet: Math.max(0, Math.min(1, readTrackFxSetting(track, inst.id, 'freeverb', 'wet', 0)))
          })
        } else {
          // Custom JIT Script Processor node
          const config = state.customFxConfigs.find(c => c.id === inst.type)
          if (config?.mode === 'offline') {
            node = new Tone.Gain()
          } else {
            const customNode = new CustomScriptProcessorNode()
            if (config) {
              customNode.setParams(settings)
              customNode.setHostContext({
                trackId: track.id,
                trackName: track.name,
                fxInstanceId: inst.id,
                fxType: inst.type,
                bpm: state.bpm,
                mode: config.mode ?? 'realtime'
              })
              await customNode.compileCode(config.code)
            }
            node = customNode
          }
        }
        fxNodesMap[inst.id] = node
      }

      // Connect nodes in series
      let lastNode: Tone.ToneAudioNode = input
      activeFxInstances.forEach(inst => {
        const currentNode = fxNodesMap[inst.id]
        if (currentNode) {
          lastNode.connect(currentNode)
          lastNode = currentNode
        }
      })

      const effective = getEffectiveTrackLevel(track, groups)
      const channel = createTrackChannel({
        volume: gainToDb(effective.volume),
        pan: typeof track.pan === 'number' && isFinite(track.pan) ? track.pan : 0,
        mute: effective.muted,
        solo: effective.soloed,
      })

      lastNode.connect(channel)

      racks[track.id] = input
      channels[track.id] = channel
      allFxNodes[track.id] = fxNodesMap
    })

    await Promise.all(rackPromises)

    // Second pass: Route based on hierarchy
    tracks.forEach(track => {
      const channel = channels[track.id]
      if (track.parentId && channels[track.parentId]) {
        channel.connect(racks[track.parentId])
      } else {
        channel.connect(masterLimiter)
      }
    })

    if (options.includeProceduralFx && state.studioSettings.proceduralFxEnabled) {
      const rateStr = state.studioSettings.proceduralFxRate || '32n'
      const rateTicks = rateStr === '16n' ? 48 : rateStr === '32n' ? 24 : rateStr === '64n' ? 12 : rateStr === '128n' ? 6 : 24
      const stepDuration = rateTicks / globalTPS
      const totalSteps = Math.ceil(renderDuration / stepDuration)

      renderableTracks.forEach(track => {
        if (!track.fxModulators || Object.keys(track.fxModulators).length === 0) return

        const rackNodes = allFxNodes[track.id]
        if (!rackNodes) return

        Object.entries(track.fxModulators).forEach(([instanceId, mods]) => {
          const node = rackNodes[instanceId]
          const inst = getTrackFxInstances(track.fxInstances).find(i => i.id === instanceId)
          if (!node || !inst) return

          // Custom and scheduled preverb nodes do not expose continuous Tone params here.
          if (node instanceof CustomScriptProcessorNode || node instanceof DPreverbNode) return

          const scheduleParam = (paramName: string, fallback: number, paramObj: any) => {
            if (!paramObj || typeof paramObj.setValueAtTime !== 'function') return

            const mod = mods[paramName]
            if (!mod) return

            let fn: Function
            try {
              fn = new Function('t', 'b', 'm', 'ticks', `return ${mod.formula}`)
            } catch (e) {
              return
            }

            const baseVal = getTrackFxSetting(track, instanceId, inst.type, paramName, fallback)

            for (let step = 0; step < totalSteps; step++) {
              const t = step * stepDuration
              const ticks = t * globalTPS
              const b = ticks / PPQ
              const m = b / 4

              let result: number
              try {
                result = fn(t, b, m, ticks)
              } catch (e) {
                continue
              }
              if (!isFinite(result) || isNaN(result)) continue

              let finalVal = baseVal
              if (mod.mode === 'override') finalVal = result
              else if (mod.mode === 'add') finalVal = baseVal + result
              else if (mod.mode === 'multiply') finalVal = baseVal * result

              if (paramName === 'wet') finalVal = Math.max(0, Math.min(1, finalVal))
              if (paramName === 'feedback') finalVal = Math.max(0, Math.min(0.9, finalVal))
              if (paramName === 'amount') finalVal = Math.max(0, Math.min(1, finalVal))
              if (paramName === 'depth') finalVal = Math.max(0, Math.min(1, finalVal))

              if (typeof finalVal !== 'number' || !isFinite(finalVal) || isNaN(finalVal)) continue
              const safeT = typeof t === 'number' && isFinite(t) ? t : 0

              try {
                paramObj.setValueAtTime(finalVal, safeT)
              } catch (err) {
                // Ignore schedule errors
              }
            }
          }

          switch (inst.type) {
            case 'eq': {
              const eqNode = node as Tone.EQ3
              scheduleParam('lowGain', 0, eqNode.low)
              scheduleParam('midGain', 0, eqNode.mid)
              scheduleParam('highGain', 0, eqNode.high)
              break
            }
            case 'distortion': {
              const distNode = node as Tone.Distortion
              scheduleParam('wet', 0, distNode.wet)
              break
            }
            case 'chorus': {
              const chorusNode = node as Tone.Chorus
              scheduleParam('wet', 0, chorusNode.wet)
              scheduleParam('frequency', 1.5, chorusNode.frequency)
              break
            }
            case 'phaser': {
              const phaserNode = node as Tone.Phaser
              scheduleParam('wet', 0, phaserNode.wet)
              scheduleParam('frequency', 0.5, phaserNode.frequency)
              break
            }
            case 'delay': {
              const delayNode = node as Tone.FeedbackDelay
              scheduleParam('wet', 0, delayNode.wet)
              scheduleParam('time', 0.25, delayNode.delayTime)
              scheduleParam('feedback', 0.25, delayNode.feedback)
              break
            }
            case 'reverb': {
              const reverbNode = node as any
              scheduleParam('wet', 0, reverbNode.wet)
              break
            }
            case 'freeverb': {
              const freeverbNode = node as Tone.Freeverb
              scheduleParam('wet', 0, freeverbNode.wet)
              scheduleParam('roomSize', 0.7, freeverbNode.roomSize)
              break
            }
          }
        })
      })
    }

    if (options.includeMetronome) {
      renderMetronome(renderDuration, globalTPS, state, startTick)
    }

    renderableTracks.forEach(track => {
      const trackNotes = renderableNotes.filter(note => note.trackId === track.id)
      scheduleTrackDPreverb(track, trackNotes, state, allFxNodes[track.id], options)
      renderTrackNotesWithTransform(track, trackNotes, state, racks[track.id], options, sampleBuffersCache)
    })

    const toneBuffer = await offlineContext.render(false)
    nativeBuffer = (toneBuffer as any)?.get ? (toneBuffer as any).get() : ((toneBuffer as any)?._buffer || (toneBuffer as any))
  } finally {
    Tone.setContext(originalContext)
  }

  if (!nativeBuffer) throw new Error('Render produced empty buffer')

  if (options.autoFade) {
    applyAudioBufferFadeOut(nativeBuffer, fadeDuration)
  }

  if (options.normalize) {
    normalizeAudioBuffer(nativeBuffer, state.studioSettings.normalizationTarget)
  }

  return nativeBuffer
}
