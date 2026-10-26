import { create } from 'zustand'
import type { DrumKit, SynthPreset } from '../utils/instruments'
import { BUILT_IN_FX_LABELS, getTrackFxInstances, isBuiltInFxType } from './fxDefaults'

/** Per-note sound override: a built-in preset, a drum kit, or a hosted VST3 instrument. */
export type InstrumentOverride = SynthPreset | DrumKit | `vst3:${string}`

export interface Note {
  id: string
  trackId: string
  time: number
  duration: number
  pitch: number
  velocity: number
  bpm?: number
  instrumentOverride?: InstrumentOverride
  /** Per-note FX chain. When present this replaces the track rack for this note. */
  fxInstances?: FxInstance[]
  fxSettings?: Record<string, Record<string, number>>
  velocityInspectorModified?: boolean
  completeNotesOnPause?: boolean
  detune?: number
  pitchOffset?: number // Semitone offset for drum hits (-24 to +24)
  pitchEnd?: number // The ending pitch (highest pitch if extended)

  // MPE & Micro-Expression Properties
  pitchSlide?: number;      // Semitone offset from this note's own pitch (unbounded)
  pitchSlideTime?: number;  // Slide duration (in ticks, 0 = whole note)
  pitchSlideRamp?: 'linear' | 'exponential' | 'logarithmic' | 'sigmoid' | 'custom';
  pitchSlideCustomCurve?: string;
  glideStyle?: 'smooth' | 'stepped'; // Per-note override of the track glide style
  vibratoDepth?: number;    // Cents of pitch wobble
  vibratoRate?: number;     // Speed of pitch wobble (Hz)
  vibratoDelay?: number;    // Milliseconds before vibrato starts
  vibratoFade?: number;     // Milliseconds for vibrato to reach full depth
  vibratoWave?: 'sine' | 'triangle' | 'square';
  filterStart?: number;     // Starting cutoff frequency (Hz)
  filterEnd?: number;       // Ending cutoff frequency (Hz)
  filterSweepTime?: number; // How fast it sweeps (in ticks, 0 = whole note)
  filterSweepRamp?: 'linear' | 'exponential' | 'logarithmic' | 'sigmoid';
  tremoloDepth?: number;    // Percentage of volume dip (0 to 1)
  tremoloRate?: number;     // Speed of tremolo (Hz)
  tremoloWave?: 'sine' | 'triangle' | 'square'
  /** Target of a multi-note glide chain, used to draw the on-grid connector. */
  glideToNoteId?: string;
  /**
   * Which instrument performs the glide into glideToNoteId.
   * 'source' (default) ramps this note's own voice; 'destination' starts the next note
   * early at this note's pitch so the next note's instrument carries the glide;
   * 'morph' starts the next note early too but crossfades the two instruments across
   * the ramp instead of muting the source immediately.
   */
  glideVoice?: 'source' | 'destination' | 'morph';

  /** Per-note pan trim in -1..1, applied on top of the track pan. */
  pan?: number;

  // Vocal properties
  lyric?: string            // Syllable/phonetic text (e.g. "la", "do")
  voicePresetId?: string    // Refers to a VoicePreset
}

export interface AutomationPoint {
  id: string
  time: number
  value: number
}

/** What the track's automation lane drives. Values are still 1..127 in the lane. */
export type AutomationTarget = 'velocity' | 'volume' | 'pan' | `vst3:${number}`

export function deduplicateNotes(notesList: Note[]): Note[] {
  if (!notesList || notesList.length === 0) return []

  // Safe lazy lookup of store settings
  let overlapThreshold = 0.5
  let proximityTolerance = 12
  try {
    const state = useStore.getState()
    if (state) {
      if (state.deduplicateEnabled === false) {
        return notesList
      }
      if (typeof state.deduplicateOverlapThreshold === 'number') {
        overlapThreshold = state.deduplicateOverlapThreshold
      }
      if (typeof state.deduplicateProximityTolerance === 'number') {
        proximityTolerance = state.deduplicateProximityTolerance
      }
    }
  } catch (e) {
    // Fallback if store is not yet initialized
  }

  // Sort notes by time chronologically
  const sorted = [...notesList].sort((a, b) => a.time - b.time)
  const result: Note[] = []

  for (const note of sorted) {
    // Find if we already have an overlapping/too-close note in result
    const duplicateIdx = result.findIndex(existing => {
      // Notes on different tracks should never be deduplicated!
      if (existing.trackId !== note.trackId) return false

      // For free-pitch, we check if they overlap in both time AND pitch.
      const existingMinPitch = Math.min(existing.pitch, existing.pitchEnd ?? existing.pitch)
      const existingMaxPitch = Math.max(existing.pitch, existing.pitchEnd ?? existing.pitch)
      const noteMinPitch = Math.min(note.pitch, note.pitchEnd ?? note.pitch)
      const noteMaxPitch = Math.max(note.pitch, note.pitchEnd ?? note.pitch)

      // Time overlap logic
      const overlapStart = Math.max(existing.time, note.time)
      const overlapEnd = Math.min(existing.time + existing.duration, note.time + note.duration)
      const timeOverlaps = overlapStart < overlapEnd || existing.time === note.time || Math.abs(existing.time - note.time) < proximityTolerance

      // Pitch overlap logic (default threshold is 0 for point pitches, but we use verticalMergeThreshold from state if available)
      let vertThresh = 0.5
      try {
        const state = useStore.getState()
        if (state && typeof state.verticalMergeThreshold === 'number') vertThresh = state.verticalMergeThreshold
      } catch (e) { }

      // If they don't overlap in time, they don't merge.
      if (!timeOverlaps) return false

      // If they are exactly the same pitch (standard horizontal merge)
      if (existing.pitch === note.pitch && existingMinPitch === existingMaxPitch && noteMinPitch === noteMaxPitch) {
        if (existing.time === note.time) return true
        if (Math.abs(existing.time - note.time) < proximityTolerance) return true
        if (overlapStart < overlapEnd) {
          const overlapLen = overlapEnd - overlapStart
          const minLen = Math.min(existing.duration, note.duration)
          if (overlapLen > minLen * overlapThreshold) return true
        }
        return false
      }

      // Vertical merge logic (if pitchSnap is false, or if we have pitch ranges)
      let pitchSnapEnabled = true
      try {
        const state = useStore.getState()
        if (state) pitchSnapEnabled = state.pitchSnapEnabled
      } catch (e) { }

      if (!pitchSnapEnabled || existingMinPitch !== existingMaxPitch || noteMinPitch !== noteMaxPitch) {
        const pitchOverlapStart = Math.max(existingMinPitch, noteMinPitch)
        const pitchOverlapEnd = Math.min(existingMaxPitch, noteMaxPitch)
        if (pitchOverlapStart < pitchOverlapEnd) {
          const pitchOverlapLen = pitchOverlapEnd - pitchOverlapStart
          const minPitchLen = Math.min(existingMaxPitch - existingMinPitch, noteMaxPitch - noteMinPitch)
          // If point pitches perfectly intersect, or if they overlap beyond threshold
          if (minPitchLen === 0 && pitchOverlapLen === 0 && existingMinPitch === noteMinPitch) return true
          if (pitchOverlapLen > minPitchLen * vertThresh || pitchOverlapLen > 0.01) return true
        }
      }

      return false
    })

    if (duplicateIdx !== -1) {
      // Merge them: keep the one already in result, but span both!
      const existing = result[duplicateIdx]
      const existingMinPitch = Math.min(existing.pitch, existing.pitchEnd ?? existing.pitch)
      const existingMaxPitch = Math.max(existing.pitch, existing.pitchEnd ?? existing.pitch)
      const noteMinPitch = Math.min(note.pitch, note.pitchEnd ?? note.pitch)
      const noteMaxPitch = Math.max(note.pitch, note.pitchEnd ?? note.pitch)

      const mergedMinPitch = Math.min(existingMinPitch, noteMinPitch)
      const mergedMaxPitch = Math.max(existingMaxPitch, noteMaxPitch)
      const mergedStart = Math.min(existing.time, note.time)
      const mergedEnd = Math.max(existing.time + existing.duration, note.time + note.duration)

      result[duplicateIdx] = {
        ...existing,
        time: mergedStart,
        duration: mergedEnd - mergedStart,
        velocity: Math.max(existing.velocity, note.velocity),
        pitch: mergedMinPitch,
        pitchEnd: mergedMaxPitch === mergedMinPitch ? undefined : mergedMaxPitch
      }
    } else {
      result.push(note)
    }
  }

  return result
}

export interface DrumRowConfig {
  name: string
  pitch: number
  color: string
  defaultName?: string
}

export const DEFAULT_DRUM_ROWS: DrumRowConfig[] = [
  { name: 'Rimshot', pitch: 15, color: '#ff6b6b', defaultName: 'Rimshot' },
  { name: 'Claves', pitch: 14, color: '#f06595', defaultName: 'Claves' },
  { name: 'Hi-Conga', pitch: 13, color: '#da77f2', defaultName: 'Hi-Conga' },
  { name: 'Lo-Conga', pitch: 12, color: '#ae3ec9', defaultName: 'Lo-Conga' },
  { name: 'Tambourine', pitch: 11, color: '#7048e8', defaultName: 'Tambourine' },
  { name: 'Cowbell', pitch: 10, color: '#4c6ef5', defaultName: 'Cowbell' },
  { name: 'Ride Cymbal', pitch: 9, color: '#228be6', defaultName: 'Ride Cymbal' },
  { name: 'Crash Cymbal', pitch: 8, color: '#15aabf', defaultName: 'Crash Cymbal' },
  { name: 'High Tom', pitch: 7, color: '#12b886', defaultName: 'High Tom' },
  { name: 'Mid Tom', pitch: 6, color: '#40c057', defaultName: 'Mid Tom' },
  { name: 'Low Tom', pitch: 5, color: '#82c91e', defaultName: 'Low Tom' },
  { name: 'Hand Clap', pitch: 4, color: '#fab005', defaultName: 'Hand Clap' },
  { name: 'Open Hi-Hat', pitch: 3, color: '#fd7e14', defaultName: 'Open Hi-Hat' },
  { name: 'Closed Hi-Hat', pitch: 2, color: '#ff922b', defaultName: 'Closed Hi-Hat' },
  { name: 'Snare Drum', pitch: 1, color: '#fa5252', defaultName: 'Snare Drum' },
  { name: 'Kick Drum', pitch: 0, color: '#ff6b6b', defaultName: 'Kick Drum' },
]

export interface CustomDrumRow {
  id: string
  trackId: string
  name: string
  syntheticPitch: number
  drumA: number // pitch of drum A (0-15)
  drumB: number // pitch of drum B (0-15)
  proportion: number // 0 to 1, where 0 is 100% drum A, 1 is 100% drum B
}



export interface VoicePreset {
  id: string
  name: string
  vocalTractLength: number // 0.7 to 1.5 (scales tract length / formant frequencies)
  breathiness: number      // 0.0 to 1.0 (aspiration noise source mix)
  glottalTension: number   // 0.0 to 1.0 (vocal fold tension / spectral tilt)
  vibratoDepth: number     // 0 to 120 cents
  vibratoRate: number      // 1 to 10 Hz
  vibratoDelay?: number    // 0 to 400 ms onset delay
  jitter: number           // 0 to 1.0 (frequency variation)
  shimmer: number          // 0 to 1.0 (amplitude variation)
  formantShiftF1: number   // +/- 600 Hz offset
  formantShiftF2: number   // +/- 600 Hz offset
  formantShiftF3: number   // +/- 600 Hz offset
  formantShiftF4?: number  // +/- 600 Hz offset
  formantShiftF5?: number  // +/- 600 Hz offset
  consonantVolume?: number // 0.0 to 3.0 (scales consonant burst volume)
  consonantLength?: number // 0.2 to 3.0 (scales consonant noise duration)
  articulationSpeed?: number // 0.2 to 3.0 (scales transition sweep rate)
  synthesisMode?: 'waveguide' | 'fof' | 'formant' // vocal engine selection

  // === PINK TROMBONE PHYSICAL MODEL PARAMETERS ===
  tongueIndex?: number            // 12 to 40 (constriction location along the tract)
  tongueDiameter?: number         // 0.5 to 4.5 cm (tongue constriction aperture)
  lipDiameter?: number            // 0.2 to 4.0 cm (lip aperture)
  tongueShaping?: boolean         // true once the user edits the tongue/lip knobs; defaults leave the vowel's own tract intact
  velumOpening?: number           // 0.0 to 1.0 (nasal port coupling)
  constrictionTurbulence?: number // 0.0 to 2.5x (frication noise injected at constriction)
  plosiveBurstGain?: number       // 0.0 to 2.0x (stop release pressure pop)
  lipReflection?: number          // -0.98 to -0.50 (open acoustic radiation reflection)
  glottalReflection?: number      // 0.40 to 0.98 (vocal fold reflection)
  tubeSections?: number           // 16 to 44 (spatial waveguide resolution)
  waveguideDamping?: number       // 0.85 to 1.00 (tissue wall absorption)
  antiClickFade?: boolean         // sub-ms micro-fade boundary
  bufferEnvelopeEnabled?: boolean // direct sample-level amplitude envelope
  bufferAttackMs?: number         // attack in ms (0 to 100)
  bufferReleaseMs?: number        // release in ms (0 to 100)

  // === FOF (IRCAM CHANT) FORMANT WAVE PACKET PARAMETERS ===
  fofF1?: number                  // F1 center frequency (Hz)
  fofF2?: number                  // F2 center frequency (Hz)
  fofF3?: number                  // F3 center frequency (Hz)
  fofF4?: number                  // F4 center frequency (Hz)
  fofF5?: number                  // F5 center frequency (Hz)
  fofBw1?: number                 // F1 bandwidth (Hz)
  fofBw2?: number                 // F2 bandwidth (Hz)
  fofBw3?: number                 // F3 bandwidth (Hz)
  fofBw4?: number                 // F4 bandwidth (Hz)
  fofBw5?: number                 // F5 bandwidth (Hz)
  fofAmp1?: number                // F1 amplitude (dB)
  fofAmp2?: number                // F2 amplitude (dB)
  fofAmp3?: number                // F3 amplitude (dB)
  fofAmp4?: number                // F4 amplitude (dB)
  fofAmp5?: number                // F5 amplitude (dB)
  fofAttackMs?: number            // FOF skirt rise time Tex (0.5 to 8.0 ms, controls spectral brightness)
  fofSkirtDamping?: number        // high-frequency damping factor (0.5 to 2.0)
  fofDiphthongMorph?: number      // vowel transition smoothness (0.2 to 3.0)
}

