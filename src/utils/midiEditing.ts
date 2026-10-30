import type { Note } from '../engine/store'
import { snapToScale, SCALE_INTERVALS } from './musicTheory'

export function newId(): string {
  return Math.random().toString(36).substring(2, 11)
}

// ---------------------------------------------------------------------------
// 1. ARTICULATION & TIMING SUITE
// ---------------------------------------------------------------------------

export interface LegatoOptions {
  gapTicks?: number // 0 = flush, >0 = overlap for portamento, <0 = slight gap
  extendLastNote?: boolean
  lastNoteExtendTicks?: number
}

/**
 * Quick Legato (Ctrl+L)
 * Extends each note's duration until the start of the next chronological note,
 * removing silence/gaps between consecutive notes.
 */
export function applyLegato(notes: Note[], options: LegatoOptions = {}): Note[] {
  if (notes.length <= 1) return notes.map(n => ({ ...n }))

  const gap = options.gapTicks ?? 0
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.pitch - b.pitch)

  // Map to store new durations by note ID
  const durationUpdates = new Map<string, number>()

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]
    // Find the next chronologically occurring note that starts strictly after current.time
    const nextNote = sorted.slice(i + 1).find(n => n.time > current.time)

    if (nextNote) {
      const targetDuration = Math.max(12, (nextNote.time - current.time) + gap)
      durationUpdates.set(current.id, targetDuration)
    } else if (options.extendLastNote && options.lastNoteExtendTicks) {
      durationUpdates.set(current.id, Math.max(current.duration, options.lastNoteExtendTicks))
    }
  }

  return notes.map(n => {
    const newDur = durationUpdates.get(n.id)
    return newDur !== undefined ? { ...n, duration: newDur } : { ...n }
  })
}

export interface StrumOptions {
  strumTime?: number          // Delay in ticks between successive chord notes (e.g. 6 to 36)
  direction?: 'up' | 'down' | 'alternate' // Up = low-to-high, Down = high-to-low
  tension?: number            // -1 to 1: -1 accelerates (strum speeds up), +1 decelerates
  velocityRamp?: number       // Velocity delta from first to last note (-40 to +40)
  alignEnds?: boolean         // Whether to adjust durations so all chord notes stop together
  chordProximityTicks?: number // Window in ticks to cluster notes as belonging to the same chord
}

/**
 * Signature Polyphonic Strummer (Alt+S)
 * Takes polyphonic chords and staggers note start times realistically with
 * acceleration/tension curve, direction, velocity crescendo/decrescendo, and end alignment.
 */
export function applyStrum(notes: Note[], options: StrumOptions = {}): Note[] {
  if (notes.length <= 1) return notes.map(n => ({ ...n }))

  const strumTime = options.strumTime ?? 12
  const direction = options.direction ?? 'up'
  const tension = Math.max(-1, Math.min(1, options.tension ?? 0))
  const velocityRamp = options.velocityRamp ?? 0
  const alignEnds = options.alignEnds ?? false
  const tolerance = options.chordProximityTicks ?? 24

  // 1. Group notes into chord clusters based on start time proximity
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.pitch - b.pitch)
  const chordClusters: Note[][] = []
  let currentCluster: Note[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (Math.abs(curr.time - prev.time) <= tolerance) {
      currentCluster.push(curr)
    } else {
      chordClusters.push(currentCluster)
      currentCluster = [curr]
    }
  }
  if (currentCluster.length > 0) chordClusters.push(currentCluster)

  const updatedNotesMap = new Map<string, { time: number; duration: number; velocity: number }>()

  // 2. Process each chord cluster
  chordClusters.forEach((cluster, chordIndex) => {
    if (cluster.length <= 1) {
      // Single note, no strumming needed
      const n = cluster[0]
      updatedNotesMap.set(n.id, { time: n.time, duration: n.duration, velocity: n.velocity })
      return
    }

    // Determine direction for this cluster
    let isUp = direction === 'up'
    if (direction === 'alternate') {
      isUp = chordIndex % 2 === 0
    }

    // Sort cluster notes by pitch: Up = lowest pitch first, Down = highest pitch first
    const pitchSorted = [...cluster].sort((a, b) => isUp ? a.pitch - b.pitch : b.pitch - a.pitch)
    const baseTime = Math.min(...cluster.map(n => n.time))
    const maxEndTime = Math.max(...cluster.map(n => n.time + n.duration))
    const count = pitchSorted.length

    pitchSorted.forEach((note, index) => {
      // Calculate normalized progress [0, 1]
      const t = count > 1 ? index / (count - 1) : 0

      // Apply tension curve: t^k where tension modifies k
      // tension > 0: decelerate (starts fast, slows down); tension < 0: accelerate
      let curvedT = t
      if (tension > 0) {
        curvedT = Math.pow(t, 1 + tension * 2)
      } else if (tension < 0) {
        curvedT = 1 - Math.pow(1 - t, 1 + Math.abs(tension) * 2)
      }

      const offsetTicks = Math.round(curvedT * strumTime * (count - 1))
      const newTime = baseTime + offsetTicks

      // Velocity ramp across the strum
      const velDelta = Math.round(velocityRamp * (t - 0.5) * 2)
      const newVel = Math.max(1, Math.min(127, note.velocity + velDelta))

      // Duration: if alignEnds, end exactly at chord's maxEndTime
      let newDuration = note.duration
      if (alignEnds) {
        newDuration = Math.max(12, maxEndTime - newTime)
      }

      updatedNotesMap.set(note.id, {
        time: newTime,
        duration: newDuration,
        velocity: newVel,
      })
    })
  })

  return notes.map(n => {
    const upd = updatedNotesMap.get(n.id)
    return upd ? { ...n, time: upd.time, duration: upd.duration, velocity: upd.velocity } : { ...n }
  })
}

