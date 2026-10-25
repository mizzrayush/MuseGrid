export type GlideCurveName = 'linear' | 'exponential' | 'logarithmic' | 'sigmoid' | 'custom'

export const CURVE_LUT_POINTS = 33

const compiledCurves = new Map<string, (t: number) => number>()

function compileCustomCurve(equation: string): ((t: number) => number) | null {
  const expr = equation.trim()
  if (!expr) return null
  const cached = compiledCurves.get(expr)
  if (cached) return cached
  try {
    const fn = new Function('t', `return ${expr}`) as (t: number) => number
    compiledCurves.set(expr, fn)
    return fn
  } catch {
    return null
  }
}

/** Normalised 0..1 shape shared by live playback, the canvas preview and the native LUT. */
export function evaluateGlideCurve(t: number, ramp?: string, customEquation?: string): number {
  const x = Math.max(0, Math.min(1, t))
  switch (ramp) {
    case 'exponential':
      return (Math.exp(3 * x) - 1) / (Math.exp(3) - 1)
    case 'logarithmic':
      return Math.log(1 + 9 * x) / Math.log(10)
    case 'sigmoid': {
      const sig = (v: number) => 1 / (1 + Math.exp(-10 * (v - 0.5)))
      const s0 = sig(0)
      const s1 = sig(1)
      return (sig(x) - s0) / (s1 - s0)
    }
    case 'custom': {
      const fn = compileCustomCurve(customEquation || '')
      if (!fn) return x
      try {
        const val = fn(x)
        return Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : x
      } catch {
        return x
      }
    }
    default:
      return x
  }
}

export function buildCurveLut(ramp?: string, customEquation?: string, points = CURVE_LUT_POINTS): number[] {
  const lut: number[] = []
  const last = Math.max(1, points - 1)
  for (let i = 0; i < points; i++) {
    lut.push(evaluateGlideCurve(i / last, ramp, customEquation))
  }
  return lut
}
