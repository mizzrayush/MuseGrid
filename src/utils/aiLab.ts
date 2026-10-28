import * as mm from '@magenta/music/es6/music_rnn'
import { MusicVAE } from '@magenta/music/es6/music_vae'
import { Coconet } from '@magenta/music/es6/coconet'
import { PianoGenie } from '@magenta/music/es6/piano_genie'
import { OnsetsAndFrames } from '@magenta/music/es6/transcription'
import { useStore, type Note, type ScaleLock } from '../engine/store'
import { snapToScale } from './musicTheory'

import type { INoteSequence } from '@magenta/music/es6/protobuf'

let melodyRnn: mm.MusicRNN | null = null
let drumsRnn: mm.MusicRNN | null = null
let beatMorphVae: MusicVAE | null = null
let coconetModel: Coconet | null = null
let grooveVae: MusicVAE | null = null
let pianoGenieModel: PianoGenie | null = null
let transcriptionModel: OnsetsAndFrames | null = null

// Caching is handled locally via bundled files

export const BASIC_RNN_SPEC = {
  type: 'MusicRNN',
  dataConverter: {
    type: 'MelodyConverter',
    args: { minPitch: 48, maxPitch: 83 }
  }
}

export const DRUM_KIT_RNN_SPEC = {
  type: 'MusicRNN',
  dataConverter: {
    type: 'DrumsOneHotConverter',
    args: { pitchClasses: null, numSteps: null }
  },
  attentionLength: 32,
  auxInputs: [{ type: 'BinaryCounter', args: { numBits: 6 } }]
}

export const DRUMS_2BAR_VAE_SPEC = {
  type: 'MusicVAE',
  dataConverter: {
    type: 'DrumsConverter',
    args: { numSteps: 32, pitchClasses: null }
  }
}

export const GROOVAE_4BAR_SPEC = {
  type: 'MusicVAE',
  dataConverter: {
    type: 'GrooveConverter',
    args: { numSteps: 64, splitInstruments: false }
  }
}

export async function getMelodyRnn(): Promise<mm.MusicRNN> {
  if (!melodyRnn) {
    melodyRnn = new mm.MusicRNN('/ai_models/magenta/music_rnn/basic_rnn', BASIC_RNN_SPEC as any)
    try {
      useStore.getState().showToast('Loading Melody AI Model...', 'info')
      await melodyRnn.initialize()
    } catch (err) {
      console.warn('[aiLab] getMelodyRnn initialize failed, clearing instance:', err)
      melodyRnn = null
      throw err
    }
  }
  return melodyRnn
}

export async function getDrumsRnn(): Promise<mm.MusicRNN> {
  if (!drumsRnn) {
    drumsRnn = new mm.MusicRNN('/ai_models/magenta/music_rnn/drum_kit_rnn', DRUM_KIT_RNN_SPEC as any)
    try {
      useStore.getState().showToast('Loading Drums AI Model...', 'info')
      await drumsRnn.initialize()
    } catch (err) {
      console.warn('[aiLab] getDrumsRnn initialize failed, clearing instance:', err)
      drumsRnn = null
      throw err
    }
  }
  return drumsRnn
}

export async function getBeatMorphVae(): Promise<MusicVAE> {
  if (!beatMorphVae) {
    beatMorphVae = new MusicVAE('/ai_models/magenta/music_vae/drums_2bar_hikl_small', DRUMS_2BAR_VAE_SPEC as any)
    try {
      useStore.getState().showToast('Loading Beat Morphing AI...', 'info')
      await beatMorphVae.initialize()
    } catch (err) {
      console.warn('[aiLab] getBeatMorphVae initialize failed, clearing instance:', err)
      beatMorphVae = null
      throw err
    }
  }
  return beatMorphVae
}

export async function getCoconet(): Promise<Coconet> {
  if (!coconetModel) {
    coconetModel = new Coconet('/ai_models/magenta/coconet/bach')
    try {
      useStore.getState().showToast('Loading Neural Harmony AI...', 'info')
      await coconetModel.initialize()
    } catch (err) {
      console.warn('[aiLab] getCoconet initialize failed, clearing instance:', err)
      coconetModel = null
      throw err
    }
  }
  return coconetModel
}

