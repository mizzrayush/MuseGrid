export const SCALE_INTERVALS: Record<string, number[]> = {
  // Western Standard & Church Modes
  'Major':                [0, 2, 4, 5, 7, 9, 11],
  'Natural Minor':        [0, 2, 3, 5, 7, 8, 10],
  'Harmonic Minor':       [0, 2, 3, 5, 7, 8, 11],
  'Melodic Minor':        [0, 2, 3, 5, 7, 9, 11],
  'Dorian':               [0, 2, 3, 5, 7, 9, 10],
  'Phrygian':             [0, 1, 3, 5, 7, 8, 10],
  'Lydian':               [0, 2, 4, 6, 7, 9, 11],
  'Mixolydian':           [0, 2, 4, 5, 7, 9, 10],
  'Locrian':              [0, 1, 3, 5, 6, 8, 10],
  'Pentatonic Major':     [0, 2, 4, 7, 9],
  'Pentatonic Minor':     [0, 3, 5, 7, 10],
  'Blues':                [0, 3, 5, 6, 7, 10],
  'Chromatic':            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],

  // Middle Eastern & Maqamat
  'Arabic Hijaz':         [0, 1, 4, 5, 7, 8, 10], // Phrygian Dominant
  'Arabic Bayati':        [0, 2, 3, 5, 7, 8, 10], // Modal Bayati
  'Arabic Saba':          [0, 1, 3, 4, 7, 8, 10],
  'Arabic Rast':          [0, 2, 4, 5, 7, 9, 11], // Diatonic Rast

  // Indian Classical (Ragas)
  'Raga Bhairav':         [0, 1, 4, 5, 7, 8, 11], // Morning solemnity
  'Raga Yaman':           [0, 2, 4, 6, 7, 9, 11], // Kalyan / Lydian evening
  'Raga Todi':            [0, 1, 3, 6, 7, 8, 11], // Deep meditative
  'Raga Kafi':            [0, 2, 3, 5, 7, 9, 10], // Spring folk / Dorian
  'Raga Bhupali':         [0, 2, 4, 7, 9],        // Pure pentatonic

  // East Asian / Japanese
  'Japanese Hirajoshi':   [0, 2, 3, 7, 8],        // Traditional koto
  'Japanese Insen':       [0, 1, 5, 7, 10],       // Shamisen tuning
  'Japanese Kumoi':       [0, 2, 3, 7, 9],        // Melancholic

  // Mediterranean, European & Exotic
  'Hungarian Minor':      [0, 2, 3, 6, 7, 8, 11], // Gypsy Minor / Double Harmonic
  'Spanish 8-Tone':       [0, 1, 3, 4, 5, 6, 8, 10], // Flamenco 8-tone
  'Whole Tone':           [0, 2, 4, 6, 8, 10],    // Dreamlike / Debussy
  'Octatonic (Half-Whole)': [0, 1, 3, 4, 6, 7, 9, 10], // Diminished jazz / Stravinsky
  'Octatonic (Whole-Half)': [0, 2, 3, 5, 6, 8, 9, 11],
  'Enigmatic':            [0, 1, 4, 6, 8, 10, 11], // Verdi's scale
  'Prometheus':           [0, 2, 4, 6, 9, 10],    // Scriabin's mystic scale
}

export const SCALE_MODES = Object.keys(SCALE_INTERVALS)

/**
 * Canonical scale name for any stored mode. Older templates, imports and the default
 * project save 'major'/'minor' while the tables use canonical names; resolving here keeps
 * snapping, chord building and roman analysis working instead of silently falling back.
 */
export function resolveScaleMode(mode?: string | null): string | null {
  if (!mode) return null
  if (SCALE_INTERVALS[mode]) return mode
  const lower = mode.trim().toLowerCase()
  if (!lower) return null
  if (lower === 'custom') return 'Custom'
  if (lower === 'minor') return 'Natural Minor'
  return SCALE_MODES.find(name => name.toLowerCase() === lower) ?? null
}

/** Intervals for a mode (canonical or legacy casing), or the custom set when active. */
export function getScaleIntervals(mode?: string | null, customIntervals?: number[]): number[] | undefined {
  const resolved = resolveScaleMode(mode)
  if (!resolved) return undefined
  if (resolved === 'Custom') {
    return customIntervals && customIntervals.length > 0 ? customIntervals : undefined
  }
  return SCALE_INTERVALS[resolved]
}

export const NOTE_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
export const NOTE_NAMES_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
export const NOTE_NAMES = NOTE_NAMES_SHARP