export interface FlamOptions {
  delayTicks?: number       // Ticks between flam and main note (default 12 ticks)
  velocityRatio?: number    // Flam velocity ratio (default 0.65 = 65% of main note)
  flamDuration?: number     // Duration of grace note (default 12 ticks)
}

/**
 * Flam Tool
 * Adds an articulate pre-hit grace note just before each note.
 */
export function applyFlam(notes: Note[], options: FlamOptions = {}): Note[] {
  const delay = options.delayTicks ?? 12
  const velRatio = options.velocityRatio ?? 0.65
  const flamDur = options.flamDuration ?? 12

  const result: Note[] = []

  notes.forEach(note => {
    // Grace note right before
    const flamTime = Math.max(0, note.time - delay)
    const flamVelocity = Math.max(1, Math.min(127, Math.round(note.velocity * velRatio)))

    const flamNote: Note = {
      ...note,
      id: newId(),
      time: flamTime,
      duration: flamDur,
      velocity: flamVelocity,
    }

    result.push(flamNote)
    result.push({ ...note })
  })

  return result
}

/**
 * Glue / Merge Notes (Ctrl+G)
 * Merges adjacent, overlapping, or consecutively selected notes of the same pitch into single sustained notes.
 */
export function applyGlue(notes: Note[], proximityTolerance = 6, bridgeGaps = true): Note[] {
  if (notes.length <= 1) return notes.map(n => ({ ...n }))

  // Group by pitch and trackId
  const groups = new Map<string, Note[]>()
  notes.forEach(note => {
    const key = `${note.trackId}_${note.pitch}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ ...note })
  })

  const mergedNotes: Note[] = []

  groups.forEach(pitchNotes => {
    pitchNotes.sort((a, b) => a.time - b.time)
    let current = pitchNotes[0]

    for (let i = 1; i < pitchNotes.length; i++) {
      const next = pitchNotes[i]
      const currentEnd = current.time + current.duration

      // Check if overlapping, adjacent within tolerance, or explicitly bridging gaps across selected notes
      if (bridgeGaps || next.time <= currentEnd + proximityTolerance) {
        // Merge into current
        const newEnd = Math.max(currentEnd, next.time + next.duration)
        current.duration = newEnd - current.time
        // Average velocity
        current.velocity = Math.round((current.velocity + next.velocity) / 2)
      } else {
        mergedNotes.push(current)
        current = next
      }
    }
    mergedNotes.push(current)
  })

  return mergedNotes
}

/**
 * Dice / Slice Notes at Grid Boundaries
 * Slices every note across the specified grid subdivision intervals.
 */
export function applyDice(notes: Note[], gridTicks: number): Note[] {
  if (gridTicks <= 0) return notes.map(n => ({ ...n }))

  const result: Note[] = []

  notes.forEach(note => {
    const noteStart = note.time
    const noteEnd = note.time + note.duration

    // Find grid lines strictly inside the note (noteStart, noteEnd)
    const firstGrid = Math.ceil((noteStart + 0.001) / gridTicks) * gridTicks
    const splitPoints: number[] = []

    for (let g = firstGrid; g < noteEnd; g += gridTicks) {
      splitPoints.push(g)
    }

    if (splitPoints.length === 0) {
      result.push({ ...note })
      return
    }

    // Generate slices
    let sliceStart = noteStart
    for (const split of splitPoints) {
      result.push({
        ...note,
        id: newId(),
        time: sliceStart,
        duration: split - sliceStart,
      })
      sliceStart = split
    }
    // Final slice
    if (sliceStart < noteEnd) {
      result.push({
        ...note,
        id: newId(),
        time: sliceStart,
        duration: noteEnd - sliceStart,
      })
    }
  })

  return result
}

/**
 * Remove Overlaps / Clean Polyphony
 * Shortens notes of the same pitch so they never overlap subsequent notes.
 */
export function applyRemoveOverlaps(notes: Note[]): Note[] {
  if (notes.length <= 1) return notes.map(n => ({ ...n }))

  const groups = new Map<string, Note[]>()
  notes.forEach(note => {
    const key = `${note.trackId}_${note.pitch}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ ...note })
  })

  const cleaned: Note[] = []

  groups.forEach(pitchNotes => {
    pitchNotes.sort((a, b) => a.time - b.time)
    for (let i = 0; i < pitchNotes.length; i++) {
      const curr = pitchNotes[i]
      const next = pitchNotes[i + 1]

      if (next && curr.time + curr.duration > next.time) {
        curr.duration = Math.max(12, next.time - curr.time)
      }
      cleaned.push(curr)
    }
  })

  return cleaned
}

// ---------------------------------------------------------------------------
// 2. RHYTHMIC CHOPPER & ARPEGGIATOR SUITE (Alt+U & Alt+A)
// ---------------------------------------------------------------------------

export type ChopPattern =
  | '1/4' | '1/8' | '1/16' | '1/32' | '1/64'
  | '1/4t' | '1/8t' | '1/16t' | '1/32t'
  | '1/8d' | '1/16d'
  | 'trapAccelerando' | 'trapDecelerando'

export interface ChopOptions {
  pattern: ChopPattern
  gateRatio?: number // 0.1 to 1.0 (staccato to sustained)
}

const CHOP_TICKS_MAP: Record<string, number> = {
  '1/4': 192,
  '1/8': 96,
  '1/16': 48,
  '1/32': 24,
  '1/64': 12,
  '1/4t': 128,
  '1/8t': 64,
  '1/16t': 32,
  '1/32t': 16,
  '1/8d': 144,
  '1/16d': 72,
}

/**
 * Rhythmic Chopper (Alt+U)
 * Subdivides sustained notes into rhythmic patterns or trap rolls.
 */
