import { audioBufferToWav } from './wavEncoder'

export interface ChromaticSamplePreset {
  id: string
  name: string
  category: 'piano' | 'keys' | 'bass' | 'lead' | 'vocal'
  description: string
  rootNote: number // MIDI key number (60 = C4)
  durationSec: number
  generate: (ctx: BaseAudioContext) => AudioBuffer
}

function createBuffer(ctx: BaseAudioContext, durationSec: number): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100
  const length = Math.floor(sampleRate * durationSec)
  return ctx.createBuffer(2, length, sampleRate)
}

function softClip(x: number): number {
  return Math.tanh(x)
}

export const CHROMATIC_SAMPLE_PRESETS: ChromaticSamplePreset[] = [
  {
    id: 'warm_grand_piano',
    name: 'Warm Grand Piano',
    category: 'piano',
    description: 'Acoustic grand piano C4 strike with natural hammer transient, rich wood inharmonicity, and warm body resonance.',
    rootNote: 60, // C4
    durationSec: 2.8,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 2.8)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length
      const baseFreq = 261.63 // C4

      // Realistic acoustic piano partials with slight inharmonicity (B = 0.0004)
      const B = 0.0004
      const partials = [
        { n: 1, amp: 1.0, decayRate: 1.2 },
        { n: 2, amp: 0.65, decayRate: 1.8 },
        { n: 3, amp: 0.42, decayRate: 2.5 },
        { n: 4, amp: 0.28, decayRate: 3.2 },
        { n: 5, amp: 0.18, decayRate: 4.0 },
        { n: 6, amp: 0.12, decayRate: 4.8 },
        { n: 7, amp: 0.08, decayRate: 5.8 },
        { n: 8, amp: 0.05, decayRate: 6.8 }
      ]

      for (let i = 0; i < len; i++) {
        const t = i / sr
        let sampleL = 0
        let sampleR = 0

        // Hammer strike click transient (first 8ms)
        let hammer = 0
        if (t < 0.012) {
          const hammerEnv = Math.exp(-t * 400)
          const hammerNoise = (Math.random() * 2 - 1) * 0.35
          hammer = (hammerNoise + Math.sin(2 * Math.PI * 450 * t)) * hammerEnv
        }

        // Partials with subtle stereo spread and natural beatings
        for (const p of partials) {
          const freq = p.n * baseFreq * Math.sqrt(1 + B * p.n * p.n)
          const env = Math.exp(-t * p.decayRate)
          const detuneL = 1.0 - (p.n * 0.0003)
          const detuneR = 1.0 + (p.n * 0.0003)
          sampleL += Math.sin(2 * Math.PI * freq * detuneL * t) * p.amp * env
          sampleR += Math.sin(2 * Math.PI * freq * detuneR * t) * p.amp * env
        }

        const attack = Math.min(1, t / 0.004)
        const finalL = softClip((sampleL * attack * 0.55 + hammer * 0.45) * 1.1)
        const finalR = softClip((sampleR * attack * 0.55 + hammer * 0.45) * 1.1)
        left[i] = finalL
        right[i] = finalR
      }
      return buf
    }
  },
  {
    id: 'rhodes_vintage_keys',
    name: 'Rhodes Vintage EP',
    category: 'keys',
    description: 'Smooth vintage electric piano tine C4 with warm fundamental, bell overtones, and analog vibrato.',
    rootNote: 60, // C4
    durationSec: 2.5,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 2.5)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length
      const f0 = 261.63 // C4

      for (let i = 0; i < len; i++) {
        const t = i / sr
        const attack = Math.min(1, t / 0.003)
        // Subtle 5.2Hz stereo tremolo
        const tremL = 1 + 0.12 * Math.sin(2 * Math.PI * 5.2 * t)
        const tremR = 1 + 0.12 * Math.sin(2 * Math.PI * 5.2 * t + Math.PI * 0.5)

        // Fundamental + 2nd + high tine bell overtone (n=7.4)
        const fundamental = Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t * 1.1)
        const second = Math.sin(2 * Math.PI * f0 * 2 * t) * 0.35 * Math.exp(-t * 1.8)
        const tine = Math.sin(2 * Math.PI * f0 * 6.8 * t) * 0.45 * Math.exp(-t * 5.5)

        const s = (fundamental + second + tine) * attack
        left[i] = softClip(s * tremL * 0.7)
        right[i] = softClip(s * tremR * 0.7)
      }
      return buf
    }
  },
  {
    id: 'analog_808_sub_bass',
    name: 'Analog 808 Sub Bass',
    category: 'bass',
    description: 'Deep, round C3 sub bass with warm 2nd harmonic saturation and pitch plunge.',
    rootNote: 48, // C3
    durationSec: 2.0,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 2.0)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length
      const targetF = 130.81 // C3

      let phase = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        // Initial transient pitch punch
        const freq = targetF + 140 * Math.exp(-t * 32)
        phase += (2 * Math.PI * freq) / sr
        const attack = Math.min(1, t / 0.005)
        const env = Math.exp(-t * 1.6)

        const raw = Math.sin(phase) + 0.25 * Math.sin(phase * 2) + 0.08 * Math.sin(phase * 3)
        const sample = softClip(raw * attack * env * 1.25) * 0.8
        left[i] = sample
        right[i] = sample
      }
      return buf
    }
  },
  {
    id: 'vintage_juno_pluck',
    name: 'Vintage Juno Pluck',
    category: 'lead',
    description: 'Brite resonant analog synth pluck with snappy filter sweep.',
    rootNote: 60, // C4
    durationSec: 1.6,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 1.6)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length
      const f0 = 261.63

      for (let i = 0; i < len; i++) {
        const t = i / sr
        const attack = Math.min(1, t / 0.002)
        const env = Math.exp(-t * 2.8)
        // Additive approximation of filtered sawtooth with resonant cutoff sweep
        const sweep = Math.exp(-t * 8.0)
        let sL = 0
        let sR = 0
        for (let h = 1; h <= 14; h++) {
          const cut = Math.exp(-(h / (3 + 10 * sweep)))
          const amp = (1 / h) * cut
          sL += Math.sin(2 * Math.PI * f0 * h * 0.999 * t) * amp
          sR += Math.sin(2 * Math.PI * f0 * h * 1.001 * t) * amp
        }
        left[i] = softClip(sL * attack * env * 1.4) * 0.75
        right[i] = softClip(sR * attack * env * 1.4) * 0.75
      }
      return buf
    }
  },
  {
    id: 'lofi_vocal_ah',
    name: 'Lofi Vocal "Ah"',
    category: 'vocal',
    description: 'Human vocal "Ah" formant vowel sample with subtle vibrato and breath.',
    rootNote: 60, // C4
    durationSec: 2.2,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 2.2)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length
      const f0 = 261.63

      for (let i = 0; i < len; i++) {
        const t = i / sr
        const attack = Math.min(1, t / 0.04)
        const env = Math.exp(-t * 0.95)
        // 5.5Hz vocal vibrato onset
        const vib = Math.min(1, t / 0.25) * 0.015 * Math.sin(2 * Math.PI * 5.5 * t)
        const pitch = f0 * (1 + vib)

        // Formant peaks for vowel "Ah": F1 ~ 800Hz, F2 ~ 1200Hz, F3 ~ 2800Hz
        let voiceL = 0
        let voiceR = 0
        for (let h = 1; h <= 18; h++) {
          const hFreq = pitch * h
          // Formant weighting
          const w1 = Math.exp(-Math.pow((hFreq - 800) / 180, 2)) * 1.2
          const w2 = Math.exp(-Math.pow((hFreq - 1200) / 220, 2)) * 0.8
          const w3 = Math.exp(-Math.pow((hFreq - 2800) / 350, 2)) * 0.35
          const weight = (1 / Math.sqrt(h)) * (w1 + w2 + w3 + 0.05)

          voiceL += Math.sin(2 * Math.PI * hFreq * t) * weight
          voiceR += Math.sin(2 * Math.PI * hFreq * t + 0.15) * weight
        }

        const breath = (Math.random() * 2 - 1) * 0.04 * Math.exp(-t * 1.2)
        left[i] = softClip((voiceL * attack * env + breath) * 0.85)
        right[i] = softClip((voiceR * attack * env + breath) * 0.85)
      }
      return buf
    }
  }
]

/**
 * Converts an AudioBuffer into a Data URL (base64) for persistence in the track store.
 */
export async function bufferToDataUri(buffer: AudioBuffer): Promise<string> {
  const blob = audioBufferToWav(buffer)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('FileReader failed to produce string'))
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
