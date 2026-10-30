import { Midi } from '@tonejs/midi'
import type { Note, Track } from '../engine/store'
import {
  getMeterPositionAtTick,
  getTempoAtTick,
  type MeterPoint,
  type TempoPoint,
} from './conductor'

export interface MidiExportOptions {
  mapToEdoDegrees?: boolean;
  /** Conductor maps are written as tempo/time-signature meta events. */
  tempoMap?: TempoPoint[];
  meterMap?: MeterPoint[];
  timeSignature?: string;
  /** Export region start; maps are rebased so tick 0 is the region start. */
  startTick?: number;
}

export function createMidiData(notes: Note[], bpm: number, tracks?: Track[], options?: MidiExportOptions): Uint8Array {
  const midi = new Midi()
  const regionStart = options?.startTick ?? 0

  // Scale MuseGrid ticks (192 PPQ) to @tonejs/midi ticks (midi.header.ppq, typically 480 PPQ)
  const scale = (midi.header.ppq || 480) / 192

  const tempoMap = options?.tempoMap ?? []
  const meterMap = options?.meterMap ?? []

  if (tempoMap.length > 0) {
    // Sample non-step ramps on beat boundaries so DAWs see a close approximation of
    // the curve, then land exact values on every tempo point.
    const events = new Map<number, number>()
    const baseAtStart = getTempoAtTick(tempoMap, bpm, regionStart)
    events.set(0, baseAtStart)
    tempoMap.forEach((point, index) => {
      if (point.tick < regionStart) return
      const next = tempoMap[index + 1]
      if (next && point.curve !== 'step') {
        for (let tick = point.tick + 96; tick < next.tick; tick += 96) {
          events.set(Math.round((tick - regionStart) * scale), getTempoAtTick(tempoMap, bpm, tick))
        }
      }
      events.set(Math.round((point.tick - regionStart) * scale), point.bpm)
    })
    midi.header.tempos = [...events.entries()]
      .filter(([ticks]) => ticks >= 0)
      .sort((a, b) => a[0] - b[0])
      .map(([ticks, eventBpm]) => ({ ticks, bpm: eventBpm }))
  } else {
    // Set global tempo
    midi.header.setTempo(bpm)
  }

  if (meterMap.length > 0) {
    const signatureEvents = new Map<number, number[]>()
    signatureEvents.set(0, [
      getMeterPositionAtTick(meterMap, options?.timeSignature ?? '4/4', regionStart).meter.numerator,
      getMeterPositionAtTick(meterMap, options?.timeSignature ?? '4/4', regionStart).meter.denominator,
    ])
    meterMap.forEach(point => {
      if (point.tick < regionStart) return
      signatureEvents.set(Math.round((point.tick - regionStart) * scale), [point.numerator, point.denominator])
    })
    midi.header.timeSignatures = [...signatureEvents.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ticks, timeSignature]) => ({ ticks, timeSignature }))
  }

  if (tempoMap.length > 0 || meterMap.length > 0) {
    midi.header.update()
  }

  if (tracks && tracks.length > 0) {
    const notesByTrack = new Map<string, Note[]>()
    notes.forEach(note => {
      const arr = notesByTrack.get(note.trackId) || []
      arr.push(note)
      notesByTrack.set(note.trackId, arr)
    })

    tracks.forEach(t => {
      const trackNotes = notesByTrack.get(t.id) || []
      if (trackNotes.length > 0) {
        const midiTrack = midi.addTrack()
        midiTrack.name = t.name
        
        const isMicrotonal = t.instrument === 'synth' && !!t.edoDivision && t.edoDivision !== 12
        const rootNote = t.edoRootNote ?? 60
        const edo = t.edoDivision || 12

        trackNotes.forEach(note => {
          let midiPitch: number
          if (isMicrotonal && options?.mapToEdoDegrees) {
            // Map sequential EDO scale steps to sequential MIDI notes for Scala-tuned synths
            const stepSize = 12 / edo
            const stepIndex = Math.round((note.pitch - rootNote) / stepSize)
            midiPitch = Math.max(0, Math.min(127, rootNote + stepIndex))
          } else {
            midiPitch = Math.max(0, Math.min(127, Math.round(note.pitch)))
            // If not mapping to EDO degrees and has microtonal cents offset, add pitch bend
            const centsOffset = (note.pitch - midiPitch) * 100
            if (Math.abs(centsOffset) > 2) {
              const bendNorm = Math.max(-1, Math.min(1, centsOffset / 200))
              midiTrack.addPitchBend({
                ticks: Math.round(note.time * scale),
                value: bendNorm
              })
              midiTrack.addPitchBend({
                ticks: Math.round((note.time + note.duration) * scale),
                value: 0
              })
            }
          }

          midiTrack.addNote({
            midi: midiPitch,
            ticks: Math.round(note.time * scale),
            durationTicks: Math.max(1, Math.round(note.duration * scale)),
            velocity: note.velocity / 127
          })
        })
      }
    })
  } else {
    const track = midi.addTrack()
    notes.forEach(note => {
      const midiPitch = Math.max(0, Math.min(127, Math.round(note.pitch)))
      const centsOffset = (note.pitch - midiPitch) * 100
      if (Math.abs(centsOffset) > 2) {
        const bendNorm = Math.max(-1, Math.min(1, centsOffset / 200))
        track.addPitchBend({
          ticks: Math.round(note.time * scale),
          value: bendNorm
        })
        track.addPitchBend({
          ticks: Math.round((note.time + note.duration) * scale),
          value: 0
        })
      }
      track.addNote({
        midi: midiPitch,
        ticks: Math.round(note.time * scale),
        durationTicks: Math.max(1, Math.round(note.duration * scale)),
        velocity: note.velocity / 127
      })
    })
  }

  return midi.toArray()
}
