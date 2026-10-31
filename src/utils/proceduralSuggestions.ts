import type { Note, ScaleLock, Track } from '../engine/store'
import { NOTE_NAMES, SCALE_INTERVALS, getScaleIntervals, resolveScaleMode, detectScaleDegree } from './musicTheory'
import { getMeterPositionAtTick, getNextBarTick, type MeterPoint } from './conductor'

export type SuggestionKind = 'chords' | 'bassline' | 'rhythm'

export interface ProceduralSuggestion {
  id: string
  kind: SuggestionKind
  title: string
  subtitle: string
  targetInstrument: 'synth' | 'drum'
  notes: Array<Omit<Note, 'id' | 'trackId'>>
}

interface SuggestionContext {
  notes: Note[]
  tracks: Track[]
  activeTrackId: string | null
  scaleLock: ScaleLock
  playheadPosition: number
  meterMap?: MeterPoint[]
  timeSignature?: string
}

/**
 * Progressions are derived from the scale itself, not from fixed major/minor templates.
 * Each shape targets the functional intervals (tonic, fifth, sixth, fourth, second) and
 * snaps them to the nearest scale degree, so pentatonic, modal, exotic and custom scales
 * get chords built only from their own notes.
 */
function harmonicProgressions(scaleLock: ScaleLock): Array<{ name: string; degrees: number[] }> {
  const raw = getScaleIntervals(scaleLock.mode, scaleLock.customIntervals) ?? SCALE_INTERVALS.Major
  const intervals = Array.from(new Set(
    raw.filter(value => Number.isFinite(value) && value >= 0 && value < 12)
  )).sort((a, b) => a - b)
  if (intervals.length < 3) {
    return [{ name: 'I - V - I', degrees: [0, 1, 0] }]
  }

  const degreeFor = (target: number, used: Set<number>): number => {
    const order = intervals
      .map((interval, index) => ({
        index,
        distance: Math.min(Math.abs(interval - target), 12 - Math.abs(interval - target))
      }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
    return (order.find(candidate => !used.has(candidate.index)) ?? order[0]).index
  }

  const build = (targets: number[]): number[] => {
    const used = new Set<number>()
    return targets.map(target => {
      const degree = degreeFor(target, used)
      used.add(degree)
      return degree
    })
  }

  // I-V-vi-IV, I-vi-IV-V and ii-V-I-vi analogues in whatever scale is active.
  const shapes = [build([0, 7, 9, 5]), build([0, 9, 5, 7]), build([2, 7, 0, 9])]

  return shapes.map(degrees => ({
    degrees,
    name: degrees
      .map(degree => detectScaleDegree(
        intervals[((degree % intervals.length) + intervals.length) % intervals.length],
        0,
        scaleLock.mode,
        scaleLock.customIntervals
      ) ?? `${degree + 1}`)
      .join(' - ')
  }))
}

function scalePitch(degree: number, root: number, mode: string, octaveBase: number, customIntervals?: number[]): number {
  const intervals = getScaleIntervals(mode, customIntervals) ?? SCALE_INTERVALS.Major
  const index = ((degree % intervals.length) + intervals.length) % intervals.length
  const octave = Math.floor(degree / intervals.length)
  return octaveBase + root + intervals[index] + octave * 12
}

function makeTriad(degree: number, scaleLock: ScaleLock, octaveBase: number): number[] {
  return [
    scalePitch(degree, scaleLock.root, scaleLock.mode, octaveBase, scaleLock.customIntervals),
    scalePitch(degree + 2, scaleLock.root, scaleLock.mode, octaveBase, scaleLock.customIntervals),
    scalePitch(degree + 4, scaleLock.root, scaleLock.mode, octaveBase, scaleLock.customIntervals),
  ].filter(pitch => pitch >= 0 && pitch < 96)
}

function startAtNextBar(context: SuggestionContext): number {
  const signature = context.timeSignature || '4/4'
  return Math.max(0, getNextBarTick(context.meterMap, signature, Math.max(0, context.playheadPosition)))
}

function barTicksAt(context: SuggestionContext, tick: number): number {
  const signature = context.timeSignature || '4/4'
  const position = getMeterPositionAtTick(context.meterMap, signature, tick)
  return Math.max(1, Math.round(position.barTicks))
}

function inferMelodyCenter(notes: Note[], activeTrackId: string | null): number {
  const synthNotes = notes.filter(note => !activeTrackId || note.trackId === activeTrackId)
  if (synthNotes.length === 0) return 60
  const average = synthNotes.reduce((sum, note) => sum + note.pitch, 0) / synthNotes.length
  return Math.max(36, Math.min(84, Math.round(average)))
}

function chordSuggestions(context: SuggestionContext): ProceduralSuggestion[] {
  const start = startAtNextBar(context)
  const progressions = harmonicProgressions(context.scaleLock)
  const rootName = NOTE_NAMES[context.scaleLock.root] ?? 'C'

  return progressions.map((progression, index) => {
    let cursor = start
    const notes: Array<Omit<Note, 'id' | 'trackId'>> = []
    progression.degrees.forEach(degree => {
      const barTicks = barTicksAt(context, cursor)
      makeTriad(degree, context.scaleLock, 60).forEach((pitch, noteIndex) => {
        notes.push({
          time: cursor,
          duration: barTicks,
          pitch,
          velocity: 96 - noteIndex * 8,
        })
      })
      cursor += barTicks
    })

    return {
      id: `chords-${index}`,
      kind: 'chords' as const,
      title: progression.name,
      subtitle: `${rootName} ${context.scaleLock.mode}, one chord per bar`,
      targetInstrument: 'synth' as const,
      notes,
    }
  })
}

function basslineSuggestions(context: SuggestionContext): ProceduralSuggestion[] {
  const start = startAtNextBar(context)
  const progressions = harmonicProgressions(context.scaleLock)
  const center = inferMelodyCenter(context.notes, context.activeTrackId)
  const octaveBase = center > 64 ? 48 : 36

  return progressions.slice(0, 3).map((progression, index) => {
    const notes: Array<Omit<Note, 'id' | 'trackId'>> = []
    let cursor = start
    progression.degrees.forEach(degree => {
      const barTicks = barTicksAt(context, cursor)
      const root = scalePitch(degree, context.scaleLock.root, context.scaleLock.mode, octaveBase, context.scaleLock.customIntervals)
      const fifth = scalePitch(degree + 4, context.scaleLock.root, context.scaleLock.mode, octaveBase, context.scaleLock.customIntervals)
      const octave = root + 12
      const pattern = [root, root, fifth, root, octave, fifth, root, fifth]
      // One step per eighth note in the active meter (8 steps in 4/4, 7 in 7/8, 10 in 5/4).
      const steps = Math.max(1, Math.round(barTicks / 96))
      const stepTicks = barTicks / steps
      for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
        notes.push({
          time: Math.round(cursor + stepIndex * stepTicks),
          duration: Math.max(1, Math.round(stepTicks)),
          pitch: Math.max(0, Math.min(95, pattern[stepIndex % pattern.length])),
          velocity: stepIndex % 2 === 0 ? 100 : 82,
        })
      }
      cursor += barTicks
    })

    return {
      id: `bassline-${index}`,
      kind: 'bassline' as const,
      title: progression.name,
      subtitle: 'Root and fifth movement locked to the current scale',
      targetInstrument: 'synth' as const,
      notes,
    }
  })
}

function rhythmSuggestions(context: SuggestionContext): ProceduralSuggestion[] {
  const start = startAtNextBar(context)
  const barTicks = barTicksAt(context, start)
  const stepTicks = barTicks / 16
  const patterns = [
    {
      title: 'Four Floor Lift',
      subtitle: 'Kick on every beat, backbeat snare, steady hats',
      hits: [
        ...[0, 4, 8, 12].map(step => ({ step, pitch: 0, velocity: 112 })),
        ...[4, 12].map(step => ({ step, pitch: 1, velocity: 105 })),
        ...Array.from({ length: 16 }, (_, step) => ({ step, pitch: 2, velocity: step % 4 === 0 ? 86 : 68 })),
        { step: 12, pitch: 4, velocity: 82 },
      ],
    },
    {
      title: 'Syncopated Push',
      subtitle: 'Off-beat kicks with clipped hats',
      hits: [
        ...[0, 3, 7, 10, 14].map(step => ({ step, pitch: 0, velocity: step === 0 ? 116 : 94 })),
        ...[4, 12].map(step => ({ step, pitch: 1, velocity: 108 })),
        ...[2, 4, 6, 8, 10, 12, 14].map(step => ({ step, pitch: 2, velocity: 72 })),
        ...[6, 14].map(step => ({ step, pitch: 3, velocity: 58 })),
      ],
    },
    {
      title: 'Half-Time Pocket',
      subtitle: 'Wide snare, sparse kick, open hat lift',
      hits: [
        ...[0, 6, 10].map(step => ({ step, pitch: 0, velocity: 110 })),
        { step: 8, pitch: 1, velocity: 118 },
        ...[0, 2, 4, 6, 8, 10, 12, 14].map(step => ({ step, pitch: 2, velocity: step === 8 ? 88 : 64 })),
        { step: 15, pitch: 3, velocity: 72 },
        { step: 8, pitch: 4, velocity: 74 },
      ],
    },
  ]

  return patterns.map((pattern, index) => ({
    id: `rhythm-${index}`,
    kind: 'rhythm',
    title: pattern.title,
    subtitle: pattern.subtitle,
    targetInstrument: 'drum',
    notes: pattern.hits.map(hit => ({
      time: Math.round(start + hit.step * stepTicks),
      duration: Math.max(1, Math.round(stepTicks)),
      pitch: hit.pitch,
      velocity: hit.velocity,
    })),
  }))
}

export function createProceduralSuggestions(kind: SuggestionKind, context: SuggestionContext): ProceduralSuggestion[] {
  const normalizedContext = {
    ...context,
    scaleLock: {
      ...context.scaleLock,
      mode: resolveScaleMode(context.scaleLock.mode) ?? context.scaleLock.mode,
    },
  }

  if (kind === 'bassline') return basslineSuggestions(normalizedContext)
  if (kind === 'rhythm') return rhythmSuggestions(normalizedContext)
  return chordSuggestions(normalizedContext)
}
