/**
 * Conductor timeline maths shared by live playback, the grid lane, and every
 * export path. Tempo points are expressed in project ticks (192 per quarter)
 * and meter points always start a new bar.
 */

export const CONDUCTOR_PPQ = 192
export const MIN_CONDUCTOR_BPM = 20
export const MAX_CONDUCTOR_BPM = 300
/** Beats per bar and beat unit accept any whole number in this range, not just powers of two. */
export const MIN_METER_VALUE = 1
export const MAX_METER_BEATS = 64
export const MAX_METER_DENOMINATOR = 64

/** Standard MIDI files store the beat unit as log2, so only powers of two survive a round trip. */
const SMF_DENOMINATORS = [1, 2, 4, 8, 16, 32] as const

export type TempoCurve = 'step' | 'linear' | 'exponential' | 'formula'

export interface TempoPoint {
  id: string
  tick: number
  bpm: number
  curve: TempoCurve
  formula?: string
}

export interface MeterPoint {
  id: string
  tick: number
  numerator: number
  denominator: number
}

export const clampConductorBpm = (value: number): number => {
  if (!Number.isFinite(value)) return 120
  return Math.max(MIN_CONDUCTOR_BPM, Math.min(MAX_CONDUCTOR_BPM, value))
}

export const normalizeTempoMap = (points: TempoPoint[] | undefined | null): TempoPoint[] => {
  if (!Array.isArray(points)) return []
  return points
    .filter(point => point && Number.isFinite(point.tick) && Number.isFinite(point.bpm))
    .map(point => ({
      ...point,
      tick: Math.max(0, Math.round(point.tick)),
      bpm: clampConductorBpm(point.bpm),
    }))
    .sort((a, b) => a.tick - b.tick)
}

const clampMeterValue = (value: unknown, max: number, fallback: number): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.max(MIN_METER_VALUE, Math.min(max, Math.round(numeric)))
}

export const normalizeMeterMap = (points: MeterPoint[] | undefined | null): MeterPoint[] => {
  if (!Array.isArray(points)) return []
  return points
    .filter(point => point && Number.isFinite(point.tick))
    .map(point => ({
      ...point,
      tick: Math.max(0, Math.round(point.tick)),
      numerator: clampMeterValue(point.numerator, MAX_METER_BEATS, 4),
      denominator: clampMeterValue(point.denominator, MAX_METER_DENOMINATOR, 4),
    }))
    .sort((a, b) => a.tick - b.tick)
}

export const parseMeterSignature = (signature: string): { numerator: number; denominator: number } => {
  const match = String(signature || '4/4').match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/)
  return {
    numerator: clampMeterValue(match?.[1], MAX_METER_BEATS, 4),
    denominator: clampMeterValue(match?.[2], MAX_METER_DENOMINATOR, 4),
  }
}

const evaluateTempoFormula = (
  point: TempoPoint,
  next: TempoPoint,
  t: number,
  tick: number
): number => {
  const linear = point.bpm + (next.bpm - point.bpm) * t
  const beats = tick / CONDUCTOR_PPQ
  const bars = beats / 4
  try {
    const fn = new Function('t', 'b', 'm', 'ticks', 'v', `return (${point.formula || 'v'});`) as
      (t: number, b: number, m: number, ticks: number, v: number) => number
    return clampConductorBpm(Number(fn(t, beats, bars, tick, linear)))
  } catch {
    return clampConductorBpm(linear)
  }
}

const segmentBpm = (
  point: TempoPoint,
  next: TempoPoint,
  t: number,
  tick: number
): number => {
  switch (point.curve) {
    case 'step':
      return point.bpm
    case 'exponential': {
      if (point.bpm <= 0 || next.bpm <= 0) return point.bpm
      return point.bpm * Math.pow(next.bpm / point.bpm, t)
    }
    case 'formula':
      return evaluateTempoFormula(point, next, t, tick)
    case 'linear':
    default:
      return point.bpm + (next.bpm - point.bpm) * t
  }
}

