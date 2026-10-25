/**
 * Universal Envelope & Transient Curve Generator for Synth Studio & Drum Studio
 * Supports Linear, Natural Acoustic Exponential, Logarithmic, S-Curve, Tension Warping,
 * and Arbitrary Math Expressions f(x).
 * Generates 256-point Float32 LUTs streamed to C++ AudioEngine / WebAudio.
 */

import { evaluateMathExpression } from './mathWaveform'

export type EnvelopeCurveType = 'exponential' | 'linear' | 'logarithmic' | 'scurve' | 'custom'

export interface CurveFormulaPreset {
  id: string
  name: string
  formula: string
  category: 'acoustic' | 'alien' | 'geometric'
  description: string
}

export const CURVE_FORMULA_PRESETS: CurveFormulaPreset[] = [
  {
    id: 'acoustic_natural',
    name: 'Acoustic Piano & Shell',
    formula: 'exp(-4.8 * x)',
    category: 'acoustic',
    description: 'Natural exponential energy loss of piano soundboards and drum skins.'
  },
  {
    id: 'cubic_drop',
    name: 'Cubic Drop Snap',
    formula: 'pow(1 - x, 3)',
    category: 'geometric',
    description: 'Crisp, punchy transient falling with cubic velocity.'
  },
  {
    id: 'hyper_punch',
    name: '808 Sub Plunge',
    formula: 'pow(1 - x, 4.2)',
    category: 'acoustic',
    description: 'Ultra-steep initial dive for punchy sub-bass hits.'
  },
  {
    id: 'alien_bio_ring',
    name: 'Alien Bio-Resonant',
    formula: 'exp(-4 * x) * (0.8 + 0.2 * cos(x * 14 * PI))',
    category: 'alien',
    description: 'Metallic organic micro-flutter modulating through decay tail.'
  },
  {
    id: 'cyber_spike',
    name: 'Cyber Transient Spike',
    formula: '0.75 * exp(-20 * x) + 0.25 * exp(-2.5 * x)',
    category: 'alien',
    description: 'Dual-slope laser attack snapping into a warm, lingering tail.'
  },
  {
    id: 'sigmoid_snap',
    name: 'Sigmoidal Grav-Drop',
    formula: '1 / (1 + exp(14 * (x - 0.45)))',
    category: 'alien',
    description: 'Delayed gravitational drop creating anti-gravity swell and plunge.'
  },
  {
    id: 'plasma_flutter',
    name: 'Plasma Flutter',
    formula: 'pow(1 - x, 2) * (0.85 + 0.15 * sin(x * 28 * PI))',
    category: 'alien',
    description: 'Bio-luminescent plasma shimmer vibrating through sustain.'
  }
]

/**
 * Generate a 256-point normalized curve Lookup Table [y0, y1, ..., y255]
 * where y goes from 1.0 (start) down to 0.0 (end).
 */
export function generateCurveLut(
  type: EnvelopeCurveType,
  tension: number = 0,
  customFormula: string = '',
  points: number = 256
): number[] {
  const lut: number[] = new Array(points)

  if (type === 'custom' && customFormula && customFormula.trim().length > 0) {
    // Arbitrary Math Expression f(x)
    const raw: number[] = new Array(points)
    let minVal = Infinity
    let maxVal = -Infinity

    for (let i = 0; i < points; i++) {
      const x = i / (points - 1)
      let y = evaluateMathExpression(customFormula, x)
      if (isNaN(y) || !isFinite(y)) y = 0
      raw[i] = y
      if (y < minVal) minVal = y
      if (y > maxVal) maxVal = y
    }

    // Smart normalization: if already in [0, 1], preserve start-to-end decay orientation
    const range = maxVal - minVal
    if (range > 0.0001) {
      for (let i = 0; i < points; i++) {
        // Safe clamp to [0, 1]
        lut[i] = Math.max(0, Math.min(1, raw[i]))
      }
    } else {
      // Fallback to linear if expression evaluated to constant
      for (let i = 0; i < points; i++) {
        lut[i] = 1 - (i / (points - 1))
      }
    }
    return lut
  }

  // Tension-warped standard curves
  // tension in [-1.0, 1.0]:
  // -1.0 = steep exponential drop
  //  0.0 = linear or preset default
  // +1.0 = logarithmic convex bulge (fat sustain)

  for (let i = 0; i < points; i++) {
    const x = i / (points - 1)
    let y = 0

    if (type === 'exponential') {
      // Acoustic natural exponential curve
      // k adjusts with tension: default is -4.5
      const k = -4.5 - tension * 3.5
      y = (Math.exp(k * x) - Math.exp(k)) / (1.0 - Math.exp(k))
    } else if (type === 'logarithmic') {
      // Logarithmic bulge
      const k = 4.0 - tension * 2.0
      y = 1.0 - (Math.exp(k * x) - 1.0) / (Math.exp(k) - 1.0)
    } else if (type === 'scurve') {
      // Sigmoidal S-Curve
      const s = 3.0 * x * x - 2.0 * x * x * x
      y = 1.0 - s
      if (tension !== 0) {
        y = Math.pow(y, Math.exp(-tension * 1.5))
      }
    } else {
      // Linear with optional tension bending
      if (Math.abs(tension) < 0.001) {
        y = 1.0 - x
      } else {
        const k = tension * 4.0
        y = (Math.exp(-k * x) - Math.exp(-k)) / (1.0 - Math.exp(-k))
      }
    }

    lut[i] = Math.max(0, Math.min(1, y))
  }

  return lut
}

/**
 * Sample a curve LUT at continuous progress x in [0.0, 1.0] with linear interpolation
 */
export function sampleCurveLut(lut: number[], x: number): number {
  if (!lut || lut.length === 0) return Math.max(0, 1.0 - x)
  const clampedX = Math.max(0, Math.min(1, x))
  const pos = clampedX * (lut.length - 1)
  const i0 = Math.floor(pos)
  const i1 = Math.min(lut.length - 1, i0 + 1)
  const frac = pos - i0
  return lut[i0] + frac * (lut[i1] - lut[i0])
}