export function applyChop(notes: Note[], options: ChopOptions): Note[] {
  const gate = Math.max(0.1, Math.min(1.0, options.gateRatio ?? 1.0))
  const pattern = options.pattern
  const result: Note[] = []

  notes.forEach(note => {
    const totalDuration = note.duration
    if (totalDuration <= 12) {
      result.push({ ...note })
      return
    }

    if (pattern === 'trapAccelerando' || pattern === 'trapDecelerando') {
      // Accelerando: progressive subdivision from slow (96t) to fast (12t)
      const intervals = pattern === 'trapAccelerando'
        ? [96, 48, 24, 12]
        : [12, 24, 48, 96]
      
      let cursor = note.time
      const endTime = note.time + totalDuration
      let intervalIdx = 0

      while (cursor < endTime) {
        const stepWidth = intervals[Math.min(intervalIdx, intervals.length - 1)]
        const sliceDuration = Math.min(stepWidth, endTime - cursor)
        const gatedDuration = Math.max(6, Math.round(sliceDuration * gate))

        result.push({
          ...note,
          id: newId(),
          time: cursor,
          duration: gatedDuration,
        })

        cursor += sliceDuration
        intervalIdx++
      }
      return
    }

    const stepTicks = CHOP_TICKS_MAP[pattern] ?? 48
    const count = Math.floor(totalDuration / stepTicks)
    const remainder = totalDuration % stepTicks

    if (count <= 0) {
      result.push({ ...note })
      return
    }

    for (let i = 0; i < count; i++) {
      const sliceTime = note.time + i * stepTicks
      const gatedDur = Math.max(6, Math.round(stepTicks * gate))
      result.push({
        ...note,
        id: newId(),
        time: sliceTime,
        duration: gatedDur,
      })
    }

    if (remainder >= 12) {
      result.push({
        ...note,
        id: newId(),
        time: note.time + count * stepTicks,
        duration: Math.max(6, Math.round(remainder * gate)),
      })
    }
  })

  return result
}

export type ArpPattern = 'up' | 'down' | 'upDown' | 'downUp' | 'converge' | 'diverge' | 'random'

export interface ArpOptions {
  pattern: ArpPattern
  rateTicks: number     // 48 = 1/16, 24 = 1/32, 96 = 1/8, 32 = 1/16t
  octaves?: number      // 1, 2, or 3
  gateRatio?: number    // 0.2 to 1.0
}

/**
 * Arpeggiator Engine (Alt+A)
 * Converts chord structures into cascading arpeggio melodies.
 */
export function applyArpeggio(notes: Note[], options: ArpOptions): Note[] {
  if (notes.length === 0) return []

  const rate = Math.max(12, options.rateTicks)
  const octaves = Math.max(1, Math.min(3, options.octaves ?? 1))
  const gate = Math.max(0.2, Math.min(1.0, options.gateRatio ?? 0.8))
  const pattern = options.pattern

  // 1. Group notes by time proximity to find chords
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.pitch - b.pitch)
  const chordClusters: Note[][] = []
  let currentCluster: Note[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (Math.abs(curr.time - prev.time) <= 24) {
      currentCluster.push(curr)
    } else {
      chordClusters.push(currentCluster)
      currentCluster = [curr]
    }
  }
  if (currentCluster.length > 0) chordClusters.push(currentCluster)

  const result: Note[] = []

  chordClusters.forEach(cluster => {
    // Unique pitches sorted ascending
    const basePitches = Array.from(new Set(cluster.map(n => n.pitch))).sort((a, b) => a - b)
    if (basePitches.length === 0) return

    // Expand through octaves
    const expandedPitches: number[] = []
    for (let oct = 0; oct < octaves; oct++) {
      basePitches.forEach(p => {
        const pitchWithOct = p + oct * 12
        if (pitchWithOct <= 127) expandedPitches.push(pitchWithOct)
      })
    }

    // Build pattern cycle
    let sequence: number[] = []
    if (pattern === 'up') {
      sequence = [...expandedPitches]
    } else if (pattern === 'down') {
      sequence = [...expandedPitches].reverse()
    } else if (pattern === 'upDown') {
      sequence = [...expandedPitches, ...expandedPitches.slice(1, -1).reverse()]
    } else if (pattern === 'downUp') {
      const rev = [...expandedPitches].reverse()
      sequence = [...rev, ...rev.slice(1, -1).reverse()]
    } else if (pattern === 'converge') {
      // Alternates lowest, highest, 2nd lowest, 2nd highest...
      const copy = [...expandedPitches]
      while (copy.length > 0) {
        sequence.push(copy.shift()!)
        if (copy.length > 0) sequence.push(copy.pop()!)
      }
    } else if (pattern === 'diverge') {
      // Middle outward
      const copy = [...expandedPitches]
      const mid = Math.floor(copy.length / 2)
      sequence.push(copy[mid])
      let left = mid - 1
      let right = mid + 1
      while (left >= 0 || right < copy.length) {
        if (left >= 0) sequence.push(copy[left--])
        if (right < copy.length) sequence.push(copy[right++])
      }
    } else if (pattern === 'random') {
      sequence = [...expandedPitches]
    }

    const clusterStart = Math.min(...cluster.map(n => n.time))
    const clusterEnd = Math.max(...cluster.map(n => n.time + n.duration))
    const totalTicks = clusterEnd - clusterStart
    const stepCount = Math.floor(totalTicks / rate)

    if (stepCount <= 0) {
      cluster.forEach(n => result.push({ ...n }))
      return
    }

    const templateNote = cluster[0]
    const avgVelocity = Math.round(cluster.reduce((sum, n) => sum + n.velocity, 0) / cluster.length)

    for (let step = 0; step < stepCount; step++) {
      let pitch: number
      if (pattern === 'random') {
        pitch = expandedPitches[Math.floor(Math.random() * expandedPitches.length)]
      } else {
        pitch = sequence[step % sequence.length]
      }

      result.push({
        ...templateNote,
        id: newId(),
        time: clusterStart + step * rate,
        duration: Math.max(6, Math.round(rate * gate)),
        pitch,
        velocity: avgVelocity,
      })
    }
  })

  return result
}

// ---------------------------------------------------------------------------
// 3. PITCH, SCALE & HARMONY SUITE
// ---------------------------------------------------------------------------

