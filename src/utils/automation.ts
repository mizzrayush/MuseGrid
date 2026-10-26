import type {
  AutomationLane,
  AutomationPoint,
  AutomationTarget,
  ExpressionLaneTarget,
  Note,
} from '../engine/store'
import { parseAutomationTarget, expressionLaneLabel } from '../engine/store'

const MIN_VELOCITY = 1
const MAX_VELOCITY = 127

/** Transport resolution the whole app shares: 192 ticks per beat. */
export const LANE_TICKS_PER_BEAT = 192
/** Lane space is 0..127 but no longer forced to integers; formula lanes need the fractions. */
const LANE_MIN = 0
const LANE_MAX = 127

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

/** Lane values are clamped to 1..127, so anchor pan at lane 64 to still reach both hard stops. */
export function laneValueToPan(value: number): number {
  return Math.max(-1, Math.min(1, (clampVelocity(value) - 64) / 63))
}

/**
 * What a lane holds where the track has no points. Sampling falls back to the note's own
 * velocity, which is right for a velocity lane but would double-apply velocity as gain or
 * pan notes by how hard they were hit on the other lanes.
 */
export function laneNeutralValue(target: AutomationTarget, noteVelocity: number): number {
  if (target === 'volume') return MAX_VELOCITY
  if (target === 'pan') return 64
  return noteVelocity
}

/**
 * Parameter range a lane value of 0..127 maps onto. `curve: 'exp'` is only used by filter cutoff,
 * where a linear lane would spend most of its travel inaudible below 200 Hz.
 */
export const EXPRESSION_LANE_RANGES: Record<ExpressionLaneTarget, { min: number; max: number; curve?: 'exp' }> = {
  filterCutoff: { min: 20, max: 20000, curve: 'exp' },
  vibratoDepth: { min: 0, max: 300 },
  vibratoRate: { min: 0, max: 20 },
  tremoloDepth: { min: 0, max: 1 },
  tremoloRate: { min: 0, max: 20 },
  detune: { min: -1200, max: 1200 },
  glideAmount: { min: -24, max: 24 },
}

/** Which per-note field each expression lane writes, and the unit it stores. */
const EXPRESSION_LANE_FIELDS: Record<ExpressionLaneTarget, keyof Note> = {
  filterCutoff: 'filterStart',
  vibratoDepth: 'vibratoDepth',
  vibratoRate: 'vibratoRate',
  tremoloDepth: 'tremoloDepth',
  tremoloRate: 'tremoloRate',
  detune: 'detune',
  glideAmount: 'pitchSlide',
}

export function clampLaneValue(value: number, fallback = LANE_MIN): number {
  return Number.isFinite(value) ? Math.max(LANE_MIN, Math.min(LANE_MAX, value)) : fallback
}

/** A lane value in 0..127 expressed as the parameter's own unit. */
export function laneValueToExprParam(target: ExpressionLaneTarget, laneValue: number): number {
  const range = EXPRESSION_LANE_RANGES[target]
  const norm = clampLaneValue(laneValue) / LANE_MAX
  if (range.curve === 'exp') return range.min * Math.pow(range.max / range.min, norm)
  return range.min + norm * (range.max - range.min)
}

/** The inverse of laneValueToExprParam, used as the add/multiply base and for the drawn baseline. */
export function exprParamToLaneValue(target: ExpressionLaneTarget, paramValue: number): number {
  const range = EXPRESSION_LANE_RANGES[target]
  if (range.curve === 'exp') {
    const clamped = Math.max(range.min, Math.min(range.max, paramValue))
    return LANE_MAX * (Math.log(clamped / range.min) / Math.log(range.max / range.min))
  }
  return LANE_MAX * (paramValue - range.min) / (range.max - range.min)
}

type LaneEquation = (t: number, b: number, m: number, ticks: number, v: number) => number
const laneEquationCache = new Map<string, LaneEquation | null>()

/**
 * Compiled with the same variables as an FX modulator, plus `v` (the lane's base value at that
 * tick) so an equation can shape what was drawn instead of only replacing it.
 */
