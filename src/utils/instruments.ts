export type SynthPreset = 'warm' | 'piano' | 'electricPiano' | 'marimba' | 'pluck' | 'pad' | 'bass' | 'bell' | 'bright' | 'glass' | 'custom' | 'physical' | 'scripted' | 'vocal'
export type DrumKit = 'classic' | 'acoustic' | 'tight' | 'electro' | 'eightOhEight' | 'tabla' | 'custom' | 'scripted'

export const SYNTH_PRESETS: Array<{ value: SynthPreset; label: string }> = [
  { value: 'warm', label: 'Warm Synth' },
  { value: 'piano', label: 'Piano' },
  { value: 'electricPiano', label: 'Electric Piano' },
  { value: 'marimba', label: 'Marimba' },
  { value: 'pluck', label: 'Pluck' },
  { value: 'pad', label: 'Soft Pad' },
  { value: 'bass', label: 'Bass' },
  { value: 'bell', label: 'Bell' },
  { value: 'bright', label: 'Bright Lead' },
  { value: 'glass', label: 'Glass' },
  { value: 'physical', label: 'Physical Modeling' },
  { value: 'vocal', label: 'Vocal/Singing Synth' },
  { value: 'custom', label: 'Custom Synth (Studio)' },
]

export interface SynthPresetParams {
  oscillator: 'sine' | 'triangle' | 'square' | 'sawtooth'
  attack: number
  decay: number
  sustain: number
  release: number
}

/**
 * Mirrors the preset values applied by AudioEngine::setTrackSynthPreset in
 * native/Source/Audio/AudioEngine.cpp, so the studio can show what a preset really sets.
 * Presets absent here (custom/physical/scripted/vocal) have no fixed values to display.
 */
export const SYNTH_PRESET_PARAMS: Partial<Record<SynthPreset, SynthPresetParams>> = {
  warm:          { oscillator: 'triangle', attack: 0.02,  decay: 0.12, sustain: 0.48, release: 0.35 },
  piano:         { oscillator: 'triangle', attack: 0.004, decay: 0.28, sustain: 0.16, release: 0.36 },
  electricPiano: { oscillator: 'sine',     attack: 0.01,  decay: 0.32, sustain: 0.22, release: 0.45 },
  marimba:       { oscillator: 'sine',     attack: 0.003, decay: 0.28, sustain: 0.05, release: 0.22 },
  pluck:         { oscillator: 'square',   attack: 0.002, decay: 0.16, sustain: 0.12, release: 0.12 },
  pad:           { oscillator: 'sine',     attack: 0.18,  decay: 0.25, sustain: 0.70, release: 0.90 },
  bass:          { oscillator: 'square',   attack: 0.01,  decay: 0.16, sustain: 0.55, release: 0.18 },
  bell:          { oscillator: 'sine',     attack: 0.002, decay: 0.70, sustain: 0.05, release: 1.20 },
  bright:        { oscillator: 'sawtooth', attack: 0.01,  decay: 0.08, sustain: 0.42, release: 0.18 },
  glass:         { oscillator: 'triangle', attack: 0.004, decay: 0.45, sustain: 0.24, release: 0.55 },
}

export const DRUM_KITS: Array<{ value: DrumKit; label: string }> = [
  { value: 'classic', label: 'Classic' },
  { value: 'acoustic', label: 'Acoustic' },
  { value: 'tight', label: 'Tight' },
  { value: 'electro', label: 'Electric Drum' },
  { value: 'eightOhEight', label: '808' },
  { value: 'tabla', label: 'Tabla' },
  { value: 'custom', label: 'Custom Kit (Studio)' },
]

export const DEFAULT_SYNTH_PRESET: SynthPreset = 'warm'
export const DEFAULT_DRUM_KIT: DrumKit = 'classic'