export async function getGrooveVae(): Promise<MusicVAE> {
  if (!grooveVae) {
    grooveVae = new MusicVAE('/ai_models/magenta/music_vae/groovae_4bar', GROOVAE_4BAR_SPEC as any)
    try {
      useStore.getState().showToast('Loading Humanization AI...', 'info')
      await grooveVae.initialize()
    } catch (err) {
      console.warn('[aiLab] getGrooveVae initialize failed, clearing instance:', err)
      grooveVae = null
      throw err
    }
  }
  return grooveVae
}

export async function getPianoGenie(): Promise<PianoGenie> {
  if (!pianoGenieModel) {
    pianoGenieModel = new PianoGenie('/ai_models/magenta/piano_genie/model/epiano/stp_iq_auto_contour_dt_166006')
    try {
      useStore.getState().showToast('Loading Piano Genie AI...', 'info')
      await pianoGenieModel.initialize()
    } catch (err) {
      console.warn('[aiLab] getPianoGenie initialize failed, clearing instance:', err)
      pianoGenieModel = null
      throw err
    }
  }
  return pianoGenieModel
}

export async function getTranscriptionModel(): Promise<OnsetsAndFrames> {
  if (!transcriptionModel) {
    transcriptionModel = new OnsetsAndFrames('/ai_models/magenta/transcription/onsets_frames_uni')
    try {
      useStore.getState().showToast('Loading Audio Transcription AI...', 'info')
      await transcriptionModel.initialize()
    } catch (err) {
      console.warn('[aiLab] getTranscriptionModel initialize failed, clearing instance:', err)
      transcriptionModel = null
      throw err
    }
  }
  return transcriptionModel
}

export async function generateAiMelody(
  seedNotes: Note[], 
  steps: number = 32, 
  temperature: number = 1.0, 
  density: number = 1.0,
  octaveShift: number = 0,
  scale?: ScaleLock,
  playheadPosition?: number,
  customSeedPitch?: number | 'auto'
): Promise<Omit<Note, 'id' | 'trackId'>[]> {
  const currentScale = scale || useStore.getState().scaleLock

  try {
    const model = await getMelodyRnn()

    let effectiveSeed = seedNotes
    if (effectiveSeed.length === 0) {
      let rootPitch = 60 // Middle C
      if (customSeedPitch && customSeedPitch !== 'auto') {
        rootPitch = customSeedPitch
      } else if (currentScale.enabled) {
        rootPitch = (currentScale.root || 0) + 60
      }
      // Clamp to MelodyConverter basic_rnn valid pitch range [48, 83]
      rootPitch = Math.max(48, Math.min(83, rootPitch))
      effectiveSeed = [{
        id: 'seed',
        trackId: 'none',
        time: (playheadPosition ?? 0) - 48,
        duration: 48,
        pitch: rootPitch,
        velocity: 80
      }]
    }

    const startTime = Math.min(...effectiveSeed.map(n => n.time))
    const qNotes = effectiveSeed.map(n => ({
      pitch: Math.max(48, Math.min(83, n.pitch)),
      quantizedStartStep: Math.round((n.time - startTime) / 48),
      quantizedEndStep: Math.round((n.time - startTime + n.duration) / 48)
    }))

    const maxEndStep = Math.max(...qNotes.map(n => n.quantizedEndStep), 1)
    const targetEndStep = playheadPosition !== undefined ? Math.round((playheadPosition - startTime) / 48) : maxEndStep
    const finalEndStep = Math.max(maxEndStep, targetEndStep, 1)

    const seedSeq = {
      notes: qNotes,
      totalQuantizedSteps: finalEndStep,
      quantizationInfo: { stepsPerQuarter: 4 }
    }

    const result = await model.continueSequence(seedSeq, steps, temperature)

    if (result && result.notes && result.notes.length > 0) {
      return result.notes
        .filter(() => Math.random() < density)
        .map((n) => {
          let pitch = (n.pitch || 60) + (octaveShift * 12)
          if (currentScale.enabled) {
            pitch = snapToScale(pitch, currentScale.root, currentScale.mode, currentScale.customIntervals)
          }

          return {
            time: Math.max(0, startTime + ((n.quantizedStartStep || 0) * 48)),
            duration: Math.max(24, ((n.quantizedEndStep || 0) - (n.quantizedStartStep || 0)) * 48),
            pitch: Math.max(0, Math.min(95, pitch)),
            velocity: Math.floor(Math.min(127, Math.max(40, 80 + Math.random() * 30)))
          }
        })
    }
  } catch (err) {
    console.warn('[aiLab] MusicRNN melody generation encountered error; using procedural scale synthesis:', err)
  }

  // Musical procedural fallback strictly adhering to scale lock and mood
  const fallbackNotes: Omit<Note, 'id' | 'trackId'>[] = []
  const startTick = playheadPosition ?? 0
  const stepTicks = 48
  const intervals = [0, 2, 4, 7, 9, 12, 14, 16] // pentatonic/modal anchors

  for (let s = 0; s < steps; s++) {
    if (Math.random() > density) continue
    const iv = intervals[Math.floor(Math.random() * intervals.length)]
    let pitch = 60 + (currentScale.root || 0) + iv + (octaveShift * 12)
    // Add contour based on temperature
    if (Math.random() < temperature * 0.45) {
      pitch += Math.random() > 0.5 ? 2 : -2
    }
    if (currentScale.enabled) {
      pitch = snapToScale(pitch, currentScale.root, currentScale.mode, currentScale.customIntervals)
    }
    const noteDuration = Math.random() > 0.65 ? 96 : 48
    fallbackNotes.push({
      time: startTick + (s * stepTicks),
      duration: noteDuration,
      pitch: Math.max(24, Math.min(90, pitch)),
      velocity: Math.floor(75 + Math.random() * 35)
    })
  }
  return fallbackNotes
}

