import { useStore, deduplicateNotes, EXPRESSION_LANE_TARGETS } from './store';
import type { CustomFxConfig, Note, Track, VoicePreset, Clip, TrackGroup, AutomationPoint, AutomationLane, AutomationTarget, ExpressionLaneTarget, ScaleLock, GrooveTemplate } from './store';
import { audioEngine } from './AudioEngine';
import { recordingEngine } from './RecordingEngine';
import * as Tone from 'tone';
import { renderProjectAudio } from '../utils/audioRender';
import { audioBufferToWav } from '../utils/wavEncoder';
import { audioBufferToMp3 } from '../utils/mp3Encoder';
import { generateMusicXML, downloadScore } from '../utils/scoreExport';
import { createMidiData } from '../utils/midiExport';
import { saveFileWithDialog } from '../utils/fileExport';
import { transcribeAudio } from '../utils/aiLab';
import { DEFAULT_SYNTH_PRESET, DEFAULT_DRUM_KIT, type SynthPreset, type DrumKit } from '../utils/instruments';
import { getDPreverbSettings, getMaxDPreverbTailSeconds, getTrackFxInstances } from './fxDefaults';
import {
  applyLegato, applyStrum, applyFlam, applyGlue, applyDice,
  applyRemoveOverlaps, applyChop, applyArpeggio,
  applyModalTranspose, applyForceToScale, applyHarmonize,
  applyChordInversion, applyFlipHorizontal, applyFlipVertical,
  applyTimeStretch, applyVelocityRamp, applyVelocityCompress,
  applyVelocityNormalize, applyFixedVelocity, applyHumanize,
  filterOddEvenNotes, filterVoiceNotes, applyPurgeShortNotes,
  applyRatchet, applyMicroNudge,
  type ChopPattern, type ArpPattern, type VelocityCurve, type HarmonizeType
} from '../utils/midiEditing';
import {
  detectChord, detectScaleDegree, GENRE_PROGRESSIONS, SCALE_MODES,
  type DetectedChord, type GenreProgression
} from '../utils/musicTheory';

function newId() {
  return Math.random().toString(36).substr(2, 9);
}

export type ScriptCustomFxParam = {
  name: string;
  label?: string;
  min?: number;
  max?: number;
  defaultVal?: number;
};

export type ScriptCustomFxConfig = {
  id?: string;
  name: string;
  mode?: 'realtime' | 'offline';
  code: string;
  params?: ScriptCustomFxParam[];
};

