import type { Note } from '../engine/store'

/** Per-note expression fields an articulation owns. Applying an articulation resets these first. */
export const ARTICULATION_FIELDS: Array<keyof Note> = [
  'vibratoDepth',
  'vibratoRate',
  'vibratoDelay',
  'vibratoFade',
  'vibratoWave',
  'tremoloDepth',
  'tremoloRate',
  'tremoloWave',
  'filterStart',
  'filterEnd',
  'filterSweepTime',
  'filterSweepRamp',
  'pitchSlide',
  'pitchSlideTime',
  'pitchSlideRamp',
  'pitchSlideCustomCurve',
  'glideStyle',
  'octaves',
  'resonance',
  'decay',
]

export interface ArticulationPreset {
  id: string
  name: string
  updates: Partial<Note>
  builtin?: boolean
}

export const DEFAULT_ARTICULATION_PRESETS: ArticulationPreset[] = [
  {
    id: 'art_sustain',
    name: 'Sustain',
    builtin: true,
    updates: {},
  },
  {
    id: 'art_vibrato',
    name: 'Vibrato',
    builtin: true,
    updates: {
      vibratoDepth: 30,
      vibratoRate: 5.5,
      vibratoDelay: 120,
      vibratoFade: 180,
      vibratoWave: 'sine',
    },
  },
  {
    id: 'art_slow_vibrato',
    name: 'Slow Vibrato',
    builtin: true,
    updates: {
      vibratoDepth: 22,
      vibratoRate: 3.8,
      vibratoDelay: 260,
      vibratoFade: 380,
      vibratoWave: 'sine',
    },
  },
  {
    id: 'art_tremolo',
    name: 'Tremolo',
    builtin: true,
    updates: {
      tremoloDepth: 0.5,
      tremoloRate: 9,
      tremoloWave: 'sine',
    },
  },
  {
    id: 'art_swell',
    name: 'Filter Swell',
    builtin: true,
    updates: {
      filterStart: 500,
      filterEnd: 8000,
      filterSweepTime: 96,
      filterSweepRamp: 'exponential',
    },
  },
  {
    id: 'art_dark',
    name: 'Dark',
    builtin: true,
    updates: {
      filterStart: 1200,
      filterEnd: 900,
      filterSweepTime: 0,
    },
  },
  {
    id: 'art_pluck',
    name: 'Pluck',
    builtin: true,
    updates: {
      filterStart: 9000,
      filterEnd: 1400,
      filterSweepTime: 48,
      filterSweepRamp: 'exponential',
      tremoloDepth: 0,
      vibratoDepth: 0,
    },
  },
  {
    id: 'art_glide_up',
    name: 'Glide Up',
    builtin: true,
    updates: {
      pitchSlide: 2,
      pitchSlideTime: 48,
      pitchSlideRamp: 'linear',
      glideStyle: 'smooth',
    },
  },
  {
    id: 'art_ghost',
    name: 'Ghost',
    builtin: true,
    updates: {
      velocity: 45,
      filterStart: 1600,
      filterEnd: 1600,
      filterSweepTime: 0,
    },
  },
  {
    id: 'art_soft_hit',
    name: 'Soft Hit',
    builtin: true,
    updates: {
      velocity: 60,
      octaves: 1,
      decay: 0.18,
    },
  },
  {
    id: 'art_punch',
    name: 'Punch',
    builtin: true,
    updates: {
      velocity: 120,
      octaves: 2,
      decay: 0.09,
    },
  },
]

const toArticulationValue = (value: unknown) => {
  if (value === undefined) return undefined
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  return value
}

/** Capture a note's current articulation as a reusable preset bundle. */
export const captureArticulation = (note: Note | undefined): Partial<Note> => {
  if (!note) return {}
  const updates: Partial<Note> = {}
  ARTICULATION_FIELDS.forEach(key => {
    const value = toArticulationValue(note[key])
    if (value !== undefined) (updates as any)[key] = value
  })
  // Velocity only travels with the bundle when the user deliberately shaped it in the inspector.
  if (note.velocityInspectorModified && Number.isFinite(note.velocity)) {
    updates.velocity = note.velocity
  }
  return updates
}

/** A note has custom articulation when any owned field is set away from neutral. */
export const hasCustomArticulation = (note: Note | undefined): boolean => {
  if (!note) return false
  return ARTICULATION_FIELDS.some(key => note[key] !== undefined)
}