export const CHORD_VOICINGS: Record<string, Array<{ name: string; intervals: number[] }>> = {
  'Triads': [
    { name: 'Major',  intervals: [0, 4, 7]  },
    { name: 'Minor',  intervals: [0, 3, 7]  },
    { name: 'Dim',    intervals: [0, 3, 6]  },
    { name: 'Aug',    intervals: [0, 4, 8]  },
    { name: 'Sus2',   intervals: [0, 2, 7]  },
    { name: 'Sus4',   intervals: [0, 5, 7]  },
  ],
  'Sevenths': [
    { name: 'Maj7',     intervals: [0, 4, 7, 11] },
    { name: 'Min7',     intervals: [0, 3, 7, 10] },
    { name: 'Dom7',     intervals: [0, 4, 7, 10] },
    { name: 'Dim7',     intervals: [0, 3, 6, 9]  },
    { name: 'HlfDim7',  intervals: [0, 3, 6, 10] },
    { name: 'MinMaj7',  intervals: [0, 3, 7, 11] },
  ],
  'Extended & Color': [
    { name: 'Add9',     intervals: [0, 4, 7, 14] },
    { name: 'Maj9',     intervals: [0, 4, 7, 11, 14] },
    { name: 'Min9',     intervals: [0, 3, 7, 10, 14] },
    { name: 'Dom9',     intervals: [0, 4, 7, 10, 14] },
    { name: '6/9',      intervals: [0, 4, 7, 9, 14] },
    { name: 'Maj7#11',  intervals: [0, 4, 7, 11, 18] },
    { name: '7alt',     intervals: [0, 4, 10, 13, 15] },
  ],
  'Inversions': [
    { name: '1st Inv',  intervals: [4, 7, 12]    },
    { name: '2nd Inv',  intervals: [7, 12, 16]   },
    { name: 'Drop 2',   intervals: [0, 7, 11, 16] },
    { name: 'Open 5',   intervals: [0, 7, 12]    },
  ],
}

// 6 Genre-Defining Chord Progression Generators
export interface ChordProgressionStep {
  name: string
  rootOffset: number // Semitones relative to key root
  intervals: number[]
}

export interface GenreProgression {
  id: string
  name: string
  description: string
  genre: string
  steps: ChordProgressionStep[]
}

export const GENRE_PROGRESSIONS: GenreProgression[] = [
  {
    id: 'prog-pop-anthem',
    name: 'I - V - vi - IV (Pop Anthem)',
    genre: 'Pop / EDM',
    description: 'The iconic 4-chord progression behind hundreds of global hits.',
    steps: [
      { name: 'I', rootOffset: 0, intervals: [0, 4, 7] },
      { name: 'V', rootOffset: 7, intervals: [0, 4, 7] },
      { name: 'vi', rootOffset: 9, intervals: [0, 3, 7] },
      { name: 'IV', rootOffset: 5, intervals: [0, 4, 7] },
    ]
  },
  {
    id: 'prog-neo-soul',
    name: 'ii9 - V13 - Imaj9 - VI7alt (Neo-Soul / Lo-Fi)',
    genre: 'Neo-Soul / Lo-Fi',
    description: 'Lush 9th and 13th extensions with chromatic turnarounds.',
    steps: [
      { name: 'ii9', rootOffset: 2, intervals: [0, 3, 7, 10, 14] },
      { name: 'V13', rootOffset: 7, intervals: [0, 4, 10, 14, 21] },
      { name: 'Imaj9', rootOffset: 0, intervals: [0, 4, 7, 11, 14] },
      { name: 'VI7#9', rootOffset: 9, intervals: [0, 4, 10, 15] },
    ]
  },
  {
    id: 'prog-dark-trap',
    name: 'i - VI - VII - v (Dark Trap / Phrygian)',
    genre: 'Trap / Drill',
    description: 'Sinister, brooding minor cadence standard in modern Atlanta & UK Drill.',
    steps: [
      { name: 'i', rootOffset: 0, intervals: [0, 3, 7] },
      { name: 'VI', rootOffset: 8, intervals: [0, 4, 7] },
      { name: 'VII', rootOffset: 10, intervals: [0, 4, 7] },
      { name: 'v', rootOffset: 7, intervals: [0, 3, 7] },
    ]
  },
  {
    id: 'prog-cinematic-epic',
    name: 'i - VI - III - VII (Cinematic / Hans Zimmer)',
    genre: 'Cinematic / Film',
    description: 'Monumental orchestral minor progression with ascending power.',
    steps: [
      { name: 'i', rootOffset: 0, intervals: [0, 3, 7] },
      { name: 'VI', rootOffset: 8, intervals: [0, 4, 7] },
      { name: 'III', rootOffset: 3, intervals: [0, 4, 7] },
      { name: 'VII', rootOffset: 10, intervals: [0, 4, 7] },
    ]
  },
  {
    id: 'prog-royal-road',
    name: 'IVmaj7 - V7 - iii7 - vi (Anime Royal Road)',
    genre: 'J-Pop / Anime',
    description: 'The legendary "Oudou" progression famous in Japanese animation and games.',
    steps: [
      { name: 'IVmaj7', rootOffset: 5, intervals: [0, 4, 7, 11] },
      { name: 'V7', rootOffset: 7, intervals: [0, 4, 7, 10] },
      { name: 'iii7', rootOffset: 4, intervals: [0, 3, 7, 10] },
      { name: 'vi', rootOffset: 9, intervals: [0, 3, 7] },
    ]
  },
  {
    id: 'prog-andalusian',
    name: 'i - VII - VI - V (Andalusian Cadence)',
    genre: 'Flamenco / Latin',
    description: 'Historic Spanish cadence with irresistible descending tension into V.',
    steps: [
      { name: 'i', rootOffset: 0, intervals: [0, 3, 7] },
      { name: 'VII', rootOffset: 10, intervals: [0, 4, 7] },
      { name: 'VI', rootOffset: 8, intervals: [0, 4, 7] },
      { name: 'V', rootOffset: 7, intervals: [0, 4, 7] },
    ]
  },
]