function normalizeCustomFxConfig(config: ScriptCustomFxConfig): CustomFxConfig {
  if (!config.name || !config.code) {
    throw new Error('Custom FX requires name and code');
  }

  const id = (config.id || `script-fx-${Date.now()}-${newId()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 80);

  return {
    id,
    name: String(config.name).slice(0, 80),
    mode: config.mode === 'offline' ? 'offline' : 'realtime',
    code: String(config.code),
    params: (config.params || []).map(param => ({
      name: String(param.name || '').replace(/\s+/g, ''),
      label: param.label ? String(param.label).slice(0, 40) : undefined,
      min: Number.isFinite(param.min) ? Number(param.min) : 0,
      max: Number.isFinite(param.max) ? Number(param.max) : 1,
      defaultVal: Number.isFinite(param.defaultVal) ? Number(param.defaultVal) : 0.5
    })).filter(param => param.name.length > 0)
  };
}

export const ScriptAPI = {
  // Global State Access
  getState: () => useStore.getState(),
  sleep: (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),
  
  // DSP & Tone.js Engine
  Tone: Tone,
  audioEngine: audioEngine,
  recordingEngine: recordingEngine,

  // Prompt & UI Interactive Dialogs
  registerPrompt: null as ((message: string, defaultValue: string, options?: string[]) => Promise<string | null>) | null,

  prompt: async (message: string, defaultValue: string = ''): Promise<string | null> => {
    if (ScriptAPI.registerPrompt) {
      return await ScriptAPI.registerPrompt(message, defaultValue);
    }
    return window.prompt(message, defaultValue);
  },

  promptSelect: async (message: string, options: string[], defaultValue: string = ''): Promise<string | null> => {
    if (ScriptAPI.registerPrompt) {
      return await ScriptAPI.registerPrompt(message, defaultValue, options);
    }
    return window.prompt(`${message}\nOptions: ${options.join(', ')}`, defaultValue);
  },

  promptForFiles: (options: { accept?: string; multiple?: boolean } = {}): Promise<File[]> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (options.accept) input.accept = options.accept;
      if (options.multiple) input.multiple = true;
      input.onchange = (e) => {
        const files = Array.from((e.target as HTMLInputElement).files || []);
        resolve(files);
      };
      input.click();
    });
  },

  decodeAudioFile: async (file: File): Promise<AudioBuffer> => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 44100 });
    const arrayBuffer = await file.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  },

  // ==========================================
  // 1. TRANSPORT & PLAYBACK CONTROLS
  // ==========================================
  transport: {
    play: async () => {
      await audioEngine.init();
      Tone.Transport.start();
      useStore.getState().setIsPlaying(true);
      audioEngine.resumeActiveNotes();
      if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
        (window as any).juceAudioBridge.postCommand({ type: 'play' });
      }
    },
    pause: () => {
      Tone.Transport.pause();
      audioEngine.stopActiveNotes();
      useStore.getState().setIsPlaying(false);
      if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
        (window as any).juceAudioBridge.postCommand({ type: 'stop' });
      }
    },
    stop: () => {
      audioEngine.stop();
    },
    togglePlay: async () => {
      await audioEngine.togglePlay();
    },
    seek: (tick: number) => {
      const pos = Math.max(0, tick);
      Tone.Transport.ticks = pos;
      useStore.getState().setPlayheadPosition(pos);
      if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
        (window as any).juceAudioBridge.postCommand({ type: 'seek', ticks: pos });
      }
    },
    getPosition: (): number => {
      return useStore.getState().playheadPosition;
    },
    isPlaying: (): boolean => {
      return useStore.getState().isPlaying;
    },
    setBpm: (bpm: number) => {
      const safeBpm = Math.max(20, Math.min(999, bpm));
      audioEngine.setBpm(safeBpm);
      useStore.getState().setBpm(safeBpm);
    },
    getBpm: (): number => {
      return useStore.getState().bpm;
    },
    setTimeSignature: (signature: string) => {
      useStore.getState().setTimeSignature(signature);
    },
    getTimeSignature: (): string => {
      return useStore.getState().timeSignature || '4/4';
    },
    setLoop: (startTicks: number, endTicks: number, enabled: boolean = true) => {
      const state = useStore.getState();
      state.setLoopStart(Math.max(0, startTicks));
      state.setLoopEnd(Math.max(startTicks + 24, endTicks));
      state.setLoopEnabled(enabled);
    },
    toggleLoop: (enabled?: boolean) => {
      const state = useStore.getState();
      const next = enabled !== undefined ? enabled : !state.loopEnabled;
      state.setLoopEnabled(next);
    },
    setMetronome: (enabled: boolean, volume?: number) => {
      const state = useStore.getState();
      state.setMetronomeEnabled(enabled);
      if (volume !== undefined) {
        state.setMetronomeVolume(Math.max(0, Math.min(1, volume)));
      }
    },
    toggleMetronome: () => {
      const state = useStore.getState();
      state.setMetronomeEnabled(!state.metronomeEnabled);
    },
    setSwing: (swingPercent: number) => {
      useStore.getState().setSwing(Math.max(0, Math.min(100, swingPercent)));
    },
    getSwing: (): number => {
      return useStore.getState().swing;
    },
    setFollowMode: (mode: 'playhead' | 'grid') => {
      useStore.getState().setPlayheadFollowMode(mode);
    }
  },

  // ==========================================
  // 2. RECORDING & CAPTURE HUB
  // ==========================================
  recording: {
    toggleLiveRecord: () => {
      recordingEngine.toggleRecording();
    },
    startLiveRecord: () => {
      const state = useStore.getState();
      if (!state.isRecording) {
        recordingEngine.beginRecording();
      }
    },
    stopLiveRecord: () => {
      const state = useStore.getState();
      if (state.isRecording) {
        recordingEngine.toggleRecording();
      }
    },
    isLiveRecording: (): boolean => {
      return useStore.getState().isRecording;
    },
    toggleStepRecord: () => {
      recordingEngine.toggleStepRecording();
    },
    startStepRecord: () => {
      useStore.getState().setIsStepRecording(true);
    },
    stopStepRecord: () => {
      useStore.getState().setIsStepRecording(false);
    },
    isStepRecording: (): boolean => {
      return useStore.getState().isStepRecording;
    },
    stepAdvance: (steps: number = 1) => {
      useStore.getState().advanceStepRecordCursor(steps);
    },
    stepRetreat: (steps: number = 1) => {
      useStore.getState().retreatStepRecordCursor(steps);
    },
    stepDelete: () => {
      useStore.getState().deleteStepRecordCurrentColumn();
    },
    setStepRecordSettings: (settings: {
      stepSize?: number;
      stepColumns?: number;
      noteDuration?: number;
      noteColumns?: number;
      gatePercent?: number;
      advanceMode?: 'release' | 'timer' | 'manual';
      chordSensitivityMs?: number;
    }) => {
      const state = useStore.getState();
      if (settings.stepSize !== undefined) state.setStepRecordStepSize(settings.stepSize);
      if (settings.stepColumns !== undefined) state.setStepRecordStepColumns(settings.stepColumns);
      if (settings.noteDuration !== undefined) state.setStepRecordNoteDuration(settings.noteDuration);
      if (settings.noteColumns !== undefined) state.setStepRecordNoteColumns(settings.noteColumns);
      if (settings.gatePercent !== undefined) state.setStepRecordGatePercent(settings.gatePercent);
      if (settings.advanceMode !== undefined) state.setStepRecordAdvanceMode(settings.advanceMode);
      if (settings.chordSensitivityMs !== undefined) state.setStepRecordChordSensitivityMs(settings.chordSensitivityMs);
    },
    recall: (mode?: 'time_snap' | 'time_free' | 'sequence_columns') => {
      if (mode) {
        useStore.getState().setRecallPlacementMode(mode);
      }
      recordingEngine.captureActiveRecall();
    },
    getRecallBuffer: () => {
      return recordingEngine.getRetrospectiveBuffer();
    },
    clearRecallBuffer: () => {
      recordingEngine.clearRetrospectiveBuffer();
    },
    setRecallPlacementMode: (mode: 'time_snap' | 'time_free' | 'sequence_columns') => {
      useStore.getState().setRecallPlacementMode(mode);
    },
    getRecallPlacementMode: (): 'time_snap' | 'time_free' | 'sequence_columns' => {
      return useStore.getState().recallPlacementMode;
    },
    setCountIn: (bars: 0 | 1 | 2) => {
      useStore.getState().setRecordCountIn(bars);
    },
    setInputQuantize: (ticks: number) => {
      useStore.getState().setRecordInputQuantize(ticks);
    },
    setOverdub: (enabled: boolean) => {
      useStore.getState().setMidiOverdub(enabled);
    },
    setQwertyKeyboard: (enabled: boolean, octave?: number, velocity?: number) => {
      const state = useStore.getState();
      state.setQwertyPianoEnabled(enabled);
      if (octave !== undefined) state.setQwertyOctave(octave);
      if (velocity !== undefined) state.setQwertyVelocity(velocity);
    },
    setScaleConform: (enabled: boolean) => {
      useStore.getState().setRecordScaleConform(enabled);
    },
    setEdoMappingMode: (mode: 'off' | 'linear' | 'harmonic') => {
      useStore.getState().setRecordEdoMappingMode(mode);
    },
    triggerNoteOn: (pitch: number, velocity: number = 100) => {
      recordingEngine.handleNoteOn(pitch, velocity);
    },
    triggerNoteOff: (pitch: number) => {
      recordingEngine.handleNoteOff(pitch);
    }
  },

  // ==========================================
  // 3. VST3 HOST & NATIVE PLUGINS
  // ==========================================
  vst3: {
    getPlugins: () => {
      return useStore.getState().vst3Plugins;
    },
    scanPlugins: () => {
      audioEngine.scanVst3Plugins();
    },
    setTrackInstrument: (trackId: string, pluginNameOrPath: string): boolean => {
      const state = useStore.getState();
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) throw new Error(`Track ${trackId} not found`);
      const plugins = state.vst3Plugins;
      const plugin = plugins.find(p =>
        p.uniqueId === pluginNameOrPath ||
        p.fileOrIdentifier === pluginNameOrPath ||
        p.name.toLowerCase() === pluginNameOrPath.toLowerCase()
      );
      const targetId = plugin?.fileOrIdentifier || plugin?.uniqueId || pluginNameOrPath;
      state.commitHistory();
      state.updateTrack(trackId, {
        instrument: 'synth',
        vst3InstrumentId: targetId,
        vst3InstrumentName: plugin?.name || 'VST3 Instrument',
        synthPreset: 'custom'
      });
      audioEngine.setTrackVst3Instrument(trackId, targetId);
      return true;
    },
    removeTrackInstrument: (trackId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.updateTrack(trackId, {
        instrument: 'synth',
        vst3InstrumentId: undefined,
        vst3InstrumentName: undefined
      });
      audioEngine.removeTrackVst3Instrument(trackId);
    },
    addTrackFx: (trackId: string, pluginNameOrPath: string): string => {
      const state = useStore.getState();
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) throw new Error(`Track ${trackId} not found`);
      const plugins = state.vst3Plugins;
      const plugin = plugins.find(p =>
        p.uniqueId === pluginNameOrPath ||
        p.fileOrIdentifier === pluginNameOrPath ||
        p.name.toLowerCase() === pluginNameOrPath.toLowerCase()
      );
      const targetId = plugin?.fileOrIdentifier || plugin?.uniqueId || pluginNameOrPath;
      const newInstId = `vst3_${Date.now()}_${newId().slice(0, 4)}`;
      const newInst = {
        id: newInstId,
        type: 'vst3' as const,
        pluginId: targetId,
        pluginName: plugin?.name || 'VST3 Effect'
      };
      state.commitHistory();
      const currentInstances = getTrackFxInstances(track.fxInstances);
      state.updateTrack(trackId, {
        fxInstances: [...currentInstances, newInst]
      });
      audioEngine.addTrackVst3Fx(trackId, newInstId, targetId);
      return newInstId;
    },
    removeTrackFx: (trackId: string, fxId: string) => {
      const state = useStore.getState();
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) return;
      state.commitHistory();
      const updated = (track.fxInstances || []).filter(inst => inst.id !== fxId);
      state.updateTrack(trackId, { fxInstances: updated });
      audioEngine.removeTrackVst3Fx(trackId, fxId);
    },
    openEditor: (trackId: string, fxId?: string) => {
      if (fxId) {
        audioEngine.openVst3FxEditor(trackId, fxId);
      } else {
        audioEngine.openVst3InstrumentEditor(trackId);
      }
    },
    openStandaloneEditor: (pluginNameOrPath: string) => {
      const plugins = useStore.getState().vst3Plugins;
      const plugin = plugins.find(p =>
        p.uniqueId === pluginNameOrPath ||
        p.fileOrIdentifier === pluginNameOrPath ||
        p.name.toLowerCase() === pluginNameOrPath.toLowerCase()
      );
      const targetId = plugin?.fileOrIdentifier || plugin?.uniqueId || pluginNameOrPath;
      audioEngine.openStandaloneVst3Editor(targetId);
    },
    setTrackFxBypass: (trackId: string, fxId: string, bypassed: boolean) => {
      if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setFxBypass',
          trackId,
          fxId,
          bypassed
        });
      }
    },
    setTrackFxWet: (trackId: string, fxId: string, wet: number) => {
      const state = useStore.getState();
      state.updateTrackFXSetting(trackId, fxId, 'wet', Math.max(0, Math.min(1, wet)));
    }
  },

  // ==========================================
  // 4. TRACKS, CHANNELS & MIXER
  // ==========================================
  track: {
    getAll: (): Track[] => {
      return useStore.getState().tracks;
    },
    get: (trackId: string): Track | undefined => {
      return useStore.getState().tracks.find(t => t.id === trackId);
    },
    getActive: (): Track | undefined => {
      const state = useStore.getState();
      return state.tracks.find(t => t.id === state.activeTrackId);
    },
    setActive: (trackId: string | null) => {
      useStore.getState().setActiveTrackId(trackId);
    },
    add: (name: string, instrument: 'synth' | 'drum' | 'vst3' = 'synth'): string => {
      const state = useStore.getState();
      state.commitHistory();
      const id = newId();
      state.addTrack({
        id,
        name,
        instrument,
        color: instrument === 'drum' ? '#ff9900' : '#4dabf7',
        volume: 0.8,
        pan: 0,
        muted: false,
        soloed: false,
      });
      if (instrument === 'synth') audioEngine.createInstrument(id, 'synth');
      if (instrument === 'drum') audioEngine.createInstrument(id, 'drum');
      return id;
    },
    remove: (trackId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeTrack(trackId);
    },
    removeMultiple: (trackIds: string[]) => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeTracks(trackIds);
    },
    duplicate: (trackIds: string[]) => {
      const state = useStore.getState();
      state.commitHistory();
      state.duplicateTracks(trackIds);
    },
    update: (trackId: string, updates: Partial<Track>) => {
      const state = useStore.getState();
      state.commitHistory();
      
      const safeUpdates = { ...updates };
      if (safeUpdates.volume !== undefined) {
        safeUpdates.volume = Math.max(0, Math.min(100, Number(safeUpdates.volume) || 0));
      }
      if (safeUpdates.pan !== undefined) {
        safeUpdates.pan = Math.max(-50, Math.min(50, Number(safeUpdates.pan) || 0));
      }
      if (safeUpdates.name !== undefined) {
        safeUpdates.name = String(safeUpdates.name).substring(0, 50);
      }

      state.updateTrack(trackId, safeUpdates);
    },
    setVolume: (trackId: string, volume0to100: number) => {
      ScriptAPI.track.update(trackId, { volume: Math.max(0, Math.min(100, volume0to100)) });
    },
    setPan: (trackId: string, panMinus50toPlus50: number) => {
      ScriptAPI.track.update(trackId, { pan: Math.max(-50, Math.min(50, panMinus50toPlus50)) });
    },
    setMute: (trackId: string, muted: boolean) => {
      ScriptAPI.track.update(trackId, { muted });
    },
    setSolo: (trackId: string, soloed: boolean) => {
      ScriptAPI.track.update(trackId, { soloed });
    },
    setColor: (trackId: string, hexColor: string) => {
      ScriptAPI.track.update(trackId, { color: hexColor });
    },
    setSynthPreset: (trackId: string, preset: SynthPreset) => {
      ScriptAPI.track.update(trackId, { synthPreset: preset, instrument: 'synth' });
      audioEngine.createInstrument(trackId, 'synth');
    },
    setDrumKit: (trackId: string, kit: DrumKit) => {
      ScriptAPI.track.update(trackId, { drumKit: kit, instrument: 'drum' });
      audioEngine.createInstrument(trackId, 'drum');
    },
    reorder: (startIndex: number, endIndex: number, newParentId?: string | null) => {
      const state = useStore.getState();
      state.commitHistory();
      state.reorderTracks(startIndex, endIndex, newParentId);
    },
    syncSettings: (sourceId: string, targetId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.syncTrackSettings(sourceId, targetId);
    },
    clearNotes: (trackId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.clearTrackNotes(trackId);
    },
    eraseRegion: (trackId: string, startTick: number, endTick: number) => {
      const state = useStore.getState();
      state.commitHistory();
      state.eraseNotesInRegion(trackId, startTick, endTick);
    },
    loop: (trackId: string, mode: 'fillToEnd' | 'perfectCycle' | 'nTimes', snapToBar: boolean, times: number = 1) => {
      const state = useStore.getState();
      state.commitHistory();
      state.loopTrack(trackId, mode, snapToBar, times);
    }
  },

  // ==========================================
  // 5. NOTES & PIANO ROLL EDITOR
  // ==========================================
  editor: {
    getAll: (): Note[] => {
      return useStore.getState().notes;
    },
    getForTrack: (trackId: string): Note[] => {
      return useStore.getState().notes.filter(n => n.trackId === trackId);
    },
    getSelectedNotes: (): Note[] => {
      const state = useStore.getState();
      const ids = new Set(state.selectedNoteIds);
      return state.notes.filter(n => ids.has(n.id));
    },
    getTargetNotes: (): Note[] => {
      const state = useStore.getState();
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      if (!activeTrack) return [];
      const trackNotes = state.notes.filter(n => n.trackId === activeTrack.id);
      const selected = trackNotes.filter(n => state.selectedNoteIds.includes(n.id));
      return selected.length > 0 ? selected : trackNotes;
    },
    replaceTargetNotes: (newNotes: Note[]): void => {
      const state = useStore.getState();
      const targetNotes = ScriptAPI.editor.getTargetNotes();
      if (targetNotes.length === 0) return;
      state.commitHistory();
      const targetIdSet = new Set(targetNotes.map(n => n.id));
      const untouched = state.notes.filter(n => !targetIdSet.has(n.id));
      const finalNotes = deduplicateNotes([...untouched, ...newNotes]);
      useStore.setState({
        notes: finalNotes,
        selectedNoteIds: newNotes.map(n => n.id)
      });
    },
    addNote: (note: Partial<Note> & { trackId: string; pitch: number; time: number; duration: number }): string => {
      const state = useStore.getState();
      state.commitHistory();
      const id = note.id || newId();
      const fullNote: Note = {
        ...note,
        id,
        trackId: note.trackId,
        pitch: note.pitch,
        time: Math.max(0, note.time),
        duration: Math.max(1, note.duration),
        velocity: note.velocity !== undefined ? note.velocity : 100
      };
      state.addNote(fullNote);
      return id;
    },
    addNotes: (notes: Array<Partial<Note> & { trackId: string; pitch: number; time: number; duration: number }>): string[] => {
      const state = useStore.getState();
      state.commitHistory();
      const ids: string[] = [];
      const created: Note[] = notes.map(n => {
        const id = n.id || newId();
        ids.push(id);
        return {
          ...n,
          id,
          trackId: n.trackId,
          pitch: n.pitch,
          time: Math.max(0, n.time),
          duration: Math.max(1, n.duration),
          velocity: n.velocity !== undefined ? n.velocity : 100
        } as Note;
      });
      useStore.setState({
        notes: deduplicateNotes([...state.notes, ...created]),
        selectedNoteIds: ids
      });
      return ids;
    },
    removeNote: (id: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeNote(id);
    },
    removeNotes: (ids: string[]) => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeNotes(ids);
    },
    updateSelectedNotes: (updates: Partial<Note>) => {
      const state = useStore.getState();
      state.commitHistory();
      state.updateNotes(state.selectedNoteIds, updates);
    },
    transposeSelected: (semitones: number) => {
      const state = useStore.getState();
      const ids = new Set(state.selectedNoteIds);
      state.commitHistory();
      const updated = state.notes.map(n => {
        if (!ids.has(n.id)) return n;
        const track = state.tracks.find(t => t.id === n.trackId);
        if (track?.instrument === 'drum') return n;
        return { ...n, pitch: Math.max(0, Math.min(127, n.pitch + semitones)) };
      });
      useStore.setState({ notes: updated });
    },
    nudgeTimeSelected: (ticks: number) => {
      const state = useStore.getState();
      const ids = new Set(state.selectedNoteIds);
      state.commitHistory();
      const updated = state.notes.map(n => {
        if (!ids.has(n.id)) return n;
        return { ...n, time: Math.max(0, n.time + ticks) };
      });
      useStore.setState({ notes: updated });
    },
    nudgeDurationSelected: (ticks: number) => {
      const state = useStore.getState();
      const ids = new Set(state.selectedNoteIds);
      state.commitHistory();
      const updated = state.notes.map(n => {
        if (!ids.has(n.id)) return n;
        return { ...n, duration: Math.max(1, n.duration + ticks) };
      });
      useStore.setState({ notes: updated });
    },
    duplicateSelected: () => {
      const state = useStore.getState();
      const selected = state.notes.filter(n => state.selectedNoteIds.includes(n.id));
      if (selected.length === 0) return;
      state.commitHistory();
      const maxTime = Math.max(...selected.map(n => n.time + n.duration));
      const minTime = Math.min(...selected.map(n => n.time));
      const span = maxTime - minTime;
      const shift = span > 0 ? span : state.snapResolution;
      
      const newNotes: Note[] = selected.map(n => ({
        ...n,
        id: newId(),
        time: n.time + shift
      }));
      useStore.setState({ 
        notes: deduplicateNotes([...state.notes, ...newNotes]),
        selectedNoteIds: newNotes.map(n => n.id)
      });
    },
    deleteSelected: () => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeNotes(state.selectedNoteIds);
      useStore.setState({ selectedNoteIds: [] });
    },
    selectAll: (trackId?: string) => {
      const state = useStore.getState();
      const targetNotes = trackId ? state.notes.filter(n => n.trackId === trackId) : state.notes;
      useStore.setState({ selectedNoteIds: targetNotes.map(n => n.id) });
    },
    deselectAll: () => {
      useStore.setState({ selectedNoteIds: [] });
    },
    selectByIds: (ids: string[]) => {
      useStore.setState({ selectedNoteIds: [...ids] });
    },
    query: (predicate: (n: Note) => boolean): Note[] => {
      return useStore.getState().notes.filter(predicate);
    },
    quantizeSelected: () => {
      const state = useStore.getState();
      state.commitHistory();
      state.quantizeSelectedNotes();
    },
    setTool: (tool: 'draw' | 'erase' | 'select' | 'slice' | 'stretch') => {
      useStore.getState().setActiveTool(tool);
    },
    getTool: (): string => {
      return useStore.getState().activeTool;
    },

    // --- Complete MIDI Editing Suite ---
    legato: (gapTicks = 0) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyLegato(targets, { gapTicks }));
    },
    strum: (config?: { strumTime?: number; direction?: 'up' | 'down' | 'alternate'; tension?: number; velocityRamp?: number; alignEnds?: boolean }) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyStrum(targets, config));
    },
    flam: (config?: { delayTicks?: number; velocityRatio?: number }) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyFlam(targets, config));
    },
    glue: () => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyGlue(targets));
    },
    dice: (intervalTicks?: number) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      const snap = intervalTicks || useStore.getState().snapResolution;
      ScriptAPI.editor.replaceTargetNotes(applyDice(targets, snap));
    },
    removeOverlaps: () => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyRemoveOverlaps(targets));
    },
    chop: (pattern: ChopPattern, gateRatio = 1.0) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyChop(targets, { pattern, gateRatio }));
    },
    ratchet: (slices: number, velocityProfile: 'flat' | 'crescendo' | 'decrescendo' = 'flat') => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyRatchet(targets, slices, velocityProfile));
    },
    microNudge: (ticks: number) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyMicroNudge(targets, ticks));
    },
    arpeggiate: (config?: { pattern?: ArpPattern; rateTicks?: number; octaves?: number; gateRatio?: number }) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyArpeggio(targets, {
        pattern: config?.pattern ?? 'up',
        rateTicks: config?.rateTicks ?? 48,
        octaves: config?.octaves ?? 1,
        gateRatio: config?.gateRatio ?? 0.8,
      }));
    },
    modalTranspose: (steps: number) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      const state = useStore.getState();
      const scale = state.scaleLock;
      ScriptAPI.editor.replaceTargetNotes(applyModalTranspose(targets, steps, scale.root, scale.mode, scale.customIntervals));
    },
    forceToScale: () => {
      const targets = ScriptAPI.editor.getTargetNotes();
      const state = useStore.getState();
      const scale = state.scaleLock;
      ScriptAPI.editor.replaceTargetNotes(applyForceToScale(targets, scale.root, scale.mode, scale.customIntervals));
    },
    harmonize: (type: HarmonizeType = 'triad') => {
      const targets = ScriptAPI.editor.getTargetNotes();
      const state = useStore.getState();
      const scale = state.scaleLock;
      ScriptAPI.editor.replaceTargetNotes(applyHarmonize(targets, type, scale.root, scale.mode, scale.customIntervals));
    },
    invertChord: (direction: 'up' | 'down' = 'up') => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyChordInversion(targets, direction));
    },
    velocityRamp: (startVel = 40, endVel = 115, curve: VelocityCurve = 'linear') => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyVelocityRamp(targets, { startVelocity: startVel, endVelocity: endVel, curve }));
    },
    velocityCompress: (target = 85, ratio = 0.5) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyVelocityCompress(targets, target, ratio));
    },
    velocityNormalize: () => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyVelocityNormalize(targets));
    },
    fixedVelocity: (velocity = 100) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyFixedVelocity(targets, velocity));
    },
    humanize: (config?: { timingJitterTicks?: number; velocityJitterPercent?: number; durationJitterPercent?: number; pitchJitterSemis?: number }) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyHumanize(targets, config));
    },
    timeStretch: (factor: number) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyTimeStretch(targets, factor));
    },
    flipHorizontal: () => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyFlipHorizontal(targets));
    },
    flipVertical: () => {
      const targets = ScriptAPI.editor.getTargetNotes();
      const scale = useStore.getState().scaleLock;
      ScriptAPI.editor.replaceTargetNotes(applyFlipVertical(targets, scale.enabled ? { root: scale.root, mode: scale.mode, customIntervals: scale.customIntervals } : undefined));
    },
    purgeShortNotes: (minTicks = 12) => {
      const targets = ScriptAPI.editor.getTargetNotes();
      ScriptAPI.editor.replaceTargetNotes(applyPurgeShortNotes(targets, minTicks));
    },
    filterOddEven: (keep: 'odd' | 'even') => {
      const targets = ScriptAPI.editor.getTargetNotes();
      const ids = filterOddEvenNotes(targets, keep);
      useStore.setState({ selectedNoteIds: ids });
    },
    filterVoice: (voice: 'top' | 'bottom') => {
      const targets = ScriptAPI.editor.getTargetNotes();
      const ids = filterVoiceNotes(targets, voice);
      useStore.setState({ selectedNoteIds: ids });
    },
    generateProgression: (progressionIdOrName: string, spacingTicks = 192) => {
      const prog = GENRE_PROGRESSIONS.find(p => p.id === progressionIdOrName || p.name.toLowerCase().includes(progressionIdOrName.toLowerCase()));
      if (!prog) return;
      const state = useStore.getState();
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      if (!activeTrack || activeTrack.instrument !== 'synth') return;
      state.commitHistory();
      const startTime = Math.round(state.playheadPosition);
      const basePitch = (3 + 1) * 12 + state.scaleLock.root;
      const newNotes: Note[] = [];
      prog.steps.forEach((step, idx) => {
        const stepTime = startTime + idx * spacingTicks;
        const root = basePitch + step.rootOffset;
        step.intervals.forEach(semi => {
          newNotes.push({
            id: newId(),
            trackId: activeTrack.id,
            time: stepTime,
            duration: Math.max(24, spacingTicks - 12),
            pitch: root + semi,
            velocity: 95
          });
        });
      });
      useStore.setState({
        notes: deduplicateNotes([...state.notes, ...newNotes]),
        selectedNoteIds: newNotes.map(n => n.id)
      });
    },
    detectChord: (pitches?: number[]): DetectedChord | null => {
      const p = pitches || ScriptAPI.editor.getTargetNotes().map(n => n.pitch);
      return detectChord(p);
    }
  },

  // Alias `notes` to `editor` for intuitive developer scripting
  notes: null as any,

  // ==========================================
  // 6. GRID, QUANTIZATION & TIME
  // ==========================================
  grid: {
    setSnap: (enabled: boolean, resolutionTicks?: number) => {
      const state = useStore.getState();
      state.setSnapEnabled(enabled);
      if (resolutionTicks !== undefined) {
        state.setSnapResolution(resolutionTicks);
      }
    },
    setSnapResolution: (ticks: number) => {
      useStore.getState().setSnapResolution(ticks);
    },
    toggleSnap: (enabled?: boolean) => {
      const state = useStore.getState();
      state.setSnapEnabled(enabled !== undefined ? enabled : !state.snapEnabled);
    },
    setBlockTicks: (ticks: number) => {
      useStore.getState().setGridBlockTicks(ticks);
    },
    setColumnCount: (count: number) => {
      useStore.getState().setGridColumnCount(Math.max(16, count));
    },
    setAutoExtend: (enabled: boolean) => {
      useStore.getState().setAutoExtendGrid(enabled);
    },
    setMinNoteSize: (ticks: number) => {
      useStore.getState().setMinNoteSize(Math.max(0, ticks));
    },
    setShadeEvery: (bars: number) => {
      useStore.getState().setGridShadeEvery(Math.max(1, bars));
    },
    setPitchSnap: (enabled: boolean, sensitivity?: number) => {
      const state = useStore.getState();
      state.setPitchSnapEnabled(enabled);
      if (sensitivity !== undefined) state.setPitchSnapSensitivity(sensitivity);
    },
    setDropSnap: (enabled: boolean) => {
      useStore.getState().setDropSnap(enabled);
    },
    setVerticalStretchMode: (mode: 'glide' | 'cluster') => {
      useStore.getState().setVerticalStretchMode(mode);
    }
  },

  // ==========================================
  // 7. TUNING, SCALES & MUSIC THEORY
  // ==========================================
  tuning: {
    setScale: (root: number, mode: string, enabled: boolean = true, accidental: 'sharp' | 'flat' = 'sharp') => {
      useStore.getState().setScaleLock({
        enabled,
        root,
        mode,
        accidental
      });
    },
    toggleScale: (enabled?: boolean) => {
      const state = useStore.getState();
      const current = state.scaleLock;
      state.setScaleLock({
        ...current,
        enabled: enabled !== undefined ? enabled : !current.enabled
      });
    },
    setTrackScaleOverride: (trackId: string, scale: ScaleLock | null) => {
      ScriptAPI.track.update(trackId, { scaleOverride: scale || undefined });
    },
    setTrackEdo: (trackId: string, division: number, rootNote: number = 60) => {
      ScriptAPI.track.update(trackId, {
        edoDivision: division,
        edoRootNote: rootNote,
        edoPreset: 'custom'
      });
    },
    setScalaScale: (trackId: string, scaleName: string, cents: number[]) => {
      ScriptAPI.track.update(trackId, {
        scalaScaleName: scaleName,
        customScaleCents: cents
      });
    },
    getAvailableScales: (): string[] => SCALE_MODES,
    getGenreProgressions: (): GenreProgression[] => GENRE_PROGRESSIONS,
    detectChord: (pitches: number[]): DetectedChord | null => detectChord(pitches),
    detectScaleDegree: (rootPc: number, scaleRoot?: number, scaleMode?: string): string | null => {
      const state = useStore.getState();
      const r = scaleRoot !== undefined ? scaleRoot : state.scaleLock.root;
      const m = scaleMode !== undefined ? scaleMode : state.scaleLock.mode;
      return detectScaleDegree(rootPc, r, m);
    }
  },

  midi: {
    detectChord: (pitches: number[]): DetectedChord | null => detectChord(pitches),
    detectScaleDegree: (rootPc: number, scaleRoot?: number, scaleMode?: string): string | null => {
      const state = useStore.getState();
      const r = scaleRoot !== undefined ? scaleRoot : state.scaleLock.root;
      const m = scaleMode !== undefined ? scaleMode : state.scaleLock.mode;
      return detectScaleDegree(rootPc, r, m);
    },
    getProgressions: (): GenreProgression[] => GENRE_PROGRESSIONS,
    getScales: (): string[] => SCALE_MODES,
  },

  // ==========================================
  // 8. TRACK GROUPS
  // ==========================================
  groups: {
    getAll: (): TrackGroup[] => {
      return useStore.getState().groups;
    },
    add: (name: string, trackIds: string[], color: string = '#845ef7'): string => {
      const state = useStore.getState();
      const id = newId();
      state.commitHistory();
      state.addGroup({
        id,
        name,
        color,
        trackIds,
        collapsed: false
      });
      return id;
    },
    remove: (groupId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeGroup(groupId);
    },
    update: (groupId: string, updates: Partial<TrackGroup>) => {
      const state = useStore.getState();
      state.commitHistory();
      state.updateGroup(groupId, updates);
    }
  },

  // ==========================================
  // 9. PATTERN CLIPS & GENERATIVE ALGORITHMS
  // ==========================================
  clips: {
    getAll: (): Clip[] => {
      return useStore.getState().clips;
    },
    add: (clip: Omit<Clip, 'id'>): string => {
      const state = useStore.getState();
      const id = newId();
      state.commitHistory();
      state.addClip({ ...clip, id });
      return id;
    },
    remove: (clipId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeClip(clipId);
    },
    update: (clipId: string, updates: Partial<Clip>) => {
      const state = useStore.getState();
      state.commitHistory();
      state.updateClip(clipId, updates);
    },
    generateNotes: (clipId: string, overwrite: boolean = false, pitch: number = 60, velocity: number = 100, duration: number = 48) => {
      const state = useStore.getState();
      state.commitHistory();
      state.generateClipNotes(clipId, overwrite, pitch, velocity, duration);
    }
  },

  // ==========================================
  // 10. AUTOMATION & PROCEDURAL MODULATION
  // ==========================================
  automation: {
    getCurve: (trackId: string): AutomationPoint[] => {
      return useStore.getState().automationCurves[trackId] || [];
    },
    setCurve: (trackId: string, points: AutomationPoint[]) => {
      const state = useStore.getState();
      state.commitHistory();
      state.setAutomationCurve(trackId, points);
    },
    addPoint: (trackId: string, time: number, value: number): string => {
      const state = useStore.getState();
      const id = newId();
      state.commitHistory();
      state.addAutomationPoint(trackId, { id, time, value });
      return id;
    },
    removePoint: (trackId: string, pointId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeAutomationPoint(trackId, pointId);
    },
    clearCurve: (trackId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.clearAutomationCurve(trackId);
    },
    bakeProcedural: (trackId: string, formula: string, preset: string = 'sine', density: number = 24) => {
      const state = useStore.getState();
      state.commitHistory();
      state.bakeProceduralAutomation(trackId, formula, preset, density);
    },
    getLane: (trackId: string): AutomationLane | null => {
      return useStore.getState().automationLanes[trackId] ?? null;
    },
    setLane: (trackId: string, lane: Partial<AutomationLane>) => {
      const state = useStore.getState();
      state.commitHistory();
      state.updateAutomationLane(trackId, lane);
    },
    getTarget: (trackId: string): AutomationTarget => {
      return useStore.getState().automationTargets[trackId] ?? 'velocity';
    },
    setTarget: (trackId: string, target: AutomationTarget) => {
      const state = useStore.getState();
      state.commitHistory();
      state.setAutomationTarget(trackId, target);
    },
    listExpressionTargets: (): ExpressionLaneTarget[] => {
      return [...EXPRESSION_LANE_TARGETS];
    }
  },

  // ==========================================
  // 11. GROOVES & HUMANIZE
  // ==========================================
  groove: {
    getTemplates: (): GrooveTemplate[] => {
      return useStore.getState().grooveTemplates;
    },
    applyGroove: (noteIds?: string[]) => {
      const state = useStore.getState();
      const ids = noteIds || state.selectedNoteIds;
      if (ids.length > 0) {
        state.commitHistory();
        state.applyGroove(ids);
      }
    },
    extractGroove: (noteIds: string[], name: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.extractGroove(noteIds, name);
    },
    setTimingStrength: (strength0to100: number) => {
      useStore.getState().setGrooveTimingStrength(Math.max(0, Math.min(100, strength0to100)));
    },
    setVelocityStrength: (strength0to100: number) => {
      useStore.getState().setGrooveVelocityStrength(Math.max(0, Math.min(100, strength0to100)));
    }
  },

  // ==========================================
  // 12. VOCAL SYNTHESIS (PINK TROMBONE & FOF)
  // ==========================================
  voice: {
    getPresets: () => {
      return useStore.getState().voicePresets;
    },
    getPreset: (id: string) => {
      return useStore.getState().voicePresets.find(p => p.id === id);
    },
    addPreset: (preset: Omit<VoicePreset, 'id'>) => {
      const state = useStore.getState();
      state.commitHistory();
      const id = newId();
      const newPreset: VoicePreset = { ...preset, id } as VoicePreset;
      useStore.setState({ voicePresets: [...state.voicePresets, newPreset] });
      return id;
    },
    deletePreset: (id: string) => {
      const state = useStore.getState();
      state.commitHistory();
      useStore.setState({ voicePresets: state.voicePresets.filter(p => p.id !== id) });
    },
    updatePreset: (id: string, updates: Partial<VoicePreset>) => {
      const state = useStore.getState();
      state.commitHistory();
      const updated = state.voicePresets.map(p => {
        if (p.id === id) {
          return { ...p, ...updates };
        }
        return p;
      });
      useStore.setState({ voicePresets: updated });
    }
  },

  // ==========================================
  // 13. FX RACK, DPREVERB & CUSTOM DSP
  // ==========================================
  fx: {
    createCustomEffect: (config: ScriptCustomFxConfig): string => {
      const state = useStore.getState();
      const normalized = normalizeCustomFxConfig(config);
      state.commitHistory();
      const exists = state.customFxConfigs.some(c => c.id === normalized.id);
      if (exists) {
        state.updateCustomFxConfig(normalized.id, normalized);
      } else {
        state.addCustomFxConfig(normalized);
      }
      return normalized.id;
    },

    createOfflineEffect: (config: Omit<ScriptCustomFxConfig, 'mode'>): string => {
      return ScriptAPI.fx.createCustomEffect({ ...config, mode: 'offline' });
    },

    addCustomEffectToTrack: (trackId: string, effectId: string): string => {
      const state = useStore.getState();
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) throw new Error('Track not found');
      const config = state.customFxConfigs.find(c => c.id === effectId);
      if (!config) throw new Error('Custom FX not found');

      const beforeIds = new Set((track.fxInstances || []).map(inst => inst.id));
      state.commitHistory();
      state.addCustomFxToTrack(trackId, effectId);

      const updatedTrack = useStore.getState().tracks.find(t => t.id === trackId);
      const added = updatedTrack?.fxInstances?.find(inst => inst.type === effectId && !beforeIds.has(inst.id));
      return added?.id || effectId;
    },

    getMaxDPreverbTailSeconds: (trackIds?: string[]): number => {
      const state = useStore.getState();
      const idSet = trackIds && trackIds.length > 0 ? new Set(trackIds) : null;
      const tracks = idSet ? state.tracks.filter(t => idSet.has(t.id)) : state.tracks;
      return getMaxDPreverbTailSeconds(tracks as any);
    },

    listDPreverbTracks: () => {
      const state = useStore.getState();
      return state.tracks.flatMap(track => {
        return getTrackFxInstances(track.fxInstances)
          .filter(inst => inst.type === 'dpreverb')
          .map(inst => {
            const settings = getDPreverbSettings(track as any, inst);
            return {
              trackId: track.id,
              trackName: track.name,
              instanceId: inst.id,
              active: settings.wet > 0 && settings.tail > 0,
              ...settings
            };
          });
      });
    },

    setDPreverb: (
      trackId: string,
      settings: Partial<{ wet: number; tail: number; decay: number; tone: number }>
    ): string => {
      const state = useStore.getState();
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) throw new Error('Track not found');

      const fxInstances = getTrackFxInstances(track.fxInstances);
      const dpreverb = fxInstances.find(inst => inst.type === 'dpreverb');
      if (!dpreverb) throw new Error('DPreverb instance could not be created');

      state.commitHistory();
      if (!track.fxInstances || !track.fxInstances.some(inst => inst.type === 'dpreverb')) {
        state.updateTrack(trackId, { fxInstances });
      }

      if (settings.wet !== undefined) state.updateTrackFXSetting(trackId, dpreverb.id, 'wet', Math.max(0, Math.min(1, settings.wet)));
      if (settings.tail !== undefined) state.updateTrackFXSetting(trackId, dpreverb.id, 'tail', Math.max(0, Math.min(120, settings.tail)));
      if (settings.decay !== undefined) state.updateTrackFXSetting(trackId, dpreverb.id, 'decay', Math.max(0.05, Math.min(1, settings.decay)));
      if (settings.tone !== undefined) state.updateTrackFXSetting(trackId, dpreverb.id, 'tone', Math.max(0, Math.min(1, settings.tone)));

      return dpreverb.id;
    },

    reorderTrackFx: (trackId: string, startIndex: number, endIndex: number) => {
      const state = useStore.getState();
      state.commitHistory();
      state.reorderTrackFX(trackId, startIndex, endIndex);
    },

    removeTrackFxInstance: (trackId: string, instanceId: string) => {
      const state = useStore.getState();
      state.commitHistory();
      state.removeTrackFXInstance(trackId, instanceId);
    },

    updateTrackFxSetting: (trackId: string, instanceId: string, key: string, value: number) => {
      useStore.getState().updateTrackFXSetting(trackId, instanceId, key, value);
    }
  },

  audio: {
    getEngineMode: (): 'tone' | 'wasm' => {
      return useStore.getState().engineMode;
    },
    setEngineMode: (mode: 'tone' | 'wasm') => {
      const state = useStore.getState();
      state.commitHistory();
      state.setEngineMode(mode);
    }
  },

  // ==========================================
  // 14. ENVELOPE CURVES & PHYSICAL MODES
  // ==========================================
  curves: {
    setTrackCurve: (trackId: string, curveType: string, tension: number = 0, formula?: string) => {
      const state = useStore.getState();
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) throw new Error(`Track ${trackId} not found`);
      state.commitHistory();
      state.updateTrack(trackId, {
        envelopeCurveType: curveType as any,
        curveTension: tension,
        curveFormula: formula
      });
      audioEngine.setTrackCurve(trackId, curveType, tension);
    }
  },

  // High-level AI Transcription automation
  transcribeToTrack: async (buffer: AudioBuffer, name: string): Promise<string> => {
    const state = useStore.getState();
    const bpm = state.bpm;
    const generatedNotes = await transcribeAudio(buffer, bpm);
    
    if (generatedNotes.length === 0) {
      console.warn(`No notes detected in ${name}`);
      return '';
    }

    state.commitHistory();
    const newTrackId = newId();
    
    state.addTrack({
      id: newTrackId,
      name: name,
      instrument: 'synth',
      color: '#ff922b',
      synthPreset: DEFAULT_SYNTH_PRESET,
      volume: 0.8,
      pan: 0,
      muted: false,
      soloed: false,
    });
    
    audioEngine.createInstrument(newTrackId, 'synth');
    
    generatedNotes.forEach((n: Note) => {
      n.trackId = newTrackId;
      state.addNote(n);
    });
    
    return newTrackId;
  },

  // High-level Score generation automation
  exportScore: async (options: { trackId: string; format?: 'musicxml'; includeLyrics?: boolean }) => {
    const state = useStore.getState();
    const track = state.tracks.find(t => t.id === options.trackId);
    if (!track) throw new Error('Track not found');
    
    const trackNotes = state.notes.filter(n => n.trackId === options.trackId);
    const timeSig = state.timeSignature || '4/4';
    const bpm = state.bpm || 120;
    
    const xml = generateMusicXML([track], trackNotes, bpm, timeSig, options.includeLyrics);
    downloadScore(xml, `${track.name.toLowerCase().replace(/\s+/g, '_') || 'score'}.musicxml`);
  },

  // Batch Export Helper
  exportAudio: async (
    filename: string, 
    options: {
      format?: 'wav' | 'mp3';
      trackId?: string;
      trackIds?: string[];
      octaveOffset?: number;
      semitoneOffset?: number;
      normalize?: boolean;
      includeMetronome?: boolean;
      autoFade?: boolean;
      includeProceduralFx?: boolean;
      startTick?: number;
      endTick?: number;
      mp3Kbps?: number;
      exportRegionMode?: boolean;
      exportRegions?: Array<{ id: string; startTick: number; endTick: number; gap: number }>;
    } = {}
  ) => {
    const state = useStore.getState();
    const format = options.format || 'wav';
    const lastNoteTick = state.notes.length > 0 ? Math.max(...state.notes.map(n => n.time + n.duration)) : 768;
    
    const renderOptions = {
      trackId: options.trackId,
      trackIds: options.trackIds,
      octaveOffset: options.octaveOffset || 0,
      semitoneOffset: options.semitoneOffset || 0,
      normalize: options.normalize !== undefined ? options.normalize : true,
      includeMetronome: options.includeMetronome || false,
      autoFade: options.autoFade !== undefined ? options.autoFade : true,
      startTick: options.startTick !== undefined ? options.startTick : (state.loopEnabled ? state.loopStart : 0),
      endTick: options.endTick !== undefined ? options.endTick : (state.loopEnabled ? state.loopEnd : lastNoteTick),
      includeProceduralFx: options.includeProceduralFx !== undefined ? options.includeProceduralFx : state.studioSettings.proceduralFxEnabled,
      exportRegionMode: options.exportRegionMode,
      exportRegions: options.exportRegions
    };

    try {
      let renderState = { ...state };

      if (renderOptions.trackIds && renderOptions.trackIds.length > 0) {
        const selectedRenderTracks = state.tracks
          .filter(t => renderOptions.trackIds!.includes(t.id))
          .map(t => ({ ...t, muted: false, soloed: false }));
        const selectedRenderNotes = state.notes.filter(n => renderOptions.trackIds!.includes(n.trackId));
        const selectedRenderAutomationCurves: Record<string, any> = {};
        renderOptions.trackIds.forEach(id => {
          selectedRenderAutomationCurves[id] = state.automationCurves[id] ?? [];
        });
        renderState = {
          ...state,
          tracks: selectedRenderTracks,
          notes: selectedRenderNotes,
          automationCurves: selectedRenderAutomationCurves,
        };
      } else if (renderOptions.trackId) {
        const track = state.tracks.find(t => t.id === renderOptions.trackId);
        if (!track) throw new Error('Track not found');
        const trackNotes = state.notes.filter(n => n.trackId === renderOptions.trackId);
        renderState = {
          ...state,
          tracks: [{ ...track, muted: false, soloed: false }],
          notes: trackNotes,
          automationCurves: { [renderOptions.trackId]: state.automationCurves[renderOptions.trackId] ?? [] },
        };
      }

      const nativeBuffer = await renderProjectAudio(renderState, renderOptions);
      const blob = format === 'wav' ? audioBufferToWav(nativeBuffer) : audioBufferToMp3(nativeBuffer, options.mp3Kbps ?? 320);
      
      const saved = await saveFileWithDialog(blob, {
        filename,
        title: 'Save Audio Export',
        filters: format === 'mp3' ? [{ name: 'MP3 Audio', extensions: ['mp3'] }] : [{ name: 'WAV Audio', extensions: ['wav'] }]
      });
      
      return !!saved;
    } catch (e) {
      console.error('Export failed via script:', e);
      throw e;
    }
  },

  // ==========================================
  // 15. PROJECT MANAGEMENT & FILE I/O
  // ==========================================
  project: {
    new: () => {
      // 1. Completely clear and reset JUCE VST3s and Tone nodes
      audioEngine.resetForNewProject();
      
      // 2. Load clean initial project structure
      useStore.getState().loadState({
        projectName: 'New Project',
        projectFilePath: null,
        tracks: [
          {
            id: 'track_synth',
            name: 'Default Synth',
            instrument: 'synth',
            volume: 1,
            pan: 0,
            muted: false,
            soloed: false,
            color: '#4dabf7',
            collapsed: true,
            synthPreset: DEFAULT_SYNTH_PRESET,
            delayTime: 0.25,
            delayFeedback: 0.25
          },
          {
            id: 'track_drum',
            name: 'Drum Machine',
            instrument: 'drum',
            volume: 1,
            pan: 0,
            muted: false,
            soloed: false,
            color: '#ff9900',
            collapsed: true,
            drumKit: DEFAULT_DRUM_KIT,
            delayTime: 0.25,
            delayFeedback: 0.25
          }
        ],
        notes: [],
        clips: [],
        groups: [],
        automationCurves: {},
        automationTargets: {},
        automationLanes: {},
        bpm: 120,
        playheadPosition: 0,
        loopStart: 0,
        loopEnd: 768,
        activeTrackId: 'track_synth',
        selectedNoteIds: [],
        selectedTrackIds: ['track_synth'],
      });

      // 3. Re-instantiate standard Web Audio synth and drum instruments
      audioEngine.createInstrument('track_synth', 'synth');
      audioEngine.createInstrument('track_drum', 'drum');
    },

    save: async (filename: string = 'project.muse') => {
      const state = useStore.getState();
      const saveState = {
        projectName: state.projectName,
        projectFilePath: state.projectFilePath,
        bpm: state.bpm,
        completeNotesOnPause: state.completeNotesOnPause,
        tracks: state.tracks,
        notes: state.notes,
        columnWidths: state.columnWidths,
        activeTrackId: state.activeTrackId,
        loopEnabled: state.loopEnabled,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        scaleLock: state.scaleLock,
        snapEnabled: state.snapEnabled,
        snapResolution: state.snapResolution,
        gridBlockTicks: state.gridBlockTicks,
        minNoteSize: state.minNoteSize,
        gridShadeEvery: state.gridShadeEvery,
        gridColumnCount: state.gridColumnCount,
        swing: state.swing,
        metronomeEnabled: state.metronomeEnabled,
        metronomeVolume: state.metronomeVolume,
        grooveTemplates: state.grooveTemplates,
        activeGrooveTemplateId: state.activeGrooveTemplateId,
        grooveTimingStrength: state.grooveTimingStrength,
        grooveVelocityStrength: state.grooveVelocityStrength,
        grooveExtractionTargetAll: state.grooveExtractionTargetAll,
        quantizeInputEnabled: state.quantizeInputEnabled,
        playheadFollowMode: state.playheadFollowMode,
        automationCurves: state.automationCurves,
        automationTargets: state.automationTargets,
        automationLanes: state.automationLanes,
        clips: state.clips,
        groups: state.groups,
        drumSteps: state.drumSteps,
        timeSignature: state.timeSignature,
        metronomeSettings: state.metronomeSettings,
        studioSettings: state.studioSettings,
        leftPaneWidth: state.leftPaneWidth,
        leftPaneCollapsed: state.leftPaneCollapsed,
        splitRatio: state.splitRatio,
        leftPaneTopRatio: state.leftPaneTopRatio,
        midiRemapData: state.midiRemapData,
        showSynthVelocity: state.showSynthVelocity,
        showDrumVelocity: state.showDrumVelocity,
        vocalVelocityMin: state.vocalVelocityMin,
        vocalVelocityMax: state.vocalVelocityMax,
        vocalVelocityScale: state.vocalVelocityScale,
        vocalVelocityEnabled: state.vocalVelocityEnabled,
        gridResizable: state.gridResizable,
        autoExtendGrid: state.autoExtendGrid,
        customFxConfigs: state.customFxConfigs,
        horizScrollLockEnabled: state.horizScrollLockEnabled,
        vertScrollLockEnabled: state.vertScrollLockEnabled,
        readOnlyMode: state.readOnlyMode,
        scrollBoth: state.scrollBoth,
        sharedPanX: state.sharedPanX,
        pitchSnapEnabled: state.pitchSnapEnabled,
        pitchDropSnap: state.pitchDropSnap,
        pitchSnapSensitivity: state.pitchSnapSensitivity,
        verticalMergeThreshold: state.verticalMergeThreshold,
        verticalStretchMode: state.verticalStretchMode,
        customSynthRows: state.customSynthRows,
        customDrumRows: state.customDrumRows,
        synthLowerOctave: state.synthLowerOctave,
        synthUpperOctave: state.synthUpperOctave,
        scriptContent: state.scriptContent,
      };

      const blob = new Blob([JSON.stringify(saveState, null, 2)], { type: 'application/json' });
      const targetFilename = filename.endsWith('.muse') || filename.endsWith('.muz') ? filename : `${filename}.muz`;
      await saveFileWithDialog(blob, {
        filename: targetFilename,
        title: 'Save Project',
        filters: [{ name: 'MuseGrid Project', extensions: ['muz', 'muse'] }]
      });
    },

    load: async (file?: File) => {
      let selectedFile = file;
      if (!selectedFile) {
        const files = await ScriptAPI.promptForFiles({ accept: '.muse,.muz' });
        if (files && files.length > 0) {
          selectedFile = files[0];
        } else {
          return;
        }
      }

      try {
        const text = await selectedFile.text();
        const parsed = JSON.parse(text);
        audioEngine.resetForNewProject();
        useStore.getState().loadState({ ...parsed, automationTargets: parsed.automationTargets ?? {}, automationLanes: parsed.automationLanes ?? {} });
      } catch (e) {
        console.error('Failed to load project via script:', e);
        throw e;
      }
    },

    getState: () => {
      return useStore.getState();
    },

    loadState: (state: Partial<any>) => {
      useStore.getState().loadState(state);
    },

    undo: () => {
      useStore.getState().undo();
    },

    redo: () => {
      useStore.getState().redo();
    },

    commitHistory: () => {
      useStore.getState().commitHistory();
    },

    setProjectName: (name: string) => {
      useStore.getState().setProjectInfo({ projectName: name });
    },

    exportWav: async (filename: string = 'export.wav', options: any = {}) => {
      return await ScriptAPI.exportAudio(filename, { ...options, format: 'wav' });
    },

    exportMp3: async (filename: string = 'export.mp3', options: any = {}) => {
      return await ScriptAPI.exportAudio(filename, { ...options, format: 'mp3' });
    },

    exportMidi: async (filename: string = 'export.mid', options?: { trackId?: string; trackIds?: string[]; mapToEdoDegrees?: boolean }) => {
      const state = useStore.getState();
      const exportTracks = options?.trackIds && options.trackIds.length > 0
        ? state.tracks.filter(t => options.trackIds!.includes(t.id))
        : options?.trackId ? state.tracks.filter(t => t.id === options.trackId) : state.tracks;

      const exportNotes = options?.trackIds && options.trackIds.length > 0
        ? state.notes.filter(n => options.trackIds!.includes(n.trackId))
        : options?.trackId ? state.notes.filter(n => n.trackId === options.trackId) : state.notes;

      const midiData = createMidiData(exportNotes, state.bpm, exportTracks, { mapToEdoDegrees: options?.mapToEdoDegrees });
      const blob = new Blob([midiData as unknown as BlobPart], { type: 'audio/midi' });
      const targetFilename = filename.endsWith('.mid') ? filename : `${filename}.mid`;
      await saveFileWithDialog(blob, {
        filename: targetFilename,
        title: 'Save MIDI File',
        filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }]
      });
    },

    exportScore: async (options: { trackId: string; format?: 'musicxml'; includeLyrics?: boolean }) => {
      await ScriptAPI.exportScore(options);
    }
  },

  // ==========================================
  // 16. UI, MODALS, LAYOUT & NOTIFICATIONS
  // ==========================================
  ui: {
    openModal: (modal: 'scripting' | 'importAudio' | 'synthStudio' | 'drumDesigner' | 'scorePreview') => {
      ScriptAPI.ui.toggleModal(modal, true);
    },
    closeModal: (modal: 'scripting' | 'importAudio' | 'synthStudio' | 'drumDesigner' | 'scorePreview') => {
      ScriptAPI.ui.toggleModal(modal, false);
    },
    toggleModal: (modal: string, visible?: boolean) => {
      const state = useStore.getState();
      switch (modal) {
        case 'scripting':
          state.setIsScriptingModalVisible(visible !== undefined ? visible : !state.isScriptingModalVisible);
          break;
        case 'importAudio':
          state.setShowImportAudioModal(visible !== undefined ? visible : !state.showImportAudioModal, state.activeTrackId, null);
          break;
        case 'synthStudio':
          state.setIsSynthStudioModalVisible(visible !== undefined ? visible : !state.isSynthStudioModalVisible);
          break;
        case 'drumDesigner':
          state.setIsDrumDesignerModalVisible(visible !== undefined ? visible : !state.isDrumDesignerModalVisible);
          break;
        case 'scorePreview':
          state.setIsScorePreviewVisible(visible !== undefined ? visible : !state.isScorePreviewVisible);
          break;
        case 'rightPane':
          state.setIsRightPaneVisible(visible !== undefined ? visible : !state.isRightPaneVisible);
          break;
        case 'helpPane':
          state.setIsHelpPaneVisible(visible !== undefined ? visible : !state.isHelpPaneVisible);
          break;
      }
    },
    setPaneVisible: (pane: 'rightPane' | 'helpPane' | 'leftPane', visible: boolean) => {
      const state = useStore.getState();
      if (pane === 'rightPane') state.setIsRightPaneVisible(visible);
      if (pane === 'helpPane') state.setIsHelpPaneVisible(visible);
      if (pane === 'leftPane') state.setLeftPaneCollapsed(!visible);
    },
    togglePane: (pane: 'rightPane' | 'helpPane' | 'leftPane') => {
      const state = useStore.getState();
      if (pane === 'rightPane') state.setIsRightPaneVisible(!state.isRightPaneVisible);
      if (pane === 'helpPane') state.setIsHelpPaneVisible(!state.isHelpPaneVisible);
      if (pane === 'leftPane') state.setLeftPaneCollapsed(!state.leftPaneCollapsed);
    },
    setLayout: (config: {
      leftPaneWidth?: number;
      splitRatio?: number;
      leftPaneTopRatio?: number;
      isLeftPaneFlipped?: boolean;
    }) => {
      const state = useStore.getState();
      if (config.leftPaneWidth !== undefined) state.setLeftPaneWidth(config.leftPaneWidth);
      if (config.splitRatio !== undefined) state.setSplitRatio(config.splitRatio);
      if (config.leftPaneTopRatio !== undefined) state.setLeftPaneTopRatio(config.leftPaneTopRatio);
      if (config.isLeftPaneFlipped !== undefined) state.setIsLeftPaneFlipped(config.isLeftPaneFlipped);
    },
    setGridPaneMode: (mode: 'split' | 'synth-only' | 'drum-only' | 'active') => {
      useStore.getState().setGridPaneMode(mode);
    },
    setGridSplitOrder: (order: 'synth-first' | 'drum-first') => {
      useStore.getState().setGridSplitOrder(order);
    },
    setZoom: (synthZoom?: number, drumZoom?: number) => {
      const state = useStore.getState();
      if (synthZoom !== undefined) state.setZoomSynth(synthZoom);
      if (drumZoom !== undefined) state.setZoomDrum(drumZoom);
    },
    resetZoom: () => {
      useStore.getState().resetZoom();
    },
    showToast: (message: string, type: 'error' | 'info' | 'success' = 'info') => {
      useStore.getState().showToast(message, type);
    }
  },

  // ==========================================
  // 17. NATIVE JUCE BRIDGE
  // ==========================================
  native: {
    isAvailable: (): boolean => {
      return Boolean((window as any).__isJuceNative__ && (window as any).juceAudioBridge);
    },
    postCommand: (command: any) => {
      if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
        return (window as any).juceAudioBridge.postCommand(command);
      }
      console.warn('JUCE Native Audio Bridge is not active in this browser environment');
    }
  }
};

// Wire up alias
ScriptAPI.notes = ScriptAPI.editor;

// Expose globally on window so any console command, test runner, or script has zero-friction access
if (typeof window !== 'undefined') {
  (window as any).Muse = ScriptAPI;
  (window as any).ScriptAPI = ScriptAPI;
  (window as any).MuseState = ScriptAPI.getState;
  (window as any).Tone = Tone;
}
