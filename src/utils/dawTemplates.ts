import type { Track, Note, ScaleLock } from '../engine/store'

export interface DawTemplate {
  id: string
  title: string
  category: 'Electronic' | 'Hip-Hop' | 'Dance' | 'Ambient' | 'World' | 'Acoustic' | 'Experimental' | 'Custom' | string
  description: string
  bpm: number
  keyName: string
  badgeColor: string
  tags: string[]
  scaleLock: ScaleLock
  tracks: Track[]
  notes: Note[]
  // Mini representation for SVG grid thumbnail
  previewPattern?: {
    synth: Array<{ t: number; p: number; len: number }>
    drum: Array<{ t: number; r: number }>
  }
  isUserTemplate?: boolean
}

export const DAW_TEMPLATES: DawTemplate[] = [
  // 1. Synthwave Cyberpunk
  {
    id: 'synthwave',
    title: 'Synthwave Cyberpunk',
    category: 'Electronic',
    description: 'Neon retro-future 80s arpeggio and driving bassline with saturated 808 beats.',
    bpm: 120,
    keyName: 'D Minor',
    badgeColor: '#f72585',
    tags: ['Analog Pluck', '808 Kit', 'Tape Delay'],
    scaleLock: { enabled: true, root: 2, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Neon Arp Lead',
        instrument: 'synth',
        volume: 0.95,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#f72585',
        collapsed: true,
        synthPreset: 'pluck',
        delayTime: 0.25,
        delayFeedback: 0.35
      },
      {
        id: 'track_synth_bass',
        name: 'Cyber Bass',
        instrument: 'synth',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#4cc9f0',
        collapsed: true,
        synthPreset: 'bass',
        delayTime: 0.25,
        delayFeedback: 0.1
      },
      {
        id: 'track_drum',
        name: 'Tape 808 Drums',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#ff9900',
        collapsed: true,
        drumKit: 'eightOhEight',
        delayTime: 0.25,
        delayFeedback: 0.2
      }
    ],
    notes: [
      // Lead Arp (D Minor: D4=62, F4=65, A4=69, C5=72)
      { id: 'sw_n1', trackId: 'track_synth', time: 0, duration: 48, pitch: 62, velocity: 90 },
      { id: 'sw_n2', trackId: 'track_synth', time: 48, duration: 48, pitch: 65, velocity: 85 },
      { id: 'sw_n3', trackId: 'track_synth', time: 96, duration: 48, pitch: 69, velocity: 95 },
      { id: 'sw_n4', trackId: 'track_synth', time: 144, duration: 48, pitch: 72, velocity: 80 },
      { id: 'sw_n5', trackId: 'track_synth', time: 192, duration: 48, pitch: 69, velocity: 85 },
      { id: 'sw_n6', trackId: 'track_synth', time: 240, duration: 48, pitch: 65, velocity: 80 },
      { id: 'sw_n7', trackId: 'track_synth', time: 288, duration: 48, pitch: 62, velocity: 90 },
      { id: 'sw_n8', trackId: 'track_synth', time: 336, duration: 48, pitch: 65, velocity: 85 },
      { id: 'sw_n9', trackId: 'track_synth', time: 384, duration: 48, pitch: 60, velocity: 88 },
      { id: 'sw_n10', trackId: 'track_synth', time: 432, duration: 48, pitch: 63, velocity: 82 },
      { id: 'sw_n11', trackId: 'track_synth', time: 480, duration: 48, pitch: 67, velocity: 92 },
      { id: 'sw_n12', trackId: 'track_synth', time: 528, duration: 48, pitch: 70, velocity: 80 },
      { id: 'sw_n13', trackId: 'track_synth', time: 576, duration: 48, pitch: 67, velocity: 85 },
      { id: 'sw_n14', trackId: 'track_synth', time: 624, duration: 48, pitch: 63, velocity: 80 },
      { id: 'sw_n15', trackId: 'track_synth', time: 672, duration: 48, pitch: 60, velocity: 88 },
      { id: 'sw_n16', trackId: 'track_synth', time: 720, duration: 48, pitch: 63, velocity: 82 },
      // Driving 8th-note Bass (D2=38, C2=36)
      { id: 'sw_b1', trackId: 'track_synth_bass', time: 0, duration: 48, pitch: 38, velocity: 100 },
      { id: 'sw_b2', trackId: 'track_synth_bass', time: 48, duration: 48, pitch: 38, velocity: 90 },
      { id: 'sw_b3', trackId: 'track_synth_bass', time: 96, duration: 48, pitch: 38, velocity: 100 },
      { id: 'sw_b4', trackId: 'track_synth_bass', time: 144, duration: 48, pitch: 38, velocity: 90 },
      { id: 'sw_b5', trackId: 'track_synth_bass', time: 192, duration: 48, pitch: 38, velocity: 100 },
      { id: 'sw_b6', trackId: 'track_synth_bass', time: 240, duration: 48, pitch: 38, velocity: 90 },
      { id: 'sw_b7', trackId: 'track_synth_bass', time: 288, duration: 48, pitch: 38, velocity: 100 },
      { id: 'sw_b8', trackId: 'track_synth_bass', time: 336, duration: 48, pitch: 38, velocity: 90 },
      { id: 'sw_b9', trackId: 'track_synth_bass', time: 384, duration: 48, pitch: 36, velocity: 100 },
      { id: 'sw_b10', trackId: 'track_synth_bass', time: 432, duration: 48, pitch: 36, velocity: 90 },
      { id: 'sw_b11', trackId: 'track_synth_bass', time: 480, duration: 48, pitch: 36, velocity: 100 },
      { id: 'sw_b12', trackId: 'track_synth_bass', time: 528, duration: 48, pitch: 36, velocity: 90 },
      { id: 'sw_b13', trackId: 'track_synth_bass', time: 576, duration: 48, pitch: 36, velocity: 100 },
      { id: 'sw_b14', trackId: 'track_synth_bass', time: 624, duration: 48, pitch: 36, velocity: 90 },
      { id: 'sw_b15', trackId: 'track_synth_bass', time: 672, duration: 48, pitch: 36, velocity: 100 },
      { id: 'sw_b16', trackId: 'track_synth_bass', time: 720, duration: 48, pitch: 36, velocity: 90 },
      // Drum Kick (36) & Snare (38) & Hats (42)
      { id: 'sw_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 110 },
      { id: 'sw_d2', trackId: 'track_drum', time: 192, duration: 48, pitch: 1, velocity: 105 },
      { id: 'sw_d3', trackId: 'track_drum', time: 384, duration: 48, pitch: 0, velocity: 110 },
      { id: 'sw_d4', trackId: 'track_drum', time: 576, duration: 48, pitch: 1, velocity: 105 },
      { id: 'sw_d5', trackId: 'track_drum', time: 96, duration: 48, pitch: 2, velocity: 80 },
      { id: 'sw_d6', trackId: 'track_drum', time: 288, duration: 48, pitch: 2, velocity: 85 },
      { id: 'sw_d7', trackId: 'track_drum', time: 480, duration: 48, pitch: 2, velocity: 80 },
      { id: 'sw_d8', trackId: 'track_drum', time: 672, duration: 48, pitch: 2, velocity: 85 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 4, len: 1 }, { t: 1, p: 5, len: 1 }, { t: 2, p: 7, len: 1 }, { t: 3, p: 8, len: 1 },
        { t: 4, p: 7, len: 1 }, { t: 5, p: 5, len: 1 }, { t: 6, p: 4, len: 1 }, { t: 7, p: 5, len: 1 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 2, r: 2 }, { t: 4, r: 1 }, { t: 6, r: 2 }
      ]
    }
  },

  // 2. Melodic Techno (Peak Time)
  {
    id: 'techno',
    title: 'Melodic Techno (Peak Time)',
    category: 'Electronic',
    description: '126 BPM driving hypnotic 4-on-the-floor kick with resonant acid filter sweeps.',
    bpm: 126,
    keyName: 'F Minor',
    badgeColor: '#00e6ff',
    tags: ['Tight 909', 'Acid Bass', 'Filter Sweep'],
    scaleLock: { enabled: true, root: 5, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Acid Bassline',
        instrument: 'synth',
        volume: 0.95,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#00e6ff',
        collapsed: true,
        synthPreset: 'bright',
        delayTime: 0.375,
        delayFeedback: 0.4
      },
      {
        id: 'track_drum',
        name: 'Tight Techno Kit',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#ffd43b',
        collapsed: true,
        drumKit: 'tight',
        delayTime: 0.25,
        delayFeedback: 0.15
      }
    ],
    notes: [
      { id: 'tc_n1', trackId: 'track_synth', time: 48, duration: 48, pitch: 41, velocity: 90 },
      { id: 'tc_n2', trackId: 'track_synth', time: 96, duration: 48, pitch: 41, velocity: 85 },
      { id: 'tc_n3', trackId: 'track_synth', time: 144, duration: 48, pitch: 53, velocity: 100 },
      { id: 'tc_n4', trackId: 'track_synth', time: 240, duration: 48, pitch: 41, velocity: 85 },
      { id: 'tc_n5', trackId: 'track_synth', time: 288, duration: 48, pitch: 44, velocity: 95 },
      { id: 'tc_n6', trackId: 'track_synth', time: 336, duration: 48, pitch: 41, velocity: 85 },
      { id: 'tc_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 115 },
      { id: 'tc_d2', trackId: 'track_drum', time: 192, duration: 48, pitch: 0, velocity: 115 },
      { id: 'tc_d3', trackId: 'track_drum', time: 384, duration: 48, pitch: 0, velocity: 115 },
      { id: 'tc_d4', trackId: 'track_drum', time: 576, duration: 48, pitch: 0, velocity: 115 },
      { id: 'tc_d5', trackId: 'track_drum', time: 96, duration: 48, pitch: 2, velocity: 85 },
      { id: 'tc_d6', trackId: 'track_drum', time: 288, duration: 48, pitch: 2, velocity: 90 },
      { id: 'tc_d7', trackId: 'track_drum', time: 480, duration: 48, pitch: 2, velocity: 85 },
      { id: 'tc_d8', trackId: 'track_drum', time: 672, duration: 48, pitch: 2, velocity: 95 }
    ],
    previewPattern: {
      synth: [
        { t: 1, p: 2, len: 1 }, { t: 2, p: 2, len: 1 }, { t: 3, p: 6, len: 1 }, { t: 5, p: 2, len: 1 }, { t: 6, p: 3, len: 1 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 2, r: 0 }, { t: 4, r: 0 }, { t: 6, r: 0 }, { t: 1, r: 2 }, { t: 3, r: 2 }, { t: 5, r: 2 }, { t: 7, r: 2 }
      ]
    }
  },

  // 3. Trap 808 Drill
  {
    id: 'trap',
    title: 'Trap 808 Drill',
    category: 'Hip-Hop',
    description: '140 BPM pitch-sliding sub-bass, rapid hi-hat rolls, and dark trap chords.',
    bpm: 140,
    keyName: 'C Minor',
    badgeColor: '#ff6b6b',
    tags: ['808 Sub Boom', 'Hi-Hat Rolls', 'Dark Bells'],
    scaleLock: { enabled: true, root: 0, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Dark Bell Melody',
        instrument: 'synth',
        volume: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#ff6b6b',
        collapsed: true,
        synthPreset: 'bell',
        delayTime: 0.25,
        delayFeedback: 0.3
      },
      {
        id: 'track_drum',
        name: '808 Machine',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#fa5252',
        collapsed: true,
        drumKit: 'eightOhEight',
        delayTime: 0.25,
        delayFeedback: 0.1
      }
    ],
    notes: [
      { id: 'tr_n1', trackId: 'track_synth', time: 0, duration: 192, pitch: 72, velocity: 90 },
      { id: 'tr_n2', trackId: 'track_synth', time: 192, duration: 96, pitch: 75, velocity: 85 },
      { id: 'tr_n3', trackId: 'track_synth', time: 288, duration: 96, pitch: 74, velocity: 80 },
      { id: 'tr_n4', trackId: 'track_synth', time: 384, duration: 192, pitch: 71, velocity: 90 },
      { id: 'tr_d1', trackId: 'track_drum', time: 0, duration: 96, pitch: 0, velocity: 120 },
      { id: 'tr_d2', trackId: 'track_drum', time: 384, duration: 48, pitch: 1, velocity: 110 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 7, len: 4 }, { t: 4, p: 8, len: 2 }, { t: 6, p: 6, len: 2 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 4, r: 1 }, { t: 5, r: 2 }, { t: 6, r: 2 }, { t: 7, r: 2 }
      ]
    }
  },

  // 4. Lo-Fi Chillhop Study
  {
    id: 'lofi',
    title: 'Lo-Fi Chillhop Study',
    category: 'Hip-Hop',
    description: 'Warm electric piano Rhodes chords, dusty swing rhythm, and nostalgic tape flutter.',
    bpm: 82,
    keyName: 'E♭ Major 7',
    badgeColor: '#da77f2',
    tags: ['Electric Piano', 'Vinyl Swing', 'Chorus'],
    scaleLock: { enabled: true, root: 3, mode: 'major', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Rhodes Chords',
        instrument: 'synth',
        volume: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#da77f2',
        collapsed: true,
        synthPreset: 'electricPiano',
        delayTime: 0.35,
        delayFeedback: 0.25
      },
      {
        id: 'track_drum',
        name: 'Dusty Beat',
        instrument: 'drum',
        volume: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#be4bdb',
        collapsed: true,
        drumKit: 'classic',
        delayTime: 0.25,
        delayFeedback: 0.1
      }
    ],
    notes: [
      { id: 'lf_n1', trackId: 'track_synth', time: 0, duration: 384, pitch: 63, velocity: 75 },
      { id: 'lf_n2', trackId: 'track_synth', time: 0, duration: 384, pitch: 67, velocity: 70 },
      { id: 'lf_n3', trackId: 'track_synth', time: 0, duration: 384, pitch: 70, velocity: 72 },
      { id: 'lf_n4', trackId: 'track_synth', time: 0, duration: 384, pitch: 74, velocity: 68 },
      { id: 'lf_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 90 },
      { id: 'lf_d2', trackId: 'track_drum', time: 192, duration: 48, pitch: 1, velocity: 85 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 3, len: 6 }, { t: 0, p: 5, len: 6 }, { t: 0, p: 7, len: 6 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 2, r: 2 }, { t: 4, r: 1 }, { t: 6, r: 2 }
      ]
    }
  },

  // 5. Deep House 4-on-the-Floor
  {
    id: 'deep_house',
    title: 'Deep House 4-on-the-Floor',
    category: 'Dance',
    description: 'Soulful organ stabs, rolling sub-bass, and classic 909 shakers.',
    bpm: 124,
    keyName: 'A Minor',
    badgeColor: '#4dabf7',
    tags: ['Organ Stabs', '909 Groove', 'Swing'],
    scaleLock: { enabled: true, root: 9, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'House Organ',
        instrument: 'synth',
        volume: 0.95,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#4dabf7',
        collapsed: true,
        synthPreset: 'bright',
        delayTime: 0.25,
        delayFeedback: 0.2
      },
      {
        id: 'track_drum',
        name: '909 Dance Kit',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#339af0',
        collapsed: true,
        drumKit: 'tight',
        delayTime: 0.25,
        delayFeedback: 0.1
      }
    ],
    notes: [
      { id: 'dh_n1', trackId: 'track_synth', time: 96, duration: 48, pitch: 69, velocity: 95 },
      { id: 'dh_n2', trackId: 'track_synth', time: 144, duration: 48, pitch: 72, velocity: 90 },
      { id: 'dh_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 110 },
      { id: 'dh_d2', trackId: 'track_drum', time: 192, duration: 48, pitch: 0, velocity: 110 },
      { id: 'dh_d3', trackId: 'track_drum', time: 384, duration: 48, pitch: 0, velocity: 110 },
      { id: 'dh_d4', trackId: 'track_drum', time: 576, duration: 48, pitch: 0, velocity: 110 }
    ],
    previewPattern: {
      synth: [
        { t: 2, p: 5, len: 1 }, { t: 3, p: 7, len: 1 }, { t: 6, p: 5, len: 1 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 2, r: 0 }, { t: 4, r: 0 }, { t: 6, r: 0 }, { t: 2, r: 1 }, { t: 6, r: 1 }
      ]
    }
  },

  // 6. Cinematic Space Ambient
  {
    id: 'ambient',
    title: 'Cinematic Space Ambient',
    category: 'Ambient',
    description: 'Ethereal glass pads, long delay reflections, and meditative harmonic beds.',
    bpm: 68,
    keyName: 'G Lydian',
    badgeColor: '#69db7c',
    tags: ['Glass Pad', 'Wide Stereo', 'Long Reverb'],
    scaleLock: { enabled: true, root: 7, mode: 'lydian', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Glass Space Pad',
        instrument: 'synth',
        volume: 0.85,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#69db7c',
        collapsed: true,
        synthPreset: 'glass',
        delayTime: 0.5,
        delayFeedback: 0.6
      },
      {
        id: 'track_drum',
        name: 'Sparse Ambience',
        instrument: 'drum',
        volume: 0.6,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#38d9a9',
        collapsed: true,
        drumKit: 'acoustic',
        delayTime: 0.5,
        delayFeedback: 0.3
      }
    ],
    notes: [
      { id: 'amb_n1', trackId: 'track_synth', time: 0, duration: 768, pitch: 55, velocity: 70 },
      { id: 'amb_n2', trackId: 'track_synth', time: 0, duration: 768, pitch: 62, velocity: 65 },
      { id: 'amb_n3', trackId: 'track_synth', time: 0, duration: 768, pitch: 66, velocity: 68 },
      { id: 'amb_n4', trackId: 'track_synth', time: 0, duration: 768, pitch: 71, velocity: 60 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 2, len: 8 }, { t: 0, p: 4, len: 8 }, { t: 0, p: 6, len: 8 }
      ],
      drum: [
        { t: 0, r: 3 }
      ]
    }
  },

  // 7. Modern Pop & Indie Rock
  {
    id: 'pop_rock',
    title: 'Modern Pop & Indie Rock',
    category: 'Acoustic',
    description: 'Energetic acoustic Ludwig drums, dynamic bass, and punchy pop melodic hooks.',
    bpm: 116,
    keyName: 'A Minor',
    badgeColor: '#ffa94d',
    tags: ['Acoustic Drums', 'Pop Lead', 'Bassline'],
    scaleLock: { enabled: true, root: 9, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Pop Synth Lead',
        instrument: 'synth',
        volume: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#ffa94d',
        collapsed: true,
        synthPreset: 'bright',
        delayTime: 0.25,
        delayFeedback: 0.2
      },
      {
        id: 'track_drum',
        name: 'Acoustic Kit',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#ff922b',
        collapsed: true,
        drumKit: 'acoustic',
        delayTime: 0.25,
        delayFeedback: 0.1
      }
    ],
    notes: [
      { id: 'pr_n1', trackId: 'track_synth', time: 0, duration: 96, pitch: 69, velocity: 90 },
      { id: 'pr_n2', trackId: 'track_synth', time: 96, duration: 96, pitch: 72, velocity: 85 },
      { id: 'pr_n3', trackId: 'track_synth', time: 192, duration: 96, pitch: 71, velocity: 95 },
      { id: 'pr_n4', trackId: 'track_synth', time: 288, duration: 96, pitch: 69, velocity: 90 },
      { id: 'pr_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 110 },
      { id: 'pr_d2', trackId: 'track_drum', time: 192, duration: 48, pitch: 1, velocity: 105 },
      { id: 'pr_d3', trackId: 'track_drum', time: 384, duration: 48, pitch: 0, velocity: 110 },
      { id: 'pr_d4', trackId: 'track_drum', time: 576, duration: 48, pitch: 1, velocity: 105 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 4, len: 2 }, { t: 2, p: 6, len: 2 }, { t: 4, p: 5, len: 2 }, { t: 6, p: 4, len: 2 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 2, r: 1 }, { t: 4, r: 0 }, { t: 6, r: 1 }
      ]
    }
  },

  // 8. Raga & Tabla Fusion
  {
    id: 'raga_tabla',
    title: 'Raga & Tabla Fusion',
    category: 'World',
    description: 'Indian classical Bhairav scale sitar synthesis with physically modeled Bayan & Dayan tabla.',
    bpm: 96,
    keyName: 'Bhairav Raga (C)',
    badgeColor: '#e599f7',
    tags: ['Physical Tabla', 'Pluck Synth', 'Pitch Bends'],
    scaleLock: { enabled: true, root: 0, mode: 'custom', customIntervals: [0, 1, 4, 5, 7, 8, 11], accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Sitar Lead',
        instrument: 'synth',
        volume: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#e599f7',
        collapsed: true,
        synthPreset: 'pluck',
        delayTime: 0.35,
        delayFeedback: 0.3
      },
      {
        id: 'track_drum',
        name: 'Physical Tabla',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#cc5de8',
        collapsed: true,
        drumKit: 'tabla',
        delayTime: 0.25,
        delayFeedback: 0.15
      }
    ],
    notes: [
      { id: 'rt_n1', trackId: 'track_synth', time: 0, duration: 96, pitch: 60, velocity: 85 },
      { id: 'rt_n2', trackId: 'track_synth', time: 96, duration: 96, pitch: 61, velocity: 80 },
      { id: 'rt_n3', trackId: 'track_synth', time: 192, duration: 96, pitch: 64, velocity: 90 },
      { id: 'rt_n4', trackId: 'track_synth', time: 288, duration: 96, pitch: 65, velocity: 85 },
      { id: 'rt_n5', trackId: 'track_synth', time: 384, duration: 192, pitch: 67, velocity: 95 },
      { id: 'rt_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 100 },
      { id: 'rt_d2', trackId: 'track_drum', time: 96, duration: 48, pitch: 2, velocity: 90 },
      { id: 'rt_d3', trackId: 'track_drum', time: 192, duration: 48, pitch: 1, velocity: 95 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 2, len: 2 }, { t: 2, p: 3, len: 2 }, { t: 4, p: 5, len: 2 }, { t: 6, p: 6, len: 2 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 2, r: 2 }, { t: 4, r: 1 }
      ]
    }
  },

  // 9. 19-EDO Microtonal Explorer
  {
    id: '19edo',
    title: '19-EDO Microtonal Explorer',
    category: 'Experimental',
    description: 'Pure 19 Equal Divisions of the Octave with true neutral thirds and microtonal steps.',
    bpm: 110,
    keyName: '19-EDO Neutral',
    badgeColor: '#20c997',
    tags: ['19-EDO Tuning', 'Microtonal Grid', 'Harmonics'],
    scaleLock: { enabled: false, root: 0, mode: 'major', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: '19-EDO Synth',
        instrument: 'synth',
        volume: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#20c997',
        collapsed: true,
        synthPreset: 'warm',
        edoDivision: 19,
        edoPreset: '19-edo',
        delayTime: 0.25,
        delayFeedback: 0.25
      },
      {
        id: 'track_drum',
        name: 'Percussion',
        instrument: 'drum',
        volume: 0.95,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#12b886',
        collapsed: true,
        drumKit: 'tight',
        delayTime: 0.25,
        delayFeedback: 0.1
      }
    ],
    notes: [
      { id: 'me_n1', trackId: 'track_synth', time: 0, duration: 96, pitch: 60, velocity: 85 },
      { id: 'me_n2', trackId: 'track_synth', time: 96, duration: 96, pitch: 60 + (12/19)*3, velocity: 88 },
      { id: 'me_n3', trackId: 'track_synth', time: 192, duration: 96, pitch: 60 + (12/19)*6, velocity: 90 },
      { id: 'me_n4', trackId: 'track_synth', time: 288, duration: 96, pitch: 60 + (12/19)*9, velocity: 85 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 2, len: 2 }, { t: 2, p: 4, len: 2 }, { t: 4, p: 6, len: 2 }, { t: 6, p: 7, len: 2 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 4, r: 1 }
      ]
    }
  },

  // 10. Physical String Resonator
  {
    id: 'physical_strings',
    title: 'Physical String Resonator',
    category: 'Experimental',
    description: 'Real-time Karplus-Strong differential acoustic string model with natural decay.',
    bpm: 100,
    keyName: 'C Major',
    badgeColor: '#74c0fc',
    tags: ['Karplus-Strong', 'Physical Decay', 'Acoustic Wood'],
    scaleLock: { enabled: true, root: 0, mode: 'major', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Modeled String',
        instrument: 'synth',
        volume: 0.95,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#74c0fc',
        collapsed: true,
        synthPreset: 'physical',
        delayTime: 0.3,
        delayFeedback: 0.2
      },
      {
        id: 'track_drum',
        name: 'Wood Percussion',
        instrument: 'drum',
        volume: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#4dabf7',
        collapsed: true,
        drumKit: 'acoustic',
        delayTime: 0.25,
        delayFeedback: 0.15
      }
    ],
    notes: [
      { id: 'ps_n1', trackId: 'track_synth', time: 0, duration: 192, pitch: 60, velocity: 95 },
      { id: 'ps_n2', trackId: 'track_synth', time: 192, duration: 96, pitch: 64, velocity: 85 },
      { id: 'ps_n3', trackId: 'track_synth', time: 288, duration: 96, pitch: 67, velocity: 90 },
      { id: 'ps_n4', trackId: 'track_synth', time: 384, duration: 192, pitch: 72, velocity: 100 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 3, len: 3 }, { t: 3, p: 5, len: 2 }, { t: 5, p: 7, len: 3 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 4, r: 1 }
      ]
    }
  },

  // 11. Bach Polyphonic Invention
  {
    id: 'bach',
    title: 'Bach Polyphonic Invention',
    category: 'Acoustic',
    description: 'Baroque two-part polyphonic counterpoint in D Minor with crisp, bright timbre.',
    bpm: 108,
    keyName: 'D Minor',
    badgeColor: '#ffe066',
    tags: ['Counterpoint', 'Baroque', 'Harpsichord'],
    scaleLock: { enabled: true, root: 2, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Upper Voice',
        instrument: 'synth',
        volume: 0.9,
        pan: -0.2,
        muted: false,
        soloed: false,
        color: '#ffe066',
        collapsed: true,
        synthPreset: 'bright',
        delayTime: 0.2,
        delayFeedback: 0.1
      },
      {
        id: 'track_synth_lower',
        name: 'Lower Voice',
        instrument: 'synth',
        volume: 0.9,
        pan: 0.2,
        muted: false,
        soloed: false,
        color: '#fcc419',
        collapsed: true,
        synthPreset: 'piano',
        delayTime: 0.2,
        delayFeedback: 0.1
      }
    ],
    notes: [
      { id: 'bc_n1', trackId: 'track_synth', time: 0, duration: 48, pitch: 62, velocity: 85 },
      { id: 'bc_n2', trackId: 'track_synth', time: 48, duration: 48, pitch: 64, velocity: 85 },
      { id: 'bc_n3', trackId: 'track_synth', time: 96, duration: 48, pitch: 65, velocity: 90 },
      { id: 'bc_n4', trackId: 'track_synth', time: 144, duration: 48, pitch: 67, velocity: 85 },
      { id: 'bc_n5', trackId: 'track_synth', time: 192, duration: 96, pitch: 69, velocity: 95 },
      { id: 'bc_l1', trackId: 'track_synth_lower', time: 192, duration: 48, pitch: 50, velocity: 80 },
      { id: 'bc_l2', trackId: 'track_synth_lower', time: 240, duration: 48, pitch: 52, velocity: 80 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 3, len: 1 }, { t: 1, p: 4, len: 1 }, { t: 2, p: 5, len: 1 }, { t: 3, p: 6, len: 1 }, { t: 4, p: 7, len: 2 }
      ],
      drum: []
    }
  },

  // 12. Heavy Dubstep & Bass
  {
    id: 'dubstep',
    title: 'Heavy Dubstep & Bass',
    category: 'Electronic',
    description: '140 BPM aggressive bit-reduced electronic drums and sub-oscillator growl.',
    bpm: 140,
    keyName: 'F# Minor',
    badgeColor: '#ff922b',
    tags: ['Electro Kit', 'Crunch Crunch', 'Heavy Wobble'],
    scaleLock: { enabled: true, root: 6, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Bass Growl',
        instrument: 'synth',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#ff922b',
        collapsed: true,
        synthPreset: 'bass',
        delayTime: 0.25,
        delayFeedback: 0.15
      },
      {
        id: 'track_drum',
        name: 'Electro Bitcrush Kit',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#fd7e14',
        collapsed: true,
        drumKit: 'electro',
        delayTime: 0.25,
        delayFeedback: 0.1
      }
    ],
    notes: [
      { id: 'ds_n1', trackId: 'track_synth', time: 0, duration: 96, pitch: 42, velocity: 110 },
      { id: 'ds_n2', trackId: 'track_synth', time: 96, duration: 48, pitch: 45, velocity: 105 },
      { id: 'ds_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 120 },
      { id: 'ds_d2', trackId: 'track_drum', time: 192, duration: 48, pitch: 1, velocity: 115 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 2, len: 3 }, { t: 3, p: 4, len: 1 }, { t: 4, p: 2, len: 2 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 4, r: 1 }
      ]
    }
  },

  // 13. Funk & Nu-Disco Groove
  {
    id: 'funk',
    title: 'Funk & Nu-Disco Groove',
    category: 'Dance',
    description: 'Syncopated slap bass, vibrant clavinet, and tight rimshot drum groove.',
    bpm: 118,
    keyName: 'E Minor',
    badgeColor: '#fab005',
    tags: ['Tight Rimshot', 'Slap Bass', 'Syncopated'],
    scaleLock: { enabled: true, root: 4, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Slap Funk Bass',
        instrument: 'synth',
        volume: 0.95,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#fab005',
        collapsed: true,
        synthPreset: 'bass',
        delayTime: 0.25,
        delayFeedback: 0.1
      },
      {
        id: 'track_drum',
        name: 'Tight Funk Kit',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#f59f00',
        collapsed: true,
        drumKit: 'tight',
        delayTime: 0.25,
        delayFeedback: 0.1
      }
    ],
    notes: [
      { id: 'fn_n1', trackId: 'track_synth', time: 0, duration: 48, pitch: 40, velocity: 100 },
      { id: 'fn_n2', trackId: 'track_synth', time: 72, duration: 24, pitch: 40, velocity: 90 },
      { id: 'fn_n3', trackId: 'track_synth', time: 144, duration: 48, pitch: 52, velocity: 105 },
      { id: 'fn_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 110 },
      { id: 'fn_d2', trackId: 'track_drum', time: 192, duration: 48, pitch: 1, velocity: 100 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 2, len: 1 }, { t: 2, p: 6, len: 1 }, { t: 4, p: 2, len: 1 }, { t: 5, p: 3, len: 1 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 2, r: 1 }, { t: 3, r: 0 }, { t: 4, r: 0 }, { t: 6, r: 1 }
      ]
    }
  },

  // 14. Dark Cyber Bass
  {
    id: 'dark_cyber',
    title: 'Dark Cyber Industrial',
    category: 'Electronic',
    description: '132 BPM crushing noise synth lines, aggressive distortion, and industrial hits.',
    bpm: 132,
    keyName: 'B Minor',
    badgeColor: '#e03131',
    tags: ['Electro Dirt', 'Industrial Snare', 'Aggressive'],
    scaleLock: { enabled: true, root: 11, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Industrial Lead',
        instrument: 'synth',
        volume: 0.95,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#e03131',
        collapsed: true,
        synthPreset: 'bright',
        delayTime: 0.25,
        delayFeedback: 0.35
      },
      {
        id: 'track_drum',
        name: 'Electro Beast',
        instrument: 'drum',
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#c92a2a',
        collapsed: true,
        drumKit: 'electro',
        delayTime: 0.25,
        delayFeedback: 0.2
      }
    ],
    notes: [
      { id: 'cb_n1', trackId: 'track_synth', time: 0, duration: 96, pitch: 47, velocity: 105 },
      { id: 'cb_n2', trackId: 'track_synth', time: 96, duration: 48, pitch: 47, velocity: 90 },
      { id: 'cb_n3', trackId: 'track_synth', time: 144, duration: 48, pitch: 50, velocity: 100 },
      { id: 'cb_d1', trackId: 'track_drum', time: 0, duration: 48, pitch: 0, velocity: 115 },
      { id: 'cb_d2', trackId: 'track_drum', time: 192, duration: 48, pitch: 1, velocity: 110 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 3, len: 2 }, { t: 2, p: 3, len: 1 }, { t: 3, p: 4, len: 1 }, { t: 4, p: 3, len: 2 }
      ],
      drum: [
        { t: 0, r: 0 }, { t: 2, r: 1 }, { t: 4, r: 0 }, { t: 6, r: 1 }
      ]
    }
  },

  // 15. Minimalist Piano Etude
  {
    id: 'minimal_piano',
    title: 'Minimalist Piano Etude',
    category: 'Acoustic',
    description: 'Gentle, expressive grand piano arpeggios in C Minor with natural dynamic touch.',
    bpm: 76,
    keyName: 'C Minor',
    badgeColor: '#7950f2',
    tags: ['Acoustic Piano', 'Gentle Arp', 'Clean'],
    scaleLock: { enabled: true, root: 0, mode: 'minor', accidental: 'sharp' },
    tracks: [
      {
        id: 'track_synth',
        name: 'Grand Piano',
        instrument: 'synth',
        volume: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#7950f2',
        collapsed: true,
        synthPreset: 'piano',
        delayTime: 0.4,
        delayFeedback: 0.2
      }
    ],
    notes: [
      { id: 'mp_n1', trackId: 'track_synth', time: 0, duration: 96, pitch: 60, velocity: 75 },
      { id: 'mp_n2', trackId: 'track_synth', time: 96, duration: 96, pitch: 63, velocity: 70 },
      { id: 'mp_n3', trackId: 'track_synth', time: 192, duration: 96, pitch: 67, velocity: 78 },
      { id: 'mp_n4', trackId: 'track_synth', time: 288, duration: 96, pitch: 72, velocity: 72 }
    ],
    previewPattern: {
      synth: [
        { t: 0, p: 2, len: 2 }, { t: 2, p: 4, len: 2 }, { t: 4, p: 5, len: 2 }, { t: 6, p: 7, len: 2 }
      ],
      drum: []
    }
  }
]