export function isInScale(pitch: number, root: number, mode: string, customIntervals?: number[]): boolean {
  const intervals = getScaleIntervals(mode, customIntervals)
  if (!intervals) return true
  const pc = ((pitch - root) % 12 + 12) % 12
  return intervals.includes(pc)
}

export function snapToScale(pitch: number, root: number, mode: string, customIntervals?: number[]): number {
  if (isInScale(pitch, root, mode, customIntervals)) return pitch
  for (let d = 1; d <= 6; d++) {
    if (isInScale(pitch - d, root, mode, customIntervals)) return pitch - d
    if (isInScale(pitch + d, root, mode, customIntervals)) return pitch + d
  }
  return pitch
}

// Snap a tick value to the nearest quantization grid
export function snapTick(tick: number, resolution: number): number {
  return Math.round(tick / resolution) * resolution
}

export function getDiatonicChord(pitch: number, root: number, mode: string, type: 'Triad' | 'Seventh' = 'Triad', customIntervals?: number[]): number[] {
  const intervals = getScaleIntervals(mode, customIntervals)
  if (!intervals || intervals.length < 5) return [pitch, pitch + 4, pitch + 7] // Fallback

  const snappedPitch = snapToScale(pitch, root, mode, customIntervals)
  const pc = ((snappedPitch - root) % 12 + 12) % 12
  
  let degree = intervals.indexOf(pc)
  if (degree === -1) degree = 0

  const getPitchForDegreeOffset = (offset: number) => {
    const targetDegree = degree + offset
    const octavesToAdd = Math.floor(targetDegree / intervals.length)
    const wrappedDegree = targetDegree % intervals.length
    
    // Calculate the semitone difference from the original pitch's pitch-class to the new pitch-class
    const originalInterval = intervals[degree]
    const targetInterval = intervals[wrappedDegree]
    
    // Semitones to add = (octaves * 12) + (targetInterval - originalInterval)
    const semitonesToAdd = (octavesToAdd * 12) + targetInterval - originalInterval
    
    return snappedPitch + semitonesToAdd
  }

  const chordPitches = [snappedPitch]
  chordPitches.push(getPitchForDegreeOffset(2)) // 3rd
  chordPitches.push(getPitchForDegreeOffset(4)) // 5th
  
  if (type === 'Seventh') {
    chordPitches.push(getPitchForDegreeOffset(6)) // 7th
  }
  
  return chordPitches
}

// ==========================================
// CHORD DETECTIVE & SCALE DEGREE ANALYZER
// ==========================================

export interface DetectedChord {
  rootPitch: number
  rootName: string
  quality: string
  fullName: string
  inversion: 'Root Position' | '1st Inversion' | '2nd Inversion' | '3rd Inversion' | 'Open Voicing'
  bassName: string
  notes: string[]
  intervals: number[]
}

interface ChordSignature {
  quality: string
  suffix: string
  intervals: number[]
  score: number // Priority weight
}