export const DEFAULT_VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'soprano',
    name: 'Soprano (Pink Trombone)',
    vocalTractLength: 1.15,
    breathiness: 0.1,
    glottalTension: 0.85,
    vibratoDepth: 35,
    vibratoRate: 6.2,
    vibratoDelay: 80,
    jitter: 0.12,
    shimmer: 0.1,
    formantShiftF1: 0,
    formantShiftF2: 0,
    formantShiftF3: 0,
    consonantVolume: 1.0,
    consonantLength: 1.0,
    articulationSpeed: 1.0,
    synthesisMode: 'waveguide',
    tongueIndex: 28,
    tongueDiameter: 2.2,
    lipDiameter: 1.8,
    velumOpening: 0.0,
    constrictionTurbulence: 1.0,
    plosiveBurstGain: 1.0,
    lipReflection: -0.85,
    glottalReflection: 0.82,
    tubeSections: 22,
    waveguideDamping: 0.99
  },
  {
    id: 'chant-celestial',
    name: 'Celestial Choir (FOF CHANT)',
    vocalTractLength: 1.0,
    breathiness: 0.08,
    glottalTension: 0.88,
    vibratoDepth: 45,
    vibratoRate: 5.6,
    vibratoDelay: 100,
    jitter: 0.08,
    shimmer: 0.08,
    formantShiftF1: 0,
    formantShiftF2: 0,
    formantShiftF3: 0,
    consonantVolume: 1.1,
    consonantLength: 1.0,
    articulationSpeed: 1.1,
    synthesisMode: 'fof',
    fofAttackMs: 2.2,
    fofSkirtDamping: 1.0,
    fofDiphthongMorph: 1.0,
    fofBw1: 75,
    fofBw2: 90,
    fofBw3: 120,
    fofBw4: 140,
    fofBw5: 160
  },
  {
    id: 'tenor',
    name: 'Tenor (Pink Trombone)',
    vocalTractLength: 0.95,
    breathiness: 0.08,
    glottalTension: 0.8,
    vibratoDepth: 40,
    vibratoRate: 5.8,
    vibratoDelay: 90,
    jitter: 0.12,
    shimmer: 0.12,
    formantShiftF1: 0,
    formantShiftF2: 0,
    formantShiftF3: 0,
    consonantVolume: 1.0,
    consonantLength: 1.0,
    articulationSpeed: 1.0,
    synthesisMode: 'waveguide',
    tongueIndex: 26,
    tongueDiameter: 2.5,
    lipDiameter: 1.6,
    velumOpening: 0.0,
    constrictionTurbulence: 1.0,
    plosiveBurstGain: 1.0,
    lipReflection: -0.85,
    glottalReflection: 0.82,
    tubeSections: 22,
    waveguideDamping: 0.99
  },
  {
    id: 'opera-fof',
    name: 'Operatic Baritone (FOF)',
    vocalTractLength: 0.90,
    breathiness: 0.06,
    glottalTension: 0.92,
    vibratoDepth: 55,
    vibratoRate: 5.4,
    vibratoDelay: 110,
    jitter: 0.07,
    shimmer: 0.09,
    formantShiftF1: -30,
    formantShiftF2: -40,
    formantShiftF3: 0,
    consonantVolume: 1.2,
    consonantLength: 1.0,
    articulationSpeed: 1.0,
    synthesisMode: 'fof',
    fofAttackMs: 1.8,
    fofSkirtDamping: 0.9,
    fofDiphthongMorph: 1.0,
    fofBw1: 70,
    fofBw2: 85,
    fofBw3: 110,
    fofBw4: 135,
    fofBw5: 150
  },
  {
    id: 'child',
    name: 'Child (Pink Trombone)',
    vocalTractLength: 1.35,
    breathiness: 0.15,
    glottalTension: 0.9,
    vibratoDepth: 15,
    vibratoRate: 7.0,
    vibratoDelay: 60,
    jitter: 0.20,
    shimmer: 0.15,
    formantShiftF1: 50,
    formantShiftF2: 50,
    formantShiftF3: 0,
    consonantVolume: 1.0,
    consonantLength: 1.0,
    articulationSpeed: 1.1,
    synthesisMode: 'waveguide',
    tongueIndex: 30,
    tongueDiameter: 2.0,
    lipDiameter: 2.0,
    velumOpening: 0.0,
    constrictionTurbulence: 1.0,
    plosiveBurstGain: 1.0,
    lipReflection: -0.85,
    glottalReflection: 0.82,
    tubeSections: 20,
    waveguideDamping: 0.99
  },
  {
    id: 'robot',
    name: 'Robot (Classic Formant)',
    vocalTractLength: 1.0,
    breathiness: 0.0,
    glottalTension: 0.5,
    vibratoDepth: 0,
    vibratoRate: 5.0,
    vibratoDelay: 0,
    jitter: 0.0,
    shimmer: 0.0,
    formantShiftF1: 0,
    formantShiftF2: 0,
    formantShiftF3: 0,
    consonantVolume: 1.0,
    consonantLength: 1.0,
    articulationSpeed: 1.0,
    synthesisMode: 'formant',
    waveguideDamping: 0.99
  }
]

export interface GrooveTemplate {
  id: string
  name: string
  steps: {
    timingOffset: number // positive = late, negative = early (in ticks)
    velocityOffset: number // positive = harder, negative = softer
  }[] // Usually 16 steps for a 1-bar 16th-note loop
}

export const defaultGrooveTemplates: GrooveTemplate[] = [
  {
    id: 'groove-mpc-60',
    name: 'MPC 60 Swing (16ths)',
    steps: [
      { timingOffset: 0, velocityOffset: 5 },   // 1 (Downbeat)
      { timingOffset: 6, velocityOffset: -5 },  // e (Late)
      { timingOffset: 0, velocityOffset: 2 },   // & (On-grid)
      { timingOffset: 6, velocityOffset: -5 },  // a (Late)
      { timingOffset: 0, velocityOffset: 5 },   // 2
      { timingOffset: 6, velocityOffset: -5 },
      { timingOffset: 0, velocityOffset: 2 },
      { timingOffset: 6, velocityOffset: -5 },
      { timingOffset: 0, velocityOffset: 5 },   // 3
      { timingOffset: 6, velocityOffset: -5 },
      { timingOffset: 0, velocityOffset: 2 },
      { timingOffset: 6, velocityOffset: -5 },
      { timingOffset: 0, velocityOffset: 5 },   // 4
      { timingOffset: 6, velocityOffset: -5 },
      { timingOffset: 0, velocityOffset: 2 },
      { timingOffset: 6, velocityOffset: -5 },
    ]
  },
  {
    id: 'groove-dilla',
    name: 'Dilla Drunk (Late 2s & 4s)',
    steps: [
      { timingOffset: -2, velocityOffset: 10 }, // 1 (Early)
      { timingOffset: 0, velocityOffset: -5 },
      { timingOffset: 2, velocityOffset: 0 },
      { timingOffset: 0, velocityOffset: -5 },
      { timingOffset: 8, velocityOffset: 15 },  // 2 (Very Late Snare)
      { timingOffset: 0, velocityOffset: -5 },
      { timingOffset: 2, velocityOffset: 0 },
      { timingOffset: 0, velocityOffset: -5 },
      { timingOffset: -2, velocityOffset: 10 }, // 3 (Early)
      { timingOffset: 0, velocityOffset: -5 },
      { timingOffset: 2, velocityOffset: 0 },
      { timingOffset: 0, velocityOffset: -5 },
      { timingOffset: 8, velocityOffset: 15 },  // 4 (Very Late Snare)
      { timingOffset: 0, velocityOffset: -5 },
      { timingOffset: 2, velocityOffset: 0 },
      { timingOffset: 0, velocityOffset: -5 },
    ]
  },
  {
    id: 'groove-house',
    name: 'House Shuffle (Upbeat Accents)',
    steps: [
      { timingOffset: 0, velocityOffset: -5 },  // 1
      { timingOffset: 0, velocityOffset: -10 },
      { timingOffset: 0, velocityOffset: 15 },  // & (Accented Upbeat)
      { timingOffset: 0, velocityOffset: -10 },
      { timingOffset: 0, velocityOffset: -5 },  // 2
      { timingOffset: 0, velocityOffset: -10 },
      { timingOffset: 0, velocityOffset: 15 },  // &
      { timingOffset: 0, velocityOffset: -10 },
      { timingOffset: 0, velocityOffset: -5 },  // 3
      { timingOffset: 0, velocityOffset: -10 },
      { timingOffset: 0, velocityOffset: 15 },  // &
      { timingOffset: 0, velocityOffset: -10 },
      { timingOffset: 0, velocityOffset: -5 },  // 4
      { timingOffset: 0, velocityOffset: -10 },
      { timingOffset: 0, velocityOffset: 15 },  // &
      { timingOffset: 0, velocityOffset: -10 },
    ]
  }
]

export interface FxInstance {
  id: string
  type: string
  pluginId?: string
  pluginName?: string
}

export interface Vst3PluginInfo {
  name: string
  descriptiveName?: string
  pluginFormatName?: string
  category?: string
  manufacturerName?: string
  version?: string
  isInstrument: boolean
  fileOrIdentifier: string
  uniqueId: string
  numInputChannels?: number
  numOutputChannels?: number
}

export type Vst3InstrumentType = 'synth' | 'drum' | 'both'

export const getPluginInstrumentType = (
  plugin?: { name?: string; descriptiveName?: string; category?: string; fileOrIdentifier?: string; uniqueId?: string | number },
  drumTags?: Record<string, Vst3InstrumentType>
): Vst3InstrumentType => {
  if (!plugin) return 'synth'
  const idStr = plugin.uniqueId !== undefined ? String(plugin.uniqueId) : ''
  if (drumTags && idStr && drumTags[idStr]) {
    return drumTags[idStr]
  }
  const cat = (plugin.category || '').toLowerCase()
  const text = `${plugin.name || ''} ${plugin.descriptiveName || ''} ${plugin.fileOrIdentifier || ''}`.toLowerCase()

  const hasDrum = cat.includes('drum') || cat.includes('percussion') || /(drum|perc|beat|kit|battery|ezdrummer|addictive|sitala|steven slate|mpc|strike|tr-808|tr-909)/i.test(text)
  const hasMelodic = cat.includes('synth') || cat.includes('instrument') || /(guitar|amp|piano|keys|organ|brass|flute|string|synth|lead|poly|workstation|collection|kontakt|sampletank|halion|omnisphere|nexus)/i.test(text)

  if (hasDrum && hasMelodic && /(workstation|collection|complete|suite|bundle|studio instruments)/i.test(text)) {
    return 'both'
  }
  if (cat.includes('drum') || cat.includes('percussion')) return 'drum'
  if (hasMelodic && !hasDrum) return 'synth'
  if (hasDrum) return 'drum'
  return 'synth'
}

export const isPluginDrum = (
  plugin?: { name?: string; descriptiveName?: string; category?: string; fileOrIdentifier?: string; uniqueId?: string | number },
  drumTags?: Record<string, Vst3InstrumentType>
): boolean => {
  if (!plugin) return false
  const type = getPluginInstrumentType(plugin, drumTags)
  return type === 'drum' || type === 'both'
}

export const isPluginSynth = (
  plugin?: { name?: string; descriptiveName?: string; category?: string; fileOrIdentifier?: string; uniqueId?: string | number },
  drumTags?: Record<string, Vst3InstrumentType>
): boolean => {
  if (!plugin) return false
  const type = getPluginInstrumentType(plugin, drumTags)
  return type === 'synth' || type === 'both'
}

export interface FxModulator {
  formula: string
  mode: 'override' | 'add' | 'multiply'
}

export interface CustomFxConfig {
  id: string
  name: string
  mode?: 'realtime' | 'offline'
  code: string
  params: {
    name: string
    label?: string
    min: number
    max: number
    defaultVal: number
  }[]
}

const defaultCustomFxConfigs: CustomFxConfig[] = [
  {
    id: 'custom-bitcrusher',
    name: 'Bitcrush & Dive',
    code: `// Bitcrush & Dive Effect
// Combines hard-clipping drive, quantization, and a lowpass filter sweep (dive)

const bits = params.bits ?? 8;
const drive = params.drive ?? 1.5;
const dive = params.dive ?? 0.5; // 0 to 1 amount
const mix = params.mix ?? 0.5;

const step = Math.pow(0.5, bits);

// Initialize persistent state for our lowpass filter (1-pole)
if (state.lp0 === undefined) state.lp0 = 0;
if (state.lp1 === undefined) state.lp1 = 0;

// Map the dive parameter to a filter cutoff coefficient
const cutoff = Math.max(0.01, 1.0 - dive);

for (let channel = 0; channel < input.length; channel++) {
  const inBuf = input[channel];
  const outBuf = output[channel];
  
  for (let i = 0; i < inBuf.length; i++) {
    // 1. Apply Drive & Hard Clip
    let x = inBuf[i] * drive;
    x = Math.max(-1, Math.min(1, x));
    
    // 2. Apply Bitcrushing (Quantize amplitude)
    x = Math.round(x / step) * step;
    
    // 3. Apply Dive (Lowpass Filter)
    if (channel === 0) {
      state.lp0 += cutoff * (x - state.lp0);
      x = state.lp0;
    } else {
      state.lp1 += cutoff * (x - state.lp1);
      x = state.lp1;
    }
    
    // 4. Dry / Wet Mix
    outBuf[i] = inBuf[i] * (1 - mix) + x * mix;
  }
}`,
    params: [
      { name: 'drive', label: 'Drive', min: 1, max: 10, defaultVal: 1.5 },
      { name: 'bits', label: 'Bits', min: 2, max: 16, defaultVal: 8 },
      { name: 'dive', label: 'Dive', min: 0, max: 0.99, defaultVal: 0.5 },
      { name: 'mix', label: 'Mix', min: 0, max: 1, defaultVal: 0.5 }
    ]
  }
]

export interface DrumPadSample {
  name: string
  audioBase64?: string       // Base64 data URI (data:audio/wav;base64,...)
  dataUri?: string           // Base64 data URI alias
  url?: string               // File path or remote URL
  tuning?: number            // Semitones (-24 to +24)
  fineTune?: number          // Cents (-100 to +100)
  decay?: number             // Envelope decay cutoff / trim in seconds (0.01 to 10)
  startOffset?: number       // Normalized start offset (0 to 1)
  endOffset?: number         // Normalized end offset (0 to 1)
  volume?: number            // Linear gain (0 to 2)
  pan?: number               // Panning (-1 to 1)
  chokeGroup?: number        // 0 = none, 1, 2, 3, 4
  reverse?: boolean          // Reverse playback
}

export interface SynthSamplerConfig {
  name: string
  audioBase64?: string       // Base64 data URI (data:audio/wav;base64,...)
  rootNote: number           // Base root MIDI note (default: 60 = C4)
  tuning: number             // Semitones transpose (-24 to +24)
  fineTune: number           // Cents detune (-100 to +100)
  startOffset: number        // Normalized start offset (0 to 0.99)
  endOffset: number          // Normalized end offset (0.01 to 1.0)
  loop: boolean              // Loop playback while note held
  reverse: boolean           // Reverse sample playback
  attack?: number            // ADSR attack in seconds (0.001 to 2.0)
  decay?: number             // ADSR decay in seconds (0.05 to 5.0)
  sustain?: number           // ADSR sustain (0.0 to 1.0)
  release?: number           // ADSR release in seconds (0.05 to 5.0)
  volume?: number            // Gain multiplier (0 to 2)
  pan?: number               // Panning (-1 to +1)
}

export interface Track {
  id: string
  name: string
  instrument: 'synth' | 'drum' | 'vst3'
  synthMode?: 'synth' | 'sampler'
  synthSampler?: SynthSamplerConfig
  volume: number
  pan: number
  muted: boolean
  soloed: boolean
  hidden?: boolean
  allowMultiTrackSelect?: boolean
  color: string
  collapsed?: boolean
  fxOrder?: ('eq' | 'distortion' | 'chorus' | 'phaser' | 'delay' | 'dpreverb' | 'reverb' | 'freeverb')[]
  fxInstances?: FxInstance[]
  fxSettings?: Record<string, Record<string, number>>
  fxModulators?: Record<string, Record<string, FxModulator>>
  eqLowGain?: number
  eqMidGain?: number
  eqHighGain?: number
  synthPreset?: SynthPreset
  drumKit?: DrumKit
  drumRows?: DrumRowConfig[]
  drumDecays?: Record<number, number>
  customMuxins?: {
    name: string
    engineType: 'Synth' | 'FMSynth' | 'MonoSynth' | 'DrumKit'
    config: any
  }
  scriptedDspId?: string
  // Per-track synth overrides
  synthAttack?: number
  synthDecay?: number
  synthSustain?: number
  synthRelease?: number
  synthOscillator?: 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom'
  synthFormula?: string
  synthPartialsCount?: number
  synthFilterFreq?: number
  synthFilterQ?: number
  synthDetune?: number
  synthPortamento?: number
  synthDecayCurveType?: 'exponential' | 'linear' | 'logarithmic' | 'scurve' | 'custom'
  synthDecayTension?: number
  synthDecayFormula?: string
  drumPadCurves?: Record<number, { type?: string; tension?: number; formula?: string; lut?: number[] }>
  drumPadModes?: Record<number, 'synth' | 'sample'>
  drumPadSamples?: Record<number, DrumPadSample>
  drumOctaves?: Record<number, number>
  drumResonances?: Record<number, number>
  drumPitches?: Record<number, number>
  drumDetunes?: Record<number, number>
  drumSlides?: Record<number, number>
  drumSlideTimes?: Record<number, number>
  // Per-track drum piece overrides (undefined = use kit default)
  drumKickOctaves?: number
  drumKickPitchDecay?: number
  drumKickDecay?: number
  drumSnareDecay?: number
  drumHihatDecay?: number
  drumClapDecay?: number
  drumTomDecay?: number
  drumCrashDecay?: number
  drumRideDecay?: number
  drumCowbellDecay?: number
  drumTambourineDecay?: number
  drumCongaDecay?: number
  drumClavesDecay?: number
  drumRimshotDecay?: number
  drumTambourineTone?: number
  drumCongaPitch?: number
  drumClavesPitch?: number
  drumRimshotTone?: number
  drumSnareTone?: number
  drumHihatTone?: number
  drumHihatResonance?: number
  drumClapTone?: number
  drumCymbalResonance?: number
  drumCymbalTone?: number
  drumCowbellTone?: number
  drumMapShift?: number
  // Per-track effects (wet 0-1, undefined = default 0)
  reverbWet?: number
  reverbDecay?: number   // seconds
  reverbPreDelay?: number // NEW: pre-delay in seconds
  delayWet?: number
  delayTime?: number     // seconds
  delayFeedback?: number // 0-0.9
  distortionWet?: number // 0-1
  distortionAmount?: number // 0-1
  chorusWet?: number     // 0-1
  chorusFrequency?: number // Hz
  chorusDelayTime?: number // NEW: base delay in ms
  chorusDepth?: number     // 0-1
  phaserWet?: number     // 0-1
  phaserFrequency?: number // Hz
  phaserBaseFreq?: number  // NEW: base frequency in Hz
  phaserOctaves?: number   // 1-8
  dpreverbWet?: number      // 0-1
  dpreverbTail?: number     // seconds
  dpreverbDecay?: number    // 0.05-1
  dpreverbTone?: number     // 0-1
  transpose?: number     // semitones
  scaleOverride?: ScaleLock // Per-track scale override
  targetTempo?: number   // The BPM this track wants to use for new notes
  parentId?: string      // The ID of the parent track if this is a subtrack
  // Microtonal Tuning (Synth tracks only)
  edoDivision?: number   // e.g. 12 (standard), 19, 24, 31, 47, 53, or custom N (e.g. 69)
  edoPreset?: '12-edo' | '19-edo' | '24-edo' | '31-edo' | '47-edo' | '53-edo' | 'custom'
  edoRootNote?: number   // Base root MIDI note (default: 60 = C4)
  scalaScaleName?: string // Imported Scala (.scl) tuning title/description
  customScaleCents?: number[] // Custom microtonal scale intervals in cents

