import type { AutomationPoint, Note } from '../engine/store'

const MIN_VELOCITY = 1
const MAX_VELOCITY = 127

export function clampVelocity(value: number): number {
  return Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, Math.round(value)))
}

export function sortAutomationPoints(points: AutomationPoint[]): AutomationPoint[] {
  return [...points].sort((a, b) => a.time - b.time)
}

export function getAutomationValueAtTick(
  points: AutomationPoint[] | undefined,
  tick: number,
  fallback = 100,
): number {
  if (!points || points.length === 0) return clampVelocity(fallback)

  const sorted = sortAutomationPoints(points)
  if (sorted.length === 1 || tick <= sorted[0].time) return clampVelocity(sorted[0].value)
  if (tick >= sorted[sorted.length - 1].time) return clampVelocity(sorted[sorted.length - 1].value)

  const rightIndex = sorted.findIndex(point => point.time >= tick)
  const p1 = sorted[rightIndex - 1]
  const p2 = sorted[rightIndex]

  // Time span
  const span = Math.max(1, p2.time - p1.time)
  const t = (tick - p1.time) / span
  const t2 = t * t
  const t3 = t2 * t

  // Get surrounding points for slope calculation
  const p0 = sorted[Math.max(0, rightIndex - 2)]
  const p3 = sorted[Math.min(sorted.length - 1, rightIndex + 1)]

  // Slopes (change in value per unit time)
  const d01 = p1.time !== p0.time ? (p1.value - p0.value) / (p1.time - p0.time) : 0
  const d12 = (p2.value - p1.value) / span
  const d23 = p3.time !== p2.time ? (p3.value - p2.value) / (p3.time - p2.time) : 0

  // Tangents at p1 and p2 (weighted average of surrounding slopes to make it smooth)
  let m1: number
  if (p1.time === p0.time) {
    m1 = d12
  } else {
    m1 = 0.5 * (d01 + d12)
  }

  let m2: number
  if (p3.time === p2.time) {
    m2 = d12
  } else {
    m2 = 0.5 * (d12 + d23)
  }

  // Monotone slope correction: if slopes change direction or are zero, clamp them to prevent overshoot!
  if (d12 === 0) {
    m1 = 0
    m2 = 0
  } else {
    const alpha = m1 / d12
    const beta = m2 / d12
    if (alpha < 0) m1 = 0
    if (beta < 0) m2 = 0
    
    // Scale tangents if they exceed boundaries
    const scale = alpha * alpha + beta * beta
    if (scale > 9) {
      const tau = 3 / Math.sqrt(scale)
      m1 = tau * alpha * d12
      m2 = tau * beta * d12
    }
  }

  // Cubic Hermite Spline interpolation
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2

  const value = h00 * p1.value + h10 * span * m1 + h01 * p2.value + h11 * span * m2
  return clampVelocity(value)
}

export function applyAutomationToNotes(notes: Note[], points: AutomationPoint[]): Array<Pick<Note, 'id' | 'velocity'>> {
  return notes.map(note => ({
    id: note.id,
    velocity: getAutomationValueAtTick(points, note.time + note.duration / 2, note.velocity),
  }))
}
