import { Midi } from '@tonejs/midi'
import type { Note, Track } from '../engine/store'

export interface MidiExportOptions {
  mapToEdoDegrees?: boolean;
}

export function createMidiData(notes: Note[], bpm: number, tracks?: Track[], options?: MidiExportOptions): Uint8Array {
  const midi = new Midi()
  
  // Set global tempo
  midi.header.setTempo(bpm)

  // Scale MuseGrid ticks (192 PPQ) to @tonejs/midi ticks (midi.header.ppq, typically 480 PPQ)
  const scale = (midi.header.ppq || 480) / 192

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