export async function generateAiDrums(
  seedNotes: Note[], 
  steps: number = 32, 
  temperature: number = 1.0,
  density: number = 1.0,
  drumMap?: Record<number, number>,
  playheadPosition?: number,
  customSeedPitch?: number | 'auto'
): Promise<Omit<Note, 'id' | 'trackId'>[]> {
  try {
    const model = await getDrumsRnn()

    let effectiveSeed = seedNotes
    if (effectiveSeed.length === 0) {
      effectiveSeed = [{
        id: 'seed',
        trackId: 'none',
        time: (playheadPosition ?? 0) - 48,
        duration: 48,
        pitch: customSeedPitch && customSeedPitch !== 'auto' ? customSeedPitch : 0, // row 0 is Kick (mapped as 0 + 36 = 36)
        velocity: 100
      }]
    }

    const startTime = Math.min(...effectiveSeed.map(n => n.time))
    const qNotes = effectiveSeed.map(n => ({
      pitch: n.pitch + 36,
      quantizedStartStep: Math.round((n.time - startTime) / 48),
      quantizedEndStep: Math.round((n.time - startTime + n.duration) / 48)
    }))

    const maxEndStep = Math.max(...qNotes.map(n => n.quantizedEndStep), 1)
    const targetEndStep = playheadPosition !== undefined ? Math.round((playheadPosition - startTime) / 48) : maxEndStep
    const finalEndStep = Math.max(maxEndStep, targetEndStep, 1)

    const seedSeq = {
      notes: qNotes,
      totalQuantizedSteps: finalEndStep,
      quantizationInfo: { stepsPerQuarter: 4 }
    }

    const result = await model.continueSequence(seedSeq, steps, temperature)

    if (result && result.notes && result.notes.length > 0) {
      return result.notes
        .filter(() => Math.random() < density)
        .map((n) => {
          let pitch: number
          const midi = n.pitch || 36
          if (drumMap && drumMap[midi] !== undefined) {
            pitch = drumMap[midi]
          } else {
            if (midi === 36 || midi === 35) pitch = 0
            else if (midi === 38 || midi === 40) pitch = 1
            else if (midi === 42 || midi === 44) pitch = 2
            else if (midi === 46) pitch = 3
            else pitch = 4
          }

          return {
            time: Math.max(0, startTime + ((n.quantizedStartStep || 0) * 48)),
            duration: 48,
            pitch,
            velocity: Math.floor(Math.min(127, Math.max(50, 90 + Math.random() * 30)))
          }
        })
    }
  } catch (err) {
    console.warn('[aiLab] DrumsRNN generation encountered error; using procedural rhythm groove synthesis:', err)
  }

  // Musical procedural groove fallback
  const fallbackDrums: Omit<Note, 'id' | 'trackId'>[] = []
  const startTick = playheadPosition ?? 0
  const stepTicks = 48
  for (let s = 0; s < steps; s++) {
    const stepInBar = s % 16
    // Kick: steps 0, 8 (plus occasional syncopation on 6, 10)
    if (stepInBar === 0 || stepInBar === 8 || (Math.random() < temperature * 0.25 && (stepInBar === 6 || stepInBar === 10))) {
      fallbackDrums.push({ time: startTick + s * stepTicks, duration: 48, pitch: 0, velocity: 110 })
    }
    // Snare / Clap: steps 4, 12
    if (stepInBar === 4 || stepInBar === 12) {
      fallbackDrums.push({ time: startTick + s * stepTicks, duration: 48, pitch: 1, velocity: 105 })
    }
    // Hi-Hat: 8th notes and extra 16ths based on density
    if (stepInBar % 2 === 0 || Math.random() < density * 0.7) {
      fallbackDrums.push({ time: startTick + s * stepTicks, duration: 48, pitch: 2, velocity: 85 + (stepInBar % 4 === 0 ? 15 : 0) })
    }
    // Open hat or percussion on step 14
    if (stepInBar === 14 && Math.random() < density * 0.6) {
      fallbackDrums.push({ time: startTick + s * stepTicks, duration: 48, pitch: 3, velocity: 90 })
    }
  }
  return fallbackDrums
}