const CHORD_SIGNATURES: ChordSignature[] = [
  // Altered dominants (checked before plain extensions so the specific colour wins)
  { quality: 'Altered Dominant', suffix: '7alt', intervals: [0, 4, 8, 10, 13, 15], score: 95 },
  { quality: 'Dominant 7th b9 b13', suffix: '7b9b13', intervals: [0, 4, 7, 10, 13, 20], score: 94 },
  { quality: 'Dominant 7th #9 b13', suffix: '7#9b13', intervals: [0, 4, 7, 10, 15, 20], score: 94 },
  { quality: 'Dominant 7th b9 #11', suffix: '7b9#11', intervals: [0, 4, 7, 10, 13, 18], score: 93 },
  { quality: 'Dominant 7th #9 #11', suffix: '7#9#11', intervals: [0, 4, 7, 10, 15, 18], score: 93 },
  { quality: 'Dominant 7th b13', suffix: '7b13', intervals: [0, 4, 7, 10, 20], score: 91 },

  // 11ths
  { quality: 'Major 11th (No 3rd)', suffix: 'maj11(no3)', intervals: [0, 7, 11, 14, 17], score: 93 },
  { quality: 'Minor 11th', suffix: 'm11', intervals: [0, 3, 7, 10, 14, 17], score: 93 },
  { quality: 'Dominant 11th', suffix: '11', intervals: [0, 4, 7, 10, 14, 17], score: 93 },
  { quality: 'Dominant 11th (No 3rd)', suffix: '11(no3)', intervals: [0, 7, 10, 14, 17], score: 92 },

  // 13ths & extended colours
  { quality: 'Major 13th', suffix: 'maj13', intervals: [0, 4, 7, 11, 14, 21], score: 97 },
  { quality: 'Minor 13th', suffix: 'm13', intervals: [0, 3, 7, 10, 14, 21], score: 97 },
  { quality: 'Dominant 13th', suffix: '13', intervals: [0, 4, 7, 10, 14, 21], score: 97 },
  { quality: 'Dominant 13th (Sus4)', suffix: '13sus4', intervals: [0, 5, 7, 10, 14, 21], score: 94 },
  { quality: 'Major 9th #11', suffix: 'maj9#11', intervals: [0, 4, 7, 11, 14, 18], score: 94 },
  { quality: 'Major 7th #11', suffix: 'maj7#11', intervals: [0, 4, 7, 11, 18], score: 94 },
  { quality: 'Dominant 7th #11', suffix: '7#11', intervals: [0, 4, 7, 10, 18], score: 93 },

  // 9ths & altered dominants
  { quality: 'Major 9th', suffix: 'maj9', intervals: [0, 4, 7, 11, 14], score: 95 },
  { quality: 'Minor 9th', suffix: 'm9', intervals: [0, 3, 7, 10, 14], score: 95 },
  { quality: 'Dominant 9th', suffix: '9', intervals: [0, 4, 7, 10, 14], score: 95 },
  { quality: 'Dominant 7th b9', suffix: '7b9', intervals: [0, 4, 7, 10, 13], score: 93 },
  { quality: 'Dominant 7th #9', suffix: '7#9', intervals: [0, 4, 7, 10, 15], score: 93 },
  { quality: 'Dominant 9th (Sus4)', suffix: '9sus4', intervals: [0, 5, 7, 10, 14], score: 93 },
  { quality: 'Augmented 9th', suffix: '9#5', intervals: [0, 4, 8, 10, 14], score: 91 },
  { quality: 'Six-Nine', suffix: '6/9', intervals: [0, 4, 7, 9, 14], score: 92 },
  { quality: 'Add 9', suffix: 'add9', intervals: [0, 4, 7, 14], score: 85 },
  { quality: 'Minor Add 9', suffix: 'madd9', intervals: [0, 3, 7, 14], score: 84 },

  // 7ths
  { quality: 'Major 7th', suffix: 'maj7', intervals: [0, 4, 7, 11], score: 90 },
  { quality: 'Minor 7th', suffix: 'm7', intervals: [0, 3, 7, 10], score: 90 },
  { quality: 'Dominant 7th', suffix: '7', intervals: [0, 4, 7, 10], score: 90 },
  { quality: 'Diminished 7th', suffix: 'dim7', intervals: [0, 3, 6, 9], score: 90 },
  { quality: 'Half-Diminished 7th', suffix: 'm7b5', intervals: [0, 3, 6, 10], score: 90 },
  { quality: 'Minor-Major 7th', suffix: 'm(maj7)', intervals: [0, 3, 7, 11], score: 90 },
  { quality: 'Minor-Major 9th', suffix: 'm(maj9)', intervals: [0, 3, 7, 11, 14], score: 93 },
  { quality: 'Augmented Major 7th', suffix: 'maj7#5', intervals: [0, 4, 8, 11], score: 89 },
  { quality: 'Augmented 7th', suffix: 'aug7', intervals: [0, 4, 8, 10], score: 88 },
  { quality: 'Dominant 7th (Sus4)', suffix: '7sus4', intervals: [0, 5, 7, 10], score: 88 },
  { quality: 'Dominant 7th (Sus2)', suffix: '7sus2', intervals: [0, 2, 7, 10], score: 87 },
  { quality: 'Dominant 7th b5', suffix: '7b5', intervals: [0, 4, 6, 10], score: 86 },
  { quality: 'Major 7th b5', suffix: 'maj7b5', intervals: [0, 4, 6, 11], score: 86 },
  { quality: 'Diminished Major 7th', suffix: 'dim(maj7)', intervals: [0, 3, 6, 11], score: 88 },

  // 6ths
  { quality: 'Major 6th', suffix: '6', intervals: [0, 4, 7, 9], score: 88 },
  { quality: 'Minor 6th', suffix: 'm6', intervals: [0, 3, 7, 9], score: 88 },
  { quality: 'Minor 6/9', suffix: 'm6/9', intervals: [0, 3, 7, 9, 14], score: 92 },

  // Triads
  { quality: 'Major', suffix: '', intervals: [0, 4, 7], score: 80 },
  { quality: 'Minor', suffix: 'm', intervals: [0, 3, 7], score: 80 },
  { quality: 'Diminished', suffix: 'dim', intervals: [0, 3, 6], score: 80 },
  { quality: 'Augmented', suffix: 'aug', intervals: [0, 4, 8], score: 80 },
  { quality: 'Suspended 4th', suffix: 'sus4', intervals: [0, 5, 7], score: 75 },
  { quality: 'Suspended 2nd', suffix: 'sus2', intervals: [0, 2, 7], score: 75 },

  // Shell voicings that omit the fifth (rootless/root-and-7th comping shapes)
  { quality: 'Major 7th (No 5th)', suffix: 'maj7(no5)', intervals: [0, 4, 11], score: 82 },
  { quality: 'Dominant 7th (No 5th)', suffix: '7(no5)', intervals: [0, 4, 10], score: 82 },
  { quality: 'Minor 7th (No 5th)', suffix: 'm7(no5)', intervals: [0, 3, 10], score: 82 },
  { quality: 'Minor-Major 7th (No 5th)', suffix: 'm(maj7)(no5)', intervals: [0, 3, 11], score: 81 },
  // Root-and-7th shells: the 3rd is implied, so these stay below full triads.
  { quality: 'Major 7th (No 3rd)', suffix: 'maj7(no3)', intervals: [0, 7, 11], score: 62 },
  { quality: 'Dominant 7th (No 3rd)', suffix: '7(no3)', intervals: [0, 7, 10], score: 60 },
  { quality: 'Minor #5', suffix: 'm#5', intervals: [0, 3, 8], score: 74 },

  // Dyads & Power
  { quality: 'Power Chord', suffix: '5', intervals: [0, 7], score: 50 },
  { quality: 'Major Third Dyad', suffix: ' (maj 3rd)', intervals: [0, 4], score: 45 },
  { quality: 'Minor Third Dyad', suffix: ' (min 3rd)', intervals: [0, 3], score: 45 },
  { quality: 'Perfect Fourth Dyad', suffix: ' (4th)', intervals: [0, 5], score: 52 },
  { quality: 'Tritone', suffix: ' (tritone)', intervals: [0, 6], score: 40 },
]