  // Physical Modeling Synthesis settings
  pmModelType?: 'string' | 'wind' | 'percussion' | 'custom'
  pmExciterFormula?: string    // Custom mathematical impulse equation
  pmStringStiffness?: number   // 0 to 1
  pmStringDecay?: number       // 0 to 1
  pmPluckHardness?: number     // 0 to 1
  pmBridgeTransmission?: number // 0 to 1
  pmWindJetDelay?: number      // 0 to 1
  pmWindBlowPressure?: number   // 0 to 1
  pmWindDamping?: number       // 0 to 1
  pmPercResonance?: number     // 0 to 1
  pmPercStrikerSpeed?: number   // 0 to 1
  pmPercClarity?: number       // 0 to 1
  customRowOrder?: string[]    // Array of stringified pitches or IDs for custom row map rendering
  vst3InstrumentId?: string
  vst3InstrumentName?: string
  envelopeCurveType?: string
  curveTension?: number
  curveFormula?: string
}

export interface ScaleLock {
  enabled: boolean
  root: number
  mode: string
  accidental: 'sharp' | 'flat'
  customIntervals?: number[]
}

export interface MetronomeSettings {
  pitchDecay: number
  octaves: number
  attack: number
  decay: number
  sustain: number
  release: number
  volume: number
  downbeatPitch: string   // NEW: e.g. 'C6'
  upbeatPitch: string     // NEW: e.g. 'C5'
  downbeatVel: number     // NEW: 0-1
  upbeatVel: number       // NEW: 0-1
}

export interface StudioSettings {
  renderFadeDuration: number  // seconds
  normalizationTarget: number  // dB
  loopEndBuffer: number       // ticks
  masterVolume: number        // 0-1
  limiterEnabled: boolean
  proceduralFxEnabled: boolean
  proceduralFxRate: '16n' | '32n' | '64n' | '128n' | string
  velocityCurveFormula?: string // Global math curve for incoming velocities
  limiterThreshold: number    // dB
  persistenceEnabled: boolean // Whether local storage autosave is active
  sampleRate?: number         // AudioContext sample rate
}

export interface Clip {
  id: string
  trackId: string
  name: string
  startTick: number
  endTick: number
  color: string
  // Generative properties
  generativeType?: 'static' | 'euclidean' | 'cellular' | 'random'
  euclideanSteps?: number
  euclideanPulses?: number
  euclideanOffset?: number
}

export interface TrackGroup {
  id: string
  name: string
  color: string
  trackIds: string[]
  collapsed: boolean
  /** Non-destructive group level controls, applied on top of each track. */
  volume?: number
  muted?: boolean
  soloed?: boolean
}

export type PlayheadFollowMode = 'playhead' | 'grid'

export interface ProjectExportData {
  type: 'wav' | 'mp3' | 'midi' | 'musicxml' | 'muztrack' | 'scala';
  trackId?: string;
  trackIds?: string[];
  octaveOffset: number;
  semitoneOffset: number;
  normalize: boolean;
  includeMetronome: boolean;
  autoFade: boolean;
  isRendering: boolean;
  progress: number;
  renderElapsedSeconds?: number;
  renderTotalSeconds?: number;
  startTick?: number;
  endTick?: number;
  includeProceduralFx?: boolean;
  mp3Kbps?: number;
  bitDepth?: 16 | 24 | 32;
  bounceMode?: 'offline' | 'realtime';
  realtimeTailSeconds?: number;
  exportScalaWithMidi?: boolean;
}

export interface ExportRegion {
  id: string;
  startTick: number;
  endTick: number;
  gap: number; // silence gap in seconds
}

export interface MidiRemapData {
  midi: any | null;
  filename: string;
  drumMap: Record<number, number>; // MIDI Pitch -> Drum Piece (0-4)
  synthMap: Record<number, number>; // MIDI Pitch -> Target MIDI Pitch
  channelStates: Record<number, boolean>; // Channel ID -> Enabled
  octaveOffset: number;
  semitoneOffset: number;
  timeScale: number;
  velocityScale: number;
  velocityOffset: number;
  humanizeTiming: number;
  humanizeVelocity: number;
  repeatCount: number;
  pitchSensitivity: number;
}

export interface AppState {
  projectId: string
  projectName: string | null
  projectFilePath: string | null
  isDirty: boolean
  bpm: number
  completeNotesOnPause: boolean
  isPlaying: boolean
  engineMode: 'tone' | 'wasm'
  setEngineMode: (v: 'tone' | 'wasm') => void
  tracks: Track[]
  notes: Note[]
  playheadPosition: number
  playheadFollowMode: PlayheadFollowMode
  canvasAlignRequest: number
  columnWidths: Record<number, number>
  activeTrackId: string | null
  lastActiveSynthTrackId: string | null
  lastActiveDrumTrackId: string | null
  selectedTrackIds: string[]
  activeTool: 'draw' | 'erase' | 'select' | 'slice' | 'stretch'
  selectedNoteIds: string[]
  clipboard: Note[]
  isRecording: boolean
  history: Note[][]
  historyIndex: number

  // Grid / Quantization
  snapEnabled: boolean
  snapResolution: number  // ticks: 192=1/4, 96=1/8, 48=1/16, 24=1/32
  gridBlockTicks: number
  gridShadeEvery: number

  gridColumnCount: number
  autoExtendGrid: boolean
  synthLowerOctave: number
  synthUpperOctave: number
  minNoteSize: number // ticks: minimum allowed note duration, can be 0

  // Loop
  loopEnabled: boolean
  loopStart: number  // ticks
  loopEnd: number    // ticks

  // Scale lock
  scaleLock: ScaleLock

  // Free Pitch (Vertical Grid)
  pitchSnapEnabled: boolean
  pitchDropSnap: boolean
  pitchSnapSensitivity: number
  verticalMergeThreshold: number
  verticalStretchMode: 'glide' | 'cluster'
  glideStyle: 'smooth' | 'stepped'
  setPitchSnapEnabled: (v: boolean) => void
  setPitchDropSnap: (v: boolean) => void
  setPitchSnapSensitivity: (v: number) => void
  setVerticalMergeThreshold: (v: number) => void
  setVerticalStretchMode: (v: 'glide' | 'cluster') => void
  setGlideStyle: (v: 'smooth' | 'stepped') => void

  customSynthRows: { id: string; trackId: string; name: string; pitch: number }[]
  addCustomSynthRow: (row: { id: string; trackId: string; name: string; pitch: number }) => void
  removeCustomSynthRow: (id: string) => void

  customDrumRows: CustomDrumRow[]
  addCustomDrumRow: (row: CustomDrumRow) => void
  removeCustomDrumRow: (id: string) => void

  // Swing (0-100)
  swing: number

  // Pattern clips
  clips: Clip[]

  // Track groups
  groups: TrackGroup[]

  // Metronome
  metronomeEnabled: boolean
  metronomeVolume: number // 0-1

  // Groove / Humanize
  grooveTemplates: GrooveTemplate[]
  activeGrooveTemplateId: string | null
  grooveTimingStrength: number
  grooveVelocityStrength: number
  grooveExtractionTargetAll: boolean
  quantizeInputEnabled: boolean
  quantizeStrength: number

  // Deduplication settings
  deduplicateEnabled: boolean
  deduplicateOverlapThreshold: number
  deduplicateProximityTolerance: number
  setDeduplicateEnabled: (val: boolean) => void
  setDeduplicateOverlapThreshold: (val: number) => void
  setDeduplicateProximityTolerance: (val: number) => void

  // Automation curves per track. The lane target decides what the stored values mean:
  // note velocity, per-note volume, or per-note pan.
  automationCurves: Record<string, AutomationPoint[]>
  automationTargets: Record<string, AutomationTarget>

  projectRevision: number
  drumSteps: number
  timeSignature: string
  zoomSynth: number
  zoomDrum: number
  syncZoom: boolean
  setSyncZoom: (v: boolean) => void

  projectExportData: ProjectExportData | null
  setProjectExportData: (data: ProjectExportData | null) => void

  exportRegionMode: boolean
  exportRegions: ExportRegion[]
  setExportRegionMode: (mode: boolean) => void
  setExportRegions: (regions: ExportRegion[]) => void
  addExportRegion: (region: ExportRegion) => void
  removeExportRegion: (id: string) => void
  updateExportRegionGap: (id: string, gap: number) => void

  gridSplitOrder: 'synth-first' | 'drum-first'
  gridPaneMode: 'split' | 'synth-only' | 'drum-only' | 'active'
  setGridSplitOrder: (order: 'synth-first' | 'drum-first') => void
  setGridPaneMode: (mode: 'split' | 'synth-only' | 'drum-only' | 'active') => void

  // MIDI Remap
  midiRemapData: MidiRemapData
  setMidiRemapData: (data: Partial<MidiRemapData>) => void

  // Utilities
  utilitySourcePitch: number
  utilityTargetPitch: number
  utilitySourceCol: number
  utilityTargetCol: number
  utilityPicker: { type: 'row' | 'col', slot: 'source' | 'target' } | null
  setUtilitySourcePitch: (v: number) => void
  setUtilityTargetPitch: (v: number) => void
  setUtilitySourceCol: (v: number) => void
  setUtilityTargetCol: (v: number) => void
  setUtilityPicker: (p: { type: 'row' | 'col', slot: 'source' | 'target' } | null) => void

  isScriptingModalVisible: boolean
  setIsScriptingModalVisible: (v: boolean) => void
  isSynthStudioModalVisible: boolean
  setIsSynthStudioModalVisible: (v: boolean) => void
  isDrumDesignerModalVisible: boolean
  setIsDrumDesignerModalVisible: (v: boolean) => void
  scriptContent: string
  setScriptContent: (content: string) => void

  toast: { message: string, type: 'error' | 'info' | 'success' } | null
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void
  clearToast: () => void

  customFxConfigs: CustomFxConfig[]
  addCustomFxConfig: (config: CustomFxConfig) => void
  updateCustomFxConfig: (id: string, updates: Partial<CustomFxConfig>) => void
  deleteCustomFxConfig: (id: string) => void
  addCustomFxToTracks: (configId: string) => void
  addCustomFxToTrack: (trackId: string, configId: string) => void

  vst3Plugins: Vst3PluginInfo[]
  vst3ActivePluginIds: string[]
  vst3DrumTags: Record<string, Vst3InstrumentType>
  vst3Scanning: boolean
  vst3ScanStatus: string
  setVst3Plugins: (plugins: Vst3PluginInfo[]) => void
  toggleVst3Active: (uniqueId: string) => void
  toggleVst3DrumTag: (uniqueId: string) => void
  setVst3Scanning: (scanning: boolean, status?: string) => void

  // Actions
  setBpm: (bpm: number) => void
  setCompleteNotesOnPause: (val: boolean) => void
  setIsPlaying: (v: boolean) => void
  addNote: (note: Note) => void
  updateNote: (id: string, updates: Partial<Note>) => void
  updateNotes: (ids: string[], updates: Partial<Note>) => void
  removeNote: (id: string) => void
  removeNotes: (ids: string[]) => void
  addTrack: (track: Track) => void
  removeTrack: (id: string) => void
  removeTracks: (ids: string[]) => void
  duplicateTracks: (ids: string[]) => void
  toggleTrackVisibility: (id: string) => void
  updateTrack: (id: string, updates: Partial<Track>) => void
  updateTracks: (ids: string[], updates: Partial<Track>) => void
  reorderTrackFX: (trackId: string, startIndex: number, endIndex: number) => void
  duplicateTrackFX: (trackId: string, instanceId: string) => void
  removeTrackFXInstance: (trackId: string, instanceId: string) => void
  updateTrackFXSetting: (trackId: string, instanceId: string, key: string, value: number) => void
  updateTrackFXModulator: (trackId: string, instanceId: string, key: string, config: FxModulator | null) => void
  loopTrack: (trackId: string, mode: 'fillToEnd' | 'perfectCycle' | 'nTimes', snapToBar: boolean, times?: number) => void
  setPlayheadPosition: (pos: number) => void
  setPlayheadFollowMode: (mode: PlayheadFollowMode) => void
  requestCanvasAlign: () => void
  setColumnWidth: (index: number, width: number) => void
  loadState: (state: Partial<AppState>) => void
  setActiveTrackId: (id: string | null) => void
  toggleTrackSelection: (id: string, multi: boolean) => void
  setSelectedTrackIds: (ids: string[]) => void
  setActiveTool: (tool: AppState['activeTool']) => void
  setSelectedNoteIds: (ids: string[]) => void
  setClipboard: (notes: Note[]) => void
  setIsRecording: (v: boolean) => void
  midiOverdub: boolean
  setMidiOverdub: (v: boolean) => void
  clearTrackNotes: (trackId: string) => void
  eraseNotesInRegion: (trackId: string, startTick: number, endTick: number) => void
  setLeftPaneWidth: (w: number) => void
  setSplitRatio: (r: number) => void
  setLeftPaneTopRatio: (r: number) => void
  setIsLeftPaneFlipped: (v: boolean) => void
  getMaxTicks: () => number
  quantizeSelectedNotes: () => void
  dropSnap: boolean
  setDropSnap: (v: boolean) => void
  noteInspectorEnabled: boolean
  setNoteInspectorEnabled: (v: boolean) => void
  isRightPaneVisible: boolean
  setIsRightPaneVisible: (v: boolean) => void
  isHelpPaneVisible: boolean
  setIsHelpPaneVisible: (v: boolean) => void

  // Undo/Redo
  commitHistory: () => void
  undo: () => void
  redo: () => void

  setProjectInfo: (info: Partial<{ projectName: string | null, projectFilePath: string | null }>) => void
  setIsDirty: (v: boolean) => void