/** The BPM the conductor holds at a project tick. */
export const getTempoAtTick = (
  map: TempoPoint[] | undefined,
  _baseBpm: number,
  tick: number
): number => {
  if (!map || map.length === 0) return clampConductorBpm(_baseBpm)
  if (tick <= map[0].tick) return clampConductorBpm(map[0].bpm)

  for (let index = 0; index < map.length; index += 1) {
    const point = map[index]
    const next = map[index + 1]
    if (!next) return clampConductorBpm(point.bpm)
    if (tick < next.tick) {
      const span = next.tick - point.tick
      const t = span > 0 ? (tick - point.tick) / span : 1
      return clampConductorBpm(segmentBpm(point, next, t, tick))
    }
  }
  return clampConductorBpm(map[map.length - 1].bpm)
}

/** True when the map actually changes tempo, rather than merely restating the base. */
export const tempoMapIsActive = (
  map: TempoPoint[] | undefined,
  baseBpm: number
): boolean => {
  if (!map || map.length === 0) return false
  return map.some(point => point.tick > 0 || Math.abs(point.bpm - baseBpm) > 0.001)
}

/**
 * Seconds per tick for a segment. Linear and exponential curves interpolate BPM
 * over time, so the tick duration is the integral of 60 / (bpm * PPQ).
 */
const segmentSeconds = (
  point: TempoPoint,
  next: TempoPoint | null,
  tickSpan: number
): number => {
  if (tickSpan <= 0) return 0
  const bpm = point.bpm

  if (!next || point.curve === 'step') {
    return (tickSpan * 60) / (CONDUCTOR_PPQ * bpm)
  }

  if (point.curve === 'linear') {
    const average = (point.bpm + next.bpm) / 2
    return (tickSpan * 60) / (CONDUCTOR_PPQ * Math.max(MIN_CONDUCTOR_BPM, average))
  }

  if (point.curve === 'exponential') {
    if (Math.abs(next.bpm - point.bpm) < 0.0001) {
      return (tickSpan * 60) / (CONDUCTOR_PPQ * bpm)
    }
    return (tickSpan * 60 * Math.log(next.bpm / point.bpm)) /
      (CONDUCTOR_PPQ * (next.bpm - point.bpm))
  }

  // Formula curves have no closed form: integrate seconds-per-tick numerically.
  const steps = 128
  let inverseBpmSum = 0
  for (let index = 0; index < steps; index += 1) {
    const t = (index + 0.5) / steps
    const segmentTick = point.tick + tickSpan * t
    inverseBpmSum += 1 / segmentBpm(point, next, t, segmentTick)
  }
  return (tickSpan * 60 / CONDUCTOR_PPQ) * (inverseBpmSum / steps)
}

/** Seconds from tick zero to `tick` under the tempo map. */
export const conductorSecondsAtTick = (
  map: TempoPoint[] | undefined,
  baseBpm: number,
  tick: number
): number => {
  const target = Math.max(0, tick)
  if (!map || map.length === 0) {
    return (target * 60) / (CONDUCTOR_PPQ * clampConductorBpm(baseBpm))
  }

  let seconds = 0
  let cursor = 0

  for (let index = 0; index < map.length; index += 1) {
    const point = map[index]
    const next = map[index + 1]

    if (point.tick > cursor) {
      const span = Math.min(point.tick, target) - cursor
      if (span > 0) {
        seconds += (span * 60) / (CONDUCTOR_PPQ * clampConductorBpm(baseBpm))
      }
      cursor = point.tick
    }
    if (cursor >= target) return seconds

    const segmentEnd = next ? next.tick : Number.POSITIVE_INFINITY
    const span = Math.min(segmentEnd, target) - cursor
    if (span > 0) {
      seconds += segmentSeconds(point, next, span)
      cursor += span
    }
    if (cursor >= target) return seconds
  }

  if (cursor < target) {
    const last = map[map.length - 1]
    seconds += ((target - cursor) * 60) / (CONDUCTOR_PPQ * clampConductorBpm(last.bpm))
  }
  return seconds
}