type InversionLabel = DetectedChord['inversion']

interface ChordMatch {
  rootPc: number
  sig: ChordSignature
  inversion: InversionLabel
  relIntervals: number[]
  score: number
}

// Chromatic interval names used when a voicing adds or omits a single tone.
const INTERVAL_NAMES = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7']

function signaturePcs(sig: ChordSignature): number[] {
  return Array.from(new Set(sig.intervals.map(i => i % 12))).sort((a, b) => a - b)
}

function inversionFor(sig: ChordSignature, rootPc: number, bassPc: number): InversionLabel {
  // Chord-tone order (root, 3rd, 5th, 7th …), not sorted pitch classes. Extensions
  // (9th, 11th, 13th live above the octave) are not inversions, so a 9th in the bass
  // is an open voicing rather than a "1st inversion".
  const tonePcs: number[] = []
  for (const interval of sig.intervals) {
    if (interval >= 12) continue
    const pc = interval % 12
    if (!tonePcs.includes(pc)) tonePcs.push(pc)
  }
  const bassInterval = ((bassPc - rootPc) % 12 + 12) % 12
  const bassIndex = tonePcs.indexOf(bassInterval)
  if (bassPc === rootPc) return 'Root Position'
  if (bassIndex === 1) return '1st Inversion'
  if (bassIndex === 2) return '2nd Inversion'
  if (bassIndex === 3) return '3rd Inversion'
  return 'Open Voicing'
}

function findExactMatch(uniquePcs: number[], bassPc: number): ChordMatch | null {
  let best: ChordMatch | null = null
  for (const rootPc of uniquePcs) {
    const relIntervals = uniquePcs
      .map(pc => (pc - rootPc + 12) % 12)
      .sort((a, b) => a - b)

    for (const sig of CHORD_SIGNATURES) {
      const sigPcs = signaturePcs(sig)
      const isExactMatch = sigPcs.length === relIntervals.length &&
        sigPcs.every((iv, idx) => iv === relIntervals[idx])
      if (!isExactMatch) continue

      // Prefer the reading whose root is in the bass: C-E-G-A is C6, not Am7/C.
      const score = sig.score + (bassPc === rootPc ? 3 : 0)
      if (!best || score > best.score) {
        best = {
          rootPc,
          sig,
          inversion: inversionFor(sig, rootPc, bassPc),
          relIntervals,
          score,
        }
      }
    }
  }
  return best
}