  // New controls
  setSnapEnabled: (v: boolean) => void
  setSnapResolution: (v: number) => void
  setGridBlockTicks: (v: number) => void
  setGridShadeEvery: (v: number) => void
  setGridColumnCount: (v: number) => void
  setAutoExtendGrid: (v: boolean) => void
  setSynthLowerOctave: (v: number) => void
  setSynthUpperOctave: (v: number) => void
  setMinNoteSize: (v: number) => void
  setLoopEnabled: (v: boolean) => void
  setLoopStart: (v: number) => void
  setLoopEnd: (v: number) => void
  setScaleLock: (lock: ScaleLock) => void
  setSwing: (v: number) => void
  setZoomSynth: (z: number) => void
  setZoomDrum: (z: number) => void
  resetZoom: () => void
  setMetronomeEnabled: (v: boolean) => void
  setMetronomeVolume: (v: number) => void
  setGrooveTimingStrength: (v: number) => void
  setGrooveVelocityStrength: (v: number) => void
  setActiveGrooveTemplateId: (id: string | null) => void
  setGrooveExtractionTargetAll: (v: boolean) => void
  addGrooveTemplate: (template: GrooveTemplate) => void
  applyGroove: (noteIds: string[]) => void
  extractGroove: (noteIds: string[], name: string) => void
  setQuantizeInputEnabled: (v: boolean) => void
  setQuantizeStrength: (v: number) => void
  setAutomationCurve: (trackId: string, points: AutomationPoint[]) => void
  addAutomationPoint: (trackId: string, point: AutomationPoint) => void
  updateAutomationPoint: (trackId: string, pointId: string, updates: Partial<AutomationPoint>) => void
  removeAutomationPoint: (trackId: string, pointId: string) => void
  clearAutomationCurve: (trackId: string) => void
  setAutomationTarget: (trackId: string, target: AutomationTarget) => void
  bakeProceduralAutomation: (trackId: string, formula: string, preset: string, density: number) => void

  setDrumSteps: (steps: number) => void
  setTimeSignature: (sig: string) => void

  // Clips
  addClip: (clip: Clip) => void
  removeClip: (id: string) => void
  updateClip: (id: string, updates: Partial<Clip>) => void
  generateClipNotes: (clipId: string, overwrite: boolean, pitch: number, velocity: number, duration: number) => void

  // Groups
  addGroup: (group: TrackGroup) => void
  removeGroup: (id: string) => void
  updateGroup: (id: string, updates: Partial<TrackGroup>) => void
  reorderTracks: (startIndex: number, endIndex: number, newParentId?: string | null) => void
  syncTrackSettings: (sourceId: string, targetId: string) => void
  metronomeSettings: MetronomeSettings
  updateMetronome: (updates: Partial<MetronomeSettings>) => void
  studioSettings: StudioSettings
  updateStudio: (updates: Partial<StudioSettings>) => void
  leftPaneWidth: number
  leftPaneCollapsed: boolean
  setLeftPaneCollapsed: (v: boolean) => void
  splitRatio: number
  leftPaneTopRatio: number
  isLeftPaneFlipped: boolean
  showImportAudioModal: boolean
  importAudioTrackId: string | null
  importAudioBuffer: AudioBuffer | null
  setShowImportAudioModal: (show: boolean, trackId?: string | null, buffer?: AudioBuffer | null) => void
  showSynthVelocity: boolean
  isScorePreviewVisible: boolean
  scorePreviewTrackIds: string[]
  setIsScorePreviewVisible: (v: boolean) => void
  setScorePreviewTrackIds: (ids: string[]) => void
  showDrumVelocity: boolean
  vocalVelocityMin: number
  vocalVelocityMax: number
  vocalVelocityScale: number
  vocalVelocityEnabled: boolean
  setShowSynthVelocity: (v: boolean) => void
  setShowDrumVelocity: (v: boolean) => void
  setVocalVelocityMin: (v: number) => void
  setVocalVelocityMax: (v: number) => void
  setVocalVelocityScale: (v: number) => void
  setVocalVelocityEnabled: (v: boolean) => void
  gridResizable: boolean
  setGridResizable: (v: boolean) => void
  horizScrollLockEnabled: boolean
  setHorizScrollLockEnabled: (v: boolean) => void
  vertScrollLockEnabled: boolean
  setVertScrollLockEnabled: (v: boolean) => void
  readOnlyMode: boolean
  setReadOnlyMode: (v: boolean) => void
  bothGridActive: boolean
  setBothGridActive: (v: boolean) => void
  scrollBoth: boolean
  setScrollBoth: (v: boolean) => void
  sharedPanX: number
  setSharedPanX: (x: number) => void
  ghostNotesEnabled: boolean
  setGhostNotesEnabled: (v: boolean) => void
  ghostNoteOpacity: number
  setGhostNoteOpacity: (v: number) => void
  ghostCrossInstrument: boolean
  setGhostCrossInstrument: (v: boolean) => void
  scaleFoldEnabled: boolean
  setScaleFoldEnabled: (v: boolean) => void
  activeChordStamp: string | null
  setActiveChordStamp: (stamp: string | null) => void
  activeMidiEditTab: 'quick' | 'chopArp' | 'pitch' | 'velocity' | 'humanize' | 'select'
  setActiveMidiEditTab: (tab: 'quick' | 'chopArp' | 'pitch' | 'velocity' | 'humanize' | 'select') => void

  // Dedicated Recording & Capture Hub
  recordTargetMode: 'current' | 'new_track'
  setRecordTargetMode: (mode: 'current' | 'new_track') => void
  recordTakeCounter: number
  setRecordTakeCounter: (n: number) => void
  recordCountIn: 0 | 1 | 2
  setRecordCountIn: (bars: 0 | 1 | 2) => void
  countInRemaining: number | null
  setCountInRemaining: (b: number | null) => void
  recordInputQuantize: number // 0 = off, 24 = 1/32, 48 = 1/16, 96 = 1/8, -1 = current grid
  setRecordInputQuantize: (ticks: number) => void
  recordScaleConform: boolean
  setRecordScaleConform: (v: boolean) => void
  recordEdoMappingMode: 'off' | 'linear' | 'harmonic'
  setRecordEdoMappingMode: (mode: 'off' | 'linear' | 'harmonic') => void
  qwertyPianoEnabled: boolean
  setQwertyPianoEnabled: (v: boolean) => void
  qwertyOctave: number
  setQwertyOctave: (oct: number) => void
  qwertyVelocity: number
  setQwertyVelocity: (vel: number) => void
  activeMidiDeviceNames: string[]
  setActiveMidiDeviceNames: (names: string[]) => void
  midiActivityPulse: boolean
  setMidiActivityPulse: (pulse: boolean) => void
  retrospectiveNoteCount: number
  setRetrospectiveNoteCount: (n: number) => void
  recallPlacementMode: 'time_snap' | 'time_free' | 'sequence_columns'
  setRecallPlacementMode: (mode: 'time_snap' | 'time_free' | 'sequence_columns') => void

  // Step Recording & Capture (Column by column / Bar by bar)
  isStepRecording: boolean
  setIsStepRecording: (v: boolean) => void
  stepRecordCursorTick: number
  setStepRecordCursorTick: (tick: number) => void
  advanceStepRecordCursor: (steps?: number) => void
  retreatStepRecordCursor: (steps?: number) => void
  deleteStepRecordCurrentColumn: () => void
  stepRecordAdvanceMode: 'release' | 'timer' | 'manual'
  setStepRecordAdvanceMode: (mode: 'release' | 'timer' | 'manual') => void
  stepRecordStepSize: number // -1 = follow grid snap, or explicit ticks (24, 48, 96, 192, 384, 768)
  setStepRecordStepSize: (ticks: number) => void
  stepRecordStepColumns: number // multiplier in columns (e.g. 1.0, 1.5, 2.0 columns)
  setStepRecordStepColumns: (cols: number) => void
  stepRecordNoteDuration: number // -1 = match step advance, or explicit ticks
  setStepRecordNoteDuration: (ticks: number) => void
  stepRecordNoteColumns: number // multiplier in columns (e.g. 1.0, 1.5, 2.0 columns)
  setStepRecordNoteColumns: (cols: number) => void
  stepRecordGatePercent: number // 10% - 200%, default 100%
  setStepRecordGatePercent: (pct: number) => void
  stepRecordChordSensitivityMs: number // tolerance window for chord keys (20ms - 500ms, default 120ms)
  setStepRecordChordSensitivityMs: (ms: number) => void

  // Vocal Synthesis Presets
  voicePresets: VoicePreset[]
  addVoicePreset: (preset: VoicePreset) => void
  deleteVoicePreset: (id: string) => void
}

