/**
 * Deterministic generative composition engines.
 *
 * Every generator is a pure function of its input settings and the seed, so the same
 * seed always yields the same phrase and "Generate" can be previewed before it is
 * committed to the project. Bar windows come from the conductor helpers, which keeps
 * odd meters (7/8, 5/4, 11/16) working without any hard-coded 4/4 math.
 */
import { SCALE_INTERVALS, GENRE_PROGRESSIONS, getDiatonicChord, snapToScale, getScaleIntervals } from './musicTheory'
import { getMeterPositionAtTick, getNextBarTick } from './conductor'
import type { MeterPoint } from './conductor'

export const GENERATIVE_PPQ = 192

export type GenerativeEngineId = 'motif' | 'pulse' | 'choir' | 'arrange' | 'respond'

export interface GenerativeSettings {
  engine: GenerativeEngineId
  seed: number
  bars: number
  density: number        // 0..1 note count
  complexity: number     // 0..1 ornaments and syncopation
  motion: number         // 0..1 bar-to-bar variation
  tension: number        // 0..1 chromatic edge and voicing weight
  register: number       // octave offset -2..2
  velocity: number       // 0..1 base velocity
  humanize: number       // 0..1 timing / velocity jitter
  swing: number          // 0..1 off-beat delay
  echo: number           // 0..1 afterimage amount
  scaleSnap: boolean
  scaleRoot: number
  scaleMode: string
  /** Start times land on the project grid. */
  snapTime: boolean
  /** Durations round to whole grid steps. */
  snapDuration: boolean
}

export const DEFAULT_GENERATIVE_SETTINGS: GenerativeSettings = {
  engine: 'motif',
  seed: 1337,
  bars: 4,
  density: 0.6,
  complexity: 0.45,
  motion: 0.5,
  tension: 0.3,
  register: 0,
  velocity: 0.8,
  humanize: 0.25,
  swing: 0,
  echo: 0.25,
  scaleSnap: true,
  scaleRoot: 0,
  scaleMode: 'Major',
  snapTime: true,
  snapDuration: true,
}

export interface SourceNote {
  pitch: number
  time: number
  duration: number
  velocity: number
}

export interface SourceSnapshot {
  notes: SourceNote[]
  isDrum: boolean
  /** Pitch the phrase centres on. Falls back to middle C. */
  anchorPitch: number
}

export interface GeneratedNote {
  time: number
  duration: number
  pitch: number
  velocity: number
}

export interface GeneratedPart {
  /** Suggested track name suffix, e.g. "Motif", "Pulse", "Choir". */
  label: string
  isDrum: boolean
  notes: GeneratedNote[]
}

export interface GenerateInput {
  settings: GenerativeSettings
  source: SourceSnapshot
  startTick: number
  meterMap: MeterPoint[]
  timeSignature: string
  /** Grid step in ticks used by the snap toggles. */
  snapTicks?: number
}