export async function generateBeatMorph(
  patternA: Note[],
  patternB: Note[],
  numInterps: number = 3
): Promise<Note[][]> {
  const model = await getBeatMorphVae()

  const formatPattern = (notes: Note[]) => {
    const qNotes = notes.map(n => ({
      pitch: n.pitch + 36, // VAE also uses midi GM standard for drums
      quantizedStartStep: Math.round(n.time / 48),
      quantizedEndStep: Math.round((n.time + n.duration) / 48)
    }))
    return {
      notes: qNotes,
      totalQuantizedSteps: 32, // 2 bars of 16th notes
      quantizationInfo: { stepsPerQuarter: 4 }
    }
  }

  const seqA = formatPattern(patternA)
  const seqB = formatPattern(patternB)

  // interpolate returns an array of INoteSequence, length = numInterps
  const results = await model.interpolate([seqA, seqB], numInterps)
  if (!results) return []

  return results.map((seq: INoteSequence) => {
    if (!seq.notes) return []
    return seq.notes.map((n) => {
      let pitch: number
      const midi = n.pitch || 36
      if (midi === 36 || midi === 35) pitch = 0 
      else if (midi === 38 || midi === 40) pitch = 1 
      else if (midi === 42 || midi === 44) pitch = 2 
      else if (midi === 46) pitch = 3 
      else pitch = 4 

      return {
        id: Math.random().toString(36).substr(2, 9),
        trackId: '',
        time: (n.quantizedStartStep || 0) * 48,
        duration: 48,
        pitch,
        velocity: 90 + Math.random() * 30
      } as Note
    })
  })
}

export async function generateAutoHarmony(
  seedNotes: Note[],
  temperature: number = 0.99
): Promise<{ voice1: Note[], voice2: Note[], voice3: Note[] }> {
  const model = await getCoconet()

  // Find boundaries of the seed sequence
  if (seedNotes.length === 0) return { voice1: [], voice2: [], voice3: [] }

  const startTime = Math.min(...seedNotes.map(n => n.time))
  const endTime = Math.max(...seedNotes.map(n => n.time + n.duration))
  
  // Snap to 16th notes
  const rawSteps = Math.ceil((endTime - startTime) / 48)
  // Coconet requires sequence length to be a multiple of 32 steps (2 bars)
  const paddedSteps = Math.max(32, Math.ceil(rawSteps / 32) * 32)

  const qNotes = seedNotes.map(n => ({
    pitch: n.pitch, 
    quantizedStartStep: Math.round((n.time - startTime) / 48),
    quantizedEndStep: Math.round((n.time - startTime + n.duration) / 48)
  }))

  const seedSeq = {
    notes: qNotes,
    totalQuantizedSteps: paddedSteps,
    quantizationInfo: { stepsPerQuarter: 4 }
  }

  // Generate missing voices using Coconet infill
  // Coconet assumes 4 voices for Bach. If we provide voice 0 (Soprano), it generates 1, 2, 3 (Alto, Tenor, Bass).
  const result = await model.infill(seedSeq, {
    temperature
  })

  const generatedNotes = result.notes || []

  // Coconet outputs voices 0,1,2,3 as instrument keys.
  const allVoices = [0, 1, 2, 3]
  
  const voices = allVoices.map(v => 
    generatedNotes
      .filter((n) => n.instrument === v)
      .map((n) => ({
        id: Math.random().toString(36).substr(2, 9),
        trackId: '',
        time: startTime + ((n.quantizedStartStep || 0) * 48),
        duration: ((n.quantizedEndStep || 0) - (n.quantizedStartStep || 0)) * 48,
        pitch: Math.max(0, Math.min(95, n.pitch || 60)),
        velocity: 80 + Math.random() * 20
      } as Note))
  )

  return {
    voice1: voices[1] || [],
    voice2: voices[2] || [],
    voice3: voices[3] || []
  }
}

