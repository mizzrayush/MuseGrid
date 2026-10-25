import type { Note, ScaleLock, Track } from '../engine/store'
import { NOTE_NAMES, SCALE_INTERVALS } from './musicTheory'

const BEAT = 192
const BAR = BEAT * 4
const STEP = 48

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
}

const MAJOR_PROGRESSIONS = [
  { name: 'I - V - vi - IV', degrees: [0, 4, 5, 3] },
  { name: 'I - vi - IV - V', degrees: [0, 5, 3, 4] },
  { name: 'ii - V - I - vi', degrees: [1, 4, 0, 5] },
]

const MINOR_PROGRESSIONS = [
  { name: 'i - VI - III - VII', degrees: [0, 5, 2, 6] },
  { name: 'i - iv - VII - III', degrees: [0, 3, 6, 2] },
  { name: 'i - VII - VI - V', degrees: [0, 6, 5, 4] },
]

function modeFeelsMinor(mode: string): boolean {
  return ['Natural Minor', 'Dorian', 'Phrygian', 'Locrian', 'Pentatonic Minor', 'Blues'].includes(mode)
}

function getModeIntervals(scaleLock: ScaleLock): number[] {
  return SCALE_INTERVALS[scaleLock.mode] ?? SCALE_INTERVALS.Major
}

function scalePitch(degree: number, root: number, mode: string, octaveBase: number): number {
  const intervals = SCALE_INTERVALS[mode] ?? SCALE_INTERVALS.Major
  const index = ((degree % intervals.length) + intervals.length) % intervals.length
  const octave = Math.floor(degree / intervals.length)
  return octaveBase + root + intervals[index] + octave * 12
}

function makeTriad(degree: number, scaleLock: ScaleLock, octaveBase: number): number[] {
  return [
    scalePitch(degree, scaleLock.root, scaleLock.mode, octaveBase),
    scalePitch(degree + 2, scaleLock.root, scaleLock.mode, octaveBase),
    scalePitch(degree + 4, scaleLock.root, scaleLock.mode, octaveBase),
  ].filter(pitch => pitch >= 0 && pitch < 96)
}

function startAtNextBar(playheadPosition: number): number {
  return Math.max(0, Math.round(playheadPosition / BAR) * BAR)
}

function inferMelodyCenter(notes: Note[], activeTrackId: string | null): number {
  const synthNotes = notes.filter(note => !activeTrackId || note.trackId === activeTrackId)
  if (synthNotes.length === 0) return 60
  const average = synthNotes.reduce((sum, note) => sum + note.pitch, 0) / synthNotes.length
  return Math.max(36, Math.min(84, Math.round(average)))
}

function chordSuggestions(context: SuggestionContext): ProceduralSuggestion[] {
  const start = startAtNextBar(context.playheadPosition)
  const progressions = modeFeelsMinor(context.scaleLock.mode) ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS
  const rootName = NOTE_NAMES[context.scaleLock.root] ?? 'C'

  return progressions.map((progression, index) => ({
    id: `chords-${index}`,
    kind: 'chords',
    title: progression.name,
    subtitle: `${rootName} ${context.scaleLock.mode}, one chord per bar`,
    targetInstrument: 'synth',
    notes: progression.degrees.flatMap((degree, barIndex) =>
      makeTriad(degree, context.scaleLock, 60).map((pitch, noteIndex) => ({
        time: start + barIndex * BAR,
        duration: BAR,
        pitch,
        velocity: 96 - noteIndex * 8,
      })),
    ),
  }))
}

function basslineSuggestions(context: SuggestionContext): ProceduralSuggestion[] {
  const start = startAtNextBar(context.playheadPosition)
  const progressions = modeFeelsMinor(context.scaleLock.mode) ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS
  const center = inferMelodyCenter(context.notes, context.activeTrackId)
  const octaveBase = center > 64 ? 48 : 36

  return progressions.slice(0, 3).map((progression, index) => {
    const notes = progression.degrees.flatMap((degree, barIndex) => {
      const root = scalePitch(degree, context.scaleLock.root, context.scaleLock.mode, octaveBase)
      const fifth = scalePitch(degree + 4, context.scaleLock.root, context.scaleLock.mode, octaveBase)
      const octave = root + 12
      const pattern = [root, root, fifth, root, octave, fifth, root, fifth]

      return pattern.map((pitch, stepIndex) => ({
        time: start + barIndex * BAR + stepIndex * (BEAT / 2),
        duration: BEAT / 2,
        pitch: Math.max(0, Math.min(95, pitch)),
        velocity: stepIndex % 2 === 0 ? 100 : 82,
      }))
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
  const start = startAtNextBar(context.playheadPosition)
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
      time: start + hit.step * STEP,
      duration: STEP,
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
      mode: getModeIntervals(context.scaleLock).length > 0 ? context.scaleLock.mode : 'Major',
    },
  }

  if (kind === 'bassline') return basslineSuggestions(normalizedContext)
  if (kind === 'rhythm') return rhythmSuggestions(normalizedContext)
  return chordSuggestions(normalizedContext)
}
