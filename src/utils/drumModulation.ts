import * as Tone from 'tone'
import { buildCurveLut } from './glideCurves'
import { sampleCurveLut } from './envelopeCurves'

/** Where a wobbling noise pad's band sits when the note does not sweep it anywhere. */
const DEFAULT_PAD_CUTOFF_HZ = 4000

/**
 * The pads whose native voice is filtered noise with no note under it, so their wobble moves that
 * band. This is DrumEngine.h's padRidesCutoff set, and the reason the routing is by pad rather than
 * by Tone's class: a MetalSynth hat does have a detune parameter, but the JUCE engine wobbles its
 * band, so the bounce would leave a hat wearing a different expression than the transport played.
 * Snare and rimshot stay out of the set - their body oscillator is the audible note, and both
 * engines move that. A pad outside the set whose Tone voice has no pitch at all falls back to the
 * band, which is the documented noise-only divergence, not a silent control.
 */
const CUTOFF_VIBRATO_PADS = [2, 3, 4, 8, 9, 11]

export function padRidesCutoffVibrato(pad: number): boolean {
  const index = ((Math.trunc(pad) % 16) + 16) % 16
  return CUTOFF_VIBRATO_PADS.indexOf(index) >= 0
}

export interface DrumHitModulation {
  vibratoDepthCents: number
  vibratoRateHz: number
  vibratoWave: 'sine' | 'triangle' | 'square'
  vibratoDelaySeconds: number
  vibratoFadeSeconds: number
  vibratoRidesCutoff: boolean
  filterStartHz?: number
  filterEndHz?: number
  filterSweepSeconds: number
  filterCurve?: number[]
  centreCutoffHz: number
}

/**
 * The expression a drum hit can actually use: a tone wobble with its delay and fade, and a
 * one-shot filter sweep. Amplitude tremolo is left out on purpose - it is not a pad expression,
 * and the JUCE engine ignores it for drums as well, so both paths agree.
 */
export function resolveDrumHitModulation(
  noteData: any,
  opts: {
    pad: number
    durationSeconds: number
    tickToSeconds: (ticks: number) => number
    centreCutoffHz?: number
  }
): DrumHitModulation | undefined {
  const depthCents = Math.max(0, noteData?.vibratoDepth ?? 0)
  const hasSweepStart = typeof noteData?.filterStart === 'number' && noteData.filterStart > 0
  if (depthCents <= 0 && !hasSweepStart) return undefined

  const hasSweepEnd = typeof noteData?.filterEnd === 'number' && noteData.filterEnd > 0
  // The lane bakes its own shape into the note; a hand-drawn sweep falls back to its ramp preset,
  // exactly the pair of sources the native noteOn command picks from.
  const curve = noteData?.laneFilterCurve?.length
    ? (noteData.laneFilterCurve as number[]).slice(0, 33)
    : (hasSweepStart && hasSweepEnd ? buildCurveLut(noteData?.filterSweepRamp) : undefined)

  return {
    vibratoDepthCents: depthCents,
    vibratoRateHz: noteData?.vibratoRate > 0 ? noteData.vibratoRate : 5,
    vibratoWave: noteData?.vibratoWave === 'triangle' || noteData?.vibratoWave === 'square'
      ? noteData.vibratoWave
      : 'sine',
    vibratoDelaySeconds: Math.max(0, (noteData?.vibratoDelay || 0) / 1000),
    vibratoFadeSeconds: Math.max(0, (noteData?.vibratoFade || 0) / 1000),
    vibratoRidesCutoff: padRidesCutoffVibrato(opts.pad),
    filterStartHz: hasSweepStart ? noteData.filterStart : undefined,
    filterEndHz: hasSweepEnd ? noteData.filterEnd : undefined,
    // No sweep length means the ride spans the whole hit, which is how a filter lane arrives.
    filterSweepSeconds: noteData?.filterSweepTime ? opts.tickToSeconds(noteData.filterSweepTime) : opts.durationSeconds,
    filterCurve: curve,
    centreCutoffHz: opts.centreCutoffHz ?? DEFAULT_PAD_CUTOFF_HZ,
  }
}

