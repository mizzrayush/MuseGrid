import * as Tone from 'tone'
import { audioEngine } from './AudioEngine'
import { useStore } from './store'
import type { Track, Note, AutomationPoint, AutomationTarget, AutomationLane } from './store'
import { parseAutomationTarget } from './store'
import { getLaneValueAtTick, applyExpressionLaneToNote, laneFallbackValue, laneIsActive, laneValueToPan, modulateFxParam } from '../utils/automation'
import { buildGlideIntoMap, resolveGlidePlayback, type GlideIntoSpec } from '../utils/midiEditing'
import { conductorBarsAtTick, conductorDurationSeconds, conductorSecondsAtTick, getTempoAtTick, type MeterPoint, type TempoPoint } from '../utils/conductor'
import { getActiveDPreverbInstances } from './fxDefaults'

export const TICKS_PER_BEAT = 192

export interface ScheduledNoteMapping {
  /** Transport position as Tone notation, used by Tone.Part. */
  time: string
  /** Same position in seconds from transport start, used by the offline bounce. */
  timeSeconds: number
  /** Same position in global-BPM ticks, used by the DPreverb pre-start. */
  positionTicks: number
  pitch: string | number
  pitchEnd?: string | number
  duration: number
  velocity: number
  instrumentOverride?: unknown
  detune?: number
  note: Note
}

/**
 * Maps one grid note to the values a voice needs. Shared by live scheduling and the
 * native offline bounce so an export triggers exactly what playback triggers.
 */
export function mapNoteToScheduledEvent(
  n: Note,
  track: Track | undefined,
  globalBpm: number,
  automationPoints: AutomationPoint[] | undefined,
  glideInto?: GlideIntoSpec,
  automationTarget: AutomationTarget = 'velocity',
  automationLane?: AutomationLane,
  allTrackCurves?: Record<string, AutomationPoint[]>,
  tempoMap?: TempoPoint[],
  meterMap?: MeterPoint[],
  timeSignature?: string
): ScheduledNoteMapping {
  const trackBpm = track?.targetTempo ?? globalBpm
  const multiplier = trackBpm / globalBpm
  const globalTPS = (globalBpm / 60) * TICKS_PER_BEAT
  // A destination-voice glide starts the landed note early, at the source pitch.
  const playback = resolveGlidePlayback(n, glideInto)
  const positionTicks = playback.startTick / multiplier

  const transpose = track?.instrument === 'synth' ? (track.transpose ?? 0) : 0
  const drumMapShift = track?.instrument === 'drum' ? (track.drumMapShift ?? 0) : 0
  const soundingPitch = playback.pitch
  const isMicrotonal = track?.instrument === 'synth' && (soundingPitch % 1 !== 0 || (track.edoDivision !== undefined && track.edoDivision !== 12))

  const finalPitch = track?.instrument === 'drum'
    ? (soundingPitch >= 1000 ? soundingPitch : (soundingPitch >= 16 ? soundingPitch : ((soundingPitch + drumMapShift) % 16 + 16) % 16))
    : (isMicrotonal ? Tone.Frequency(soundingPitch + transpose, 'midi').toFrequency() : Tone.Frequency(soundingPitch + transpose, 'midi').toNote())

  const noteBpm = n.bpm ?? trackBpm
  const noteTPS = (noteBpm / 60) * TICKS_PER_BEAT
  // Under a conductor tempo map the tick length varies, so length is the integral
  // of the map over the note's span. Per-note/track BPM still scales it relatively.
  const tempoDuration = tempoMap && tempoMap.length > 0
    ? conductorDurationSeconds(tempoMap, globalBpm, positionTicks, positionTicks + playback.durationTicks, meterMap, timeSignature)
    : playback.durationTicks / noteTPS
  const durationSeconds = Math.max(0.005, tempoDuration * (tempoMap && tempoMap.length > 0 ? globalBpm / Math.max(1, noteBpm) : 1))

  const finalPitchEnd = glideInto && track?.instrument !== 'drum'
    ? (isMicrotonal ? Tone.Frequency(n.pitch + transpose, 'midi').toFrequency() : Tone.Frequency(n.pitch + transpose, 'midi').toNote())
    : (n.pitchEnd !== undefined && track?.instrument !== 'drum'
      ? (isMicrotonal ? Tone.Frequency(n.pitchEnd + transpose, 'midi').toFrequency() : Tone.Frequency(n.pitchEnd + transpose, 'midi').toNote())
      : undefined)

  let velocity = n.velocity / 127
  let note = playback.note
  const laneTime = { tempoMap, meterMap, timeSignature }

  // Concurrent Multi-Parameter Curve Evaluation
  const trackId = track?.id || n.trackId
  const trackCurveEntries = allTrackCurves
    ? Object.entries(allTrackCurves).filter(([key, pts]) => (key === trackId || key.startsWith(`${trackId}::`)) && pts && pts.length > 0)
    : []

  if (trackCurveEntries.length > 0) {
    for (const [key, pts] of trackCurveEntries) {
      const targetStr = (key.includes('::') ? key.split('::').slice(1).join('::') : automationTarget) as AutomationTarget
      const laneValue = getLaneValueAtTick({
        points: pts,
        lane: automationLane,
        target: targetStr,
        tick: n.time + n.duration / 2,
        fallback: laneFallbackValue(targetStr, n),
        bpm: globalBpm,
        time: laneTime,
      })
      if (targetStr === 'volume') {
        note = { ...note, automationGain: Math.max(0, Math.min(1, laneValue / 127)) }
      } else if (targetStr === 'pan') {
        note = { ...note, pan: laneValueToPan(laneValue) }
      } else if (targetStr === 'velocity') {
        velocity = laneValue / 127
      } else if (parseAutomationTarget(targetStr)?.kind === 'expr' && laneIsActive(pts, automationLane)) {
        note = applyExpressionLaneToNote(note, targetStr, laneValue, {
          lane: automationLane, points: pts, bpm: globalBpm, time: laneTime,
        })
      }
    }
  } else {
    // Single lane fallback
    const laneValue = getLaneValueAtTick({
      points: automationPoints,
      lane: automationLane,
      target: automationTarget,
      tick: n.time + n.duration / 2,
      fallback: laneFallbackValue(automationTarget, n),
      bpm: globalBpm,
      time: laneTime,
    })
    if (automationTarget === 'volume') {
      note = { ...note, automationGain: Math.max(0, Math.min(1, laneValue / 127)) }
    } else if (automationTarget === 'pan') {
      note = { ...note, pan: laneValueToPan(laneValue) }
    } else if (automationTarget === 'velocity') {
      velocity = laneValue / 127
    } else if (parseAutomationTarget(automationTarget)?.kind === 'expr' && laneIsActive(automationPoints, automationLane)) {
      note = applyExpressionLaneToNote(note, automationTarget, laneValue, {
        lane: automationLane, points: automationPoints, bpm: globalBpm, time: laneTime,
      })
    }
  }

  return {
    time: `${Math.round(positionTicks)}i`,
    timeSeconds: tempoMap && tempoMap.length > 0
      ? conductorSecondsAtTick(tempoMap, globalBpm, positionTicks, meterMap, timeSignature)
      : positionTicks / globalTPS,
    positionTicks,
    pitch: finalPitch,
    pitchEnd: finalPitchEnd,
    duration: durationSeconds,
    velocity,
    instrumentOverride: n.instrumentOverride,
    detune: note.detune ?? n.detune,
    note
  }
}