export const useStore = create<AppState>((originalSet, get, api) => {
  const set = (
    nextStateOrFn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
    replace?: boolean
  ) => {
    if (typeof nextStateOrFn === 'function') {
      (originalSet as any)((state: AppState) => {
        const next = (nextStateOrFn as (state: AppState) => AppState | Partial<AppState>)(state)
        if (next && next.notes) {
          next.notes = deduplicateNotes(next.notes)
        }
        return next
      }, replace)
    } else {
      const next = nextStateOrFn
      if (next && next.notes) {
        next.notes = deduplicateNotes(next.notes)
      }
      (originalSet as any)(next, replace)
    }
  }

  const originalSetState = api.setState
  api.setState = (
    nextStateOrFn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
    replace?: boolean
  ) => {
    if (typeof nextStateOrFn === 'function') {
      (originalSetState as any)((state: AppState) => {
        const next = (nextStateOrFn as (state: AppState) => AppState | Partial<AppState>)(state)
        if (next && next.notes) {
          next.notes = deduplicateNotes(next.notes)
        }
        return next
      }, replace)
    } else {
      const next = nextStateOrFn
      if (next && next.notes) {
        next.notes = deduplicateNotes(next.notes)
      }
      (originalSetState as any)(next, replace)
    }
  }

  return {
    projectId: Math.random().toString(36).substring(2, 9),
    projectName: null,
    projectFilePath: null,
    isDirty: false,
    bpm: 120,
    completeNotesOnPause: true,
    isPlaying: false,
    engineMode: 'tone',
    tracks: [],
    notes: [],
    playheadPosition: 0,
    playheadFollowMode: 'playhead',
    canvasAlignRequest: 0,
    columnWidths: {},
    activeTrackId: null,
    lastActiveSynthTrackId: null,
    lastActiveDrumTrackId: null,
    selectedTrackIds: [],
    activeTool: 'draw',
    selectedNoteIds: [],
    clipboard: [],
    isRecording: false,
    midiOverdub: true,
    clips: [],
    groups: [],
    automationCurves: {},
    automationTargets: {},
    projectRevision: 0,
    drumSteps: 16,

    history: [],
    historyIndex: -1,

    snapEnabled: true,
    snapResolution: 48, // 1/16 note = 48 ticks
    gridBlockTicks: 48,
    dropSnap: true,
    noteInspectorEnabled: false,
    isRightPaneVisible: false,
    isHelpPaneVisible: false,
    deduplicateEnabled: true,
    deduplicateOverlapThreshold: 0.5,
    deduplicateProximityTolerance: 12,
    gridShadeEvery: 4,
    gridColumnCount: 200,
    autoExtendGrid: true,
    synthLowerOctave: -1,
    synthUpperOctave: 6,
    minNoteSize: 12, // ticks (default to 1/64 note = 12 ticks)
    timeSignature: '4/4',
    zoomSynth: 1.0,
    zoomDrum: 1.0,
    syncZoom: false,
    projectExportData: null,
    exportRegionMode: false,
    exportRegions: [],
    midiRemapData: {
      midi: null,
      filename: '',
      drumMap: {
        35: 0, 36: 0, // Kicks
        38: 1, 40: 1, // Snares
        42: 2, 44: 2, // Hats
        46: 3,        // Open Hat
        49: 4, 51: 4  // Cymbals/Clap
      },
      synthMap: {},
      channelStates: {},
      octaveOffset: 0,
      semitoneOffset: 0,
      timeScale: 1.0,
      velocityScale: 1.0,
      velocityOffset: 0,
      humanizeTiming: 0,
      humanizeVelocity: 0,
      repeatCount: 1,
      pitchSensitivity: 1.0
    },
    leftPaneWidth: 415,
    leftPaneCollapsed: false,
    splitRatio: 0.6,
    leftPaneTopRatio: 0.6,
    isLeftPaneFlipped: false,

    showSynthVelocity: false,
    showDrumVelocity: false,
    vocalVelocityMin: 40,
    vocalVelocityMax: 127,
    vocalVelocityScale: 450,
    vocalVelocityEnabled: true,
    customFxConfigs: (() => {
      try {
        const saved = localStorage.getItem('musegrid_custom_fx_configs')
        if (saved) {
          const parsed = JSON.parse(saved)
          let changed = false
          const migrated = parsed.map((c: any) => {
            if (c.id === 'custom-bitcrusher' && c.params) {
              c.params = c.params.map((p: any) => {
                if (p.name === 'drive' && !p.label) {
                  changed = true
                  return { ...p, label: 'Drive' }
                }
                if (p.name === 'bits' && !p.label) {
                  changed = true
                  return { ...p, label: 'Bits' }
                }
                if (p.name === 'mix' && !p.label) {
                  changed = true
                  return { ...p, label: 'Mix' }
                }
                return p
              })
            }
            return c
          })
          if (changed) {
            localStorage.setItem('musegrid_custom_fx_configs', JSON.stringify(migrated))
          }
          return migrated
        }
        return defaultCustomFxConfigs
      } catch {
        return defaultCustomFxConfigs
      }
    })(),

    vst3Plugins: [],
    vst3ActivePluginIds: (() => {
      try {
        const saved = localStorage.getItem('musegrid_vst3_active_plugins')
        return saved ? JSON.parse(saved) : []
      } catch { return [] }
    })(),
    vst3DrumTags: (() => {
      try {
        const saved = localStorage.getItem('musegrid_vst3_drum_tags')
        return saved ? JSON.parse(saved) : {}
      } catch { return {} }
    })(),
    vst3Scanning: false,
    vst3ScanStatus: '',
    setVst3Plugins: (plugins) => set({ vst3Plugins: plugins }),
    toggleVst3Active: (uniqueId) => {
      const strId = String(uniqueId)
      const current = (get().vst3ActivePluginIds || []).map(String)
      const next = current.includes(strId)
        ? current.filter(id => id !== strId)
        : [...current, strId]
      try { localStorage.setItem('musegrid_vst3_active_plugins', JSON.stringify(next)) } catch {}
      set({ vst3ActivePluginIds: next })
    },
    toggleVst3DrumTag: (uniqueId) => {
      const state = get()
      const strId = String(uniqueId)
      const plugin = (state.vst3Plugins || []).find(p => String(p.uniqueId) === strId)
      const currentTags = state.vst3DrumTags || {}
      const currentType = plugin ? getPluginInstrumentType(plugin, currentTags) : (currentTags[strId] || 'synth')
      const cycle: Record<Vst3InstrumentType, Vst3InstrumentType> = {
        synth: 'drum',
        drum: 'both',
        both: 'synth'
      }
      const nextType = cycle[currentType] || 'synth'
      const nextTags: Record<string, Vst3InstrumentType> = {
        ...currentTags,
        [strId]: nextType
      }
      try { localStorage.setItem('musegrid_vst3_drum_tags', JSON.stringify(nextTags)) } catch {}

      // Auto-activate plugin when tagged so it immediately appears in track cards without extra clicks!
      const activeIds = (state.vst3ActivePluginIds || []).map(String)
      const nextActive = activeIds.includes(strId) ? activeIds : [...activeIds, strId]
      if (!activeIds.includes(strId)) {
        try { localStorage.setItem('musegrid_vst3_active_plugins', JSON.stringify(nextActive)) } catch {}
      }

      set({ vst3DrumTags: nextTags, vst3ActivePluginIds: nextActive })
    },
    setVst3Scanning: (scanning, status = '') => set({ vst3Scanning: scanning, vst3ScanStatus: status }),

    loopEnabled: false,
    loopStart: 0,
    loopEnd: 768, // 4 bars default

    pitchSnapEnabled: true,
    pitchDropSnap: true,
    pitchSnapSensitivity: 100,
    verticalMergeThreshold: 0.5,
    verticalStretchMode: 'glide',
    glideStyle: 'smooth',
    setPitchSnapEnabled: (v) => set(s => {
      if (v && !s.pitchSnapEnabled) {
        const updatedNotes = s.notes.map(n => {
          const roundedPitch = Math.round(n.pitch)
          const roundedEnd = n.pitchEnd !== undefined ? Math.round(n.pitchEnd) : undefined
          return {
            ...n,
            pitch: roundedPitch,
            pitchEnd: roundedEnd === roundedPitch ? undefined : roundedEnd
          }
        })
        return { pitchSnapEnabled: v, notes: deduplicateNotes(updatedNotes) }
      }
      return { pitchSnapEnabled: v }
    }),
    setPitchDropSnap: (v) => set({ pitchDropSnap: v }),
    setPitchSnapSensitivity: (v) => set({ pitchSnapSensitivity: v }),
    setVerticalMergeThreshold: (v) => set({ verticalMergeThreshold: v }),
    setVerticalStretchMode: (v) => set({ verticalStretchMode: v }),
    setGlideStyle: (v) => set({ glideStyle: v }),

    customSynthRows: [],
    addCustomSynthRow: (row) => set(s => ({ customSynthRows: [...s.customSynthRows, row] })),
    removeCustomSynthRow: (id) => set(s => ({ customSynthRows: s.customSynthRows.filter(r => r.id !== id) })),

    customDrumRows: [],
    addCustomDrumRow: (row) => set(s => ({ customDrumRows: [...s.customDrumRows, row] })),
    removeCustomDrumRow: (id) => set(s => ({ customDrumRows: s.customDrumRows.filter(r => r.id !== id) })),

    scaleLock: { enabled: false, root: 0, mode: 'Major', accidental: 'sharp' },

    utilitySourcePitch: 0,
    utilityTargetPitch: 0,
    utilitySourceCol: 0,
    utilityTargetCol: 0,
    utilityPicker: null,

    isScriptingModalVisible: false,
    setIsScriptingModalVisible: (v) => set({ isScriptingModalVisible: v }),
    isSynthStudioModalVisible: false,
    setIsSynthStudioModalVisible: (v) => set({ isSynthStudioModalVisible: v }),
    isDrumDesignerModalVisible: false,
    setIsDrumDesignerModalVisible: (v) => set({ isDrumDesignerModalVisible: v }),
    scriptContent: `// Welcome to the MuseGrid Scripting Engine!
// You have access to MuseState, Muse, and Tone.

// Example: Auto-looping a specific track N times
// 1. Get the first track
const state = Muse.getState();
const firstTrack = state.tracks[0];

if (firstTrack) {
  // 2. Loop it 4 times, snapping to bar boundaries
  Muse.track.loop(firstTrack.id, 'nTimes', true, 4);
  console.log('Looped track: ' + firstTrack.name);
} else {
  console.log('No tracks found!');
}
`,
    setScriptContent: (content) => set({ scriptContent: content }),

    toast: null,
    showToast: (message, type = 'info') => {
      set({ toast: { message, type } })
      setTimeout(() => {
        const currentToast = useStore.getState().toast
        if (currentToast?.message === message) {
          set({ toast: null })
        }
      }, 3000)
    },
    clearToast: () => set({ toast: null }),
    setUtilitySourcePitch: (v) => set({ utilitySourcePitch: v }),
    setUtilityTargetPitch: (v) => set({ utilityTargetPitch: v }),
    setUtilitySourceCol: (v) => set({ utilitySourceCol: v }),
    setUtilityTargetCol: (v) => set({ utilityTargetCol: v }),
    setUtilityPicker: (p) => set({ utilityPicker: p }),

    swing: 0,

    metronomeEnabled: false,
    metronomeVolume: 0.7,
    grooveTemplates: defaultGrooveTemplates,
    activeGrooveTemplateId: 'groove-mpc-60',
    grooveTimingStrength: 100,
    grooveVelocityStrength: 100,
    grooveExtractionTargetAll: true,
    quantizeInputEnabled: true,
    quantizeStrength: 100,

    gridSplitOrder: 'synth-first',
    gridPaneMode: 'split',
    setGridSplitOrder: (gridSplitOrder) => set({ gridSplitOrder }),
    setGridPaneMode: (gridPaneMode) => set({ gridPaneMode }),

    setBpm: (bpm) => set({ bpm }),
    setCompleteNotesOnPause: (val) => set({ completeNotesOnPause: val }),
    setIsPlaying: (isPlaying) => set({ isPlaying }),
    setEngineMode: (engineMode) => set({ engineMode }),
    setDeduplicateEnabled: (val) => set({ deduplicateEnabled: val }),
    setDeduplicateOverlapThreshold: (val) => set({ deduplicateOverlapThreshold: val }),
    setDeduplicateProximityTolerance: (val) => set({ deduplicateProximityTolerance: val }),

    addNote: (note) => set((state) => ({ notes: deduplicateNotes([...state.notes, note]) })),
    updateNote: (id, updates) => set((state) => ({
      notes: deduplicateNotes(state.notes.map(n => n.id === id ? { ...n, ...updates } : n))
    })),
    updateNotes: (ids, updates) => set((state) => {
      const idSet = new Set(ids)
      return {
        notes: deduplicateNotes(state.notes.map(n => idSet.has(n.id) ? { ...n, ...updates } : n))
      }
    }),
    removeNote: (id) => set((state) => ({ notes: state.notes.filter(n => n.id !== id) })),
    removeNotes: (ids) => set((state) => {
      const idSet = new Set(ids)
      return {
        notes: state.notes.filter(n => !idSet.has(n.id)),
        selectedNoteIds: state.selectedNoteIds.filter(nid => !idSet.has(nid))
      }
    }),

    addTrack: (track) => set((state) => {
      const active = state.activeTrackId || track.id
      return {
        tracks: [...state.tracks, track],
        activeTrackId: active,
        selectedTrackIds: state.selectedTrackIds.length > 0 ? state.selectedTrackIds : [active]
      }
    }),
    removeTrack: (id) => set((state) => {
      const newTracks = state.tracks.filter(t => t.id !== id)
      const automationCurves = { ...state.automationCurves }
      delete automationCurves[id]
      const automationTargets = { ...state.automationTargets }
      delete automationTargets[id]
      const newSelected = state.selectedTrackIds.filter(tid => tid !== id)
      const newActive = state.activeTrackId === id ? (newTracks[0]?.id || null) : state.activeTrackId
      return {
        tracks: newTracks,
        notes: state.notes.filter(n => n.trackId !== id),
        clips: state.clips.filter(c => c.trackId !== id),
        groups: state.groups.map(g => g.trackIds.includes(id)
          ? { ...g, trackIds: g.trackIds.filter(tid => tid !== id) }
          : g),
        automationCurves,
        automationTargets,
        selectedTrackIds: newSelected,
        activeTrackId: newActive
      }
    }),
    removeTracks: (ids) => set((state) => {
      const idSet = new Set(ids)
      const newTracks = state.tracks.filter(t => !idSet.has(t.id))
      const automationCurves = { ...state.automationCurves }
      const automationTargets = { ...state.automationTargets }
      ids.forEach(id => {
        delete automationCurves[id]
        delete automationTargets[id]
      })
      const newSelected = state.selectedTrackIds.filter(tid => !idSet.has(tid))
      let newActive = state.activeTrackId
      if (newActive && idSet.has(newActive)) {
        newActive = newTracks[0]?.id || null
      }
      return {
        tracks: newTracks,
        notes: state.notes.filter(n => !idSet.has(n.trackId)),
        clips: state.clips.filter(c => !idSet.has(c.trackId)),
        groups: state.groups.map(g => g.trackIds.some(tid => idSet.has(tid))
          ? { ...g, trackIds: g.trackIds.filter(tid => !idSet.has(tid)) }
          : g),
        automationCurves,
        automationTargets,
        selectedTrackIds: newSelected,
        activeTrackId: newActive
      }
    }),
    duplicateTracks: (ids) => set((state) => {
      const idMap = new Map<string, string>()
      ids.forEach(id => {
        idMap.set(id, `track_${Math.random().toString(36).substring(2, 9)}`)
      })

      const newTracks: Track[] = []
      const copiedNotes: Note[] = []
      const copiedClips: Clip[] = []
      const newAutomationCurves = { ...state.automationCurves }
      const newAutomationTargets = { ...state.automationTargets }

      state.tracks.forEach(track => {
        newTracks.push(track)
        if (idMap.has(track.id)) {
          const newTrackId = idMap.get(track.id)!

          let parentId = track.parentId
          if (parentId && idMap.has(parentId)) {
            parentId = idMap.get(parentId)
          }

          const fxSettings = track.fxSettings ? JSON.parse(JSON.stringify(track.fxSettings)) : undefined
          const fxModulators = track.fxModulators ? JSON.parse(JSON.stringify(track.fxModulators)) : undefined
          const fxInstances = track.fxInstances ? JSON.parse(JSON.stringify(track.fxInstances)) : undefined
          const drumRows = track.drumRows ? JSON.parse(JSON.stringify(track.drumRows)) : undefined
          const drumDecays = track.drumDecays ? JSON.parse(JSON.stringify(track.drumDecays)) : undefined

          const dupTrack: Track = {
            ...track,
            id: newTrackId,
            name: `${track.name} (Copy)`,
            parentId,
            soloed: false,
            fxSettings,
            fxModulators,
            fxInstances,
            drumRows,
            drumDecays,
          }
          newTracks.push(dupTrack)

          const trackNotes = state.notes.filter(n => n.trackId === track.id)
          trackNotes.forEach(n => {
            copiedNotes.push({
              ...n,
              id: Math.random().toString(36).substring(2, 9),
              trackId: newTrackId
            })
          })

          const trackClips = state.clips.filter(c => c.trackId === track.id)
          trackClips.forEach(c => {
            copiedClips.push({
              ...c,
              id: Math.random().toString(36).substring(2, 9),
              trackId: newTrackId
            })
          })

          if (state.automationCurves[track.id]) {
            newAutomationCurves[newTrackId] = JSON.parse(JSON.stringify(state.automationCurves[track.id]))
          }
          // A duplicated lane must mean the same thing as the lane it came from.
          if (state.automationTargets[track.id]) {
            newAutomationTargets[newTrackId] = state.automationTargets[track.id]
          }
        }
      })

      const duplicatedIds = Array.from(idMap.values())

      return {
        tracks: newTracks,
        notes: [...state.notes, ...copiedNotes],
        clips: [...state.clips, ...copiedClips],
        automationCurves: newAutomationCurves,
        automationTargets: newAutomationTargets,
        selectedTrackIds: duplicatedIds,
        activeTrackId: duplicatedIds[duplicatedIds.length - 1] || null
      }
    }),
    loopTrack: (trackId, mode, snapToBar, times = 1) => set((state) => {
      const trackNotes = state.notes.filter(n => n.trackId === trackId)
      if (trackNotes.length === 0) return state

      const minTick = Math.min(...trackNotes.map(n => n.time))
      const maxTick = Math.max(...trackNotes.map(n => n.time + n.duration))

      let cycleLength = maxTick - minTick
      if (snapToBar) {
        cycleLength = Math.ceil(maxTick / 768) * 768 - Math.floor(minTick / 768) * 768
        if (cycleLength <= 0) cycleLength = 768 // Fallback to 1 bar
      }

      let endBoundary = 0
      if (mode === 'fillToEnd' || mode === 'perfectCycle') {
        const globalMaxTick = Math.max(...state.notes.map(n => n.time + n.duration))
        const gridEndTick = state.gridColumnCount * state.gridBlockTicks
        endBoundary = Math.max(globalMaxTick, gridEndTick)
      }

      const newNotes: any[] = [] // Using any to avoid type complaints with Note import here
      let currentOffset = cycleLength
      let loopsDone = 0

      while (true) {
        if (mode === 'nTimes' && loopsDone >= times) break
        if (mode === 'perfectCycle' && (minTick + currentOffset + cycleLength) > endBoundary) break
        if (mode === 'fillToEnd' && (minTick + currentOffset) >= endBoundary) break

        trackNotes.forEach(note => {
          const newTime = note.time + currentOffset
          if (mode === 'fillToEnd' && newTime >= endBoundary) return // Don't add notes past boundary if fillToEnd

          newNotes.push({
            ...note,
            id: Math.random().toString(36).substring(2, 9),
            time: newTime
          })
        })

        currentOffset += cycleLength
        loopsDone++
      }

      if (newNotes.length === 0) return state

      let newGridCols = state.gridColumnCount
      const maxNewTick = Math.max(...newNotes.map(n => n.time + n.duration))
      const currentGridTicks = state.gridColumnCount * state.gridBlockTicks
      if (maxNewTick > currentGridTicks && state.autoExtendGrid) {
        newGridCols = Math.ceil(maxNewTick / state.gridBlockTicks)
      }

      return { notes: [...state.notes, ...newNotes], gridColumnCount: newGridCols } // deduplicateNotes is handled by the set wrapper
    }),
    toggleTrackVisibility: (id) => set((state) => ({
      tracks: state.tracks.map(t => t.id === id ? { ...t, hidden: !t.hidden } : t)
    })),
    updateTrack: (id, updates) => set((state) => {
      const newTracks = state.tracks.map(t => t.id === id ? { ...t, ...updates } : t)
      return {
        tracks: newTracks
      }
    }),
    updateTracks: (ids, updates) => set((state) => {
      const idSet = new Set(ids)
      const newTracks = state.tracks.map(t => idSet.has(t.id) ? { ...t, ...updates } : t)
      return {
        tracks: newTracks
      }
    }),
    reorderTrackFX: (trackId, startIndex, endIndex) => set((state) => {
      const track = state.tracks.find(t => t.id === trackId)
      if (!track) return {}
      const currentOrder = getTrackFxInstances(track.fxInstances)
      const [removed] = currentOrder.splice(startIndex, 1)
      currentOrder.splice(endIndex, 0, removed)
      const newTracks = state.tracks.map(t => t.id === trackId ? { ...t, fxInstances: currentOrder } : t)
      return {
        tracks: newTracks
      }
    }),
    duplicateTrackFX: (trackId, instanceId) => set((state) => {
      const track = state.tracks.find(t => t.id === trackId)
      if (!track) return {}
      const fxInstances = getTrackFxInstances(track.fxInstances)
      const sourceIdx = fxInstances.findIndex(inst => inst.id === instanceId)
      if (sourceIdx === -1) return {}

      const sourceInst = fxInstances[sourceIdx]
      const newId = `${sourceInst.type}-dup-${Date.now()}`
      const newInst: FxInstance = {
        id: newId,
        type: sourceInst.type,
        ...(sourceInst.pluginId ? { pluginId: sourceInst.pluginId, pluginName: sourceInst.pluginName } : {})
      }

      fxInstances.splice(sourceIdx + 1, 0, newInst)

      const fxSettings = { ...track.fxSettings }
      const sourceSettings = { ...(fxSettings[instanceId] || {}) }

      const fxModulators = { ...track.fxModulators }
      const sourceModulators = { ...(fxModulators[instanceId] || {}) }

      const isPreloaded = isBuiltInFxType(sourceInst.type)
      if (isPreloaded && Object.keys(sourceSettings).length === 0 && instanceId.endsWith('-default')) {
        if (sourceInst.type === 'eq') {
          sourceSettings.lowGain = track.eqLowGain ?? 0
          sourceSettings.midGain = track.eqMidGain ?? 0
          sourceSettings.highGain = track.eqHighGain ?? 0
        } else if (sourceInst.type === 'distortion') {
          sourceSettings.wet = track.distortionWet ?? 0
          sourceSettings.amount = track.distortionAmount ?? 0.4
        } else if (sourceInst.type === 'chorus') {
          sourceSettings.wet = track.chorusWet ?? 0
          sourceSettings.frequency = track.chorusFrequency ?? 1.5
          sourceSettings.delayTime = track.chorusDelayTime ?? 3.5
          sourceSettings.depth = track.chorusDepth ?? 0.7
        } else if (sourceInst.type === 'phaser') {
          sourceSettings.wet = track.phaserWet ?? 0
          sourceSettings.frequency = track.phaserFrequency ?? 0.5
          sourceSettings.baseFreq = track.phaserBaseFreq ?? 350
          sourceSettings.octaves = track.phaserOctaves ?? 3
        } else if (sourceInst.type === 'delay') {
          sourceSettings.wet = track.delayWet ?? 0
          sourceSettings.time = track.delayTime ?? 0.25
          sourceSettings.feedback = track.delayFeedback ?? 0.25
        } else if (sourceInst.type === 'dpreverb') {
          sourceSettings.wet = track.dpreverbWet ?? 0
          sourceSettings.tail = track.dpreverbTail ?? 2
          sourceSettings.decay = track.dpreverbDecay ?? 0.65
          sourceSettings.tone = track.dpreverbTone ?? 0.55
        } else if (sourceInst.type === 'reverb') {
          sourceSettings.wet = track.reverbWet ?? 0
          sourceSettings.decay = track.reverbDecay ?? 2.5
          sourceSettings.preDelay = track.reverbPreDelay ?? 0.01
        } else if (sourceInst.type === 'freeverb') {
          sourceSettings.wet = 0
          sourceSettings.roomSize = 0.7
          sourceSettings.dampening = 4000
        }
      }

      fxSettings[newId] = sourceSettings
      fxModulators[newId] = sourceModulators

      const updatedTracks = state.tracks.map(t =>
        t.id === trackId ? { ...t, fxInstances, fxSettings, fxModulators } : t
      )

      return { tracks: updatedTracks }
    }),
    removeTrackFXInstance: (trackId, instanceId) => set((state) => {
      const track = state.tracks.find(t => t.id === trackId)
      if (!track) return {}
      let fxInstances = getTrackFxInstances(track.fxInstances)
      const targetInst = fxInstances.find(inst => inst.id === instanceId)
      if (!targetInst) return {}

      const sameTypeCount = fxInstances.filter(inst => inst.type === targetInst.type).length
      if (isBuiltInFxType(targetInst.type) && sameTypeCount <= 1) {
        const label = BUILT_IN_FX_LABELS[targetInst.type]
        setTimeout(() => {
          state.showToast(`Cannot remove the only instance of ${label}`, 'error')
        }, 0)
        return {}
      }

      fxInstances = fxInstances.filter(inst => inst.id !== instanceId)

      const fxSettings = { ...track.fxSettings }
      delete fxSettings[instanceId]

      const fxModulators = { ...track.fxModulators }
      delete fxModulators[instanceId]

      const updatedTracks = state.tracks.map(t =>
        t.id === trackId ? { ...t, fxInstances, fxSettings, fxModulators } : t
      )

      return { tracks: updatedTracks }
    }),
    updateTrackFXSetting: (trackId, instanceId, key, value) => set((state) => {
      const track = state.tracks.find(t => t.id === trackId)
      if (!track) return {}
      const fxSettings = { ...track.fxSettings }
      const currentInstanceSettings = { ...(fxSettings[instanceId] || {}) }
      currentInstanceSettings[key] = value
      fxSettings[instanceId] = currentInstanceSettings

      const flatUpdates: any = {}
      if (instanceId.endsWith('-default')) {
        const type = instanceId.split('-')[0]
        let flatKey = type + key.charAt(0).toUpperCase() + key.slice(1)
        if (type === 'eq' && key === 'lowGain') flatKey = 'eqLowGain'
        if (type === 'eq' && key === 'midGain') flatKey = 'eqMidGain'
        if (type === 'eq' && key === 'highGain') flatKey = 'eqHighGain'
        if (type === 'phaser' && key === 'baseFreq') flatKey = 'phaserBaseFreq'

        flatUpdates[flatKey] = value
      }

      const updatedTracks = state.tracks.map(t =>
        t.id === trackId ? { ...t, ...flatUpdates, fxSettings } : t
      )

      return { tracks: updatedTracks }
    }),
    updateTrackFXModulator: (trackId, instanceId, key, config) => set((state) => {
      const track = state.tracks.find(t => t.id === trackId)
      if (!track) return {}
      const fxModulators = { ...track.fxModulators }
      const currentInstanceMods = { ...(fxModulators[instanceId] || {}) }
      if (config === null) {
        delete currentInstanceMods[key]
      } else {
        currentInstanceMods[key] = config
      }
      fxModulators[instanceId] = currentInstanceMods

      const updatedTracks = state.tracks.map(t =>
        t.id === trackId ? { ...t, fxModulators } : t
      )

      return { tracks: updatedTracks }
    }),

    addCustomFxConfig: (config) => set((state) => ({
      customFxConfigs: [...state.customFxConfigs, config]
    })),

    updateCustomFxConfig: (id, updates) => set((state) => {
      const updatedConfigs = state.customFxConfigs.map(c =>
        c.id === id ? { ...c, ...updates } : c
      )
      const updatedTracks = state.tracks.map(t => {
        const hasCustom = t.fxInstances?.some(inst => inst.type === id)
        if (hasCustom) {
          return { ...t }
        }
        return t
      })
      return {
        customFxConfigs: updatedConfigs,
        tracks: updatedTracks
      }
    }),

    deleteCustomFxConfig: (id) => set((state) => {
      const updatedConfigs = state.customFxConfigs.filter(c => c.id !== id)
      const updatedTracks = state.tracks.map(t => {
        if (!t.fxInstances) return t
        const filtered = t.fxInstances.filter(inst => inst.type !== id)
        if (filtered.length === t.fxInstances.length) return t
        return { ...t, fxInstances: filtered }
      })
      return {
        customFxConfigs: updatedConfigs,
        tracks: updatedTracks
      }
    }),

    addCustomFxToTracks: (configId) => set((state) => {
      const config = state.customFxConfigs.find(c => c.id === configId)
      if (!config) return {}

      const updatedTracks = state.tracks.map(t => {
        const fxInstances = getTrackFxInstances(t.fxInstances)
        const newId = `${configId}-inst-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        fxInstances.push({ id: newId, type: configId })

        const fxSettings = { ...t.fxSettings }
        const sourceSettings: Record<string, number> = {}
        config.params.forEach(p => {
          sourceSettings[p.name] = p.defaultVal
        })
        fxSettings[newId] = sourceSettings

        return { ...t, fxInstances, fxSettings }
      })

      return { tracks: updatedTracks }
    }),

    addCustomFxToTrack: (trackId, configId) => set((state) => {
      const config = state.customFxConfigs.find(c => c.id === configId)
      if (!config) return {}

      const updatedTracks = state.tracks.map(t => {
        if (t.id !== trackId) return t
        const fxInstances = getTrackFxInstances(t.fxInstances)
        const newId = `${configId}-inst-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        fxInstances.push({ id: newId, type: configId })

        const fxSettings = { ...t.fxSettings }
        const sourceSettings: Record<string, number> = {}
        config.params.forEach(p => {
          sourceSettings[p.name] = p.defaultVal
        })
        fxSettings[newId] = sourceSettings

        return { ...t, fxInstances, fxSettings }
      })

      return { tracks: updatedTracks }
    }),

    setPlayheadPosition: (pos) => set({ playheadPosition: pos }),
    setPlayheadFollowMode: (playheadFollowMode) => set({ playheadFollowMode }),
    requestCanvasAlign: () => set((state) => ({ canvasAlignRequest: state.canvasAlignRequest + 1 })),
    setColumnWidth: (index, width) => set((state) => ({
      columnWidths: { ...state.columnWidths, [index]: width }
    })),
    loadState: (newState) => set((state) => {
      const newProjectId = Math.random().toString(36).substring(2, 9)
      return {
        ...state,
        ...newState,
        projectId: newState.projectId || newProjectId,
        projectName: newState.projectName !== undefined ? newState.projectName : state.projectName,
        projectFilePath: newState.projectFilePath !== undefined ? newState.projectFilePath : state.projectFilePath,
        isDirty: false,
        customFxConfigs: newState.customFxConfigs !== undefined ? newState.customFxConfigs : state.customFxConfigs,
        projectRevision: state.projectRevision + 1,
        notes: deduplicateNotes(newState.notes || state.notes),
        tracks: (newState.tracks || state.tracks).map((t: any) => ({
          ...t,
          collapsed: t.collapsed !== undefined ? t.collapsed : true
        })),
        midiRemapData: newState.midiRemapData !== undefined ? newState.midiRemapData : {
          midi: null,
          filename: '',
          drumMap: {},
          synthMap: {},
          channelStates: {},
          octaveOffset: 0,
          semitoneOffset: 0,
          timeScale: 1,
          velocityScale: 1,
          velocityOffset: 0,
          humanizeTiming: 0,
          humanizeVelocity: 0,
          repeatCount: 1,
          pitchSensitivity: 0
        },
        studioSettings: {
          ...state.studioSettings,
          ...(newState.studioSettings || {})
        },
        isPlaying: false,
        playheadPosition: 0,
        history: [],
        historyIndex: -1
      }
    }),
    setActiveTrackId: (id) => set((state) => {
      const activeTrack = state.tracks.find(t => t.id === id)
      return {
        activeTrackId: id,
        selectedTrackIds: id ? [id] : [],
        lastActiveSynthTrackId: activeTrack?.instrument === 'synth' ? id : state.lastActiveSynthTrackId,
        lastActiveDrumTrackId: activeTrack?.instrument === 'drum' ? id : state.lastActiveDrumTrackId
      }
    }),
    toggleTrackSelection: (id, multi) => set((state) => {
      if (!multi) {
        return { activeTrackId: id, selectedTrackIds: [id] }
      }
      const isSelected = state.selectedTrackIds.includes(id)
      let newSelection = [...state.selectedTrackIds]
      if (isSelected) {
        newSelection = newSelection.filter(tid => tid !== id)
      } else {
        newSelection.push(id)
      }
      return {
        selectedTrackIds: newSelection,
        activeTrackId: newSelection.length > 0 ? newSelection[newSelection.length - 1] : null
      }
    }),
    setSelectedTrackIds: (ids) => set({ selectedTrackIds: ids, activeTrackId: ids.length > 0 ? ids[ids.length - 1] : null }),
    setActiveTool: (tool) => set({ activeTool: tool }),
    setSelectedNoteIds: (ids) => set({ selectedNoteIds: ids }),
    setClipboard: (notes) => set({ clipboard: notes }),
    setIsRecording: (v) => set({ isRecording: v }),
    setMidiOverdub: (v) => set({ midiOverdub: v }),
    clearTrackNotes: (trackId) => set((state) => ({
      notes: state.notes.filter(n => n.trackId !== trackId)
    })),
    eraseNotesInRegion: (trackId, startTick, endTick) => set((state) => {
      // Find notes on the track that intersect with [startTick, endTick]
      const notesToKeep = state.notes.filter(n => {
        if (n.trackId !== trackId) return true
        const noteStart = n.time
        const noteEnd = n.time + n.duration
        // Intersects if note starts before region ends AND note ends after region starts
        const intersects = (noteStart < endTick && noteEnd > startTick)
        return !intersects
      })
      if (notesToKeep.length === state.notes.length) return {} // No change
      return { notes: notesToKeep }
    }),
    setLeftPaneWidth: (w) => set({ leftPaneWidth: w }),
    setLeftPaneCollapsed: (v) => set({ leftPaneCollapsed: v }),
    setZoomSynth: (z) => set((state) => state.syncZoom ? { zoomSynth: z, zoomDrum: z } : { zoomSynth: z }),
    setZoomDrum: (z) => set((state) => state.syncZoom ? { zoomSynth: z, zoomDrum: z } : { zoomDrum: z }),
    setSyncZoom: (v) => set((state) => ({ syncZoom: v, ...(v ? { zoomDrum: state.zoomSynth } : {}) })),
    resetZoom: () => set({ columnWidths: {} }),
    setSplitRatio: (r) => set({ splitRatio: r }),
    setLeftPaneTopRatio: (r) => set({ leftPaneTopRatio: r }),
    setIsLeftPaneFlipped: (v) => set({ isLeftPaneFlipped: v }),
    getMaxTicks: () => {
      const s = get()
      const notes = s.notes
      const drumMax = s.drumSteps * 48
      if (notes.length === 0) return drumMax
      return Math.max(drumMax, ...notes.map(n => n.time + n.duration))
    },

    // Undo / Redo
    commitHistory: () => set((state) => {
      const trimmed = state.history.slice(0, state.historyIndex + 1)
      const next = [...trimmed, [...state.notes]].slice(-50) // max 50 steps
      return { history: next, historyIndex: next.length - 1, isDirty: true }
    }),
    undo: () => set((state) => {
      if (state.historyIndex <= 0) return { isDirty: true }
      const idx = state.historyIndex - 1
      return { notes: [...state.history[idx]], historyIndex: idx, isDirty: true }
    }),
    redo: () => set((state) => {
      if (state.historyIndex >= state.history.length - 1) return { isDirty: true }
      const idx = state.historyIndex + 1
      return { notes: [...state.history[idx]], historyIndex: idx, isDirty: true }
    }),

    setProjectInfo: (info) => set(() => ({ ...info })),
    setIsDirty: (v) => set({ isDirty: v }),

    quantizeSelectedNotes: () => set((state) => {
      if (state.selectedNoteIds.length === 0) return {}
      const { snapResolution } = state
      const newNotes = state.notes.map(note => {
        if (state.selectedNoteIds.includes(note.id)) {
          return { ...note, time: Math.round(note.time / snapResolution) * snapResolution }
        }
        return note
      })
      return { notes: deduplicateNotes(newNotes) }
    }),

    setSnapEnabled: (v) => set({ snapEnabled: v }),
    setDropSnap: (v) => set({ dropSnap: v }),
    setNoteInspectorEnabled: (v) => set({ noteInspectorEnabled: v }),
    setIsRightPaneVisible: (v) => set({ isRightPaneVisible: v }),
    setIsHelpPaneVisible: (v) => set({ isHelpPaneVisible: v }),
    setSnapResolution: (v) => set({ snapResolution: v }),
    setGridBlockTicks: (v) => set({ gridBlockTicks: Math.max(12, Math.min(768, Math.round(v))) }),
    setGridShadeEvery: (v) => set({ gridShadeEvery: Math.max(1, Math.min(32, Math.round(v))) }),
    setGridColumnCount: (v) => set({ gridColumnCount: Math.max(16, Math.min(2048, Math.round(v))) }),
    setAutoExtendGrid: (v) => set({ autoExtendGrid: v }),
    setLoopEnabled: (v) => set((state) => {
      if (v && state.loopEnd <= 768) {
        const max = state.getMaxTicks()
        return { loopEnabled: v, loopEnd: Math.max(max, 768) }
      }
      return { loopEnabled: v }
    }),
    setLoopStart: (v) => set((state) => {
      const minTicks = Math.round((state.bpm / 60) * 192)
      const newStart = Math.min(v, state.loopEnd - minTicks)
      return { loopStart: Math.max(0, newStart) }
    }),
    setLoopEnd: (v) => set((state) => {
      const minTicks = Math.round((state.bpm / 60) * 192)
      return { loopEnd: Math.max(state.loopStart + minTicks, v) }
    }),
    setSynthLowerOctave: (v) => set({ synthLowerOctave: v }),
    setSynthUpperOctave: (v) => set({ synthUpperOctave: v }),
    setMinNoteSize: (v) => set(state => {
      const minNoteSize = Math.max(0, Math.round(v))
      const updatedNotes = state.notes.map(note => {
        if (note.duration < minNoteSize) {
          return { ...note, duration: minNoteSize }
        }
        return note
      })
      return {
        minNoteSize,
        notes: updatedNotes
      }
    }),
    setScaleLock: (lock) => set({ scaleLock: lock }),
    setSwing: (v) => set({ swing: v }),
    setMetronomeEnabled: (v) => set({ metronomeEnabled: v }),
    setMetronomeVolume: (v) => set({ metronomeVolume: v }),
    setGrooveTimingStrength: (v) => set({ grooveTimingStrength: v }),
    setGrooveVelocityStrength: (v) => set({ grooveVelocityStrength: v }),
    setActiveGrooveTemplateId: (id) => set({ activeGrooveTemplateId: id }),
    setGrooveExtractionTargetAll: (v) => set({ grooveExtractionTargetAll: v }),
    addGrooveTemplate: (template) => set(state => ({ grooveTemplates: [...state.grooveTemplates, template] })),

    applyGroove: (noteIds) => {
      const state = get()
      if (noteIds.length === 0 || !state.activeGrooveTemplateId) return

      const template = state.grooveTemplates.find(t => t.id === state.activeGrooveTemplateId)
      if (!template || template.steps.length === 0) return

      const timingScale = state.grooveTimingStrength / 100
      const velocityScale = state.grooveVelocityStrength / 100

      // Assume 4/4 bar for 16 steps (1 bar = 4 beats = 16 16ths). 
      // Total ticks per bar = 768
      const stepsPerBar = template.steps.length
      const ticksPerBar = 768
      const ticksPerStep = ticksPerBar / stepsPerBar

      const updatedNotes = state.notes.map(note => {
        if (!noteIds.includes(note.id)) return note

        // Find which step in the bar this note belongs to mathematically
        // Modulo the time by ticksPerBar to get position within the measure
        const posInBar = note.time % ticksPerBar

        // Find the closest step index
        const closestStepIndex = Math.round(posInBar / ticksPerStep) % stepsPerBar
        const step = template.steps[closestStepIndex]

        // Calculate new time and velocity
        const newTime = Math.max(0, note.time + Math.round(step.timingOffset * timingScale))
        const newVelocity = Math.max(1, Math.min(127, Math.round(note.velocity + step.velocityOffset * velocityScale)))

        return { ...note, time: newTime, velocity: newVelocity }
      })

      set({ notes: updatedNotes, projectRevision: state.projectRevision + 1 })
    },

    extractGroove: (noteIds, name) => {
      const state = get()
      if (noteIds.length === 0) return

      const notesToExtract = state.notes.filter(n => noteIds.includes(n.id))
      const ticksPerBar = 768
      const stepsPerBar = 16
      const ticksPerStep = ticksPerBar / stepsPerBar

      // Initialize empty steps
      const steps: { timingOffset: number; velocityOffset: number; count: number }[] =
        Array.from({ length: stepsPerBar }, () => ({ timingOffset: 0, velocityOffset: 0, count: 0 }))

      notesToExtract.forEach(note => {
        const posInBar = note.time % ticksPerBar

        // Determine what the "perfectly quantized" grid step is
        const idealStepIndex = Math.round(posInBar / ticksPerStep) % stepsPerBar
        const idealTime = idealStepIndex * ticksPerStep

        // The offset is the difference between actual pos and ideal pos
        // Note: we have to handle wrap-around if posInBar is like 767 and ideal is 0
        let timingOffset = posInBar - idealTime
        if (timingOffset > ticksPerBar / 2) timingOffset -= ticksPerBar
        if (timingOffset < -ticksPerBar / 2) timingOffset += ticksPerBar

        // Velocity offset (assume 100 is the "baseline" or just take raw velocity - 100)
        const velocityOffset = note.velocity - 100

        steps[idealStepIndex].timingOffset += timingOffset
        steps[idealStepIndex].velocityOffset += velocityOffset
        steps[idealStepIndex].count++
      })

      // Average the offsets for each step
      const finalSteps = steps.map(s => {
        if (s.count === 0) return { timingOffset: 0, velocityOffset: 0 }
        return {
          timingOffset: Math.round(s.timingOffset / s.count),
          velocityOffset: Math.round(s.velocityOffset / s.count)
        }
      })

      const newTemplate: GrooveTemplate = {
        id: `custom-groove-${Date.now()}`,
        name,
        steps: finalSteps
      }

      get().addGrooveTemplate(newTemplate)
      get().setActiveGrooveTemplateId(newTemplate.id)
    },

    setQuantizeInputEnabled: (v) => set({ quantizeInputEnabled: v }),
    setQuantizeStrength: (v) => set({ quantizeStrength: Math.max(1, Math.min(100, Math.round(v))) }),
    setAutomationCurve: (trackId, points) => set((state) => {
      const unique = Array.from(new Map(points.map(p => [p.time, p])).values())
      return {
        automationCurves: {
          ...state.automationCurves,
          [trackId]: unique.sort((a, b) => a.time - b.time)
        }
      }
    }),
    addAutomationPoint: (trackId, point) => set((state) => {
      const existing = state.automationCurves[trackId] ?? []
      const filtered = existing.filter(p => p.time !== point.time)
      return {
        automationCurves: {
          ...state.automationCurves,
          [trackId]: [...filtered, point].sort((a, b) => a.time - b.time)
        }
      }
    }),
    updateAutomationPoint: (trackId, pointId, updates) => set((state) => {
      const existing = state.automationCurves[trackId] ?? []
      const targetTime = updates.time !== undefined ? updates.time : undefined
      const updated = existing.map(point => point.id === pointId ? { ...point, ...updates } : point)
      const filtered = targetTime !== undefined
        ? updated.filter(point => point.id === pointId || point.time !== targetTime)
        : updated
      return {
        automationCurves: {
          ...state.automationCurves,
          [trackId]: filtered.sort((a, b) => a.time - b.time)
        }
      }
    }),
    removeAutomationPoint: (trackId, pointId) => set((state) => ({
      automationCurves: {
        ...state.automationCurves,
        [trackId]: (state.automationCurves[trackId] ?? []).filter(point => point.id !== pointId)
      }
    })),
    clearAutomationCurve: (trackId) => set((state) => ({
      automationCurves: {
        ...state.automationCurves,
        [trackId]: []
      }
    })),
    setAutomationTarget: (trackId, target) => set((state) => ({
      automationTargets: {
        ...state.automationTargets,
        [trackId]: target
      }
    })),
    bakeProceduralAutomation: (trackId, formula, preset, density) => set((state) => {
      // Density: how many ticks between points (e.g., 48 = every 16th note, 12 = every 64th note)
      // We will generate 4 bars of automation (768 * 4 = 3072 ticks)
      const maxTicks = 3072
      const points: AutomationPoint[] = []

      for (let t = 0; t <= maxTicks; t += density) {
        let val = 0.5

        try {
          if (preset === 'sine') {
            val = (Math.sin(t / (192 / Math.PI)) + 1) / 2
          } else if (preset === 'square') {
            val = Math.floor(t / 192) % 2 === 0 ? 1 : 0
          } else if (preset === 'noise') {
            val = Math.random()
          } else if (preset === 'sidechain') {
            // Duck on every downbeat (192 ticks)
            const posInBeat = t % 192
            val = posInBeat < 48 ? (posInBeat / 48) : 1
          } else {
            // Custom Math Evaluation (unsafe eval for extreme flexibility)
            const mathFunc = new Function('t', 'Math', `return ${formula || '0.5'}`)
            val = mathFunc(t, Math)
            if (isNaN(val) || !isFinite(val)) val = 0.5
            val = Math.max(0, Math.min(1, val))
          }
        } catch (e) {
          console.error("Procedural formula error:", e)
          val = 0.5
        }

        points.push({ id: `auto-${t}-${Date.now()}`, time: t, value: val })
      }

      return {
        automationCurves: {
          ...state.automationCurves,
          [trackId]: points
        }
      }
    }),

    addClip: (clip) => set(s => ({ clips: [...s.clips, clip] })),
    removeClip: (id) => set(s => ({ clips: s.clips.filter(c => c.id !== id) })),
    updateClip: (id, updates) => set(s => ({ clips: s.clips.map(c => c.id === id ? { ...c, ...updates } : c) })),
    generateClipNotes: (clipId, overwrite, pitch, velocity, duration) => set((state) => {
      const clip = state.clips.find(c => c.id === clipId)
      if (!clip) return state

      let newNotes = state.notes

      // If overwrite, remove any existing notes in the clip's timeframe on the same track
      if (overwrite) {
        newNotes = newNotes.filter(n => !(n.trackId === clip.trackId && n.time >= clip.startTick && n.time < clip.endTick))
      }

      const generatedNotes: Note[] = []

      if (clip.generativeType === 'euclidean') {
        const pulses = clip.euclideanPulses || 4
        const steps = clip.euclideanSteps || 16
        const offset = clip.euclideanOffset || 0

        // Euclidean Bucket Algorithm
        const pattern = new Array(steps).fill(false)
        let bucket = 0
        for (let i = 0; i < steps; i++) {
          bucket += pulses
          if (bucket >= steps) {
            bucket -= steps
            pattern[i] = true
          }
        }

        // Apply Offset (rotation)
        const rotatedPattern = new Array(steps).fill(false)
        for (let i = 0; i < steps; i++) {
          rotatedPattern[(i + offset + steps) % steps] = pattern[i]
        }

        // Convert pattern to notes
        const ticksPerStep = (clip.endTick - clip.startTick) / steps
        for (let i = 0; i < steps; i++) {
          if (rotatedPattern[i]) {
            generatedNotes.push({
              id: `gen-${Date.now()}-${i}`,
              trackId: clip.trackId,
              time: clip.startTick + Math.round(i * ticksPerStep),
              pitch,
              velocity,
              duration
            })
          }
        }
      } else if (clip.generativeType === 'random') {
        const steps = clip.euclideanSteps || 16
        const ticksPerStep = (clip.endTick - clip.startTick) / steps
        for (let i = 0; i < steps; i++) {
          if (Math.random() < ((clip.euclideanPulses || 4) / steps)) {
            generatedNotes.push({
              id: `gen-rand-${Date.now()}-${i}`,
              trackId: clip.trackId,
              time: clip.startTick + Math.round(i * ticksPerStep),
              pitch,
              velocity,
              duration
            })
          }
        }
      }

      return { notes: [...newNotes, ...generatedNotes] }
    }),

    addGroup: (group) => set(s => ({ groups: [...s.groups, group] })),
    removeGroup: (id) => set(s => ({ groups: s.groups.filter(g => g.id !== id) })),
    updateGroup: (id, updates) => set(s => ({ groups: s.groups.map(g => g.id === id ? { ...g, ...updates } : g) })),

    setDrumSteps: (drumSteps) => set({ drumSteps }),
    setTimeSignature: (sig) => {
      const numerator = parseInt(sig.split('/')[0])
      set({ timeSignature: sig, gridShadeEvery: numerator })
    },
    setProjectExportData: (projectExportData) => set({ projectExportData }),
    setExportRegionMode: (exportRegionMode) => set({ exportRegionMode }),
    setExportRegions: (exportRegions) => set({ exportRegions }),
    addExportRegion: (region) => set(s => ({ exportRegions: [...s.exportRegions, region] })),
    removeExportRegion: (id) => set(s => ({ exportRegions: s.exportRegions.filter(r => r.id !== id) })),
    updateExportRegionGap: (id, gap) => set(s => ({ exportRegions: s.exportRegions.map(r => r.id === id ? { ...r, gap } : r) })),
    setMidiRemapData: (updates) => set((state) => ({
      midiRemapData: { ...state.midiRemapData, ...updates }
    })),
    reorderTracks: (startIndex, endIndex, newParentId) => set(state => {
      const newTracks = [...state.tracks]
      const [removed] = newTracks.splice(startIndex, 1)

      // Update parent if specified (null means clear parent)
      if (newParentId !== undefined) {
        const formerParentId = removed.parentId
        removed.parentId = newParentId === null ? undefined : newParentId

        // If unparenting, inherit the former parent's effect settings
        if (newParentId === null && formerParentId) {
          const formerParent = state.tracks.find(t => t.id === formerParentId)
          if (formerParent) {
            removed.distortionWet = formerParent.distortionWet
            removed.distortionAmount = formerParent.distortionAmount
            removed.chorusWet = formerParent.chorusWet
            removed.chorusFrequency = formerParent.chorusFrequency
            removed.chorusDepth = formerParent.chorusDepth
            removed.phaserWet = formerParent.phaserWet
            removed.phaserFrequency = formerParent.phaserFrequency
            removed.phaserOctaves = formerParent.phaserOctaves
            removed.reverbWet = formerParent.reverbWet
            removed.reverbDecay = formerParent.reverbDecay
            removed.delayWet = formerParent.delayWet
            removed.delayTime = formerParent.delayTime
            removed.delayFeedback = formerParent.delayFeedback
            removed.eqLowGain = formerParent.eqLowGain
            removed.eqMidGain = formerParent.eqMidGain
            removed.eqHighGain = formerParent.eqHighGain
            removed.pan = formerParent.pan
          }
        }
      }

      newTracks.splice(endIndex, 0, removed)
      return { tracks: newTracks }
    }),
    syncTrackSettings: (sourceId, targetId) => set(state => {
      const source = state.tracks.find(t => t.id === sourceId)
      const target = state.tracks.find(t => t.id === targetId)
      if (!source || !target) return state

      const newTracks = state.tracks.map(t => {
        if (t.id !== targetId) return t

        const synced: Partial<Track> = {
          volume: source.volume,
          pan: source.pan,
          eqLowGain: source.eqLowGain,
          eqMidGain: source.eqMidGain,
          eqHighGain: source.eqHighGain,
          reverbWet: source.reverbWet,
          reverbDecay: source.reverbDecay,
          reverbPreDelay: source.reverbPreDelay,
          delayWet: source.delayWet,
          delayTime: source.delayTime,
          delayFeedback: source.delayFeedback,
          distortionWet: source.distortionWet,
          distortionAmount: source.distortionAmount,
          chorusWet: source.chorusWet,
          chorusFrequency: source.chorusFrequency,
          chorusDelayTime: source.chorusDelayTime,
          chorusDepth: source.chorusDepth,
          phaserWet: source.phaserWet,
          phaserFrequency: source.phaserFrequency,
          phaserBaseFreq: source.phaserBaseFreq,
          phaserOctaves: source.phaserOctaves,
          transpose: source.transpose,
        }

        // Sync instrument specs if types match
        if (source.instrument === target.instrument) {
          if (source.instrument === 'synth') {
            synced.synthPreset = source.synthPreset
            synced.customMuxins = source.customMuxins
            synced.scriptedDspId = source.scriptedDspId
            synced.scaleOverride = source.scaleOverride
            synced.synthAttack = source.synthAttack
            synced.synthDecay = source.synthDecay
            synced.synthSustain = source.synthSustain
            synced.synthRelease = source.synthRelease
            synced.synthOscillator = source.synthOscillator
            synced.synthFilterFreq = source.synthFilterFreq
            synced.synthFilterQ = source.synthFilterQ
            synced.synthDecayCurveType = source.synthDecayCurveType
            synced.synthDecayTension = source.synthDecayTension
            synced.synthDecayFormula = source.synthDecayFormula
          } else {
            synced.drumKit = source.drumKit
            synced.drumRows = source.drumRows
            synced.drumDecays = source.drumDecays
            synced.drumPadCurves = source.drumPadCurves
            synced.drumKickOctaves = source.drumKickOctaves
            synced.drumKickPitchDecay = source.drumKickPitchDecay
            synced.drumKickDecay = source.drumKickDecay
            synced.drumSnareDecay = source.drumSnareDecay
            synced.drumHihatDecay = source.drumHihatDecay
          }
        }

        return { ...t, ...synced }
      })

      return { ...state, tracks: newTracks }
    }),
    metronomeSettings: {
      pitchDecay: 0.01,
      octaves: 2,
      attack: 0.001,
      decay: 0.1,
      sustain: 0,
      release: 0.1,
      volume: -6,
      downbeatPitch: 'C6',
      upbeatPitch: 'C5',
      downbeatVel: 1.0,
      upbeatVel: 0.65,
    },
    updateMetronome: (updates) => set(state => ({
      metronomeSettings: { ...state.metronomeSettings, ...updates }
    })),
    studioSettings: {
      renderFadeDuration: 0.1,
      normalizationTarget: -1.0,
      loopEndBuffer: 10,
      masterVolume: 1.0,
      limiterEnabled: true,
      proceduralFxEnabled: true,
      proceduralFxRate: '32n',
      velocityCurveFormula: 'v',
      limiterThreshold: -1.5,
      persistenceEnabled: false,
    },
    updateStudio: (updates) => set(state => ({
      studioSettings: { ...state.studioSettings, ...updates }
    })),
    showImportAudioModal: false,
    importAudioTrackId: null,
    importAudioBuffer: null,
    setShowImportAudioModal: (show, trackId, buffer) => set({ showImportAudioModal: show, importAudioTrackId: trackId || null, importAudioBuffer: buffer || null }),
    isScorePreviewVisible: false,
    scorePreviewTrackIds: [],
    setIsScorePreviewVisible: (v) => set({ isScorePreviewVisible: v }),
    setScorePreviewTrackIds: (ids) => set({ scorePreviewTrackIds: ids }),
    setShowSynthVelocity: (v) => set({ showSynthVelocity: v }),
    setShowDrumVelocity: (v) => set({ showDrumVelocity: v }),
    setVocalVelocityMin: (v) => set({ vocalVelocityMin: v }),
    setVocalVelocityMax: (v) => set({ vocalVelocityMax: v }),
    setVocalVelocityScale: (v) => set({ vocalVelocityScale: v }),
    setVocalVelocityEnabled: (v) => set({ vocalVelocityEnabled: v }),
    gridResizable: false,
    setGridResizable: (v) => set({ gridResizable: v }),
    horizScrollLockEnabled: false,
    setHorizScrollLockEnabled: (v) => set({ horizScrollLockEnabled: v }),
    vertScrollLockEnabled: false,
    setVertScrollLockEnabled: (v) => set({ vertScrollLockEnabled: v }),
    readOnlyMode: false,
    setReadOnlyMode: (v) => set({ readOnlyMode: v }),
    bothGridActive: false,
    setBothGridActive: (v) => set({ bothGridActive: v }),
    scrollBoth: false,
    setScrollBoth: (v) => set({ scrollBoth: v }),
    sharedPanX: 0,
    setSharedPanX: (x) => set({ sharedPanX: x }),
    ghostNotesEnabled: true,
    setGhostNotesEnabled: (v) => set({ ghostNotesEnabled: v }),
    ghostNoteOpacity: 0.42,
    setGhostNoteOpacity: (v) => set({ ghostNoteOpacity: v }),
    ghostCrossInstrument: false,
    setGhostCrossInstrument: (v) => set({ ghostCrossInstrument: v }),
    scaleFoldEnabled: false,
    setScaleFoldEnabled: (v) => set({ scaleFoldEnabled: v }),
    activeChordStamp: null,
    setActiveChordStamp: (stamp) => set({ activeChordStamp: stamp }),
    activeMidiEditTab: 'quick',
    setActiveMidiEditTab: (tab) => set({ activeMidiEditTab: tab }),

    // Dedicated Recording & Capture Hub
    recordTargetMode: 'current',
    setRecordTargetMode: (mode) => set({ recordTargetMode: mode }),
    recordTakeCounter: 1,
    setRecordTakeCounter: (n) => set({ recordTakeCounter: n }),
    recordCountIn: 0,
    setRecordCountIn: (bars) => set({ recordCountIn: bars }),
    countInRemaining: null,
    setCountInRemaining: (b) => set({ countInRemaining: b }),
    recordInputQuantize: 0,
    setRecordInputQuantize: (ticks) => set({ recordInputQuantize: ticks }),
    recordScaleConform: false,
    setRecordScaleConform: (v) => set({ recordScaleConform: v }),
    recordEdoMappingMode: 'linear',
    setRecordEdoMappingMode: (mode) => set({ recordEdoMappingMode: mode }),
    qwertyPianoEnabled: false,
    setQwertyPianoEnabled: (v) => set({ qwertyPianoEnabled: v }),
    qwertyOctave: 4,
    setQwertyOctave: (oct) => set({ qwertyOctave: Math.max(1, Math.min(7, oct)) }),
    qwertyVelocity: 100,
    setQwertyVelocity: (vel) => set({ qwertyVelocity: Math.max(1, Math.min(127, vel)) }),
    activeMidiDeviceNames: [],
    setActiveMidiDeviceNames: (names) => set({ activeMidiDeviceNames: names }),
    midiActivityPulse: false,
    setMidiActivityPulse: (pulse) => set({ midiActivityPulse: pulse }),
    retrospectiveNoteCount: 0,
    setRetrospectiveNoteCount: (n) => set({ retrospectiveNoteCount: n }),
    recallPlacementMode: 'time_snap',
    setRecallPlacementMode: (mode) => set({ recallPlacementMode: mode }),

    // Step Recording & Capture (Column by column / Bar by bar)
    isStepRecording: false,
    setIsStepRecording: (v) => set((s) => ({
      isStepRecording: v,
      stepRecordCursorTick: v ? (s.stepRecordCursorTick || Math.max(0, s.playheadPosition)) : s.stepRecordCursorTick
    })),
    stepRecordCursorTick: 0,
    setStepRecordCursorTick: (tick) => set({ stepRecordCursorTick: Math.max(0, Math.round(tick)) }),
    advanceStepRecordCursor: (steps = 1) => set((state) => {
      const baseTicks = state.stepRecordStepSize > 0 ? state.stepRecordStepSize : state.snapResolution
      const stepDelta = Math.round(baseTicks * (state.stepRecordStepColumns || 1)) * steps
      const newTick = Math.max(0, state.stepRecordCursorTick + stepDelta)
      return { stepRecordCursorTick: newTick }
    }),
    retreatStepRecordCursor: (steps = 1) => set((state) => {
      const baseTicks = state.stepRecordStepSize > 0 ? state.stepRecordStepSize : state.snapResolution
      const stepDelta = Math.round(baseTicks * (state.stepRecordStepColumns || 1)) * steps
      const newTick = Math.max(0, state.stepRecordCursorTick - stepDelta)
      return { stepRecordCursorTick: newTick }
    }),
    deleteStepRecordCurrentColumn: () => {
      const state = get()
      const trackId = state.activeTrackId
      if (!trackId) return
      const baseTicks = state.stepRecordStepSize > 0 ? state.stepRecordStepSize : state.snapResolution
      const colTicks = Math.round(baseTicks * (state.stepRecordStepColumns || 1))
      const cursor = state.stepRecordCursorTick
      const notesAtCursor = state.notes.filter(n => n.trackId === trackId && n.time >= cursor && n.time < cursor + colTicks)
      if (notesAtCursor.length > 0) {
        state.commitHistory()
        state.removeNotes(notesAtCursor.map(n => n.id))
      } else if (cursor > 0) {
        const prevTick = Math.max(0, cursor - colTicks)
        const notesAtPrev = state.notes.filter(n => n.trackId === trackId && n.time >= prevTick && n.time < cursor)
        if (notesAtPrev.length > 0) {
          state.commitHistory()
          state.removeNotes(notesAtPrev.map(n => n.id))
        }
        set({ stepRecordCursorTick: prevTick })
      }
    },
    stepRecordAdvanceMode: 'release',
    setStepRecordAdvanceMode: (mode) => set({ stepRecordAdvanceMode: mode }),
    stepRecordStepSize: -1,
    setStepRecordStepSize: (ticks) => set({ stepRecordStepSize: ticks }),
    stepRecordStepColumns: 1.0,
    setStepRecordStepColumns: (cols) => set({ stepRecordStepColumns: Math.max(0.25, Math.min(32, cols)) }),
    stepRecordNoteDuration: -1,
    setStepRecordNoteDuration: (ticks) => set({ stepRecordNoteDuration: ticks }),
    stepRecordNoteColumns: 1.0,
    setStepRecordNoteColumns: (cols) => set({ stepRecordNoteColumns: Math.max(0.25, Math.min(32, cols)) }),
    stepRecordGatePercent: 100,
    setStepRecordGatePercent: (pct) => set({ stepRecordGatePercent: Math.max(10, Math.min(400, pct)) }),
    stepRecordChordSensitivityMs: 120,
    setStepRecordChordSensitivityMs: (ms) => set({ stepRecordChordSensitivityMs: Math.max(20, Math.min(500, ms)) }),
    voicePresets: (() => {
      try {
        const saved = localStorage.getItem('musegrid_voice_presets')
        if (saved) {
          return JSON.parse(saved)
        }
      } catch (e) {
        console.warn('Failed to load voice presets', e)
      }
      return DEFAULT_VOICE_PRESETS
    })(),
    addVoicePreset: (preset) => set((state) => {
      const exists = state.voicePresets.some(p => p.id === preset.id)
      const newPresets = exists
        ? state.voicePresets.map(p => p.id === preset.id ? preset : p)
        : [...state.voicePresets, preset]
      localStorage.setItem('musegrid_voice_presets', JSON.stringify(newPresets))
      return { voicePresets: newPresets }
    }),
    deleteVoicePreset: (id) => set((state) => {
      const newPresets = state.voicePresets.filter(p => p.id !== id)
      localStorage.setItem('musegrid_voice_presets', JSON.stringify(newPresets))
      return { voicePresets: newPresets }
    }),
  }
})