export interface DrumModulationRig {
  dispose: () => void
}

/**
 * Wires one hit's modulation between its private pad voice and the hit's own output node.
 * The pad decides the lever, exactly as the JUCE voice does: a tonal pad wobbles in cents on
 * `detune`, a filtered pad wobbles the cutoff of the filter inserted here. A voice with no pitch
 * parameter at all still falls back to the band, so nothing a note asks for goes silent.
 * Nothing is inserted unless the note asked for it, so an untouched hit keeps its exact graph.
 */
export function attachDrumHitModulation(
  voice: any,
  mod: DrumHitModulation,
  startSeconds: number,
  holdSeconds: number,
  destination: Tone.ToneAudioNode
): DrumModulationRig {
  const created: Array<{ dispose: () => void }> = []
  const hasPitch = !!voice?.detune && !mod.vibratoRidesCutoff
  const wobblesCutoff = mod.vibratoDepthCents > 0 && !hasPitch
  const needsFilter = wobblesCutoff || mod.filterStartHz !== undefined

  let filter: Tone.Filter | undefined
  if (needsFilter) {
    const centre = mod.filterStartHz ?? mod.centreCutoffHz
    filter = new Tone.Filter(centre, 'lowpass')
    created.push(filter)
    voice.connect(filter)
    filter.connect(destination)

    if (mod.filterStartHz !== undefined && mod.filterEndHz !== undefined) {
      const sweepSeconds = Math.max(0.005, mod.filterSweepSeconds)
      try {
        filter.frequency.setValueAtTime(mod.filterStartHz, startSeconds)
        if (mod.filterCurve?.length) {
          // A shaped ride is stepped the same way the synth glide curve is, so the lane's equation,
          // not just its endpoints, survives the bounce.
          const steps = Math.max(16, Math.min(128, Math.round(sweepSeconds * 64)))
          for (let i = 1; i <= steps; i++) {
            const shape = sampleCurveLut(mod.filterCurve, i / steps)
            filter.frequency.setValueAtTime(
              mod.filterStartHz + (mod.filterEndHz - mod.filterStartHz) * shape,
              startSeconds + (i / steps) * sweepSeconds
            )
          }
        } else {
          filter.frequency.rampTo(mod.filterEndHz, sweepSeconds, startSeconds)
        }
      } catch (_) { }
    }
  } else {
    voice.connect(destination)
  }

  if (mod.vibratoDepthCents > 0) {
    // One LFO per hit, like the native voice: depth in cents on a pitched pad, or in Hz around the
    // band the noise pad is wobbling.
    const centreHz = mod.filterStartHz ?? mod.centreCutoffHz
    const depthUnits = hasPitch
      ? mod.vibratoDepthCents
      : centreHz * (Math.pow(2, mod.vibratoDepthCents / 1200) - 1)
    const lfo = new Tone.Oscillator(mod.vibratoRateHz, mod.vibratoWave)
    const depth = new Tone.Gain(0)
    lfo.connect(depth)
    try {
      const target = (hasPitch ? voice.detune : filter?.frequency) as any
      if (target) depth.connect(target)
    } catch (_) { }
    try {
      // Silent until the delay elapses, then in over the fade, with the LFO phase restarting at the
      // fade - that is how DrumEngine.cpp gates vibrato, and depth 0 until then is what makes a
      // delay slider mean "later" rather than "gradually from the attack".
      const fadeStart = startSeconds + mod.vibratoDelaySeconds
      const fadeEnd = fadeStart + Math.max(0.001, mod.vibratoFadeSeconds)
      depth.gain.setValueAtTime(0, fadeStart)
      depth.gain.linearRampToValueAtTime(depthUnits, fadeEnd)
      lfo.start(fadeStart)
      lfo.stop(startSeconds + Math.max(0.05, mod.vibratoDelaySeconds + holdSeconds))
    } catch (_) { }
    created.push(lfo)
    created.push(depth)
  }

  return {
    dispose: () => {
      created.reverse().forEach(node => { try { node.dispose() } catch (_) { } })
    }
  }
}
