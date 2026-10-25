import type { AppState, Track } from '../engine/store'
import { mapNoteToScheduledEvent, TICKS_PER_BEAT } from '../engine/Scheduler'
import { buildNativeNoteOnCommand, type NativeNoteOnCommand } from '../engine/nativeNoteCommand'

export type NativeBitDepth = 16 | 24 | 32

export interface NativeBounceRequest {
  trackId?: string
  trackIds?: string[]
  octaveOffset: number
  semitoneOffset: number
  normalize: boolean
  autoFade: boolean
  includeMetronome: boolean
  includeProceduralFx?: boolean
  startTick: number
  endTick: number
  exportRegionMode: boolean
  filename: string
}

export interface NativeBounceEvent extends NativeNoteOnCommand {
  time: number
}

export interface NativeMetronomeConfig {
  bpm: number
  startTick: number
  beatsPerMeasure: number
  metronomeVolume: number
  gainDb: number
  pitchDecay: number
  octaves: number
  attack: number
  decay: number
  sustain: number
  release: number
  downbeatPitch: string
  upbeatPitch: string
  downbeatVel: number
  upbeatVel: number
}

export interface NativeBouncePayload {
  filename: string
  title: string
  sampleRate: number
  bitDepth: NativeBitDepth
  durationSeconds: number
  normalize: boolean
  normalizeTargetDb: number
  autoFade: boolean
  fadeSeconds: number
  events: NativeBounceEvent[]
  trackOverrides: Array<{ trackId: string, muted: boolean, soloed: boolean }>
  metronome?: NativeMetronomeConfig
}

export interface NativeBounceResult {
  success?: boolean
  path?: string
  message?: string
  peakLinear?: number
  appliedGain?: number
}

const TAIL_TICKS = 10

function isAudible(track: Track, tracks: Track[]): boolean {
  const hasSolo = tracks.some(t => t.soloed)
  if (hasSolo && !track.soloed) return false
  return !track.muted
}

/** True only inside the JUCE host with the request/response bridge available. */
export function canUseNativeBounce(): boolean {
  return Boolean((window as any).__isJuceNative__ && (window as any).ipcRenderer?.invoke)
}

/**
 * The JUCE host already owns the sound you hear (voices, drums, chromatic sampler, native and
 * VST3 FX), so a native bounce needs no re-implementation of the graph. It cannot reproduce
 * script-driven procedural FX nor the multi-region splice, so those cases return null and stay
 * on the Tone.js renderer. The metronome is passed along as a config and synthesized natively.
 */
export function buildNativeBouncePayload(state: AppState, request: NativeBounceRequest, bitDepth: NativeBitDepth): NativeBouncePayload | null {
  if (request.exportRegionMode) return null
  if (request.includeProceduralFx && state.studioSettings.proceduralFxEnabled) return null

  const globalTPS = (state.bpm / 60) * TICKS_PER_BEAT
  if (!(globalTPS > 0)) return null

  const startSeconds = request.startTick / globalTPS
  const rangeSeconds = (request.endTick - request.startTick) / globalTPS

  const selectedIds = request.trackIds && request.trackIds.length > 0
    ? new Set(request.trackIds)
    : request.trackId ? new Set([request.trackId]) : null

  const renderableTracks = selectedIds
    ? state.tracks.filter(t => selectedIds.has(t.id))
    : state.tracks.filter(t => isAudible(t, state.tracks))

  if (renderableTracks.length === 0) return null

  const renderableTrackIds = new Set(renderableTracks.map(t => t.id))
  const extraPitchOffset = request.octaveOffset * 12 + request.semitoneOffset

  const events: NativeBounceEvent[] = []
  let lastNoteEndSeconds = 0

  state.notes.forEach(note => {
    if (!renderableTrackIds.has(note.trackId)) return
    if (note.time + note.duration <= request.startTick || note.time >= request.endTick) return

    const track = state.tracks.find(t => t.id === note.trackId)
    const mapped = mapNoteToScheduledEvent(note, track, state.bpm, state.automationCurves[note.trackId])
    const command = buildNativeNoteOnCommand({
      trackId: note.trackId,
      type: track?.instrument ?? 'synth',
      pitch: mapped.pitch,
      duration: mapped.duration,
      velocity: mapped.velocity,
      detune: mapped.detune,
      pitchEnd: mapped.pitchEnd,
      noteData: mapped.note,
      track,
      extraPitchOffset
    })

    const time = Math.max(0, mapped.timeSeconds - startSeconds)
    events.push({ ...command, time })
    lastNoteEndSeconds = Math.max(lastNoteEndSeconds, time + command.duration)
  })

  if (events.length === 0 && !request.includeMetronome) return null

  const fadeSeconds = state.studioSettings.renderFadeDuration ?? 0.1
  const durationSeconds = Math.max(1,
    Math.max(lastNoteEndSeconds, rangeSeconds) + TAIL_TICKS / globalTPS + (request.autoFade ? fadeSeconds : 0.5))

  // Stems and selected mixes are rendered in isolation; a full mix keeps the live mute/solo.
  const trackOverrides = selectedIds
    ? state.tracks.map(t => ({ trackId: t.id, muted: !selectedIds.has(t.id), soloed: false }))
    : []

  const parsedBeatsPerMeasure = parseInt(state.timeSignature.split('/')[0], 10)
  const click = state.metronomeSettings
  const metronome: NativeMetronomeConfig | undefined = request.includeMetronome ? {
    bpm: state.bpm,
    startTick: request.startTick,
    beatsPerMeasure: Number.isFinite(parsedBeatsPerMeasure) && parsedBeatsPerMeasure > 0 ? parsedBeatsPerMeasure : 4,
    metronomeVolume: state.metronomeVolume,
    gainDb: click.volume,
    pitchDecay: click.pitchDecay,
    octaves: click.octaves,
    attack: click.attack,
    decay: click.decay,
    sustain: click.sustain,
    release: click.release,
    downbeatPitch: click.downbeatPitch,
    upbeatPitch: click.upbeatPitch,
    downbeatVel: click.downbeatVel,
    upbeatVel: click.upbeatVel,
  } : undefined

  return {
    filename: request.filename,
    title: 'Export Audio',
    sampleRate: state.studioSettings.sampleRate ?? 44100,
    bitDepth,
    durationSeconds,
    normalize: request.normalize,
    normalizeTargetDb: state.studioSettings.normalizationTarget ?? -1.0,
    autoFade: request.autoFade,
    fadeSeconds,
    events,
    trackOverrides,
    metronome
  }
}

export async function renderNativeBounce(payload: NativeBouncePayload): Promise<NativeBounceResult | null> {
  const result = await (window as any).ipcRenderer.invoke('render-audio', payload)
  if (!result) return null
  return result as NativeBounceResult
}
