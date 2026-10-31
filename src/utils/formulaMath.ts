/**
 * The scope every user-authored formula is compiled with. Formulas keep `Math`, and also get the
 * short names producers expect (`sin`, `pow`, `pi`) plus a few shape helpers, so the same text
 * behaves identically in tempo curves, FX modulators, lanes and baked procedural curves.
 */
export const FORMULA_MATH_SCOPE = `
const { abs, acos, asin, atan, atan2, cbrt, ceil, cos, exp, floor, hypot, log, log10, log2, max, min, pow, random, round, sign, sin, sqrt, tan, trunc, PI, E } = Math;
const pi = PI;
const tau = PI * 2;
const rand = random;
const clamp = (x, lo = 0, hi = 127) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, amount) => a + (b - a) * amount;
const smoothstep = (edge0, edge1, x) => {
  const span = edge1 - edge0;
  const t = span === 0 ? 0 : clamp((x - edge0) / span, 0, 1);
  return t * t * (3 - 2 * t);
};
`

/** Compile a user formula with the shared math scope, or return null when the syntax is bad. */
export function compileFormula<T extends (...args: any[]) => number>(
  source: string,
  parameters: string[]
): T | null {
  const body = (source || '').trim()
  if (!body) return null
  try {
    return new Function(...parameters, `${FORMULA_MATH_SCOPE}\nreturn (${body});`) as T
  } catch {
    return null
  }
}

/** Small LRU-ish cache: formulas are edited strings, not a growing corpus. */
export function cachedFormula<T>(
  cache: Map<string, T | null>,
  key: string,
  compile: () => T | null,
  limit = 256,
): T | null {
  if (cache.has(key)) return cache.get(key) ?? null
  const compiled = compile()
  if (cache.size >= limit) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, compiled)
  return compiled
}