type ScheduledTrackEvent =
  | {
    kind: 'note'
    time: string
    pitch: string | number
    pitchEnd?: string | number
    duration: number
    velocity: number
    instrumentOverride?: unknown
    detune?: number
    note: Note
  }
  | {
    kind: 'dpreverb'
    time: string
    fxInstanceId: string
    duration: number
    wet: number
    decay: number
    tone: number
  }

class Scheduler {


  // The Tone.Part is useful for scheduling an array of events,
  // but for a highly dynamic grid we often use Tone.Transport.schedule
  // or build a custom array of parts per track.
  private trackParts: Map<string, Tone.Part> = new Map()

  private didSchedulingPropertiesChange(tracksA: Track[], tracksB: Track[]): boolean {
    if (tracksA === tracksB) return false
    if (tracksA.length !== tracksB.length) return true
    for (let i = 0; i < tracksA.length; i++) {
      const a = tracksA[i]
      const b = tracksB[i]
      if (
        a.id !== b.id ||
        a.instrument !== b.instrument ||
        a.targetTempo !== b.targetTempo ||
        a.transpose !== b.transpose ||
        a.drumMapShift !== b.drumMapShift ||
        a.edoDivision !== b.edoDivision ||
        a.fxInstances !== b.fxInstances ||
        // DPreverb tails and their modulators are baked into the scheduled events.
        a.fxSettings !== b.fxSettings ||
        a.fxModulators !== b.fxModulators
      ) {
        return true
      }
    }
    return false
  }

  init() {
    const initialState = useStore.getState()
    this.rebuildSchedule(initialState.notes, initialState.tracks)

    // Subscribe to state changes to rebuild the schedule only when note/timing properties change
    useStore.subscribe((state, prevState) => {
      const tracksChanged = this.didSchedulingPropertiesChange(state.tracks, prevState.tracks)
      if (
        state.notes !== prevState.notes ||
        tracksChanged ||
        state.automationCurves !== prevState.automationCurves ||
        state.automationTargets !== prevState.automationTargets ||
        state.automationLanes !== prevState.automationLanes ||
        state.bpm !== prevState.bpm ||
        state.tempoMap !== prevState.tempoMap ||
        state.meterMap !== prevState.meterMap ||
        state.timeSignature !== prevState.timeSignature
      ) {
        this.rebuildSchedule(state.notes, state.tracks)
      }
    })
  }