/** Seconds a tick span lasts under the tempo map. */
export const conductorDurationSeconds = (
  map: TempoPoint[] | undefined,
  baseBpm: number,
  startTick: number,
  endTick: number
): number => {
  if (endTick <= startTick) return 0
  return conductorSecondsAtTick(map, baseBpm, endTick) -
    conductorSecondsAtTick(map, baseBpm, startTick)
}

const meterBeatTicks = (meter: MeterPoint): number =>
  (CONDUCTOR_PPQ * 4) / Math.max(1, meter.denominator)

const meterBarTicks = (meter: MeterPoint): number =>
  meterBeatTicks(meter) * Math.max(1, meter.numerator)

/** Ticks per beat for a beat unit. Fractional when the denominator is not a power of two. */
export const meterTicksPerBeat = (denominator: number): number =>
  (CONDUCTOR_PPQ * 4) / Math.max(1, Math.round(denominator) || 1)

/**
 * Closest standard-MIDI signature to `numerator/denominator`. SMF cannot encode an
 * 11th-note beat, so keep the bar length as close as possible and let the caller warn.
 */
export const toSmfTimeSignature = (
  numerator: number,
  denominator: number
): { numerator: number; denominator: number } => {
  const barQuarters = (numerator * 4) / Math.max(1, denominator)
  if ((SMF_DENOMINATORS as readonly number[]).includes(denominator)) {
    return { numerator, denominator }
  }
  let best = { numerator, denominator: 4, error: Number.POSITIVE_INFINITY }
  for (const candidate of SMF_DENOMINATORS) {
    const beats = Math.max(1, Math.min(255, Math.round((barQuarters * candidate) / 4)))
    const error = Math.abs((beats * 4) / candidate - barQuarters)
    if (error < best.error - 1e-9) {
      best = { numerator: beats, denominator: candidate, error }
    }
  }
  return { numerator: best.numerator, denominator: best.denominator }
}

const effectiveMeterMap = (
  map: MeterPoint[] | undefined,
  defaultSignature: string
): MeterPoint[] => {
  if (map && map.length > 0) return map
  const parsed = parseMeterSignature(defaultSignature)
  return [{ id: 'meter-default', tick: 0, ...parsed }]
}

export interface MeterPosition {
  meter: MeterPoint
  meterIndex: number
  barIndex: number
  barStartTick: number
  beatIndex: number
  beatStartTick: number
  beatTicks: number
  barTicks: number
}

/** Bar/beat position at a tick, including meter changes. */
export const getMeterPositionAtTick = (
  map: MeterPoint[] | undefined,
  defaultSignature: string,
  tick: number
): MeterPosition => {
  const meters = effectiveMeterMap(map, defaultSignature)
  const target = Math.max(0, tick)

  let meterIndex = 0
  for (let index = 0; index < meters.length; index += 1) {
    if (meters[index].tick <= target) meterIndex = index
    else break
  }

  let barsBefore = 0
  for (let index = 0; index < meterIndex; index += 1) {
    const current = meters[index]
    const nextTick = meters[index + 1].tick
    const barTicks = meterBarTicks(current)
    barsBefore += Math.max(0, Math.floor((nextTick - current.tick) / barTicks))
  }

  const meter = meters[meterIndex]
  const barTicks = meterBarTicks(meter)
  const beatTicks = meterBeatTicks(meter)
  const barsIntoMeter = Math.max(0, Math.floor((target - meter.tick) / barTicks))
  const barStartExact = meter.tick + barsIntoMeter * barTicks
  const beatIndex = Math.max(0, Math.min(
    meter.numerator - 1,
    Math.floor((target - barStartExact) / beatTicks)
  ))
  // Beat lengths are fractional for odd denominators; notes and loops live on whole
  // ticks, so snap the reported boundaries and keep the raw lengths for callers.
  const barStartTick = Math.round(barStartExact)

  return {
    meter,
    meterIndex,
    barIndex: barsBefore + barsIntoMeter,
    barStartTick,
    beatIndex,
    beatStartTick: Math.round(barStartExact + beatIndex * beatTicks),
    beatTicks,
    barTicks,
  }
}

