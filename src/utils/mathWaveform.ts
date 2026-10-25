/**
 * Mathematical waveform evaluation and Fourier partials synthesis.
 * Allows users to define arbitrary mathematical formulas f(t) / f(p)
 * for synthesizer and drum lab sound design.
 */

export const evaluateMathExpression = (expr: string, tVal: number): number => {
  const mathProps = Object.getOwnPropertyNames(Math)
  const mathObj: Record<string, any> = {}
  mathProps.forEach(p => {
    mathObj[p] = (Math as any)[p]
  })
  
  // Provide t, p (phase), x, and all Math functions in scope
  const keys = ['t', 'p', 'x', ...Object.keys(mathObj)]
  try {
    const fn = new Function(...keys, `return (${expr});`)
    const val = fn(tVal, tVal, tVal, ...Object.values(mathObj))
    return typeof val === 'number' && !isNaN(val) ? val : 0
  } catch {
    return 0
  }
}

/**
 * Numerically decomposes an arbitrary mathematical expression f(t) into
 * Fourier series sine partials (bn coefficients) for Web Audio PeriodicWave.
 * 
 * @param expr Mathematical expression in terms of t (0 to 2*PI)
 * @param count Number of harmonic partials (1 to 64)
 */
export const calculateFourierPartials = (expr: string, count: number): number[] => {
  const partials: number[] = []
  const steps = Math.max(256, count * 4)

  for (let n = 1; n <= count; n++) {
    let sum = 0
    for (let k = 0; k < steps; k++) {
      const t = (k / steps) * 2 * Math.PI
      sum += evaluateMathExpression(expr, t) * Math.sin(n * t)
    }
    const bn = (2 / steps) * sum
    partials.push(bn)
  }

  const maxAmp = Math.max(...partials.map(Math.abs))
  if (maxAmp > 0.0001) {
    return partials.map(p => p / maxAmp)
  }

  return [1]
}

export interface MathFormulaPreset {
  name: string
  formula: string
  description: string
}

export const MATH_FORMULA_PRESETS: MathFormulaPreset[] = [
  {
    name: 'Harmonic Richness',
    formula: 'sin(t) + 0.6 * sin(3 * t) + 0.3 * sin(5 * t)',
    description: 'Classic odd harmonics creating an assertive organ/reed presence.'
  },
  {
    name: 'Analog Tube Saturation',
    formula: 'tanh(2.5 * sin(t))',
    description: 'Smooth hyperbolic saturation delivering warm vintage drive.'
  },
  {
    name: 'Chebyshev Distortion',
    formula: '4 * pow(sin(t), 3) - 3 * sin(t)',
    description: '3rd-order Chebyshev polynomial shaping glassy overtones.'
  },
  {
    name: 'Metallic FM Clang',
    formula: 'sin(t + 2.2 * sin(3.14 * t))',
    description: 'Phase modulation resulting in industrial metallic timbre.'
  },
  {
    name: 'Bell & Crystal Glass',
    formula: 'sin(t) + 0.5 * sin(2.76 * t) + 0.3 * sin(5.4 * t)',
    description: 'Inharmonic spectrum perfect for ethereal chimes and bells.'
  },
  {
    name: 'Chaotic Noise Texture',
    formula: 'sin(t) + 0.4 * sin(t * 7.1) + 0.2 * (random() - 0.5)',
    description: 'Slight stochastic noise modulation for gritty analog grit.'
  }
]