/**
 * Stacked-chord naming ("D/C" style is a slash chord, a polychord is written
 * "upper / lower"). Splits the actual voicing at its widest register gap and names
 * both halves independently; only used when no single chord describes the notes.
 */
function findPolychord(
  sortedPitches: number[],
  bassPc: number,
  names: string[]
): DetectedChord | null {
  if (sortedPitches.length < 6) return null

  let splitIndex = -1
  let widestGap = -1
  for (let i = 0; i < sortedPitches.length - 1; i += 1) {
    const lowerCount = new Set(sortedPitches.slice(0, i + 1).map(p => p % 12)).size
    const upperCount = new Set(sortedPitches.slice(i + 1).map(p => p % 12)).size
    if (lowerCount < 3 || upperCount < 3) continue
    const gap = sortedPitches[i + 1] - sortedPitches[i]
    if (gap > widestGap) { widestGap = gap; splitIndex = i }
  }
  if (splitIndex < 0) return null

  const lowerPcs = Array.from(new Set(sortedPitches.slice(0, splitIndex + 1).map(p => ((p % 12) + 12) % 12)))
  const upperPcs = Array.from(new Set(sortedPitches.slice(splitIndex + 1).map(p => ((p % 12) + 12) % 12)))
  const lowerBass = ((sortedPitches[0] % 12) + 12) % 12
  const upperBass = ((sortedPitches[splitIndex + 1] % 12) + 12) % 12

  const lower = findExactMatch(lowerPcs, lowerBass)
  const upper = findExactMatch(upperPcs, upperBass)
  if (!lower || !upper) return null
  if (lower.rootPc === upper.rootPc) return null
  // Both halves should be real chords, not dyads pulled apart.
  if (lower.sig.score < 75 || upper.sig.score < 75) return null

  return {
    rootPitch: upper.rootPc,
    rootName: names[upper.rootPc],
    quality: 'Polychord',
    fullName: `${names[upper.rootPc]}${upper.sig.suffix} / ${names[lower.rootPc]}${lower.sig.suffix}`,
    inversion: 'Open Voicing',
    bassName: names[bassPc],
    notes: Array.from(new Set([...sortedPitches].map(p => ((p % 12) + 12) % 12))).map(pc => names[pc]),
    intervals: Array.from(new Set(sortedPitches.map(p => (((p % 12) - bassPc + 12) % 12)))).sort((a, b) => a - b),
  }
}

/** One-note tolerance: names voicings with a single added or omitted chord tone. */
function findTolerantMatch(uniquePcs: number[], bassPc: number) {
  let best: (ChordMatch & { detail: string }) | null = null
  for (const rootPc of uniquePcs) {
    const relIntervals = uniquePcs
      .map(pc => (pc - rootPc + 12) % 12)
      .sort((a, b) => a - b)

    for (const sig of CHORD_SIGNATURES) {
      if (sig.score < 75) continue
      const sigPcs = signaturePcs(sig)
      const extras = relIntervals.filter(iv => !sigPcs.includes(iv))
      const missing = sigPcs.filter(iv => !relIntervals.includes(iv))
      if (extras.length + missing.length !== 1) continue

      const detail = extras.length === 1
        ? `add ${INTERVAL_NAMES[extras[0]]}`
        : `no ${INTERVAL_NAMES[missing[0]]}`
      const score = sig.score - 4 + (bassPc === rootPc ? 3 : 0)
      if (!best || score > best.score) {
        best = {
          rootPc,
          sig,
          inversion: inversionFor(sig, rootPc, bassPc),
          relIntervals,
          score,
          detail,
        }
      }
    }
  }
  return best
}

