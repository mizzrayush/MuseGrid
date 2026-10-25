import * as Tone from 'tone'
import { audioEngine } from './AudioEngine'
import { useStore } from './store'
import type { Track, Note, AutomationPoint } from './store'
import { getAutomationValueAtTick } from '../utils/automation'
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
  automationPoints: AutomationPoint[] | undefined
): ScheduledNoteMapping {
  const trackBpm = track?.targetTempo ?? globalBpm
  const multiplier = trackBpm / globalBpm
  const globalTPS = (globalBpm / 60) * TICKS_PER_BEAT
  const positionTicks = n.time / multiplier

  const transpose = track?.instrument === 'synth' ? (track.transpose ?? 0) : 0
  const drumMapShift = track?.instrument === 'drum' ? (track.drumMapShift ?? 0) : 0
  const isMicrotonal = track?.instrument === 'synth' && (n.pitch % 1 !== 0 || (track.edoDivision !== undefined && track.edoDivision !== 12))

  const finalPitch = track?.instrument === 'drum'
    ? (n.pitch >= 1000 ? n.pitch : (n.pitch >= 16 ? n.pitch : ((n.pitch + drumMapShift) % 16 + 16) % 16))
    : (isMicrotonal ? Tone.Frequency(n.pitch + transpose, 'midi').toFrequency() : Tone.Frequency(n.pitch + transpose, 'midi').toNote())

  const noteBpm = n.bpm ?? trackBpm
  const noteTPS = (noteBpm / 60) * TICKS_PER_BEAT
  const durationSeconds = Math.max(0.005, n.duration / noteTPS)

  const finalPitchEnd = n.pitchEnd !== undefined && track?.instrument !== 'drum'
    ? (isMicrotonal ? Tone.Frequency(n.pitchEnd + transpose, 'midi').toFrequency() : Tone.Frequency(n.pitchEnd + transpose, 'midi').toNote())
    : undefined

  return {
    time: `${Math.round(positionTicks)}i`,
    timeSeconds: positionTicks / globalTPS,
    positionTicks,
    pitch: finalPitch,
    pitchEnd: finalPitchEnd,
    duration: durationSeconds,
    velocity: getAutomationValueAtTick(automationPoints, n.time + n.duration / 2, n.velocity) / 127,
    instrumentOverride: n.instrumentOverride,
    detune: n.detune,
    note: n
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
        a.fxInstances !== b.fxInstances
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
        state.bpm !== prevState.bpm
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
      const trackNotes = notesByTrack.get(n.trackId)
      if (trackNotes) trackNotes.push(n)
    })

    const globalBpm = useStore.getState().bpm

    // Create a new Part for each track
    notesByTrack.forEach((trackNotes, trackId) => {
      const track = tracks.find(t => t.id === trackId)
      const trackBpm = track?.targetTempo ?? globalBpm
      const multiplier = trackBpm / globalBpm
      const globalTPS = (globalBpm / 60) * TICKS_PER_BEAT
      const automationPoints = useStore.getState().automationCurves[trackId]
      const events: ScheduledTrackEvent[] = trackNotes.map(n => ({
        kind: 'note',
        ...mapNoteToScheduledEvent(n, track, globalBpm, automationPoints)
      }))

      if (track) {
        const dpreverbs = getActiveDPreverbInstances(track as any)
        if (dpreverbs.length > 0) {
          trackNotes.forEach(n => {
            const noteStartTicks = n.time / multiplier
            dpreverbs.forEach(({ inst, settings }) => {
              const idealPreStartTicks = noteStartTicks - (settings.tail * globalTPS)
              const preStartTicks = Math.max(0, idealPreStartTicks)
              const effectiveDuration = (noteStartTicks - preStartTicks) / globalTPS
              if (effectiveDuration <= 0.015) return

              events.push({
                kind: 'dpreverb',
                time: `${Math.round(preStartTicks)}i`,
                fxInstanceId: inst.id,
                duration: effectiveDuration,
                wet: settings.wet,
                decay: settings.decay,
                tone: settings.tone
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