// Debounced autosave to localStorage (prevents main thread stutter during playback/playhead updates)
let autosaveTimer: any = null
useStore.subscribe((state, prevState) => {
  if (state.studioSettings.persistenceEnabled === false) {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null }
    localStorage.removeItem('musegrid_autosave')
    localStorage.removeItem('musegrid_custom_fx_configs')
    localStorage.removeItem('musegrid_voice_presets')
    return
  }

  // Fast skip if the only thing that changed was playhead position or transient playback ticks
  if (state.playheadPosition !== prevState.playheadPosition &&
      state.notes === prevState.notes &&
      state.tracks === prevState.tracks &&
      state.bpm === prevState.bpm &&
      state.automationCurves === prevState.automationCurves &&
      state.columnWidths === prevState.columnWidths &&
      state.customFxConfigs === prevState.customFxConfigs &&
      state.voicePresets === prevState.voicePresets &&
      state.isDirty === prevState.isDirty) {
    return
  }

  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    try {
      const curState = useStore.getState()
      const saveState = {
        projectName: curState.projectName,
        projectFilePath: curState.projectFilePath,
        bpm: curState.bpm,
        completeNotesOnPause: curState.completeNotesOnPause,
        tracks: curState.tracks,
        notes: curState.notes,
        columnWidths: curState.columnWidths,
        activeTrackId: curState.activeTrackId,
        loopEnabled: curState.loopEnabled,
        loopStart: curState.loopStart,
        loopEnd: curState.loopEnd,
        scaleLock: curState.scaleLock,
        snapEnabled: curState.snapEnabled,
        snapResolution: curState.snapResolution,
        gridBlockTicks: curState.gridBlockTicks,
        minNoteSize: curState.minNoteSize,
        gridShadeEvery: curState.gridShadeEvery,
        gridColumnCount: curState.gridColumnCount,
        swing: curState.swing,
        metronomeEnabled: curState.metronomeEnabled,
        metronomeVolume: curState.metronomeVolume,
        grooveTemplates: curState.grooveTemplates,
        activeGrooveTemplateId: curState.activeGrooveTemplateId,
        grooveTimingStrength: curState.grooveTimingStrength,
        grooveVelocityStrength: curState.grooveVelocityStrength,
        grooveExtractionTargetAll: curState.grooveExtractionTargetAll,
        quantizeInputEnabled: curState.quantizeInputEnabled,
        playheadFollowMode: curState.playheadFollowMode,
        automationCurves: curState.automationCurves,
        automationTargets: curState.automationTargets,
        clips: curState.clips,
        groups: curState.groups,
        drumSteps: curState.drumSteps,
        timeSignature: curState.timeSignature,
        metronomeSettings: curState.metronomeSettings,
        studioSettings: curState.studioSettings,
        leftPaneWidth: curState.leftPaneWidth,
        leftPaneCollapsed: curState.leftPaneCollapsed,
        splitRatio: curState.splitRatio,
        leftPaneTopRatio: curState.leftPaneTopRatio,
        isLeftPaneFlipped: curState.isLeftPaneFlipped,
        midiRemapData: curState.midiRemapData,
        showSynthVelocity: curState.showSynthVelocity,
        showDrumVelocity: curState.showDrumVelocity,
        vocalVelocityMin: curState.vocalVelocityMin,
        vocalVelocityMax: curState.vocalVelocityMax,
        vocalVelocityScale: curState.vocalVelocityScale,
        vocalVelocityEnabled: curState.vocalVelocityEnabled,
        gridResizable: curState.gridResizable,
        autoExtendGrid: curState.autoExtendGrid,
        customFxConfigs: curState.customFxConfigs,
        horizScrollLockEnabled: curState.horizScrollLockEnabled,
        vertScrollLockEnabled: curState.vertScrollLockEnabled,
        readOnlyMode: curState.readOnlyMode,
        bothGridActive: curState.bothGridActive,
        scrollBoth: curState.scrollBoth,
        sharedPanX: curState.sharedPanX,
        ghostNotesEnabled: curState.ghostNotesEnabled,
        ghostNoteOpacity: curState.ghostNoteOpacity,
        ghostCrossInstrument: curState.ghostCrossInstrument,
        pitchSnapEnabled: curState.pitchSnapEnabled,
        pitchDropSnap: curState.pitchDropSnap,
        pitchSnapSensitivity: curState.pitchSnapSensitivity,
        verticalMergeThreshold: curState.verticalMergeThreshold,
        verticalStretchMode: curState.verticalStretchMode,
        glideStyle: curState.glideStyle,
        customSynthRows: curState.customSynthRows,
        customDrumRows: curState.customDrumRows,
        synthLowerOctave: curState.synthLowerOctave,
        synthUpperOctave: curState.synthUpperOctave,
        scriptContent: curState.scriptContent,
        voicePresets: curState.voicePresets,
      }
      localStorage.setItem('musegrid_autosave', JSON.stringify(saveState))
      localStorage.setItem('musegrid_custom_fx_configs', JSON.stringify(curState.customFxConfigs))
      localStorage.setItem('musegrid_voice_presets', JSON.stringify(curState.voicePresets))
    } catch (e) {
      console.warn('Autosave failed:', e)
    }
  }, 1000)
})

