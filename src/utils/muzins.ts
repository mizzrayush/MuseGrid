import type { Track } from '../engine/store'
import { calculateFourierPartials } from './mathWaveform'

export interface MuzinsPatch {
  name: string
  engineType: string
  config: any
}

const OSC_TYPES: Track['synthOscillator'][] = ['sine', 'square', 'sawtooth', 'triangle', 'custom']
const FILTER_TYPES: Track['synthFilterType'][] = ['lowpass', 'highpass', 'bandpass', 'notch']

const asFinite = (value: any): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Flattens a .muzins config into the per-track patch fields both engines understand.
 * These fields are the portable surface: a patch saved here plays the same in the
 * native JUCE synth and in the web fallback (partials are precomputed as amplitudes).
 */
export const trackFieldsFromMuzins = (muzins: Partial<MuzinsPatch> | null | undefined): Partial<Track> => {
  const config = muzins?.config
  if (!config || typeof config !== 'object') return {}

  const fields: Partial<Track> = {}
  const osc = config.oscillator || {}

  let oscType: string | undefined = typeof osc.type === 'string' ? osc.type.toLowerCase() : undefined
  if (oscType?.startsWith('fat')) {
    if (asFinite(osc.count) !== undefined) fields.synthUnison = Math.max(1, Math.min(16, Math.round(osc.count)))
    if (asFinite(osc.spread) !== undefined) fields.synthDetuneSpread = Math.max(0, Math.min(100, osc.spread))
    oscType = oscType.slice(3).trim()
  }
  if (oscType === 'saw') oscType = 'sawtooth'
  if (oscType && OSC_TYPES.includes(oscType as Track['synthOscillator'])) {
    fields.synthOscillator = oscType as Track['synthOscillator']
  }

  if (typeof osc.formula === 'string' && osc.formula.trim()) {
    fields.synthFormula = osc.formula
    const count = asFinite(osc.partialsCount) !== undefined
      ? Math.max(1, Math.min(64, Math.round(osc.partialsCount)))
      : 16
    fields.synthPartialsCount = count
    fields.synthOscillator = 'custom'
    try {
      fields.synthPartials = calculateFourierPartials(osc.formula, count)
    } catch {
      // An unparseable formula keeps the patch usable with the plain oscillator.
    }
  } else if (Array.isArray(osc.partials) && osc.partials.length > 0) {
    // Patches written by Sound Designer store the amplitudes directly.
    const partials = (osc.partials as any[])
      .map(asFinite)
      .filter((v: number | undefined): v is number => v !== undefined)
      .slice(0, 64)
    if (partials.length > 0) {
      fields.synthOscillator = 'custom'
      fields.synthPartials = partials
      fields.synthPartialsCount = partials.length
    }
  }

  const env = config.envelope || {}
  if (asFinite(env.attack) !== undefined) fields.synthAttack = env.attack
  if (asFinite(env.decay) !== undefined) fields.synthDecay = env.decay
  if (asFinite(env.sustain) !== undefined) fields.synthSustain = env.sustain
  if (asFinite(env.release) !== undefined) fields.synthRelease = env.release
  if (typeof env.curveType === 'string') fields.synthDecayCurveType = env.curveType
  if (asFinite(env.tension) !== undefined) fields.synthDecayTension = env.tension
  if (typeof env.formula === 'string' && env.formula.trim()) fields.synthDecayFormula = env.formula

  const filter = config.filter || {}
  if (typeof filter.type === 'string') {
    const type = filter.type.toLowerCase()
    if (FILTER_TYPES.includes(type as Track['synthFilterType'])) {
      fields.synthFilterType = type as Track['synthFilterType']
    }
  }
  if (asFinite(filter.frequency) !== undefined) {
    fields.synthFilterFreq = Math.max(20, Math.min(20000, filter.frequency))
  }
  if (asFinite(filter.Q) !== undefined) {
    fields.synthFilterQ = Math.max(0.5, Math.min(12, filter.Q))
  }

  if (asFinite(config.unison) !== undefined) {
    fields.synthUnison = Math.max(1, Math.min(16, Math.round(config.unison)))
  }
  if (asFinite(config.detuneSpread) !== undefined) {
    fields.synthDetuneSpread = Math.max(0, Math.min(100, config.detuneSpread))
  }
  if (asFinite(config.detune) !== undefined) fields.synthDetune = config.detune
  if (asFinite(config.fineDetune) !== undefined) fields.synthDetune = config.fineDetune
  if (asFinite(config.portamento) !== undefined) fields.synthPortamento = config.portamento

  return fields
}