/**
 * Chromatic Transpose
 * Transposes pitch by semitones (+12, -12, +1, -1, etc.), clamped to MIDI range [0, 127].
 */
export function applyTranspose(notes: Note[], semitones: number): Note[] {
  return notes.map(n => ({
    ...n,
    pitch: Math.max(0, Math.min(127, n.pitch + semitones)),
  }))
}

/**
 * Modal / Diatonic Transpose
 * Moves notes up or down by scale degrees within the active project key & mode.
 */
export function applyModalTranspose(
  notes: Note[],
  degreeOffset: number,
  root: number,
  mode: string,
  customIntervals?: number[]
): Note[] {
  const intervals = mode === 'Custom' && customIntervals ? customIntervals : SCALE_INTERVALS[mode]
  if (!intervals || intervals.length === 0) return applyTranspose(notes, degreeOffset)

  return notes.map(note => {
    // Snap to scale first
    const snapped = snapToScale(note.pitch, root, mode, customIntervals)
    const pc = ((snapped - root) % 12 + 12) % 12
    let degree = intervals.indexOf(pc)
    if (degree === -1) degree = 0

    const targetDegree = degree + degreeOffset
    const octavesToAdd = Math.floor(targetDegree / intervals.length)
    const wrappedDegree = ((targetDegree % intervals.length) + intervals.length) % intervals.length

    const origInterval = intervals[degree]
    const targetInterval = intervals[wrappedDegree]
    const semitonesToAdd = (octavesToAdd * 12) + (targetInterval - origInterval)

    const newPitch = Math.max(0, Math.min(127, snapped + semitonesToAdd))
    return { ...note, pitch: newPitch }
  })
}

/**
 * Force to Scale / Scale Conforming (Key Quantizer)
 * Forces all selected notes to snap to the nearest valid scale degree in the active key.
 */
export function applyForceToScale(
  notes: Note[],
  root: number,
  mode: string,
  customIntervals?: number[]
): Note[] {
  return notes.map(note => ({
    ...note,
    pitch: snapToScale(note.pitch, root, mode, customIntervals),
  }))
}

export type HarmonizeType = 'octaveUp' | 'octaveDown' | 'powerChord' | 'third' | 'fifth' | 'triad' | 'seventh'

/**
 * Harmonizer & Chord Stamper
 * Generates parallel harmonies or full diatonic chords from melodic notes.
 */
export function applyHarmonize(
  notes: Note[],
  type: HarmonizeType,
  root: number,
  mode: string,
  customIntervals?: number[]
): Note[] {
  const intervals = mode === 'Custom' && customIntervals ? customIntervals : SCALE_INTERVALS[mode] || SCALE_INTERVALS['Major']
  const result: Note[] = []

  notes.forEach(note => {
    result.push({ ...note }) // Keep original note

    const basePitch = snapToScale(note.pitch, root, mode, customIntervals)
    const pc = ((basePitch - root) % 12 + 12) % 12
    let degree = intervals.indexOf(pc)
    if (degree === -1) degree = 0

    const getPitchForDegree = (offset: number) => {
      const targetDegree = degree + offset
      const octavesToAdd = Math.floor(targetDegree / intervals.length)
      const wrappedDegree = ((targetDegree % intervals.length) + intervals.length) % intervals.length
      const semitones = (octavesToAdd * 12) + (intervals[wrappedDegree] - intervals[degree])
      return Math.max(0, Math.min(127, basePitch + semitones))
    }

    if (type === 'octaveUp') {
      if (note.pitch + 12 <= 127) {
        result.push({ ...note, id: newId(), pitch: note.pitch + 12, velocity: Math.round(note.velocity * 0.9) })
      }
    } else if (type === 'octaveDown') {
      if (note.pitch - 12 >= 0) {
        result.push({ ...note, id: newId(), pitch: note.pitch - 12, velocity: Math.round(note.velocity * 0.9) })
      }
    } else if (type === 'powerChord') {
      if (note.pitch + 7 <= 127) {
        result.push({ ...note, id: newId(), pitch: note.pitch + 7, velocity: Math.round(note.velocity * 0.85) })
      }
      if (note.pitch + 12 <= 127) {
        result.push({ ...note, id: newId(), pitch: note.pitch + 12, velocity: Math.round(note.velocity * 0.75) })
      }
    } else if (type === 'third') {
      const p3 = getPitchForDegree(2)
      result.push({ ...note, id: newId(), pitch: p3, velocity: Math.round(note.velocity * 0.85) })
    } else if (type === 'fifth') {
      const p5 = getPitchForDegree(4)
      result.push({ ...note, id: newId(), pitch: p5, velocity: Math.round(note.velocity * 0.85) })
    } else if (type === 'triad') {
      const p3 = getPitchForDegree(2)
      const p5 = getPitchForDegree(4)
      result.push({ ...note, id: newId(), pitch: p3, velocity: Math.round(note.velocity * 0.85) })
      result.push({ ...note, id: newId(), pitch: p5, velocity: Math.round(note.velocity * 0.80) })
    } else if (type === 'seventh') {
      const p3 = getPitchForDegree(2)
      const p5 = getPitchForDegree(4)
      const p7 = getPitchForDegree(6)
      result.push({ ...note, id: newId(), pitch: p3, velocity: Math.round(note.velocity * 0.85) })
      result.push({ ...note, id: newId(), pitch: p5, velocity: Math.round(note.velocity * 0.80) })
      result.push({ ...note, id: newId(), pitch: p7, velocity: Math.round(note.velocity * 0.75) })
    }
  })

  return result
}

/**
 * Chord Inversion (Up / Down)
 * Inverts polyphonic chords: Invert Up transposes lowest note +12; Invert Down transposes highest note -12.
 */