export function compileLaneEquation(equation: string): LaneEquation | null {
  const key = (equation || '').trim()
  if (!key) return null
  if (laneEquationCache.has(key)) return laneEquationCache.get(key) ?? null

  let fn: LaneEquation | null = null
  try {
    fn = new Function('t', 'b', 'm', 'ticks', 'v', `return ${key}`) as LaneEquation
  } catch {
    fn = null
  }
  laneEquationCache.set(key, fn)
  return fn
}

export function laneEquationIsValid(equation: string): boolean {
  const fn = compileLaneEquation(equation)
  if (!fn) return false
  try {
    return Number.isFinite(fn(0.1, 0.1, 0.025, 19, 64))
  } catch {
    return false
  }
}

export interface LaneSampleOptions {
  points?: AutomationPoint[]
  lane?: AutomationLane
  target?: AutomationTarget
  tick: number
  /** What the lane holds where nothing drives it: the note's own value for that target. */
  fallback: number
  bpm: number
}

/**
 * Continuous lane sampler shared by live playback and offline render. A drawn lane keeps the
 * historical spline behaviour exactly; a formula lane adds equation-shaped values on top.
 */
export function getLaneValueAtTick(options: LaneSampleOptions): number {
  const { points, lane, tick, fallback, bpm } = options
  const drawn = getAutomationValueAtTick(points, tick, fallback)
  if (!lane || lane.source !== 'formula') return drawn

  // The drawn spline snaps to whole lane steps, which is right for points but would quantize an
  // equation's base where nothing is drawn, so an equation reads the note's value exactly instead.
  const base = points && points.length > 0 ? drawn : clampLaneValue(fallback, LANE_MIN)

  const fn = compileLaneEquation(lane.equation)
  if (!fn) return drawn

  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120
  const ticksPerSecond = (safeBpm / 60) * LANE_TICKS_PER_BEAT
  const seconds = tick / ticksPerSecond
  const beats = tick / LANE_TICKS_PER_BEAT

  let raw: number
  try {
    raw = fn(seconds, beats, beats / 4, tick, base)
  } catch {
    return drawn
  }
  if (!Number.isFinite(raw)) return drawn

  let value: number
  if (lane.mode === 'add') value = base + raw
  else if (lane.mode === 'multiply') value = base * raw
  else value = raw

  return clampLaneValue(value, base)
}

/** Where a note's own value for this target sits in lane space; that is the lane's neutral point. */
export function exprLaneNeutralValue(target: ExpressionLaneTarget, note: Note): number {
  const field = EXPRESSION_LANE_FIELDS[target]
  const own = note[field as keyof Note]
  if (typeof own === 'number' && Number.isFinite(own)) return clampLaneValue(exprParamToLaneValue(target, own), 0)
  if (target === 'filterCutoff') return exprParamToLaneValue('filterCutoff', 20000)
  return 0
}

/** The value a lane holds where nothing drives it, for any target. */
export function laneFallbackValue(target: AutomationTarget | undefined, note: Note): number {
  const parsed = parseAutomationTarget(target)
  if (parsed?.kind === 'expr') return exprLaneNeutralValue(parsed.id, note)
  return laneNeutralValue(target ?? 'velocity', note.velocity)
}

/**
 * A lane only reshapes a note when it actually holds something. An expression lane with no drawn
 * points and no equation would otherwise map the note's own value through lane space and back,
 * which costs a little precision for no reason.
 */
export function laneIsActive(points: AutomationPoint[] | undefined, lane: AutomationLane | undefined): boolean {
  return lane?.source === 'formula' || (points?.length ?? 0) > 0
}

/**
 * The one call a scheduler makes for an expression lane: sample the lane at the note and return
 * the note with that parameter replaced. Non-expression targets get the same note object back.
 */
export function noteWithExpressionLane(
  note: Note,
  target: AutomationTarget | undefined,
  lane: AutomationLane | undefined,
  points: AutomationPoint[] | undefined,
  bpm: number,
): Note {
  const parsed = parseAutomationTarget(target)
  if (!parsed || parsed.kind !== 'expr') return note

  const value = getLaneValueAtTick({
    points,
    lane,
    target,
    tick: note.time + note.duration / 2,
    fallback: exprLaneNeutralValue(parsed.id, note),
    bpm,
  })
  return applyExpressionLaneToNote(note, target, value, { lane, points, bpm })
}

