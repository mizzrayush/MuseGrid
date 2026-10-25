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
  const intervals = mode === 'Custom' && customIntervals ? customIntervals : SCALE_INTERVALS[mode]
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
  const intervals = mode === 'Custom' && customIntervals ? customIntervals : SCALE_INTERVALS[mode]
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
  // 9ths & Extended
  { quality: 'Major 9th', suffix: 'maj9', intervals: [0, 4, 7, 11, 14], score: 95 },
  { quality: 'Minor 9th', suffix: 'm9', intervals: [0, 3, 7, 10, 14], score: 95 },
  { quality: 'Dominant 9th', suffix: '9', intervals: [0, 4, 7, 10, 14], score: 95 },
  { quality: 'Add 9', suffix: 'add9', intervals: [0, 2, 4, 7], score: 85 },
  { quality: 'Add 9', suffix: 'add9', intervals: [0, 4, 7, 14], score: 85 },

  // 7ths
  { quality: 'Major 7th', suffix: 'maj7', intervals: [0, 4, 7, 11], score: 90 },
  { quality: 'Minor 7th', suffix: 'm7', intervals: [0, 3, 7, 10], score: 90 },
  { quality: 'Dominant 7th', suffix: '7', intervals: [0, 4, 7, 10], score: 90 },
  { quality: 'Diminished 7th', suffix: 'dim7', intervals: [0, 3, 6, 9], score: 90 },
  { quality: 'Half-Diminished 7th', suffix: 'm7b5', intervals: [0, 3, 6, 10], score: 90 },
  { quality: 'Minor-Major 7th', suffix: 'm(maj7)', intervals: [0, 3, 7, 11], score: 90 },
  { quality: 'Augmented 7th', suffix: 'aug7', intervals: [0, 4, 8, 10], score: 88 },

  // Triads
  { quality: 'Major', suffix: '', intervals: [0, 4, 7], score: 80 },
  { quality: 'Minor', suffix: 'm', intervals: [0, 3, 7], score: 80 },
  { quality: 'Diminished', suffix: 'dim', intervals: [0, 3, 6], score: 80 },
  { quality: 'Augmented', suffix: 'aug', intervals: [0, 4, 8], score: 80 },
  { quality: 'Suspended 4th', suffix: 'sus4', intervals: [0, 5, 7], score: 75 },
  { quality: 'Suspended 2nd', suffix: 'sus2', intervals: [0, 2, 7], score: 75 },

  // Dyads & Power
  { quality: 'Power Chord', suffix: '5', intervals: [0, 7], score: 50 },
]

export function detectChord(pitches: number[]): DetectedChord | null {
  if (!pitches || pitches.length === 0) return null

  // Lowest sounding pitch is the bass note
  const sortedPitches = [...pitches].sort((a, b) => a - b)
  const bassPitch = sortedPitches[0]
  const bassPc = ((bassPitch % 12) + 12) % 12
  const bassName = NOTE_NAMES_SHARP[bassPc]

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

  let bestMatch: {
    rootPc: number
    sig: ChordSignature
    inversion: 'Root Position' | '1st Inversion' | '2nd Inversion' | '3rd Inversion' | 'Open Voicing'
    matchedIntervals: number[]
  } | null = null

  // Test each pitch class as candidate root
  for (const rootPc of uniquePcs) {
    // Relative intervals mapped to candidate root [0..11] (or +12 for compounds)
    const relIntervals = uniquePcs
      .map(pc => (pc - rootPc + 12) % 12)
      .sort((a, b) => a - b)

    for (const sig of CHORD_SIGNATURES) {
      // Signature intervals mod 12
      const sigPcs = Array.from(new Set(sig.intervals.map(i => i % 12))).sort((a, b) => a - b)
      
      // Check exact match of pitch classes
      const isExactMatch = sigPcs.length === relIntervals.length &&
        sigPcs.every((iv, idx) => iv === relIntervals[idx])

      if (isExactMatch) {
        // Determine inversion based on lowest sounding pitch
        let inversion: 'Root Position' | '1st Inversion' | '2nd Inversion' | '3rd Inversion' | 'Open Voicing' = 'Root Position'
        if (bassPc === rootPc) {
          inversion = 'Root Position'
        } else if (bassPc === (rootPc + sig.intervals[1]) % 12) {
          inversion = '1st Inversion'
        } else if (sig.intervals.length > 2 && bassPc === (rootPc + sig.intervals[2]) % 12) {
          inversion = '2nd Inversion'
        } else if (sig.intervals.length > 3 && bassPc === (rootPc + sig.intervals[3]) % 12) {
          inversion = '3rd Inversion'
        } else {
          inversion = 'Open Voicing'
        }

        if (!bestMatch || sig.score > bestMatch.sig.score) {
          bestMatch = {
            rootPc,
            sig,
            inversion,
            matchedIntervals: relIntervals,
          }
        }
      }
    }
  }

  if (bestMatch) {
    const rootName = NOTE_NAMES_SHARP[bestMatch.rootPc]
    const chordName = `${rootName}${bestMatch.sig.suffix}`
    const noteNames = uniquePcs.map(pc => NOTE_NAMES_SHARP[pc])

    return {
      rootPitch: bestMatch.rootPc,
      rootName,
      quality: bestMatch.sig.quality,
      fullName: bestMatch.inversion === 'Root Position'
        ? chordName
        : `${chordName} / ${bassName}`,
      inversion: bestMatch.inversion,
      bassName,
      notes: noteNames,
      intervals: bestMatch.matchedIntervals,
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
    notes: uniquePcs.map(pc => NOTE_NAMES_SHARP[pc]),
    intervals: uniquePcs.map(pc => (pc - bassPc + 12) % 12),
  }
}

// Scale Degree Roman Numeral Analyzer
const ROMAN_NUMERALS_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
const ROMAN_NUMERALS_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']

export function detectScaleDegree(
  rootPc: number,
  scaleRoot: number,
  scaleMode: string
): string | null {
  const intervals = SCALE_INTERVALS[scaleMode]
  if (!intervals) return null

  const semitoneFromKey = (rootPc - scaleRoot + 12) % 12
  const degreeIndex = intervals.indexOf(semitoneFromKey)

  if (degreeIndex === -1) {
    // Non-diatonic chromatic alteration
    return `b${semitoneFromKey} (Altered)`
  }

  const isMinorLike = scaleMode.toLowerCase().includes('minor') || scaleMode === 'Phrygian' || scaleMode === 'Dorian'
  const romanSet = isMinorLike ? ROMAN_NUMERALS_MINOR : ROMAN_NUMERALS_MAJOR

  return romanSet[degreeIndex] || `deg ${degreeIndex + 1}`
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

