import React, { useState, useEffect } from 'react';
import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { useStore, type Note, type Track } from '../engine/store';
import { ScriptAPI } from '../engine/ScriptAPI';
import { IconPlay, IconStop, IconTrash, IconX, IconOpen, IconSave, IconHelp, IconBook, IconInfo } from './Icons';
import { audioEngine } from '../engine/AudioEngine';
import { saveFileWithDialog } from '../utils/fileExport';

// Configure Monaco Environment for local Vite web workers (no CDN, zero network delay)
if (typeof window !== 'undefined') {
  (window as any).MonacoEnvironment = {
    getWorker(_: any, label: string) {
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };
}

// Configure Monaco to use locally bundled node_modules package instead of external jsdelivr CDN
loader.config({ monaco });
const MUSE_TYPES = `
interface VoicePreset {
  id: string;
  name: string;
  vocalTractLength: number;
  breathiness: number;
  glottalTension: number;
  vibratoDepth: number;
  vibratoRate: number;
  vibratoDelay?: number;
  jitter: number;
  shimmer: number;
  formantShiftF1: number;
  formantShiftF2: number;
  formantShiftF3: number;
  consonantVolume?: number;
  consonantLength?: number;
  articulationSpeed?: number;
  synthesisMode?: 'waveguide' | 'fof' | 'formant';
  waveguideDamping?: number;
  tongueIndex?: number;
  tongueDiameter?: number;
  lipDiameter?: number;
  velumOpening?: number;
  fofAttackMs?: number;
}

interface VoiceAPI {
  getPresets(): VoicePreset[];
  getPreset(id: string): VoicePreset | undefined;
  addPreset(preset: Omit<VoicePreset, 'id'>): string;
  deletePreset(id: string): void;
  updatePreset(id: string, updates: Partial<VoicePreset>): void;
}

interface Note {
  id: string;
  trackId: string;
  time: number;
  duration: number;
  pitch: number;
  velocity: number;
  pitchSlide?: number;
  pitchSlideTime?: number;
  vibratoDepth?: number;
  vibratoRate?: number;
  filterStart?: number;
  filterEnd?: number;
  filterSweepTime?: number;
  tremoloDepth?: number;
  tremoloRate?: number;
  lyric?: string;
  voicePresetId?: string;
}

interface EditorAPI {
  getAll(): Note[];
  getForTrack(trackId: string): Note[];
  getSelectedNotes(): Note[];
  getTargetNotes(): Note[];
  replaceTargetNotes(newNotes: Note[]): void;
  addNote(note: Partial<Note> & { trackId: string; pitch: number; time: number; duration: number }): string;
  addNotes(notes: Array<Partial<Note> & { trackId: string; pitch: number; time: number; duration: number }>): string[];
  removeNote(id: string): void;
  removeNotes(ids: string[]): void;
  updateSelectedNotes(updates: Partial<Note>): void;
  transposeSelected(semitones: number): void;
  nudgeTimeSelected(ticks: number): void;
  nudgeDurationSelected(ticks: number): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  selectAll(trackId?: string): void;
  deselectAll(): void;
  selectByIds(ids: string[]): void;
  query(predicate: (n: Note) => boolean): Note[];
  quantizeSelected(): void;
  setTool(tool: 'draw' | 'erase' | 'select' | 'slice' | 'stretch'): void;
  getTool(): string;

  // Advanced MIDI Editing suite
  legato(gapTicks?: number): void;
  strum(config?: { strumTime?: number; direction?: 'up' | 'down' | 'alternate'; tension?: number; velocityRamp?: number; alignEnds?: boolean }): void;
  flam(config?: { delayTicks?: number; velocityRatio?: number }): void;
  glue(): void;
  dice(intervalTicks?: number): void;
  removeOverlaps(): void;
  chop(pattern: '1/4' | '1/8' | '1/16' | '1/32' | 'triplet' | 'dotted' | 'random' | 'swing' | 'half' | 'bar', gateRatio?: number): void;
  ratchet(slices: number, velocityProfile?: 'flat' | 'crescendo' | 'decrescendo'): void;
  microNudge(ticks: number): void;
  arpeggiate(config?: { pattern?: 'up' | 'down' | 'upDown' | 'downUp' | 'converge' | 'diverge' | 'pinkyUp' | 'thumbUp' | 'random'; rateTicks?: number; octaves?: number; gateRatio?: number }): void;
  modalTranspose(steps: number): void;
  forceToScale(): void;
  harmonize(type?: 'third' | 'fifth' | 'triad' | 'seventh' | 'ninth' | 'octaveUp' | 'octaveDown' | 'powerChord' | 'fourths' | 'sixths'): void;
  invertChord(direction?: 'up' | 'down'): void;
  velocityRamp(startVel?: number, endVel?: number, curve?: 'linear' | 'exponential' | 'logarithmic' | 'sCurve'): void;
  velocityCompress(target?: number, ratio?: number): void;
  velocityNormalize(): void;
  fixedVelocity(velocity?: number): void;
  humanize(config?: { timingJitterTicks?: number; velocityJitterPercent?: number; durationJitterPercent?: number; pitchJitterSemis?: number }): void;
  timeStretch(factor: number): void;
  flipHorizontal(): void;
  flipVertical(): void;
  purgeShortNotes(minTicks?: number): void;
  filterOddEven(keep: 'odd' | 'even'): void;
  filterVoice(voice: 'top' | 'bottom'): void;
  generateProgression(progressionIdOrName: string, spacingTicks?: number): void;
  detectChord(pitches?: number[], preferFlats?: boolean): any;
}

interface TransportAPI {
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  togglePlay(): Promise<void>;
  seek(tick: number): void;
  getPosition(): number;
  isPlaying(): boolean;
  setBpm(bpm: number): void;
  getBpm(): number;
  setTimeSignature(signature: string): void;
  getTimeSignature(): string;
  setLoop(startTicks: number, endTicks: number, enabled?: boolean): void;
  toggleLoop(enabled?: boolean): void;
  setMetronome(enabled: boolean, volume?: number): void;
  toggleMetronome(): void;
  setSwing(swingPercent: number): void;
  getSwing(): number;
  setFollowMode(mode: 'playhead' | 'grid'): void;
}

interface RecordingAPI {
  toggleLiveRecord(): void;
  startLiveRecord(): void;
  stopLiveRecord(): void;
  isLiveRecording(): boolean;
  toggleStepRecord(): void;
  startStepRecord(): void;
  stopStepRecord(): void;
  isStepRecording(): boolean;
  stepAdvance(steps?: number): void;
  stepRetreat(steps?: number): void;
  stepDelete(): void;
  setStepRecordSettings(settings: {
    stepSize?: number;
    stepColumns?: number;
    noteDuration?: number;
    noteColumns?: number;
    gatePercent?: number;
    advanceMode?: 'release' | 'timer' | 'manual';
    chordSensitivityMs?: number;
  }): void;
  recall(mode?: 'time_snap' | 'time_free' | 'sequence_columns'): void;
  getRecallBuffer(): any[];
  clearRecallBuffer(): void;
  setRecallPlacementMode(mode: 'time_snap' | 'time_free' | 'sequence_columns'): void;
  getRecallPlacementMode(): 'time_snap' | 'time_free' | 'sequence_columns';
  setCountIn(bars: 0 | 1 | 2): void;
  setInputQuantize(ticks: number): void;
  setOverdub(enabled: boolean): void;
  setQwertyKeyboard(enabled: boolean, octave?: number, velocity?: number): void;
  setScaleConform(enabled: boolean): void;
  setEdoMappingMode(mode: 'off' | 'linear' | 'harmonic'): void;
  triggerNoteOn(pitch: number, velocity?: number): void;
  triggerNoteOff(pitch: number): void;
}

interface Vst3PluginInfo {
  name: string;
  isInstrument: boolean;
  fileOrIdentifier: string;
  uniqueId: string;
}

interface Vst3API {
  getPlugins(): Vst3PluginInfo[];
  scanPlugins(): void;
  setTrackInstrument(trackId: string, pluginNameOrPath: string): boolean;
  removeTrackInstrument(trackId: string): void;
  addTrackFx(trackId: string, pluginNameOrPath: string): string;
  removeTrackFx(trackId: string, fxId: string): void;
  openEditor(trackId: string, fxId?: string): void;
  openStandaloneEditor(pluginNameOrPath: string): void;
  setTrackFxBypass(trackId: string, fxId: string, bypassed: boolean): void;
  setTrackFxWet(trackId: string, fxId: string, wet: number): void;
}

interface Track {
  id: string;
  name: string;
  instrument: 'synth' | 'drum' | 'vst3';
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  color: string;
  synthPreset?: string;
  drumKit?: string;
  edoDivision?: number;
}

interface TrackAPI {
  getAll(): Track[];
  get(trackId: string): Track | undefined;
  getActive(): Track | undefined;
  setActive(trackId: string | null): void;
  add(name: string, instrument?: 'synth' | 'drum' | 'vst3'): string;
  remove(trackId: string): void;
  removeMultiple(trackIds: string[]): void;
  duplicate(trackIds: string[]): void;
  update(trackId: string, updates: Partial<Track>): void;
  setVolume(trackId: string, volume0to100: number): void;
  setPan(trackId: string, panMinus50toPlus50: number): void;
  setMute(trackId: string, muted: boolean): void;
  setSolo(trackId: string, soloed: boolean): void;
  setColor(trackId: string, hexColor: string): void;
  setSynthPreset(trackId: string, preset: string): void;
  setDrumKit(trackId: string, kit: string): void;
  reorder(startIndex: number, endIndex: number, newParentId?: string | null): void;
  syncSettings(sourceId: string, targetId: string): void;
  clearNotes(trackId: string): void;
  eraseRegion(trackId: string, startTick: number, endTick: number): void;
  loop(trackId: string, mode: 'fillToEnd' | 'perfectCycle' | 'nTimes', snapToBar: boolean, times?: number): void;
}

interface GridAPI {
  setSnap(enabled: boolean, resolutionTicks?: number): void;
  setSnapResolution(ticks: number): void;
  toggleSnap(enabled?: boolean): void;
  setBlockTicks(ticks: number): void;
  setColumnCount(count: number): void;
  setAutoExtend(enabled: boolean): void;
  setMinNoteSize(ticks: number): void;
  setShadeEvery(bars: number): void;
  setPitchSnap(enabled: boolean, sensitivity?: number): void;
  setDropSnap(enabled: boolean): void;
  setVerticalStretchMode(mode: 'glide' | 'cluster'): void;
}

interface ScaleLock {
  enabled: boolean;
  root: number;
  mode: string;
  accidental: 'sharp' | 'flat';
}

interface TuningAPI {
  setScale(root: number, mode: string, enabled?: boolean, accidental?: 'sharp' | 'flat'): void;
  toggleScale(enabled?: boolean): void;
  setTrackScaleOverride(trackId: string, scale: ScaleLock | null): void;
  setTrackEdo(trackId: string, division: number, rootNote?: number): void;
  setScalaScale(trackId: string, scaleName: string, cents: number[]): void;
  getAvailableScales(): string[];
  getGenreProgressions(): any[];
  detectChord(pitches: number[], preferFlats?: boolean): any;
  detectScaleDegree(rootPc: number, scaleRoot?: number, scaleMode?: string): string | null;
}

interface ProjectAPI {
  new(): void;
  save(filename?: string): void;
  load(file?: File): Promise<void>;
  getState(): any;
  loadState(state: Partial<any>): void;
  undo(): void;
  redo(): void;
  commitHistory(): void;
  setProjectName(name: string): void;
  exportWav(filename?: string, options?: any): Promise<boolean>;
  exportMp3(filename?: string, options?: any): Promise<boolean>;
  exportMidi(filename?: string, options?: any): void;
  exportScore(options: { trackId: string; format?: 'musicxml'; includeLyrics?: boolean }): Promise<void>;
}

interface UiAPI {
  openModal(modal: 'scripting' | 'importAudio' | 'synthStudio' | 'drumDesigner' | 'scorePreview'): void;
  closeModal(modal: 'scripting' | 'importAudio' | 'synthStudio' | 'drumDesigner' | 'scorePreview'): void;
  toggleModal(modal: string, visible?: boolean): void;
  setPaneVisible(pane: 'rightPane' | 'helpPane' | 'leftPane', visible: boolean): void;
  togglePane(pane: 'rightPane' | 'helpPane' | 'leftPane'): void;
  setLayout(config: { leftPaneWidth?: number; splitRatio?: number; leftPaneTopRatio?: number; isLeftPaneFlipped?: boolean }): void;
  setGridPaneMode(mode: 'split' | 'synth-only' | 'drum-only' | 'active'): void;
  setGridSplitOrder(order: 'synth-first' | 'drum-first'): void;
  setZoom(synthZoom?: number, drumZoom?: number): void;
  resetZoom(): void;
  showToast(message: string, type?: 'error' | 'info' | 'success'): void;
}

interface NativeAPI {
  isAvailable(): boolean;
  postCommand(command: any): any;
}

interface MuseAPI {
  transport: TransportAPI;
  recording: RecordingAPI;
  vst3: Vst3API;
  track: TrackAPI;
  editor: EditorAPI;
  notes: EditorAPI;
  grid: GridAPI;
  tuning: TuningAPI;
  groups: any;
  clips: any;
  automation: any;
  groove: any;
  voice: VoiceAPI;
  fx: any;
  curves: any;
  project: ProjectAPI;
  ui: UiAPI;
  native: NativeAPI;
  midi: any;
  audio: any;
  getState(): any;
  prompt(message: string, defaultValue?: string): Promise<string | null>;
  promptSelect(message: string, options: string[], defaultValue?: string): Promise<string | null>;
  promptForFiles(options?: { accept?: string; multiple?: boolean }): Promise<File[]>;
  decodeAudioFile(file: File): Promise<AudioBuffer>;
  transcribeToTrack(buffer: AudioBuffer, name: string): Promise<string>;
  exportScore(options: { trackId: string; format?: 'musicxml'; includeLyrics?: boolean }): Promise<void>;
  exportAudio(filename: string, options?: any): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

declare const Muse: MuseAPI;
declare const MuseState: any;
declare const Tone: any;
`;

const SCRIPT_TEMPLATES = [
  {
    name: 'Test Cancellable Loop (100 Hellos)',
    code: `// MuseGrid Test Script: 100 Hellos with Cancellable Timer
// Tests the red Cancel button and RUNNING status indicator!
// You can click the red 'Cancel' button or press Ctrl+C at any time.

console.log("=== Starting 100 Hello Test Script ===");
console.log("Notice the red 'Cancel' button and 'RUNNING' badge in the header!");
console.log("Press 'Cancel' or hit Ctrl+C at any time to abort.");

for (let i = 1; i <= 100; i++) {
  console.log("[" + i + "/100] Hello from MuseGrid Scripting! (Elapsed: " + i + "s)");
  await Muse.sleep(1000); // 1-second pause per loop
}

console.log("=== Completed all 100 iterations successfully! ===");
MuseState.showToast("Test script finished successfully!", "success");
`
  },
  {
    name: 'Generate Neo-Soul Chords',
    code: `// Generate rich Neo-Soul chord progressions in the active track
const state = Muse.getState();
const track = state.tracks.find(t => t.id === state.activeTrackId);

if (!track || track.instrument !== 'synth') {
  console.log('Select an active Synth track to insert chord progressions.');
} else {
  // Generate Neo-Soul progression (ii9 - V13 - Imaj9 - VI7alt) starting at C3
  const notes = Muse.editor.generateProgression('neoSoul', 0, 3, 0);
  console.log('Generated ' + notes.length + ' chord notes in Neo-Soul style!');
  
  // Strum the chords upward slightly for organic feel
  Muse.editor.strum('up', 12);
}
`
  },
  {
    name: 'Hi-Hat Trap Roll / Ratchet',
    code: `// Subdivide selected notes into fast Trap hi-hat rolls with crescendo
const selected = Muse.editor.getSelectedNotes();

if (selected.length === 0) {
  console.log('Select some notes on your drum or synth track first!');
} else {
  // 6x roll with crescendo dynamics
  Muse.editor.ratchet(6, 'crescendo');
  console.log('Applied 6x ratchet roll with crescendo to selected notes.');
}
`
  },
  {
    name: 'Auto-Loop Track',
    code: `// Welcome to the MuseGrid Scripting Engine!
// You have access to MuseState, Muse, and Tone.

// Example: Auto-looping a specific track N times
const state = Muse.getState();
const firstTrack = state.tracks[0];

if (firstTrack) {
  // Loop it 4 times, snapping to bar boundaries
  Muse.track.loop(firstTrack.id, 'nTimes', true, 4);
  console.log('Looped track: ' + firstTrack.name);
} else {
  console.log('No tracks found!');
}
`
  },
  {
    name: 'Auto-Generate Drum Track',
    code: `// Generate a new drum track with a basic beat
const trackId = Muse.track.add('New Drums', 'drum');

const kickPitch = 36; // C1
const snarePitch = 38; // D1
const hatPitch = 42; // F#1

// Basic 4/4 beat (192 ticks per quarter note)
const notes = [
  { trackId, pitch: kickPitch, time: 0, duration: 96, velocity: 100 },
  { trackId, pitch: hatPitch, time: 0, duration: 48, velocity: 80 },
  { trackId, pitch: hatPitch, time: 96, duration: 48, velocity: 80 },
  { trackId, pitch: snarePitch, time: 192, duration: 96, velocity: 100 },
  { trackId, pitch: hatPitch, time: 192, duration: 48, velocity: 80 },
  { trackId, pitch: hatPitch, time: 288, duration: 48, velocity: 80 },
  { trackId, pitch: kickPitch, time: 384, duration: 96, velocity: 100 },
  { trackId, pitch: hatPitch, time: 384, duration: 48, velocity: 80 },
  { trackId, pitch: hatPitch, time: 480, duration: 48, velocity: 80 },
  { trackId, pitch: snarePitch, time: 576, duration: 96, velocity: 100 },
  { trackId, pitch: hatPitch, time: 576, duration: 48, velocity: 80 },
  { trackId, pitch: hatPitch, time: 672, duration: 48, velocity: 80 },
];

notes.forEach(note => {
  const newNote = { id: 'note-' + Date.now() + Math.random(), ...note };
  MuseState.addNote(newNote);
});

console.log('Generated basic drum beat');
`
  },
  {
    name: 'Humanize Active Track',
    code: `// Add slight randomization to timing and velocity
const state = Muse.getState();
const activeTrackId = state.activeTrackId;

if (!activeTrackId) {
  console.log('Please select a track first');
} else {
  // Ask for humanization parameters
  const timingInput = await Muse.prompt('Enter timing variance in ticks (0-96):', '10');
  if (timingInput === null) return; // Cancelled
  const velocityInput = await Muse.prompt('Enter velocity variance (0-127):', '15');
  if (velocityInput === null) return; // Cancelled

  const timingVary = parseInt(timingInput) || 0;
  const velVary = parseInt(velocityInput) || 0;
  
  const notes = state.notes.filter(n => n.trackId === activeTrackId);
  notes.forEach(n => {
    const timeOffset = Math.floor(Math.random() * timingVary * 2) - timingVary;
    const velOffset = Math.floor(Math.random() * velVary * 2) - velVary;
    
    MuseState.updateNote(n.id, {
      time: Math.max(0, n.time + timeOffset),
      velocity: Math.max(1, Math.min(127, n.velocity + velOffset))
    });
  });
  console.log('Humanized ' + notes.length + ' notes with timing variance ' + timingVary + ' and velocity variance ' + velVary);
}
`
  },
  {
    name: 'Create Offline Pre-Echo FX',
    code: `// Create a non-causal custom FX card with sliders, then add it to the active track.
// It runs during WAV/MP3 export, where it can read future samples from the full track buffer.
const state = Muse.getState();
const track = state.tracks.find(t => t.id === state.activeTrackId) || state.tracks[0];

if (!track) {
  console.log('Create or select a track first.');
} else {
  const effectId = Muse.fx.createOfflineEffect({
    id: 'script-pre-echo',
    name: 'Script Pre-Echo',
    params: [
      { name: 'wet', label: 'Wet', min: 0, max: 1, defaultVal: 0.35 },
      { name: 'preDelay', label: 'Pre Echo', min: 0.01, max: 2, defaultVal: 0.25 },
      { name: 'feedback', label: 'Feedback', min: 0, max: 0.95, defaultVal: 0.35 }
    ],
    code: \`const wet = params.wet ?? 0.35;
const offset = Math.max(1, Math.floor((params.preDelay ?? 0.25) * sampleRate));
const feedback = params.feedback ?? 0.35;

for (let channel = 0; channel < input.length; channel++) {
  const inData = input[channel];
  const outData = output[channel];
  for (let i = 0; i < inData.length; i++) {
    const future = i + offset < inData.length ? inData[i + offset] : 0;
    const fartherFuture = i + offset * 2 < inData.length ? inData[i + offset * 2] : 0;
    outData[i] = inData[i] + (future + fartherFuture * feedback) * wet;
  }
}\`
  });

  const instanceId = Muse.fx.addCustomEffectToTrack(track.id, effectId);
  console.log('Added Script Pre-Echo to ' + track.name + ' as ' + instanceId);
}
`
  },
  {
    name: 'Toggle Engine Mode',
    code: `// Toggle between Tone.js and WASM engines
const currentMode = Muse.audio.getEngineMode();
console.log('Current engine: ' + currentMode);

if (currentMode === 'tone') {
  Muse.audio.setEngineMode('wasm');
  console.log('Switched to WASM (High-Performance DSP)');
} else {
  Muse.audio.setEngineMode('tone');
  console.log('Switched to Tone.js (Web Audio Synthesis)');
}
`
  },
  {
    name: 'Voice Preset & Lyrics Builder',
    code: `// Create a custom vocal voice preset and assign lyrics to a melody
// 1. Add a new soprano voice preset with customized tracts
const presetId = Muse.voice.addPreset({
  name: 'Celestial Alto',
  vocalTractLength: 1.25,
  breathiness: 0.15,
  glottalTension: 0.75,
  vibratoDepth: 45,
  vibratoRate: 5.8,
  jitter: 0.2,
  shimmer: 0.12,
  formantShiftF1: 15,
  formantShiftF2: -10,
  formantShiftF3: 5
});

console.log('Created vocal voice preset: Celestial Alto (id: ' + presetId + ')');

// 2. Add a new vocal synth track
const trackId = Muse.track.add('Solo Vocalist', 'synth');
Muse.track.update(trackId, { synthPreset: 'vocal' });

// 3. Generate a melody with lyric syllables and preset assignments
const lyricSyllables = ['Dai', 'sy', 'Dai', 'sy', 'give', 'me', 'your', 'an', 'swer', 'do'];
const melodyPitches = [64, 60, 62, 55, 57, 59, 60, 62, 64, 60];
const durations = [96, 48, 96, 48, 48, 48, 48, 48, 48, 192];

let timeAccumulator = 0;
for (let i = 0; i < melodyPitches.length; i++) {
  MuseState.addNote({
    id: 'lyric-note-' + i + '-' + Date.now(),
    trackId: trackId,
    pitch: melodyPitches[i],
    time: timeAccumulator,
    duration: durations[i],
    velocity: 100,
    lyric: lyricSyllables[i],
    voicePresetId: presetId
  });
  timeAccumulator += durations[i];
}

console.log('Built waltz melody with lyrics and custom voice preset!');
`
  },
  {
    name: 'DAW Transport & Playback Automation',
    code: `// Automate DAW Transport, Tempo, and Metronome
console.log('Current Project BPM:', Muse.transport.getBpm());

// 1. Set global tempo to 128 BPM and 4/4 Time Signature
Muse.transport.setBpm(128);
Muse.transport.setTimeSignature('4/4');

// 2. Set active 4-bar loop (0 to 768 ticks)
Muse.transport.setLoop(0, 768, true);

// 3. Enable metronome with 80% volume
Muse.transport.setMetronome(true, 0.8);

// 4. Start playback
await Muse.transport.play();
console.log('Playback started! Playhead at tick:', Muse.transport.getPosition());
`
  },
  {
    name: 'Native VST3 Host & Reverb Rack',
    code: `// Programmatically scan and load native VST3 plugins
const plugins = Muse.vst3.getPlugins();
console.log('Detected VST3 Plugins (' + plugins.length + '):', plugins.map(p => p.name).join(', '));

// 1. Get or create active synth track
const state = Muse.getState();
const trackId = state.activeTrackId || Muse.track.add('VST3 Synth Track', 'synth');

// 2. Load instrument if available or trigger scan
if (plugins.length > 0) {
  const plugin = plugins.find(p => p.isInstrument) || plugins[0];
  Muse.vst3.setTrackInstrument(trackId, plugin.name);
  console.log('Loaded VST3 Instrument: ' + plugin.name + ' on track: ' + trackId);

  // Open native floating editor window
  Muse.vst3.openEditor(trackId);
} else {
  console.log('Scanning system VST3 directories for plugins...');
  Muse.vst3.scanPlugins();
}

// 3. Add high-density DPreverb rack FX
Muse.fx.setDPreverb(trackId, { wet: 0.4, tail: 12, decay: 0.8, tone: 0.6 });
console.log('Configured DPreverb rack FX with 12s dynamic tail.');
`
  },
  {
    name: 'Step Recording & Active Recall',
    code: `// Programmatic step recording & performance capture
console.log('Arming Step Recording with 1/16th note steps...');
Muse.recording.setStepRecordSettings({
  stepSize: 48, // 1/16th note
  gatePercent: 90,
  advanceMode: 'release',
  chordSensitivityMs: 120
});
Muse.recording.startStepRecord();

// Inspect retrospective performance capture buffer
const buffer = Muse.recording.getRecallBuffer();
console.log('Retrospective buffer contains ' + buffer.length + ' captured notes');

if (buffer.length > 0) {
  // Recall notes into active track using Time + Snap
  Muse.recording.recall('time_snap');
  console.log('Recalled captured performance into active track!');
}
`
  },
  {
    name: 'Microtonal 31-EDO Progression',
    code: `// Setup 31-EDO Microtonal Synth Track
const trackId = Muse.track.add('31-EDO Microtonal', 'synth');
Muse.tuning.setTrackEdo(trackId, 31, 60);

// Generate 31-EDO scale steps (subdividing the octave into 31 equal divisions)
const edoIntervals = [0, 5, 10, 13, 18, 23, 28, 31];
const rootPitch = 60; // C4
const stepSize = 12 / 31;

edoIntervals.forEach((step, idx) => {
  Muse.editor.addNote({
    trackId: trackId,
    pitch: rootPitch + step * stepSize,
    time: idx * 96,
    duration: 84,
    velocity: 95
  });
});

console.log('Generated 8 notes in 31-EDO microtonal tuning on track: ' + trackId);
`
  },
  {
    name: 'Batch Render & Stem Exporter',
    code: `// Batch export complete project mix & individual tracks
console.log('Starting offline export...');

// 1. Export Master Mixdown WAV (Normalized with auto-fade)
await Muse.project.exportWav('Master_Mix.wav', { normalize: true, autoFade: true });
console.log('Master WAV exported successfully');

// 2. Export 320kbps MP3
await Muse.project.exportMp3('Master_Preview.mp3', { mp3Kbps: 320 });
console.log('MP3 preview exported successfully');

// 3. Export MIDI score
Muse.project.exportMidi('Project_Midi.mid');
console.log('MIDI exported successfully');
`
  }
];

interface ApiDocEntry {
  signature: string;
  category: 'transport' | 'recording' | 'vst3' | 'track' | 'editor' | 'grid' | 'tuning' | 'project' | 'audio' | 'state';
  summary: string;
  snippet: string;
}

const SCRIPT_API_DOCS: ApiDocEntry[] = [
  // 1. Transport & Playback (Muse.transport)
  {
    category: 'transport',
    signature: 'Muse.transport.play()',
    summary: 'Start project playback and synchronize native JUCE audio engine.',
    snippet: 'await Muse.transport.play();',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.pause()',
    summary: 'Pause project playback while maintaining current playhead position.',
    snippet: 'Muse.transport.pause();',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.stop()',
    summary: 'Stop playback, reset playhead to 0, and kill all active sounding notes.',
    snippet: 'Muse.transport.stop();',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.togglePlay()',
    summary: 'Toggle between playback and paused state.',
    snippet: 'await Muse.transport.togglePlay();',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.seek(ticks)',
    summary: 'Seek playhead position to an absolute tick location.',
    snippet: 'Muse.transport.seek(0); // Return to beginning',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.setBpm(bpm)',
    summary: 'Set global tempo (20 to 999 BPM) with smooth ramp.',
    snippet: 'Muse.transport.setBpm(126);',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.setTimeSignature(signature)',
    summary: 'Set project time signature ("4/4", "3/4", "6/8", "7/8", etc.).',
    snippet: 'Muse.transport.setTimeSignature("7/8");',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.setLoop(startTicks, endTicks, enabled?)',
    summary: 'Configure loop boundaries in ticks and toggle loop mode.',
    snippet: 'Muse.transport.setLoop(0, 768, true); // Loop first 4 bars',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.setMetronome(enabled, volume?)',
    summary: 'Enable or disable audible metronome click and adjust volume (0 to 1).',
    snippet: 'Muse.transport.setMetronome(true, 0.75);',
  },
  {
    category: 'transport',
    signature: 'Muse.transport.setSwing(percent)',
    summary: 'Apply swing percentage (0 to 100%) to timeline playback.',
    snippet: 'Muse.transport.setSwing(25);',
  },

  // 2. Recording & Capture (Muse.recording)
  {
    category: 'recording',
    signature: 'Muse.recording.startLiveRecord()',
    summary: 'Arm and begin live MIDI and performance recording.',
    snippet: 'Muse.recording.startLiveRecord();',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.stopLiveRecord()',
    summary: 'Stop live recording and commit recorded takes to history.',
    snippet: 'Muse.recording.stopLiveRecord();',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.toggleStepRecord()',
    summary: 'Toggle column-by-column Step Recording mode.',
    snippet: 'Muse.recording.toggleStepRecord();',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.setStepRecordSettings(settings)',
    summary: 'Configure step recording advance mode ("release", "timer", "manual"), step size, and duration.',
    snippet: 'Muse.recording.setStepRecordSettings({ stepSize: 48, gatePercent: 95, advanceMode: "release" });',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.stepAdvance(steps?)',
    summary: 'Manually advance the step recording cursor forward by N columns/steps.',
    snippet: 'Muse.recording.stepAdvance(1);',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.stepRetreat(steps?)',
    summary: 'Move step recording cursor backwards.',
    snippet: 'Muse.recording.stepRetreat(1);',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.stepDelete()',
    summary: 'Delete all notes located in the current step recording column.',
    snippet: 'Muse.recording.stepDelete();',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.recall(mode?)',
    summary: 'Active Recall retrospective notes ("time_snap", "time_free", or "sequence_columns").',
    snippet: 'Muse.recording.recall("time_snap");',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.getRecallBuffer()',
    summary: 'Inspect notes currently retained in retrospective performance memory.',
    snippet: 'const buffer = Muse.recording.getRecallBuffer();\nconsole.log("Memory count:", buffer.length);',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.clearRecallBuffer()',
    summary: 'Flush retrospective buffer memory.',
    snippet: 'Muse.recording.clearRecallBuffer();',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.triggerNoteOn(pitch, velocity?)',
    summary: 'Simulate live Note On event from script or external hardware.',
    snippet: 'Muse.recording.triggerNoteOn(60, 100); // Middle C',
  },
  {
    category: 'recording',
    signature: 'Muse.recording.triggerNoteOff(pitch)',
    summary: 'Simulate Note Off event.',
    snippet: 'Muse.recording.triggerNoteOff(60);',
  },

  // 3. Native VST3 Host (Muse.vst3)
  {
    category: 'vst3',
    signature: 'Muse.vst3.getPlugins()',
    summary: 'Retrieve all detected native 64-bit VST3 instruments and effects.',
    snippet: 'const plugins = Muse.vst3.getPlugins();\nconsole.log(plugins.map(p => p.name));',
  },
  {
    category: 'vst3',
    signature: 'Muse.vst3.scanPlugins()',
    summary: 'Trigger native scan of system VST3 folders (%CommonProgramFiles%/VST3).',
    snippet: 'Muse.vst3.scanPlugins();',
  },
  {
    category: 'vst3',
    signature: 'Muse.vst3.setTrackInstrument(trackId, pluginNameOrPath)',
    summary: 'Assign a native VST3 plugin as a track instrument.',
    snippet: 'Muse.vst3.setTrackInstrument(trackId, "Vital");',
  },
  {
    category: 'vst3',
    signature: 'Muse.vst3.removeTrackInstrument(trackId)',
    summary: 'Deallocate VST3 instrument from track and revert to default synthesizer.',
    snippet: 'Muse.vst3.removeTrackInstrument(trackId);',
  },
  {
    category: 'vst3',
    signature: 'Muse.vst3.addTrackFx(trackId, pluginNameOrPath)',
    summary: 'Insert a native VST3 effect into a track FX chain.',
    snippet: 'const fxId = Muse.vst3.addTrackFx(trackId, "ValhallaVintageVerb");',
  },
  {
    category: 'vst3',
    signature: 'Muse.vst3.openEditor(trackId, fxId?)',
    summary: 'Open the native floating GUI window for a track VST3 instrument or effect.',
    snippet: 'Muse.vst3.openEditor(trackId);',
  },

  // 4. MIDI & Note Editor (Muse.editor)
  {
    category: 'editor',
    signature: 'Muse.editor.addNote(note)',
    summary: 'Insert a single note onto a track with pitch, time, duration, and velocity.',
    snippet: 'Muse.editor.addNote({ trackId, pitch: 60, time: 0, duration: 96, velocity: 100 });',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.addNotes(notes[])',
    summary: 'Batch insert an array of notes in a single history transaction.',
    snippet: 'Muse.editor.addNotes([\n  { trackId, pitch: 60, time: 0, duration: 48 },\n  { trackId, pitch: 64, time: 48, duration: 48 },\n  { trackId, pitch: 67, time: 96, duration: 96 }\n]);',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.query(predicate)',
    summary: 'Query all notes across the project matching custom predicate filter.',
    snippet: 'const loudNotes = Muse.editor.query(n => n.velocity > 110);',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.ratchet(slices, velocityProfile?)',
    summary: 'Subdivide selected notes into 2x-12x ratchets with "flat", "crescendo", or "decrescendo" dynamics.',
    snippet: 'Muse.editor.ratchet(6, "crescendo");',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.microNudge(ticks)',
    summary: 'Shift note timings by minute sub-grid ticks (+/-1, +/-6) for unquantized pocket groove.',
    snippet: 'Muse.editor.microNudge(6);',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.strum(direction?, spreadTicks?)',
    summary: 'Stagger chord notes with organic micro-delays ("up" or "down").',
    snippet: 'Muse.editor.strum({ direction: "up", strumTime: 14 });',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.generateProgression(style, spacingTicks?)',
    summary: 'Generate an authentic genre chord progression ("popAnthem", "neoSoul", "darkTrap", "cinematic", "animeRoyal", "andalusian").',
    snippet: 'Muse.editor.generateProgression("neoSoul", 192);',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.detectChord()',
    summary: 'Detect chord name, harmonic quality, inversion, and scale degree of selected notes.',
    snippet: 'const chord = Muse.editor.detectChord();\nconsole.log(chord?.fullName, chord?.inversion);',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.legato()',
    summary: 'Stretch note durations to meet the onset of the next note, eliminating silence.',
    snippet: 'Muse.editor.legato();',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.flam(options?)',
    summary: 'Create quick drum flam / grace note double triggers.',
    snippet: 'Muse.editor.flam({ delayTicks: 12, velocityRatio: 0.8 });',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.glue()',
    summary: 'Merge contiguous notes of identical pitch into sustained notes.',
    snippet: 'Muse.editor.glue();',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.dice(intervalTicks?)',
    summary: 'Slice sustained notes cleanly across active grid boundaries.',
    snippet: 'Muse.editor.dice(48);',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.removeOverlaps()',
    summary: 'Truncate overlapping notes on the same pitch to prevent voice collisions.',
    snippet: 'Muse.editor.removeOverlaps();',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.chop(pattern, gateRatio?)',
    summary: 'Subdivide notes by pattern ("1/4", "1/8", "1/16", "1/32", "triplet", "dotted", "swing", etc.).',
    snippet: 'Muse.editor.chop("1/16", 0.9);',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.arpeggiate(options?)',
    summary: 'Arpeggiate chord notes ("up", "down", "upDown", "downUp", "converge", "diverge", "random").',
    snippet: 'Muse.editor.arpeggiate({ pattern: "upDown", rateTicks: 48, octaves: 2 });',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.modalTranspose(steps)',
    summary: 'Transpose notes up or down by scale degrees within the active project key.',
    snippet: 'Muse.editor.modalTranspose(1);',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.forceToScale()',
    summary: 'Conform all chromatic notes to the nearest valid pitch in the active scale.',
    snippet: 'Muse.editor.forceToScale();',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.harmonize(type)',
    summary: 'Add parallel harmonies ("triad", "seventh", "third", "fifth", "powerChord", "octaveUp", "octaveDown").',
    snippet: 'Muse.editor.harmonize("triad");',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.invertChord(direction?)',
    summary: 'Invert chords ("up" transposes lowest note +12; "down" transposes highest note -12).',
    snippet: 'Muse.editor.invertChord("up");',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.velocityRamp(start?, end?, curve?)',
    summary: 'Smooth dynamic swells with "linear", "exponential", "logarithmic", or "sCurve".',
    snippet: 'Muse.editor.velocityRamp(40, 115, "sCurve");',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.humanize(options?)',
    summary: 'Add natural human performance jitter to timing, velocity, duration, and pitch.',
    snippet: 'Muse.editor.humanize({ timingJitterTicks: 8, velocityJitterPercent: 15 });',
  },
  {
    category: 'editor',
    signature: 'Muse.editor.timeStretch(factor)',
    summary: 'Time stretch notes (0.5 = 2x double-time speed, 2.0 = half-time speed).',
    snippet: 'Muse.editor.timeStretch(0.5);',
  },

  // 5. Tracks & Mixer (Muse.track)
  {
    category: 'track',
    signature: 'Muse.track.add(name, instrument?)',
    summary: 'Create a new synth or drum track and return the new track ID.',
    snippet: 'const trackId = Muse.track.add("Lead Synth", "synth");',
  },
  {
    category: 'track',
    signature: 'Muse.track.update(trackId, updates)',
    summary: 'Update track volume (0-100), pan (-50 to +50), mute, solo, or color.',
    snippet: 'Muse.track.update(trackId, { volume: 85, pan: -10, color: "#4dabf7" });',
  },
  {
    category: 'track',
    signature: 'Muse.track.setSynthPreset(trackId, preset)',
    summary: 'Change sound preset for synthesizer track.',
    snippet: 'Muse.track.setSynthPreset(trackId, "warmPad");',
  },
  {
    category: 'track',
    signature: 'Muse.track.setDrumKit(trackId, kit)',
    summary: 'Change kit sample set for drum machine track.',
    snippet: 'Muse.track.setDrumKit(trackId, "808");',
  },
  {
    category: 'track',
    signature: 'Muse.track.loop(trackId, mode, snapToBar, times?)',
    summary: 'Loop track notes. Modes: "nTimes", "fillToEnd", "perfectCycle".',
    snippet: 'Muse.track.loop(trackId, "nTimes", true, 4);',
  },

  // 6. Grid & Quantization (Muse.grid)
  {
    category: 'grid',
    signature: 'Muse.grid.setSnap(enabled, resolutionTicks?)',
    summary: 'Enable or disable grid snapping, setting snap resolution (192=1/4, 96=1/8, 48=1/16, 24=1/32).',
    snippet: 'Muse.grid.setSnap(true, 48); // 1/16th snap',
  },
  {
    category: 'grid',
    signature: 'Muse.grid.setColumnCount(count)',
    summary: 'Adjust the total number of measure columns visible on the timeline canvas.',
    snippet: 'Muse.grid.setColumnCount(300);',
  },
  {
    category: 'grid',
    signature: 'Muse.grid.setPitchSnap(enabled, sensitivity?)',
    summary: 'Toggle vertical pitch snapping on free-pitch canvas.',
    snippet: 'Muse.grid.setPitchSnap(true, 0.4);',
  },

  // 7. Tuning & Scales (Muse.tuning)
  {
    category: 'tuning',
    signature: 'Muse.tuning.setScale(root, mode, enabled?, accidental?)',
    summary: 'Set project scale lock (e.g. root 0=C, mode "Minor", enabled true).',
    snippet: 'Muse.tuning.setScale(0, "Minor", true);',
  },
  {
    category: 'tuning',
    signature: 'Muse.tuning.setTrackEdo(trackId, division, rootNote?)',
    summary: 'Configure microtonal Equal Division of the Octave (e.g. 19, 24, 31, 47, 53, 69-EDO).',
    snippet: 'Muse.tuning.setTrackEdo(trackId, 31, 60);',
  },
  {
    category: 'tuning',
    signature: 'Muse.tuning.setScalaScale(trackId, scaleName, cents[])',
    summary: 'Load custom Scala (.scl) microtonal interval tuning on track.',
    snippet: 'Muse.tuning.setScalaScale(trackId, "Werckmeister III", [0, 90, 192, 294, 390, 498, 588, 696, 792, 888, 996, 1092, 1200]);',
  },

  // 8. Project & File I/O (Muse.project)
  {
    category: 'project',
    signature: 'Muse.project.new()',
    summary: 'Start clean new project, deallocating VST3s and resetting tracks to pristine initial state.',
    snippet: 'Muse.project.new();',
  },
  {
    category: 'project',
    signature: 'Muse.project.save(filename?)',
    summary: 'Export current project as a .muz / .muse bundle.',
    snippet: 'Muse.project.save("MySong.muz");',
  },
  {
    category: 'project',
    signature: 'Muse.project.exportWav(filename?, options?)',
    summary: 'Offline render high-definition WAV audio file.',
    snippet: 'await Muse.project.exportWav("mix.wav", { normalize: true });',
  },
  {
    category: 'project',
    signature: 'Muse.project.exportMp3(filename?, options?)',
    summary: 'Render and encode 320kbps MP3 audio file.',
    snippet: 'await Muse.project.exportMp3("mix.mp3", { mp3Kbps: 320 });',
  },
  {
    category: 'project',
    signature: 'Muse.project.exportMidi(filename?, options?)',
    summary: 'Export project or selected tracks to standard MIDI file with optional Scala tuning companion.',
    snippet: 'Muse.project.exportMidi("export.mid");',
  },
  {
    category: 'project',
    signature: 'Muse.project.undo()',
    summary: 'Undo the last action.',
    snippet: 'Muse.project.undo();',
  },
  {
    category: 'project',
    signature: 'Muse.project.redo()',
    summary: 'Redo the previously undone action.',
    snippet: 'Muse.project.redo();',
  },

  // 9. Audio & DSP (Muse.audio, Muse.fx)
  {
    category: 'audio',
    signature: 'Muse.audio.setEngineMode(mode)',
    summary: 'Toggle between Web Audio ("tone") and high-performance WebAssembly ("wasm").',
    snippet: 'Muse.audio.setEngineMode("wasm");',
  },
  {
    category: 'audio',
    signature: 'Muse.fx.setDPreverb(trackId, settings)',
    summary: 'Enable or adjust the high-fidelity DPreverb rack effect on a track with dynamic tail.',
    snippet: 'Muse.fx.setDPreverb(trackId, { wet: 0.45, tail: 8, decay: 0.7 });',
  },

  // 10. State & Store (MuseState)
  {
    category: 'state',
    signature: 'MuseState.addNote(note)',
    summary: 'Directly add a note object to global state.',
    snippet: 'MuseState.addNote({ id: "note-" + Date.now(), trackId, pitch: 60, time: 0, duration: 96, velocity: 100 });',
  },
  {
    category: 'state',
    signature: 'MuseState.updateNote(id, updates)',
    summary: 'Update properties of a note by its ID.',
    snippet: 'MuseState.updateNote(noteId, { velocity: 110 });',
  },
  {
    category: 'state',
    signature: 'MuseState.showToast(message, type?)',
    summary: 'Display a popup notification in the DAW ("success", "info", "error").',
    snippet: 'MuseState.showToast("Script executed successfully!", "success");',
  },
];

interface ScriptHistoryItem {
  id: string;
  timestamp: string;
  name: string;
  code: string;
  preNotes: Note[];
  preTracks: Track[];
  preLoopStart?: number;
  preLoopEnd?: number;
  preLoopEnabled?: boolean;
  preBpm?: number;
  preActiveTrackId?: string | null;
}

let scriptHistoryCache: ScriptHistoryItem[] = [];

export const ScriptingModal: React.FC = () => {
  const isVisible = useStore(state => state.isScriptingModalVisible);
  const setIsVisible = useStore(state => state.setIsScriptingModalVisible);
  const scriptContent = useStore(state => state.scriptContent);
  const setScriptContent = useStore(state => state.setScriptContent);

  const [logs, setLogs] = useState<{ message: string, type: 'info' | 'error' | 'success' }[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activePrompt, setActivePrompt] = useState<{
    message: string;
    defaultValue: string;
    options?: string[];
    resolve: (val: string | null) => void;
  } | null>(null);
  const [historyList, setHistoryList] = useState<ScriptHistoryItem[]>(scriptHistoryCache);
  const [consoleHeightRatio, setConsoleHeightRatio] = useState(0.7);
  const [editorWidthRatio, setEditorWidthRatio] = useState(0.6);
  const [isDividerDragging, setIsDividerDragging] = useState(false);
  const [isVerticalDividerDragging, setIsVerticalDividerDragging] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'console' | 'docs'>('console');
  const [docsCategory, setDocsCategory] = useState<string>('all');
  const [docsSearch, setDocsSearch] = useState('');
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [usePlainEditor, setUsePlainEditor] = useState(false);

  useEffect(() => {
    if (!editorLoaded && isVisible) {
      const timer = setTimeout(() => {
        if (!editorLoaded) {
          console.warn('[ScriptingModal] Monaco load timeout, switching to native code editor');
          setUsePlainEditor(true);
        }
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [editorLoaded, isVisible]);

  const filteredDocs = React.useMemo(() => {
    return SCRIPT_API_DOCS.filter(d => {
      const matchesCat = docsCategory === 'all' || d.category === docsCategory;
      const matchesSearch = !docsSearch ||
        d.signature.toLowerCase().includes(docsSearch.toLowerCase()) ||
        d.summary.toLowerCase().includes(docsSearch.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [docsCategory, docsSearch]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const outerContainerRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const cancelScriptRef = React.useRef(false);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const isDraggingDivider = React.useRef(false);
  const isDraggingVerticalDivider = React.useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingDivider.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const newRatio = relativeY / rect.height;
        setConsoleHeightRatio(Math.max(0.15, Math.min(0.85, newRatio)));
      }

      if (isDraggingVerticalDivider.current && outerContainerRef.current) {
        const rect = outerContainerRef.current.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        const newRatio = relativeX / rect.width;
        setEditorWidthRatio(Math.max(0.25, Math.min(0.75, newRatio)));
      }
    };

    const handleMouseUp = () => {
      isDraggingDivider.current = false;
      isDraggingVerticalDivider.current = false;
      setIsDividerDragging(false);
      setIsVerticalDividerDragging(false);
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    ScriptAPI.registerPrompt = (message: string, defaultValue: string = '', options?: string[]) => {
      return new Promise<string | null>((resolve) => {
        setActivePrompt({ message, defaultValue, options, resolve });
      });
    };
    return () => {
      ScriptAPI.registerPrompt = null;
    };
  }, []);

  if (!isVisible) return null;

  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setLogs(prev => [...prev, { message: msg, type }]);
  };

  const handleEditorWillMount = (monaco: Monaco) => {
    // Inject types into the Monaco environment for rich autocomplete
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      MUSE_TYPES,
      'ts:filename/muse.d.ts'
    );
  };

  const handleCancelScript = () => {
    cancelScriptRef.current = true;
    abortControllerRef.current?.abort();
    if (activePrompt) {
      activePrompt.resolve(null);
      setActivePrompt(null);
    }
    try {
      audioEngine.stop();
      ScriptAPI.Tone.Transport.stop();
    } catch (_) { }
    addLog('Script execution cancelled by user.', 'error');
    useStore.getState().showToast('Script cancelled', 'info');
    setIsRunning(false);
  };

  const executeScript = async () => {
    cancelScriptRef.current = false;
    abortControllerRef.current = new AbortController();
    setIsRunning(true);
    addLog('Executing script...', 'info');

    // Yield to the browser frame so React updates and the DOM paints the red Cancel button and RUNNING badge BEFORE script execution starts
    await new Promise(resolve => setTimeout(resolve, 80));

    // Snapshot state before running script
    const currentStoreState = useStore.getState();
    const preNotes = JSON.parse(JSON.stringify(currentStoreState.notes));
    const preTracks = JSON.parse(JSON.stringify(currentStoreState.tracks));
    const preLoopStart = currentStoreState.loopStart;
    const preLoopEnd = currentStoreState.loopEnd;
    const preLoopEnabled = currentStoreState.loopEnabled;
    const preBpm = currentStoreState.bpm;
    const preActiveTrackId = currentStoreState.activeTrackId;
    const codeToRun = scriptContent;

    const customConsole = {
      log: (...args: any[]) => {
        if (cancelScriptRef.current) return;
        const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        console.log(...args);
        addLog(msg, 'info');
      },
      error: (...args: any[]) => {
        if (cancelScriptRef.current) return;
        const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        console.error(...args);
        addLog(msg, 'error');
      },
      warn: (...args: any[]) => {
        if (cancelScriptRef.current) return;
        const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        console.warn(...args);
        addLog(msg, 'info');
      },
      info: (...args: any[]) => {
        if (cancelScriptRef.current) return;
        const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        console.info(...args);
        addLog(msg, 'info');
      }
    };

    // Inject cancellable sleep on ScriptAPI
    (ScriptAPI as any).sleep = (ms: number) => new Promise((resolve, reject) => {
      if (cancelScriptRef.current) return reject(new Error('Script cancelled'));
      const timer = setTimeout(() => {
        if (cancelScriptRef.current) reject(new Error('Script cancelled'));
        else resolve(undefined);
      }, ms);
      abortControllerRef.current?.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Script cancelled'));
      });
    });

    try {
      // Create an async function context so users can use top-level await
      const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

      // Inject our API and console wrapper into the scope
      const executor = new AsyncFunction('MuseState', 'Muse', 'Tone', 'console', codeToRun);

      await executor(ScriptAPI.getState(), ScriptAPI, ScriptAPI.Tone, customConsole);

      if (cancelScriptRef.current) {
        addLog('Script execution cancelled.', 'info');
        return;
      }

      addLog('Execution complete.', 'success');
      useStore.getState().showToast('Script executed successfully', 'success');

      // Add to run history list
      let scriptName = 'Custom Script';
      const firstLine = codeToRun.trim().split('\n')[0];
      if (firstLine && firstLine.startsWith('//')) {
        scriptName = firstLine.replace('//', '').trim();
      }

      const newHistoryItem: ScriptHistoryItem = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        name: scriptName,
        code: codeToRun,
        preNotes,
        preTracks,
        preLoopStart,
        preLoopEnd,
        preLoopEnabled,
        preBpm,
        preActiveTrackId
      };

      setHistoryList(prev => {
        const next = [newHistoryItem, ...prev].slice(0, 30);
        scriptHistoryCache = next;
        return next;
      });
    } catch (err: unknown) {
      if (cancelScriptRef.current) {
        addLog('Script execution cancelled.', 'info');
        return;
      }
      console.error(err);
      addLog((err as Error).message || String(err), 'error');
      useStore.getState().showToast('Script execution failed. Check console.', 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleSaveScript = async () => {
    const blob = new Blob([scriptContent], { type: 'text/javascript' });
    const saved = await saveFileWithDialog(blob, {
      filename: 'musegrid_script.js',
      title: 'Save Script',
      filters: [{ name: 'JavaScript Files', extensions: ['js', 'ts', 'txt'] }]
    });
    if (saved) {
      useStore.getState().showToast('Script saved!', 'success');
    }
  };

  const handleLoadScript = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.txt';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (re) => {
        const content = re.target?.result as string;
        setScriptContent(content);
        useStore.getState().showToast('Script loaded successfully', 'success');
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const getSystemClipboardText = async (): Promise<string> => {
    // 1. Try native JUCE bridge
    try {
      if ((window as any).ipcRenderer?.invoke) {
        const nativeText = await (window as any).ipcRenderer.invoke('get-clipboard-text');
        if (typeof nativeText === 'string' && nativeText.length > 0) {
          return nativeText;
        }
      }
    } catch (_) { }

    // 2. Try standard navigator.clipboard
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (typeof text === 'string') return text;
      }
    } catch (_) { }

    return '';
  };

  return (
    <div className="animate-modal-bg"
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && isRunning) {
          const sel = window.getSelection()?.toString();
          if (!sel) {
            e.preventDefault();
            handleCancelScript();
          }
        }
      }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(8, 9, 14, 0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 100000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px'
      }}>
      <div className="animate-modal-card" style={{
        width: '100%', maxWidth: '1000px', height: '90%',
        display: 'flex', flexDirection: 'column',
        border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px',
        boxShadow: '0 30px 80px rgba(0,0,0,0.85)', overflow: 'hidden',
        background: '#12131a'
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'rgba(255,255,255,0.01)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>&lt;/&gt;</span>
              <span style={{ fontSize: '16px', fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>Scripting Engine</span>
            </div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
              Algorithmic Composition &amp; Custom DSP
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              onClick={handleLoadScript}
              style={{
                background: 'rgba(255,255,255,0.05)', color: '#aaa', border: '1px solid rgba(255,255,255,0.1)',
                padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 800,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#aaa'; }}
              title="Load Script"
            >
              <IconOpen size={12} /> Load
            </button>
            <select
              onChange={(e) => {
                const tmpl = SCRIPT_TEMPLATES.find(t => t.name === e.target.value);
                if (tmpl) {
                  setScriptContent(tmpl.code);
                  useStore.getState().showToast('Template loaded', 'success');
                }
                e.target.value = '';
              }}
              defaultValue=""
              style={{
                background: 'rgba(255,255,255,0.05)', color: '#aaa', border: '1px solid rgba(255,255,255,0.1)',
                padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 800,
                cursor: 'pointer', appearance: 'none'
              }}
            >
              <option value="" disabled style={{ background: '#1a1b26', color: '#aaa' }}>Templates...</option>
              {SCRIPT_TEMPLATES.map(t => (
                <option key={t.name} value={t.name} style={{ background: '#1a1b26', color: '#fff' }}>{t.name}</option>
              ))}
            </select>
            <button
              onClick={handleSaveScript}
              style={{
                background: 'rgba(255,255,255,0.05)', color: '#aaa', border: '1px solid rgba(255,255,255,0.1)',
                padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 800,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#aaa'; }}
              title="Save Script"
            >
              <IconSave size={12} /> Save
            </button>
            <button
              onClick={() => setRightPanelTab(prev => prev === 'docs' ? 'console' : 'docs')}
              style={{
                background: rightPanelTab === 'docs' ? 'rgba(77,171,247,0.2)' : 'rgba(255,255,255,0.05)',
                color: rightPanelTab === 'docs' ? '#4dabf7' : '#aaa',
                border: `1px solid ${rightPanelTab === 'docs' ? 'rgba(77,171,247,0.4)' : 'rgba(255,255,255,0.1)'}`,
                padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 800,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s'
              }}
              onMouseEnter={e => { if (rightPanelTab !== 'docs') { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; } }}
              onMouseLeave={e => { if (rightPanelTab !== 'docs') { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#aaa'; } }}
              title="Toggle Scripting API Reference & Help Documentation"
            >
              <IconHelp size={12} /> {rightPanelTab === 'docs' ? 'Console' : 'Help / API'}
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
              <button
                onClick={isRunning ? handleCancelScript : executeScript}
                style={{
                  background: isRunning ? '#e03131' : '#40c057',
                  color: 'white',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease'
                }}
                title={isRunning ? "Cancel Running Script (Ctrl+C)" : "Execute Script"}
              >
                {isRunning ? <IconStop size={12} /> : <IconPlay size={12} />}
                {isRunning ? 'Cancel' : 'Run Script'}
              </button>
              {isRunning && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 2px)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#ff6b6b',
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.02em',
                    pointerEvents: 'none'
                  }}
                >
                  <span
                    style={{
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: '#ff6b6b',
                      boxShadow: '0 0 6px #ff6b6b',
                      display: 'inline-block'
                    }}
                  />
                  Running
                </div>
              )}
            </div>
            <button
              onClick={() => setIsVisible(false)}
              style={{
                background: 'none', border: 'none', color: '#666',
                cursor: 'pointer', padding: '4px',
                display: 'flex', alignItems: 'center'
              }}
            >
              <IconX size={18} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div ref={outerContainerRef} style={{ display: 'flex', flex: 1, height: '0px', userSelect: (isDividerDragging || isVerticalDividerDragging) ? 'none' : 'auto' }}>

          {/* Editor Side */}
          <div style={{ width: `${editorWidthRatio * 100}%`, display: 'flex', flexDirection: 'column', position: 'relative', background: '#0e0f14' }}>
            {!usePlainEditor ? (
              <Editor
                height="100%"
                defaultLanguage="javascript"
                theme="vs-dark"
                value={scriptContent}
                onChange={(val) => setScriptContent(val || '')}
                beforeMount={handleEditorWillMount}
                onMount={(editor, monacoInstance) => {
                  editorRef.current = editor;
                  setEditorLoaded(true);

                  // Add custom Paste action to context menu and keybinding
                  editor.addAction({
                    id: 'musegrid-paste',
                    label: 'Paste from Clipboard',
                    contextMenuGroupId: '9_cutcopypaste',
                    contextMenuOrder: 3,
                    keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyV],
                    run: async (ed) => {
                      const text = await getSystemClipboardText();
                      if (text) {
                        const selection = ed.getSelection();
                        if (selection) {
                          ed.executeEdits('custom-paste', [{
                            range: selection,
                            text: text,
                            forceMoveMarkers: true,
                          }]);
                        }
                      }
                    }
                  });
                }}
                loading={
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100%', background: '#0e0f14', color: '#888', gap: '8px'
                  }}>
                    <span style={{ fontSize: '13px' }}>Loading Code Editor...</span>
                  </div>
                }
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontFamily: 'monospace',
                  wordWrap: 'on',
                  lineNumbersMinChars: 3,
                  scrollBeyondLastLine: false,
                  contextmenu: true,
                  automaticLayout: true,
                }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0e0f14' }}>
                <div style={{
                  padding: '6px 12px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#888'
                }}>
                  <span style={{ fontWeight: 700, letterSpacing: '0.04em' }}>JAVASCRIPT CODE EDITOR</span>
                  <button
                    onClick={() => { setUsePlainEditor(false); setEditorLoaded(false); }}
                    style={{ background: 'transparent', border: 'none', color: '#4dabf7', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
                  >
                    Retry Monaco Engine
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  value={scriptContent}
                  onChange={(e) => setScriptContent(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData?.getData('text');
                    if (text) {
                      e.preventDefault();
                      const target = e.currentTarget;
                      const start = target.selectionStart;
                      const end = target.selectionEnd;
                      const nextVal = target.value.substring(0, start) + text + target.value.substring(end);
                      setScriptContent(nextVal);
                      setTimeout(() => {
                        target.selectionStart = target.selectionEnd = start + text.length;
                      }, 0);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const target = e.currentTarget;
                      const start = target.selectionStart;
                      const end = target.selectionEnd;
                      target.value = target.value.substring(0, start) + '  ' + target.value.substring(end);
                      target.selectionStart = target.selectionEnd = start + 2;
                      setScriptContent(target.value);
                    }
                  }}
                  spellCheck={false}
                  placeholder="// Write your MuseGrid automation / generator script here..."
                  style={{
                    flex: 1, width: '100%', height: '100%', background: '#0e0f14',
                    color: '#e0e6ed', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '13px',
                    lineHeight: '1.5', padding: '12px 14px', border: 'none', outline: 'none', resize: 'none',
                    whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto'
                  }}
                />
              </div>
            )}
          </div>

          {/* Resizable Vertical Divider */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingVerticalDivider.current = true;
              setIsVerticalDividerDragging(true);
              document.body.style.cursor = 'col-resize';
            }}
            style={{
              width: '6px',
              background: 'rgba(255,255,255,0.03)',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              cursor: 'col-resize',
              zIndex: 10,
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(77, 171, 247, 0.3)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
          />

          {/* Right Side: Console or Docs */}
          <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#111', height: '100%', minWidth: 0, userSelect: isDividerDragging ? 'none' : 'auto' }}>

            {/* Top Sub-Header Tabs */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: '#141419',
              padding: '0 8px'
            }}>
              <button
                onClick={() => setRightPanelTab('console')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: rightPanelTab === 'console' ? '2px solid #4dabf7' : '2px solid transparent',
                  color: rightPanelTab === 'console' ? '#fff' : '#777',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                CONSOLE & RUNS
              </button>
              <button
                onClick={() => setRightPanelTab('docs')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: rightPanelTab === 'docs' ? '2px solid #4dabf7' : '2px solid transparent',
                  color: rightPanelTab === 'docs' ? '#fff' : '#777',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s'
                }}
              >
                <IconBook size={12} /> API DOCS & HELP
              </button>
            </div>

            {rightPanelTab === 'console' ? (
              <>
                {/* Console Output (Dynamic Height) */}
                <div style={{ height: `${consoleHeightRatio * 100}%`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{
                    padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: '12px', color: '#aaa', fontWeight: 600, background: '#141419'
                  }}>
                    CONSOLE OUTPUT
                    <button onClick={() => setLogs([])} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }} title="Clear Console">
                      <IconTrash size={14} />
                    </button>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'monospace', fontSize: '12px' }} className="thin-scroll">
                    {logs.length === 0 && <span style={{ color: '#555' }}>No output yet...</span>}
                    {logs.map((log, i) => (
                      <div key={i} style={{
                        color: log.type === 'error' ? '#ff3366' : log.type === 'success' ? '#40c057' : '#ddd',
                        wordBreak: 'break-all'
                      }}>
                        {log.type === 'error' ? '[ERROR] ' : log.type === 'success' ? '[SUCCESS] ' : '> '}
                        {log.message}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Resizable Divider */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    isDraggingDivider.current = true;
                    setIsDividerDragging(true);
                    document.body.style.cursor = 'row-resize';
                  }}
                  style={{
                    height: '6px',
                    background: 'rgba(255,255,255,0.03)',
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    cursor: 'row-resize',
                    zIndex: 10,
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(77, 171, 247, 0.3)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                />

                {/* Run History (Fills remaining height) */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0e0f14', minHeight: 0 }}>
                  <div style={{
                    padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: '12px', color: '#aaa', fontWeight: 600, background: '#141419'
                  }}>
                    SCRIPT RUN HISTORY
                    {historyList.length > 0 && (
                      <button onClick={() => { setHistoryList([]); scriptHistoryCache = []; }} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }} title="Clear History">
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }} className="thin-scroll">
                    {historyList.length === 0 && <span style={{ color: '#555', fontSize: '11px', padding: '4px' }}>No runs recorded yet...</span>}
                    {historyList.map((item) => (
                      <div key={item.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        transition: 'all 0.15s ease'
                      }}>
                        <div
                          onClick={() => {
                            setScriptContent(item.code);
                            addLog(`Loaded script from history: "${item.name}"`, 'info');
                          }}
                          style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer', flex: 1, marginRight: '8px' }}
                        >
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#ddd' }}>{item.name}</span>
                          <span style={{ fontSize: '9px', color: '#666' }}>{item.timestamp}</span>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Revert script actions!
                            const state = useStore.getState();
                            state.commitHistory(); // Make it undoable

                            // Restore notes, tracks, loop region, and tempo
                            useStore.setState({
                              notes: item.preNotes,
                              tracks: item.preTracks,
                              ...(item.preLoopStart !== undefined ? { loopStart: item.preLoopStart } : {}),
                              ...(item.preLoopEnd !== undefined ? { loopEnd: item.preLoopEnd } : {}),
                              ...(item.preLoopEnabled !== undefined ? { loopEnabled: item.preLoopEnabled } : {}),
                              ...(item.preBpm !== undefined ? { bpm: item.preBpm } : {}),
                              ...(item.preActiveTrackId !== undefined ? { activeTrackId: item.preActiveTrackId } : {})
                            });

                            if (item.preBpm !== undefined) {
                              audioEngine.setBpm(item.preBpm);
                            }

                            // Re-create instruments on AudioEngine
                            item.preTracks.forEach(t => {
                              audioEngine.createInstrument(t.id, t.instrument || 'synth');
                            });

                            state.requestCanvasAlign();

                            addLog(`Reverted script changes from: "${item.name}"`, 'success');
                            useStore.getState().showToast('Script modifications reverted!', 'success');

                            // Remove item from history list
                            const updated = historyList.filter(h => h.id !== item.id);
                            setHistoryList(updated);
                            scriptHistoryCache = updated;
                          }}
                          title="Revert all changes done by this script and remove from history"
                          style={{
                            background: 'rgba(255, 51, 102, 0.1)',
                            border: 'none',
                            color: '#ff3366',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '10px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          Revert
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0e0f14', minHeight: 0, overflow: 'hidden' }}>
                {/* Search & Category Filter */}
                <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#141419', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Filter API functions, methods, parameters..."
                    value={docsSearch}
                    onChange={(e) => setDocsSearch(e.target.value)}
                    style={{
                      width: '100%', padding: '6px 10px', borderRadius: '6px',
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#fff', fontSize: '11px', outline: 'none'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }} className="thin-scroll">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'transport', label: 'Transport' },
                      { id: 'recording', label: 'Recording' },
                      { id: 'vst3', label: 'VST3 Host' },
                      { id: 'editor', label: 'MIDI Editor' },
                      { id: 'track', label: 'Tracks & Mixer' },
                      { id: 'grid', label: 'Grid' },
                      { id: 'tuning', label: 'Tuning / Scale' },
                      { id: 'project', label: 'Project & IO' },
                      { id: 'audio', label: 'Audio & FX' },
                      { id: 'state', label: 'MuseState' }
                    ].map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => setDocsCategory(cat.id as any)}
                        style={{
                          background: docsCategory === cat.id ? 'rgba(77,171,247,0.2)' : 'rgba(255,255,255,0.04)',
                          color: docsCategory === cat.id ? '#4dabf7' : '#888',
                          border: `1px solid ${docsCategory === cat.id ? 'rgba(77,171,247,0.3)' : 'rgba(255,255,255,0.06)'}`,
                          borderRadius: '12px', padding: '2px 8px', fontSize: '10px', fontWeight: 700,
                          cursor: 'pointer', whiteSpace: 'nowrap'
                        }}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* API Docs List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }} className="thin-scroll">
                  {filteredDocs.length === 0 && (
                    <div style={{ color: '#666', fontSize: '12px', padding: '16px', textAlign: 'center' }}>
                      No matching API methods found.
                    </div>
                  )}
                  {filteredDocs.map((doc, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '6px',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <code style={{ color: '#00e6ff', fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {doc.signature}
                        </code>
                        <button
                          onClick={() => {
                            setScriptContent(scriptContent ? `${scriptContent}\n\n// Inserted snippet:\n${doc.snippet}\n` : doc.snippet);
                            useStore.getState().showToast('Snippet inserted into editor', 'success');
                          }}
                          style={{
                            background: 'rgba(77,171,247,0.12)',
                            color: '#4dabf7',
                            border: '1px solid rgba(77,171,247,0.25)',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            fontSize: '9px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                          title="Insert snippet into script editor"
                        >
                          + Insert
                        </button>
                      </div>
                      <div style={{ fontSize: '11px', color: '#999', lineHeight: 1.4 }}>
                        {doc.summary}
                      </div>
                    </div>
                  ))}

                  {/* Philosophy Note */}
                  <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '6px', background: 'rgba(105,219,124,0.06)', border: '1px solid rgba(105,219,124,0.15)', fontSize: '10px', color: '#8ce99a', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                    <IconInfo size={13} style={{ flexShrink: 0, marginTop: '2px', color: '#69db7c' }} />
                    <span><strong>Active Track Scoping:</strong> All <code>Muse.editor</code> operations automatically affect selected notes on the active track (or all active track notes if none selected).</span>
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>
      </div>

      {activePrompt && (
        <div className="animate-modal-bg" style={{
          position: 'absolute', inset: 0,
          background: 'rgba(5, 5, 8, 0.75)',
          backdropFilter: 'blur(6px)',
          zIndex: 10100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px'
        }}>
          <div className="animate-modal-card" style={{
            background: '#12131a',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            width: '100%', maxWidth: '400px',
            padding: '20px',
            boxShadow: '0 24px 50px rgba(0,0,0,0.6)',
            display: 'flex', flexDirection: 'column', gap: '14px'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{activePrompt.message}</div>

            {activePrompt.options ? (
              <select
                id="prompt-select-input"
                defaultValue={activePrompt.defaultValue}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'white',
                  fontSize: '13px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  outline: 'none'
                }}
              >
                {activePrompt.options.map(opt => (
                  <option key={opt} value={opt} style={{ background: '#12131a', color: 'white' }}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                id="prompt-text-input"
                type="text"
                defaultValue={activePrompt.defaultValue}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.currentTarget as HTMLInputElement).value;
                    activePrompt.resolve(val);
                    setActivePrompt(null);
                  }
                }}
                autoFocus
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'white',
                  fontSize: '13px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  outline: 'none'
                }}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button
                onClick={() => {
                  activePrompt.resolve(null);
                  setActivePrompt(null);
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#aaa',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const inputEl = document.getElementById(activePrompt.options ? 'prompt-select-input' : 'prompt-text-input') as HTMLInputElement | HTMLSelectElement;
                  const val = inputEl ? inputEl.value : null;
                  activePrompt.resolve(val);
                  setActivePrompt(null);
                }}
                style={{
                  background: '#40c057',
                  border: 'none',
                  color: 'white',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