// Load user default preferences on init if saved
try {
  const savedDefaults = localStorage.getItem('musegrid_default_preferences')
  if (savedDefaults) {
    const parsed = JSON.parse(savedDefaults)
    if (parsed && typeof parsed === 'object') {
      const topLevelUpdates: any = {}
      const keys = [
        'engineMode', 'metronomeEnabled', 'metronomeVolume',
        'bpm', 'timeSignature', 'swing', 'loopEnabled', 'loopStart', 'loopEnd',
        'playheadFollowMode', 'completeNotesOnPause', 'midiOverdub',
        'activeTool', 'noteInspectorEnabled', 'readOnlyMode',
        'snapEnabled', 'snapResolution', 'gridBlockTicks', 'dropSnap',
        'gridShadeEvery', 'gridColumnCount', 'drumSteps', 'autoExtendGrid',
        'minNoteSize', 'gridResizable', 'quantizeInputEnabled', 'quantizeStrength',
        'scaleLock', 'pitchSnapEnabled', 'pitchDropSnap', 'pitchSnapSensitivity',
        'verticalMergeThreshold', 'verticalStretchMode', 'glideStyle',
        'synthLowerOctave', 'synthUpperOctave', 'customSynthRows', 'customDrumRows',
        'gridSplitOrder', 'gridPaneMode', 'splitRatio', 'leftPaneTopRatio',
        'isLeftPaneFlipped', 'leftPaneWidth', 'leftPaneCollapsed', 'scrollBoth',
        'bothGridActive', 'horizScrollLockEnabled', 'vertScrollLockEnabled',
        'zoomSynth', 'zoomDrum', 'syncZoom', 'ghostNotesEnabled',
        'ghostNoteOpacity', 'ghostCrossInstrument', 'showSynthVelocity',
        'showDrumVelocity', 'vocalVelocityEnabled', 'vocalVelocityMin',
        'vocalVelocityMax', 'vocalVelocityScale', 'deduplicateEnabled',
        'deduplicateProximityTolerance', 'deduplicateOverlapThreshold',
        'grooveTemplates', 'activeGrooveTemplateId', 'grooveTimingStrength',
        'grooveVelocityStrength', 'grooveExtractionTargetAll',
        'customFxConfigs', 'voicePresets', 'midiRemapData'
      ]
      keys.forEach(k => {
        if (parsed[k] !== undefined) topLevelUpdates[k] = parsed[k]
      })
      if (parsed.studioSettings) {
        topLevelUpdates.studioSettings = { ...useStore.getState().studioSettings, ...parsed.studioSettings }
      }
      if (parsed.metronomeSettings) {
        topLevelUpdates.metronomeSettings = { ...useStore.getState().metronomeSettings, ...parsed.metronomeSettings }
      }
      useStore.setState(topLevelUpdates)
    }
  }
} catch (e) {
  console.error('Failed to load default preferences', e)
}

// Load from localStorage on init
const saved = localStorage.getItem('musegrid_autosave')
if (saved) {
  try {
    const parsed = JSON.parse(saved)
    if (parsed && parsed.studioSettings && parsed.studioSettings.persistenceEnabled === false) {
      // Do not load
    } else {
      if (parsed.bpm <= 0 || isNaN(parsed.bpm)) parsed.bpm = 120; // Auto-rescue corrupted persistence
      useStore.getState().loadState(parsed)
    }
  } catch (e) {
    console.error('Failed to load autosave', e)
  }
}

// Auto-sync loopEnd to getMaxTicks if loopEnabled is true
useStore.subscribe((state, prevState) => {
  if (state.loopEnabled && (state.notes !== prevState.notes || state.drumSteps !== prevState.drumSteps || state.bpm !== prevState.bpm)) {
    const max = state.getMaxTicks()
    // 1 second in ticks = (BPM / 60) * 192
    const minTicksForOneSecond = Math.round((state.bpm / 60) * 192)
    const targetEnd = Math.max(state.loopStart + minTicksForOneSecond, max)

    if (targetEnd !== state.loopEnd) {
      useStore.getState().setLoopEnd(targetEnd)
    }
  }
})