export function applyChordInversion(notes: Note[], direction: 'up' | 'down'): Note[] {
  if (notes.length <= 1) return notes.map(n => ({ ...n }))

  const sorted = [...notes].sort((a, b) => a.time - b.time || a.pitch - b.pitch)
  const chordClusters: Note[][] = []
  let currentCluster: Note[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (Math.abs(curr.time - prev.time) <= 24) {
      currentCluster.push(curr)
    } else {
      chordClusters.push(currentCluster)
      currentCluster = [curr]
    }
  }
  if (currentCluster.length > 0) chordClusters.push(currentCluster)

  const updatedNotesMap = new Map<string, number>()

  chordClusters.forEach(cluster => {
    if (cluster.length <= 1) return
    if (direction === 'up') {
      // Find lowest pitch
      const lowest = [...cluster].sort((a, b) => a.pitch - b.pitch)[0]
      if (lowest && lowest.pitch + 12 <= 127) {
        updatedNotesMap.set(lowest.id, lowest.pitch + 12)
      }
    } else {
      // Find highest pitch
      const highest = [...cluster].sort((a, b) => b.pitch - a.pitch)[0]
      if (highest && highest.pitch - 12 >= 0) {
        updatedNotesMap.set(highest.id, highest.pitch - 12)
      }
    }
  })

  return notes.map(n => {
    const newPitch = updatedNotesMap.get(n.id)
    return newPitch !== undefined ? { ...n, pitch: newPitch } : { ...n }
  })
}

// ---------------------------------------------------------------------------
// 4. TRANSFORMATIONS & GEOMETRY (Alt+Y)
// ---------------------------------------------------------------------------

/**
 * Flip Horizontal (Time Reverse / Retrograde)
 * Reverses notes in time across the bounding box of the selection.
 */
export function applyFlipHorizontal(notes: Note[]): Note[] {
  if (notes.length <= 1) return notes.map(n => ({ ...n }))

  const minTime = Math.min(...notes.map(n => n.time))
  const maxEndTime = Math.max(...notes.map(n => n.time + n.duration))

  return notes.map(n => {
    const noteEnd = n.time + n.duration
    // Inverted time formula: minTime + (maxEndTime - noteEnd)
    const newTime = minTime + (maxEndTime - noteEnd)
    return {
      ...n,
      time: Math.max(0, Math.round(newTime)),
    }
  })
}

/**
 * Flip Vertical (Pitch Invert)
 * Inverts melody pitches across the center axis / median pitch.
 */
export function applyFlipVertical(
  notes: Note[],
  snapOptions?: { root: number; mode: string; customIntervals?: number[] }
): Note[] {
  if (notes.length === 0) return []

  const pitches = notes.map(n => n.pitch)
  const minPitch = Math.min(...pitches)
  const maxPitch = Math.max(...pitches)
  const centerPitch = (minPitch + maxPitch) / 2

  return notes.map(n => {
    let inverted = Math.round(2 * centerPitch - n.pitch)
    inverted = Math.max(0, Math.min(127, inverted))

    if (snapOptions) {
      inverted = snapToScale(inverted, snapOptions.root, snapOptions.mode, snapOptions.customIntervals)
    }

    return {
      ...n,
      pitch: inverted,
    }
  })
}

/**
 * Time Stretch / Speed
 * Scales note timing and durations by factor (e.g. 0.5 = double speed, 2.0 = half speed).
 */
export function applyTimeStretch(notes: Note[], factor: number): Note[] {
  if (notes.length === 0 || factor <= 0) return notes.map(n => ({ ...n }))

  const minTime = Math.min(...notes.map(n => n.time))

  return notes.map(n => {
    const offset = n.time - minTime
    const newOffset = Math.round(offset * factor)
    const newDur = Math.max(6, Math.round(n.duration * factor))

    return {
      ...n,
      time: minTime + newOffset,
      duration: newDur,
    }
  })
}

// ---------------------------------------------------------------------------
// 5. VELOCITY & DYNAMICS SUITE
// ---------------------------------------------------------------------------

export type VelocityCurve = 'linear' | 'exponential' | 'logarithmic' | 'sCurve'

export interface VelocityRampOptions {
  startVelocity: number // 1 to 127
  endVelocity: number   // 1 to 127
  curve?: VelocityCurve
}

/**
 * Velocity Ramp (Crescendo / Decrescendo)
 * Ramps velocity smoothly across the chronological duration of the selection.
 */
export function applyVelocityRamp(notes: Note[], options: VelocityRampOptions): Note[] {
  if (notes.length === 0) return []

  const startVel = Math.max(1, Math.min(127, options.startVelocity))
  const endVel = Math.max(1, Math.min(127, options.endVelocity))
  const curve = options.curve ?? 'linear'

  const minTime = Math.min(...notes.map(n => n.time))
  const maxTime = Math.max(...notes.map(n => n.time))
  const timeSpan = maxTime - minTime

  return notes.map(n => {
    const t = timeSpan > 0 ? (n.time - minTime) / timeSpan : 0.5
    let curvedT = t

    if (curve === 'exponential') {
      curvedT = Math.pow(t, 2)
    } else if (curve === 'logarithmic') {
      curvedT = Math.sqrt(t)
    } else if (curve === 'sCurve') {
      // Smoothstep 3t^2 - 2t^3
      curvedT = t * t * (3 - 2 * t)
    }

    const calculatedVel = Math.round(startVel + curvedT * (endVel - startVel))
    return {
      ...n,
      velocity: Math.max(1, Math.min(127, calculatedVel)),
      velocityInspectorModified: true,
    }
  })
}

/**
 * Velocity Compressor / Expander
 * Compresses velocity dynamic range towards a target or expands it.
 */
export function applyVelocityCompress(notes: Note[], targetVelocity = 85, ratio = 0.5): Note[] {
  return notes.map(n => {
    // Delta from target compressed by ratio
    const delta = n.velocity - targetVelocity
    const newVel = Math.round(targetVelocity + delta * (1 - ratio))
    return {
      ...n,
      velocity: Math.max(1, Math.min(127, newVel)),
      velocityInspectorModified: true,
    }
  })
}

