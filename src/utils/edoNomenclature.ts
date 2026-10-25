/**
 * MuseGrid EDO Nomenclature and Tuning Geometry Engine
 * Provides authentic musicological labels, interval degrees, and visual styling
 * for microtonal Equal Divisions of the Octave (19, 24, 31, 47, 53, and Custom N-EDO).
 */

export interface EdoStepInfo {
  label: string         // Short label for piano roll key (e.g. "C4", "D4 [9]", "+4c", "C𝄰")
  fullLabel: string     // Full musicological title (e.g. "C4 [0]", "Yegah (D4)", "Bakiyye (+4c)")
  isRoot: boolean       // True if octave C or track root note (accent cyan)
  isNatural: boolean    // True if diatonic natural pitch (C, D, E, F, G, A, B)
  isPrimaryDegree: boolean // True for important modal degrees / perdes
  stepInOctave: number  // 0 to N-1
  octave: number        // Standard scientific octave number
  cents: number         // Cents deviation from nearest 12-TET semitone
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// 19-EDO note names in ascending order
const EDO_19_NAMES = [
  'C', 'C#', 'D♭', 'D', 'D#', 'E♭', 'E', 'E#',
  'F', 'F#', 'G♭', 'G', 'G#', 'A♭', 'A', 'A#', 'B♭', 'B', 'B#'
]
const EDO_19_NATURALS = new Set([0, 3, 6, 8, 11, 14, 17]) // C, D, E, F, G, A, B

// 24-EDO Quarter-Tone names in ascending order
const EDO_24_NAMES = [
  'C', 'C+¼', 'C#', 'D-¼', 'D', 'D+¼', 'D#', 'E-¼',
  'E', 'E+¼', 'F', 'F+¼', 'F#', 'G-¼', 'G', 'G+¼',
  'G#', 'A-¼', 'A', 'A+¼', 'A#', 'B-¼', 'B', 'B+¼'
]
const EDO_24_NATURALS = new Set([0, 4, 8, 10, 14, 18, 22]) // C, D, E, F, G, A, B

// 31-EDO Huygens Meantone names in ascending order
const EDO_31_NAMES = [
  'C', 'C+', 'C#', 'D♭', 'D-', 'D', 'D+', 'D#', 'E♭', 'E-',
  'E', 'E+', 'F', 'F+', 'F#', 'G♭', 'G-', 'G', 'G+', 'G#',
  'A♭', 'A-', 'A', 'A+', 'A#', 'B♭', 'B-', 'B', 'B+', 'C-', 'C--'
]
const EDO_31_NATURALS = new Set([0, 5, 10, 12, 17, 22, 27]) // C, D, E, F, G, A, B

// 53-EDO Turkish Classical Makam (Holderian Commas: 9-9-4-9-9-9-4)
// Maps step k (0..52) to Turkish perde & comma information
const TURKISH_53_MAP: Record<number, { label: string; full: string; isNatural: boolean; isPrimary: boolean }> = {
  0: { label: 'C', full: 'Çargah (C)', isNatural: true, isPrimary: true },
  1: { label: '+1c', full: '1 Comma', isNatural: false, isPrimary: false },
  2: { label: '+2c', full: '2 Commas', isNatural: false, isPrimary: false },
  3: { label: '+3c', full: '3 Commas', isNatural: false, isPrimary: false },
  4: { label: 'Bakiyye', full: 'Nim Hicaz (Bakiyye 4c)', isNatural: false, isPrimary: true },
  5: { label: 'C#', full: 'Hicaz (K.Mücenneb 5c)', isNatural: false, isPrimary: true },
  6: { label: '+6c', full: '6 Commas', isNatural: false, isPrimary: false },
  7: { label: '+7c', full: '7 Commas', isNatural: false, isPrimary: false },
  8: { label: 'D♭', full: 'Dik Hicaz (B.Mücenneb 8c)', isNatural: false, isPrimary: true },
  9: { label: 'D', full: 'Yegah (D)', isNatural: true, isPrimary: true },
  10: { label: '+1c', full: '10 Commas', isNatural: false, isPrimary: false },
  11: { label: '+2c', full: '11 Commas', isNatural: false, isPrimary: false },
  12: { label: '+3c', full: '12 Commas', isNatural: false, isPrimary: false },
  13: { label: 'Nim Hisar', full: 'Nim Hisar (Bakiyye 13c)', isNatural: false, isPrimary: true },
  14: { label: 'D#', full: 'Hisar (K.Mücenneb 14c)', isNatural: false, isPrimary: true },
  15: { label: '+15c', full: '15 Commas', isNatural: false, isPrimary: false },
  16: { label: '+16c', full: '16 Commas', isNatural: false, isPrimary: false },
  17: { label: 'E♭', full: 'Dik Hisar (B.Mücenneb 17c)', isNatural: false, isPrimary: true },
  18: { label: 'E', full: 'Hüseyni Aşiran (E)', isNatural: true, isPrimary: true },
  19: { label: '+1c', full: '19 Commas', isNatural: false, isPrimary: false },
  20: { label: '+2c', full: '20 Commas', isNatural: false, isPrimary: false },
  21: { label: '+3c', full: '21 Commas', isNatural: false, isPrimary: false },
  22: { label: 'F', full: 'Acem Aşiran (F)', isNatural: true, isPrimary: true },
  23: { label: '+1c', full: '23 Commas', isNatural: false, isPrimary: false },
  24: { label: '+2c', full: '24 Commas', isNatural: false, isPrimary: false },
  25: { label: '+3c', full: '25 Commas', isNatural: false, isPrimary: false },
  26: { label: 'Irak', full: 'Irak (Bakiyye 26c)', isNatural: false, isPrimary: true },
  27: { label: 'F#', full: 'Geveşt (K.Mücenneb 27c)', isNatural: false, isPrimary: true },
  28: { label: '+28c', full: '28 Commas', isNatural: false, isPrimary: false },
  29: { label: '+29c', full: '29 Commas', isNatural: false, isPrimary: false },
  30: { label: 'G♭', full: 'Dik Geveşt (B.Mücenneb 30c)', isNatural: false, isPrimary: true },
  31: { label: 'G', full: 'Rast (G)', isNatural: true, isPrimary: true },
  32: { label: '+1c', full: '32 Commas', isNatural: false, isPrimary: false },
  33: { label: '+2c', full: '33 Commas', isNatural: false, isPrimary: false },
  34: { label: '+3c', full: '34 Commas', isNatural: false, isPrimary: false },
  35: { label: 'Nim Zirg.', full: 'Nim Zirgüle (Bakiyye 35c)', isNatural: false, isPrimary: true },
  36: { label: 'G#', full: 'Zirgüle (K.Mücenneb 36c)', isNatural: false, isPrimary: true },
  37: { label: '+37c', full: '37 Commas', isNatural: false, isPrimary: false },
  38: { label: '+38c', full: '38 Commas', isNatural: false, isPrimary: false },
  39: { label: 'A♭', full: 'Dik Zirgüle (B.Mücenneb 39c)', isNatural: false, isPrimary: true },
  40: { label: 'A', full: 'Dügah (A)', isNatural: true, isPrimary: true },
  41: { label: '+1c', full: '41 Commas', isNatural: false, isPrimary: false },
  42: { label: '+2c', full: '42 Commas', isNatural: false, isPrimary: false },
  43: { label: '+3c', full: '43 Commas', isNatural: false, isPrimary: false },
  44: { label: 'Kürdi', full: 'Kürdi (Bakiyye 44c)', isNatural: false, isPrimary: true },
  45: { label: 'Segah', full: 'Segah (B-flat / 45c)', isNatural: false, isPrimary: true },
  46: { label: '+46c', full: '46 Commas', isNatural: false, isPrimary: false },
  47: { label: '+47c', full: '47 Commas', isNatural: false, isPrimary: false },
  48: { label: 'B♭', full: 'Dik Segah (B.Mücenneb 48c)', isNatural: false, isPrimary: true },
  49: { label: 'B', full: 'Buselik (B)', isNatural: true, isPrimary: true },
  50: { label: '+1c', full: '50 Commas', isNatural: false, isPrimary: false },
  51: { label: '+2c', full: '51 Commas', isNatural: false, isPrimary: false },
  52: { label: '+3c', full: '52 Commas', isNatural: false, isPrimary: false }
}

/**
 * Returns complete nomenclature and classification for a microtonal pitch in N-EDO.
 */
export function getEdoStepInfo(
  pitch: number,
  edo: number,
  rootNote = 60,
  preset?: string
): EdoStepInfo {
  const stepSize = 12 / edo
  const cleanPitch = Math.round(pitch * 100000) / 100000
  const stepFromRoot = Math.round((cleanPitch - rootNote) / stepSize)
  const stepInOctave = ((stepFromRoot % edo) + edo) % edo
  const isRoot = stepInOctave === 0

  // Calculate approximate scientific octave with 0.001 epsilon to avoid float rounding errors (e.g. 59.99999 flooring into octave 3)
  const octave = Math.floor((cleanPitch + 0.001) / 12) - 1

  // Nearest 12-TET semitone and cents difference
  const nearestMidi = Math.round(cleanPitch)
  const cents = Math.round((cleanPitch - nearestMidi) * 100)
  const nearestNote = NOTE_NAMES[((nearestMidi % 12) + 12) % 12]

  // 1. 53-EDO: Turkish Classical Makam Nomenclature
  if (edo === 53 || preset === '53-edo') {
    const entry = TURKISH_53_MAP[stepInOctave] || {
      label: `\\${stepInOctave}`,
      full: `Step ${stepInOctave}`,
      isNatural: false,
      isPrimary: false
    }
    const labelWithOctave = entry.isNatural
      ? `${entry.label}${octave} [${stepInOctave}]`
      : entry.isPrimary
      ? `${entry.label} [${stepInOctave}]`
      : `\\${stepInOctave}`

    return {
      label: labelWithOctave,
      fullLabel: `${entry.full} (Oct ${octave})`,
      isRoot,
      isNatural: entry.isNatural,
      isPrimaryDegree: entry.isPrimary,
      stepInOctave,
      octave,
      cents
    }
  }

  // 2. 24-EDO: Arabic Quarter-Tone Nomenclature
  if (edo === 24 || preset === '24-edo') {
    const name = EDO_24_NAMES[stepInOctave] || `¼${stepInOctave}`
    const isNat = EDO_24_NATURALS.has(stepInOctave)
    const isQuarter = name.includes('+¼') || name.includes('-¼')
    const formatted = isNat ? `${name}${octave}` : name

    return {
      label: formatted,
      fullLabel: `${formatted} [${stepInOctave}/24]`,
      isRoot,
      isNatural: isNat,
      isPrimaryDegree: isNat || isQuarter,
      stepInOctave,
      octave,
      cents
    }
  }

  // 3. 19-EDO: Separate Sharps & Flats Nomenclature
  if (edo === 19 || preset === '19-edo') {
    const name = EDO_19_NAMES[stepInOctave] || `19\\${stepInOctave}`
    const isNat = EDO_19_NATURALS.has(stepInOctave)
    const formatted = isNat ? `${name}${octave}` : name

    return {
      label: formatted,
      fullLabel: `${formatted} [${stepInOctave}/19]`,
      isRoot,
      isNatural: isNat,
      isPrimaryDegree: isNat,
      stepInOctave,
      octave,
      cents
    }
  }

  // 4. 31-EDO: Huygens Meantone Nomenclature
  if (edo === 31 || preset === '31-edo') {
    const name = EDO_31_NAMES[stepInOctave] || `31\\${stepInOctave}`
    const isNat = EDO_31_NATURALS.has(stepInOctave)
    const formatted = isNat ? `${name}${octave}` : name

    return {
      label: formatted,
      fullLabel: `${formatted} [${stepInOctave}/31]`,
      isRoot,
      isNatural: isNat,
      isPrimaryDegree: isNat,
      stepInOctave,
      octave,
      cents
    }
  }

  // 5. Generic N-EDO (e.g. 47, 69, 72, etc.)
  const centsText = cents === 0 ? '' : cents > 0 ? `+${cents}¢` : `${cents}¢`
  const isNat = isRoot || (cents === 0 && !nearestNote.includes('#'))
  const label = isRoot
    ? `C${octave} [0]`
    : cents === 0
    ? `${nearestNote}${octave} [${stepInOctave}]`
    : `${nearestNote}${centsText} [${stepInOctave}]`

  return {
    label,
    fullLabel: `${nearestNote}${octave} ${centsText} (Step ${stepInOctave}/${edo})`,
    isRoot,
    isNatural: isNat,
    isPrimaryDegree: isNat || cents === 0,
    stepInOctave,
    octave,
    cents
  }
}
