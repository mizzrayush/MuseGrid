import type { EnvelopeCurveType } from './envelopeCurves'

export const PPQ = 192

export type SoundRole = 'Bass' | 'Lead' | 'Pluck' | 'Pad' | 'Bells'
export type SoundOscillator = 'sine' | 'triangle' | 'square' | 'sawtooth'

export interface MelodyNoteLike {
  time: number
  duration: number
  pitch: number
  velocity: number
}

export interface MelodyProfile {
  noteCount: number
  lowPitch: number
  highPitch: number
  centerPitch: number
  span: number
  bpm: number
  notesPerBeat: number
  notesPerSecond: number
  tempoFeel: 'slow' | 'mid' | 'fast'
  gateRatio: number
  legatoRatio: number
  velocityMean: number
  velocitySpread: number
  density: 'sparse' | 'flowing' | 'dense'
  articulation: 'staccato' | 'balanced' | 'legato'
  register: 'low' | 'mid' | 'high'
  summary: string
  previewNotes: MelodyNoteLike[]
  startTime: number
}

export interface SoundCandidate {
  id: string
  role: SoundRole
  name: string
  oscillator: SoundOscillator
  attack: number
  decay: number
  sustain: number
  release: number
  curveType: EnvelopeCurveType
  summary: string
  fit: string
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function noteName(pitch: number): string {
  const p = Math.round(pitch)
  return `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function analyzeMelody(notes: MelodyNoteLike[], bpm = 120, ppq = PPQ): MelodyProfile | null {
  const sorted = notes
    .filter(n => Number.isFinite(n.time) && Number.isFinite(n.pitch) && Number.isFinite(n.duration) && n.duration > 0)
    .sort((a, b) => a.time - b.time)
  if (!sorted.length) return null

  const pitches = sorted.map(n => Math.round(n.pitch))
  const lowPitch = Math.min(...pitches)
  const highPitch = Math.max(...pitches)
  const centerPitch = median(pitches)

  const gaps: number[] = []
  const durations: number[] = []
  let legato = 0
  for (let i = 0; i < sorted.length; i++) {
    durations.push(sorted[i].duration)
    if (i < sorted.length - 1) {
      const gap = Math.max(1, sorted[i + 1].time - sorted[i].time)
      gaps.push(gap)
      if (sorted[i].duration >= gap * 0.9) legato++
    }
  }

  const firstTime = sorted[0].time
  const lastEnd = Math.max(...sorted.map(n => n.time + n.duration))
  const totalBeats = Math.max(0.25, (lastEnd - firstTime) / ppq)
  const notesPerBeat = sorted.length / totalBeats
  const safeBpm = Math.max(20, Math.min(400, Number.isFinite(bpm) ? bpm : 120))
  const notesPerSecond = notesPerBeat * (safeBpm / 60)
  const gateRatio = Math.max(0.05, Math.min(4, median(durations) / Math.max(1, median(gaps))))
  const legatoRatio = gaps.length ? legato / gaps.length : 1

  const velocities = sorted.map(n => Math.max(0, Math.min(127, n.velocity)))
  const velocityMean = velocities.reduce((sum, v) => sum + v, 0) / velocities.length
  const variance = velocities.reduce((sum, v) => sum + (v - velocityMean) ** 2, 0) / velocities.length
  const velocitySpread = Math.sqrt(variance)

  const density = notesPerBeat <= 1.5 ? 'sparse' : notesPerBeat <= 4 ? 'flowing' : 'dense'
  const articulation = gateRatio < 0.45 ? 'staccato' : gateRatio >= 0.85 || legatoRatio >= 0.6 ? 'legato' : 'balanced'
  const register = centerPitch < 48 ? 'low' : centerPitch < 68 ? 'mid' : 'high'
  // Tempo and absolute note rate decide how sharp or soft the generated envelopes are.
  const tempoFeel = safeBpm >= 128 || notesPerSecond >= 4
    ? 'fast'
    : safeBpm <= 84 || notesPerSecond <= 1
      ? 'slow'
      : 'mid'

  return {
    noteCount: sorted.length,
    lowPitch,
    highPitch,
    centerPitch,
    span: highPitch - lowPitch,
    bpm: safeBpm,
    notesPerBeat,
    notesPerSecond,
    tempoFeel,
    gateRatio,
    legatoRatio,
    velocityMean,
    velocitySpread,
    density,
    articulation,
    register,
    summary: `${noteName(lowPitch)}-${noteName(highPitch)} / ${sorted.length} notes / ${density} ${articulation} / ${Math.round(safeBpm)} BPM`,
    previewNotes: sorted.slice(0, 10),
    startTime: firstTime,
  }
}

interface RoleSpec {
  oscillators: SoundOscillator[]
  attack: [number, number]
  decay: [number, number]
  sustain: [number, number]
  release: [number, number]
  curve: EnvelopeCurveType
  names: string[]
}

const ROLE_SPECS: Record<SoundRole, RoleSpec> = {
  Bass: {
    oscillators: ['triangle', 'square'],
    attack: [0.004, 0.014],
    decay: [0.09, 0.22],
    sustain: [0.35, 0.6],
    release: [0.08, 0.18],
    curve: 'exponential',
    names: ['Sub Anchor', 'Low Tide', 'Deep Current', 'Root Engine'],
  },
  Lead: {
    oscillators: ['sawtooth', 'square'],
    attack: [0.005, 0.02],
    decay: [0.12, 0.3],
    sustain: [0.5, 0.75],
    release: [0.15, 0.35],
    curve: 'exponential',
    names: ['Signal Flare', 'Neon Thread', 'Bright Wire', 'Skyline'],
  },
  Pluck: {
    oscillators: ['triangle', 'square'],
    attack: [0.001, 0.006],
    decay: [0.07, 0.16],
    sustain: [0.02, 0.14],
    release: [0.05, 0.16],
    curve: 'exponential',
    names: ['Glass Pin', 'Short Circuit', 'Crystal Stitch', 'Tine Drop'],
  },
  Pad: {
    oscillators: ['sine', 'triangle'],
    attack: [0.18, 0.45],
    decay: [0.25, 0.5],
    sustain: [0.6, 0.85],
    release: [0.6, 1.3],
    curve: 'scurve',
    names: ['Slow Bloom', 'Cloud Bed', 'Velvet Haze', 'Long Air'],
  },
  Bells: {
    oscillators: ['sine', 'triangle'],
    attack: [0.002, 0.01],
    decay: [0.5, 1.1],
    sustain: [0.03, 0.12],
    release: [0.8, 1.6],
    curve: 'exponential',
    names: ['Ice Chime', 'Bell Lattice', 'Frost Keys', 'Distant Bell'],
  },
}

const ROLES: SoundRole[] = ['Bass', 'Lead', 'Pluck', 'Pad', 'Bells']

function createRng(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFor(variation: number, roleIndex: number, profile: MelodyProfile): number {
  let h = Math.trunc(variation * 1000) >>> 0
  h = (Math.imul(h ^ (h >>> 16), 0x7feb352d) + Math.imul(profile.noteCount + 1, 0x85ebca6b)) >>> 0
  h = (Math.imul(h ^ (h >>> 15), 0x846ca68b) + Math.imul(roleIndex + 1, 0x9e3779b9)) >>> 0
  h = (h ^ Math.round(profile.centerPitch) ^ Math.round(profile.gateRatio * 100) ^ Math.round(profile.notesPerBeat * 10)) >>> 0
  h = (h ^ Math.round(profile.bpm) ^ Math.round(profile.notesPerSecond * 10)) >>> 0
  return h
}

function lerp(rng: () => number, range: [number, number]): number {
  return range[0] + (range[1] - range[0]) * rng()
}

function pick<T>(rng: () => number, values: T[]): T {
  return values[Math.floor(rng() * values.length)] ?? values[0]
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function buildTempoFit(profile: MelodyProfile): string {
  const bpm = Math.round(profile.bpm)
  switch (profile.tempoFeel) {
    case 'fast':
      return `Tight envelope for the ${bpm} BPM pulse.`
    case 'slow':
      return `Longer bloom to match the ${bpm} BPM spacing.`
    default:
      return `Balanced envelope at ${bpm} BPM.`
  }
}

function buildFit(role: SoundRole, profile: MelodyProfile): string {
  switch (role) {
    case 'Bass':
      return profile.register === 'low'
        ? 'Sits under your low-register line without masking it.'
        : 'Adds low weight while the melody stays on top.'
    case 'Lead':
      return `${profile.span} semitones of range suit a cutting lead line.`
    case 'Pluck':
      return profile.articulation === 'staccato'
        ? 'Matches your short, separated notes.'
        : 'Tightens busy phrasing so notes stay distinct.'
    case 'Pad':
      return profile.articulation === 'legato'
        ? 'Long attack and tail blend with your legato notes.'
        : 'Fills the space behind the line without stealing focus.'
    case 'Bells':
      if (profile.density === 'sparse') return 'Long ring carries across your sparse phrasing.'
      if (profile.density === 'dense') return 'Keeps the top end airy above dense notes.'
      return 'Rings above the line without crowding it.'
  }
}

export function generateSynthCandidates(profile: MelodyProfile, variation = 1): SoundCandidate[] {
  return ROLES.map((role, index) => {
    const spec = ROLE_SPECS[role]
    const rng = createRng(seedFor(variation, index, profile))

    const dense = profile.density === 'dense'
    const sparse = profile.density === 'sparse'
    const legato = profile.articulation === 'legato'
    const staccato = profile.articulation === 'staccato'
    const isSustained = role === 'Pad' || role === 'Bells'
    const fast = profile.tempoFeel === 'fast'
    const slow = profile.tempoFeel === 'slow'

    let attack = lerp(rng, spec.attack)
    let decay = lerp(rng, spec.decay)
    let sustain = lerp(rng, spec.sustain)
    let release = lerp(rng, spec.release)

    if (dense) {
      attack *= 0.75
      decay *= 0.85
      release *= 0.9
    } else if (sparse) {
      decay *= 1.1
      release *= 1.15
    }
    if (legato) {
      if (isSustained) attack *= 1.2
      if (role !== 'Pluck') sustain += 0.06
      release *= 1.12
    }
    if (staccato && role !== 'Pad') sustain -= 0.05

    // Tempo shapes the character: fast material gets a sharper, shorter envelope and a
    // brighter waveform; slow material blooms longer and stays on softer waveforms.
    if (fast) {
      attack *= 0.72
      decay *= 0.8
      release *= 0.78
      if (role !== 'Pad') sustain -= 0.03
    } else if (slow) {
      if (!isSustained && role !== 'Pluck') attack *= 1.3
      decay *= 1.18
      release *= 1.2
      sustain += 0.03
    }

    const softOscillator: Record<SoundRole, SoundOscillator> = {
      Bass: 'triangle', Lead: 'triangle', Pluck: 'triangle', Pad: 'sine', Bells: 'sine',
    }
    const sharpOscillator: Record<SoundRole, SoundOscillator> = {
      Bass: 'square', Lead: 'sawtooth', Pluck: 'square', Pad: 'triangle', Bells: 'triangle',
    }

    let oscillator: SoundOscillator
    if (fast) oscillator = sharpOscillator[role]
    else if (slow) oscillator = softOscillator[role]
    else oscillator = rng() > 0.7 ? (spec.oscillators[1] ?? spec.oscillators[0]) : spec.oscillators[0]
    if (role === 'Bass' && profile.register === 'high') oscillator = 'triangle'
    else if (role === 'Lead' && profile.register === 'low') oscillator = 'square'

    let curveType: EnvelopeCurveType = spec.curve
    if (fast) curveType = 'exponential'
    else if (slow) curveType = role === 'Pad' ? 'scurve' : role === 'Bells' ? 'logarithmic' : spec.curve

    const nameBase = pick(rng, spec.names)
    const finalAttack = round(attack, 3)
    const finalDecay = round(decay, 3)
    const finalSustain = round(Math.max(0.02, Math.min(0.92, sustain)), 2)
    const finalRelease = round(release, 3)

    const result: SoundCandidate = {
      id: `${role.toLowerCase()}-${index}-${variation}`,
      role,
      name: nameBase,
      oscillator,
      attack: finalAttack,
      decay: finalDecay,
      sustain: finalSustain,
      release: finalRelease,
      curveType,
      summary: `${oscillator} / A ${Math.round(finalAttack * 1000)}ms / D ${Math.round(finalDecay * 1000)}ms / S ${Math.round(finalSustain * 100)}% / R ${Math.round(finalRelease * 1000)}ms`,
      fit: `${buildFit(role, profile)} ${buildTempoFit(profile)}`,
    }
    return result
  })
}