export function detectChord(pitches: number[], preferFlats = false): DetectedChord | null {
  if (!pitches || pitches.length === 0) return null
  const names = preferFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP

  // Lowest sounding pitch is the bass note
  const sortedPitches = [...pitches].sort((a, b) => a - b)
  const bassPitch = sortedPitches[0]
  const bassPc = ((bassPitch % 12) + 12) % 12
  const bassName = names[bassPc]

  // Unique pitch classes
  const uniquePcs = Array.from(new Set(pitches.map(p => ((p % 12) + 12) % 12)))
  if (uniquePcs.length < 2) {
    return {
      rootPitch: bassPitch,
      rootName: bassName,
      quality: 'Single Pitch / Unison',
      fullName: `${bassName} Unison`,
      inversion: 'Root Position',
      bassName,
      notes: [bassName],
      intervals: [0],
    }
  }

  const exact = findExactMatch(uniquePcs, bassPc)
  if (exact) {
    const rootName = names[exact.rootPc]
    const chordName = `${rootName}${exact.sig.suffix}`
    return {
      rootPitch: exact.rootPc,
      rootName,
      quality: exact.sig.quality,
      fullName: exact.inversion === 'Root Position'
        ? chordName
        : `${chordName} / ${bassName}`,
      inversion: exact.inversion,
      bassName,
      notes: uniquePcs.map(pc => names[pc]),
      intervals: exact.relIntervals,
    }
  }

  // Stacked chords read better as two named chords than as a cluster.
  const polychord = findPolychord(sortedPitches, bassPc, names)
  if (polychord) return polychord

  const tolerant = findTolerantMatch(uniquePcs, bassPc)
  if (tolerant) {
    const rootName = names[tolerant.rootPc]
    const chordName = `${rootName}${tolerant.sig.suffix} (${tolerant.detail})`
    return {
      rootPitch: tolerant.rootPc,
      rootName,
      quality: `${tolerant.sig.quality} (${tolerant.detail})`,
      fullName: tolerant.inversion === 'Root Position'
        ? chordName
        : `${chordName} / ${bassName}`,
      inversion: tolerant.inversion,
      bassName,
      notes: uniquePcs.map(pc => names[pc]),
      intervals: tolerant.relIntervals,
    }
  }

  // Fallback: chromatic cluster / cluster voicing
  return {
    rootPitch: bassPitch,
    rootName: bassName,
    quality: 'Cluster Voicing',
    fullName: `${bassName} Complex (${uniquePcs.length} notes)`,
    inversion: 'Open Voicing',
    bassName,
    notes: uniquePcs.map(pc => names[pc]),
    intervals: uniquePcs.map(pc => (pc - bassPc + 12) % 12),
  }
}

// Scale Degree Roman Numeral Analyzer
const ROMAN_DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
// Conventional labels relative to the key's tonic for notes outside the scale.
const ALTERED_DEGREES = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII']

function stackedThirdFifth(degreeIndex: number, intervals: number[]): { third: number; fifth: number } {
  const stackedSemitones = (offset: number): number => {
    const target = degreeIndex + offset
    const octaves = Math.floor(target / intervals.length)
    const wrapped = ((target % intervals.length) + intervals.length) % intervals.length
    return octaves * 12 + intervals[wrapped] - intervals[degreeIndex]
  }
  return { third: stackedSemitones(2), fifth: stackedSemitones(4) }
}

/** Roman numeral for a scale-degree index, with quality taken from the scale's own stack. */
function romanForDegree(degreeIndex: number, intervals: number[]): string {
  const baseRoman = ROMAN_DEGREES[degreeIndex] ?? `${degreeIndex + 1}`
  // Functional quality needs a seven-tone scale; pentatonic, blues and octatonic degrees
  // do not have a stable diatonic 3rd/5th stack.
  if (intervals.length !== 7) return baseRoman
  const { third, fifth } = stackedThirdFifth(degreeIndex, intervals)
  const roman = third >= 4 ? baseRoman : baseRoman.toLowerCase()
  if (fifth === 6) return `${roman}°`
  if (fifth === 8) return `${roman}+`
  return roman
}

type ChordFamily = 'major' | 'minor' | 'dominant' | 'diminished' | 'augmented' | 'other'

function chordFamily(quality?: string): ChordFamily {
  if (!quality) return 'other'
  const q = quality.toLowerCase()
  if (q.includes('polychord') || q.includes('cluster') || q.includes('unison')) return 'other'
  if (q.includes('dim')) return 'diminished'
  if (q.includes('aug')) return 'augmented'
  if (q.includes('dominant')) return 'dominant'
  if (q.includes('minor')) return 'minor'
  if (q.includes('major')) return 'major'
  return 'other'
}

function isDominantQuality(quality?: string): boolean {
  const family = chordFamily(quality)
  return family === 'dominant' || family === 'major' || family === 'augmented'
}

/** V/<target> when this root sits a perfect fifth above a usable diatonic degree. */
function secondaryDominant(semitoneFromKey: number, intervals: number[]): string | null {
  for (let target = 0; target < intervals.length; target += 1) {
    if ((intervals[target] + 7) % 12 !== semitoneFromKey) continue
    if (intervals.length === 7) {
      const { fifth } = stackedThirdFifth(target, intervals)
      // Do not dominantize a diminished or augmented degree.
      if (fifth === 6 || fifth === 8) continue
    }
    return `V/${romanForDegree(target, intervals)}`
  }
  return null
}