/**
 * Velocity Normalizer
 * Scales peak velocity to maximum (or peakTarget) while preserving relative dynamic balance.
 */
export function applyVelocityNormalize(notes: Note[], peakTarget = 127): Note[] {
  if (notes.length === 0) return []

  const maxVel = Math.max(...notes.map(n => n.velocity))
  if (maxVel <= 0) return notes.map(n => ({ ...n }))

  const factor = peakTarget / maxVel

  return notes.map(n => ({
    ...n,
    velocity: Math.max(1, Math.min(127, Math.round(n.velocity * factor))),
    velocityInspectorModified: true,
  }))
}

/**
 * Set Fixed Velocity
 */
export function applyFixedVelocity(notes: Note[], velocity: number): Note[] {
  const vel = Math.max(1, Math.min(127, velocity))
  return notes.map(n => ({
    ...n,
    velocity: vel,
    velocityInspectorModified: true,
  }))
}

// ---------------------------------------------------------------------------
// 6. HUMANIZE & RANDOMIZE (Alt+R)
// ---------------------------------------------------------------------------

export interface HumanizeOptions {
  timingJitterTicks?: number    // ± ticks offset (e.g. 0 to 24)
  velocityJitterPercent?: number // ± % velocity jitter (e.g. 0 to 35%)
  durationJitterPercent?: number // ± % duration variation (e.g. 0 to 25%)
  pitchJitterSemis?: number     // ± semitones jitter (0 to 2)
  scaleLock?: { root: number; mode: string; customIntervals?: number[] }
}

/**
 * Signature Expressive Humanizer (Alt+R)
 * Adds realistic natural variations to timing, velocity, duration, and pitch.
 */
export function applyHumanize(notes: Note[], options: HumanizeOptions = {}): Note[] {
  const timingJitter = options.timingJitterTicks ?? 8
  const velJitter = (options.velocityJitterPercent ?? 15) / 100
  const durJitter = (options.durationJitterPercent ?? 10) / 100
  const pitchJitter = options.pitchJitterSemis ?? 0

  return notes.map(note => {
    // Timing offset
    const timeDelta = timingJitter > 0
      ? Math.round((Math.random() * 2 - 1) * timingJitter)
      : 0
    const newTime = Math.max(0, note.time + timeDelta)

    // Velocity offset
    const velMultiplier = 1 + (Math.random() * 2 - 1) * velJitter
    const newVel = Math.max(1, Math.min(127, Math.round(note.velocity * velMultiplier)))

    // Duration variation
    const durMultiplier = 1 + (Math.random() * 2 - 1) * durJitter
    const newDur = Math.max(12, Math.round(note.duration * durMultiplier))

    // Pitch jitter
    let newPitch = note.pitch
    if (pitchJitter > 0 && Math.random() < 0.25) {
      const pDelta = Math.round((Math.random() * 2 - 1) * pitchJitter)
      newPitch = Math.max(0, Math.min(127, note.pitch + pDelta))
      if (options.scaleLock) {
        newPitch = snapToScale(newPitch, options.scaleLock.root, options.scaleLock.mode, options.scaleLock.customIntervals)
      }
    }

    return {
      ...note,
      time: newTime,
      velocity: newVel,
      duration: newDur,
      pitch: newPitch,
      velocityInspectorModified: true,
    }
  })
}

// ---------------------------------------------------------------------------
// 7. SELECTION, VOICE EXTRACTION & FILTER TOOLS
// ---------------------------------------------------------------------------

/**
 * Filter Odd / Even Notes
 * Returns note IDs for odd or even chronological occurrences (useful for hi-hat accenting).
 */
export function filterOddEvenNotes(notes: Note[], parity: 'odd' | 'even'): string[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.pitch - b.pitch)
  return sorted
    .filter((_, idx) => parity === 'odd' ? idx % 2 === 0 : idx % 2 === 1)
    .map(n => n.id)
}

/**
 * Extract Voice: Top-Line (Lead Melody) or Bottom-Line (Bassline)
 * At each distinct time point, identifies either the highest or lowest pitch.
 */
export function filterVoiceNotes(notes: Note[], voice: 'top' | 'bottom'): string[] {
  if (notes.length === 0) return []

  // Group by time cluster (proximity <= 24 ticks)
  const sorted = [...notes].sort((a, b) => a.time - b.time)
  const clusters: Note[][] = []
  let currCluster: Note[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (Math.abs(curr.time - prev.time) <= 24) {
      currCluster.push(curr)
    } else {
      clusters.push(currCluster)
      currCluster = [curr]
    }
  }
  if (currCluster.length > 0) clusters.push(currCluster)

  const selectedIds: string[] = []

  clusters.forEach(cluster => {
    if (cluster.length === 0) return
    const sortedPitches = [...cluster].sort((a, b) => a.pitch - b.pitch)
    const target = voice === 'top'
      ? sortedPitches[sortedPitches.length - 1] // Highest note
      : sortedPitches[0] // Lowest note
    selectedIds.push(target.id)
  })

  return selectedIds
}

/**
 * Purge Micro-Notes
 * Removes spurious short notes below the specified tick threshold.
 */
export function applyPurgeShortNotes(notes: Note[], minTicks = 12): Note[] {
  return notes.filter(n => n.duration >= minTicks)
}

/**
 * Rhythmic Ratchet / Rolls
 * Subdivides each note into N equal sub-slices with optional velocity profile:
 * - 'flat': all slices retain base velocity
 * - 'crescendo': ramp from 0.55x to 1.1x
 * - 'decrescendo': decay from 1.0x to 0.45x
 */