export interface BarWindow {
  index: number
  start: number
  end: number
  beatTicks: number
  beats: number
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export function hashSeed(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rng: () => number, list: T[]): T => list[Math.floor(rng() * list.length) % list.length]

// ---------------------------------------------------------------------------
// Meter-aware bar windows
// ---------------------------------------------------------------------------

export function buildBarWindows(
  meterMap: MeterPoint[],
  timeSignature: string,
  startTick: number,
  bars: number
): BarWindow[] {
  const windows: BarWindow[] = []
  let cursor = Math.max(0, Math.round(startTick))
  const total = Math.max(1, Math.min(64, Math.round(bars)))

  for (let index = 0; index < total; index += 1) {
    const position = getMeterPositionAtTick(meterMap, timeSignature, cursor)
    const end = getNextBarTick(meterMap, timeSignature, cursor + 0.5)
    const span = Math.max(1, end - cursor)
    const beats = Math.max(1, position.meter.numerator)
    windows.push({
      index,
      start: cursor,
      end,
      beatTicks: span / beats,
      beats,
    })
    cursor = Math.max(end, cursor + 1)
  }
  return windows
}

// ---------------------------------------------------------------------------
// Scale helpers
// ---------------------------------------------------------------------------

function scaleIntervals(mode: string): number[] {
  return getScaleIntervals(mode) ?? SCALE_INTERVALS['Major']
}

function scalePitchAt(degreeIndex: number, root: number, mode: string): number {
  const intervals = scaleIntervals(mode)
  const n = intervals.length
  const octave = Math.floor(degreeIndex / n)
  const idx = ((degreeIndex % n) + n) % n
  return root + octave * 12 + intervals[idx]
}

function nearestDegree(pitch: number, root: number, mode: string): number {
  const intervals = scaleIntervals(mode)
  const n = intervals.length
  const relative = pitch - root
  const octave = Math.floor(relative / 12)
  const pc = ((relative % 12) + 12) % 12
  let best = 0
  let bestDistance = Infinity
  intervals.forEach((interval, index) => {
    const distance = Math.abs(interval - pc)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return octave * n + best
}

function finalizePitch(
  pitch: number,
  settings: GenerativeSettings,
  drum: boolean
): number {
  if (drum) return Math.max(0, Math.min(15, Math.round(pitch)))
  if (!settings.scaleSnap) return Math.max(0, Math.min(127, Math.round(pitch)))
  return Math.max(0, Math.min(127, snapToScale(Math.round(pitch), settings.scaleRoot, settings.scaleMode)))
}

function humanizeTime(
  rng: () => number,
  time: number,
  settings: GenerativeSettings,
  beatTicks: number
): number {
  const amount = settings.humanize * Math.min(18, beatTicks * 0.12)
  return Math.max(0, Math.round(time + (rng() * 2 - 1) * amount))
}

function humanizeVelocity(
  rng: () => number,
  velocity: number,
  settings: GenerativeSettings,
  accent: boolean
): number {
  const base = settings.velocity + (accent ? 0.12 : 0)
  const jitter = (rng() * 2 - 1) * settings.humanize * 0.18
  return Math.max(0.05, Math.min(1, base + jitter))
}

// ---------------------------------------------------------------------------
// Motif cell
// ---------------------------------------------------------------------------

interface CellNote {
  /** Onset in beats from the phrase start. */
  beat: number
  /** Length in beats. */
  length: number
  /** Scale-degree offset from the phrase anchor. */
  degree: number
}

function sourceDegreeCell(
  source: SourceNote[],
  window: BarWindow,
  root: number,
  mode: string
): CellNote[] {
  const inWindow = source
    .filter(n => n.time >= window.start && n.time < window.end)
    .sort((a, b) => a.time - b.time)
    .slice(0, 8)
  if (inWindow.length === 0) return []

  const anchor = inWindow[0].pitch
  return inWindow.map(n => ({
    beat: (n.time - window.start) / Math.max(1, window.beatTicks),
    length: Math.max(0.125, n.duration / Math.max(1, window.beatTicks)),
    degree: nearestDegree(n.pitch, root, mode) - nearestDegree(anchor, root, mode),
  }))
}

function scaleWalkCell(
  rng: () => number,
  window: BarWindow,
  settings: GenerativeSettings
): CellNote[] {
  const intervals = scaleIntervals(settings.scaleMode)
  const noteCount = Math.max(2, Math.round(3 + settings.density * 9))
  const cell: CellNote[] = []
  let degree = 0
  let beat = 0
  const step = Math.max(0.25, window.beats / noteCount)

  for (let i = 0; i < noteCount && beat < window.beats; i += 1) {
    const leapBias = rng()
    let move = 0
    if (leapBias < 0.5) move = rng() < 0.5 ? 1 : -1
    else if (leapBias < 0.85) move = rng() < 0.5 ? 2 : -2
    else move = rng() < 0.5 ? 1 : -1
    if (settings.tension > 0.6 && rng() < 0.2) move += rng() < 0.5 ? 1 : -1
    degree += move
    cell.push({
      beat,
      length: step * (0.6 + rng() * 0.8),
      degree,
    })
    beat += step * (0.75 + rng() * 0.75)
  }

  // Keep the line centred: fold stray degrees back into a two-octave window.
  const max = intervals.length * 2 - 1
  return cell.map(n => ({ ...n, degree: ((n.degree % max) + max) % max }))
}

function transformCell(
  rng: () => number,
  cell: CellNote[],
  variant: number
): CellNote[] {
  if (cell.length === 0) return []
  switch (variant % 6) {
    case 1: // diatonic inversion
      return cell.map(n => ({ ...n, degree: -n.degree }))
    case 2: // retrograde
      return [...cell].reverse().map(n => ({ ...n }))
    case 3: // transpose
      return cell.map(n => ({ ...n, degree: n.degree + (rng() < 0.5 ? 2 : -2) }))
    case 4: // rhythmic displacement
      return cell.map(n => ({ ...n, beat: n.beat * 0.5 }))
    case 5: // octave displacement
      return cell.map((n, i) => ({ ...n, degree: n.degree + (i % 2 === 0 ? 7 : -7) }))
    default:
      return cell.map(n => ({ ...n }))
  }
}

function cellToNotes(
  rng: () => number,
  cell: CellNote[],
  window: BarWindow,
  settings: GenerativeSettings,
  rootPitch: number,
  drum: boolean,
  drumPads: number[]
): GeneratedNote[] {
  if (cell.length === 0) return []
  const notes: GeneratedNote[] = []
  const swingOffset = (n: CellNote) => {
    const isOffBeat = Math.abs((n.beat % 1) - 0.5) < 0.26
    return isOffBeat ? settings.swing * 0.18 : 0
  }

  cell.forEach(n => {
    if (rng() > 0.25 + settings.density * 0.9) return
    const start = window.start + (n.beat + swingOffset(n)) * window.beatTicks
    if (start >= window.end) return
    const duration = Math.max(12, Math.min(window.end - start, n.length * window.beatTicks))
    const accent = n.beat < 0.001
    const pitch = drum
      ? pick(rng, drumPads)
      : rootPitch + (settings.register * 12) + degreeToSemitones(n.degree, settings.scaleMode)

    notes.push({
      time: humanizeTime(rng, start, settings, window.beatTicks),
      duration: Math.round(duration),
      pitch: finalizePitch(pitch, settings, drum),
      velocity: humanizeVelocity(rng, 0, settings, accent),
    })
  })

  return notes
}

function degreeToSemitones(degree: number, mode: string): number {
  const intervals = scaleIntervals(mode)
  const n = intervals.length
  const octave = Math.floor(degree / n)
  const idx = ((degree % n) + n) % n
  return octave * 12 + intervals[idx]
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

function generateMotif(input: GenerateInput, rng: () => number): GeneratedPart[] {
  const { settings, source, meterMap, timeSignature } = input
  const windows = buildBarWindows(meterMap, timeSignature, input.startTick, settings.bars)
  const drum = source.isDrum
  const rootPitch = drum ? 0 : Math.max(24, Math.min(96, source.anchorPitch))
  const drumPads = source.isDrum && source.notes.length > 0
    ? Array.from(new Set(source.notes.map(n => Math.max(0, Math.min(15, Math.round(n.pitch))))))
    : [0, 1, 2, 2, 1, 0, 1, 2]

  let cell = sourceDegreeCell(source.notes, windows[0], settings.scaleRoot, settings.scaleMode)
  if (cell.length < 2) cell = scaleWalkCell(rng, windows[0], settings)
  const fixedVariant = Math.floor(rng() * 6)
  const notes: GeneratedNote[] = []

  windows.forEach(window => {
    const variant = settings.motion > 0.55 && rng() < settings.motion
      ? Math.floor(rng() * 6)
      : fixedVariant
    const phrase = cellToNotes(rng, transformCell(rng, cell, variant), window, settings, rootPitch, drum, drumPads)
    notes.push(...phrase)

    if (!drum && settings.echo > 0.05) {
      const echoEvery = settings.echo > 0.65 ? 2 : 1
      if (window.index % echoEvery === 0) {
        phrase.slice(0, Math.max(1, Math.round(phrase.length * 0.6))).forEach(n => {
          const delay = Math.round(window.beatTicks * (settings.echo > 0.8 ? 0.5 : 0.25))
          if (n.time + delay < window.end) {
            notes.push({
              ...n,
              time: n.time + delay,
              velocity: Math.max(0.05, n.velocity * (0.35 + settings.echo * 0.25)),
            })
          }
        })
      }
    }
  })

  return [{ label: 'Motif', isDrum: drum, notes }]
}

function euclid(steps: number, pulses: number): number[] {
  const total = Math.max(1, Math.round(steps))
  const count = Math.max(0, Math.min(total, Math.round(pulses)))
  const pattern = new Array<number>(total).fill(0)
  for (let i = 0; i < count; i += 1) {
    pattern[Math.floor((i * total) / count) % total] = 1
  }
  return pattern
}

function sourceDrumProfile(
  source: SourceNote[],
  window: BarWindow,
  subdivision: number
): Map<number, number[]> {
  const profile = new Map<number, number[]>()
  const steps = Math.max(1, Math.round(window.beats * subdivision))
  source
    .filter(n => n.time >= window.start && n.time < window.end)
    .forEach(n => {
      const pad = Math.max(0, Math.min(15, Math.round(n.pitch)))
      const step = Math.max(0, Math.min(steps - 1, Math.floor(((n.time - window.start) / (window.end - window.start)) * steps)))
      const row = profile.get(pad) ?? new Array<number>(steps).fill(0)
      row[step] = 1
      profile.set(pad, row)
    })
  return profile
}

function generatePulse(input: GenerateInput, rng: () => number): GeneratedPart[] {
  const { settings, source, meterMap, timeSignature } = input
  const windows = buildBarWindows(meterMap, timeSignature, input.startTick, settings.bars)
  const notes: GeneratedNote[] = []
  const subdivision = 4
  const learned = source.isDrum
    ? sourceDrumProfile(source.notes, windows[0], subdivision)
    : null

  windows.forEach(window => {
    const steps = Math.max(4, Math.round(window.beats * subdivision))
    const stepTicks = (window.end - window.start) / steps
    const intensity = 0.55 + settings.density * 0.45
    const kickPulses = Math.max(1, Math.round(window.beats * (0.5 + settings.density)))
    const snarePulses = Math.max(1, Math.round(window.beats * 0.5))
    const hatPulses = Math.max(2, Math.round(steps * (0.25 + settings.density * 0.55)))

    const rotation = settings.motion > 0.4 && rng() < settings.motion
      ? Math.floor(rng() * steps)
      : 0

    const rows: Array<{ pad: number; pattern: number[] }> = []
    if (learned && learned.size > 0) {
      learned.forEach((pattern, pad) => {
        const rotated = pattern.map((_, i) => pattern[(i - rotation + pattern.length) % pattern.length])
        rows.push({ pad, pattern: rotated })
      })
    } else {
      rows.push({ pad: 0, pattern: euclid(steps, kickPulses) })
      rows.push({ pad: 1, pattern: euclid(steps, snarePulses).map((v, i) => (i % 2 === 0 ? 0 : v)) })
      rows.push({ pad: 2, pattern: euclid(steps, hatPulses) })
      if (settings.complexity > 0.55) rows.push({ pad: 3, pattern: euclid(steps, Math.max(1, Math.round(hatPulses * 0.25))) })
      if (settings.tension > 0.65) rows.push({ pad: 4, pattern: euclid(steps, Math.max(1, Math.round(steps * 0.12))) })
      if (settings.complexity > 0.75) rows.push({ pad: 9, pattern: euclid(steps, Math.max(1, Math.round(steps * 0.3))) })
    }

    rows.forEach(row => {
      row.pattern.forEach((hit, step) => {
        if (!hit) return
        const isGhost = rng() > intensity
        if (isGhost && rng() > settings.complexity) return
        const start = window.start + step * stepTicks
        if (start >= window.end) return
        const accent = step % subdivision === 0
        let duration = Math.max(12, Math.round(stepTicks * (row.pad === 3 ? 1.6 : 0.85)))
        duration = Math.min(duration, Math.round(window.end - start))
        notes.push({
          time: humanizeTime(rng, start, settings, window.beatTicks),
          duration,
          pitch: row.pad,
          velocity: humanizeVelocity(rng, 0, settings, accent) * (isGhost ? 0.62 : 1),
        })
      })
    })
  })

  return [{ label: 'Pulse', isDrum: true, notes }]
}

function chordForBar(
  rng: () => number,
  source: SourceNote[],
  window: BarWindow,
  settings: GenerativeSettings,
  barIndex: number,
  rootPitch: number
): number[] {
  const barred = source.filter(n => n.time >= window.start && n.time < window.end)
  if (barred.length >= 2) {
    const seedPitch = barred[0].pitch
    return getDiatonicChord(seedPitch, settings.scaleRoot, settings.scaleMode, settings.tension > 0.55 ? 'Seventh' : 'Triad')
  }

  const progression = GENRE_PROGRESSIONS[Math.abs(settings.seed) % GENRE_PROGRESSIONS.length]
  const step = progression.steps[barIndex % progression.steps.length]
  const chordRoot = rootPitch + step.rootOffset + (settings.register * 12)
  const intervals = settings.tension > 0.6
    ? [...step.intervals, 14]
    : step.intervals
  return intervals.map(interval => chordRoot + interval)
}

function voiceLead(previous: number[], target: number[]): number[] {
  let best = [...target]
  let bestDistance = Infinity
  for (let octave = -2; octave <= 2; octave += 1) {
    const candidate = target.map(p => p + octave * 12)
    const distance = previous.length === 0
      ? candidate.reduce((sum, p) => sum + Math.abs(p - 60), 0)
      : candidate.reduce((min, p) => {
        const nearest = previous.reduce((m, q) => Math.min(m, Math.abs(q - p)), Infinity)
        return min + nearest
      }, 0)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

function generateChoir(input: GenerateInput, rng: () => number): GeneratedPart[] {
  const { settings, source, meterMap, timeSignature } = input
  const windows = buildBarWindows(meterMap, timeSignature, input.startTick, settings.bars)
  const rootPitch = Math.max(36, Math.min(84, source.anchorPitch || 60))
  const voiceCount = Math.max(2, Math.min(5, Math.round(2 + settings.density * 4)))
  const notes: GeneratedNote[] = []
  let previous: number[] = []

  windows.forEach(window => {
    const chord = chordForBar(rng, source.notes, window, settings, window.index, rootPitch)
    let voicing = chord.slice(0, voiceCount)
    while (voicing.length < voiceCount) {
      voicing.push(chord[voicing.length % chord.length] + 12 * Math.floor(voicing.length / chord.length))
    }
    voicing = voiceLead(previous, voicing)
    previous = voicing

    const hits = settings.motion > 0.6
      ? Math.max(1, Math.round(1 + settings.complexity * 3))
      : 1
    const hitStep = window.beats / hits

    for (let hit = 0; hit < hits; hit += 1) {
      const start = window.start + hit * hitStep * window.beatTicks
      const duration = hits === 1
        ? window.end - start
        : Math.min(window.end - start, hitStep * window.beatTicks * 1.05)
      voicing.forEach((pitch) => {
        notes.push({
          time: humanizeTime(rng, start, settings, window.beatTicks),
          duration: Math.max(24, Math.round(duration)),
          pitch: finalizePitch(pitch, settings, false),
          velocity: humanizeVelocity(rng, 0, settings, hit === 0) * (0.85 + rng() * 0.15),
        })
      })
    }

    if (settings.tension > 0.5 && rng() < settings.tension * 0.5) {
      const bass = Math.min(...voicing) - 12
      notes.push({
        time: humanizeTime(rng, window.start, settings, window.beatTicks),
        duration: Math.max(24, window.end - window.start),
        pitch: finalizePitch(bass, settings, false),
        velocity: humanizeVelocity(rng, 0, settings, true),
      })
    }
  })

  return [{ label: 'Choir', isDrum: false, notes }]
}

function sectionIntensity(barIndex: number, total: number, tension: number): number {
  const progress = total <= 1 ? 0 : barIndex / (total - 1)
  const arch = Math.sin(Math.PI * Math.min(1, Math.max(0, progress)))
  const lift = tension * 0.35
  if (progress < 0.15) return 0.25 + lift * 0.4
  if (progress > 0.85) return 0.35 + lift * 0.4
  return 0.45 + arch * 0.45 + lift
}

function generateArrange(input: GenerateInput, rng: () => number): GeneratedPart[] {
  const { settings, source, meterMap, timeSignature } = input
  const windows = buildBarWindows(meterMap, timeSignature, input.startTick, settings.bars)
  const lead: GeneratedNote[] = []
  const pads: GeneratedNote[] = []
  const beat: GeneratedNote[] = []
  const drum = source.isDrum
  const anchor = Math.max(36, Math.min(88, source.anchorPitch || 60))
  const rootPitch = anchor

  let cell = sourceDegreeCell(source.notes, windows[0], settings.scaleRoot, settings.scaleMode)
  if (cell.length < 2) cell = scaleWalkCell(rng, windows[0], settings)
  let previousVoicing: number[] = []

  windows.forEach(window => {
    const intensity = sectionIntensity(window.index, windows.length, settings.tension)
    const barSettings: GenerativeSettings = {
      ...settings,
      density: Math.max(0.1, Math.min(1, settings.density * (0.6 + intensity * 0.7))),
      complexity: Math.max(0.05, Math.min(1, settings.complexity * (0.6 + intensity * 0.6))),
    }

    lead.push(...cellToNotes(rng, transformCell(rng, cell, Math.floor(rng() * 6)), window, barSettings, rootPitch, false, []))

    const chord = chordForBar(rng, source.notes, window, barSettings, window.index, rootPitch)
    let voicing = chord.slice(0, 3)
    voicing = voiceLead(previousVoicing, voicing)
    previousVoicing = voicing
    voicing.forEach(pitch => {
      pads.push({
        time: humanizeTime(rng, window.start, barSettings, window.beatTicks),
        duration: Math.round(window.end - window.start),
        pitch: finalizePitch(pitch, barSettings, false),
        velocity: humanizeVelocity(rng, 0, barSettings, true) * 0.7,
      })
    })
    const bassPitch = Math.min(...voicing) - 12
    pads.push({
      time: humanizeTime(rng, window.start, barSettings, window.beatTicks),
      duration: Math.round(window.end - window.start),
      pitch: finalizePitch(bassPitch, barSettings, false),
      velocity: humanizeVelocity(rng, 0, barSettings, true) * 0.8,
    })

    if (intensity > 0.45) {
      const steps = Math.max(4, Math.round(window.beats * 4))
      const stepTicks = (window.end - window.start) / steps
      const kicks = euclid(steps, Math.max(1, Math.round(window.beats * 0.75 * intensity)))
      const snares = euclid(steps, Math.max(1, Math.round(window.beats * 0.5 * intensity)))
      const hats = euclid(steps, Math.max(2, Math.round(steps * 0.3 * intensity)))
      const layers: Array<{ pad: number; pattern: number[] }> = [
        { pad: 0, pattern: kicks },
        { pad: 1, pattern: snares.map((v, i) => (i % 2 === 0 ? 0 : v)) },
        { pad: 2, pattern: hats },
      ]
      layers.forEach(layer => {
        layer.pattern.forEach((hit, stepIndex) => {
          if (!hit) return
          beat.push({
            time: Math.round(window.start + stepIndex * stepTicks),
            duration: Math.max(12, Math.round(stepTicks * 0.8)),
            pitch: layer.pad,
            velocity: Math.max(0.25, Math.min(1, intensity * 0.9)),
          })
        })
      })
    }
  })

  return [
    { label: 'Lead', isDrum: false, notes: lead },
    { label: 'Pad / Bass', isDrum: false, notes: pads },
    { label: 'Beat', isDrum: true, notes: beat },
  ]
}

function generateRespond(input: GenerateInput, rng: () => number): GeneratedPart[] {
  const { settings, source, meterMap, timeSignature } = input
  const windows = buildBarWindows(meterMap, timeSignature, input.startTick, settings.bars)
  const drum = source.isDrum
  const anchor = Math.max(36, Math.min(88, source.anchorPitch || 60))
  const notes: GeneratedNote[] = []
  const drumPads = drum
    ? Array.from(new Set(source.notes.map(n => Math.max(0, Math.min(15, Math.round(n.pitch))))))
    : []

  const sourceCell = sourceDegreeCell(source.notes, windows[0], settings.scaleRoot, settings.scaleMode)
  const cell = sourceCell.length >= 2 ? sourceCell : scaleWalkCell(rng, windows[0], settings)

  windows.forEach((window, index) => {
    if (index % 2 === 0) return // leave the call bars empty; answer on the odd bars
    const answerVariant = index % 4 === 1 ? 1 : 2
    notes.push(...cellToNotes(
      rng,
      transformCell(rng, cell, answerVariant),
      window,
      { ...settings, density: Math.min(1, settings.density + 0.1) },
      anchor,
      drum,
      drumPads.length > 0 ? drumPads : [0, 1, 2]
    ))
  })

  return [{ label: 'Response', isDrum: drum, notes }]
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function applyGridSnap(
  parts: GeneratedPart[],
  settings: GenerativeSettings,
  snapTicks?: number
): GeneratedPart[] {
  const grid = Math.max(1, Math.round(snapTicks ?? 0))
  if (!snapTicks || (!settings.snapTime && !settings.snapDuration)) return parts
  return parts.map(part => ({
    ...part,
    notes: part.notes.map(note => ({
      ...note,
      time: settings.snapTime ? Math.max(0, Math.round(note.time / grid) * grid) : note.time,
      duration: settings.snapDuration
        ? Math.max(grid, Math.round(note.duration / grid) * grid)
        : note.duration,
    })),
  }))
}

export function generateParts(input: GenerateInput): GeneratedPart[] {
  const settings: GenerativeSettings = {
    ...DEFAULT_GENERATIVE_SETTINGS,
    ...input.settings,
    bars: Math.max(1, Math.min(64, Math.round(input.settings.bars))),
  }
  const rng = mulberry32(hashSeed(`${settings.seed}:${settings.engine}:${input.startTick}`))

  let parts: GeneratedPart[]
  switch (settings.engine) {
    case 'pulse':
      parts = generatePulse({ ...input, settings }, rng)
      break
    case 'choir':
      parts = generateChoir({ ...input, settings }, rng)
      break
    case 'arrange':
      parts = generateArrange({ ...input, settings }, rng)
      break
    case 'respond':
      parts = generateRespond({ ...input, settings }, rng)
      break
    case 'motif':
    default:
      parts = generateMotif({ ...input, settings }, rng)
      break
  }
  return applyGridSnap(parts, settings, input.snapTicks)
}