/**
 * Roman numeral for a chord root in the project key. Quality is derived from the scale itself
 * (stacking 3rds and 5ths), so harmonic/melodic minor, Locrian and every church mode get the
 * right case and °/+ marks instead of a major/minor guess. Non-heptatonic and custom scales
 * use plain Roman numerals without inferred quality. A root a fifth above a diatonic degree
 * is labelled as a secondary dominant (V/V, V/ii, …) when the chord is major or dominant —
 * including a major chord on a normally minor degree, which is how V/V appears in a major key.
 * Other out-of-key notes get chromatic labels. Modulation is not tracked — every chord is
 * read against the project key.
 */
export function detectScaleDegree(
  rootPc: number,
  scaleRoot: number,
  scaleMode: string,
  customIntervals?: number[],
  chordQuality?: string
): string | null {
  const rawIntervals = getScaleIntervals(scaleMode, customIntervals)
  if (!rawIntervals || rawIntervals.length === 0) return null

  const intervals = Array.from(new Set(
    rawIntervals.filter(value => Number.isFinite(value) && value >= 0 && value < 12)
  )).sort((a, b) => a - b)
  if (intervals.length === 0) return null

  const keyPc = ((Math.round(scaleRoot) % 12) + 12) % 12
  const chordPc = ((Math.round(rootPc) % 12) + 12) % 12
  const semitoneFromKey = ((chordPc - keyPc) % 12 + 12) % 12
  const degreeIndex = intervals.indexOf(semitoneFromKey)

  if (degreeIndex === -1) {
    if (isDominantQuality(chordQuality)) {
      const secondary = secondaryDominant(semitoneFromKey, intervals)
      if (secondary) return secondary
    }
    return `${ALTERED_DEGREES[semitoneFromKey]} (Altered)`
  }

  const baseRoman = romanForDegree(degreeIndex, intervals)
  if (intervals.length !== 7 || !chordQuality) return baseRoman

  const { third, fifth } = stackedThirdFifth(degreeIndex, intervals)
  const expected: ChordFamily = fifth === 6
    ? 'diminished'
    : fifth === 8
      ? 'augmented'
      : third >= 4 ? 'major' : 'minor'
  const actual = chordFamily(chordQuality)
  if (actual === 'other') return baseRoman

  // A major/dominant chord on a normally minor or diminished degree is a secondary
  // dominant (V/V, V/ii, V/iii, …). Without a usable target, minor degrees simply
  // uppercase and diminished degrees keep their ° mark.
  if ((expected === 'minor' || expected === 'diminished') && (actual === 'major' || actual === 'dominant')) {
    const secondary = secondaryDominant(semitoneFromKey, intervals)
    if (secondary) return secondary
    if (expected === 'minor') return baseRoman.toUpperCase()
  }
  if (expected === 'major' && actual === 'minor') return baseRoman.toLowerCase()
  if (actual === 'diminished' && !baseRoman.endsWith('°')) return `${baseRoman}°`
  if (actual === 'augmented' && !baseRoman.endsWith('+')) return `${baseRoman}+`
  return baseRoman
}

export interface ChordStampDef {
  id: string
  label: string
  shortName: string
  intervals: number[]
  description: string
}

export const CHORD_STAMPS: ChordStampDef[] = [
  { id: 'triad', label: 'Diatonic Triad', shortName: 'Triad', intervals: [0, 4, 7], description: 'Diatonic 1-3-5 triad based on scale degree' },
  { id: 'seventh', label: 'Diatonic 7th', shortName: '7th', intervals: [0, 4, 7, 11], description: 'Diatonic 1-3-5-7 chord based on scale degree' },
  { id: 'maj7', label: 'Major 7th', shortName: 'Maj7', intervals: [0, 4, 7, 11], description: 'Lush, uplifting major 7th chord' },
  { id: 'min7', label: 'Minor 7th', shortName: 'Min7', intervals: [0, 3, 7, 10], description: 'Mellow, soulful minor 7th chord' },
  { id: 'min9', label: 'Minor 9th', shortName: 'Min9', intervals: [0, 3, 7, 10, 14], description: 'Dreamy, sophisticated jazz/lo-fi chord' },
  { id: 'maj9', label: 'Major 9th', shortName: 'Maj9', intervals: [0, 4, 7, 11, 14], description: 'Warm, expansive neo-soul chord' },
  { id: 'sus4', label: 'Suspended 4th', shortName: 'Sus4', intervals: [0, 5, 7], description: 'Open, unresolved tension' },
  { id: 'add9', label: 'Add 9', shortName: 'Add9', intervals: [0, 4, 7, 14], description: 'Bright acoustic chime' },
  { id: 'dim7', label: 'Diminished 7th', shortName: 'Dim7', intervals: [0, 3, 6, 9], description: 'Tense cinematic passing chord' },
  { id: 'power', label: 'Power Chord (1-5-8)', shortName: 'Power', intervals: [0, 7, 12], description: 'Heavy guitar/synth stack' },
]