export function getUserTemplates(): DawTemplate[] {
  try {
    const raw = localStorage.getItem('musegrid_user_templates')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch (e) {}
  return []
}

export function saveUserTemplate(template: DawTemplate): DawTemplate[] {
  try {
    const current = getUserTemplates().filter(t => t.id !== template.id)
    const updated = [template, ...current]
    localStorage.setItem('musegrid_user_templates', JSON.stringify(updated))
    return updated
  } catch (e) {
    return []
  }
}

export function deleteUserTemplate(id: string): DawTemplate[] {
  try {
    const updated = getUserTemplates().filter(t => t.id !== id)
    localStorage.setItem('musegrid_user_templates', JSON.stringify(updated))
    return updated
  } catch (e) {
    return []
  }
}

export function buildPreviewPattern(notes: Note[]): {
  synth: Array<{ t: number; p: number; len: number }>
  drum: Array<{ t: number; r: number }>
} {
  const synth: Array<{ t: number; p: number; len: number }> = []
  const drum: Array<{ t: number; r: number }> = []

  if (!notes || notes.length === 0) {
    return {
      synth: [{ t: 0, p: 3, len: 2 }, { t: 4, p: 5, len: 2 }, { t: 8, p: 4, len: 2 }, { t: 12, p: 2, len: 2 }],
      drum: [{ t: 0, r: 0 }, { t: 4, r: 1 }, { t: 8, r: 0 }, { t: 12, r: 1 }]
    }
  }

  const maxTime = Math.max(768, ...notes.map(n => n.time + (n.duration || 48)))
  const synthNotes = notes.filter(n => !(n.trackId && n.trackId.toLowerCase().includes('drum')))
  const drumNotes = notes.filter(n => Boolean(n.trackId && n.trackId.toLowerCase().includes('drum')))

  synthNotes.slice(0, 24).forEach(n => {
    const t = Math.min(15, Math.max(0, Math.floor((n.time / maxTime) * 16)))
    const p = Math.max(0, Math.min(7, Math.floor(((n.pitch % 24) / 24) * 8)))
    const len = Math.max(1, Math.min(4, Math.round(((n.duration || 48) / maxTime) * 16)))
    synth.push({ t, p, len })
  })

  drumNotes.slice(0, 24).forEach(n => {
    const t = Math.min(15, Math.max(0, Math.floor((n.time / maxTime) * 16)))
    const r = Math.max(0, Math.min(4, n.pitch % 5))
    drum.push({ t, r })
  })

  return { synth, drum }
}
