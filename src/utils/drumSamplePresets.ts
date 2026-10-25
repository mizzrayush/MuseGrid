import { audioBufferToWav } from './wavEncoder'

export interface DrumSamplePreset {
  id: string
  name: string
  category: 'kick' | 'snare' | 'hihat' | 'clap' | 'percussion' | 'cymbal'
  description: string
  durationSec: number
  generate: (ctx: BaseAudioContext) => AudioBuffer
}

/**
 * Procedural studio one-shot audio synthesizer producing clean 44.1kHz AudioBuffers.
 */
function createBuffer(ctx: BaseAudioContext, durationSec: number): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100
  const length = Math.floor(sampleRate * durationSec)
  return ctx.createBuffer(2, length, sampleRate)
}

function softClip(x: number): number {
  return Math.tanh(x)
}

export const DRUM_SAMPLE_PRESETS: DrumSamplePreset[] = [
  {
    id: '808_sub_punch',
    name: '808 Sub Bomb',
    category: 'kick',
    description: 'Deep booming 808 sub kick with warm pitch dive and soft saturation',
    durationSec: 0.85,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 0.85)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      let phase = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        // Pitch drop from 120Hz down to 38Hz
        const freq = 38 + 82 * Math.exp(-t * 22)
        phase += (2 * Math.PI * freq) / sr
        // Envelope: fast 2ms attack, exponential body
        const attack = Math.min(1, t / 0.003)
        const decay = Math.exp(-t * 3.8)
        const raw = Math.sin(phase) * 1.35 + Math.sin(phase * 2) * 0.15
        const sample = softClip(raw * attack * decay * 1.1)
        left[i] = sample
        right[i] = sample
      }
      return buf
    }
  },
  {
    id: 'acoustic_punch_kick',
    name: 'Studio Punch Kick',
    category: 'kick',
    description: 'Tight, acoustic studio bass drum with beater click transient',
    durationSec: 0.38,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 0.38)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      let phase = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        const freq = 48 + 180 * Math.exp(-t * 38)
        phase += (2 * Math.PI * freq) / sr
        const click = (Math.random() * 2 - 1) * Math.exp(-t * 120) * 0.4
        const attack = Math.min(1, t / 0.002)
        const decay = Math.exp(-t * 9.5)
        const sample = softClip((Math.sin(phase) + click) * attack * decay * 1.2)
        left[i] = sample
        right[i] = sample
      }
      return buf
    }
  },
  {
    id: 'trap_snare_crisp',
    name: 'Crisp Studio Snare',
    category: 'snare',
    description: 'Punchy dual-tone shell with snappy high-frequency wire rattle',
    durationSec: 0.32,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 0.32)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      let tonePhase1 = 0
      let tonePhase2 = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        tonePhase1 += (2 * Math.PI * 185) / sr
        tonePhase2 += (2 * Math.PI * 330) / sr
        const toneEnv = Math.exp(-t * 22)
        const tone = (Math.sin(tonePhase1) * 0.6 + Math.sin(tonePhase2) * 0.4) * toneEnv

        // White noise rattle
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 11) * 0.85
        const snap = (Math.random() * 2 - 1) * Math.exp(-t * 70) * 0.5
        const attack = Math.min(1, t / 0.001)

        const s = softClip((tone * 0.7 + noise + snap) * attack * 1.1)
        left[i] = s
        right[i] = s
      }
      return buf
    }
  },
  {
    id: 'hand_clap_909',
    name: 'Analog Hand Clap',
    category: 'clap',
    description: 'Triple micro-burst pre-clap transient into dense filtered stereo clap body',
    durationSec: 0.35,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 0.35)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      for (let i = 0; i < len; i++) {
        const t = i / sr
        let burst = 0
        // Pre-claps at 0ms, 11ms, 22ms
        if (t < 0.010) burst += Math.exp(-t * 300) * 0.75
        else if (t < 0.021) burst += Math.exp(-(t - 0.011) * 300) * 0.85
        else if (t < 0.033) burst += Math.exp(-(t - 0.022) * 300) * 0.95
        // Main body after 30ms
        const mainDecay = Math.max(0, t - 0.03)
        const body = Math.exp(-mainDecay * 14) * 1.1

        const nL = Math.random() * 2 - 1
        const nR = Math.random() * 2 - 1
        const sL = softClip(nL * (burst + body) * 0.9)
        const sR = softClip(nR * (burst + body) * 0.9)
        left[i] = sL
        right[i] = sR
      }
      return buf
    }
  },
  {
    id: 'closed_hat_tight',
    name: 'Tight Closed Hat',
    category: 'hihat',
    description: 'Ultra-crisp, tight metallic closed hi-hat with high-frequency bite',
    durationSec: 0.12,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 0.12)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      let p1 = 0, p2 = 0, p3 = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        p1 += (2 * Math.PI * 4200) / sr
        p2 += (2 * Math.PI * 6700) / sr
        p3 += (2 * Math.PI * 8900) / sr
        const metalRing = (Math.sin(p1) + Math.sin(p2) + Math.sin(p3)) * 0.25
        const noise = (Math.random() * 2 - 1) * 0.75
        const decay = Math.exp(-t * 42)
        const s = (noise + metalRing) * decay * 1.1
        left[i] = s
        right[i] = s
      }
      return buf
    }
  },
  {
    id: 'open_hat_sizzle',
    name: 'Sizzling Open Hat',
    category: 'hihat',
    description: 'Bright shimmering open hi-hat wash with smooth acoustic ring',
    durationSec: 0.65,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 0.65)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      let p1 = 0, p2 = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        p1 += (2 * Math.PI * 5200) / sr
        p2 += (2 * Math.PI * 7800) / sr
        const metal = (Math.sin(p1) + Math.sin(p2) * 0.6) * 0.3
        const noiseL = Math.random() * 2 - 1
        const noiseR = Math.random() * 2 - 1
        const decay = Math.exp(-t * 6.5)
        left[i] = (noiseL * 0.7 + metal) * decay * 0.95
        right[i] = (noiseR * 0.7 + metal) * decay * 0.95
      }
      return buf
    }
  },
  {
    id: 'percussion_low_conga',
    name: 'Resonant Low Conga',
    category: 'percussion',
    description: 'Warm ethnic conga slap with resonant wooden membrane ring',
    durationSec: 0.45,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 0.45)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      let phase = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        const freq = 110 + 65 * Math.exp(-t * 30)
        phase += (2 * Math.PI * freq) / sr
        const attack = Math.min(1, t / 0.002)
        const decay = Math.exp(-t * 7.5)
        const click = (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.35
        const s = softClip((Math.sin(phase) * 1.1 + click) * attack * decay)
        left[i] = s
        right[i] = s
      }
      return buf
    }
  },
  {
    id: 'percussion_rimshot',
    name: 'Hard Rimshot',
    category: 'percussion',
    description: 'Crisp wooden rim strike transient with metallic ring',
    durationSec: 0.16,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 0.16)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      let pRing = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        pRing += (2 * Math.PI * 1750) / sr
        const click = (Math.random() * 2 - 1) * Math.exp(-t * 80)
        const ring = Math.sin(pRing) * Math.exp(-t * 35) * 0.6
        const s = softClip((click + ring) * 1.2)
        left[i] = s
        right[i] = s
      }
      return buf
    }
  },
  {
    id: 'crash_splash_cymbal',
    name: 'Splash Cymbal',
    category: 'cymbal',
    description: 'Fast acoustic splash cymbal with airy shimmer and stereo spread',
    durationSec: 1.4,
    generate: (ctx) => {
      const buf = createBuffer(ctx, 1.4)
      const sr = buf.sampleRate
      const left = buf.getChannelData(0)
      const right = buf.getChannelData(1)
      const len = buf.length

      for (let i = 0; i < len; i++) {
        const t = i / sr
        const nL = Math.random() * 2 - 1
        const nR = Math.random() * 2 - 1
        const decay = Math.exp(-t * 2.8)
        left[i] = nL * decay * 0.75
        right[i] = nR * decay * 0.75
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