/** Normalised 0..1 shape of a lane across one note, matching the native 33-point curve slots. */
export const LANE_CURVE_POINTS = 33

export function buildLaneCurve(
  note: Note,
  target: AutomationTarget,
  lane: AutomationLane | undefined,
  points: AutomationPoint[] | undefined,
  bpm: number,
): number[] {
  const parsed = parseAutomationTarget(target)
  const kind = parsed?.kind === 'expr' ? parsed.id : null
  const fallback = kind ? exprLaneNeutralValue(kind, note) : 64
  const raw: number[] = []
  for (let i = 0; i < LANE_CURVE_POINTS; i++) {
    const tick = note.time + (note.duration * i) / (LANE_CURVE_POINTS - 1)
    raw.push(getLaneValueAtTick({ points, lane, target, tick, fallback, bpm }))
  }
  let min = Infinity
  let max = -Infinity
  for (const v of raw) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min
  // A flat lane must stay flat: dividing by zero would smear noise across the whole range.
  return raw.map(v => (span > 0.0001 ? (v - min) / span : 0.5))
}

/** Lane value at the start and end of one note, in the parameter's own unit. */
export function laneNoteExtent(
  note: Note,
  target: AutomationTarget,
  lane: AutomationLane | undefined,
  points: AutomationPoint[] | undefined,
  bpm: number,
): { start: number; end: number; curve: number[] } | null {
  const parsed = parseAutomationTarget(target)
  if (parsed?.kind !== 'expr') return null
  const range = EXPRESSION_LANE_RANGES[parsed.id]
  const fallback = exprLaneNeutralValue(parsed.id, note)
  const sample = (tick: number) => laneValueToExprParam(parsed.id, getLaneValueAtTick({
    points, lane, target, tick, fallback, bpm,
  }))
  return {
    start: sample(note.time),
    end: sample(note.time + note.duration),
    curve: buildLaneCurve(note, target, lane, points, bpm),
  }
}

/**
 * Returns the note with the expression lane applied, or the same note when the target is not an
 * expression lane. Callers keep passing one Note around, so cloning here is the only way to apply
 * a lane without mutating project state.
 */
export interface ExpressionLaneShapeContext {
  lane?: AutomationLane
  points?: AutomationPoint[]
  bpm: number
}

export function applyExpressionLaneToNote(
  note: Note,
  target: AutomationTarget | undefined,
  laneValue: number,
  shape?: ExpressionLaneShapeContext,
): Note {
  const parsed = parseAutomationTarget(target)
  if (!parsed || parsed.kind !== 'expr') return note

  const paramValue = laneValueToExprParam(parsed.id, laneValue)
  const field = EXPRESSION_LANE_FIELDS[parsed.id]

  const updated = { ...note } as Record<string, any>
  updated[field] = paramValue
  // A cutoff lane must be flat across the note, so the sweep end has to follow the lane too.
  if (parsed.id === 'filterCutoff') updated.filterEnd = paramValue

  // Filter cutoff is the one lane the native voice can follow continuously: it already sweeps
  // per-sample between filterStart and filterEnd along filterCurve, so the lane's own in-note
  // extent goes straight into those slots instead of one value per note.
  if (parsed.id === 'filterCutoff' && shape) {
    const extent = laneNoteExtent(note, target as AutomationTarget, shape.lane, shape.points, shape.bpm)
    if (extent) {
      updated.filterStart = extent.start
      updated.filterEnd = extent.end
      updated.filterSweepTime = 0
      updated.filterSweepRamp = 'linear'
      updated.laneFilterCurve = extent.curve
    }
  }
  return updated as Note
}

/** The lane target's readable name, used by the grid sidebar and the lane header. */
export function laneTargetLabel(target: AutomationTarget | undefined): string {
  const parsed = parseAutomationTarget(target)
  if (!parsed) return 'Velocity'
  if (parsed.kind === 'builtin') return parsed.id === 'velocity' ? 'Velocity' : parsed.id === 'volume' ? 'Volume' : 'Pan'
  if (parsed.kind === 'expr') return expressionLaneLabel[parsed.id]
  return `VST3 #${parsed.index + 1}`
}