export function applyRatchet(
  notes: Note[],
  slices: number,
  velocityProfile: 'flat' | 'crescendo' | 'decrescendo' = 'flat'
): Note[] {
  if (notes.length === 0 || slices <= 1) return notes.map(n => ({ ...n }))

  const result: Note[] = []

  notes.forEach(note => {
    const sliceDuration = Math.max(1, Math.floor(note.duration / slices))
    for (let i = 0; i < slices; i++) {
      let vel = note.velocity
      if (velocityProfile === 'crescendo') {
        const ratio = slices > 1 ? i / (slices - 1) : 1
        vel = Math.round(note.velocity * (0.55 + 0.55 * ratio))
      } else if (velocityProfile === 'decrescendo') {
        const ratio = slices > 1 ? i / (slices - 1) : 0
        vel = Math.round(note.velocity * (1.0 - 0.55 * ratio))
      }
      vel = Math.max(1, Math.min(127, vel))

      result.push({
        ...note,
        id: newId(),
        time: note.time + i * sliceDuration,
        duration: sliceDuration,
        velocity: vel,
      })
    }
  })

  return result
}

/**
 * Micro-Nudge
 * Shifts notes forward or backward by small tick amounts for sub-grid pocketing.
 */
export function applyMicroNudge(notes: Note[], ticks: number): Note[] {
  if (notes.length === 0 || ticks === 0) return notes.map(n => ({ ...n }))
  return notes.map(n => ({
    ...n,
    time: Math.max(0, n.time + ticks),
  }))
}

// ---------------------------------------------------------------------------
// 8. MULTI-NOTE GLIDE CHAIN & MATHEMATICAL GLISSANDO
// ---------------------------------------------------------------------------

export type GlideCurveType =
  | 'cubicInOut'
  | 'cubicIn'
  | 'cubicOut'
  | 'linear'
  | 'exponential'
  | 'logarithmic'
  | 'sigmoid'
  | 'custom'

export type GlideOrderType =
  | 'time'
  | 'reverseTime'
  | 'pitchAscending'
  | 'pitchDescending'

export type GlideDurationMode =
  | 'full'
  | 'threeQuarters'
  | 'half'
  | 'fixed'

export interface GlideChainOptions {
  order?: GlideOrderType
  curve?: GlideCurveType
  customEquation?: string
  durationMode?: GlideDurationMode
  fixedTicks?: number
  extendLegato?: boolean
  loopLastNote?: boolean
  /** Which instrument carries the ramp: the note that starts it, or the note it lands on. */
  glideVoice?: 'source' | 'destination' | 'morph'
}

/**
 * Playback-time description of a glide that is carried by the destination note.
 * Derived from the source link so editing either note's pitch stays in sync.
 */
export interface GlideIntoSpec {
  sourceId: string
  startPitch: number
  slideTicks: number
  ramp?: Note['pitchSlideRamp']
  customCurve?: string
  glideStyle?: Note['glideStyle']
  /** Both instruments overlap: the destination fades in while the source fades out. */
  morph?: boolean
}

export function buildGlideIntoMap(notes: Note[]): Map<string, GlideIntoSpec> {
  const into = new Map<string, GlideIntoSpec>()
  for (const source of notes) {
    if ((source.glideVoice !== 'destination' && source.glideVoice !== 'morph') || !source.glideToNoteId) continue
    const slideTicks = source.pitchSlideTime ?? source.duration
    if (!(slideTicks > 0)) continue
    into.set(source.glideToNoteId, {
      sourceId: source.id,
      startPitch: source.pitch,
      slideTicks,
      ramp: source.pitchSlideRamp,
      customCurve: source.pitchSlideCustomCurve,
      glideStyle: source.glideStyle,
      morph: source.glideVoice === 'morph',
    })
  }
  return into
}

/** Playback-only fields derived from a glide link or automation lane. Never written back to the store. */
export interface GlidePlaybackNote extends Note {
  /** Morph crossfade in ticks, measured from note start. */
  morphFadeIn?: number
  /** Morph crossfade out in ticks, measured from note start. */
  morphFadeOut?: number
  /** Per-note volume from the volume automation lane (0..1). */
  automationGain?: number
}

export interface GlidePlaybackShape {
  startTick: number
  durationTicks: number
  pitch: number
  note: GlidePlaybackNote
}

/**
 * Turns a stored note into what playback should trigger. A destination-voiced link starts
 * the landed note early at the source pitch; its source is silenced for the ramp. A morph
 * link keeps both voices: the source ramps and fades out, the destination starts early and
 * fades in.
 */
export function resolveGlidePlayback(n: Note, glideInto?: GlideIntoSpec): GlidePlaybackShape {
  if (glideInto) {
    return {
      startTick: Math.max(0, n.time - glideInto.slideTicks),
      durationTicks: n.duration + glideInto.slideTicks,
      pitch: glideInto.startPitch,
      note: {
        ...n,
        pitchSlide: n.pitch - glideInto.startPitch,
        pitchSlideTime: glideInto.slideTicks,
        pitchSlideRamp: glideInto.ramp,
        pitchSlideCustomCurve: glideInto.customCurve,
        glideStyle: glideInto.glideStyle ?? n.glideStyle,
        glideVoice: undefined,
        morphFadeIn: glideInto.morph ? glideInto.slideTicks : undefined,
      },
    }
  }

  if (n.glideVoice === 'destination') {
    return {
      startTick: n.time,
      durationTicks: n.duration,
      pitch: n.pitch,
      note: {
        ...n,
        pitchSlide: undefined,
        pitchSlideTime: undefined,
        pitchSlideRamp: undefined,
        pitchSlideCustomCurve: undefined,
      },
    }
  }

  if (n.glideVoice === 'morph' && n.glideToNoteId) {
    // The source keeps its own ramp and must stay alive for it; it fades out across the slide.
    const fadeTicks = n.pitchSlideTime ?? n.duration
    return {
      startTick: n.time,
      durationTicks: Math.max(n.duration, fadeTicks),
      pitch: n.pitch,
      note: { ...n, morphFadeOut: fadeTicks },
    }
  }

  return { startTick: n.time, durationTicks: n.duration, pitch: n.pitch, note: n }
}

