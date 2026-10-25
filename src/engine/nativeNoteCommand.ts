import * as Tone from 'tone'
import type { Track } from './store'

export interface NativeNoteOnCommand {
  type: 'noteOn'
  trackId: string
  instrument: string
  pitch: number
  velocity: number
  duration: number
  slideEnd?: number
  slideTime: number
  vibratoDepth?: number
  vibratoRate?: number
  tremoloDepth?: number
  tremoloRate?: number
  filterStart?: number
  filterEnd?: number
  filterSweepTime?: number
  lyric: string
  pitchOffset: number
  drumDecay: number
  slideSemitones: number
  punchOctaves: number
  resonanceHz: number
}

interface NoteCommandSource {
  trackId: string
  type: string
  pitch: string | number
  duration: string | number
  velocity: number
  detune?: number
  pitchEnd?: string | number
  noteData?: any
  track?: Track | undefined
  /** Export-only transposition added on top of what live playback would send. */
  extraPitchOffset?: number
}

/**
 * Builds the exact `noteOn` payload the JUCE engine receives for one note, shared by live
 * playback and the offline bounce so a WAV export triggers the same voices as the transport.
 */
export function buildNativeNoteOnCommand(src: NoteCommandSource): NativeNoteOnCommand {
  const { trackId, type, pitch, duration, velocity, detune, pitchEnd, noteData, track } = src

  const effectiveInstrument = (type === 'drum' || track?.instrument === 'drum') ? 'drum' : (type || track?.instrument || 'synth')

  let startMidi = 0
  if (typeof pitch === 'number') {
    startMidi = pitch
  } else if (typeof pitch === 'string') {
    const num = Number(pitch)
    if (!isNaN(num)) {
      startMidi = num
    } else {
      startMidi = Tone.Frequency(pitch).toMidi()
    }
  }

  let endMidi: number | undefined = undefined
  let slideTime = 0
  if (pitchEnd !== undefined) {
    endMidi = typeof pitchEnd === 'number' ? pitchEnd : Tone.Frequency(pitchEnd).toMidi()
  }
  if (noteData?.pitchSlide) {
    endMidi = startMidi + noteData.pitchSlide
    slideTime = noteData.pitchSlideTime ? Tone.Time(noteData.pitchSlideTime + 'i').toSeconds() : 0.1
  }

  const durSec = typeof duration === 'number' ? duration : Tone.Time(duration).toSeconds()

  const totalPitchOffset = (noteData?.pitchOffset ?? 0) + (detune ? detune / 100 : 0) + (track?.transpose ?? 0) + (src.extraPitchOffset ?? 0)

  return {
    type: 'noteOn',
    trackId,
    instrument: effectiveInstrument,
    pitch: startMidi,
    velocity,
    duration: durSec,
    slideEnd: endMidi,
    slideTime,
    vibratoDepth: noteData?.vibratoDepth,
    vibratoRate: noteData?.vibratoRate,
    tremoloDepth: noteData?.tremoloDepth,
    tremoloRate: noteData?.tremoloRate,
    filterStart: noteData?.filterStart,
    filterEnd: noteData?.filterEnd,
    filterSweepTime: noteData?.filterSweepTime ? Tone.Time(noteData.filterSweepTime + 'i').toSeconds() : undefined,
    lyric: noteData?.lyric || 'a',
    pitchOffset: totalPitchOffset,
    drumDecay: noteData?.decay ?? -1,
    slideSemitones: noteData?.pitchSlide ?? 0,
    punchOctaves: noteData?.octaves ?? -1,
    resonanceHz: noteData?.resonance ?? -1
  }
}