  private rebuildSchedule(notes: Note[], tracks: Track[]) {
    // Clear all existing parts
    this.trackParts.forEach(part => part.dispose())
    this.trackParts.clear()

    // Group notes by track
    const notesByTrack = new Map<string, Note[]>()
    tracks.forEach(t => notesByTrack.set(t.id, []))
    notes.forEach(n => {
      if (n.muted) return
      const trackNotes = notesByTrack.get(n.trackId)
      if (trackNotes) trackNotes.push(n)
    })

    const globalBpm = useStore.getState().bpm
    const tempoMap = useStore.getState().tempoMap
    const meterMap = useStore.getState().meterMap
    const timeSignature = useStore.getState().timeSignature
    const audibleNotes = notes.filter(n => !n.muted)
    const glideIntoMap = buildGlideIntoMap(audibleNotes)
    const automationTargets = useStore.getState().automationTargets
    const automationLanes = useStore.getState().automationLanes

    // Create a new Part for each track
    notesByTrack.forEach((trackNotes, trackId) => {
      const track = tracks.find(t => t.id === trackId)
      const trackBpm = track?.targetTempo ?? globalBpm
      const multiplier = trackBpm / globalBpm
      const globalTPS = (globalBpm / 60) * TICKS_PER_BEAT
      const allCurves = useStore.getState().automationCurves
      const automationPoints = allCurves[trackId]
      const events: ScheduledTrackEvent[] = trackNotes.map(n => ({
        kind: 'note',
        ...mapNoteToScheduledEvent(n, track, globalBpm, automationPoints, glideIntoMap.get(n.id), automationTargets[trackId] ?? 'velocity', automationLanes[trackId], allCurves, tempoMap, meterMap, timeSignature)
      }))

      if (track) {
        const dpreverbs = getActiveDPreverbInstances(track as any)
        if (dpreverbs.length > 0) {
          trackNotes.forEach(n => {
            const noteStartTicks = n.time / multiplier
            const localBpm = tempoMap && tempoMap.length > 0
              ? getTempoAtTick(tempoMap, globalBpm, noteStartTicks, meterMap, timeSignature)
              : globalBpm
            const localTPS = (localBpm / 60) * TICKS_PER_BEAT
            dpreverbs.forEach(({ inst, settings }) => {
              // The pre-wash happens once per note, so its modulators are read at the note's
              // own position: the same t/b/m/ticks an FX modulator sees while the transport runs.
              const mods = track.fxModulators?.[inst.id]
              const modContext = {
                t: tempoMap && tempoMap.length > 0
                  ? conductorSecondsAtTick(tempoMap, globalBpm, noteStartTicks, meterMap, timeSignature)
                  : noteStartTicks / globalTPS,
                b: noteStartTicks / TICKS_PER_BEAT,
                m: conductorBarsAtTick(meterMap, timeSignature, noteStartTicks),
                ticks: noteStartTicks,
              }
              const wet = modulateFxParam(settings.wet, mods?.wet, modContext, 0, 1)
              const tail = modulateFxParam(settings.tail, mods?.tail, modContext, 0, 120)
              const decay = modulateFxParam(settings.decay, mods?.decay, modContext, 0.05, 1)
              const tone = modulateFxParam(settings.tone, mods?.tone, modContext, 0, 1)
              if (wet <= 0 || tail <= 0) return
              const idealPreStartTicks = noteStartTicks - (tail * localTPS)
              const preStartTicks = Math.max(0, idealPreStartTicks)
              const effectiveDuration = tempoMap && tempoMap.length > 0
                ? conductorSecondsAtTick(tempoMap, globalBpm, noteStartTicks, meterMap, timeSignature) -
                  conductorSecondsAtTick(tempoMap, globalBpm, preStartTicks, meterMap, timeSignature)
                : (noteStartTicks - preStartTicks) / globalTPS
              if (effectiveDuration <= 0.015) return

              events.push({
                kind: 'dpreverb',
                time: `${Math.round(preStartTicks)}i`,
                fxInstanceId: inst.id,
                duration: effectiveDuration,
                wet,
                decay,
                tone
              })
            })
          })
        }
      }

      const type = track ? track.instrument : 'synth'

      const part = new Tone.Part((time, value) => {
        const state = useStore.getState()
        if (state.isRecording && trackId === state.activeTrackId) return

        if ((value as ScheduledTrackEvent).kind === 'dpreverb') {
          const preverb = value as Extract<ScheduledTrackEvent, { kind: 'dpreverb' }>
          audioEngine.playDPreverb(
            trackId,
            preverb.fxInstanceId,
            preverb.duration,
            time,
            preverb.wet,
            preverb.decay,
            preverb.tone
          )
          return
        }

        const noteValue = value as Extract<ScheduledTrackEvent, { kind: 'note' }>
        audioEngine.playNote(
          trackId,
          type,
          noteValue.pitch,
          noteValue.duration as any,
          time,
          noteValue.velocity,
          noteValue.instrumentOverride as any,
          noteValue.detune,
          noteValue.pitchEnd,
          noteValue.note as any
        )
      }, events).start(0)

      this.trackParts.set(trackId, part)
    })
  }
}

export const scheduler = new Scheduler()