/**
 * Multi-Note Glide Chain
 * Connects any number of notes in any order with custom mathematical pitch glide curves (Cubic, Sigmoid, etc.).
 */
export function applyGlideChain(notes: Note[], options: GlideChainOptions = {}): Note[] {
  if (notes.length < 2) return notes.map(n => ({ ...n }))

  const order = options.order || 'time'
  const curve = options.curve || 'cubicInOut'
  const durationMode = options.durationMode || 'full'
  const extendLegato = options.extendLegato ?? true
  const loopLastNote = options.loopLastNote ?? false
  const glideVoice = options.glideVoice ?? 'source'

  // Sort notes according to the chosen order
  const ordered = [...notes].sort((a, b) => {
    if (order === 'time') return a.time - b.time || a.pitch - b.pitch
    if (order === 'reverseTime') return b.time - a.time || b.pitch - a.pitch
    if (order === 'pitchAscending') return a.pitch - b.pitch || a.time - b.time
    if (order === 'pitchDescending') return b.pitch - a.pitch || a.time - b.time
    return 0
  })

  // Map curve type to ramp and equation
  let rampType: 'linear' | 'exponential' | 'logarithmic' | 'sigmoid' | 'custom' = 'linear'
  let customCurve: string | undefined = undefined

  if (curve === 'linear') {
    rampType = 'linear'
  } else if (curve === 'exponential') {
    rampType = 'exponential'
  } else if (curve === 'logarithmic') {
    rampType = 'logarithmic'
  } else if (curve === 'sigmoid') {
    rampType = 'sigmoid'
  } else if (curve === 'cubicIn') {
    rampType = 'custom'
    customCurve = 't * t * t'
  } else if (curve === 'cubicOut') {
    rampType = 'custom'
    customCurve = '1 - Math.pow(1 - t, 3)'
  } else if (curve === 'cubicInOut') {
    rampType = 'custom'
    customCurve = 't < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2'
  } else if (curve === 'custom') {
    rampType = 'custom'
    customCurve = (options.customEquation && options.customEquation.trim()) ? options.customEquation.trim() : 't * t * t'
  }

  // Create a map for fast lookup of modified notes by ID
  const modifiedMap = new Map<string, Note>()

  for (let i = 0; i < ordered.length; i++) {
    const current = { ...ordered[i] }
    const hasNext = i < ordered.length - 1
    const target = hasNext ? ordered[i + 1] : (loopLastNote ? ordered[0] : null)

    if (target) {
      // Calculate semitone delta
      const semitones = target.pitch - current.pitch

      // Auto-extend duration if legato is enabled and target starts after current.
      // A destination-voice glide must not stretch the source: the next note's own
      // voice starts early instead.
      if (extendLegato && glideVoice === 'source' && target.time > current.time) {
        current.duration = Math.max(current.duration, target.time - current.time)
      }

      // Calculate slide duration in ticks
      let slideTicks = current.duration
      if (durationMode === 'threeQuarters') {
        slideTicks = Math.max(12, Math.round(current.duration * 0.75))
      } else if (durationMode === 'half') {
        slideTicks = Math.max(12, Math.round(current.duration * 0.5))
      } else if (durationMode === 'fixed') {
        slideTicks = Math.min(current.duration, options.fixedTicks || 48)
      }

      current.pitchSlide = semitones
      current.pitchSlideTime = slideTicks
      current.pitchSlideRamp = rampType
      current.glideToNoteId = target.id
      current.glideVoice = glideVoice === 'source' ? undefined : glideVoice
      if (customCurve) {
        current.pitchSlideCustomCurve = customCurve
      } else {
        current.pitchSlideCustomCurve = undefined
      }
    } else {
      // Final note stationary
      current.pitchSlide = undefined
      current.pitchSlideTime = undefined
      current.pitchSlideRamp = undefined
      current.pitchSlideCustomCurve = undefined
      current.glideToNoteId = undefined
      current.glideVoice = undefined
    }

    modifiedMap.set(current.id, current)
  }

  // Preserve the original order of the input array so other UI elements don't jump
  return notes.map(n => modifiedMap.get(n.id) || { ...n })
}

/**
 * Clear all pitch glides from notes
 */
export function clearNoteGlides(notes: Note[]): Note[] {
  return notes.map(n => ({
    ...n,
    pitchSlide: undefined,
    pitchSlideTime: undefined,
    pitchSlideRamp: undefined,
    pitchSlideCustomCurve: undefined,
    glideToNoteId: undefined,
    glideVoice: undefined,
  }))
}

export const noteHasGlide = (n: Note) =>
  n.glideToNoteId !== undefined || n.glideVoice !== undefined || n.pitchSlide !== undefined

/** Notes a glide unlink would rewrite: the selection plus sources linking into it. */
function notesTouchingGlides(notes: Note[], ids: Set<string>): Note[] {
  if (ids.size === 0) return []
  return notes.filter(n =>
    noteHasGlide(n) && (ids.has(n.id) || (n.glideToNoteId !== undefined && ids.has(n.glideToNoteId)))
  )
}

export function countLinkedGlides(notes: Note[], selectedIds: Iterable<string>): number {
  return notesTouchingGlides(notes, new Set(selectedIds)).length
}

/**
 * Remove every glide touching a selection: the selected notes' own slides and links,
 * plus links from unselected notes that land on one, so no connector is left dangling.
 */
export function unlinkGlides(notes: Note[], selectedIds: Iterable<string>): { notes: Note[]; cleared: number } {
  const ids = new Set(selectedIds)
  if (ids.size === 0) return { notes, cleared: 0 }

  const touched = notesTouchingGlides(notes, ids)
  if (touched.length === 0) return { notes, cleared: 0 }

  const clearedById = new Map(clearNoteGlides(touched).map(n => [n.id, n]))
  return { notes: notes.map(n => clearedById.get(n.id) ?? n), cleared: touched.length }
}