export async function generateHumanGroove(
  seedNotes: Note[],
  temperature: number = 0.5,
  bpm: number = 120
): Promise<Note[]> {
  const model = await getGrooveVae()

  if (seedNotes.length === 0) return []

  const startTime = Math.min(...seedNotes.map(n => n.time))
  
  // Format to Magenta INoteSequence (quantized to 16th notes)
  const qNotes = seedNotes.map(n => ({
    pitch: n.pitch + 36, // General MIDI drum mapping
    quantizedStartStep: Math.round((n.time - startTime) / 48),
    quantizedEndStep: Math.round((n.time - startTime + n.duration) / 48),
    isDrum: true,
    velocity: 80 // Base velocity before humanization
  }))

  const seedSeq = {
    notes: qNotes,
    totalQuantizedSteps: 32, // 2 bars
    quantizationInfo: { stepsPerQuarter: 4 },
    tempos: [{ time: 0, qpm: bpm }]
  }

  // To humanize, we use the `similar` method which generates sequences that are semantically similar in the latent space
  // We use a high similarity score (0.9 to 1.0) and moderate temperature so it mostly just varies velocity/micro-timing
  // Wait, if we use similarity=1.0 with a groove model, it will reconstruct the sequence with humanized unquantized timing.
  // Actually, let's use encode -> decode for reconstruction humanization.
  const z = await model.encode([seedSeq])
  const decoded = await model.decode(z, temperature, undefined, 4, bpm)
  
  if (!decoded || decoded.length === 0 || !decoded[0].notes) return seedNotes

  // The decoded sequence has unquantized timing (startTime, endTime in seconds) or quantized steps with micro-timing.
  // MusicVAE groove models usually output unquantized start/end times based on the qpm.
  const resultSeq = decoded[0]
  
  return resultSeq.notes!.map((n) => {
    let pitch: number
    const midi = n.pitch || 36
    if (midi === 36 || midi === 35) pitch = 0 
    else if (midi === 38 || midi === 40) pitch = 1 
    else if (midi === 42 || midi === 44) pitch = 2 
    else if (midi === 46) pitch = 3 
    else pitch = 4 

    // If it outputs unquantized time in seconds, we convert to ticks
    // 1 beat = 60/bpm seconds = 192 ticks
    // 1 second = 192 * (bpm/60) ticks
    const ticksPerSecond = 192 * (bpm / 60)
    
    // Some models might just output quantized steps anyway, let's fallback:
    const timeTicks = n.startTime != null ? n.startTime * ticksPerSecond : (n.quantizedStartStep || 0) * 48
    const durationTicks = n.endTime != null ? (n.endTime - (n.startTime || 0)) * ticksPerSecond : 48

    return {
      id: Math.random().toString(36).substr(2, 9),
      trackId: '',
      time: startTime + Math.round(timeTicks),
      duration: Math.round(durationTicks),
      pitch,
      velocity: Math.max(1, Math.min(127, n.velocity || (80 + Math.random() * 30)))
    } as Note
  })
}

export async function resetPianoGenie() {
  const model = await getPianoGenie()
  model.resetState()
}

export async function generatePianoGenieNote(
  button: number, // 0 to 7
  temperature: number = 0.5
): Promise<number> {
  const model = await getPianoGenie()
  // Ensure button is between 0 and 7
  const validButton = Math.max(0, Math.min(7, button))
  const pitch = model.next(validButton, temperature)
  return pitch
}

export async function transcribeAudio(audioBuffer: AudioBuffer, bpm: number): Promise<Note[]> {
  const model = await getTranscriptionModel()
  const sequence = await model.transcribeFromAudioBuffer(audioBuffer)
  if (!sequence || !sequence.notes) return []

  const ticksPerSecond = 192 * (bpm / 60)
  
  return sequence.notes.map((n) => {
    return {
      id: Math.random().toString(36).substr(2, 9),
      trackId: '',
      time: Math.round((n.startTime || 0) * ticksPerSecond),
      duration: Math.max(48, Math.round(((n.endTime || 0) - (n.startTime || 0)) * ticksPerSecond)),
      pitch: n.pitch || 60,
      velocity: n.velocity || 80
    } as Note
  })
}