export const isBarStartTick = (
  map: MeterPoint[] | undefined,
  defaultSignature: string,
  tick: number
): boolean => {
  const position = getMeterPositionAtTick(map, defaultSignature, tick)
  return Math.abs(tick - position.barStartTick) < 0.5
}

export const meterMapIsActive = (
  map: MeterPoint[] | undefined,
  defaultSignature: string
): boolean => {
  if (!map || map.length === 0) return false
  if (map.length > 1) return true
  const parsed = parseMeterSignature(defaultSignature)
  return map[0].tick > 0 ||
    map[0].numerator !== parsed.numerator ||
    map[0].denominator !== parsed.denominator
}

export interface ConductorBeat {
  tick: number
  isDownbeat: boolean
  barIndex: number
  beatIndex: number
}

/** Beat grid for the metronome and native bounce, honouring meter changes. */
export const buildConductorBeats = (
  map: MeterPoint[] | undefined,
  defaultSignature: string,
  startTick: number,
  endTick: number
): ConductorBeat[] => {
  const beats: ConductorBeat[] = []
  if (endTick <= startTick) return beats

  const meters = effectiveMeterMap(map, defaultSignature)
  const startPosition = getMeterPositionAtTick(map, defaultSignature, startTick)

  let barIndex = startPosition.barIndex
  let meterIndex = startPosition.meterIndex
  let cursor = startPosition.barStartTick
  let guard = 0

  while (cursor < endTick && guard < 100000) {
    guard += 1
    const meter = meters[meterIndex]
    const currentBeatTicks = meterBeatTicks(meter)
    const currentBarTicks = meterBarTicks(meter)
    const nextMeter = meters[meterIndex + 1]

    if (nextMeter && cursor >= nextMeter.tick) {
      meterIndex += 1
      barIndex += Math.max(0, Math.floor((nextMeter.tick - meter.tick) / currentBarTicks))
      cursor = nextMeter.tick
      continue
    }

    const barEnd = cursor + currentBarTicks
    const beatCount = meter.numerator
    for (let beat = 0; beat < beatCount; beat += 1) {
      const tick = Math.round(cursor + beat * currentBeatTicks)
      if (tick >= endTick) break
      if (tick >= startTick) {
        beats.push({ tick, isDownbeat: beat === 0, barIndex, beatIndex: beat })
      }
    }
    cursor = barEnd
    barIndex += 1

    // A meter change inside this bar ends it early.
    if (nextMeter && nextMeter.tick < cursor) {
      meterIndex += 1
      cursor = nextMeter.tick
    }
  }

  return beats
}

/** Bar number (1-based) that contains a tick. */
export const getBarNumberAtTick = (
  map: MeterPoint[] | undefined,
  defaultSignature: string,
  tick: number
): number => getMeterPositionAtTick(map, defaultSignature, tick).barIndex + 1

/** The tick where the bar containing `tick` begins. */
export const getBarStartTick = (
  map: MeterPoint[] | undefined,
  defaultSignature: string,
  tick: number
): number => getMeterPositionAtTick(map, defaultSignature, tick).barStartTick

/** The next bar boundary at or after `tick`. */
export const getNextBarTick = (
  map: MeterPoint[] | undefined,
  defaultSignature: string,
  tick: number
): number => {
  const position = getMeterPositionAtTick(map, defaultSignature, tick)
  return Math.abs(tick - position.barStartTick) < 0.5
    ? position.barStartTick
    : Math.round(position.barStartTick + position.barTicks)
}
