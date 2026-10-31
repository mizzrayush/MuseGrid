import type { AppState, Track } from '../engine/store'
import * as Tone from 'tone'
import { mapNoteToScheduledEvent, TICKS_PER_BEAT } from '../engine/Scheduler'
import { buildNativeNoteOnCommand, type NativeNoteOnCommand } from '../engine/nativeNoteCommand'
import { buildGlideIntoMap, resolveGlidePlayback } from './midiEditing'
import { getLaneValueAtTick } from './automation'
import { applyAudioBufferFadeOut, normalizeAudioBuffer, stitchAudioBuffers } from './audioRender'
import { tempoMapIsActive } from './conductor'

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
  exportRegions?: Array<{ id?: string, startTick: number, endTick: number, gap: number }>
  filename: string
}

export type NativeBounceEvent =
  | (NativeNoteOnCommand & { time: number })
  | {
    type: 'vst3Param'
    trackId: string
    index: number
    value: number
    rampSeconds: number
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
 * script-driven procedural FX, so those cases return null and stay on the Tone.js renderer.
 * The metronome is passed along as a config and synthesized natively.
 */
export function buildNativeBouncePayload(state: AppState, request: NativeBounceRequest, bitDepth: NativeBitDepth): NativeBouncePayload | null {
  if (request.exportRegionMode) return null
  if (request.includeProceduralFx && state.studioSettings.proceduralFxEnabled) return null
  // The JUCE engine bounces at one constant BPM; a conductor map needs the
  // tick-integrated Tone renderer instead.
  if (tempoMapIsActive(state.tempoMap, state.bpm)) return null

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
  const audibleNotes = state.notes.filter(n => !n.muted)
  const glideIntoMap = buildGlideIntoMap(audibleNotes)

  audibleNotes.forEach(note => {
    if (!renderableTrackIds.has(note.trackId)) return

    const glideInto = glideIntoMap.get(note.id)
    // A destination-voiced link starts before the note's stored time, so range checks
    // have to use the resolved onset or a region export clips the ramp start.
    const shape = resolveGlidePlayback(note, glideInto)
    if (shape.startTick + shape.durationTicks <= request.startTick || shape.startTick >= request.endTick) return

    const track = state.tracks.find(t => t.id === note.trackId)
    const mapped = mapNoteToScheduledEvent(
      note,
      track,
      state.bpm,
      state.automationCurves[note.trackId],
      glideInto,
      state.automationTargets[note.trackId] ?? 'velocity',
      state.automationLanes?.[note.trackId],
      state.automationCurves,
      state.tempoMap,
      state.meterMap,
      state.timeSignature
    )
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

  // A `vst3:<index>` lane is baked into the event stream so the plugin hears the same
  // curve during a bounce that it hears live. 32 Hz sampling with a matching ramp keeps
  // the parameter continuous without flooding the engine.
  const noteEventCount = events.length
  const VST3_AUTOMATION_STEP_SECONDS = 1 / 32
  const stepTicks = VST3_AUTOMATION_STEP_SECONDS * globalTPS
  renderableTracks.forEach(track => {
    const target = state.automationTargets[track.id]
    if (!target || !target.startsWith('vst3:')) return
    const index = Number(target.slice(5))
    if (!Number.isInteger(index) || index < 0) return
    const points = state.automationCurves[track.id]
    const lane = state.automationLanes?.[track.id]
    if ((!points || points.length === 0) && lane?.source !== 'formula') return

    for (let tick = request.startTick; ; tick += stepTicks)
    {
      const clamped = Math.min(tick, request.endTick)
      const value = Math.max(0, Math.min(1, getLaneValueAtTick({
        points, lane, target, tick: clamped, fallback: 64, bpm: state.bpm,
        time: { tempoMap: state.tempoMap, meterMap: state.meterMap, timeSignature: state.timeSignature },
      }) / 127))
      events.push({
        type: 'vst3Param',
        trackId: track.id,
        index,
        value,
        rampSeconds: VST3_AUTOMATION_STEP_SECONDS,
        time: Math.max(0, (clamped - request.startTick) / globalTPS)
      })
      if (clamped >= request.endTick) break
    }
  })

  if (noteEventCount === 0 && !request.includeMetronome) return null

  const fadeSeconds = state.studioSettings.renderFadeDuration ?? 0.1
  const durationSeconds = Math.max(1,
    Math.max(lastNoteEndSeconds, rangeSeconds) + TAIL_TICKS / globalTPS + (request.autoFade ? fadeSeconds : 0.5))

  // Stems and selected mixes are rendered in isolation; a full mix keeps the live mute/solo.
  const trackOverrides = selectedIds
    ? state.tracks.map(t => ({ trackId: t.id, muted: !selectedIds.has(t.id), soloed: false }))
    : []

  const timeSignature = typeof state.timeSignature === 'string' ? state.timeSignature : '4/4'
  const parsedBeatsPerMeasure = parseInt(timeSignature.split('/')[0], 10)
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

async function renderNativeBounceToTemp(payload: NativeBouncePayload): Promise<AudioBuffer | null> {
  const result = await (window as any).ipcRenderer.invoke('render-audio-temp', payload)
  if (!result) return null
  if (!result.success) throw new Error(result.message || 'Native bounce failed')

  try
  {
    const response = await fetch(result.url as string)
    if (!response.ok) throw new Error(`Could not read the native render (${response.status})`)
    const bytes = await response.arrayBuffer()
    const ctx = Tone.getContext().rawContext as BaseAudioContext
    return await ctx.decodeAudioData(bytes)
  }
  finally
  {
    // The temp WAV has been decoded into memory; the host copy is no longer needed.
    ;(window as any).ipcRenderer.invoke('release-native-render', result.path).catch(() => {})
  }
}

/**
 * Renders through the JUCE engine and returns the audio in memory. Used by MP3 and
 * multi-region exports, which need the samples in JS to encode or stitch. Returns null
 * when the native path cannot reproduce the request, so the caller can fall back to Tone.
 */
export async function renderNativeAudioBuffer(
  state: AppState,
  request: NativeBounceRequest,
  bitDepth: NativeBitDepth
): Promise<AudioBuffer | null> {
  if (request.includeProceduralFx && state.studioSettings.proceduralFxEnabled) return null

  if (request.exportRegionMode && request.exportRegions && request.exportRegions.length > 0)
  {
    const regions = [...request.exportRegions].sort((a, b) => a.startTick - b.startTick)
    const globalTPS = (state.bpm / 60) * TICKS_PER_BEAT
    if (!(globalTPS > 0)) return null

    let sampleRate = state.studioSettings.sampleRate ?? 44100
    const buffers: AudioBuffer[] = []
    const gaps: number[] = []

    for (const region of regions)
    {
      const payload = buildNativeBouncePayload(state, {
        ...request,
        exportRegionMode: false,
        startTick: region.startTick,
        endTick: region.endTick,
        normalize: false,
        autoFade: false
      }, 24)

      if (!payload)
      {
        // A silent region still occupies its place in the stitched file, as in the Tone path.
        const seconds = Math.max(0.1, (region.endTick - region.startTick) / globalTPS)
        buffers.push(new AudioBuffer({ length: Math.max(1, Math.round(seconds * sampleRate)),
                                       numberOfChannels: 2, sampleRate }))
      }
      else
      {
        const buffer = await renderNativeBounceToTemp(payload)
        if (!buffer) return null
        buffers.push(buffer)
        sampleRate = buffer.sampleRate
      }
      gaps.push(Math.max(0, region.gap))
    }

    const stitched = stitchAudioBuffers(buffers, gaps)
    // The native per-region renders skip post-processing so normalize/fade apply once,
    // to the stitched result, exactly like the Tone renderer.
    if (request.autoFade) applyAudioBufferFadeOut(stitched, state.studioSettings.renderFadeDuration ?? 0.1)
    if (request.normalize) normalizeAudioBuffer(stitched, state.studioSettings.normalizationTarget ?? -1.0)
    return stitched
  }

  const payload = buildNativeBouncePayload(state, request, bitDepth)
  if (!payload) return null
  return renderNativeBounceToTemp(payload)
}
