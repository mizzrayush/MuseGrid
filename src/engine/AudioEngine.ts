import * as Tone from 'tone'
import { useStore } from './store'
import type { Track, MetronomeSettings, VoicePreset, DrumPadSample, SynthSamplerConfig, InstrumentOverride } from './store'
import { DEFAULT_DRUM_KIT, DEFAULT_SYNTH_PRESET, type DrumKit, type SynthPreset } from '../utils/instruments'
import { getLaneValueAtTick } from '../utils/automation'
import { calculateFourierPartials } from '../utils/mathWaveform'
import { getTrackFxInstances, getTrackFxSetting as readTrackFxSetting } from './fxDefaults'
import { getEffectiveTrackLevel } from '../utils/groupAudio'
import { buildNativeNoteOnCommand } from './nativeNoteCommand'
import { buildNoteFxChain } from '../utils/noteFxChain'
import { buildCurveLut, evaluateGlideCurve } from '../utils/glideCurves'
import { createTrackChannel, setTrackChannelPan } from '../utils/toneChannel'

interface TrackRack {
  input: Tone.Gain
  channel: Tone.Channel
  fxNodes: Map<string, Tone.ToneAudioNode>
  activeFxOrder?: string[]
  currentDestination?: string
}

function extractNativeGain(toneGain: Tone.Gain): GainNode | null {
  try {
    const sacNode = (toneGain as any).input || (toneGain as any)._gainNode
    if (!sacNode) return null
    const native = sacNode._nativeGainNode || sacNode._nativeAudioNode
    if (native && typeof native.connect === 'function') return native
  } catch (_) { }
  return null
}

export class CustomScriptProcessorNode extends Tone.ToneAudioNode {
  readonly name = "CustomScriptProcessorNode"
  input: Tone.Gain
  output: Tone.Gain
  private _workletNode: AudioWorkletNode | null = null
  private _error: string | null = null
  private _params: Record<string, number> = {}
  private _hostContext: Record<string, unknown> = {}
  private _lastCode: string | null = null
  private _lastLoggedError: string | null = null
  private _compilePromise: Promise<void> | null = null

  constructor() {
    super()
    this.input = new Tone.Gain()
    this.output = new Tone.Gain()
    this.input.connect(this.output)
  }

  setParams(v: Record<string, number>) {
    this._params = { ...v }
    if (this._workletNode) {
      this._workletNode.port.postMessage({ type: 'params', params: this._params })
    }
  }

  setHostContext(v: Record<string, unknown>) {
    this._hostContext = { ...v }
    if (this._workletNode) {
      this._workletNode.port.postMessage({ type: 'host', host: this._hostContext })
    }
  }

  async compileCode(code: string): Promise<void> {
    if (this._lastCode === code) return

    this._compilePromise = (async () => {
      try {
        // 1. Basic syntax check in main thread
        new Function('input', 'output', 'params', 'state', 'sampleRate', 'currentTime', 'context', code)

        // 2. Generate a unique processor registration name
        const processorName = `dynamic-dsp-${Math.random().toString(36).slice(2, 11)}`

        // 3. Construct the AudioWorkletProcessor source code
        const workletScript = `
class DynamicDSPProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = {};
    this.host = {};
    this.state = {};
    this.port.onmessage = (e) => {
      if (e.data.type === 'params') {
        this.params = e.data.params;
      }
      if (e.data.type === 'host') {
        this.host = e.data.host || {};
      }
    };
  }

  dspFn(input, output, params, state, sampleRate, currentTime, context) {
    ${code}
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;
    
    const inL = input[0] || new Float32Array(128);
    const inR = input[1] || new Float32Array(128);
    const outL = output[0];
    const outR = output[1];
    
    if (!outL || !outR) return true;

    try {
      this.dspFn([inL, inR], [outL, outR], this.params, this.state, sampleRate, currentTime, {
        ...this.host,
        sampleRate,
        currentTime,
        blockSize: outL.length,
        channelCount: output.length
      });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
    return true;
  }
}

registerProcessor('${processorName}', DynamicDSPProcessor);
`

        // 4. Register the module on the native AudioContext
        const raw = Tone.context.rawContext as any
        const nativeCtx = raw._nativeAudioContext || raw
        if (!nativeCtx) {
          throw new Error('Native AudioContext not found')
        }

        const blob = new Blob([workletScript], { type: 'application/javascript' })
        const url = URL.createObjectURL(blob)
        await nativeCtx.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)

        // 5. Instantiate the AudioWorkletNode
        const workletNode = new AudioWorkletNode(nativeCtx, processorName)

        // 6. Setup communication
        workletNode.port.onmessage = (e) => {
          if (e.data.type === 'error') {
            this._error = e.data.message
            if (this._error !== this._lastLoggedError) {
              console.error('[CustomFX Runtime Error]:', this._error)
              this._lastLoggedError = this._error
            }
          }
        }

        // Push initial parameters
        workletNode.port.postMessage({ type: 'params', params: this._params })
        workletNode.port.postMessage({ type: 'host', host: this._hostContext })

        // 7. Wire into the native gain nodes
        const nativeIn = extractNativeGain(this.input)
        const nativeOut = extractNativeGain(this.output)

        if (nativeIn && nativeOut) {
          // Disconnect old worklet node if it exists
          if (this._workletNode) {
            try { this._workletNode.disconnect() } catch (_) { }
          }

          try { nativeIn.disconnect() } catch (_) { }
          nativeIn.connect(workletNode)
          workletNode.connect(nativeOut)

          this._workletNode = workletNode
          this._error = null
          this._lastCode = code
          this._lastLoggedError = null
          console.log('[CustomFX] AudioWorkletNode compiled and connected')
        } else {
          throw new Error('Could not extract native GainNodes')
        }
      } catch (err: any) {
        this._error = err.message || String(err)
        console.error('[CustomFX Compilation Error]:', this._error)

        // Rollback to bypass
        const nativeIn = extractNativeGain(this.input)
        const nativeOut = extractNativeGain(this.output)
        if (nativeIn && nativeOut) {
          try { nativeIn.disconnect() } catch (_) { }
          try { nativeIn.connect(nativeOut) } catch (_) { }
        }
        this._lastCode = code
      }
    })()

    return this._compilePromise
  }

  getError() { return this._error }

  reconnectBridge() {
    const nativeIn = extractNativeGain(this.input)
    const nativeOut = extractNativeGain(this.output)
    if (!nativeIn || !nativeOut) return

    try { nativeIn.disconnect() } catch (_) { }

    if (this._workletNode) {
      try { this._workletNode.disconnect() } catch (_) { }
      try {
        nativeIn.connect(this._workletNode)
        this._workletNode.connect(nativeOut)
      } catch (err) {
        console.warn('[CustomFX] reconnectBridge failed:', err)
      }
    } else {
      try { nativeIn.connect(nativeOut) } catch (_) { }
    }
  }
  dispose() {
    if (this._workletNode) {
      try { this._workletNode.disconnect() } catch (_) { }
      this._workletNode = null
    }
    try { this.input.disconnect() } catch (_) { }
    try { this.output.disconnect() } catch (_) { }
    try { this.input.dispose() } catch (_) { }
    try { this.output.dispose() } catch (_) { }
    super.dispose()
    return this
  }
}

export class DPreverbNode extends Tone.ToneAudioNode {
  readonly name = "DPreverbNode"
  input: Tone.Gain
  output: Tone.Gain

  constructor() {
    super()
    this.input = new Tone.Gain()
    this.output = new Tone.Gain()
    this.input.connect(this.output)
  }

  trigger(durationSeconds: number, time: number, wet: number, decay = 0.65, tone = 0.55) {
    const duration = Math.max(0.015, Math.min(120, durationSeconds))
    const clampedWet = Math.max(0, Math.min(1, wet))
    if (duration <= 0.015 || clampedWet <= 0) return

    const startTime = Math.max(0, time)
    const endTime = startTime + duration
    const shape = Math.max(0.1, Math.min(0.98, decay))
    const peakTime = startTime + Math.max(0.01, duration * shape)
    const clampedTone = Math.max(0, Math.min(1, tone))
    const centerFrequency = 350 + clampedTone * 7200
    const peakGain = Math.max(0.0001, clampedWet * 0.34)

    const noise = new Tone.Noise('pink')
    const filter = new Tone.Filter({
      type: 'bandpass',
      frequency: centerFrequency,
      Q: 0.7 + clampedTone * 3
    })
    const gain = new Tone.Gain(0)

    noise.chain(filter, gain, this.output)
    gain.gain.cancelScheduledValues(startTime)
    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.exponentialRampToValueAtTime(peakGain, peakTime)
    gain.gain.linearRampToValueAtTime(0.0001, endTime)
    gain.gain.setValueAtTime(0, endTime + 0.03)

    noise.start(startTime)
    noise.stop(endTime + 0.05)

    const rawContext = Tone.context.rawContext as BaseAudioContext | undefined
    const isOffline = rawContext?.constructor?.name === 'OfflineAudioContext'
    if (!isOffline && typeof window !== 'undefined') {
      const disposeDelay = Math.max(50, ((endTime - Tone.now()) + 0.2) * 1000)
      window.setTimeout(() => {
        try {
          noise.dispose()
          filter.dispose()
          gain.dispose()
        } catch (_) { }
      }, disposeDelay)
    }
  }

  dispose() {
    try { this.input.disconnect() } catch (_) { }
    try { this.output.disconnect() } catch (_) { }
    try { this.input.dispose() } catch (_) { }
    try { this.output.dispose() } catch (_) { }
    super.dispose()
    return this
  }
}

function createFxNode(type: string): Tone.ToneAudioNode {
  switch (type) {
    case 'eq':
      return new Tone.EQ3()
    case 'filter':
      return new Tone.Filter({ frequency: 20000, type: 'lowpass' })
    case 'distortion':
      return new Tone.Distortion({ distortion: 0.4, wet: 0 })
    case 'chorus':
      return new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0 }).start()
    case 'phaser':
      return new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0 })
    case 'delay':
      return new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.25, wet: 0 })
    case 'dpreverb':
      return new DPreverbNode()
    case 'reverb':
      try {
        return new Tone.Reverb({ decay: 2.5, preDelay: 0.01, wet: 0 })
      } catch (e) {
        console.warn('Failed to create Tone.Reverb, falling back to Freeverb:', e)
        return new Tone.Freeverb({ roomSize: 0.7, dampening: 4000, wet: 0 })
      }
    case 'freeverb':
      return new Tone.Freeverb({ roomSize: 0.7, dampening: 4000, wet: 0 })
    case 'bitcrusher':
    case 'custom-bitcrusher':
      return new Tone.BitCrusher(8)
    default:
      return new CustomScriptProcessorNode()
  }
}

const PITCH_TO_PIECE: Record<number, string> = {
  0: 'kick', 1: 'snare', 2: 'hihatClosed', 3: 'hihatOpen', 4: 'clap',
  5: 'tomLow', 6: 'tomMid', 7: 'tomHigh', 8: 'crash', 9: 'ride',
  10: 'cowbell', 11: 'tambourine', 12: 'congaLow', 13: 'congaHigh', 14: 'claves', 15: 'rimshot'
}

function getDecayDefaultByPitch(pitch: number): number {
  const defaults: Record<number, number> = {
    0: 0.42, 1: 0.14, 2: 0.10, 3: 0.30, 4: 0.20,
    5: 0.40, 6: 0.30, 7: 0.20, 8: 2.00, 9: 3.00,
    10: 0.50, 11: 0.10, 12: 0.30, 13: 0.20, 14: 0.10, 15: 0.05
  }
  return defaults[pitch] ?? 0.40
}

/** Per-hit output trim: volume automation, per-note pan and morph crossfades. */
export interface DrumOutputOptions {
  pan?: number
  gain?: number
  fadeIn?: number
  fadeOut?: number
}

/** One automatable parameter of the track's VST3 instrument (values normalized 0..1). */
export interface Vst3ParameterInfo {
  index: number
  name: string
  label?: string
  value: number
  valueText?: string
  min?: number
  max?: number
  default?: number
  discrete?: boolean
}

const DRUM_PAD_FIELD: Record<number, string> = {
  0: 'kick', 1: 'snare', 2: 'hihatClosed', 3: 'hihatOpen', 4: 'clap',
  5: 'tomLow', 6: 'tomMid', 7: 'tomHigh', 8: 'crash', 9: 'ride',
  10: 'cowbell', 11: 'tambourine', 12: 'congaLow', 13: 'congaHigh', 14: 'claves', 15: 'rimshot'
}

function drumNeedsOutput(opts?: DrumOutputOptions): boolean {
  if (!opts) return false
  return !!opts.pan || (opts.gain !== undefined && Math.abs(opts.gain - 1) > 0.001)
    || (opts.fadeIn ?? 0) > 0 || (opts.fadeOut ?? 0) > 0
}

class DrumMachine {
  kick = new Tone.MembraneSynth()
  snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0 }
  })
  hihatClosed = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5
  })
  hihatOpen = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.3, release: 0.1 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5
  })
  clap = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0 }
  })
  tomLow = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 0.1 } })
  tomMid = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.1 } })
  tomHigh = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.1 } })
  crash = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 2.0, release: 0.5 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 })
  ride = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 3.0, release: 0.5 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 })
  cowbell = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.5, release: 0.1 }, harmonicity: 0.2, modulationIndex: 10, resonance: 800, octaves: 0.5 })
  tambourine = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0 } })
  congaLow = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.1 } })
  congaHigh = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.1 } })
  claves = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 1, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 } })
  rimshot = new Tone.NoiseSynth({ noise: { type: 'brown' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } })
  kit: DrumKit
  customMuxins?: any
  drumDecays?: Record<number, number>
  drumOctaves?: Record<number, number>
  drumResonances?: Record<number, number>
  customSynths: Map<number, any> = new Map()
  lastDestination?: any
  padModes: Record<number, 'synth' | 'sample'> = {}
  padSamples: Record<number, DrumPadSample> = {}
  padAudioBuffers: Map<number, AudioBuffer> = new Map()
  activeChokeVoices: Map<number, { source: AudioBufferSourceNode; gainNode: GainNode }[]> = new Map()
  reversedBufferCache: Map<number, { original: AudioBuffer; reversed: AudioBuffer }> = new Map()

  setPadBuffer(pitch: number, buffer: AudioBuffer) {
    this.padAudioBuffers.set(pitch, buffer)
    this.reversedBufferCache.delete(pitch)
  }

  getReversedBuffer(pitch: number, original: AudioBuffer): AudioBuffer {
    const cached = this.reversedBufferCache.get(pitch)
    if (cached && cached.original === original) {
      return cached.reversed
    }
    const ctx = Tone.getContext().rawContext as AudioContext
    const rev = ctx.createBuffer(original.numberOfChannels, original.length, original.sampleRate)
    for (let ch = 0; ch < original.numberOfChannels; ch++) {
      const srcData = original.getChannelData(ch)
      const dstData = rev.getChannelData(ch)
      for (let i = 0, j = original.length - 1; i < original.length; i++, j--) {
        dstData[i] = srcData[j]
      }
    }
    this.reversedBufferCache.set(pitch, { original, reversed: rev })
    return rev
  }

  triggerSample(
    pitch: number,
    sampleConfig: DrumPadSample | undefined,
    buffer: AudioBuffer,
    _duration: string,
    time?: number,
    velocity = 1,
    pitchOffset = 0,
    outputOpts?: DrumOutputOptions
  ) {
    try {
      const ctx = Tone.getContext().rawContext as AudioContext
      const now = time !== undefined ? time : ctx.currentTime

      const chokeGroup = sampleConfig?.chokeGroup ?? 0
      if (chokeGroup > 0) {
        const activeInGroup = this.activeChokeVoices.get(chokeGroup)
        if (activeInGroup && activeInGroup.length > 0) {
          activeInGroup.forEach(v => {
            try {
              v.gainNode.gain.cancelScheduledValues(now)
              v.gainNode.gain.setValueAtTime(v.gainNode.gain.value, now)
              v.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.005)
              v.source.stop(now + 0.006)
            } catch (_) {}
          })
          this.activeChokeVoices.set(chokeGroup, [])
        }
      }

      const tuningSemitones = (sampleConfig?.tuning ?? 0) + pitchOffset
      const fineTuneCents = sampleConfig?.fineTune ?? 0
      const totalSemitones = tuningSemitones + (fineTuneCents / 100)
      const playbackRate = Math.max(0.05, Math.min(16.0, Math.pow(2, totalSemitones / 12)))

      const source = ctx.createBufferSource()
      if (sampleConfig?.reverse) {
        source.buffer = this.getReversedBuffer(pitch, buffer)
      } else {
        source.buffer = buffer
      }
      source.playbackRate.setValueAtTime(playbackRate, now)

      const gainNode = ctx.createGain()
      const sampleVol = sampleConfig?.volume !== undefined ? sampleConfig.volume : 1.0
      const trim = Math.max(0, Math.min(2, outputOpts?.gain ?? 1))
      const peakGain = Math.max(0.0001, Math.min(2.5, velocity * sampleVol * trim))
      gainNode.gain.setValueAtTime(peakGain, now)

      const bufDuration = buffer.duration / playbackRate
      const decayTime = sampleConfig?.decay ?? this.drumDecays?.[pitch] ?? bufDuration
      const effectiveDuration = Math.min(bufDuration, decayTime)

      if (effectiveDuration < bufDuration) {
        const rampStart = now + Math.max(0.005, effectiveDuration * 0.75)
        const rampEnd = now + effectiveDuration
        gainNode.gain.setValueAtTime(peakGain, rampStart)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, rampEnd)
      }

      let outputNode: AudioNode = gainNode
      const chainNodes: AudioNode[] = []
      const panVal = Math.max(-1, Math.min(1, (sampleConfig?.pan ?? 0) + (outputOpts?.pan ?? 0)))
      if (panVal !== 0 && (ctx as any).createStereoPanner) {
        const panner = (ctx as any).createStereoPanner()
        // A default stereo panner sums the up-mixed mono hit and doubles it at hard pan.
        panner.channelCount = 1
        panner.channelCountMode = 'explicit'
        panner.pan.setValueAtTime(panVal, now)
        gainNode.connect(panner)
        outputNode = panner
        chainNodes.push(panner)
      }

      const fadeIn = Math.max(0, outputOpts?.fadeIn ?? 0)
      const fadeOut = Math.max(0, outputOpts?.fadeOut ?? 0)
      if (fadeIn > 0 || fadeOut > 0) {
        const fadeNode = ctx.createGain()
        fadeNode.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : 1, now)
        if (fadeIn > 0) fadeNode.gain.linearRampToValueAtTime(1, now + fadeIn)
        if (fadeOut > 0) fadeNode.gain.linearRampToValueAtTime(0.0001, now + fadeOut)
        outputNode.connect(fadeNode)
        outputNode = fadeNode
        chainNodes.push(fadeNode)
      }

      if (this.lastDestination) {
        const rawDest = (this.lastDestination as any).input || this.lastDestination
        if (rawDest._nativeAudioNode || rawDest._nativeGainNode) {
          outputNode.connect(rawDest._nativeAudioNode || rawDest._nativeGainNode)
        } else if (typeof rawDest.connect === 'function') {
          outputNode.connect(rawDest)
        } else {
          outputNode.connect(ctx.destination)
        }
      } else {
        outputNode.connect(ctx.destination)
      }

      const startOffset = Math.max(0, Math.min(0.99, sampleConfig?.startOffset ?? 0))
      const endOffset = Math.max(startOffset + 0.01, Math.min(1.0, sampleConfig?.endOffset ?? 1.0))
      const startTimeInBuf = startOffset * buffer.duration
      const playDuration = ((endOffset - startOffset) * buffer.duration) / playbackRate

      source.connect(gainNode)
      source.start(now, startTimeInBuf, Math.min(playDuration, effectiveDuration + 0.05))

      if (chokeGroup > 0) {
        const groupList = this.activeChokeVoices.get(chokeGroup) || []
        groupList.push({ source, gainNode })
        this.activeChokeVoices.set(chokeGroup, groupList)
        source.onended = () => {
          const list = this.activeChokeVoices.get(chokeGroup) || []
          this.activeChokeVoices.set(chokeGroup, list.filter(v => v.source !== source))
          try {
            source.disconnect()
            gainNode.disconnect()
            chainNodes.forEach(node => { try { node.disconnect() } catch (_) {} })
          } catch (_) {}
        }
      } else {
        source.onended = () => {
          try {
            source.disconnect()
            gainNode.disconnect()
            chainNodes.forEach(node => { try { node.disconnect() } catch (_) {} })
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn(`DrumMachine sample trigger failed for pad ${pitch}:`, err)
    }
  }

  constructor(kit: DrumKit = DEFAULT_DRUM_KIT, customMuxins?: any) {
    this.kit = kit
    this.customMuxins = customMuxins
    this.applyKit(kit, customMuxins)

    try {
      this.hihatClosed.set({ volume: 8 })
      this.hihatOpen.set({ volume: 7 })
      this.crash.frequency.value = 300
      this.crash.set({ volume: 6 })
      this.ride.frequency.value = 400
      this.ride.set({ volume: 6 })
      this.cowbell.frequency.value = 800
      this.cowbell.set({ volume: 4 })
    } catch (e) {
      console.warn('Failed to set DrumMachine volumes:', e)
    }
  }

  private applyKit(kit: DrumKit, customMuxins?: any) {
    const tight = kit === 'tight'
    const electro = kit === 'electro'
    const eightOhEight = kit === 'eightOhEight'
    const tabla = kit === 'tabla'

    if (tight || electro || eightOhEight || tabla) {
      this.kick.set({
        octaves: eightOhEight ? 7 : electro ? 5 : tabla ? 2 : 3,
        pitchDecay: tight ? 0.025 : eightOhEight ? 0.09 : tabla ? 0.018 : 0.05,
        envelope: { attack: 0.001, decay: tight ? 0.22 : tabla ? 0.28 : eightOhEight ? 0.65 : 0.42, sustain: 0, release: 0.08 },
      })
      this.snare.set({
        noise: { type: electro || eightOhEight ? 'brown' : 'white' },
        envelope: { attack: 0.004, decay: tight ? 0.08 : tabla ? 0.06 : 0.14, sustain: 0 }
      })
      this.hihatClosed.set({
        envelope: { attack: 0.001, decay: tight ? 0.06 : 0.1, release: 0.01 },
        harmonicity: electro || eightOhEight ? 7.2 : 5.1,
        modulationIndex: electro || eightOhEight ? 46 : 32,
        resonance: electro || eightOhEight ? 5200 : 4000,
      })
      this.hihatOpen.set({
        envelope: { attack: 0.001, decay: tight ? 0.18 : 0.3, release: 0.1 },
        harmonicity: electro || eightOhEight ? 7.2 : 5.1,
        modulationIndex: electro || eightOhEight ? 46 : 32,
        resonance: electro || eightOhEight ? 5200 : 4000,
      })
      this.clap.set({
        noise: { type: electro || eightOhEight ? 'white' : 'pink' },
        envelope: { attack: 0.005, decay: tight ? 0.12 : 0.2, sustain: 0 }
      })

      const tomDecay = eightOhEight ? 0.8 : tight ? 0.15 : 0.4
      this.tomLow.set({ envelope: { decay: tomDecay }, octaves: eightOhEight ? 6 : 4 })
      this.tomMid.set({ envelope: { decay: tomDecay * 0.75 }, octaves: eightOhEight ? 6 : 4 })
      this.tomHigh.set({ envelope: { decay: tomDecay * 0.5 }, octaves: eightOhEight ? 6 : 4 })

      const cymbalDecay = tight ? 0.8 : 2.5
      this.crash.set({ envelope: { decay: cymbalDecay } })
      this.ride.set({ envelope: { decay: cymbalDecay * 1.5 } })

      this.cowbell.set({ harmonicity: eightOhEight ? 0.5 : 0.2 })
      this.congaLow.set({ envelope: { decay: tabla ? 0.4 : 0.3 } })
      this.congaHigh.set({ envelope: { decay: tabla ? 0.3 : 0.2 } })
    }

    if (kit === 'custom' && customMuxins?.config) {
      const cfg = customMuxins.config
      if (cfg.kick) this.kick.set(cfg.kick)
      if (cfg.snare) this.snare.set(cfg.snare)
      if (cfg.hihatClosed) this.hihatClosed.set(cfg.hihatClosed)
      if (cfg.hihatOpen) this.hihatOpen.set(cfg.hihatOpen)
      if (cfg.clap) this.clap.set(cfg.clap)
      if (cfg.tomLow) this.tomLow.set(cfg.tomLow)
      if (cfg.tomMid) this.tomMid.set(cfg.tomMid)
      if (cfg.tomHigh) this.tomHigh.set(cfg.tomHigh)
      if (cfg.crash) this.crash.set(cfg.crash)
      if (cfg.ride) this.ride.set(cfg.ride)
      if (cfg.cowbell) this.cowbell.set(cfg.cowbell)
      if (cfg.tambourine) this.tambourine.set(cfg.tambourine)
      if (cfg.congaLow) this.congaLow.set(cfg.congaLow)
      if (cfg.congaHigh) this.congaHigh.set(cfg.congaHigh)
      if (cfg.claves) this.claves.set(cfg.claves)
      if (cfg.rimshot) this.rimshot.set(cfg.rimshot)
    }
  }

  private createCustomSynth(pitch: number): any {
    const cfg = this.customMuxins?.config?.[pitch.toString()]

    if (cfg?.noise !== undefined) {
      return new Tone.NoiseSynth(cfg)
    }
    if (cfg?.harmonicity !== undefined) {
      return new Tone.MetalSynth(cfg)
    }
    return new Tone.MembraneSynth(cfg || {
      octaves: 3,
      pitchDecay: 0.05,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 }
    })
  }

  private getOrCreateCustomSynth(pitch: number, destination?: any): any {
    if (this.customSynths.has(pitch)) {
      return this.customSynths.get(pitch)
    }

    const synth = this.createCustomSynth(pitch)

    const dest = destination || this.lastDestination
    if (dest) {
      synth.connect(dest)
    }

    this.customSynths.set(pitch, synth)
    return synth
  }

  /**
   * Copies one pad instrument for a per-hit output chain. Drum pad instruments are
   * monophonic, so a note that needs its own pan/gain ride gets a private voice
   * instead of sharing the track-level chain.
   */
  private cloneInstrument(original: any, destination: any): any {
    let voice: any
    if (original instanceof Tone.NoiseSynth) voice = new Tone.NoiseSynth(original.get())
    else if (original instanceof Tone.MetalSynth) voice = new Tone.MetalSynth(original.get())
    else voice = new Tone.MembraneSynth(original.get())
    voice.connect(destination)
    return voice
  }

  private buildOutputChain(opts: DrumOutputOptions, startSec: number) {
    const gain = new Tone.Gain(1)
    const pan = Math.max(-1, Math.min(1, opts.pan ?? 0))
    let output: Tone.ToneAudioNode = gain
    let panner: Tone.Panner | undefined
    // A centred panner would fold the mono pad and cost 3 dB; only pan when asked to.
    if (pan !== 0) {
      panner = new Tone.Panner(pan)
      gain.connect(panner)
      output = panner
    }
    if (this.lastDestination) output.connect(this.lastDestination)
    else output.toDestination()

    const target = Math.max(0, Math.min(2, opts.gain ?? 1))
    const fadeIn = Math.max(0, opts.fadeIn ?? 0)
    const fadeOut = Math.max(0, opts.fadeOut ?? 0)
    try {
      gain.gain.setValueAtTime(fadeIn > 0 ? 0 : target, startSec)
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(target, startSec + fadeIn)
      if (fadeOut > 0) gain.gain.linearRampToValueAtTime(0, startSec + fadeOut)
    } catch (_) {}

    return {
      input: gain,
      dispose: () => {
        try { gain.dispose() } catch (_) {}
        try { panner?.dispose() } catch (_) {}
      }
    }
  }

  connect(destination: Tone.Gain) {
    this.lastDestination = destination
    this.kick.connect(destination)
    this.snare.connect(destination)
    this.hihatClosed.connect(destination)
    this.hihatOpen.connect(destination)
    this.clap.connect(destination)
    this.tomLow.connect(destination)
    this.tomMid.connect(destination)
    this.tomHigh.connect(destination)
    this.crash.connect(destination)
    this.ride.connect(destination)
    this.cowbell.connect(destination)
    this.tambourine.connect(destination)
    this.congaLow.connect(destination)
    this.congaHigh.connect(destination)
    this.claves.connect(destination)
    this.rimshot.connect(destination)
    this.customSynths.forEach(synth => synth.connect(destination))
  }

  triggerAttackRelease(
    pitch: string | number,
    duration: string,
    time?: number,
    velocity = 1,
    pitchOffset = 0,
    slideOpts?: {
      targetPitchOffset?: number
      slideTime?: number
      ramp?: 'linear' | 'exponential' | 'logarithmic' | 'sigmoid' | 'custom'
      customCurve?: string
    },
    padCustom?: {
      octaves?: number
      resonance?: number
      decay?: number
    },
    outputOpts?: DrumOutputOptions
  ) {
    const index = typeof pitch === 'number' ? pitch : Tone.Frequency(pitch).toMidi()
    const t = time as Tone.Unit.Time

    // Check if pad is configured in Sample mode with an active AudioBuffer
    const sample = this.padSamples?.[index]
    const mode = this.padModes?.[index] || (sample ? 'sample' : 'synth')
    const buffer = this.padAudioBuffers.get(index)

    if (mode === 'sample' && buffer) {
      this.triggerSample(index, sample, buffer, duration, time, velocity, pitchOffset, outputOpts)
      return
    }

    // Per-hit pan, volume automation or morph fades need their own output node, which
    // also means a private copy of the pad voice: the shared instrument is connected
    // straight to the track input and is monophonic.
    if (outputOpts && drumNeedsOutput(outputOpts)) {
      const startSec = time !== undefined ? Tone.Time(time).toSeconds() : Tone.now()
      const durSec = Tone.Time(duration).toSeconds()
      const chain = this.buildOutputChain(outputOpts, startSec)
      const shadow = Object.create(DrumMachine.prototype) as DrumMachine
      shadow.kit = this.kit
      shadow.customMuxins = this.customMuxins
      shadow.drumDecays = this.drumDecays
      shadow.drumOctaves = this.drumOctaves
      shadow.drumResonances = this.drumResonances
      shadow.customSynths = new Map()
      shadow.padModes = this.padModes
      shadow.padSamples = this.padSamples
      shadow.padAudioBuffers = this.padAudioBuffers
      shadow.lastDestination = chain.input

      let voice: any
      if (this.kit === 'tabla') {
        if (index === 0 || index === 1 || index === 4) {
          voice = shadow.kick = this.cloneInstrument(this.kick, chain.input)
        } else if (index === 2) {
          voice = shadow.hihatClosed = this.cloneInstrument(this.hihatClosed, chain.input)
        } else if (index === 3) {
          voice = shadow.hihatOpen = this.cloneInstrument(this.hihatOpen, chain.input)
        }
      } else {
        const field = DRUM_PAD_FIELD[index]
        if (field) {
          voice = this.cloneInstrument((this as any)[field], chain.input)
          ;(shadow as any)[field] = voice
        }
      }
      if (!voice) {
        voice = this.createCustomSynth(index)
        voice.connect(chain.input)
        shadow.customSynths.set(index, voice)
      }

      shadow.triggerAttackRelease(pitch, duration, time, velocity, pitchOffset, slideOpts, padCustom)

      if (!(Tone.getContext() as any).isOffline) {
        const delayMs = Math.max(0, (startSec + durSec + 4 - Tone.now()) * 1000)
        window.setTimeout(() => {
          try { voice.dispose() } catch (_) {}
          chain.dispose()
        }, delayMs)
      }
      return
    }

    let defaultDecay = getDecayDefaultByPitch(index)
    if (this.kit === 'custom' && this.customMuxins?.config) {
      const pieceKey = index <= 15 ? (PITCH_TO_PIECE[index] || '') : index.toString()
      const cfg = this.customMuxins.config[pieceKey]
      if (cfg?.envelope?.decay !== undefined) {
        defaultDecay = cfg.envelope.decay
      }
    }
    const customDecay = padCustom?.decay ?? this.drumDecays?.[index] ?? defaultDecay
    const customOctaves = padCustom?.octaves ?? this.drumOctaves?.[index]
    const customResonance = padCustom?.resonance ?? this.drumResonances?.[index]

    const tunedFreq = (baseNote: string, semitones: number) =>
      Tone.Frequency(baseNote).toFrequency() * Math.pow(2, semitones / 12)

    const applySlide = (synth: Tone.MembraneSynth, startF: number) => {
      if (slideOpts?.targetPitchOffset !== undefined && slideOpts.targetPitchOffset !== 0) {
        const endF = startF * Math.pow(2, slideOpts.targetPitchOffset / 12)
        const punchOffset = this.kit === 'eightOhEight' ? 0.05 : 0.02
        const now = time !== undefined ? time : Tone.now()
        const startTime = now + punchOffset
        const durSec = Tone.Time(duration).toSeconds()
        const slideDur = slideOpts.slideTime
          ? Math.min(durSec, Tone.Time(slideOpts.slideTime + 'i').toSeconds())
          : Math.max(0.04, durSec - punchOffset)
        try {
          synth.frequency.setValueAtTime(startF, startTime)
          synth.frequency.rampTo(endF, slideDur, startTime)
        } catch (e) {
          // ignore slide scheduling errors
        }
      }
    }

    if (this.kit === 'tabla') {
      switch (index) {
        case 0: {
          const f = tunedFreq('G2', pitchOffset)
          this.kick.envelope.decay = customDecay
          if (customOctaves !== undefined) this.kick.octaves = customOctaves
          this.kick.triggerAttackRelease(f, duration, t, velocity)
          applySlide(this.kick, f)
          break
        }
        case 1: {
          const f = tunedFreq('D3', pitchOffset)
          this.kick.envelope.decay = customDecay
          if (customOctaves !== undefined) this.kick.octaves = customOctaves
          this.kick.triggerAttackRelease(f, duration, t, velocity * 0.9)
          break
        }
        case 2:
          this.hihatClosed.envelope.decay = customDecay
          if (customResonance !== undefined) this.hihatClosed.resonance = customResonance
          this.hihatClosed.volume.value = Tone.gainToDb(velocity * 0.9) + 8
          this.hihatClosed.triggerAttackRelease(duration, t)
          break
        case 3:
          this.hihatOpen.envelope.decay = customDecay
          if (customResonance !== undefined) this.hihatOpen.resonance = customResonance
          this.hihatOpen.volume.value = Tone.gainToDb(velocity * 0.95) + 7
          this.hihatOpen.triggerAttackRelease(duration, t)
          break
        case 4: {
          const f = tunedFreq('A3', pitchOffset)
          this.kick.envelope.decay = customDecay
          if (customOctaves !== undefined) this.kick.octaves = customOctaves
          this.kick.triggerAttackRelease(f, duration, t, velocity * 0.72)
          break
        }
      }
      return
    }

    switch (index) {
      case 0: {
        const baseNote = this.kit === 'eightOhEight' ? 'A0' : 'C1'
        const f = tunedFreq(baseNote, pitchOffset)
        this.kick.envelope.decay = customDecay
        if (customOctaves !== undefined) this.kick.octaves = customOctaves
        this.kick.triggerAttackRelease(f, duration, t, velocity)
        applySlide(this.kick, f)
        break
      }
      case 1:
        this.snare.envelope.decay = customDecay
        if (pitchOffset !== 0) {
          try { (this.snare.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) {}
        }
        this.snare.triggerAttackRelease(duration, t, velocity)
        break
      case 2: {
        const f = 400 * Math.pow(2, pitchOffset / 12)
        this.hihatClosed.envelope.decay = customDecay
        if (customResonance !== undefined) this.hihatClosed.resonance = customResonance
        if (customOctaves !== undefined) this.hihatClosed.octaves = customOctaves
        this.hihatClosed.volume.value = Tone.gainToDb(velocity) + 8
        this.hihatClosed.triggerAttackRelease(f, duration, t, velocity)
        break
      }
      case 3: {
        const f = 400 * Math.pow(2, pitchOffset / 12)
        this.hihatOpen.envelope.decay = customDecay
        if (customResonance !== undefined) this.hihatOpen.resonance = customResonance
        if (customOctaves !== undefined) this.hihatOpen.octaves = customOctaves
        this.hihatOpen.volume.value = Tone.gainToDb(velocity) + 7
        this.hihatOpen.triggerAttackRelease(f, duration, t, velocity)
        break
      }
      case 4:
        this.clap.envelope.decay = customDecay
        if (pitchOffset !== 0) {
          try { (this.clap.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) {}
        }
        this.clap.triggerAttackRelease(duration, t, velocity)
        break
      case 5: {
        const f = tunedFreq('G1', pitchOffset)
        this.tomLow.envelope.decay = customDecay
        if (customOctaves !== undefined) this.tomLow.octaves = customOctaves
        this.tomLow.triggerAttackRelease(f, duration, t, velocity)
        applySlide(this.tomLow, f)
        break
      }
      case 6: {
        const f = tunedFreq('C2', pitchOffset)
        this.tomMid.envelope.decay = customDecay
        if (customOctaves !== undefined) this.tomMid.octaves = customOctaves
        this.tomMid.triggerAttackRelease(f, duration, t, velocity)
        applySlide(this.tomMid, f)
        break
      }
      case 7: {
        const f = tunedFreq('E2', pitchOffset)
        this.tomHigh.envelope.decay = customDecay
        if (customOctaves !== undefined) this.tomHigh.octaves = customOctaves
        this.tomHigh.triggerAttackRelease(f, duration, t, velocity)
        applySlide(this.tomHigh, f)
        break
      }
      case 8: {
        const f = 300 * Math.pow(2, pitchOffset / 12)
        this.crash.envelope.decay = customDecay
        if (customResonance !== undefined) this.crash.resonance = customResonance
        if (customOctaves !== undefined) this.crash.octaves = customOctaves
        this.crash.volume.value = Tone.gainToDb(velocity) + 6
        this.crash.triggerAttackRelease(f, duration, t, velocity)
        break
      }
      case 9: {
        const f = 400 * Math.pow(2, pitchOffset / 12)
        this.ride.envelope.decay = customDecay
        if (customResonance !== undefined) this.ride.resonance = customResonance
        if (customOctaves !== undefined) this.ride.octaves = customOctaves
        this.ride.volume.value = Tone.gainToDb(velocity) + 6
        this.ride.triggerAttackRelease(f, duration, t, velocity)
        break
      }
      case 10: {
        const f = 800 * Math.pow(2, pitchOffset / 12)
        this.cowbell.envelope.decay = customDecay
        if (customResonance !== undefined) this.cowbell.resonance = customResonance
        if (customOctaves !== undefined) this.cowbell.octaves = customOctaves
        this.cowbell.volume.value = Tone.gainToDb(velocity) + 4
        this.cowbell.triggerAttackRelease(f, duration, t, velocity)
        break
      }
      case 11:
        this.tambourine.envelope.decay = customDecay
        if (pitchOffset !== 0) {
          try { (this.tambourine.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) {}
        }
        this.tambourine.triggerAttackRelease(duration, t, velocity)
        break
      case 12: {
        const f = tunedFreq('E2', pitchOffset)
        this.congaLow.envelope.decay = customDecay
        if (customOctaves !== undefined) this.congaLow.octaves = customOctaves
        this.congaLow.triggerAttackRelease(f, duration, t, velocity)
        applySlide(this.congaLow, f)
        break
      }
      case 13: {
        const f = tunedFreq('G2', pitchOffset)
        this.congaHigh.envelope.decay = customDecay
        if (customOctaves !== undefined) this.congaHigh.octaves = customOctaves
        this.congaHigh.triggerAttackRelease(f, duration, t, velocity)
        applySlide(this.congaHigh, f)
        break
      }
      case 14: {
        const f = tunedFreq('C4', pitchOffset)
        this.claves.envelope.decay = customDecay
        if (customOctaves !== undefined) this.claves.octaves = customOctaves
        this.claves.triggerAttackRelease(f, duration, t, velocity)
        break
      }
      case 15:
        this.rimshot.envelope.decay = customDecay
        if (pitchOffset !== 0) {
          try { (this.rimshot.noise as any).playbackRate = Math.pow(2, pitchOffset / 12) } catch (_) {}
        }
        this.rimshot.triggerAttackRelease(duration, t, velocity)
        break
      default: {
        if (index >= 16) {
          const synth = this.getOrCreateCustomSynth(index)
          if (synth) {
            synth.envelope.decay = customDecay
            if (synth instanceof Tone.MembraneSynth) {
              const f = tunedFreq('C2', pitchOffset)
              if (customOctaves !== undefined) synth.octaves = customOctaves
              synth.triggerAttackRelease(f, duration, t, velocity)
              applySlide(synth, f)
            } else if (synth instanceof Tone.MetalSynth) {
              synth.volume.value = Tone.gainToDb(velocity) + 4
              if (customResonance !== undefined) synth.resonance = customResonance
              try {
                synth.frequency.setValueAtTime(400 * Math.pow(2, pitchOffset / 12), t || Tone.now())
              } catch (e) {}
              synth.triggerAttackRelease(duration, t)
            } else {
              synth.triggerAttackRelease(duration, t, velocity)
            }
          }
        }
        break
      }
    }
  }

  dispose() {
    this.kick.dispose()
    this.snare.dispose()
    this.hihatClosed.dispose()
    this.hihatOpen.dispose()
    this.clap.dispose()
    this.tomLow.dispose()
    this.tomMid.dispose()
    this.tomHigh.dispose()
    this.crash.dispose()
    this.ride.dispose()
    this.cowbell.dispose()
    this.tambourine.dispose()
    this.congaLow.dispose()
    this.congaHigh.dispose()
    this.claves.dispose()
    this.rimshot.dispose()
    this.customSynths.forEach(synth => synth.dispose())
    this.customSynths.clear()
    this.activeChokeVoices.forEach(voices => {
      voices.forEach(v => {
        try {
          v.source.stop()
          v.source.disconnect()
          v.gainNode.disconnect()
        } catch (_) {}
      })
    })
    this.activeChokeVoices.clear()
    this.padAudioBuffers.clear()
    this.reversedBufferCache.clear()
  }
}

interface SamplerVoice {
  key: number
  source: AudioBufferSourceNode
  gain: GainNode
  output: AudioNode
  ended: boolean
}

export class ChromaticSampler {
  private static bufferCache: Map<string, AudioBuffer> = new Map()
  private static MAX_VOICES = 24

  static peek(uri: string): AudioBuffer | undefined {
    return ChromaticSampler.bufferCache.get(uri)
  }

  private ctx: AudioContext
  private rackInput: GainNode
  private cfg: SynthSamplerConfig
  private buffer: AudioBuffer | null = null
  private reversed: AudioBuffer | null = null
  private loadedUri = ''
  private voices: SamplerVoice[] = []
  private disposed = false

  constructor(rackInput: GainNode, cfg: SynthSamplerConfig, ctx?: AudioContext) {
    this.ctx = (ctx || Tone.getContext().rawContext) as AudioContext
    this.rackInput = rackInput
    this.cfg = { ...cfg }
    this.loadSample()
  }

  get isReady() {
    return this.buffer !== null
  }

  get audioBuffer() {
    return this.buffer
  }

  updateConfig(cfg: SynthSamplerConfig) {
    const uriChanged = (cfg.audioBase64 || '') !== (this.cfg.audioBase64 || '')
    this.cfg = { ...cfg }
    if (uriChanged) this.loadSample()
  }

  private loadSample() {
    const uri = this.cfg.audioBase64 || ''
    if (!uri) {
      this.buffer = null
      this.reversed = null
      this.loadedUri = ''
      return
    }
    if (this.buffer && this.loadedUri === uri) return
    const cached = ChromaticSampler.bufferCache.get(uri)
    if (cached) {
      this.buffer = cached
      this.reversed = null
      this.loadedUri = uri
      return
    }
    const ctx = this.ctx
    fetch(uri)
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .then(decoded => {
        if (this.disposed) return
        ChromaticSampler.bufferCache.set(uri, decoded)
        this.buffer = decoded
        this.reversed = null
        this.loadedUri = uri
      })
      .catch(e => console.warn('Chromatic sampler decode failed:', e))
  }

  private getReversed(): AudioBuffer {
    const src = this.buffer!
    if (this.reversed) return this.reversed
    const rev = this.ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate)
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const inData = src.getChannelData(ch)
      const outData = rev.getChannelData(ch)
      for (let i = 0, j = src.length - 1; i < src.length; i++, j--) outData[i] = inData[j]
    }
    this.reversed = rev
    return rev
  }

  noteOn(key: number, pitchMidi: number, velocity: number, durSec: number, extraPitchOffset = 0, time?: number, opts?: {
    targetPitchMidi?: number
    glideSeconds?: number
    glideCurve?: number[]
    pan?: number
    gain?: number
    fadeIn?: number
    fadeOut?: number
  }) {
    if (!this.buffer) {
      this.loadSample()
      return
    }
    const cfg = this.cfg
    const now = time !== undefined ? time : this.ctx.currentTime

    const semis = (pitchMidi - (cfg.rootNote || 60)) + (cfg.tuning || 0) + extraPitchOffset + (cfg.fineTune || 0) / 100
    const rate = Math.max(0.05, Math.min(16.0, Math.pow(2, semis / 12)))
    const noteGain = Math.max(0, Math.min(1, opts?.gain !== undefined ? opts.gain : 1))

    const buf = cfg.reverse ? this.getReversed() : this.buffer
    const duration = buf.duration
    const startN = Math.max(0, Math.min(0.99, cfg.startOffset ?? 0))
    const endN = Math.max(startN + 0.01, Math.min(1.0, cfg.endOffset ?? 1.0))
    const regionStart = (cfg.reverse ? 1 - endN : startN) * duration
    const regionEnd = (cfg.reverse ? 1 - startN : endN) * duration
    const regionSec = Math.max(0.005, regionEnd - regionStart)

    if (this.voices.length >= ChromaticSampler.MAX_VOICES) {
      this.releaseVoice(this.voices[0], now, 0.02)
    }

    const source = this.ctx.createBufferSource()
    source.buffer = buf
    source.playbackRate.setValueAtTime(rate, now)
    if (opts?.targetPitchMidi !== undefined && opts.glideSeconds && opts.glideSeconds > 0) {
      const targetSemis = (opts.targetPitchMidi - (cfg.rootNote || 60)) + (cfg.tuning || 0) + extraPitchOffset + (cfg.fineTune || 0) / 100
      const targetRate = Math.max(0.05, Math.min(16.0, Math.pow(2, targetSemis / 12)))
      if (Math.abs(targetRate - rate) > 1e-6) {
        const curve = opts.glideCurve
        if (curve && curve.length >= 2) {
          const steps = Math.max(8, Math.min(120, Math.round(opts.glideSeconds * 60)))
          for (let i = 1; i <= steps; i++) {
            const t = i / steps
            const pos = t * (curve.length - 1)
            const i0 = Math.floor(pos)
            const i1 = Math.min(i0 + 1, curve.length - 1)
            const shape = curve[i0] + (curve[i1] - curve[i0]) * (pos - i0)
            source.playbackRate.setValueAtTime(rate + (targetRate - rate) * shape, now + opts.glideSeconds * t)
          }
        } else {
          source.playbackRate.linearRampToValueAtTime(targetRate, now + opts.glideSeconds)
        }
      }
    }
    if (cfg.loop) {
      source.loop = true
      source.loopStart = regionStart
      source.loopEnd = regionEnd
    }

    const peak = Math.max(0.0001, Math.min(2.5, velocity * (cfg.volume !== undefined ? cfg.volume : 1))) * Math.max(0.0001, noteGain)
    const gain = this.ctx.createGain()
    const attack = Math.max(0.001, cfg.attack ?? 0.005)
    const decay = Math.max(0.01, cfg.decay ?? 0.25)
    const sustain = Math.max(0, Math.min(1, cfg.sustain !== undefined ? cfg.sustain : 0.6))
    const release = Math.max(0.01, cfg.release ?? 0.35)
    const susLevel = Math.max(0.0001, peak * sustain)

    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(peak, now + attack)
    gain.gain.exponentialRampToValueAtTime(susLevel, now + attack + decay)

    const regionDur = regionSec / rate
    const noteEnd = now + Math.max(0.02, durSec)
    const releaseAt = cfg.loop ? noteEnd : Math.min(noteEnd, now + regionDur)
    const holdAt = Math.max(now + attack + decay, releaseAt)
    gain.gain.setValueAtTime(susLevel, holdAt)
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt + release)

    let output: AudioNode = gain
    const fadeIn = Math.max(0, opts?.fadeIn ?? 0)
    const fadeOut = Math.max(0, opts?.fadeOut ?? 0)
    if (fadeIn > 0 || fadeOut > 0) {
      const fadeGain = this.ctx.createGain()
      fadeGain.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, now)
      if (fadeIn > 0) fadeGain.gain.linearRampToValueAtTime(1, now + fadeIn)
      if (fadeOut > 0) fadeGain.gain.linearRampToValueAtTime(0, now + Math.min(fadeOut, Math.max(0.005, durSec)))
      gain.connect(fadeGain)
      output = fadeGain
    }
    const panVal = Math.max(-1, Math.min(1, (cfg.pan ?? 0) + (opts?.pan ?? 0)))
    if (panVal !== 0 && (this.ctx as any).createStereoPanner) {
      const panner = (this.ctx as any).createStereoPanner()
      panner.channelCount = 1
      panner.channelCountMode = 'explicit'
      panner.pan.setValueAtTime(panVal, now)
      output.connect(panner)
      output = panner
    }
    output.connect(this.rackInput)
    source.connect(gain)

    const voice: SamplerVoice = { key, source, gain, output, ended: false }
    this.voices.push(voice)
    source.onended = () => this.retireVoice(voice)

    if (cfg.loop) {
      source.start(now, regionStart)
      source.stop(releaseAt + release + 0.02)
    } else {
      source.start(now, regionStart, regionSec)
    }

    if (!cfg.loop) {
      const tailEnd = releaseAt + release + 0.02
      const alreadyScheduled = holdAt + 0.001 >= tailEnd
      if (!alreadyScheduled && tailEnd > now) source.stop(tailEnd)
    }
  }

  noteOff(key: number, time?: number) {
    const now = time !== undefined ? time : this.ctx.currentTime
    for (const v of this.voices) {
      if (v.key === key && !v.ended) this.releaseVoice(v, now)
    }
  }

  allNotesOff() {
    const now = this.ctx.currentTime
    for (const v of this.voices) {
      if (!v.ended) this.releaseVoice(v, now, 0.02)
    }
  }

  private releaseVoice(voice: SamplerVoice, when: number, releaseOverride?: number) {
    const release = releaseOverride ?? Math.max(0.01, this.cfg.release ?? 0.35)
    try {
      const g = voice.gain.gain
      g.cancelScheduledValues(when)
      g.setValueAtTime(Math.max(0.0001, g.value), when)
      g.exponentialRampToValueAtTime(0.0001, when + release)
      voice.source.stop(when + release + 0.02)
    } catch (_) {}
  }

  private retireVoice(voice: SamplerVoice) {
    if (voice.ended) return
    voice.ended = true
    try {
      voice.source.disconnect()
      voice.gain.disconnect()
      if (voice.output !== voice.gain) voice.output.disconnect()
    } catch (_) {}
    this.voices = this.voices.filter(v => v !== voice)
  }

  dispose() {
    this.disposed = true
    const now = this.ctx.currentTime
    for (const v of this.voices) {
      try {
        v.source.stop(now)
        v.source.disconnect()
        v.gain.disconnect()
        if (v.output !== v.gain) v.output.disconnect()
      } catch (_) {}
    }
    this.voices = []
    this.buffer = null
    this.reversed = null
  }
}

export interface VoiceOutputOptions {
  /** Glide destination in Hz. */
  targetFrequency?: number
  glideSeconds?: number
  glideCurve?: number[]
  /** Per-note pan trim in -1..1. */
  pan?: number
  /** Per-note gain 0..1 (volume automation). */
  gain?: number
  /** Morph crossfade lengths in seconds, measured from note start. */
  fadeIn?: number
  fadeOut?: number
}

export class PhysicalModelVoice {
  private ctx: AudioContext
  private rackInput: GainNode

  constructor(rackInput: GainNode, ctx?: AudioContext | BaseAudioContext) {
    this.ctx = (ctx || Tone.getContext().rawContext) as AudioContext
    this.rackInput = rackInput
  }

  /** Builds the per-note fade/pan/gain stage in front of the rack input. */
  private buildOutput(now: number, duration: number, opts?: VoiceOutputOptions): { node: AudioNode; owned: AudioNode[] } {
    const ctx = this.ctx
    const owned: AudioNode[] = []
    let node: AudioNode = this.rackInput

    const gainValue = Math.max(0, Math.min(1, opts?.gain ?? 1))
    const fadeIn = Math.max(0, opts?.fadeIn ?? 0)
    const fadeOut = Math.max(0, opts?.fadeOut ?? 0)
    if (gainValue !== 1 || fadeIn > 0 || fadeOut > 0) {
      const g = ctx.createGain()
      g.gain.setValueAtTime(fadeIn > 0 ? 0 : gainValue, now)
      if (fadeIn > 0) g.gain.linearRampToValueAtTime(gainValue, now + fadeIn)
      if (fadeOut > 0) g.gain.linearRampToValueAtTime(0, now + Math.min(fadeOut, Math.max(0.005, duration)))
      g.connect(node)
      node = g
      owned.push(g)
    }

    const pan = Math.max(-1, Math.min(1, opts?.pan ?? 0))
    if (pan !== 0 && (ctx as any).createStereoPanner) {
      const panner = (ctx as any).createStereoPanner()
      panner.channelCount = 1
      panner.channelCountMode = 'explicit'
      panner.pan.setValueAtTime(pan, now)
      panner.connect(node)
      node = panner
      owned.push(panner)
    }
    return { node, owned }
  }

  /**
   * Schedules a glide on a value that is inversely proportional to frequency (delay length).
   * `scale` maps 1/f to the actual delay-time range used by each model.
   */
  private scheduleDelayGlide(param: AudioParam, startFreq: number, opts: VoiceOutputOptions | undefined, now: number, duration: number, scale = 1) {
    const target = opts?.targetFrequency
    const start = Math.max(0.0005, scale / Math.max(1e-6, startFreq))
    if (!target || target <= 0) {
      param.setValueAtTime(start, now)
      return
    }
    const end = Math.max(0.0005, Math.min(param.maxValue > 0 ? param.maxValue : 1, scale / target))
    const glide = opts?.glideSeconds && opts.glideSeconds > 0 ? opts.glideSeconds : duration
    param.setValueAtTime(start, now)
    if (Math.abs(end - start) < 1e-9) return
    const curve = opts?.glideCurve
    if (curve && curve.length >= 2) {
      const steps = Math.max(8, Math.min(120, Math.round(glide * 60)))
      let prev = start
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const pos = t * (curve.length - 1)
        const i0 = Math.floor(pos)
        const i1 = Math.min(i0 + 1, curve.length - 1)
        const shape = curve[i0] + (curve[i1] - curve[i0]) * (pos - i0)
        const value = Math.max(0.0005, start * Math.pow(end / start, shape))
        if (value !== prev) {
          param.exponentialRampToValueAtTime(value, now + glide * t)
          prev = value
        }
      }
    } else {
      param.exponentialRampToValueAtTime(end, now + glide)
    }
  }

  /** Schedules a frequency glide on a filter/resonator cutoff. */
  private scheduleFreqGlide(param: AudioParam, startFreq: number, opts: VoiceOutputOptions | undefined, now: number, duration: number) {
    const target = opts?.targetFrequency
    param.setValueAtTime(startFreq, now)
    if (!target || target <= 0 || startFreq <= 0) return
    const glide = opts?.glideSeconds && opts.glideSeconds > 0 ? opts.glideSeconds : duration
    const curve = opts?.glideCurve
    if (curve && curve.length >= 2) {
      const steps = Math.max(8, Math.min(120, Math.round(glide * 60)))
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const pos = t * (curve.length - 1)
        const i0 = Math.floor(pos)
        const i1 = Math.min(i0 + 1, curve.length - 1)
        const shape = curve[i0] + (curve[i1] - curve[i0]) * (pos - i0)
        param.setValueAtTime(startFreq * Math.pow(target / startFreq, shape), now + glide * t)
      }
    } else {
      param.exponentialRampToValueAtTime(target, now + glide)
    }
  }

  trigger(frequency: number, duration: number, time: number, velocity: number, params: any, opts?: VoiceOutputOptions) {
    const model = params.pmModelType || 'string'
    if (model === 'string') {
      this.triggerString(frequency, duration, time, velocity, params, opts)
    } else if (model === 'wind') {
      this.triggerWind(frequency, duration, time, velocity, params, opts)
    } else if (model === 'custom') {
      this.triggerCustom(frequency, duration, time, velocity, params, opts)
    } else {
      this.triggerPercussion(frequency, duration, time, velocity, params, opts)
    }
  }

  private triggerString(frequency: number, duration: number, time: number, velocity: number, params: any, opts?: VoiceOutputOptions) {
    const ctx = this.ctx
    const now = time

    const stiffness = params.pmStringStiffness !== undefined ? params.pmStringStiffness : 0.5
    const decay = params.pmStringDecay !== undefined ? params.pmStringDecay : 0.7
    const hardness = params.pmPluckHardness !== undefined ? params.pmPluckHardness : 0.6
    const bridge = params.pmBridgeTransmission !== undefined ? params.pmBridgeTransmission : 0.3

    const safeFreq = Math.max(10, Math.min(20000, Number(frequency) || 440))
    const delayTime = 1 / safeFreq

    const noise = ctx.createBufferSource()
    const excFilter = ctx.createBiquadFilter()
    const delay = ctx.createDelay(Math.max(0.1, delayTime * 2))
    const feedback = ctx.createGain()
    const stringFilter = ctx.createBiquadFilter()
    const bodyRes = ctx.createBiquadFilter()
    const voiceGain = ctx.createGain()

    const pluckLen = 0.005 + (hardness * 0.045)
    const bufferSize = Math.max(128, Math.floor(ctx.sampleRate * pluckLen))
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }
    noise.buffer = buffer

    excFilter.type = 'bandpass'
    excFilter.frequency.setValueAtTime(100 + (hardness * 4000), now)
    excFilter.Q.setValueAtTime(1.0, now)

    delay.delayTime.setValueAtTime(delayTime, now)
    this.scheduleDelayGlide(delay.delayTime, safeFreq, opts, now, duration)

    const fbGain = 0.85 + (decay * 0.14)
    feedback.gain.setValueAtTime(fbGain, now)
    feedback.gain.exponentialRampToValueAtTime(0.01, now + duration + 1.5)

    stringFilter.type = 'lowpass'
    stringFilter.frequency.setValueAtTime(400 + (stiffness * 12000), now)
    stringFilter.frequency.exponentialRampToValueAtTime(100, now + duration + 1.0)

    delay.connect(stringFilter)
    stringFilter.connect(feedback)
    feedback.connect(delay)

    bodyRes.type = 'bandpass'
    bodyRes.frequency.setValueAtTime(120, now)
    bodyRes.Q.setValueAtTime(4.0, now)

    voiceGain.gain.setValueAtTime(velocity * 0.3, now)
    voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration + 2.0)

    noise.connect(excFilter)
    excFilter.connect(delay)

    delay.connect(voiceGain)
    if (bridge > 0) {
      const bridgeGain = ctx.createGain()
      bridgeGain.gain.setValueAtTime(bridge * 0.8, now)
      delay.connect(bodyRes)
      bodyRes.connect(bridgeGain)
      bridgeGain.connect(voiceGain)
    }

    const out = this.buildOutput(now, duration, opts)
    voiceGain.connect(out.node)

    noise.start(now)
    noise.stop(now + pluckLen + 0.1)

    setTimeout(() => {
      try {
        noise.disconnect()
        excFilter.disconnect()
        delay.disconnect()
        feedback.disconnect()
        stringFilter.disconnect()
        bodyRes.disconnect()
        voiceGain.disconnect()
        out.owned.forEach(n => n.disconnect())
      } catch (e) { }
    }, (duration + 3.0) * 1000)
  }

  private triggerWind(frequency: number, duration: number, time: number, velocity: number, params: any, opts?: VoiceOutputOptions) {
    const ctx = this.ctx
    const now = time

    const jetDelay = params.pmWindJetDelay !== undefined ? params.pmWindJetDelay : 0.5
    const blowPressure = params.pmWindBlowPressure !== undefined ? params.pmWindBlowPressure : 0.6
    const damping = params.pmWindDamping !== undefined ? params.pmWindDamping : 0.4

    const safeFreq = Math.max(10, Math.min(20000, Number(frequency) || 440))
    const delayTime = 1 / safeFreq

    const noise = ctx.createBufferSource()
    const blowGain = ctx.createGain()
    const excFilter = ctx.createBiquadFilter()
    const delay = ctx.createDelay(Math.max(0.1, delayTime * 3))
    const feedback = ctx.createGain()
    const tubeFilter = ctx.createBiquadFilter()
    const voiceGain = ctx.createGain()

    const bufferSize = Math.max(128, Math.floor(ctx.sampleRate * (duration + 0.5)))
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }
    noise.buffer = buffer

    blowGain.gain.setValueAtTime(0, now)
    blowGain.gain.linearRampToValueAtTime(0.15 + (blowPressure * 0.25), now + 0.08)
    blowGain.gain.setValueAtTime(0.15 + (blowPressure * 0.25), now + duration - 0.05)
    blowGain.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.1)

    excFilter.type = 'lowpass'
    excFilter.frequency.setValueAtTime(2000, now)

    delay.delayTime.setValueAtTime(delayTime * (0.8 + jetDelay * 0.4), now)
    this.scheduleDelayGlide(delay.delayTime, safeFreq, opts, now, duration, 0.8 + jetDelay * 0.4)

    feedback.gain.setValueAtTime(0.8 + (1 - damping) * 0.18, now)
    feedback.gain.exponentialRampToValueAtTime(0.01, now + duration + 0.5)

    tubeFilter.type = 'bandpass'
    tubeFilter.frequency.setValueAtTime(frequency, now)
    this.scheduleFreqGlide(tubeFilter.frequency, safeFreq, opts, now, duration)
    tubeFilter.Q.setValueAtTime(5.0 - (damping * 3.5), now)

    delay.connect(tubeFilter)
    tubeFilter.connect(feedback)
    feedback.connect(delay)

    voiceGain.gain.setValueAtTime(velocity * 0.45, now)
    voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.5)

    noise.connect(blowGain)
    blowGain.connect(excFilter)
    excFilter.connect(delay)
    delay.connect(voiceGain)
    const out = this.buildOutput(now, duration, opts)
    voiceGain.connect(out.node)

    noise.start(now)
    noise.stop(now + duration + 0.6)

    setTimeout(() => {
      try {
        noise.disconnect()
        blowGain.disconnect()
        excFilter.disconnect()
        delay.disconnect()
        feedback.disconnect()
        tubeFilter.disconnect()
        voiceGain.disconnect()
        out.owned.forEach(n => n.disconnect())
      } catch (e) { }
    }, (duration + 2.0) * 1000)
  }

  private triggerCustom(frequency: number, duration: number, time: number, velocity: number, params: any, opts?: VoiceOutputOptions) {
    const ctx = this.ctx
    const now = time
    const formula = params.pmExciterFormula || 'Math.exp(-t * 10) * (Math.random() * 2 - 1)'

    // Create an audio buffer for the impulse
    const sampleRate = ctx.sampleRate
    // Maximum 1 second impulse to prevent memory issues
    const bufferLength = Math.min(sampleRate, Math.floor(sampleRate * duration))
    const impulseBuffer = ctx.createBuffer(1, bufferLength, sampleRate)
    const channelData = impulseBuffer.getChannelData(0)

    let exciterFn: Function
    try {
      exciterFn = new Function('t', 'b', 'm', 'ticks', 'f', 'v', `return ${formula}`)
    } catch (e) {
      console.warn("Invalid exciter formula, fallback to noise", e)
      exciterFn = (t: number) => Math.exp(-t * 20) * (Math.random() * 2 - 1)
    }

    for (let i = 0; i < bufferLength; i++) {
      const t = i / sampleRate
      try {
        let val = exciterFn(t, 0, 0, 0, frequency, velocity)
        if (!isFinite(val) || isNaN(val)) val = 0
        channelData[i] = Math.max(-1, Math.min(1, val))
      } catch (e) {
        channelData[i] = 0
      }
    }

    const exciterSource = ctx.createBufferSource()
    exciterSource.buffer = impulseBuffer

    // Karplus-Strong physical modeling body (String-like delay line)
    const safeFreq = Math.max(10, Math.min(20000, Number(frequency) || 440))
    const delayTime = 1 / safeFreq
    const delay = ctx.createDelay(Math.max(0.1, delayTime * 2))
    const feedback = ctx.createGain()
    const stringFilter = ctx.createBiquadFilter()
    const voiceGain = ctx.createGain()

    delay.delayTime.value = delayTime
    this.scheduleDelayGlide(delay.delayTime, safeFreq, opts, now, duration)
    feedback.gain.value = 0.96 // Adjust for decay
    stringFilter.type = 'lowpass'
    stringFilter.frequency.value = frequency * 4 // Damping
    this.scheduleFreqGlide(stringFilter.frequency, safeFreq * 4, opts, now, duration)

    // Connect exciter to delay loop
    exciterSource.connect(delay)

    // Feedback loop
    delay.connect(stringFilter)
    stringFilter.connect(feedback)
    feedback.connect(delay)

    // Output
    delay.connect(voiceGain)
    const out = this.buildOutput(now, duration, opts)
    voiceGain.connect(out.node)

    // Envelope
    voiceGain.gain.setValueAtTime(0, now)
    voiceGain.gain.linearRampToValueAtTime(velocity, now + 0.005)
    voiceGain.gain.setValueAtTime(velocity, now + duration * 0.8)
    voiceGain.gain.linearRampToValueAtTime(0, now + duration)

    exciterSource.start(now)

    setTimeout(() => {
      exciterSource.disconnect()
      delay.disconnect()
      feedback.disconnect()
      stringFilter.disconnect()
      voiceGain.disconnect()
      out.owned.forEach(n => n.disconnect())
    }, (duration + 2) * 1000)
  }

  private triggerPercussion(frequency: number, duration: number, time: number, velocity: number, params: any, opts?: VoiceOutputOptions) {
    const ctx = this.ctx
    const now = time

    const resonance = params.pmPercResonance !== undefined ? params.pmPercResonance : 0.5
    const speed = params.pmPercStrikerSpeed !== undefined ? params.pmPercStrikerSpeed : 0.6
    const clarity = params.pmPercClarity !== undefined ? params.pmPercClarity : 0.5

    const click = ctx.createOscillator()
    const clickGain = ctx.createGain()
    const voiceGain = ctx.createGain()

    click.type = 'sine'
    click.frequency.setValueAtTime(frequency * 2, now)
    click.frequency.exponentialRampToValueAtTime(frequency, now + 0.015)

    const clickLen = 0.002 + (1 - speed) * 0.02
    clickGain.gain.setValueAtTime(1.0, now)
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + clickLen)

    click.connect(clickGain)

    const partials = [1.0, 2.76, 5.4, 8.93]
    const bandpassNodes: BiquadFilterNode[] = []
    const gainNodes: GainNode[] = []

    voiceGain.gain.setValueAtTime(velocity * 0.4, now)
    voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration + 1.0)

    partials.forEach((ratio, idx) => {
      const f = frequency * ratio
      if (f > 20000) return

      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.setValueAtTime(f, now)
      this.scheduleFreqGlide(bp.frequency, f, opts, now, duration)
      bp.Q.setValueAtTime(15 + (resonance * 120), now)

      const g = ctx.createGain()
      const volumeLevel = idx === 0 ? 1.0 : (0.15 + (clarity * 0.35)) / Math.pow(ratio, 0.7)
      g.gain.setValueAtTime(volumeLevel, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + (duration * (0.8 / ratio)))

      clickGain.connect(bp)
      bp.connect(g)
      g.connect(voiceGain)

      bandpassNodes.push(bp)
      gainNodes.push(g)
    })

    const out = this.buildOutput(now, duration, opts)
    voiceGain.connect(out.node)

    click.start(now)
    click.stop(now + clickLen + 0.05)

    setTimeout(() => {
      try {
        click.disconnect()
        clickGain.disconnect()
        bandpassNodes.forEach(bp => bp.disconnect())
        gainNodes.forEach(g => g.disconnect())
        voiceGain.disconnect()
        out.owned.forEach(n => n.disconnect())
      } catch (e) { }
    }, (duration + 2.0) * 1000)
  }
}



export class VocalModelVoice {
  private ctx: AudioContext
  private rackInput: GainNode
  private static glottalTableCache = new Map<number, Float32Array>()

  constructor(rackInput: GainNode, ctx?: AudioContext | BaseAudioContext) {
    this.ctx = (ctx || Tone.getContext().rawContext) as AudioContext
    this.rackInput = rackInput
  }

  /** Build a Liljencrants-Fant glottal pulse PeriodicWave for natural vocal excitation */
  private createGlottalWave(tension: number): PeriodicWave {
    const N = 40
    const real = new Float32Array(N)
    const imag = new Float32Array(N)
    real[0] = 0; imag[0] = 0
    const tiltDb = -6 - (1 - tension) * 12 // -6 to -18 dB/octave
    for (let n = 1; n < N; n++) {
      const rolloff = Math.pow(n, tiltDb / 20)
      const oddBoost = n % 2 === 1 ? 1.0 : 0.85
      imag[n] = -rolloff * oddBoost
      real[n] = rolloff * 0.1 * (n % 3 === 0 ? 1 : 0)
    }
    return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false })
  }

  /** Get or generate a cached 2048-sample high-resolution LF glottal flow wavetable (waveguide mode) */
  public static getGlottalTable(tension: number, tableSize = 2048): Float32Array {
    const key = Math.round(tension * 100)
    const cached = VocalModelVoice.glottalTableCache.get(key)
    if (cached) return cached

    const table = new Float32Array(tableSize)
    const tiltDb = -6 - (1 - tension) * 12
    const numHarmonics = 48
    for (let n = 1; n <= numHarmonics; n++) {
      const rolloff = Math.pow(n, tiltDb / 20)
      const oddBoost = n % 2 === 1 ? 1.0 : 0.85
      const amp = -rolloff * oddBoost
      for (let i = 0; i < tableSize; i++) {
        const phase = (i / tableSize) * 2 * Math.PI * n
        table[i] += amp * Math.sin(phase)
        if (n % 3 === 0) {
          table[i] += rolloff * 0.1 * Math.cos(phase)
        }
      }
    }
    let max = 0
    for (let i = 0; i < tableSize; i++) {
      if (Math.abs(table[i]) > max) max = Math.abs(table[i])
    }
    if (max > 0) {
      for (let i = 0; i < tableSize; i++) table[i] /= max
    }
    VocalModelVoice.glottalTableCache.set(key, table)
    return table
  }

  trigger(
    frequency: number, 
    duration: number, 
    time: number, 
    velocity: number, 
    preset: VoicePreset, 
    lyric: string, 
    endFrequency?: number,
    opts?: VoiceOutputOptions
  ) {
    const ctx = this.ctx
    const now = time

    // Per-note fade / pan / volume stage. Consonant bursts join it so an onset never escapes the fade.
    const ownedOut: AudioNode[] = []
    let outNode: AudioNode = this.rackInput
    {
      const gainValue = Math.max(0, Math.min(1, opts?.gain ?? 1))
      const fadeIn = Math.max(0, opts?.fadeIn ?? 0)
      const fadeOut = Math.max(0, opts?.fadeOut ?? 0)
      if (gainValue !== 1 || fadeIn > 0 || fadeOut > 0) {
        const g = ctx.createGain()
        g.gain.setValueAtTime(fadeIn > 0 ? 0 : gainValue, now)
        if (fadeIn > 0) g.gain.linearRampToValueAtTime(gainValue, now + fadeIn)
        if (fadeOut > 0) g.gain.linearRampToValueAtTime(0, now + Math.min(fadeOut, Math.max(0.005, duration)))
        g.connect(outNode)
        outNode = g
        ownedOut.push(g)
      }
      const pan = Math.max(-1, Math.min(1, opts?.pan ?? 0))
      if (pan !== 0 && (ctx as any).createStereoPanner) {
        const panner = (ctx as any).createStereoPanner()
        panner.channelCount = 1
        panner.channelCountMode = 'explicit'
        panner.pan.setValueAtTime(pan, now)
        panner.connect(outNode)
        outNode = panner
        ownedOut.push(panner)
      }
    }

    const glideSeconds = opts?.glideSeconds && opts.glideSeconds > 0 ? opts.glideSeconds : duration
    const glideCurveLut = opts?.glideCurve
    const pitchAt = (t: number): number => {
      if (!endFrequency || endFrequency <= 0 || frequency <= 0) return frequency
      const raw = Math.max(0, Math.min(1, t / Math.max(0.001, glideSeconds)))
      let shape = raw
      if (glideCurveLut && glideCurveLut.length >= 2) {
        const pos = raw * (glideCurveLut.length - 1)
        const i0 = Math.floor(pos)
        const i1 = Math.min(i0 + 1, glideCurveLut.length - 1)
        shape = glideCurveLut[i0] + (glideCurveLut[i1] - glideCurveLut[i0]) * (pos - i0)
      }
      return frequency * Math.pow(endFrequency / frequency, shape)
    }

    const vtl = preset.vocalTractLength ?? 1.0
    const breath = preset.breathiness ?? 0.1
    const tension = preset.glottalTension ?? 0.8
    const vibDepth = preset.vibratoDepth ?? 30 // cents
    const vibRate = preset.vibratoRate ?? 6.0 // Hz
    const jitter = preset.jitter ?? 0.1
    const shimmer = preset.shimmer ?? 0.1
    const f1Shift = preset.formantShiftF1 ?? 0
    const f2Shift = preset.formantShiftF2 ?? 0
    const f3Shift = preset.formantShiftF3 ?? 0
    const consVolScale = preset.consonantVolume ?? 1.0
    const consLenScale = preset.consonantLength ?? 1.0
    const articSpeedScale = preset.articulationSpeed ?? 1.0
    const damping = preset.waveguideDamping ?? 0.99

    // Parse syllable
    const parsed = this.parseSyllable(lyric)
    const vowel = parsed.vowel
    const consonant = parsed.consonant
    const diphthongTarget = parsed.diphthongTarget

    // 1. Noise Buffer for Consonants & Breathiness
    const bufferSize = Math.max(128, Math.floor(ctx.sampleRate * 1.5))
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const noiseData = noiseBuffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      noiseData[i] = Math.random() * 2 - 1
    }

    // 2. Onset consonant noise burst
    const consDur = consonant
      ? this.fireConsonantBurst(consonant, now, velocity, preset, noiseBuffer, outNode)
      : 0

    let vowelStartDelay = 0
    if (consDur > 0) {
      const lowerC = consonant.toLowerCase()
      // Glides (/j/, /w/) are voiced: only genuinely voiceless onsets hold the vowel back.
      const isVoiced = ['z', 'v', 'd', 'b', 'g', 'm', 'n', 'l', 'r', 'y', 'w'].some(c => lowerC.includes(c))
      if (isVoiced) {
        vowelStartDelay = 0
      } else {
        vowelStartDelay = Math.max(0, consDur - 0.02)
      }
    }

    // 3. Glottal Voiced Source (LF model via PeriodicWave)
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(this.createGlottalWave(tension))
    osc.frequency.setValueAtTime(frequency, now + vowelStartDelay)
    if (endFrequency && endFrequency > 0 && frequency > 0 && Math.abs(endFrequency - frequency) > 1e-6) {
      const oscGlide = Math.max(0.001, Math.min(glideSeconds, Math.max(0.001, duration - vowelStartDelay)))
      if (glideCurveLut && glideCurveLut.length >= 2) {
        const steps = Math.max(8, Math.min(120, Math.round(oscGlide * 60)))
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          const pos = t * (glideCurveLut.length - 1)
          const i0 = Math.floor(pos)
          const i1 = Math.min(i0 + 1, glideCurveLut.length - 1)
          const shape = glideCurveLut[i0] + (glideCurveLut[i1] - glideCurveLut[i0]) * (pos - i0)
          osc.frequency.setValueAtTime(frequency * Math.pow(endFrequency / frequency, shape), now + vowelStartDelay + oscGlide * t)
        }
      } else {
        osc.frequency.exponentialRampToValueAtTime(endFrequency, now + vowelStartDelay + oscGlide)
      }
    }

    // 5. Vibrato, Jitter, Shimmer LFOs
    let vibratoOsc: OscillatorNode | null = null
    let vibratoGain: GainNode | null = null
    if (vibDepth > 0) {
      vibratoOsc = ctx.createOscillator()
      vibratoGain = ctx.createGain()
      vibratoOsc.frequency.setValueAtTime(vibRate, now)
      
      const depthHz = frequency * (Math.pow(2, vibDepth / 1200) - 1)
      vibratoGain.gain.setValueAtTime(depthHz, now)
      
      vibratoOsc.connect(vibratoGain)
      vibratoGain.connect(osc.frequency)
      vibratoOsc.start(now)
    }

    let jitterOsc: OscillatorNode | null = null
    let jitterGain: GainNode | null = null
    if (jitter > 0) {
      jitterOsc = ctx.createOscillator()
      jitterGain = ctx.createGain()
      jitterOsc.frequency.setValueAtTime(25 + Math.random() * 10, now)
      jitterGain.gain.setValueAtTime(frequency * 0.015 * jitter, now)
      
      jitterOsc.connect(jitterGain)
      jitterGain.connect(osc.frequency)
      jitterOsc.start(now)
    }

    // Output node and envelope. The vowel ducks into the word-final consonant and ends exactly on the
    // note boundary; the old 35 ms tail past `duration` masked the next syllable's onset, which buried
    // every plosive in a lyric and left only vowels.
    const voiceGain = ctx.createGain()
    const attackTime = Math.min(0.015, duration * 0.15)
    const codaLen = parsed.finalConsonant ? this.consonantBurstLength(parsed.finalConsonant, consLenScale) : 0
    const releaseLength = codaLen > 0 ? Math.max(0.03, Math.min(0.12, codaLen)) : 0.035
    const attackEnd = vowelStartDelay + attackTime
    const releaseStart = Math.max(attackEnd + 0.002, duration - releaseLength)
    const releaseEnd = Math.max(duration, releaseStart + 0.005, attackEnd + 0.005)
    voiceGain.gain.setValueAtTime(0, now)
    voiceGain.gain.linearRampToValueAtTime(velocity * 0.45, now + attackEnd)
    if (releaseStart > attackEnd) {
      voiceGain.gain.setValueAtTime(velocity * 0.45, now + releaseStart)
    }
    voiceGain.gain.linearRampToValueAtTime(0, now + releaseEnd)

    // Shimmer LFO (amplitude modulation)
    let shimmerOsc: OscillatorNode | null = null
    let shimmerGain: GainNode | null = null
    if (shimmer > 0) {
      shimmerOsc = ctx.createOscillator()
      shimmerGain = ctx.createGain()
      shimmerOsc.frequency.setValueAtTime(12 + Math.random() * 6, now)
      shimmerGain.gain.setValueAtTime(0.08 * shimmer, now)
      
      shimmerOsc.connect(shimmerGain)
      shimmerGain.connect(voiceGain.gain)
      shimmerOsc.start(now)
    }

    // 6. Breathiness Source
    const breathSource = ctx.createBufferSource()
    breathSource.buffer = noiseBuffer
    const breathFilter = ctx.createBiquadFilter()
    breathFilter.type = 'bandpass'
    breathFilter.frequency.setValueAtTime(1500, now)
    breathFilter.Q.setValueAtTime(0.7, now)

    const breathGain = ctx.createGain()
    breathGain.gain.setValueAtTime(velocity * breath * 0.12, now)

    // Connect Excitation source
    const formantMix = ctx.createGain()
    osc.connect(formantMix)

    breathSource.connect(breathFilter)
    breathFilter.connect(breathGain)
    breathGain.connect(formantMix)

    // 7. Resonator / Waveguide / FOF Selection
    const formantFilters: BiquadFilterNode[] = []
    const formantGains: GainNode[] = []

    const sr = ctx.sampleRate || 44100
    const tailDur = 0.04
    const totalDur = duration + tailDur
    const totalSamples = Math.ceil(totalDur * sr)

    if (preset.synthesisMode === 'fof') {
      // =========================================================================
      // === FOF (FORME D'ONDE FORMANTIQUE / IRCAM CHANT) SYNTHESIS ===
      // Pure mathematical time-domain formant wave packet synthesis
      // =========================================================================
      const fofBuffer = ctx.createBuffer(1, totalSamples, sr)
      const fofData = fofBuffer.getChannelData(0)

      const profile1 = VOWEL_FORMANTS[vowel] || VOWEL_FORMANTS['a']
      const profile2 = diphthongTarget ? (VOWEL_FORMANTS[diphthongTarget] || profile1) : profile1
      const hasDiphthong = !!diphthongTarget && profile2 !== profile1

      const numFormants = 5
      const shifts = [f1Shift, f2Shift, f3Shift, preset.formantShiftF4 ?? 0, preset.formantShiftF5 ?? 0]
      const userF = [preset.fofF1, preset.fofF2, preset.fofF3, preset.fofF4, preset.fofF5]
      const userBw = [preset.fofBw1, preset.fofBw2, preset.fofBw3, preset.fofBw4, preset.fofBw5]
      const userAmp = [preset.fofAmp1, preset.fofAmp2, preset.fofAmp3, preset.fofAmp4, preset.fofAmp5]

      const baseF = new Float32Array(numFormants)
      const targetF = new Float32Array(numFormants)
      const baseBw = new Float32Array(numFormants)
      const baseAmp = new Float32Array(numFormants)

      const skirtDamp = preset.fofSkirtDamping ?? 1.0
      for (let i = 0; i < numFormants; i++) {
        const rawF1 = userF[i] !== undefined ? userF[i]! : profile1.f[i]
        // A user formant frequency replaces the *vowel* centre; the diphthong target must still come
        // from the second vowel, otherwise setting any F4/F5 slider silently killed the glide.
        const rawF2 = hasDiphthong ? profile2.f[i] : rawF1
        baseF[i] = Math.max(80, Math.min(12000, (rawF1 + shifts[i]) * vtl))
        targetF[i] = Math.max(80, Math.min(12000, (rawF2 + shifts[i]) * vtl))
        const rawBw = userBw[i] !== undefined ? userBw[i]! : profile1.bw[i]
        baseBw[i] = Math.max(20, Math.min(1000, rawBw * vtl * skirtDamp))
        const rawAmpDb = userAmp[i] !== undefined ? userAmp[i]! : profile1.ampDb[i]
        baseAmp[i] = Math.pow(10, rawAmpDb / 20)
      }

      const attackSec = Math.max(0.0005, (preset.fofAttackMs ?? 2.2) / 1000)
      const vibDelaySec = (preset.vibratoDelay ?? 80) / 1000
      const morphCurve = preset.fofDiphthongMorph ?? 1.0

      // Ring buffer of active decaying FOF wave packets.
      // Size it from the packet lifetime so high notes don't recycle still-sounding packets (clicks):
      // 16 slots only supported 16 / 0.035 s ≈ 457 Hz.
      const packetLife = 0.035
      const maxActivePulses = Math.max(16, Math.min(64, Math.ceil(frequency * packetLife) + 4))
      const activePulses: { active: boolean; startSample: number; amp: number }[] = []
      for (let p = 0; p < maxActivePulses; p++) {
        activePulses.push({ active: false, startSample: 0, amp: 1.0 })
      }
      let nextPulseIdx = 0
      let glottalPhase = 0.0
      let noiseState = 0.0

      for (let s = 0; s < totalSamples; s++) {
        const t = s / sr

        // Pitch trajectory with vibrato onset delay and jitter
        let excFreq = pitchAt(t)
        if (vibDepth > 0 && t > vibDelaySec) {
          const depthHz = excFreq * (Math.pow(2, vibDepth / 1200) - 1)
          const vibEnv = Math.min(1.0, (t - vibDelaySec) / 0.15)
          excFreq += depthHz * vibEnv * Math.sin(2 * Math.PI * vibRate * (t - vibDelaySec))
        }
        if (jitter > 0) {
          excFreq += excFreq * 0.01 * jitter * Math.sin(2 * Math.PI * 29 * t)
        }

        // Glottal phase accumulation
        glottalPhase += excFreq / sr
        if (glottalPhase >= 1.0) {
          glottalPhase -= 1.0
          const pulse = activePulses[nextPulseIdx]
          pulse.active = true
          pulse.startSample = s
          pulse.amp = 1.0
          nextPulseIdx = (nextPulseIdx + 1) % maxActivePulses
        }

        // Diphthong and transition morph
        const morphProgress = diphthongTarget && t > vowelStartDelay ? Math.min(1.0, Math.pow((t - vowelStartDelay) / Math.max(0.05, duration * 0.6), morphCurve)) : 0.0
        const pSmooth = 0.5 * (1 - Math.cos(Math.PI * morphProgress))

        // Sum active FOF packets across all 5 formants
        let sampleVal = 0.0
        for (let p = 0; p < maxActivePulses; p++) {
          const pulse = activePulses[p]
          if (!pulse.active) continue

          const tau = (s - pulse.startSample) / sr
          if (tau > packetLife) {
            pulse.active = false
            continue
          }

          for (let i = 0; i < numFormants; i++) {
            const curF = baseF[i] * (1 - pSmooth) + targetF[i] * pSmooth
            const alpha = Math.PI * baseBw[i]

            let env = Math.exp(-alpha * tau)
            if (tau < attackSec) {
              env *= 0.5 * (1 - Math.cos(Math.PI * tau / attackSec))
            }

            sampleVal += baseAmp[i] * env * Math.sin(2 * Math.PI * curF * tau)
          }
        }

        // Breathiness turbulence — one-pole low-passed. Raw per-sample white noise added ~-17 dB of
        // broadband hiss on every note and masked the formants.
        if (breath > 0) {
          noiseState += 0.18 * ((Math.random() * 2 - 1) - noiseState)
          sampleVal += noiseState * breath * 0.10
        }

        // Note sustain and release envelope
        let noteEnv = 1.0
        if (t < 0.008) noteEnv = t / 0.008
        else if (t > duration) noteEnv = Math.max(0, 1.0 - (t - duration) / tailDur)

        fofData[s] = sampleVal * 0.70 * noteEnv
      }

      // De-clicking micro-fade
      if (preset.antiClickFade !== false && totalSamples > 64) {
        const fade = Math.min(128, Math.floor(sr * 0.003))
        for (let s = 0; s < fade; s++) {
          const f = s / fade
          fofData[s] *= f
          fofData[totalSamples - 1 - s] *= f
        }
      }

      // Optional user buffer envelope
      if (preset.bufferEnvelopeEnabled) {
        const attackSec = (preset.bufferAttackMs !== undefined ? preset.bufferAttackMs : 15) / 1000
        const releaseSec = (preset.bufferReleaseMs !== undefined ? preset.bufferReleaseMs : 25) / 1000
        for (let s = 0; s < totalSamples; s++) {
          const t = s / sr
          let env = 1.0
          if (t < vowelStartDelay + attackSec) {
            env = Math.min(1.0, t / Math.max(0.001, vowelStartDelay + attackSec))
          }
          if (t > duration) {
            env = Math.max(0, 1.0 - (t - duration) / Math.max(0.001, releaseSec))
          }
          fofData[s] *= env
        }
      }

      // Play pre-rendered FOF buffer
      const fofSource = ctx.createBufferSource()
      fofSource.buffer = fofBuffer
      fofSource.connect(voiceGain)
      fofSource.start(now)
      fofSource.stop(now + totalDur)
    } else if (preset.synthesisMode === 'waveguide') {
      // =========================================================================
      // === PINK TROMBONE DIGITAL WAVEGUIDE PHYSICAL MODEL ===
      // Physical acoustic scattering junctions, 3-port nasal velum, and constriction turbulence
      // =========================================================================
      const resample = (arr: number[], targetLen: number): Float32Array => {
        const res = new Float32Array(targetLen)
        for (let i = 0; i < targetLen; i++) {
          const srcIdx = (i / (targetLen - 1)) * (arr.length - 1)
          const idx = Math.floor(srcIdx)
          const frac = srcIdx - idx
          if (idx >= arr.length - 1) {
            res[i] = arr[arr.length - 1]
          } else {
            res[i] = arr[idx] * (1 - frac) + arr[idx + 1] * frac
          }
        }
        return res
      }

      // Physical acoustic vocal tract scaling
      const nominalN = Math.round(sr / 2000)
      const N = preset.tubeSections ? Math.max(16, Math.min(44, preset.tubeSections)) : Math.max(14, Math.min(36, Math.round(nominalN * vtl)))

      // Nasal cavity parameters (3-port velum coupling)
      const M = Math.max(8, Math.round(N * 0.55))
      const velumIndex = Math.round(N * 0.38)
      const lowerC = consonant.toLowerCase()
      const isNasal = ['m', 'n', 'ng'].some(c => lowerC.includes(c))
      // A nasal onset must open the velum even when the preset pins velumOpening to 0 (every shipped
      // waveguide preset does), otherwise /m/ /n/ always render with a closed nasal port.
      const velumOpening = Math.max(
        preset.velumOpening !== undefined ? preset.velumOpening : 0,
        isNasal ? 0.40 : 0
      )
      const aVelum = 3.2 * velumOpening

      // Nasal tract fixed anatomical areas (Story, 1996)
      const noseAreas = new Float32Array(M)
      for (let i = 0; i < M; i++) {
        noseAreas[i] = 1.2 + 0.8 * Math.sin(Math.PI * i / M)
      }
      const noseReflections = new Float32Array(M - 1)
      for (let i = 0; i < M - 1; i++) {
        noseReflections[i] = (noseAreas[i] - noseAreas[i+1]) / (noseAreas[i] + noseAreas[i+1] + 1e-6)
      }

      // Vowel area profiles
      const vAreasRaw = [...(W_AREAS[vowel] || W_AREAS['a'])]
      const dAreasRaw = diphthongTarget ? [...(W_AREAS[diphthongTarget] || W_AREAS['a'])] : [...vAreasRaw]

      // Custom Pink Trombone user tongue & lip shaping
      // Only applied after the user edits a knob: at their shipped values these overrides erased the
      // vowel's own constriction (e.g. /i/ 0.70 → 2.90, /a/ 3.8 → 2.90), flattening every vowel.
      // The diphthong target is shaped identically so the morph no longer jumps between tract anatomies.
      if (preset.tongueShaping) {
        const applyShaping = (areas: number[]) => {
          if (preset.tongueIndex !== undefined && preset.tongueDiameter !== undefined) {
            const tonguePosNorm = (preset.tongueIndex - 12) / 28
            const tIdxRaw = Math.max(1, Math.min(areas.length - 2, Math.round(tonguePosNorm * (areas.length - 1))))
            const targetA = Math.max(0.2, (preset.tongueDiameter * preset.tongueDiameter) * 0.6)
            areas[tIdxRaw] = targetA
            if (tIdxRaw > 0) areas[tIdxRaw - 1] = (areas[tIdxRaw - 1] + targetA) * 0.6
            if (tIdxRaw < areas.length - 1) areas[tIdxRaw + 1] = (areas[tIdxRaw + 1] + targetA) * 0.6
          }
          if (preset.lipDiameter !== undefined) {
            const lipA = Math.max(0.1, (preset.lipDiameter * preset.lipDiameter) * 0.5)
            areas[areas.length - 1] = lipA
          }
        }
        applyShaping(vAreasRaw)
        applyShaping(dAreasRaw)
      }

      // Consonant constriction areas and locations
      let cAreasRaw = [...vAreasRaw]
      let isUnvoiced = false
      let consLen = 0
      let constrictionSection = Math.round(N * 0.82)
      let isStop = false

      if (lowerC) {
        if (['s', 'sh', 'f', 't', 'p', 'k', 'h', 'th'].some(c => lowerC.includes(c))) {
          isUnvoiced = true
          consLen = (lowerC.includes('s') || lowerC.includes('sh') || lowerC.includes('f') || lowerC.includes('th')) ? 0.06 * consLenScale : 0.03 * consLenScale
        }
        // "th" contains a t but is a fricative, not a stop; "st"/"sp"/"sk" do end in a real stop.
        const stopCluster = lowerC.replace(/^s/, '')
        if (/^(p|t|k|b|d|g)(?!h)/.test(stopCluster)) {
          isStop = true
        }

        if (lowerC.includes('d') || lowerC.includes('t')) {
          cAreasRaw = [3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 2.2, 0.4, 0.5, 2.5, 3.5]
          constrictionSection = Math.round(N * 0.82)
        } else if (lowerC.includes('b') || lowerC.includes('p') || lowerC.includes('m')) {
          cAreasRaw = [3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 2.2, 0.35, 0.35]
          constrictionSection = N - 1
        } else if (lowerC.includes('g') || lowerC.includes('k')) {
          cAreasRaw = [3.0, 3.0, 3.0, 0.4, 0.5, 2.2, 3.0, 3.0, 3.0, 3.0, 3.0, 3.5]
          constrictionSection = Math.round(N * 0.42)
        } else if (lowerC.includes('s') || lowerC.includes('z')) {
          cAreasRaw = [3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 2.5, 1.5, 0.4, 0.4, 2.5, 3.5]
          constrictionSection = Math.round(N * 0.82)
        } else if (lowerC.includes('f') || lowerC.includes('v') || lowerC.includes('th')) {
          cAreasRaw = [3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 2.5, 1.8, 0.4, 3.0]
          constrictionSection = N - 2
        } else if (lowerC.includes('l') || lowerC.includes('r')) {
          cAreasRaw = [3.0, 3.0, 3.0, 3.0, 2.5, 1.8, 1.0, 1.8, 3.0, 3.0, 3.5, 3.5]
          constrictionSection = Math.round(N * 0.70)
        } else if (lowerC.includes('h')) {
          cAreasRaw = [0.8, 0.8, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.5]
          constrictionSection = 1
        }
      }

      const cAreas = resample(cAreasRaw, N)
      const vAreas = resample(vAreasRaw, N)
      const dAreas = resample(dAreasRaw, N)

      const transitionDur = Math.max(0.025, (consLen + 0.02) / articSpeedScale)
      const wgBuffer = ctx.createBuffer(1, totalSamples, sr)
      const wgData = wgBuffer.getChannelData(0)

      const glottalTable = VocalModelVoice.getGlottalTable(tension)
      const tableLen = glottalTable.length

      const excSamples = new Float32Array(totalSamples)
      let excFreq = frequency
      let glottalPhase = 0
      const vibDelaySec = (preset.vibratoDelay ?? 80) / 1000

      for (let s = 0; s < totalSamples; s++) {
        const t = s / sr
        excFreq = pitchAt(t)
        if (vibDepth > 0 && t > vibDelaySec) {
          const depthHz = excFreq * (Math.pow(2, vibDepth / 1200) - 1)
          const vibEnv = Math.min(1.0, (t - vibDelaySec) / 0.15)
          excFreq += depthHz * vibEnv * Math.sin(2 * Math.PI * vibRate * (t - vibDelaySec))
        }
        if (jitter > 0) {
          excFreq += excFreq * 0.012 * jitter * Math.sin(2 * Math.PI * 28 * t)
        }

        glottalPhase = (glottalPhase + excFreq / sr) % 1.0
        const tablePos = glottalPhase * tableLen
        const idx0 = Math.floor(tablePos)
        const frac = tablePos - idx0
        const idx1 = (idx0 + 1) % tableLen
        const pulse = glottalTable[idx0] * (1 - frac) + glottalTable[idx1] * frac

        let voiceAmp = 1.0
        if (isUnvoiced && t < consLen) {
          voiceAmp = 0.0
        } else if (isUnvoiced && t < consLen + 0.02) {
          voiceAmp = (t - consLen) / 0.02
        }

        const noise = (Math.random() * 2 - 1) * (isUnvoiced && t < consLen ? 0.35 * consVolScale : breath * 0.15)
        excSamples[s] = (pulse * voiceAmp * 0.35 + noise) * velocity
      }

      // Waveguide buffers
      const R = new Float32Array(N)
      const L = new Float32Array(N)
      const nextR = new Float32Array(N)
      const nextL = new Float32Array(N)
      const areas = new Float32Array(N)
      const reflections = new Float32Array(N - 1)

      const noseR = new Float32Array(M)
      const noseL = new Float32Array(M)
      const nextNoseR = new Float32Array(M)
      const nextNoseL = new Float32Array(M)

      let lastLipOut = 0
      let lastNoseOut = 0

      const userDamping = Math.max(0.85, Math.min(1.0, damping))
      const sectionDamping = 0.985 + (userDamping - 0.85) * (0.012 / 0.15)
      const rLip = preset.lipReflection ?? -0.85
      const rGlottis = preset.glottalReflection ?? 0.82
      const consTurbScale = preset.constrictionTurbulence ?? 1.0
      const burstGain = preset.plosiveBurstGain ?? 1.0

      for (let s = 0; s < totalSamples; s++) {
        const timeInSec = s / sr

        // Area interpolation
        if (timeInSec < transitionDur) {
          const p = 0.5 * (1 - Math.cos(Math.PI * (timeInSec / transitionDur)))
          for (let i = 0; i < N; i++) {
            areas[i] = cAreas[i] * (1 - p) + vAreas[i] * p
          }
        } else {
          const diphthongTime = duration - vowelStartDelay - transitionDur
          if (diphthongTarget && diphthongTime > 0) {
            const factor = Math.min(1.0, (timeInSec - transitionDur) / (diphthongTime * 0.7))
            const p = 0.5 * (1 - Math.cos(Math.PI * factor))
            for (let i = 0; i < N; i++) {
              areas[i] = vAreas[i] * (1 - p) + dAreas[i] * p
            }
          } else {
            for (let i = 0; i < N; i++) {
              areas[i] = vAreas[i]
            }
          }
        }

        // Reflection coefficients
        for (let i = 0; i < N - 1; i++) {
          reflections[i] = (areas[i] - areas[i+1]) / (areas[i] + areas[i+1] + 1e-6)
        }

        // Glottal boundary
        const exc = excSamples[s]
        nextR[0] = exc + L[0] * rGlottis

        // Main oral junctions before velum
        for (let i = 0; i < velumIndex - 1; i++) {
          const r = reflections[i]
          const w = r * (R[i] - L[i+1])
          nextR[i+1] = R[i] + w
          nextL[i] = L[i+1] + w
        }

        // 3-port velum / nasal coupling
        if (velumOpening > 0.01) {
          const aL = areas[velumIndex - 1]
          const aR = areas[velumIndex]
          const aTotal = aL + aR + aVelum
          const P = (2 / aTotal) * (aL * R[velumIndex - 1] + aR * L[velumIndex] + aVelum * noseL[0])

          nextR[velumIndex] = P - L[velumIndex]
          nextL[velumIndex - 1] = P - R[velumIndex - 1]
          nextNoseR[0] = P - noseL[0]
        } else {
          const r = reflections[velumIndex - 1]
          const w = r * (R[velumIndex - 1] - L[velumIndex])
          nextR[velumIndex] = R[velumIndex - 1] + w
          nextL[velumIndex - 1] = L[velumIndex] + w
          nextNoseR[0] = 0
        }

        // Main oral junctions after velum
        for (let i = velumIndex; i < N - 1; i++) {
          const r = reflections[i]
          const w = r * (R[i] - L[i+1])
          nextR[i+1] = R[i] + w
          nextL[i] = L[i+1] + w
        }

        // Nasal tract junctions
        for (let i = 0; i < M - 1; i++) {
          const r = noseReflections[i]
          const w = r * (noseR[i] - noseL[i+1])
          nextNoseR[i+1] = noseR[i] + w
          nextNoseL[i] = noseL[i+1] + w
        }

        // Constriction-localized turbulence injection (Pink Trombone aerodynamic physics)
        if (consonant && timeInSec < consLen) {
          const cTurb = (Math.random() * 2 - 1) * 0.28 * consTurbScale * velocity
          nextR[constrictionSection] += cTurb * 0.5
          nextL[constrictionSection] -= cTurb * 0.5
        }

        // Stop release plosive burst pop
        if (isStop && timeInSec >= consLen && timeInSec < consLen + 0.006) {
          const pop = 0.35 * burstGain * velocity * Math.exp(-(timeInSec - consLen) / 0.002)
          nextR[constrictionSection] += pop
        }

        // Termination boundaries
        nextL[N-1] = rLip * R[N-1]
        nextNoseL[M-1] = -0.85 * noseR[M-1]

        // Propagation shift with wall damping
        for (let i = 0; i < N; i++) {
          R[i] = nextR[i] * sectionDamping
          L[i] = nextL[i] * sectionDamping
        }
        for (let i = 0; i < M; i++) {
          noseR[i] = nextNoseR[i] * sectionDamping
          noseL[i] = nextNoseL[i] * sectionDamping
        }

        // Lip and nostril radiation differentiator
        const lipRad = R[N-1] - lastLipOut * 0.97
        lastLipOut = R[N-1]
        const noseRad = noseR[M-1] - lastNoseOut * 0.97
        lastNoseOut = noseR[M-1]

        const totalRad = lipRad + (velumOpening > 0 ? noseRad * 0.8 : 0)

        // Note envelope
        let env = 1.0
        if (timeInSec < 0.008) env = timeInSec / 0.008
        else if (timeInSec > duration) env = Math.max(0, 1.0 - (timeInSec - duration) / tailDur)

        wgData[s] = totalRad * 1.2 * env
      }

      // Anti-click micro-fade
      if (preset.antiClickFade !== false && totalSamples > 64) {
        const fadeSamples = Math.min(128, Math.floor(sr * 0.003))
        for (let s = 0; s < fadeSamples; s++) {
          const f = s / fadeSamples
          wgData[s] *= f
          wgData[totalSamples - 1 - s] *= f
        }
      }

      // Optional user buffer envelope
      if (preset.bufferEnvelopeEnabled) {
        const attackSec = (preset.bufferAttackMs !== undefined ? preset.bufferAttackMs : 15) / 1000
        const releaseSec = (preset.bufferReleaseMs !== undefined ? preset.bufferReleaseMs : 25) / 1000
        for (let s = 0; s < totalSamples; s++) {
          const t = s / sr
          let env = 1.0
          if (t < vowelStartDelay + attackSec) {
            env = Math.min(1.0, t / Math.max(0.001, vowelStartDelay + attackSec))
          }
          if (t > duration) {
            env = Math.max(0, 1.0 - (t - duration) / Math.max(0.001, releaseSec))
          }
          wgData[s] *= env
        }
      }

      // Play pre-rendered waveguide buffer
      const wgSource = ctx.createBufferSource()
      wgSource.buffer = wgBuffer
      wgSource.connect(voiceGain)
      wgSource.start(now)
      wgSource.stop(now + totalDur)
    } else {
      // =========================================================================
      // === 7. CLASSIC PARALLEL FORMANT RESONATORS ===
      // =========================================================================
      const profile = VOWEL_FORMANTS[vowel] || VOWEL_FORMANTS['a']
      const profile2 = diphthongTarget ? VOWEL_FORMANTS[diphthongTarget] : null

      for (let i = 0; i < profile.f.length; i++) {
        const fFilter = ctx.createBiquadFilter()
        fFilter.type = 'bandpass'

        let baseF = profile.f[i]
        if (i === 0) baseF += f1Shift
        else if (i === 1) baseF += f2Shift
        else if (i === 2) baseF += f3Shift

        const finalF = Math.max(80, Math.min(14000, baseF * vtl))

        let finalF2 = finalF
        if (profile2) {
          let baseF2 = profile2.f[i]
          if (i === 0) baseF2 += f1Shift
          else if (i === 1) baseF2 += f2Shift
          else if (i === 2) baseF2 += f3Shift
          finalF2 = Math.max(80, Math.min(14000, baseF2 * vtl))
        }

        // Formant transition sweeps (co-articulation)
        let locusF = finalF
        const lowerC = consonant.toLowerCase()
        if (lowerC) {
          if (lowerC.includes('d') || lowerC.includes('t') || lowerC.includes('s') || lowerC.includes('z')) {
            if (i === 0) locusF = 200
            else if (i === 1) locusF = 1800
            else if (i === 2) locusF = 2500
          } else if (lowerC.includes('b') || lowerC.includes('p') || lowerC.includes('m') || lowerC.includes('f') || lowerC.includes('v')) {
            if (i === 0) locusF = 200
            else if (i === 1) locusF = 800
            else if (i === 2) locusF = 1500
          } else if (lowerC.includes('g') || lowerC.includes('k')) {
            if (i === 0) locusF = 200
            else if (i === 1) locusF = vowel === 'i' || vowel === 'e' ? 2600 : 1300
            else if (i === 2) locusF = 2000
          } else if (lowerC.includes('n')) {
            if (i === 0) locusF = 250
            else if (i === 1) locusF = 1600
            else if (i === 2) locusF = 2000
          } else if (lowerC.includes('l') || lowerC.includes('r')) {
            if (i === 0) locusF = 280
            else if (i === 1) locusF = 1100
            else if (i === 2) locusF = 1600
          }
        }

        const sweepDuration = 0.04 / articSpeedScale
        const startTimePoint = now + vowelStartDelay
        const transitionTimePoint = startTimePoint + sweepDuration

        fFilter.frequency.setValueAtTime(locusF, startTimePoint)
        fFilter.frequency.exponentialRampToValueAtTime(finalF, transitionTimePoint)

        if (profile2 && finalF2 !== finalF) {
          // Diphthong sweep to second vowel target over the note's duration
          const diphthongTimePoint = startTimePoint + (duration - vowelStartDelay) * 0.65
          fFilter.frequency.setValueAtTime(finalF, transitionTimePoint)
          fFilter.frequency.exponentialRampToValueAtTime(finalF2, diphthongTimePoint)
        }

        const bw = profile.bw[i] * vtl
        const q = Math.max(0.5, finalF / Math.max(1, bw))
        fFilter.Q.setValueAtTime(q, now + vowelStartDelay)

        const fGain = ctx.createGain()
        const ampLin = Math.pow(10, profile.ampDb[i] / 20) * 0.45
        fGain.gain.setValueAtTime(ampLin, now + vowelStartDelay)

        formantMix.connect(fFilter)
        fFilter.connect(fGain)
        fGain.connect(voiceGain)

        formantFilters.push(fFilter)
        formantGains.push(fGain)
      }
    }

    voiceGain.connect(outNode)

    // 8. Word-final consonant (coda). "give", "love", "half", "all", "your" and "an" used to stop on
    // the bare vowel; it sits under the gate's duck so it is heard without masking the next onset.
    if (parsed.finalConsonant) {
      const codaAt = now + Math.max(vowelStartDelay + 0.03, duration - codaLen)
      this.fireConsonantBurst(parsed.finalConsonant, codaAt, velocity * 0.9, preset, noiseBuffer, outNode)
    }

    if (preset.synthesisMode !== 'waveguide' && preset.synthesisMode !== 'fof') {
      osc.start(now + vowelStartDelay)
      osc.stop(now + duration)
      breathSource.start(now + vowelStartDelay)
      breathSource.stop(now + duration)
    }

    const startDelaySeconds = Math.max(0, now - ctx.currentTime)
    setTimeout(() => {
      try {
        osc.disconnect()
        formantMix.disconnect()
        breathSource.disconnect()
        breathFilter.disconnect()
        breathGain.disconnect()

        formantFilters.forEach(f => f.disconnect())
        formantGains.forEach(g => g.disconnect())
        voiceGain.disconnect()
        ownedOut.forEach(n => n.disconnect())
        if (vibratoOsc) {
          vibratoOsc.stop()
          vibratoOsc.disconnect()
        }
        if (vibratoGain) vibratoGain.disconnect()
        if (jitterOsc) {
          jitterOsc.stop()
          jitterOsc.disconnect()
        }
        if (jitterGain) jitterGain.disconnect()
        if (shimmerOsc) {
          shimmerOsc.stop()
          shimmerOsc.disconnect()
        }
        if (shimmerGain) shimmerGain.disconnect()
      } catch (_) {}
    }, (startDelaySeconds + duration + 2.0) * 1000)
  }

  /** Filter, level and length for a consonant burst; shared by the syllable onset and the word-final coda. */
  private consonantBurstSpec(consonant: string, consLenScale: number): {
    type: BiquadFilterType; frequency: number; q?: number; level: number; dur: number
  } | null {
    const c = consonant.toLowerCase()
    if (c.includes('s') && !c.includes('sh') && !c.includes('z')) return { type: 'highpass', frequency: 5000, level: 0.16, dur: 0.10 * consLenScale }
    if (c.includes('z')) return { type: 'highpass', frequency: 4500, level: 0.10, dur: 0.12 * consLenScale }
    if (c.includes('sh')) return { type: 'bandpass', frequency: 2500, q: 2, level: 0.18, dur: 0.12 * consLenScale }
    if (c.includes('th')) return { type: 'highpass', frequency: 3500, level: 0.10, dur: 0.08 * consLenScale }
    if (c.includes('f')) return { type: 'highpass', frequency: 3000, level: 0.08, dur: 0.10 * consLenScale }
    if (c.includes('v')) return { type: 'highpass', frequency: 2500, level: 0.06, dur: 0.10 * consLenScale }
    if (c.includes('t')) return { type: 'highpass', frequency: 4000, level: 0.15, dur: 0.04 * consLenScale }
    if (c.includes('d')) return { type: 'bandpass', frequency: 1500, q: 3, level: 0.12, dur: 0.04 * consLenScale }
    if (c.includes('p')) return { type: 'bandpass', frequency: 800, q: 4, level: 0.12, dur: 0.03 * consLenScale }
    if (c.includes('b')) return { type: 'bandpass', frequency: 600, q: 4, level: 0.10, dur: 0.03 * consLenScale }
    if (c.includes('k')) return { type: 'bandpass', frequency: 1800, q: 4, level: 0.12, dur: 0.04 * consLenScale }
    if (c.includes('g')) return { type: 'bandpass', frequency: 1200, q: 4, level: 0.09, dur: 0.04 * consLenScale }
    if (c.includes('h')) return { type: 'bandpass', frequency: 1500, q: 1, level: 0.12, dur: 0.10 * consLenScale }
    if (c.includes('m') || c.includes('n')) return { type: 'lowpass', frequency: 350, level: 0.15, dur: 0.06 * consLenScale }
    if (c.includes('c') || c.includes('j')) {
      // 'c' and 'j' matched no branch before, so "come"/"call"/"joy" had no onset at all and "cra"
      // fell through to the /r/ branch. Use a /k/ vs /dʒ/ burst.
      const isAffricate = c.includes('j')
      return {
        type: 'bandpass',
        frequency: isAffricate ? 2200 : 1800,
        q: isAffricate ? 2.5 : 4,
        level: isAffricate ? 0.10 : 0.12,
        dur: (isAffricate ? 0.06 : 0.04) * consLenScale,
      }
    }
    if (c.includes('l') || c.includes('r')) return { type: 'bandpass', frequency: 800, q: 1.5, level: 0.12, dur: 0.05 * consLenScale }
    if (c.includes('w') || c.includes('y')) return { type: 'lowpass', frequency: 600, level: 0.08, dur: 0.05 * consLenScale }
    return null
  }

  private consonantBurstLength(consonant: string, consLenScale: number): number {
    return this.consonantBurstSpec(consonant, consLenScale)?.dur ?? 0
  }

  private fireConsonantBurst(
    consonant: string,
    when: number,
    velocity: number,
    preset: VoicePreset,
    noiseBuffer: AudioBuffer,
    dest?: AudioNode
  ): number {
    const spec = this.consonantBurstSpec(consonant, preset.consonantLength ?? 1.0)
    if (!spec) return 0
    const ctx = this.ctx
    const consNoise = ctx.createBufferSource()
    const consFilter = ctx.createBiquadFilter()
    const consGain = ctx.createGain()
    consNoise.buffer = noiseBuffer
    consFilter.type = spec.type
    consFilter.frequency.setValueAtTime(spec.frequency, when)
    if (spec.q !== undefined) consFilter.Q.setValueAtTime(spec.q, when)
    consGain.gain.setValueAtTime(velocity * spec.level * (preset.consonantVolume ?? 1.0), when)
    consGain.gain.exponentialRampToValueAtTime(0.001, when + spec.dur)

    consNoise.connect(consFilter)
    consFilter.connect(consGain)
    consGain.connect(dest || this.rackInput)
    consNoise.start(when)
    consNoise.stop(when + spec.dur)

    const delayMs = (Math.max(0, when - ctx.currentTime) + spec.dur + 1.0) * 1000
    setTimeout(() => {
      try {
        consNoise.disconnect()
        consFilter.disconnect()
        consGain.disconnect()
      } catch (_) {}
    }, delayMs)
    return spec.dur
  }

  private parseSyllable(text: string): { vowel: string; consonant: string; diphthongTarget?: string; finalConsonant?: string } {
    if (!text) return { vowel: 'a', consonant: '' }
    const lower = text.toLowerCase().trim()

    // 1. Direct Phonetic Lexicon for Common Lyric & Singing Vocabulary
    const LEXICON: Record<string, { vowel: string; consonant: string; diphthongTarget?: string; finalConsonant?: string }> = {
      // Contractions & Pronouns
      "i": { vowel: 'a', consonant: '', diphthongTarget: 'i' },
      "i'm": { vowel: 'a', consonant: '', diphthongTarget: 'i', finalConsonant: 'm' },
      "im": { vowel: 'a', consonant: '', diphthongTarget: 'i', finalConsonant: 'm' },
      "i'll": { vowel: 'a', consonant: '', diphthongTarget: 'i' },
      "i've": { vowel: 'a', consonant: '', diphthongTarget: 'i' },
      "my": { vowel: 'a', consonant: 'm', diphthongTarget: 'i' },
      "mine": { vowel: 'a', consonant: 'm', diphthongTarget: 'i', finalConsonant: 'n' },
      "me": { vowel: 'i', consonant: 'm' },
      "we": { vowel: 'i', consonant: 'w' },
      "us": { vowel: 'a', consonant: '' },
      "our": { vowel: 'a', consonant: '', diphthongTarget: 'u' },
      "you": { vowel: 'u', consonant: 'y' },
      "u": { vowel: 'u', consonant: 'y' },
      "your": { vowel: 'o', consonant: 'y', finalConsonant: 'r' },
      "you're": { vowel: 'o', consonant: 'y', finalConsonant: 'r' },
      "yours": { vowel: 'o', consonant: 'y', finalConsonant: 'r' },
      "he": { vowel: 'i', consonant: 'h' },
      "she": { vowel: 'i', consonant: 'sh' },
      "they": { vowel: 'e', consonant: 'th', diphthongTarget: 'i' },
      "them": { vowel: 'e', consonant: 'th' },
      "their": { vowel: 'e', consonant: 'th' },
      "there": { vowel: 'e', consonant: 'th' },
      "who": { vowel: 'u', consonant: 'h' },
      "what": { vowel: 'a', consonant: 'wh' },
      "when": { vowel: 'e', consonant: 'wh' },
      "where": { vowel: 'e', consonant: 'wh' },
      // Common Verbs & Singing Words
      "do": { vowel: 'u', consonant: 'd' },
      "to": { vowel: 'u', consonant: 't' },
      "too": { vowel: 'u', consonant: 't' },
      "two": { vowel: 'u', consonant: 't' },
      "through": { vowel: 'u', consonant: 'thr' },
      "go": { vowel: 'o', consonant: 'g', diphthongTarget: 'u' },
      "no": { vowel: 'o', consonant: 'n', diphthongTarget: 'u' },
      "so": { vowel: 'o', consonant: 's', diphthongTarget: 'u' },
      "know": { vowel: 'o', consonant: 'n', diphthongTarget: 'u' },
      "love": { vowel: 'a', consonant: 'l', finalConsonant: 'v' },
      "come": { vowel: 'a', consonant: 'c' },
      "some": { vowel: 'a', consonant: 's' },
      "one": { vowel: 'a', consonant: 'w' },
      "won": { vowel: 'a', consonant: 'w' },
      "give": { vowel: 'i', consonant: 'g', finalConsonant: 'v' },
      "live": { vowel: 'i', consonant: 'l' },
      "have": { vowel: 'a', consonant: 'h' },
      "the": { vowel: 'e', consonant: 'th' },
      "and": { vowel: 'a', consonant: '' },
      "of": { vowel: 'a', consonant: '', finalConsonant: 'v' },
      "for": { vowel: 'o', consonant: 'f', finalConsonant: 'r' },
      "all": { vowel: 'o', consonant: '', finalConsonant: 'l' },
      "call": { vowel: 'o', consonant: 'c', finalConsonant: 'l' },
      "fall": { vowel: 'o', consonant: 'f', finalConsonant: 'l' },
      "say": { vowel: 'e', consonant: 's', diphthongTarget: 'i' },
      "day": { vowel: 'e', consonant: 'd', diphthongTarget: 'i' },
      "play": { vowel: 'e', consonant: 'pl', diphthongTarget: 'i' },
      "stay": { vowel: 'e', consonant: 'st', diphthongTarget: 'i' },
      "away": { vowel: 'e', consonant: 'w', diphthongTarget: 'i' },
      "way": { vowel: 'e', consonant: 'w', diphthongTarget: 'i' },
      "take": { vowel: 'e', consonant: 't', diphthongTarget: 'i', finalConsonant: 'k' },
      "make": { vowel: 'e', consonant: 'm', diphthongTarget: 'i', finalConsonant: 'k' },
      "break": { vowel: 'e', consonant: 'br', diphthongTarget: 'i', finalConsonant: 'k' },
      "time": { vowel: 'a', consonant: 't', diphthongTarget: 'i', finalConsonant: 'm' },
      "life": { vowel: 'a', consonant: 'l', diphthongTarget: 'i', finalConsonant: 'f' },
      "night": { vowel: 'a', consonant: 'n', diphthongTarget: 'i', finalConsonant: 't' },
      "light": { vowel: 'a', consonant: 'l', diphthongTarget: 'i', finalConsonant: 't' },
      "right": { vowel: 'a', consonant: 'r', diphthongTarget: 'i', finalConsonant: 't' },
      "bright": { vowel: 'a', consonant: 'br', diphthongTarget: 'i', finalConsonant: 't' },
      "shine": { vowel: 'a', consonant: 'sh', diphthongTarget: 'i', finalConsonant: 'n' },
      "sky": { vowel: 'a', consonant: 'sk', diphthongTarget: 'i' },
      "fly": { vowel: 'a', consonant: 'fl', diphthongTarget: 'i' },
      "why": { vowel: 'a', consonant: 'wh', diphthongTarget: 'i' },
      "try": { vowel: 'a', consonant: 'tr', diphthongTarget: 'i' },
      "cry": { vowel: 'a', consonant: 'cr', diphthongTarget: 'i' },
      "heart": { vowel: 'a', consonant: 'h', finalConsonant: 't' },
      "start": { vowel: 'a', consonant: 'st', finalConsonant: 't' },
      "world": { vowel: 'e', consonant: 'w', finalConsonant: 'd' },
      "girl": { vowel: 'e', consonant: 'g', finalConsonant: 'l' },
      "now": { vowel: 'a', consonant: 'n', diphthongTarget: 'u' },
      "how": { vowel: 'a', consonant: 'h', diphthongTarget: 'u' },
      "down": { vowel: 'a', consonant: 'd', diphthongTarget: 'u', finalConsonant: 'n' },
      "out": { vowel: 'a', consonant: '', diphthongTarget: 'u', finalConsonant: 't' },
      "boy": { vowel: 'o', consonant: 'b', diphthongTarget: 'i' },
      "joy": { vowel: 'o', consonant: 'j', diphthongTarget: 'i' },
      "voice": { vowel: 'o', consonant: 'v', diphthongTarget: 'i', finalConsonant: 's' },
      "blue": { vowel: 'u', consonant: 'bl' },
      "true": { vowel: 'u', consonant: 'tr' },
      "moon": { vowel: 'u', consonant: 'm', finalConsonant: 'n' },
      "see": { vowel: 'i', consonant: 's' },
      "feel": { vowel: 'i', consonant: 'f', finalConsonant: 'l' },
      "dream": { vowel: 'i', consonant: 'dr', finalConsonant: 'm' },
      "free": { vowel: 'i', consonant: 'fr' },
      // Daisy Bell chorus words & syllables
      "dai": { vowel: 'a', consonant: 'd', diphthongTarget: 'i' },
      "sy": { vowel: 'i', consonant: 's' },
      "an": { vowel: 'a', consonant: '', finalConsonant: 'n' },
      // "an-swer" is /ˈænsər/: the w is silent and the second syllable ends on /r/.
      "swer": { vowel: 'e', consonant: 's', finalConsonant: 'r' },
      // "cra-zy" is /ˈkreɪzi/: cra is the /eɪ/ half, not /a/.
      "cra": { vowel: 'e', consonant: 'cr', diphthongTarget: 'i' },
      "zy": { vowel: 'i', consonant: 'z' },
      "half": { vowel: 'a', consonant: 'h', finalConsonant: 'f' },
      "mm": { vowel: 'u', consonant: 'm' },
      // Solfege syllables
      "re": { vowel: 'e', consonant: 'r' },
      "mi": { vowel: 'i', consonant: 'm' },
      "fa": { vowel: 'a', consonant: 'f' },
      "sol": { vowel: 'o', consonant: 's' },
      "la": { vowel: 'a', consonant: 'l' },
      "ti": { vowel: 'i', consonant: 't' },
    }

    if (LEXICON[lower]) {
      return { ...LEXICON[lower] }
    }

    // 2. Rule-based phonetic analysis for arbitrary words / syllables
    let cons = ''
    let vowel = 'a'
    let diphthongTarget: string | undefined = undefined

    // Match leading consonant cluster (y is consonant only before a vowel)
    const consMatch = lower.match(/^([bcdfghjklmnpqrstvwxz]+|y(?=[aeiou]))/)
    if (consMatch) {
      cons = consMatch[1]
    }
    const rest = lower.slice(cons.length)

    // Check diphthongs / vowel digraphs
    if (/^(igh)/.test(rest)) {
      vowel = 'a'
      diphthongTarget = 'i'
    } else if (/^(ai|ay|ei|ey)/.test(rest)) {
      vowel = 'e'
      diphthongTarget = 'i'
    } else if (/^(oi|oy)/.test(rest)) {
      vowel = 'o'
      diphthongTarget = 'i'
    } else if (/^(ou|ow)/.test(rest)) {
      vowel = 'a'
      diphthongTarget = 'u'
    } else if (/^(oa)/.test(rest)) {
      vowel = 'o'
      diphthongTarget = 'u'
    } else if (/^(ee|ea|ie)/.test(rest)) {
      vowel = 'i'
    } else if (/^(oo|ew|ue)/.test(rest)) {
      vowel = 'u'
    } else if (/^(au|aw)/.test(rest)) {
      vowel = 'o'
    } else {
      // Magic 'e' rule (e.g. "cake", "time", "home", "tune")
      const magicMatch = rest.match(/^([aeiou])([bcdfghjklmnpqrstvwxyz])e$/)
      if (magicMatch) {
        const v = magicMatch[1]
        if (v === 'a') { vowel = 'e'; diphthongTarget = 'i'; }
        else if (v === 'i') { vowel = 'a'; diphthongTarget = 'i'; }
        else if (v === 'o') { vowel = 'o'; diphthongTarget = 'u'; }
        else if (v === 'u') { vowel = 'u'; }
        else { vowel = v }
      } else {
        // Single vowel extraction
        const vMatch = rest.match(/([aeiouy])/)
        if (vMatch) {
          vowel = vMatch[1]
          if (vowel === 'y') {
            if (lower.length <= 3) {
              vowel = 'a'
              diphthongTarget = 'i'
            } else {
              vowel = 'i'
            }
          }
        }
      }
    }

    // Final consonant cluster (coda). A silent trailing 'e' is stripped only when a vowel remains
    // ("give" -> "v"); in words where the e is the vowel ("the", "me") there is no coda. A bare final
    // h/w is part of the vowel spelling ("oh", "now"), not a consonant to release.
    let finalConsonant: string | undefined
    let codaSource = lower
    if (codaSource.endsWith('e')) {
      const stem = codaSource.slice(0, -1)
      codaSource = /[aeiouy]/.test(stem) ? stem : ''
    }
    if (codaSource) {
      const codaMatch = codaSource.match(/[bcdfghjklmnpqrstvwxz]+$/)
      if (codaMatch && codaMatch[0] !== 'h' && codaMatch[0] !== 'w') {
        finalConsonant = codaMatch[0]
      }
    }

    return { vowel, consonant: cons, diphthongTarget, finalConsonant }
  }
}

export const VOWEL_FORMANTS: Record<string, { f: number[], bw: number[], ampDb: number[] }> = {
  a: { f: [730, 1090, 2440, 3400, 4500], bw: [130, 100, 160, 250, 300], ampDb: [0, -4, -16, -22, -28] },
  e: { f: [530, 1840, 2480, 3400, 4500], bw: [110, 120, 180, 250, 300], ampDb: [0, -6, -14, -22, -28] },
  i: { f: [270, 2290, 3010, 3500, 4500], bw: [80,  140, 200, 250, 300], ampDb: [0, -8, -10, -22, -28] },
  o: { f: [570,  840, 2410, 3400, 4500], bw: [120, 100, 150, 250, 300], ampDb: [0, -3, -18, -22, -28] },
  u: { f: [300,  870, 2240, 3400, 4500], bw: [80,  110, 140, 250, 300], ampDb: [0, -5, -20, -22, -28] },
}

/** Physiological vocal tract cross-sectional area profiles (Story et al., 1996 MRI data) */
export const W_AREAS: Record<string, number[]> = {
  a: [0.7, 0.8, 1.0, 1.2, 1.6, 2.4, 3.8, 5.5, 7.0, 8.0, 8.5, 8.5],
  e: [2.0, 2.8, 3.4, 3.2, 2.4, 1.8, 1.5, 2.2, 3.4, 4.2, 4.5, 4.5],
  i: [4.5, 5.5, 6.0, 5.0, 3.0, 1.4, 0.7, 0.8, 1.8, 2.8, 3.6, 4.0],
  o: [1.6, 2.4, 3.2, 3.6, 2.8, 1.8, 1.1, 1.0, 1.4, 1.8, 1.1, 0.65],
  u: [2.2, 3.2, 4.2, 3.8, 2.5, 1.4, 0.9, 1.4, 2.6, 3.0, 1.0, 0.45],
}

class AudioEngine {
  private formulaCache: Map<string, Function> = new Map()
  private synths: Map<string, Tone.PolySynth> = new Map()
  private drums: Map<string, DrumMachine> = new Map()
  private overrideSynths: Map<string, Map<SynthPreset, Tone.PolySynth>> = new Map()
  private overrideDrums: Map<string, Map<DrumKit, DrumMachine>> = new Map()
  public customDspRegistry: Map<string, any> = new Map()
  private synthPresetByTrack: Map<string, string> = new Map()
  private drumKitByTrack: Map<string, string> = new Map()
  private racks: Map<string, TrackRack> = new Map()
  private samplers: Map<string, ChromaticSampler> = new Map()
  private lastSamplerUriByTrack: Map<string, string> = new Map()
  
  public getLiveFxNode(trackId: string, fxInstanceId: string): Tone.ToneAudioNode | undefined {
    const rack = this.racks.get(trackId);
    return rack?.fxNodes.get(fxInstanceId);
  }

  private wasmNode: AudioWorkletNode | null = null
  private trackIndexMap = new Map<string, number>()
  private freeIndices: number[] = []
  
  private getTrackWasmIndex(trackId: string): number {
    if (!this.trackIndexMap.has(trackId)) {
      const recycledIdx = this.freeIndices.pop();
      const idx = recycledIdx !== undefined ? recycledIdx : this.trackIndexMap.size;
      this.trackIndexMap.set(trackId, idx);
    }
    return this.trackIndexMap.get(trackId)!;
  }

  private masterLimiter = new Tone.Limiter(-1.5).toDestination()
  private metronome = new Tone.MembraneSynth()
  private metronomeChannel = new Tone.Channel()
  private isInitialized = false
  private fxModulatorEventId?: number
  private activeVoicePreviewGain: GainNode | null = null
  private activeVoicePreviewTimer: any = null
  private activeVoicePreviewGeneration = 0
  private vst3AutomationTimer: any = null
  private vst3AutomationLastTicks = 0

  constructor() {
    try {
      this.metronomeChannel.connect(this.masterLimiter)
      this.metronome.connect(this.metronomeChannel)
    } catch (_) {}
    this.setupTransport()
  }

  async init() {
    if (this.isInitialized) return
    this.isInitialized = true
    const state = useStore.getState()

    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      Tone.Transport.bpm.value = state.bpm
      this.applySwing(state.swing)
      this.applyLoop(state.loopEnabled, state.loopStart, state.loopEnd)
      state.tracks.forEach(track => this.applyTrackSettings(track))
      useStore.subscribe((state, prevState) => {
        if (state.tracks !== prevState.tracks || state.customFxConfigs !== prevState.customFxConfigs) {
          const currentIds = new Set(state.tracks.map(t => t.id))
          for (const oldTrack of prevState.tracks ?? []) {
            if (!currentIds.has(oldTrack.id)) {
              (window as any).juceAudioBridge.postCommand({ type: 'removeTrack', trackId: oldTrack.id })
            }
          }
          state.tracks.forEach((track, idx) => {
            if (track !== prevState.tracks?.[idx] || state.customFxConfigs !== prevState.customFxConfigs) {
              this.applyTrackSettings(track)
            }
          })
        }
      })
      setTimeout(() => {
        const latestState = useStore.getState();
        latestState.tracks.forEach(track => this.applyTrackSettings(track));
      }, 100);
      return
    }

    const targetSampleRate = state.studioSettings.sampleRate || 44100
    if (Tone.context.sampleRate !== targetSampleRate && Tone.context.state !== 'running') {
      try {
        const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        const nativeContext = new AudioCtx({ sampleRate: targetSampleRate })
        Tone.setContext(new Tone.Context(nativeContext))
      } catch (e) {
        console.warn('Could not set custom sample rate:', e)
      }
    }
    await Tone.start()
    Tone.Transport.bpm.value = state.bpm

    // Load WASM engine
    try {
      const raw = Tone.context.rawContext as any;
      const nativeContext: AudioContext = raw?._nativeAudioContext || raw?._nativeContext || raw?._context || raw;
      if (nativeContext && nativeContext.audioWorklet && (window.AudioWorkletNode || (nativeContext as any).createAudioWorkletNode)) {
        if (!(window as any).__wasmWorkletLoaded) {
          (window as any).__wasmWorkletLoaded = true;
          const response = await fetch('/audio-dsp.wasm');
          const wasmBytes = await response.arrayBuffer();

          await nativeContext.audioWorklet.addModule('/audio-processor.js');
          (window as any).__wasmBytes = wasmBytes;
        }

        this.wasmNode = new AudioWorkletNode(nativeContext, 'wasm-audio-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });

        this.wasmNode.port.postMessage({ type: 'wasm-module', module: (window as any).__wasmBytes });
        
        try {
          Tone.connect(this.wasmNode, this.masterLimiter);
        } catch (err) {
          let dest: any = this.masterLimiter;
          while (dest && dest.input !== undefined) dest = dest.input;
          const nativeDest = dest?._nativeAudioNode || dest?._gainNode || dest;
          this.wasmNode.connect(nativeDest);
        }

        this.wasmNode.port.postMessage({
          type: 'global-settings',
          sampleRate: Tone.context.sampleRate,
          bpm: state.bpm
        });

        console.log('WASM AudioWorklet Engine initialized successfully!');
      }
    } catch (e: any) {
      console.error('Failed to initialize WASM audio worklet engine:', e.name, e.message, e.stack);
    }

    this.applySwing(state.swing)
    this.applyLoop(state.loopEnabled, state.loopStart, state.loopEnd)
    this.applyMetronomeSettings(state.metronomeSettings)
    this.applyLimiterSettings(state.studioSettings.limiterEnabled, state.studioSettings.limiterThreshold)
    this.syncNativeMaster()
    state.tracks.forEach(track => this.applyTrackSettings(track))

    useStore.subscribe((state, prevState) => {
      if (state.tracks !== prevState.tracks || state.customFxConfigs !== prevState.customFxConfigs) {
        // Clean up override synths/drums for deleted tracks
        const activeTrackIds = new Set(state.tracks.map(t => t.id))

        // Clean up WASM track indices
        this.trackIndexMap.forEach((idx, trackId) => {
          if (!activeTrackIds.has(trackId)) {
            this.trackIndexMap.delete(trackId);
            this.freeIndices.push(idx);
            if (this.wasmNode) {
              this.wasmNode.port.postMessage({ type: 'track-param', trackId: idx, paramId: 5, value: 0.0 });
            }
          }
        });
        this.overrideSynths.forEach((presetMap, trackId) => {
          if (!activeTrackIds.has(trackId)) {
            presetMap.forEach(synth => synth.dispose())
            this.overrideSynths.delete(trackId)
          }
        })
        this.overrideDrums.forEach((kitMap, trackId) => {
          if (!activeTrackIds.has(trackId)) {
            kitMap.forEach(drum => drum.dispose())
            this.overrideDrums.delete(trackId)
          }
        })

        this.drums.forEach((drum, trackId) => {
          if (!activeTrackIds.has(trackId)) {
            drum.dispose()
            this.drums.delete(trackId)
            this.drumKitByTrack.delete(trackId)
          }
        })
        this.synths.forEach((synth, trackId) => {
          if (!activeTrackIds.has(trackId)) {
            synth.dispose()
            this.synths.delete(trackId)
            this.synthPresetByTrack.delete(trackId)
          }
        })

        // Clean up audio racks for deleted tracks to prevent audio engine crashes
        this.racks.forEach((rack, trackId) => {
          if (!activeTrackIds.has(trackId)) {
            if (rack.input) rack.input.dispose()
            if (rack.channel) rack.channel.dispose()
            rack.fxNodes.forEach(node => {
              if (node.dispose) node.dispose()
            })
            this.racks.delete(trackId)
          }
        })

        state.tracks.forEach(track => this.applyTrackSettings(track))
        this.pruneNativeNoteFxChains()
      }
      if (state.notes !== prevState.notes) {
        const prevById = new Map(prevState.notes.map(note => [note.id, note]))
        let idsChanged = state.notes.length !== prevState.notes.length
        let chainsChanged = false
        for (const note of state.notes) {
          const prev = prevById.get(note.id)
          if (!prev) {
            idsChanged = true
            if (note.fxInstances?.length) chainsChanged = true
            continue
          }
          const hadChain = Boolean(prev.fxInstances?.length)
          const hasChain = Boolean(note.fxInstances?.length)
          if ((hadChain || hasChain) && (prev.fxInstances !== note.fxInstances || prev.fxSettings !== note.fxSettings)) {
            chainsChanged = true
          }
        }
        if (chainsChanged) this.syncNoteVst3Overrides()
        if (idsChanged || chainsChanged) this.pruneNativeNoteFxChains()
      }
      if (state.groups !== prevState.groups) {
        // Group volume/mute/solo are applied on top of each member track.
        state.tracks.forEach(track => this.applyTrackSettings(track))
      }
      if (state.engineMode !== prevState.engineMode) {
        if (this.wasmNode) {
          this.wasmNode.port.postMessage({ type: 'note-off', trackId: -1, noteId: -1 });
        }
        this.synths.forEach(s => { try { s.releaseAll() } catch(_) {} });
        this.drums.forEach(d => {
          try { d.kick?.triggerRelease?.() } catch(_) {}
          try { d.snare?.triggerRelease?.() } catch(_) {}
        });
      }
      if (state.bpm !== prevState.bpm && this.wasmNode) {
        this.wasmNode.port.postMessage({
          type: 'global-settings',
          sampleRate: Tone.getContext().rawContext.sampleRate,
          bpm: state.bpm
        });
      }
      if (state.swing !== prevState.swing) {
        this.applySwing(state.swing)
      }
      if (state.loopEnabled !== prevState.loopEnabled ||
        state.loopStart !== prevState.loopStart ||
        state.loopEnd !== prevState.loopEnd) {
        this.applyLoop(state.loopEnabled, state.loopStart, state.loopEnd)
      }
      if (state.metronomeSettings !== prevState.metronomeSettings) {
        this.applyMetronomeSettings(state.metronomeSettings)
      }
      if (state.studioSettings.masterVolume !== prevState.studioSettings.masterVolume) {
        Tone.Destination.volume.value = Tone.gainToDb(state.studioSettings.masterVolume)
        this.syncNativeMaster()
      }
      if (state.studioSettings.limiterEnabled !== prevState.studioSettings.limiterEnabled ||
        state.studioSettings.limiterThreshold !== prevState.studioSettings.limiterThreshold) {
        this.applyLimiterSettings(state.studioSettings.limiterEnabled, state.studioSettings.limiterThreshold)
        this.syncNativeMaster()
      }
      if (state.studioSettings.proceduralFxEnabled !== prevState.studioSettings.proceduralFxEnabled ||
        state.studioSettings.proceduralFxRate !== prevState.studioSettings.proceduralFxRate) {
        this.applyFxModulatorSettings(state.studioSettings.proceduralFxEnabled, state.studioSettings.proceduralFxRate)
      }
    })

    this.applyFxModulatorSettings(state.studioSettings.proceduralFxEnabled, state.studioSettings.proceduralFxRate)

    this.isInitialized = true
  }

  private applyLimiterSettings(enabled: boolean, threshold: number) {
    try {
      if (this.masterLimiter && this.masterLimiter.threshold) {
        if (enabled) {
          this.masterLimiter.threshold.value = threshold
        } else {
          this.masterLimiter.threshold.value = 0 // effectively bypass at 0dBFS
        }
      }
    } catch (e) {
      console.warn("Failed to set master limiter threshold:", e)
    }
  }

  private applyFxModulatorSettings(enabled: boolean, rate: string) {
    if (this.fxModulatorEventId !== undefined) {
      Tone.Transport.clear(this.fxModulatorEventId)
      this.fxModulatorEventId = undefined
    }
    if (enabled) {
      this.fxModulatorEventId = Tone.Transport.scheduleRepeat(() => {
        this.evaluateFxModulators()
      }, rate)
    }
  }

  private getTrackFxSetting(track: Track, instId: string, instType: string, paramName: string, fallback: number): number {
    return readTrackFxSetting(track as any, instId, instType, paramName, fallback)
  }

  private evaluateFxModulators() {
    const state = useStore.getState()
    const t = Tone.Transport.seconds
    const ticks = Tone.Transport.ticks
    const b = ticks / Tone.Transport.PPQ
    const m = b / 4 // Basic assumption of 4/4 time

    state.tracks.forEach(track => {
      if (!track.fxModulators || Object.keys(track.fxModulators).length === 0) return

      const rack = this.racks.get(track.id)
      if (!rack) return

      Object.entries(track.fxModulators).forEach(([instanceId, mods]) => {
        const node = rack.fxNodes.get(instanceId)
        const inst = getTrackFxInstances(track.fxInstances).find(i => i.id === instanceId)
        if (!node || !inst) return

        if (node instanceof CustomScriptProcessorNode || node instanceof DPreverbNode) {
          // We could pass t to custom nodes if they accepted params over time, but skipping for now
          return
        }

        const applyParam = (paramName: string, fallback: number, applyFn: (val: number) => void) => {
          const mod = mods[paramName]
          if (!mod) return

          let fn = this.formulaCache.get(mod.formula)
          if (!fn) {
            try {
              fn = new Function('t', 'b', 'm', 'ticks', `return ${mod.formula}`)
              this.formulaCache.set(mod.formula, fn)
            } catch (e) {
              return
            }
          }

          let result: number
          try {
            result = fn(t, b, m, ticks)
          } catch (e) {
            return
          }
          if (!isFinite(result) || isNaN(result)) return

          const baseVal = this.getTrackFxSetting(track, instanceId, inst.type, paramName, fallback)
          let finalVal = baseVal

          if (mod.mode === 'override') finalVal = result
          else if (mod.mode === 'add') finalVal = baseVal + result
          else if (mod.mode === 'multiply') finalVal = baseVal * result

          applyFn(finalVal)
        }

        switch (inst.type) {
          case 'eq': {
            const eqNode = node as Tone.EQ3
            applyParam('lowGain', 0, v => { if (eqNode.low.value !== v) eqNode.low.value = v })
            applyParam('midGain', 0, v => { if (eqNode.mid.value !== v) eqNode.mid.value = v })
            applyParam('highGain', 0, v => { if (eqNode.high.value !== v) eqNode.high.value = v })
            break
          }
          case 'distortion': {
            const distNode = node as Tone.Distortion
            applyParam('wet', 0, v => { if (distNode.wet.value !== v) distNode.wet.value = Math.max(0, Math.min(1, v)) })
            applyParam('amount', 0.4, v => { if (distNode.distortion !== v) distNode.distortion = Math.max(0, Math.min(1, v)) })
            break
          }
          case 'chorus': {
            const chorusNode = node as Tone.Chorus
            applyParam('wet', 0, v => { if (chorusNode.wet.value !== v) chorusNode.wet.value = Math.max(0, Math.min(1, v)) })
            applyParam('frequency', 1.5, v => { if (chorusNode.frequency.value !== v) chorusNode.frequency.value = v })
            applyParam('delayTime', 3.5, v => { if (chorusNode.delayTime !== v) chorusNode.delayTime = v })
            applyParam('depth', 0.7, v => { if (chorusNode.depth !== v) chorusNode.depth = Math.max(0, Math.min(1, v)) })
            break
          }
          case 'phaser': {
            const phaserNode = node as Tone.Phaser
            applyParam('wet', 0, v => { if (phaserNode.wet.value !== v) phaserNode.wet.value = Math.max(0, Math.min(1, v)) })
            applyParam('frequency', 0.5, v => { if (phaserNode.frequency.value !== v) phaserNode.frequency.value = v })
            applyParam('baseFreq', 350, v => { if (phaserNode.baseFrequency !== v) phaserNode.baseFrequency = v })
            applyParam('octaves', 3, v => { if (phaserNode.octaves !== v) phaserNode.octaves = v })
            break
          }
          case 'delay': {
            const delayNode = node as Tone.FeedbackDelay
            applyParam('wet', 0, v => { if (delayNode.wet.value !== v) delayNode.wet.value = Math.max(0, Math.min(1, v)) })
            applyParam('time', 0.25, v => { if (delayNode.delayTime.value !== v) delayNode.delayTime.value = v })
            applyParam('feedback', 0.25, v => { if (delayNode.feedback.value !== v) delayNode.feedback.value = Math.max(0, Math.min(0.9, v)) })
            break
          }
          case 'reverb': {
            const reverbNode = node as Tone.Reverb
            applyParam('wet', 0, v => { if (reverbNode.wet.value !== v) reverbNode.wet.value = Math.max(0, Math.min(1, v)) })
            // NEVER modulate decay or preDelay in real-time, it triggers async OfflineAudioContext render per tick and crashes!
            break
          }
          case 'freeverb': {
            const freeverbNode = node as Tone.Freeverb
            applyParam('wet', 0, v => { if (freeverbNode.wet.value !== v) freeverbNode.wet.value = Math.max(0, Math.min(1, v)) })
            applyParam('roomSize', 0.7, v => { if (freeverbNode.roomSize.value !== v) freeverbNode.roomSize.value = Math.max(0, Math.min(1, v)) })
            applyParam('dampening', 4000, v => { if (freeverbNode.dampening !== v) freeverbNode.dampening = Math.max(0, Math.min(20000, v)) })
            break
          }
        }
      })
    })
  }

  private createRack(trackId: string): TrackRack {
    const input = new Tone.Gain()
    const channel = createTrackChannel({ volume: 0, pan: 0, mute: false, solo: false })
    const fxNodes = new Map<string, Tone.ToneAudioNode>()

    const defaultInstances = getTrackFxInstances()

    defaultInstances.forEach(inst => {
      try {
        fxNodes.set(inst.id, createFxNode(inst.type))
      } catch (e) {
        console.warn(`Failed to create FX node for ${inst.type}:`, e)
      }
    })

    try {
      let lastNode: Tone.ToneAudioNode = input
      defaultInstances.forEach(inst => {
        const node = fxNodes.get(inst.id)
        if (node) {
          try {
            lastNode.connect(node)
            lastNode = node
          } catch (_) {}
        }
      })
      try { lastNode.connect(channel) } catch (_) {}
    } catch (_) {}

    const rack = {
      input,
      channel,
      fxNodes,
      activeFxOrder: defaultInstances.map(inst => inst.id)
    }
    this.racks.set(trackId, rack)
    return rack
  }

  private getRack(trackId: string): TrackRack {
    return this.racks.get(trackId) ?? this.createRack(trackId)
  }

  private buildSamplerCommand(track: Track, allowPayload: boolean): any {
    const cfg = track.synthSampler
    const audio = cfg?.audioBase64 || ''
    const enabled = track.synthMode === 'sampler' && !!audio
    const payloadChanged = allowPayload && !!audio && this.lastSamplerUriByTrack.get(track.id) !== audio
    if (payloadChanged) this.lastSamplerUriByTrack.set(track.id, audio)
    const cmd: any = {
      type: 'setTrackSampler',
      trackId: track.id,
      enabled,
      loop: !!cfg?.loop,
      reverse: !!cfg?.reverse,
      rootNote: cfg?.rootNote ?? 60,
      tuning: cfg?.tuning ?? 0,
      fineTune: cfg?.fineTune ?? 0,
      startOffset: cfg?.startOffset ?? 0,
      endOffset: cfg?.endOffset ?? 1,
      attack: cfg?.attack ?? 0.005,
      decay: cfg?.decay ?? 0.25,
      sustain: cfg?.sustain ?? 0.6,
      release: cfg?.release ?? 0.35,
      volume: cfg?.volume ?? 1,
      pan: cfg?.pan ?? 0
    }
    if (payloadChanged) cmd.audioBase64 = cfg!.audioBase64
    return cmd
  }

  private syncSynthSampler(track: Track) {
    const existing = this.samplers.get(track.id)
    if (track.synthMode !== 'sampler' || !track.synthSampler) {
      if (existing) {
        try { existing.dispose() } catch (_) {}
        this.samplers.delete(track.id)
      }
      return
    }
    const rack = this.getRack(track.id)
    const dest = rack.input.input as GainNode
    if (!existing) {
      this.samplers.set(track.id, new ChromaticSampler(dest, track.synthSampler))
    } else {
      existing.updateConfig(track.synthSampler)
    }
  }

  getSynthSampler(trackId: string): ChromaticSampler | undefined {
    return this.samplers.get(trackId)
  }

  async loadSynthSamplerBuffer(dataUri: string): Promise<AudioBuffer | null> {
    const ctx = Tone.getContext().rawContext as AudioContext
    const cached = ChromaticSampler.peek(dataUri)
    if (cached) return cached
    try {
      const ab = await (await fetch(dataUri)).arrayBuffer()
      return await ctx.decodeAudioData(ab)
    } catch (e) {
      console.warn('Synth sampler buffer decode failed:', e)
      return null
    }
  }

  /** Native master bus: the JUCE engine applies gain before its limiter. */
  private syncNativeMaster() {
    if (!(window as any).__isJuceNative__ || !(window as any).juceAudioBridge) return
    const settings = useStore.getState().studioSettings
    ;(window as any).juceAudioBridge.postCommand({
      type: 'setMasterVolume',
      volume: settings.masterVolume
    })
    ;(window as any).juceAudioBridge.postCommand({
      type: 'setMasterLimiter',
      enabled: settings.limiterEnabled,
      threshold: settings.limiterThreshold
    })
  }

  /**
   * Ordered native track rack. Duplicates are kept, VST3 steps keep their UI instance id and
   * custom JS effects are skipped because JUCE cannot execute browser scripts.
   */
  private buildNativeTrackFxChain(track: Track) {
    const effects: Array<Record<string, unknown>> = []
    for (const inst of getTrackFxInstances(track.fxInstances)) {
      const bypassed = this.isFxBypassed(track, inst) ? 1 : 0
      const getV = (param: string, fallback: number) =>
        this.getTrackFxSetting(track, inst.id, inst.type, param, fallback)

      if (inst.type === 'vst3') {
        if (!inst.pluginId) continue
        effects.push({
          instanceId: inst.id,
          type: 'vst3',
          pluginId: inst.pluginId,
          bypassed,
          wet: bypassed ? 0 : getV('wet', 1)
        })
        continue
      }

      let params: Record<string, number> | undefined
      switch (inst.type) {
        case 'eq':
          params = { lowGain: getV('lowGain', 0), midGain: getV('midGain', 0), highGain: getV('highGain', 0) }
          break
        case 'filter':
          params = { cutoff: getV('frequency', 20000), resonance: getV('Q', 1) }
          break
        case 'distortion':
          params = { amount: getV('amount', 0.4), wet: getV('wet', 0) }
          break
        case 'chorus':
          params = {
            wet: getV('wet', 0), frequency: getV('frequency', 1.5),
            depth: getV('depth', 0.7), delayTime: getV('delayTime', 3.5)
          }
          break
        case 'phaser':
          params = {
            wet: getV('wet', 0), frequency: getV('frequency', 0.5),
            baseFreq: getV('baseFreq', 350), octaves: getV('octaves', 3)
          }
          break
        case 'delay':
          params = { time: getV('time', 0.25), feedback: getV('feedback', 0.25), wet: getV('wet', 0) }
          break
        case 'dpreverb':
          params = {
            wet: getV('wet', 0), tail: getV('tail', 2),
            decay: getV('decay', 0.65), tone: getV('tone', 0.55)
          }
          break
        case 'reverb': {
          const decay = getV('decay', -1)
          params = {
            wet: getV('wet', 0),
            roomSize: decay >= 0 ? Math.min(0.98, Math.max(0.05, decay / 10)) : getV('roomSize', 0.7),
            damping: getV('damping', 0.5),
            preDelay: getV('preDelay', 0.01)
          }
          break
        }
        case 'freeverb':
          params = { wet: getV('wet', 0), roomSize: getV('roomSize', 0.7), dampening: getV('dampening', 4000) }
          break
        case 'bitcrusher':
        case 'custom-bitcrusher':
          params = {
            drive: getV('drive', 1.5), bits: getV('bits', 8),
            dive: getV('dive', 0.5), mix: getV('mix', 0.5)
          }
          break
        default:
          continue
      }

      effects.push({ instanceId: inst.id, type: inst.type, bypassed, params })
    }

    return {
      effects,
      signature: JSON.stringify(effects)
    }
  }

  private applyTrackSettings(track: Track) {
    const effective = getEffectiveTrackLevel(track, useStore.getState().groups)
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'createTrack',
        trackId: track.id,
        instrument: track.instrument || 'synth'
      });
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackInstrument',
        trackId: track.id,
        instrument: track.instrument || 'synth'
      });
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackParam',
        trackId: track.id,
        param: 'volume',
        value: effective.volume
      });
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackParam',
        trackId: track.id,
        param: 'pan',
        value: track.pan
      });
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackParam',
        trackId: track.id,
        param: 'muted',
        value: effective.muted ? 1 : 0
      });
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackParam',
        trackId: track.id,
        param: 'soloed',
        value: effective.soloed ? 1 : 0
      });
      if (track.synthPreset) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setTrackPreset',
          trackId: track.id,
          preset: track.synthPreset
        });
      }
      if (track.synthOscillator) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setTrackParam',
          trackId: track.id,
          param: 'oscType',
          value: track.synthOscillator
        });
      }
      if (track.synthAttack !== undefined) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setTrackParam',
          trackId: track.id,
          param: 'attack',
          value: track.synthAttack
        });
      }
      if (track.synthDecay !== undefined) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setTrackParam',
          trackId: track.id,
          param: 'decay',
          value: track.synthDecay
        });
      }
      if (track.synthSustain !== undefined) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setTrackParam',
          trackId: track.id,
          param: 'sustain',
          value: track.synthSustain
        });
      }
      if (track.synthRelease !== undefined) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setTrackParam',
          trackId: track.id,
          param: 'release',
          value: track.synthRelease
        });
      }
      if (track.drumKit) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setTrackKit',
          trackId: track.id,
          kitName: track.drumKit
        });
      }

      if (track.vst3InstrumentId) {
        (window as any).juceAudioBridge.postCommand({
          type: 'setTrackVst3Instrument',
          trackId: track.id,
          pluginId: track.vst3InstrumentId
        });
      } else {
        (window as any).juceAudioBridge.postCommand({
          type: 'removeTrackVst3Instrument',
          trackId: track.id
        });
      }

      (window as any).juceAudioBridge.postCommand(this.buildSamplerCommand(track, true));

      const activeFx = getTrackFxInstances(track.fxInstances);
      activeFx.forEach(inst => {
        if (inst.type === 'vst3' && inst.pluginId) {
          const isBypassed = this.isFxBypassed(track, inst);
          (window as any).juceAudioBridge.postCommand({
            type: 'addTrackVst3Fx',
            trackId: track.id,
            fxId: inst.id,
            pluginId: inst.pluginId
          });
          (window as any).juceAudioBridge.postCommand({
            type: 'setTrackVst3FxBypass',
            trackId: track.id,
            fxId: inst.id,
            bypassed: isBypassed
          });
          const wet = isBypassed ? 0.0 : this.getTrackFxSetting(track, inst.id, inst.type, 'wet', 1.0);
          (window as any).juceAudioBridge.postCommand({
            type: 'setTrackVst3FxWet',
            trackId: track.id,
            fxId: inst.id,
            wet
          });
          return;
        }
        const isBypassed = this.isFxBypassed(track, inst);
        if (isBypassed) {
          if (inst.type === 'distortion') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'distortion', param: 'wet', value: 0 });
          } else if (inst.type === 'bitcrusher' || inst.type === 'custom-bitcrusher') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'bitcrusher', param: 'mix', value: 0 });
          } else if (inst.type === 'delay') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'delay', param: 'wet', value: 0 });
          } else if (inst.type === 'dpreverb') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'dpreverb', param: 'wet', value: 0 });
          } else if (inst.type === 'reverb') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'reverb', param: 'wet', value: 0 });
          } else if (inst.type === 'freeverb') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'freeverb', param: 'wet', value: 0 });
          } else if (inst.type === 'chorus') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'chorus', param: 'wet', value: 0 });
          } else if (inst.type === 'phaser') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'phaser', param: 'wet', value: 0 });
          } else if (inst.type === 'filter') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'filter', param: 'cutoff', value: 20000 });
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'filter', param: 'resonance', value: 1 });
          } else if (inst.type === 'eq') {
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'eq', param: 'lowGain', value: 0 });
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'eq', param: 'midGain', value: 0 });
            (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'eq', param: 'highGain', value: 0 });
          }
          return;
        }

        const getV = (param: string, fallback: number) => this.getTrackFxSetting(track, inst.id, inst.type, param, fallback);
        if (inst.type === 'filter') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'filter', param: 'cutoff', value: getV('frequency', 20000) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'filter', param: 'resonance', value: getV('Q', 1) });
        } else if (inst.type === 'distortion') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'distortion', param: 'amount', value: getV('amount', 0.4) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'distortion', param: 'wet', value: getV('wet', 0) });
        } else if (inst.type === 'delay') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'delay', param: 'time', value: getV('time', 0.25) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'delay', param: 'feedback', value: getV('feedback', 0.25) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'delay', param: 'wet', value: getV('wet', 0) });
        } else if (inst.type === 'dpreverb') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'dpreverb', param: 'tail', value: getV('tail', 2) / 10.0 });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'dpreverb', param: 'tone', value: getV('tone', 0.55) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'dpreverb', param: 'wet', value: getV('wet', 0) });
        } else if (inst.type === 'reverb') {
          const rawDecay = getV('decay', -1);
          const roomSize = rawDecay >= 0 ? Math.min(1.0, Math.max(0.0, rawDecay / 10.0)) : getV('roomSize', 0.7);
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'reverb', param: 'roomSize', value: roomSize });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'reverb', param: 'wet', value: getV('wet', 0) });
        } else if (inst.type === 'freeverb') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'freeverb', param: 'roomSize', value: getV('roomSize', 0.7) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'freeverb', param: 'dampening', value: getV('dampening', 4000) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'freeverb', param: 'wet', value: getV('wet', 0) });
        } else if (inst.type === 'chorus') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'chorus', param: 'wet', value: getV('wet', 0) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'chorus', param: 'rate', value: getV('frequency', 1.5) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'chorus', param: 'depth', value: getV('depth', 0.7) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'chorus', param: 'delayTime', value: getV('delayTime', 3.5) });
        } else if (inst.type === 'phaser') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'phaser', param: 'wet', value: getV('wet', 0) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'phaser', param: 'rate', value: getV('frequency', 0.5) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'phaser', param: 'baseFreq', value: getV('baseFreq', 350) });
        } else if (inst.type === 'eq') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'eq', param: 'lowGain', value: getV('lowGain', 0) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'eq', param: 'midGain', value: getV('midGain', 0) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'eq', param: 'highGain', value: getV('highGain', 0) });
        } else if (inst.type === 'custom-bitcrusher' || inst.type === 'bitcrusher') {
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'bitcrusher', param: 'drive', value: getV('drive', 1.5) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'bitcrusher', param: 'bits', value: getV('bits', 8) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'bitcrusher', param: 'dive', value: getV('dive', 0.5) });
          (window as any).juceAudioBridge.postCommand({ type: 'setTrackFx', trackId: track.id, fxType: 'bitcrusher', param: 'mix', value: getV('mix', 0.5) });
        }
      });

      const nativeChain = this.buildNativeTrackFxChain(track);
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackFxChain',
        trackId: track.id,
        signature: nativeChain.signature,
        effects: JSON.stringify(nativeChain.effects)
      });
      return; // Handled natively in JUCE C++! Avoid running WebAudio graph.
    }

    try {
      const rack = this.getRack(track.id)
      this.ensureInstrumentForTrack(track)
      this.syncSynthSampler(track)

    const activeFxInstances = getTrackFxInstances(track.fxInstances)

    // 1. Ensure all active instances have instantiated nodes in rack.fxNodes
    activeFxInstances.forEach(inst => {
      if (!rack.fxNodes.has(inst.id)) {
        rack.fxNodes.set(inst.id, createFxNode(inst.type))
      }
    })

    // 2. Dispose of any nodes that are no longer in the activeFxInstances list
    for (const [id, node] of rack.fxNodes.entries()) {
      if (!activeFxInstances.some(inst => inst.id === id)) {
        node.disconnect()
        node.dispose()
        rack.fxNodes.delete(id)
      }
    }

    // 3. Connect active, non-bypassed nodes in series
    const connectedFxInstances = activeFxInstances.filter(inst => !this.isFxBypassed(track, inst))
    const connectedIds = connectedFxInstances.map(inst => inst.id)
    const orderChanged = !rack.activeFxOrder ||
      rack.activeFxOrder.length !== connectedIds.length ||
      rack.activeFxOrder.some((val, idx) => val !== connectedIds[idx])

    if (orderChanged) {
      rack.input.disconnect()
      for (const node of rack.fxNodes.values()) {
        node.disconnect()
      }

      let lastNode: Tone.ToneAudioNode = rack.input
      connectedFxInstances.forEach(inst => {
        const currentNode = rack.fxNodes.get(inst.id)
        if (currentNode) {
          lastNode.connect(currentNode)
          lastNode = currentNode
        }
      })
      lastNode.connect(rack.channel)
      rack.activeFxOrder = [...connectedIds]

      // Re-establish internal bridges for CustomScriptProcessorNodes
      // (their internal native connections get destroyed by disconnect() above)
      for (const node of rack.fxNodes.values()) {
        if (node instanceof CustomScriptProcessorNode) {
          node.reconnectBridge()
        }
      }
    }

    // 4. General channel settings
    rack.channel.volume.value = Tone.gainToDb(Math.max(0.0001, effective.volume))
    setTrackChannelPan(rack.channel, track.pan)
    rack.channel.mute = effective.muted
    rack.channel.solo = effective.soloed

    if (this.wasmNode) {
      const wasmIdx = this.getTrackWasmIndex(track.id);
      const instType = track.instrument === 'drum' ? 1 : 0;
      this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 11, value: instType });
      this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 5, value: effective.muted ? 0.0 : effective.volume });
      this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 6, value: track.pan });

      if (instType === 0) {
        const preset = track.synthPreset || 'warm';
        let oscStr = track.synthOscillator;
        let attack = track.synthAttack;
        let decay = track.synthDecay;
        let sustain = track.synthSustain;
        let release = track.synthRelease;

        if (oscStr === undefined || attack === undefined || decay === undefined || sustain === undefined || release === undefined) {
          if (preset === 'piano') {
            if (oscStr === undefined) oscStr = 'triangle';
            if (attack === undefined) attack = 0.004;
            if (decay === undefined) decay = 0.28;
            if (sustain === undefined) sustain = 0.16;
            if (release === undefined) release = 0.36;
          } else if (preset === 'electricPiano') {
            if (oscStr === undefined) oscStr = 'sine';
            if (attack === undefined) attack = 0.01;
            if (decay === undefined) decay = 0.32;
            if (sustain === undefined) sustain = 0.22;
            if (release === undefined) release = 0.45;
          } else if (preset === 'marimba') {
            if (oscStr === undefined) oscStr = 'sine';
            if (attack === undefined) attack = 0.003;
            if (decay === undefined) decay = 0.28;
            if (sustain === undefined) sustain = 0.05;
            if (release === undefined) release = 0.22;
          } else if (preset === 'bright') {
            if (oscStr === undefined) oscStr = 'sawtooth';
            if (attack === undefined) attack = 0.01;
            if (decay === undefined) decay = 0.08;
            if (sustain === undefined) sustain = 0.42;
            if (release === undefined) release = 0.18;
          } else if (preset === 'pluck') {
            if (oscStr === undefined) oscStr = 'square';
            if (attack === undefined) attack = 0.002;
            if (decay === undefined) decay = 0.16;
            if (sustain === undefined) sustain = 0.12;
            if (release === undefined) release = 0.12;
          } else if (preset === 'pad') {
            if (oscStr === undefined) oscStr = 'sine';
            if (attack === undefined) attack = 0.18;
            if (decay === undefined) decay = 0.25;
            if (sustain === undefined) sustain = 0.7;
            if (release === undefined) release = 0.9;
          } else if (preset === 'bass') {
            if (oscStr === undefined) oscStr = 'square';
            if (attack === undefined) attack = 0.01;
            if (decay === undefined) decay = 0.16;
            if (sustain === undefined) sustain = 0.55;
            if (release === undefined) release = 0.18;
          } else if (preset === 'bell') {
            if (oscStr === undefined) oscStr = 'sine';
            if (attack === undefined) attack = 0.002;
            if (decay === undefined) decay = 0.7;
            if (sustain === undefined) sustain = 0.05;
            if (release === undefined) release = 1.2;
          } else {
            // default / warm / custom
            if (oscStr === undefined) oscStr = 'sine';
            if (attack === undefined) attack = 0.005;
            if (decay === undefined) decay = 0.15;
            if (sustain === undefined) sustain = 0.7;
            if (release === undefined) release = 0.25;
          }
        }

        let oscType = 0;
        if (oscStr === 'sine') oscType = 0;
        else if (oscStr === 'triangle') oscType = 1;
        else if (oscStr === 'square') oscType = 2;
        else if (oscStr === 'sawtooth' || (oscStr as string) === 'saw') oscType = 3;
        else if (oscStr === 'custom') oscType = 1;

        this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 0, value: oscType });
        this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 1, value: attack });
        this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 2, value: decay });
        this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 3, value: sustain });
        this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 4, value: release });
      }

      let distAmt = 0.0;
      let delayWet = 0.0;
      let delayTime = 0.25;
      let delayFb = 0.25;

      activeFxInstances.forEach(inst => {
        if (this.isFxBypassed(track, inst)) return;
        if (inst.type === 'distortion') {
          distAmt = this.getTrackFxSetting(track, inst.id, inst.type, 'amount', 0.4);
        } else if (inst.type === 'delay') {
          delayWet = this.getTrackFxSetting(track, inst.id, inst.type, 'wet', 0.0);
          delayTime = this.getTrackFxSetting(track, inst.id, inst.type, 'time', 0.25);
          delayFb = this.getTrackFxSetting(track, inst.id, inst.type, 'feedback', 0.25);
        }
      });

      this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 7, value: distAmt });
      this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 10, value: delayWet });
      this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 8, value: delayTime });
      this.wasmNode.port.postMessage({ type: 'track-param', trackId: wasmIdx, paramId: 9, value: delayFb });
    }

    // 5. Apply the parameter values for each node dynamically
    activeFxInstances.forEach(inst => {
      const node = rack.fxNodes.get(inst.id)
      if (!node) return

      const settings = track.fxSettings?.[inst.id] ?? {}

      if (node instanceof CustomScriptProcessorNode) {
        const config = useStore.getState().customFxConfigs.find(c => c.id === inst.type)
        if (config?.mode === 'offline') return
        if (config) {
          node.compileCode(config.code)
          node.setParams(settings)
          node.setHostContext({
            trackId: track.id,
            trackName: track.name,
            fxInstanceId: inst.id,
            fxType: inst.type,
            bpm: useStore.getState().bpm,
            mode: config.mode ?? 'realtime'
          })
        }
        return
      }

      if (node instanceof DPreverbNode) return

      const getVal = (paramName: string, fallback: number) => {
        return this.getTrackFxSetting(track, inst.id, inst.type, paramName, fallback)
      }

      switch (inst.type) {
        case 'eq': {
          const eqNode = node as Tone.EQ3
          const lowGain = getVal('lowGain', 0)
          if (eqNode.low.value !== lowGain && !track.fxModulators?.[inst.id]?.lowGain) eqNode.low.value = lowGain
          const midGain = getVal('midGain', 0)
          if (eqNode.mid.value !== midGain && !track.fxModulators?.[inst.id]?.midGain) eqNode.mid.value = midGain
          const highGain = getVal('highGain', 0)
          if (eqNode.high.value !== highGain && !track.fxModulators?.[inst.id]?.highGain) eqNode.high.value = highGain
          break
        }
        case 'distortion': {
          const distNode = node as Tone.Distortion
          const wet = getVal('wet', 0)
          if (distNode.wet.value !== wet && !track.fxModulators?.[inst.id]?.wet) distNode.wet.value = wet
          const amount = getVal('amount', 0.4)
          if (distNode.distortion !== amount && !track.fxModulators?.[inst.id]?.amount) distNode.distortion = amount
          break
        }
        case 'chorus': {
          const chorusNode = node as Tone.Chorus
          const wet = getVal('wet', 0)
          if (chorusNode.wet.value !== wet && !track.fxModulators?.[inst.id]?.wet) chorusNode.wet.value = wet
          const freq = getVal('frequency', 1.5)
          if (chorusNode.frequency.value !== freq && !track.fxModulators?.[inst.id]?.frequency) chorusNode.frequency.value = freq
          const delayTime = getVal('delayTime', 3.5)
          if (chorusNode.delayTime !== delayTime && !track.fxModulators?.[inst.id]?.delayTime) chorusNode.delayTime = delayTime
          const depth = getVal('depth', 0.7)
          if (chorusNode.depth !== depth && !track.fxModulators?.[inst.id]?.depth) chorusNode.depth = depth
          break
        }
        case 'phaser': {
          const phaserNode = node as Tone.Phaser
          const wet = getVal('wet', 0)
          if (phaserNode.wet.value !== wet && !track.fxModulators?.[inst.id]?.wet) phaserNode.wet.value = wet
          const freq = getVal('frequency', 0.5)
          if (phaserNode.frequency.value !== freq && !track.fxModulators?.[inst.id]?.frequency) phaserNode.frequency.value = freq
          const baseFreq = getVal('baseFreq', 350)
          if (phaserNode.baseFrequency !== baseFreq && !track.fxModulators?.[inst.id]?.baseFreq) phaserNode.baseFrequency = baseFreq
          const octaves = getVal('octaves', 3)
          if (phaserNode.octaves !== octaves && !track.fxModulators?.[inst.id]?.octaves) phaserNode.octaves = octaves
          break
        }
        case 'delay': {
          const delayNode = node as Tone.FeedbackDelay
          const wet = getVal('wet', 0)
          if (delayNode.wet.value !== wet && !track.fxModulators?.[inst.id]?.wet) delayNode.wet.value = wet
          const delayTime = getVal('time', 0.25)
          if (delayNode.delayTime.value !== delayTime && !track.fxModulators?.[inst.id]?.time) delayNode.delayTime.value = delayTime
          const feedback = getVal('feedback', 0.25)
          if (delayNode.feedback.value !== feedback && !track.fxModulators?.[inst.id]?.feedback) delayNode.feedback.value = feedback
          break
        }
        case 'reverb': {
          const reverbNode = node as Tone.Reverb
          const wet = getVal('wet', 0)
          if (reverbNode.wet.value !== wet && !track.fxModulators?.[inst.id]?.wet) reverbNode.wet.value = wet
          const decay = getVal('decay', 2.5)
          const preDelay = getVal('preDelay', 0.01)

          if (reverbNode.decay !== decay || reverbNode.preDelay !== preDelay) {
            // Recreating the node prevents concurrent 'generate()' render races which poison the WebAudio graph with NaN buffers
            let newReverb: Tone.Reverb | null = null
            try {
              newReverb = new Tone.Reverb({ decay, preDelay, wet: reverbNode.wet.value })
            } catch (e) {
              console.warn('Failed to recreate Tone.Reverb:', e)
            }

            if (newReverb) {
              // Reconnect the graph safely
              const currentIndex = rack.activeFxOrder?.indexOf(inst.id) ?? -1
              if (currentIndex !== -1) {
                const prevId = currentIndex > 0 ? rack.activeFxOrder![currentIndex - 1] : null
                const nextId = currentIndex < rack.activeFxOrder!.length - 1 ? rack.activeFxOrder![currentIndex + 1] : null

                const prevNode = prevId ? rack.fxNodes.get(prevId) : rack.input
                const nextNode = nextId ? rack.fxNodes.get(nextId) : rack.channel

                if (prevNode) {
                  prevNode.disconnect()
                  prevNode.connect(newReverb)
                }
                if (nextNode) {
                  newReverb.connect(nextNode)
                }
              }

              rack.fxNodes.set(inst.id, newReverb)
              reverbNode.dispose()
            }
          }
          break
        }
        case 'freeverb': {
          const freeverbNode = node as Tone.Freeverb
          const wet = getVal('wet', 0)
          if (freeverbNode.wet.value !== wet && !track.fxModulators?.[inst.id]?.wet) freeverbNode.wet.value = wet
          const roomSize = getVal('roomSize', 0.7)
          if (freeverbNode.roomSize.value !== roomSize && !track.fxModulators?.[inst.id]?.roomSize) freeverbNode.roomSize.value = roomSize
          const dampening = getVal('dampening', 4000)
          if (freeverbNode.dampening !== dampening && !track.fxModulators?.[inst.id]?.dampening) freeverbNode.dampening = dampening
          break
        }
      }
    })

    // Apply drum piece overrides if this is a drum machine
    const drum = this.drums.get(track.id)
    if (drum) {
      drum.drumDecays = track.drumDecays
      drum.customMuxins = track.customMuxins
      if (track.drumKickOctaves !== undefined) drum.kick.octaves = track.drumKickOctaves
      if (track.drumKickPitchDecay !== undefined) drum.kick.pitchDecay = track.drumKickPitchDecay
      if (track.drumKickDecay !== undefined) drum.kick.envelope.decay = track.drumKickDecay
      if (track.drumSnareDecay !== undefined) drum.snare.envelope.decay = track.drumSnareDecay
      if (track.drumClapDecay !== undefined) drum.clap.envelope.decay = track.drumClapDecay
      if (track.drumTomDecay !== undefined) {
        drum.tomLow.envelope.decay = track.drumTomDecay
        drum.tomMid.envelope.decay = track.drumTomDecay * 0.75
        drum.tomHigh.envelope.decay = track.drumTomDecay * 0.5
      }
      if (track.drumCrashDecay !== undefined) drum.crash.envelope.decay = track.drumCrashDecay
      if (track.drumRideDecay !== undefined) drum.ride.envelope.decay = track.drumRideDecay
      if (track.drumCowbellDecay !== undefined) drum.cowbell.envelope.decay = track.drumCowbellDecay
      if (track.drumTambourineDecay !== undefined) drum.tambourine.envelope.decay = track.drumTambourineDecay
      if (track.drumCongaDecay !== undefined) {
        drum.congaLow.envelope.decay = track.drumCongaDecay
        drum.congaHigh.envelope.decay = track.drumCongaDecay * 0.8
      }
      if (track.drumClavesDecay !== undefined) drum.claves.envelope.decay = track.drumClavesDecay
      if (track.drumRimshotDecay !== undefined) drum.rimshot.envelope.decay = track.drumRimshotDecay

      if (track.drumTambourineTone !== undefined) drum.tambourine.noise.type = track.drumTambourineTone > 0.5 ? 'white' : 'pink'
      if (track.drumCongaPitch !== undefined) {
        drum.congaLow.octaves = track.drumCongaPitch
        drum.congaHigh.octaves = track.drumCongaPitch
      }
      if (track.drumClavesPitch !== undefined) drum.claves.octaves = track.drumClavesPitch
      if (track.drumRimshotTone !== undefined) drum.rimshot.noise.type = track.drumRimshotTone > 0.5 ? 'brown' : 'white'

      if (track.drumSnareTone !== undefined) drum.snare.noise.type = track.drumSnareTone > 0.5 ? 'white' : 'brown'
      if (track.drumHihatTone !== undefined) {
        drum.hihatClosed.harmonicity = track.drumHihatTone
        drum.hihatOpen.harmonicity = track.drumHihatTone
      }
      if (track.drumHihatResonance !== undefined) {
        drum.hihatClosed.resonance = track.drumHihatResonance
        drum.hihatOpen.resonance = track.drumHihatResonance
      }
      if (track.drumClapTone !== undefined) drum.clap.noise.type = track.drumClapTone > 0.5 ? 'white' : 'pink'

      if (track.drumCymbalResonance !== undefined) {
        drum.crash.resonance = track.drumCymbalResonance
        drum.ride.resonance = track.drumCymbalResonance
      }
      if (track.drumCymbalTone !== undefined) {
        drum.crash.harmonicity = track.drumCymbalTone
        drum.ride.harmonicity = track.drumCymbalTone
      }
      if (track.drumCowbellTone !== undefined) drum.cowbell.harmonicity = track.drumCowbellTone
      if (track.drumHihatDecay !== undefined) {
        drum.hihatClosed.envelope.decay = track.drumHihatDecay
        drum.hihatOpen.envelope.decay = track.drumHihatDecay * 3 // proportional
      }
    }

    // Apply synth envelope overrides
    const synth = this.synths.get(track.id)
    if (synth) {
      if (track.synthAttack !== undefined) synth.set({ envelope: { attack: track.synthAttack } })
      if (track.synthDecay !== undefined) synth.set({ envelope: { decay: track.synthDecay } })
      if (track.synthSustain !== undefined) synth.set({ envelope: { sustain: track.synthSustain } })
      if (track.synthRelease !== undefined) synth.set({ envelope: { release: track.synthRelease } })

      if (track.synthOscillator !== undefined) {
        if (track.synthOscillator === 'custom' && track.synthFormula) {
          try {
            const partials = calculateFourierPartials(track.synthFormula, track.synthPartialsCount || 16)
            synth.set({ oscillator: { type: 'custom', partials } as any })
          } catch (e) {
            console.warn('Failed to set custom formula oscillator:', e)
          }
        } else if (track.synthOscillator !== 'custom') {
          synth.set({ oscillator: { type: track.synthOscillator } })
        }
      }
      if (track.synthDetune !== undefined) synth.set({ detune: track.synthDetune })
      if (track.synthPortamento !== undefined) synth.set({ portamento: track.synthPortamento })

      // Filter logic is slightly more complex as it depends on the synth type
      // But we can usually set it if the synth has a filter property
      const anySynth = synth as any
      if (track.synthFilterFreq !== undefined || track.synthFilterQ !== undefined) {
        if (anySynth.filter) {
          if (track.synthFilterFreq !== undefined) anySynth.filter.frequency.value = track.synthFilterFreq
          if (track.synthFilterQ !== undefined) anySynth.filter.Q.value = track.synthFilterQ
        } else if (anySynth.options?.filter) {
          (synth as any).set({ filter: { frequency: track.synthFilterFreq, Q: track.synthFilterQ } })
        }
      }
    }

    // Handle routing
    const targetDestId = track.parentId ? `parent_${track.parentId}` : 'master'
    if (rack.currentDestination !== targetDestId) {
      try { rack.channel.disconnect() } catch (_) {}
      if (track.parentId) {
        const parentRack = this.getRack(track.parentId)
        try { rack.channel.connect(parentRack.input) } catch (_) {}
      } else {
        try { rack.channel.connect(this.masterLimiter) } catch (_) {}
      }
      rack.currentDestination = targetDestId
    }
    } catch (err) {
      console.warn("WebAudio applyTrackSettings caught error:", err);
    }
  }

  private createSynthFromMuzins(muxins: any): Tone.PolySynth {
    let SynthClass: any = Tone.Synth
    if (muxins.engineType === 'FMSynth') SynthClass = Tone.FMSynth
    if (muxins.engineType === 'MonoSynth') SynthClass = Tone.MonoSynth

    const config = muxins.config || {}
    return new Tone.PolySynth(SynthClass, config)
  }

  private isFxBypassed(track: Track, inst: { id: string; type: string }): boolean {
    const rawBypass: any = track.fxSettings?.[inst.id]?.['bypassed']
    if (rawBypass === 1 || rawBypass === true || rawBypass === '1') return true
    if (rawBypass === 0 || rawBypass === false || rawBypass === '0') return false

    // Check flat track bypass field if present (e.g. track.eqBypassed)
    const flatKey = `${inst.type}Bypassed`
    if ((track as any)[flatKey] === 1 || (track as any)[flatKey] === true || (track as any)[flatKey] === '1') return true
    if ((track as any)[flatKey] === 0 || (track as any)[flatKey] === false || (track as any)[flatKey] === '0') return false

    return false
  }

  private createSynthForTrack(track: Track, instrumentOverride?: SynthPreset): Tone.PolySynth {
    const preset = instrumentOverride ? (instrumentOverride as SynthPreset) : (track.synthPreset || 'piano')
    if (preset === 'custom' && track.customMuxins) {
      return this.createSynthFromMuzins(track.customMuxins)
    } else if (track.synthOscillator === 'custom' && track.synthFormula) {
      try {
        const partials = calculateFourierPartials(track.synthFormula, track.synthPartialsCount || 16)
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'custom' as any, partials },
          envelope: {
            attack: track.synthAttack ?? 0.02,
            decay: track.synthDecay ?? 0.25,
            sustain: track.synthSustain ?? 0.5,
            release: track.synthRelease ?? 0.35
          }
        })
      } catch (e) {
        console.warn('Failed to build custom formula synth, fallback to default', e)
        return this.createSynthForPreset('piano')
      }
    } else if (preset === 'scripted' && track.scriptedDspId) {
      try {
        const DspClass = this.customDspRegistry.get(track.scriptedDspId)
        if (!DspClass) throw new Error('DSP class not found in registry')
        return new Tone.PolySynth(DspClass, { volume: -6 })
      } catch (e) {
        console.warn(`Fallback triggered: Scripted DSP "${track.scriptedDspId}" failed to instantiate.`, e)
        return new Tone.PolySynth(Tone.Synth, { volume: -6 })
      }
    } else {
      return this.createSynthForPreset(preset as SynthPreset)
    }
  }

  private createSynthForPreset(preset: SynthPreset): Tone.PolySynth {
    switch (preset) {
      case 'piano':
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as const },
          envelope: { attack: 0.004, decay: 0.28, sustain: 0.16, release: 0.36 },
        })
      case 'electricPiano':
        return new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 2.4,
          modulationIndex: 5.8,
          envelope: { attack: 0.01, decay: 0.32, sustain: 0.22, release: 0.45 },
          modulationEnvelope: { attack: 0.01, decay: 0.18, sustain: 0.1, release: 0.2 },
        })
      case 'marimba':
        return new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3.6,
          modulationIndex: 9,
          envelope: { attack: 0.003, decay: 0.28, sustain: 0.05, release: 0.22 },
          modulationEnvelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.12 },
        })
      case 'bright':
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' as const },
          envelope: { attack: 0.01, decay: 0.08, sustain: 0.42, release: 0.18 },
        })
      case 'pluck':
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'square' as const },
          envelope: { attack: 0.002, decay: 0.16, sustain: 0.12, release: 0.12 },
        })
      case 'pad':
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' as const },
          envelope: { attack: 0.18, decay: 0.25, sustain: 0.7, release: 0.9 },
        })
      case 'bass':
        return new Tone.PolySynth(Tone.MonoSynth, {
          oscillator: { type: 'square' as const },
          filter: { Q: 2, type: 'lowpass' as const, rolloff: -24 },
          envelope: { attack: 0.01, decay: 0.16, sustain: 0.55, release: 0.18 },
          filterEnvelope: { attack: 0.01, decay: 0.14, sustain: 0.2, release: 0.18, baseFrequency: 80, octaves: 3 },
        })
      case 'bell':
        return new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 1.5,
          modulationIndex: 12,
          envelope: { attack: 0.002, decay: 0.7, sustain: 0.05, release: 1.2 },
          modulationEnvelope: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.4 },
        })
      case 'glass':
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as const },
          envelope: { attack: 0.004, decay: 0.45, sustain: 0.24, release: 0.55 },
        })
      default:
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as const },
          envelope: { attack: 0.02, decay: 0.12, sustain: 0.48, release: 0.35 },
        })
    }
  }

  private ensureInstrumentForTrack(track: Track) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      return
    }
    try {
      const rack = this.getRack(track.id)
      if (track.instrument === 'synth') {
        const preset = track.synthPreset ?? DEFAULT_SYNTH_PRESET
        if (preset === 'physical' || track.synthMode === 'sampler') {
          this.synths.get(track.id)?.dispose()
          this.synths.delete(track.id)
          this.synthPresetByTrack.delete(track.id)
          return
        }
        const customConfigStr = preset === 'custom' && track.customMuxins ? JSON.stringify(track.customMuxins) : ''
        const cacheKey = preset === 'custom' ? `custom:${customConfigStr}` : preset === 'scripted' ? `scripted:${track.scriptedDspId}` : preset

        if (this.synths.has(track.id) && this.synthPresetByTrack.get(track.id) === cacheKey) return

        this.synths.get(track.id)?.dispose()
        const synth = this.createSynthForTrack(track)

        try { synth.connect(rack.input) } catch (_) {}
        this.synths.set(track.id, synth)
        this.synthPresetByTrack.set(track.id, cacheKey)
        return
      }

      const kit = track.drumKit ?? DEFAULT_DRUM_KIT
      const customConfigStr = kit === 'custom' && track.customMuxins ? JSON.stringify(track.customMuxins) : ''
      const cacheKey = kit === 'custom' ? `custom:${customConfigStr}` : kit

      if (this.drums.has(track.id) && this.drumKitByTrack.get(track.id) === cacheKey) {
        const drum = this.drums.get(track.id)
        if (drum) {
          drum.drumDecays = track.drumDecays
          drum.drumOctaves = track.drumOctaves
          drum.drumResonances = track.drumResonances
          drum.customMuxins = track.customMuxins
          if (track.drumPadModes) drum.padModes = { ...track.drumPadModes }
          if (track.drumPadSamples) {
            drum.padSamples = { ...track.drumPadSamples }
            this.syncDrumPadSampleBuffers(drum, track.drumPadSamples)
          }
        }
        return
      }
      this.drums.get(track.id)?.dispose()
      const drum = new DrumMachine(kit, track.customMuxins)
      drum.drumDecays = track.drumDecays
      drum.drumOctaves = track.drumOctaves
      drum.drumResonances = track.drumResonances
      if (track.drumPadModes) drum.padModes = { ...track.drumPadModes }
      if (track.drumPadSamples) {
        drum.padSamples = { ...track.drumPadSamples }
        this.syncDrumPadSampleBuffers(drum, track.drumPadSamples)
      }
      try { drum.connect(rack.input) } catch (_) {}
      this.drums.set(track.id, drum)
      this.drumKitByTrack.set(track.id, cacheKey)
    } catch (e) {
      console.warn('ensureInstrumentForTrack warning:', e)
    }
  }

  setDrumPadDecay(trackId: string, pitch: number, decay: number) {
    const drum = this.drums.get(trackId)
    if (drum) {
      if (!drum.drumDecays) drum.drumDecays = {}
      drum.drumDecays[pitch] = decay
    }
  }

  setDrumPadOctave(trackId: string, pitch: number, octave: number) {
    const drum = this.drums.get(trackId)
    if (drum) {
      if (!drum.drumOctaves) drum.drumOctaves = {}
      drum.drumOctaves[pitch] = octave
    }
  }

  setDrumPadResonance(trackId: string, pitch: number, resonance: number) {
    const drum = this.drums.get(trackId)
    if (drum) {
      if (!drum.drumResonances) drum.drumResonances = {}
      drum.drumResonances[pitch] = resonance
    }
  }

  private syncDrumPadSampleBuffers(drum: DrumMachine, samples: Record<number, DrumPadSample>) {
    const ctx = Tone.getContext().rawContext as AudioContext
    for (const [pStr, s] of Object.entries(samples)) {
      const p = Number(pStr)
      if (s?.audioBase64 && !drum.padAudioBuffers.has(p)) {
        fetch(s.audioBase64)
          .then(r => r.arrayBuffer())
          .then(ab => ctx.decodeAudioData(ab))
          .then(decoded => {
            drum.setPadBuffer(p, decoded)
          })
          .catch(e => console.warn(`Failed to decode drum sample for pad ${p}:`, e))
      }
    }
  }

  getDrumMachine(trackId: string): DrumMachine | undefined {
    return this.drums.get(trackId)
  }

  async setDrumPadSample(trackId: string, pitch: number, sample: DrumPadSample | null, buffer?: AudioBuffer) {
    const state = useStore.getState()
    const track = state.tracks.find(t => t.id === trackId)
    if (!track) return

    const drum = this.drums.get(trackId)
    if (sample) {
      if (drum) {
        if (buffer) drum.setPadBuffer(pitch, buffer)
        drum.padSamples[pitch] = sample
        drum.padModes[pitch] = 'sample'
      }
      const existingSamples = track.drumPadSamples || {}
      const existingModes = track.drumPadModes || {}
      state.updateTrack(trackId, {
        drumPadSamples: { ...existingSamples, [pitch]: sample },
        drumPadModes: { ...existingModes, [pitch]: 'sample' }
      })
    } else {
      if (drum) {
        drum.padAudioBuffers.delete(pitch)
        delete drum.padSamples[pitch]
        drum.padModes[pitch] = 'synth'
      }
      const existingSamples = { ...(track.drumPadSamples || {}) }
      delete existingSamples[pitch]
      const existingModes = { ...(track.drumPadModes || {}), [pitch]: 'synth' as const }
      state.updateTrack(trackId, {
        drumPadSamples: existingSamples,
        drumPadModes: existingModes
      })
    }
  }

  setDrumPadMode(trackId: string, pitch: number, mode: 'synth' | 'sample') {
    const state = useStore.getState()
    const track = state.tracks.find(t => t.id === trackId)
    if (!track) return

    const drum = this.drums.get(trackId)
    if (drum) {
      drum.padModes[pitch] = mode
    }
    const existingModes = track.drumPadModes || {}
    state.updateTrack(trackId, {
      drumPadModes: { ...existingModes, [pitch]: mode }
    })
  }

  private applyMetronomeSettings(settings: MetronomeSettings) {
    this.metronome.set({
      pitchDecay: settings.pitchDecay,
      octaves: settings.octaves,
      envelope: {
        attack: settings.attack,
        decay: settings.decay,
        sustain: settings.sustain,
        release: settings.release,
      }
    })
    this.metronomeChannel.volume.value = settings.volume
  }

  private applySwing(swing: number) {
    Tone.Transport.swing = swing / 100
    Tone.Transport.swingSubdivision = '8n'
  }

  private applyLoop(enabled: boolean, start: number, end: number) {
    Tone.Transport.loop = enabled
    if (enabled) {
      Tone.Transport.loopStart = `${start}i`
      Tone.Transport.loopEnd = `${end}i`
    }
  }

  private setupTransport() {
    let lastEraseTicks = 0

    Tone.Transport.scheduleRepeat(() => {
      const state = useStore.getState()
      const ticks = Tone.Transport.ticks
      const maxTicks = state.getMaxTicks()
      const endBuffer = state.studioSettings.loopEndBuffer

      if (state.isRecording && state.activeTrackId && !state.midiOverdub) {
        if (ticks < lastEraseTicks || Math.abs(ticks - lastEraseTicks) > 100) {
          lastEraseTicks = Math.max(0, ticks - 12)
        }
        useStore.getState().eraseNotesInRegion(state.activeTrackId, lastEraseTicks, ticks)
        lastEraseTicks = ticks
      } else {
        lastEraseTicks = ticks
      }

      if (!state.isRecording && !state.loopEnabled && maxTicks > 0 && ticks > maxTicks + endBuffer) {
        this.stop()
      } else {
        if (Math.abs(Tone.Transport.bpm.value - state.bpm) > 0.01) {
          Tone.Transport.bpm.value = state.bpm
        }

        // Auto-extend grid while recording so playhead never runs into boundary
        if (state.isRecording) {
          const totalGridTicks = state.gridColumnCount * state.gridBlockTicks
          if (ticks + 768 > totalGridTicks) {
            const neededCols = Math.ceil((ticks + 1536) / state.gridBlockTicks)
            state.setGridColumnCount(neededCols)
          }
        }

        requestAnimationFrame(() => {
          useStore.getState().setPlayheadPosition(ticks)
        })
      }
    }, '64n')

    Tone.Transport.scheduleRepeat((time) => {
      const state = useStore.getState()
      if (!state.metronomeEnabled) return
      const s = state.metronomeSettings

      const numerator = parseInt(state.timeSignature.split('/')[0])
      const beat = Math.floor(Tone.Transport.ticks / 192) % numerator
      const note = beat === 0 ? s.downbeatPitch : s.upbeatPitch
      const velBase = beat === 0 ? s.downbeatVel : s.upbeatVel
      const velocity = Math.max(0, Math.min(1, state.metronomeVolume * velBase))
      this.metronome.triggerAttackRelease(note, '32n', time, velocity)
    }, '4n')
  }

  triggerMetronomeClick(accent: boolean = false) {
    try {
      const state = useStore.getState()
      const s = state.metronomeSettings
      const note = accent ? (s?.downbeatPitch || 'C6') : (s?.upbeatPitch || 'G5')
      const velBase = accent ? (s?.downbeatVel || 1.0) : (s?.upbeatVel || 0.7)
      const velocity = Math.max(0.2, Math.min(1, (state.metronomeVolume ?? 0.8) * velBase))
      this.metronome.triggerAttackRelease(note, '32n', undefined, velocity)
    } catch (e) {
      console.warn('Metronome click error:', e)
    }
  }

  releaseNote(trackId: string, type: 'synth' | 'drum' | 'vst3', pitch: string | number) {
    if (useStore.getState().engineMode === 'wasm' && this.wasmNode) {
      const wasmIdx = this.getTrackWasmIndex(trackId);
      this.wasmNode.port.postMessage({
        type: 'note-off',
        trackId: wasmIdx,
        noteId: -1
      });
      return;
    }
    if (type === 'synth') {
      const sampler = this.samplers.get(trackId)
      if (sampler) {
        const midi = typeof pitch === 'number'
          ? pitch
          : (Number.isFinite(Number(pitch)) ? Number(pitch) : Tone.Frequency(pitch).toMidi())
        sampler.noteOff(Math.round(midi * 100))
      }
      const synth = this.synths.get(trackId)
      if (synth) {
        try { synth.triggerRelease(pitch, Tone.now()) } catch (e) { }
      }
      const overrideMap = this.overrideSynths.get(trackId)
      if (overrideMap) {
        overrideMap.forEach(s => {
          try { s.triggerRelease(pitch, Tone.now()) } catch (e) { }
        })
      }
    } else {
      let pitchesToRelease = [pitch as number]
      if (typeof pitch === 'number' && pitch >= 1000) {
        const mixRow = useStore.getState().customDrumRows?.find(r => r.syntheticPitch === pitch)
        if (mixRow) pitchesToRelease = [mixRow.drumA, mixRow.drumB]
      }

      const drum = this.drums.get(trackId)
      pitchesToRelease.forEach(p => {
        const piece = this.getDrumPiece(drum, p)
        if (piece && piece.triggerRelease) {
          try { piece.triggerRelease(Tone.now()) } catch (e) { }
        }
      })

      const overrideMap = this.overrideDrums.get(trackId)
      if (overrideMap) {
        overrideMap.forEach(d => {
          pitchesToRelease.forEach(p => {
            const piece = this.getDrumPiece(d, p)
            if (piece && piece.triggerRelease) {
              try { piece.triggerRelease(Tone.now()) } catch (e) { }
            }
          })
        })
      }
    }
  }

  private getDrumPiece(drum: any, pitch: number) {
    if (!drum) return null
    if (pitch >= 16) {
      return drum.customSynths?.get(pitch) || null
    }
    const pieceKey = PITCH_TO_PIECE[pitch]
    return pieceKey ? drum[pieceKey] : null
  }

  stopActiveNotes() {
    const state = useStore.getState()
    const currentTicks = state.playheadPosition
    const globalComplete = state.completeNotesOnPause

    state.notes.forEach(note => {
      if (currentTicks >= note.time && currentTicks < note.time + note.duration) {
        const shouldComplete = note.completeNotesOnPause ?? globalComplete
        if (!shouldComplete) {
          const track = state.tracks.find(t => t.id === note.trackId)
          if (!track) return
          const transpose = track.instrument === 'synth' ? (track.transpose ?? 0) : 0
          const drumMapShift = track.instrument === 'drum' ? (track.drumMapShift ?? 0) : 0
          const finalPitch = track.instrument === 'drum'
            ? (note.pitch >= 1000 ? note.pitch : (note.pitch >= 16 ? note.pitch : ((note.pitch + drumMapShift) % 16 + 16) % 16))
            : Tone.Frequency(note.pitch + transpose, "midi").toNote()

          this.releaseNote(track.id, track.instrument, finalPitch)
        }
      }
    })
  }

  resumeActiveNotes() {
    const state = useStore.getState()
    const currentTicks = state.playheadPosition
    const globalBpm = state.bpm
    const globalComplete = state.completeNotesOnPause

    state.notes.forEach(note => {
      if (currentTicks > note.time && currentTicks < note.time + note.duration) {
        const shouldComplete = note.completeNotesOnPause ?? globalComplete
        if (shouldComplete) return // If it was supposed to complete, it never stopped, so don't re-trigger it.

        const track = state.tracks.find(t => t.id === note.trackId)
        if (!track) return

        const trackBpm = track.targetTempo ?? globalBpm
        const noteBpm = note.bpm ?? trackBpm
        const noteTPS = (noteBpm / 60) * 192
        const remainingTicks = note.time + note.duration - currentTicks
        const remainingDurationSeconds = Math.max(0.005, remainingTicks / noteTPS)

        const transpose = track.instrument === 'synth' ? (track.transpose ?? 0) : 0
        const drumMapShift = track.instrument === 'drum' ? (track.drumMapShift ?? 0) : 0
        const isMicrotonal = track.instrument === 'synth' && (note.pitch % 1 !== 0 || (track.edoDivision !== undefined && track.edoDivision !== 12))
        const finalPitch = track.instrument === 'drum'
          ? (note.pitch >= 1000 ? note.pitch : (note.pitch >= 16 ? note.pitch : ((note.pitch + drumMapShift) % 16 + 16) % 16))
          : (isMicrotonal ? Tone.Frequency(note.pitch + transpose, "midi").toFrequency() : Tone.Frequency(note.pitch + transpose, "midi").toNote())

        const finalPitchEnd = note.pitchEnd !== undefined && track.instrument !== 'drum'
          ? (isMicrotonal ? Tone.Frequency(note.pitchEnd + transpose, "midi").toFrequency() : Tone.Frequency(note.pitchEnd + transpose, "midi").toNote())
          : undefined

        const automationPoints = state.automationCurves[note.trackId] || []
        const automationTarget = state.automationTargets[note.trackId] ?? 'velocity'
        const laneValue = getLaneValueAtTick({
          points: automationPoints,
          lane: state.automationLanes?.[note.trackId],
          target: automationTarget,
          tick: currentTicks,
          fallback: note.velocity,
          bpm: state.bpm,
        })
        const velocity = automationTarget === 'velocity' ? laneValue / 127 : note.velocity / 127

        this.playNote(
          track.id,
          track.instrument,
          finalPitch as string | number,
          remainingDurationSeconds as any,
          Tone.now(),
          velocity,
          note.instrumentOverride as any,
          note.detune,
          finalPitchEnd
        )
      }
    })
  }

  async togglePlay() {
    if (!this.isInitialized) {
      await this.init()
    }

    if (Tone.Transport.state === 'started') {
      Tone.Transport.pause()
      this.stopActiveNotes()
      this.stopVst3Automation()
      useStore.getState().setIsPlaying(false)
      if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
        (window as any).juceAudioBridge.postCommand({ type: 'stop' });
      }
    } else {
      this.syncNoteVst3Overrides()
      Tone.Transport.start()
      useStore.getState().setIsPlaying(true)
      this.resumeActiveNotes()
      this.startVst3Automation()
      if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
        (window as any).juceAudioBridge.postCommand({ type: 'play' });
      }
    }
  }

  stop() {
    Tone.Transport.stop()
    this.stopActiveNotes()
    this.stopVst3Automation()
    const state = useStore.getState()
    if (state.isRecording) {
      state.setIsRecording(false)
      state.commitHistory()
    }
    state.setPlayheadPosition(0)
    state.setIsPlaying(false)
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({ type: 'stop' });
      (window as any).juceAudioBridge.postCommand({ type: 'allNotesOff' });
    }
  }

  allNotesOff(trackId?: string) {
    this.stopActiveNotes()
    this.samplers.forEach((sampler, id) => {
      if (trackId && id !== trackId) return
      try { sampler.allNotesOff() } catch {}
    })
    try {
      this.synths.forEach((synth, id) => {
        if (trackId && id !== trackId) return
        if (synth && (synth as any).releaseAll) {
          (synth as any).releaseAll()
        }
      })
    } catch {}

    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'allNotesOff',
        trackId: trackId || undefined
      });
    }
  }

  setBpm(bpm: number) {
    if (bpm <= 0 || isNaN(bpm)) return; // Failsafe to prevent Tone.js crashes
    const state = useStore.getState()
    const prevBpm = state.bpm
    Tone.Transport.bpm.rampTo(bpm, 0.1)
    state.setBpm(bpm)

    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({ type: 'setBpm', bpm });
    }

    // Auto-update notes that followed the previous project default
    const trackOverrides = new Set(state.tracks.filter(t => t.targetTempo !== undefined).map(t => t.id))
    const newNotes = state.notes.map(note => {
      if (!trackOverrides.has(note.trackId) && note.bpm === prevBpm) {
        return { ...note, bpm }
      }
      return note
    })

    // Use setState directly to update the notes array in the store
    useStore.setState({ notes: newNotes })
  }

  triggerLiveNote(trackId: string, pitch: number, velocity: number) {
    const state = useStore.getState()
    const track = state.tracks.find(t => t.id === trackId)

    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      let finalVelocity = velocity / 127;
      if (state.studioSettings.velocityCurveFormula && state.studioSettings.velocityCurveFormula !== 'v') {
        let fn = this.formulaCache.get(state.studioSettings.velocityCurveFormula)
        if (!fn) {
          try {
            fn = new Function('v', `return ${state.studioSettings.velocityCurveFormula}`)
            this.formulaCache.set(state.studioSettings.velocityCurveFormula, fn)
          } catch (e) {
            console.warn("Velocity curve compilation failed", e)
          }
        }
        if (fn) {
          try { finalVelocity = fn(finalVelocity); } catch(_) {}
        }
      }
      (window as any).juceAudioBridge.postCommand({
        type: 'noteOn',
        trackId,
        instrument: track?.instrument || 'synth',
        pitch,
        velocity: Math.max(0.01, Math.min(1.0, finalVelocity)),
        duration: 2.0
      });
      return;
    }

    if (state.engineMode === 'wasm' && this.wasmNode) {
      const wasmIdx = this.getTrackWasmIndex(trackId);
      let finalVelocity = velocity / 127;
      if (state.studioSettings.velocityCurveFormula && state.studioSettings.velocityCurveFormula !== 'v') {
        const fn = this.formulaCache.get(state.studioSettings.velocityCurveFormula)
        if (fn) {
          try { finalVelocity = fn(finalVelocity); } catch(_) {}
        }
      }
      const noteId = Math.floor(pitch * 1000 + (Tone.now() * 100) % 1000);
      this.wasmNode.port.postMessage({
        type: 'note-on',
        trackId: wasmIdx,
        noteId,
        pitch,
        velocity: finalVelocity
      });
      return;
    }

    let finalVelocity = velocity / 127
    if (state.studioSettings.velocityCurveFormula && state.studioSettings.velocityCurveFormula !== 'v') {
      let fn = this.formulaCache.get(state.studioSettings.velocityCurveFormula)
      if (!fn) {
        try {
          fn = new Function('v', `return ${state.studioSettings.velocityCurveFormula}`)
          this.formulaCache.set(state.studioSettings.velocityCurveFormula, fn)
        } catch (e) {
          console.warn("Velocity curve compilation failed", e)
        }
      }
      if (fn) {
        try {
          finalVelocity = fn(finalVelocity)
          finalVelocity = Math.max(0, Math.min(1, finalVelocity))
        } catch (e) {
          console.warn("Velocity curve evaluation failed", e)
        }
      }
    }

    if (track?.instrument === 'synth' && track.synthPreset === 'vocal') {
      try {
        const rack = this.getRack(trackId)
        const freq = Tone.Frequency(pitch, 'midi').toFrequency()
        const voice = new VocalModelVoice(rack.input.input as GainNode)
        const defaultPreset = state.voicePresets[0] || {
          id: 'soprano',
          name: 'Soprano',
          vocalTractLength: 1.15,
          breathiness: 0.1,
          glottalTension: 0.85,
          vibratoDepth: 35,
          vibratoRate: 6.2,
          jitter: 0.15,
          shimmer: 0.1,
          formantShiftF1: 0,
          formantShiftF2: 0,
          formantShiftF3: 0,
          consonantVolume: 1.0,
          consonantLength: 1.0,
          articulationSpeed: 1.0
        }
        voice.trigger(freq, 1.0, Tone.now(), finalVelocity, defaultPreset, 'a')
      } catch (err) {
        console.error("Live vocal model failed:", err)
      }
      return
    }

    if (track?.instrument === 'synth' && track.synthPreset === 'physical') {
      try {
        const rack = this.getRack(trackId)
        const freq = Tone.Frequency(pitch, 'midi').toFrequency()
        const voice = new PhysicalModelVoice(rack.input.input as GainNode)
        voice.trigger(freq, 0.5, Tone.now(), finalVelocity, track)
      } catch (err) {
        console.error("Live physical model failed:", err)
      }
      return
    }

    const synth = this.synths.get(trackId)
    if (synth) {
      const isMicro = (pitch % 1 !== 0) || (track?.edoDivision !== undefined && track.edoDivision !== 12)
      let freq: any = isMicro ? Tone.Frequency(pitch, 'midi').toFrequency() : Tone.Frequency(pitch, 'midi').toNote()
      if (typeof freq === 'number' && freq > 0 && freq < 35) {
        while (freq < 35) freq *= 2
      }
      synth.triggerAttack(freq, undefined, finalVelocity)
    }
    const drum = this.drums.get(trackId)
    if (drum) {
      const trackTranspose = track?.transpose ?? 0
      if (pitch >= 1000) {
        const mixRow = useStore.getState().customDrumRows?.find(r => r.syntheticPitch === pitch)
        if (mixRow) {
          const velA = finalVelocity * (1 - mixRow.proportion)
          const velB = finalVelocity * mixRow.proportion
          if (velA > 0.01) drum.triggerAttackRelease(mixRow.drumA, '32n', undefined, velA, trackTranspose)
          if (velB > 0.01) drum.triggerAttackRelease(mixRow.drumB, '32n', undefined, velB, trackTranspose)
          return
        }
      }
      drum.triggerAttackRelease(pitch, '32n', undefined, finalVelocity, trackTranspose)
    }
  }

  releaseLiveNote(trackId: string, pitch: number) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'noteOff',
        trackId,
        noteId: Math.round(pitch * 100)
      });
      return;
    }

    if (useStore.getState().engineMode === 'wasm' && this.wasmNode) {
      const wasmIdx = this.getTrackWasmIndex(trackId);
      this.wasmNode.port.postMessage({
        type: 'note-off',
        trackId: wasmIdx,
        noteId: -1
      });
      return;
    }
    const track = useStore.getState().tracks.find(t => t.id === trackId)
    if (track?.instrument === 'synth' && (track.synthPreset === 'physical' || track.synthPreset === 'vocal')) {
      return // physical/vocal models are naturally transient and decay on their own
    }

    const liveSampler = this.samplers.get(trackId)
    if (liveSampler && track?.synthMode === 'sampler') {
      liveSampler.noteOff(Math.round(pitch * 100))
      return
    }

    const synth = this.synths.get(trackId)
    if (synth) {
      const isMicro = (pitch % 1 !== 0) || (track?.edoDivision !== undefined && track.edoDivision !== 12)
      let freq: any = isMicro ? Tone.Frequency(pitch, 'midi').toFrequency() : Tone.Frequency(pitch, 'midi').toNote()
      if (typeof freq === 'number' && freq > 0 && freq < 35) {
        while (freq < 35) freq *= 2
      }
      synth.triggerRelease(freq)
    }
  }

  resetForNewProject() {
    this.stop()
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({ type: 'clearAllTracks' });
    }
    for (const [, synth] of this.synths.entries()) {
      try { synth.dispose() } catch (e) {}
    }
    this.synths.clear()
    for (const [, drum] of this.drums.entries()) {
      try { drum.dispose() } catch (e) {}
    }
    this.drums.clear()
    for (const [, sampler] of this.samplers.entries()) {
      try { sampler.dispose() } catch (e) {}
    }
    this.samplers.clear()
    this.lastSamplerUriByTrack.clear()
    for (const [, map] of this.overrideSynths.entries()) {
      map.forEach(s => { try { s.dispose() } catch (e) {} })
    }
    this.overrideSynths.clear()
    for (const [, map] of this.overrideDrums.entries()) {
      map.forEach(d => { try { d.dispose() } catch (e) {} })
    }
    this.overrideDrums.clear()
    for (const [, rack] of this.racks.entries()) {
      for (const [, node] of rack.fxNodes.entries()) {
        try { node.dispose() } catch (e) {}
      }
      try { rack.channel.dispose() } catch (e) {}
    }
    this.racks.clear()
    this.synthPresetByTrack.clear()
    this.drumKitByTrack.clear()
  }

  createInstrument(trackId: string, type: 'synth' | 'drum' | 'vst3') {
    const track = useStore.getState().tracks.find(t => t.id === trackId)
    if (track) {
      this.applyTrackSettings(track)
      return
    }

    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'createTrack',
        trackId,
        instrument: type
      });
      return
    }

    const fallbackTrack: Track = {
      id: trackId,
      name: 'Track',
      instrument: type,
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      color: '#4dabf7',
    }
    this.ensureInstrumentForTrack(fallbackTrack)
  }

  registerCustomSynth(id: string, DspClass: any) {
    this.customDspRegistry.set(id, DspClass)
    // Re-initialize any tracks using this DSP
    const state = useStore.getState()
    state.tracks.forEach(t => {
      if (t.instrument === 'synth' && t.synthPreset === 'scripted' && t.scriptedDspId === id) {
        this.synthPresetByTrack.delete(t.id) // Force re-creation
        this.ensureInstrumentForTrack(t)
      }
    })
  }

  setTrackCurve(trackId: string, curveType: string, tension: number = 0, lut?: number[]) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackCurve',
        trackId,
        curveType,
        tension,
        lut
      });
    }
  }

  setTrackSynthParam(trackId: string, param: string, value: number | string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackParam',
        trackId,
        param,
        value
      });
    }
  }

  setPadCurve(trackId: string, padIndex: number, lut?: number[], tension?: number) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'setPadCurve',
        trackId,
        padIndex,
        lut,
        tension
      });
    }
  }

  async scanVst3Plugins(): Promise<any[]> {
    if ((window as any).__isJuceNative__ && (window as any).ipcRenderer) {
      useStore.getState().setVst3Scanning(true, 'Scanning system folders for VST3 plugins...');
      try {
        const list = await (window as any).ipcRenderer.invoke('vst3-scan');
        useStore.getState().setVst3Scanning(false);
        if (Array.isArray(list)) {
          useStore.getState().setVst3Plugins(list);
          const currentActive = (useStore.getState().vst3ActivePluginIds || []).map(String);
          const allScannedIds = list.map((p: any) => String(p.uniqueId)).filter(Boolean);
          const mergedActive = Array.from(new Set([...currentActive, ...allScannedIds]));
          try { localStorage.setItem('musegrid_vst3_active_plugins', JSON.stringify(mergedActive)); } catch {}
          useStore.setState({ vst3ActivePluginIds: mergedActive });
          useStore.getState().showToast(`Scanned ${list.length} VST3 plugins (Activated)`, 'success');
          return list;
        }
      } catch (err: any) {
        useStore.getState().setVst3Scanning(false);
        useStore.getState().showToast('VST3 Scan failed: ' + (err.message || err), 'error');
      }
    }
    return [];
  }

  async fetchVst3Plugins(): Promise<any[]> {
    if ((window as any).__isJuceNative__ && (window as any).ipcRenderer) {
      try {
        const list = await (window as any).ipcRenderer.invoke('vst3-get-plugins');
        if (Array.isArray(list)) {
          useStore.getState().setVst3Plugins(list);
          const currentActive = (useStore.getState().vst3ActivePluginIds || []).map(String);
          if (currentActive.length === 0) {
            const allIds = list.map((p: any) => String(p.uniqueId)).filter(Boolean);
            try { localStorage.setItem('musegrid_vst3_active_plugins', JSON.stringify(allIds)); } catch {}
            useStore.setState({ vst3ActivePluginIds: allIds });
          }
          return list;
        }
      } catch (err) {
        console.warn('[AudioEngine] fetchVst3Plugins error:', err);
      }
    }
    return [];
  }

  openVst3InstrumentEditor(trackId: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'openTrackVst3InstrumentEditor',
        trackId
      });
    }
  }

  openVst3FxEditor(trackId: string, fxId: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'openTrackVst3FxEditor',
        trackId,
        fxId
      });
    }
  }

  openStandaloneVst3Editor(pluginIdentifier: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'openPreviewVst3Editor',
        pluginId: pluginIdentifier
      });
    }
  }

  setTrackVst3Instrument(trackId: string, pluginId: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackVst3Instrument',
        trackId,
        pluginId
      });
    }
  }

  /** Instantiates the VST3 instance a per-note instrument override needs (one per note). */
  ensureNoteVst3Instrument(trackId: string, pluginId: string, instanceKey?: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'ensureNoteVst3Instrument',
        trackId,
        pluginId,
        instanceKey
      });
    }
  }

  /** Opens the plugin editor for one note's own VST3 instance. */
  openNoteVst3InstrumentEditor(trackId: string, instanceKey: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'openNoteVst3InstrumentEditor',
        trackId,
        instanceKey
      });
    }
  }

  /** Parameters exposed by the track's VST3 instrument, for the automation lane selector. */
  async getTrackVst3Parameters(trackId: string): Promise<Vst3ParameterInfo[]> {
    if ((window as any).__isJuceNative__ && (window as any).ipcRenderer) {
      try {
        const list = await (window as any).ipcRenderer.invoke('vst3-track-parameters', trackId);
        return Array.isArray(list) ? list : [];
      } catch (err) {
        console.warn('[AudioEngine] getTrackVst3Parameters error:', err);
      }
    }
    return [];
  }

  /** Writes a normalized 0..1 value to a plugin parameter, ramped over `rampSeconds`. */
  setTrackVst3Parameter(trackId: string, index: number, value: number, rampSeconds = 0.05) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackVst3Parameter',
        trackId,
        index,
        value: Math.max(0, Math.min(1, value)),
        rampSeconds
      });
    }
  }

  // The JUCE host owns the plugin instances, so a `vst3:<index>` lane is streamed to them
  // while the transport runs; each write ramps across the sampling interval.
  private pushVst3Automation() {
    if (!(window as any).__isJuceNative__ || !(window as any).juceAudioBridge) return
    const state = useStore.getState()
    const ticks = Tone.Transport.ticks
    const secondsPerTick = 60 / (state.bpm * 192)
    const elapsedTicks = Math.max(0, ticks - this.vst3AutomationLastTicks)
    const rampSeconds = Math.max(0.02, Math.min(0.2, elapsedTicks * secondsPerTick))
    this.vst3AutomationLastTicks = ticks

    for (const track of state.tracks) {
      const target = state.automationTargets[track.id]
      if (!target || !target.startsWith('vst3:')) continue
      const index = Number(target.slice(5))
      if (!Number.isInteger(index) || index < 0) continue
      const points = state.automationCurves[track.id]
      const lane = state.automationLanes?.[track.id]
      // A formula lane needs no drawn points to be worth streaming.
      if ((!points || points.length === 0) && lane?.source !== 'formula') continue
      const value = Math.max(0, Math.min(1, getLaneValueAtTick({
        points, lane, target, tick: ticks, fallback: 64, bpm: state.bpm,
      }) / 127))
      this.setTrackVst3Parameter(track.id, index, value, rampSeconds)
    }
  }

  private startVst3Automation() {
    if (this.vst3AutomationTimer != null) return
    this.vst3AutomationLastTicks = Tone.Transport.ticks
    this.pushVst3Automation()
    this.vst3AutomationTimer = window.setInterval(() => this.pushVst3Automation(), 50)
  }

  private stopVst3Automation() {
    if (this.vst3AutomationTimer == null) return
    window.clearInterval(this.vst3AutomationTimer)
    this.vst3AutomationTimer = null
  }

  /** Registers a per-note FX chain so it is ready before the first note plays. */
  ensureNoteFxChain(trackId: string, chainId: number, signature: string, effects: unknown) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'ensureNoteFxChain',
        trackId,
        chainId,
        signature,
        effects: JSON.stringify(effects)
      });
    }
  }

  /** Makes sure every VST3 referenced by a per-note override has a live native slot. */
  syncNoteVst3Overrides() {
    if (!(window as any).__isJuceNative__ || !(window as any).juceAudioBridge) return
    const state = useStore.getState()
    state.notes.forEach(n => {
      const ov = n.instrumentOverride
      if (typeof ov === 'string' && ov.startsWith('vst3:')) {
        this.ensureNoteVst3Instrument(n.trackId, ov.slice(5), n.id)
      }
      if (n.fxInstances?.length) {
        const chain = buildNoteFxChain(n)
        if (chain) this.ensureNoteFxChain(n.trackId, chain.chainId, chain.signature, chain.effects)
      }
    })
  }

  /** Drops native note-FX chains and per-note VST3 instances whose notes are gone. */
  private pruneNativeNoteFxChains() {
    if (!(window as any).__isJuceNative__ || !(window as any).juceAudioBridge) return
    const state = useStore.getState()
    for (const track of state.tracks) {
      const trackNotes = state.notes.filter(note => note.trackId === track.id)
      const chainIds = trackNotes
        .map(note => buildNoteFxChain(note)?.chainId)
        .filter((id): id is number => typeof id === 'number')
      ;(window as any).juceAudioBridge.postCommand({
        type: 'pruneNoteFxChains',
        trackId: track.id,
        chainIds
      })
      const instanceKeys = trackNotes
        .filter(note => typeof note.instrumentOverride === 'string' && note.instrumentOverride.startsWith('vst3:'))
        .map(note => note.id)
      ;(window as any).juceAudioBridge.postCommand({
        type: 'pruneNoteVst3Instruments',
        trackId: track.id,
        instanceKeys
      })
    }
  }

  removeTrackVst3Instrument(trackId: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'removeTrackVst3Instrument',
        trackId
      });
    }
  }

  addTrackVst3Fx(trackId: string, fxId: string, pluginId: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'addTrackVst3Fx',
        trackId,
        fxId,
        pluginId
      });
    }
  }

  setTrackVst3FxBypass(trackId: string, fxId: string, bypassed: boolean) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackVst3FxBypass',
        trackId,
        fxId,
        bypassed
      });
    }
  }

  setTrackVst3FxWet(trackId: string, fxId: string, wet: number) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'setTrackVst3FxWet',
        trackId,
        fxId,
        wet
      });
    }
  }

  removeTrackVst3Fx(trackId: string, fxId: string) {
    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand({
        type: 'removeTrackVst3Fx',
        trackId,
        fxId
      });
    }
  }

  playDPreverb(
    trackId: string,
    fxInstanceId: string,
    durationSeconds: number,
    time: number,
    wet: number,
    decay: number,
    tone: number
  ) {
    const rack = this.getRack(trackId)
    const node = rack.fxNodes.get(fxInstanceId)
    if (node instanceof DPreverbNode) {
      node.trigger(durationSeconds, time, wet, decay, tone)
    }
  }

  playNote(
    trackId: string,
    type: 'synth' | 'drum' | 'vst3',
    pitch: string | number,
    duration: string,
    time?: number,
    velocity = 1,
    instrumentOverride?: InstrumentOverride,
    detune?: number,
    pitchEnd?: string | number,
    noteData?: any
  ) {
    const state = useStore.getState()
    const track = state.tracks.find(t => t.id === trackId)
    const playTime = time !== undefined ? time : Tone.now()

    if ((window as any).__isJuceNative__ && (window as any).juceAudioBridge) {
      (window as any).juceAudioBridge.postCommand(
        buildNativeNoteOnCommand({ trackId, type, pitch, duration, velocity, detune, pitchEnd, noteData, track })
      );
      return;
    }

    // VST3 instrument overrides are hosted by JUCE only. Tone keeps the track sound.
    if (typeof instrumentOverride === 'string' && instrumentOverride.startsWith('vst3:')) {
      instrumentOverride = undefined
    }

    if (state.engineMode === 'wasm' && this.wasmNode) {
      const wasmIdx = this.getTrackWasmIndex(trackId);
      
      let startMidi = 0;
      if (type === 'drum') {
        if (typeof pitch === 'number') {
          const p = pitch | 0;
          if (p === 0 || p === 12) startMidi = 0; // Kick / Lo-Conga
          else if (p === 1 || p === 5 || p === 6 || p === 7 || p === 13 || p === 15) startMidi = 1; // Snare / Toms / Conga / Rimshot
          else if (p === 2 || p === 11 || p === 14) startMidi = 2; // Closed Hihat / Tambourine / Claves
          else if (p === 3 || p === 8 || p === 9) startMidi = 3; // Open Hihat / Crash / Ride
          else if (p === 4 || p === 10) startMidi = 4; // Clap / Cowbell
          else startMidi = p;
        } else {
          startMidi = Tone.Frequency(pitch).toMidi();
        }
      } else {
        if (typeof pitch === 'number') {
          if (pitch >= 0 && pitch <= 127 && Math.abs(pitch - Math.round(pitch)) < 0.001) {
            startMidi = Math.round(pitch);
          } else if (pitch > 127) {
            startMidi = Tone.Frequency(pitch).toMidi();
          } else {
            startMidi = pitch;
          }
        } else {
          startMidi = Tone.Frequency(pitch).toMidi();
        }
        if (startMidi > 0 && startMidi < 21) {
          while (startMidi < 21) startMidi += 12;
        }
      }

      let endMidi = startMidi;
      let slideTime = 0.0;
      let targetPitchEnd = pitchEnd;
      if (noteData?.pitchSlide) {
        targetPitchEnd = (typeof pitch === 'number' && pitch <= 127 && Math.abs(pitch - Math.round(pitch)) < 0.001)
          ? Tone.Frequency(Math.round(pitch), 'midi').transpose(noteData.pitchSlide).toNote()
          : Tone.Frequency(pitch).transpose(noteData.pitchSlide).toNote();
      }
      if (targetPitchEnd) {
        endMidi = (typeof targetPitchEnd === 'number' && targetPitchEnd <= 127 && Math.abs(targetPitchEnd - Math.round(targetPitchEnd)) < 0.001)
          ? Math.round(targetPitchEnd)
          : Tone.Frequency(targetPitchEnd).toMidi();
        const durSec = Tone.Time(duration).toSeconds();
        slideTime = noteData?.pitchSlideTime
          ? Tone.Time(noteData.pitchSlideTime + 'i').toSeconds()
          : durSec;
      }
      const vibDepth = noteData?.vibratoDepth || 0.0;
      const vibRate = noteData?.vibratoRate || 6.0;
      const tremDepth = noteData?.tremoloDepth || 0.0;
      const tremRate = noteData?.tremoloRate || 8.0;
      const noteId = Math.floor(startMidi * 1000 + (playTime * 100) % 1000);
      const delayMs = Math.max(0, (playTime - Tone.now()) * 1000);
      const trigger = () => {
        if (this.wasmNode) {
          this.wasmNode.port.postMessage({
            type: 'note-on',
            trackId: wasmIdx,
            noteId,
            pitch: startMidi,
            velocity,
            slideEnd: endMidi,
            slideTime,
            vibratoDepth: vibDepth,
            vibratoRate: vibRate,
            tremoloDepth: tremDepth,
            tremoloRate: tremRate
          });
        }
      };
      if (delayMs > 2) {
        setTimeout(trigger, delayMs);
      } else {
        trigger();
      }
      const durSec = Tone.Time(duration).toSeconds();
      const releaseTimeMs = delayMs + durSec * 1000;
      setTimeout(() => {
        if (this.wasmNode) {
          this.wasmNode.port.postMessage({
            type: 'note-off',
            trackId: wasmIdx,
            noteId
          });
        }
      }, releaseTimeMs);
      return;
    }

    let finalVelocity = velocity
    if (state.studioSettings.velocityCurveFormula && state.studioSettings.velocityCurveFormula !== 'v') {
      let fn = this.formulaCache.get(state.studioSettings.velocityCurveFormula)
      if (!fn) {
        try {
          fn = new Function('v', `return ${state.studioSettings.velocityCurveFormula}`)
          this.formulaCache.set(state.studioSettings.velocityCurveFormula, fn)
        } catch (e) {
          console.warn("Velocity curve compilation failed", e)
        }
      }
      if (fn) {
        try {
          finalVelocity = fn(finalVelocity)
          finalVelocity = Math.max(0, Math.min(1, finalVelocity))
        } catch (e) {
          console.warn("Velocity curve evaluation failed", e)
        }
      }
    }

    // We overwrite the local velocity variable so the rest of the function uses it
    velocity = finalVelocity

    if (type === 'synth') {
      const sampler = this.samplers.get(trackId)
      if (sampler && track?.synthMode === 'sampler' && !instrumentOverride) {
        try {
          const midi = typeof pitch === 'number'
            ? pitch
            : (Number.isFinite(Number(pitch)) ? Number(pitch) : Tone.Frequency(pitch).toMidi())
          const durSec = Tone.Time(duration).toSeconds()
          const extraOffset = (noteData?.pitchOffset ?? 0) + (detune ? detune / 100 : 0) + (track?.transpose ?? 0)
          const slideSemis = noteData?.pitchSlide ?? 0
          const slides = !!slideSemis
          sampler.noteOn(Math.round(midi * 100), midi, velocity, durSec, extraOffset, playTime, {
            targetPitchMidi: slides ? midi + slideSemis : undefined,
            glideSeconds: slides
              ? (noteData?.pitchSlideTime ? Tone.Time(noteData.pitchSlideTime + 'i').toSeconds() : durSec)
              : undefined,
            glideCurve: slides ? buildCurveLut(noteData?.pitchSlideRamp, noteData?.pitchSlideCustomCurve || 't * t') : undefined,
            pan: noteData?.pan,
            gain: noteData?.automationGain,
            fadeIn: noteData?.morphFadeIn ? Tone.Time(noteData.morphFadeIn + 'i').toSeconds() : undefined,
            fadeOut: noteData?.morphFadeOut ? Tone.Time(noteData.morphFadeOut + 'i').toSeconds() : undefined,
          })
          return
        } catch (err) {
          console.error('Sampler playNote failed:', err)
        }
      }

      const isVocalNote = instrumentOverride === 'vocal' || (track?.synthPreset === 'vocal' && !instrumentOverride)
      if (isVocalNote) {
        try {
          const rack = this.getRack(trackId)
          const baseFreq = (typeof pitch === 'number' && pitch <= 127 && Math.abs(pitch - Math.round(pitch)) < 0.001)
            ? Tone.Frequency(Math.round(pitch), 'midi').toFrequency()
            : Tone.Frequency(pitch).toFrequency()
          const freq = detune ? baseFreq * Math.pow(2, detune / 1200) : baseFreq
          let endFreq: number | undefined = undefined
          if (pitchEnd !== undefined) {
            endFreq = (typeof pitchEnd === 'number' && pitchEnd <= 127 && Math.abs(pitchEnd - Math.round(pitchEnd)) < 0.001)
              ? Tone.Frequency(Math.round(pitchEnd), 'midi').toFrequency()
              : Tone.Frequency(pitchEnd).toFrequency()
          }
          const durSec = Tone.Time(duration).toSeconds()
          if (noteData?.pitchSlide) {
            endFreq = freq * Math.pow(2, noteData.pitchSlide / 12)
          }

          const lyric = noteData?.lyric || 'a'
          const state = useStore.getState()
          const voicePresetId = noteData?.voicePresetId || 'soprano'
          let preset = state.voicePresets.find(p => p.id === voicePresetId)
          if (!preset) {
            preset = state.voicePresets[0] || {
              id: 'soprano',
              name: 'Soprano',
              vocalTractLength: 1.15,
              breathiness: 0.1,
              glottalTension: 0.85,
              vibratoDepth: 35,
              vibratoRate: 6.2,
              jitter: 0.15,
              shimmer: 0.1,
              formantShiftF1: 0,
              formantShiftF2: 0,
              formantShiftF3: 0,
              consonantVolume: 1.0,
              consonantLength: 1.0,
              articulationSpeed: 1.0
            }
          }

          const voice = new VocalModelVoice(rack.input.input as GainNode)
          voice.trigger(freq, durSec, playTime, velocity, preset, lyric, endFreq, {
            glideSeconds: noteData?.pitchSlide
              ? (noteData?.pitchSlideTime ? Tone.Time(noteData.pitchSlideTime + 'i').toSeconds() : durSec)
              : undefined,
            glideCurve: noteData?.pitchSlide ? buildCurveLut(noteData?.pitchSlideRamp, noteData?.pitchSlideCustomCurve || 't * t') : undefined,
            pan: noteData?.pan,
            gain: noteData?.automationGain,
            fadeIn: noteData?.morphFadeIn ? Tone.Time(noteData.morphFadeIn + 'i').toSeconds() : undefined,
            fadeOut: noteData?.morphFadeOut ? Tone.Time(noteData.morphFadeOut + 'i').toSeconds() : undefined,
          })
        } catch (err) {
          console.error("Vocal playNote failed:", err)
        }
        return
      }

      const isPhysicalNote = instrumentOverride === 'physical' || (track?.synthPreset === 'physical' && !instrumentOverride)
      if (isPhysicalNote) {
        try {
          const rack = this.getRack(trackId)
          const baseFreq = (typeof pitch === 'number' && pitch <= 127 && Math.abs(pitch - Math.round(pitch)) < 0.001)
            ? Tone.Frequency(Math.round(pitch), 'midi').toFrequency()
            : Tone.Frequency(pitch).toFrequency()
          const freq = detune ? baseFreq * Math.pow(2, detune / 1200) : baseFreq
          const durSec = Tone.Time(duration).toSeconds()

          const voice = new PhysicalModelVoice(rack.input.input as GainNode)
          voice.trigger(freq, durSec, playTime, velocity, track, {
            targetFrequency: noteData?.pitchSlide ? freq * Math.pow(2, noteData.pitchSlide / 12) : undefined,
            glideSeconds: noteData?.pitchSlide
              ? (noteData?.pitchSlideTime ? Tone.Time(noteData.pitchSlideTime + 'i').toSeconds() : durSec)
              : undefined,
            glideCurve: noteData?.pitchSlide ? buildCurveLut(noteData?.pitchSlideRamp, noteData?.pitchSlideCustomCurve || 't * t') : undefined,
            pan: noteData?.pan,
            gain: noteData?.automationGain,
            fadeIn: noteData?.morphFadeIn ? Tone.Time(noteData.morphFadeIn + 'i').toSeconds() : undefined,
            fadeOut: noteData?.morphFadeOut ? Tone.Time(noteData.morphFadeOut + 'i').toSeconds() : undefined,
          })
        } catch (err) {
          console.error("Physical playNote failed:", err)
        }
        return
      }

      let synth: Tone.PolySynth | undefined
      const mpeNodes: any[] = []
      let ephemeralSynth: Tone.PolySynth | undefined

      const hasNoteOut = !!noteData && (
        noteData.pan !== undefined ||
        noteData.automationGain !== undefined ||
        noteData.morphFadeIn !== undefined ||
        noteData.morphFadeOut !== undefined
      )
      const isMPE = noteData && (noteData.vibratoDepth || noteData.tremoloDepth || noteData.filterStart || hasNoteOut)

      if (isMPE) {
        const preset = instrumentOverride ? (instrumentOverride as SynthPreset) : (track?.synthPreset || 'piano')
        ephemeralSynth = this.createSynthForPreset(preset as SynthPreset)
        const rack = this.getRack(trackId)

        if (noteData.vibratoDepth) {
          const vibrato = new Tone.Vibrato({
            frequency: noteData.vibratoRate || 5,
            depth: 0,
            type: noteData.vibratoWave || 'sine'
          })
          const depthDelay = Math.max(0, (noteData.vibratoDelay || 0) / 1000)
          const depthFade = Math.max(0, (noteData.vibratoFade || 0) / 1000)
          const fullDepth = Math.max(0, Math.min(1, noteData.vibratoDepth / 100))
          vibrato.depth.setValueAtTime(0, playTime)
          vibrato.depth.linearRampToValueAtTime(fullDepth, playTime + depthDelay + Math.max(0.001, depthFade))
          mpeNodes.push(vibrato)
        }
        if (noteData.tremoloDepth) {
          mpeNodes.push(new Tone.Tremolo({
            frequency: noteData.tremoloRate || 5,
            depth: noteData.tremoloDepth,
            type: noteData.tremoloWave || 'sine'
          }).start())
        }
        if (noteData.filterStart) {
          const filter = new Tone.Filter(noteData.filterStart, 'lowpass')
          mpeNodes.push(filter)
          if (noteData.filterEnd) {
            const durSec = Tone.Time(duration).toSeconds()
            const sweepTime = noteData.filterSweepTime ? Tone.Time(noteData.filterSweepTime + 'i').toSeconds() : durSec
            filter.frequency.setValueAtTime(noteData.filterStart, playTime)
            filter.frequency.rampTo(noteData.filterEnd, sweepTime, playTime)
          }
        }
        if (hasNoteOut) {
          const outGain = new Tone.Gain(1)
          const baseGain = noteData.automationGain !== undefined ? Math.max(0, Math.min(1, noteData.automationGain)) : 1
          const fadeIn = noteData.morphFadeIn ? Tone.Time(noteData.morphFadeIn + 'i').toSeconds() : 0
          const fadeOut = noteData.morphFadeOut ? Tone.Time(noteData.morphFadeOut + 'i').toSeconds() : 0
          outGain.gain.setValueAtTime(fadeIn > 0 ? 0 : baseGain, playTime)
          if (fadeIn > 0) outGain.gain.linearRampToValueAtTime(baseGain, playTime + fadeIn)
          if (fadeOut > 0) outGain.gain.linearRampToValueAtTime(0, playTime + fadeOut)
          mpeNodes.push(outGain)
          if (noteData.pan) {
            mpeNodes.push(new Tone.Panner(Math.max(-1, Math.min(1, noteData.pan))))
          }
        }

        if (mpeNodes.length > 0) {
          ephemeralSynth.chain(...mpeNodes, rack.input)
        } else {
          ephemeralSynth.connect(rack.input)
        }
        synth = ephemeralSynth

        const durSec = Tone.Time(duration).toSeconds()
        Tone.Transport.scheduleOnce(() => {
          try {
            ephemeralSynth?.dispose()
            mpeNodes.forEach(n => n.dispose())
          } catch (e) { }
        }, playTime + durSec + 4) // 4s buffer for release tails
      }
      else if (instrumentOverride) {
        const synthPreset = instrumentOverride as SynthPreset
        let trackOverrides = this.overrideSynths.get(trackId)
        if (!trackOverrides) {
          trackOverrides = new Map()
          this.overrideSynths.set(trackId, trackOverrides)
        }
        synth = trackOverrides.get(synthPreset)
        if (!synth) {
          synth = this.createSynthForPreset(synthPreset)
          const rack = this.getRack(trackId)
          synth.connect(rack.input)
          trackOverrides.set(synthPreset, synth)
        }
      } else {
        synth = this.synths.get(trackId)
        if (!synth && track) {
          this.ensureInstrumentForTrack(track)
          synth = this.synths.get(trackId)
        }
      }

      if (synth) {
        // Resolve acoustic frequency and note representation without MIDI integer ambiguity
        let baseFreq: number
        let initialNote: string | number
        if (typeof pitch === 'string') {
          baseFreq = Tone.Frequency(pitch).toFrequency()
          initialNote = pitch
        } else if (typeof pitch === 'number') {
          if (pitch >= 0 && pitch <= 127 && Math.abs(pitch - Math.round(pitch)) < 0.001) {
            const midiVal = Math.round(pitch)
            baseFreq = Tone.Frequency(midiVal, 'midi').toFrequency()
            initialNote = Tone.Frequency(midiVal, 'midi').toNote()
          } else {
            baseFreq = pitch
            initialNote = pitch
          }
        } else {
          baseFreq = 440
          initialNote = 'A4'
        }

        let finalPitch: string | number = detune
          ? (baseFreq * Math.pow(2, detune / 1200))
          : initialNote

        // Microtonal / Sub-audible frequency boost safeguard:
        // Any frequency below 35 Hz (infrasound in octaves -1 and 0) cannot be physically reproduced
        // by consumer computer speakers/headphones. We fold it up by octaves so it is clearly audible.
        if (typeof finalPitch === 'number') {
          if (finalPitch > 0 && finalPitch < 35) {
            while (finalPitch < 35) finalPitch *= 2
          }
        } else if (typeof finalPitch === 'string') {
          try {
            let freq = Tone.Frequency(finalPitch).toFrequency()
            if (freq > 0 && freq < 35) {
              while (freq < 35) freq *= 2
              finalPitch = freq
            }
          } catch (_) {}
        }

        let targetPitchEnd = pitchEnd
        if (noteData?.pitchSlide) {
          targetPitchEnd = (typeof finalPitch === 'number' && finalPitch <= 127 && Math.abs(finalPitch - Math.round(finalPitch)) < 0.001)
            ? Tone.Frequency(Math.round(finalPitch), 'midi').transpose(noteData.pitchSlide).toNote()
            : Tone.Frequency(finalPitch).transpose(noteData.pitchSlide).toNote()
        }

        if (targetPitchEnd) {
          const stretchMode = state.verticalStretchMode
          let startFreq = (typeof finalPitch === 'number' && finalPitch <= 127 && Math.abs(finalPitch - Math.round(finalPitch)) < 0.001)
            ? Tone.Frequency(Math.round(finalPitch), 'midi').toFrequency()
            : Tone.Frequency(finalPitch).toFrequency()
          let endFreq = (typeof targetPitchEnd === 'number' && targetPitchEnd <= 127 && Math.abs(targetPitchEnd - Math.round(targetPitchEnd)) < 0.001)
            ? Tone.Frequency(Math.round(targetPitchEnd), 'midi').toFrequency()
            : Tone.Frequency(targetPitchEnd).toFrequency()
          if (startFreq > 0 && startFreq < 35) {
            while (startFreq < 35) startFreq *= 2
          }
          if (endFreq > 0 && endFreq < 35) {
            while (endFreq < 35) endFreq *= 2
          }
          const startMidi = Tone.Frequency(startFreq).toMidi()
          const endMidi = Tone.Frequency(endFreq).toMidi()

          const steps = Math.max(2, Math.abs(startMidi - endMidi) * 2) // 2 notes per semitone
          const durSec = Tone.Time(duration).toSeconds()

          if (stretchMode === 'cluster') {
            const freqs = []
            for (let i = 0; i <= steps; i++) {
              freqs.push(startFreq + (endFreq - startFreq) * (i / steps))
            }
            synth.triggerAttackRelease(freqs, duration, time, velocity * 0.7) // Reduce velocity to prevent clipping
          } else {
            const glideStyle = noteData?.glideStyle || state.glideStyle || 'smooth'
            const glideDur = noteData?.pitchSlideTime
              ? Tone.Time(noteData.pitchSlideTime + 'i').toSeconds()
              : durSec

            if (glideStyle === 'smooth') {
              try {
                const ownsEphem = !ephemeralSynth
                let ephem = ephemeralSynth
                if (!ephem) {
                  const preset = instrumentOverride ? (instrumentOverride as SynthPreset) : (track?.synthPreset || 'piano')
                  ephem = track ? this.createSynthForTrack(track, instrumentOverride as SynthPreset) : this.createSynthForPreset(preset as SynthPreset)
                  const rack = this.getRack(trackId)
                  ephem.connect(rack.input)
                }

                ephem.triggerAttack(finalPitch, playTime, velocity)

                const cents = (endMidi - startMidi) * 100
                ;(ephem as any).detune.setValueAtTime(0, playTime)

                const rampType = noteData?.pitchSlideRamp || 'linear'
                const customEquation = noteData?.pitchSlideCustomCurve || 't * t'

                if (rampType === 'linear') {
                  ;(ephem as any).detune.linearRampToValueAtTime(cents, playTime + glideDur)
                } else {
                  const stepCount = Math.max(10, Math.min(200, Math.round(glideDur * 100)))
                  const stepTime = glideDur / stepCount

                  for (let i = 1; i <= stepCount; i++) {
                    const t = i / stepCount
                    const y = evaluateGlideCurve(t, rampType, customEquation)
                    ;(ephem as any).detune.setValueAtTime(y * cents, playTime + i * stepTime)
                  }
                }

                ephem.triggerRelease(finalPitch, playTime + durSec)

                if (ownsEphem) {
                  Tone.Transport.scheduleOnce(() => {
                    try {
                      ephem!.dispose()
                    } catch (e) { }
                  }, playTime + durSec + 4)
                }
              } catch (err) {
                console.error("Smooth glide playNote failed:", err)
              }
            } else {
              // Glide (Arpeggiated Strum)
              const stepDur = glideDur / steps
              for (let i = 0; i <= steps; i++) {
                const f = startFreq + (endFreq - startFreq) * (i / steps)
                const t = (time ?? Tone.now()) + (i * stepDur)
                const sustainDur = i === steps ? Math.max(stepDur * 1.5, durSec - glideDur) : stepDur * 1.5
                synth.triggerAttackRelease(f, sustainDur, t, velocity)
              }
            }
          }
        } else {
          synth.triggerAttackRelease(finalPitch, duration, time, velocity)
        }
      }
    } else {
      let drum: DrumMachine | undefined
      if (instrumentOverride) {
        const drumKit = instrumentOverride as DrumKit
        let trackOverrides = this.overrideDrums.get(trackId)
        if (!trackOverrides) {
          trackOverrides = new Map()
          this.overrideDrums.set(trackId, trackOverrides)
        }
        drum = trackOverrides.get(drumKit)
        if (!drum) {
          drum = new DrumMachine(drumKit)
          const rack = this.getRack(trackId)
          drum.connect(rack.input)
          trackOverrides.set(drumKit, drum)
        }
      } else {
        drum = this.drums.get(trackId)
      }

      if (drum) {
        const trackTranspose = track?.transpose ?? 0
        const notePitchOffset = noteData?.pitchOffset ?? 0
        const detuneOffset = (detune || (noteData?.detune ?? 0)) / 100
        const totalPitchOffset = trackTranspose + notePitchOffset + detuneOffset

        let slideOpts: any = undefined
        if (noteData?.pitchSlide !== undefined && noteData.pitchSlide !== 0) {
          slideOpts = {
            targetPitchOffset: noteData.pitchSlide,
            slideTime: noteData.pitchSlideTime,
            ramp: noteData.pitchSlideRamp,
            customCurve: noteData.pitchSlideCustomCurve
          }
        }

        // Native drums already apply per-hit gain/pan/fades; give the Tone preview the
        // same output trim so an automated or morphed drum note sounds identical.
        const drumOutput: DrumOutputOptions = {
          pan: noteData?.pan,
          gain: noteData?.automationGain,
          fadeIn: noteData?.morphFadeIn ? Tone.Time(noteData.morphFadeIn + 'i').toSeconds() : undefined,
          fadeOut: noteData?.morphFadeOut ? Tone.Time(noteData.morphFadeOut + 'i').toSeconds() : undefined
        }

        if (typeof pitch === 'number' && pitch >= 1000) {
          const mixRow = state.customDrumRows?.find(r => r.syntheticPitch === pitch)
          if (mixRow) {
            const velA = velocity * (1 - mixRow.proportion)
            const velB = velocity * mixRow.proportion
            if (velA > 0.01) drum.triggerAttackRelease(mixRow.drumA, duration, time, velA, totalPitchOffset, slideOpts, undefined, drumOutput)
            if (velB > 0.01) drum.triggerAttackRelease(mixRow.drumB, duration, time, velB, totalPitchOffset, slideOpts, undefined, drumOutput)
            return
          }
        }
        drum.triggerAttackRelease(pitch, duration, time, velocity, totalPitchOffset, slideOpts, {
          octaves: noteData?.octaves,
          resonance: noteData?.resonance,
          decay: noteData?.decay
        }, drumOutput)
      }
    }
  }

  // --- Real-Time Bounce Recording ---
  private _realtimeBounceCancel = false
  private _realtimeBounceStop: (() => void) | null = null

  cancelRealtimeBounce() {
    this._realtimeBounceCancel = true
    if (this._realtimeBounceStop) {
      this._realtimeBounceStop()
    }
  }

  async startRealtimeBounce(options: {
    trackId?: string
    trackIds?: string[]
    tailSeconds: number
    startTick: number
    endTick: number
    includeMetronome?: boolean
    includeProceduralFx?: boolean
    onProgress?: (elapsed: number, total: number) => void
  }): Promise<AudioBuffer | null> {
    if (!this.isInitialized) await this.init()

    this._realtimeBounceCancel = false

    const state = useStore.getState()
    const PPQ = 192
    const bpm = state.bpm
    const ticksPerSecond = (bpm / 60) * PPQ
    const durationSeconds = Math.max(0.05, (options.endTick - options.startTick) / ticksPerSecond)
    const totalRecordSeconds = Math.max(0.1, durationSeconds + Math.max(0, options.tailSeconds))

    const toneRawContext = (this.masterLimiter.context as any)?.rawContext || Tone.context.rawContext
    const rawContext = toneRawContext as AudioContext & { _nativeAudioContext?: AudioContext }
    const ctx = (rawContext as any)?.createScriptProcessor ? rawContext : ((rawContext as any)?._nativeAudioContext || rawContext)
    if (!ctx) {
      throw new Error('Real-time bounce requires an active AudioContext')
    }
    const safeCtx = ctx as AudioContext

    // Save current state to restore later
    const savedPlayhead = state.playheadPosition
    const savedIsPlaying = state.isPlaying
    const savedIsRecording = state.isRecording
    const savedMetronomeEnabled = state.metronomeEnabled
    const savedProceduralFxEnabled = state.studioSettings.proceduralFxEnabled
    const savedLoopEnabled = Tone.Transport.loop
    const savedLoopStart = Tone.Transport.loopStart
    const savedLoopEnd = Tone.Transport.loopEnd
    const savedMuteStates = new Map<string, boolean>()
    const savedSoloStates = new Map<string, boolean>()

    this.stopActiveNotes()
    Tone.Transport.stop()
    Tone.Transport.loop = false
    useStore.getState().setIsPlaying(false)
    useStore.getState().setIsRecording(false)
    useStore.getState().setMetronomeEnabled(!!options.includeMetronome)
    useStore.getState().updateStudio({
      proceduralFxEnabled: options.includeProceduralFx ?? savedProceduralFxEnabled,
    })

    // Solo the target tracks if specified
    const targetTrackIds = options.trackIds?.length
      ? options.trackIds
      : options.trackId
        ? [options.trackId]
        : null

    if (targetTrackIds) {
      state.tracks.forEach(t => {
        savedMuteStates.set(t.id, t.muted)
        savedSoloStates.set(t.id, t.soloed)
      })
      // Solo only the target tracks
      targetTrackIds.forEach(id => {
        const track = state.tracks.find(t => t.id === id)
        if (track) {
          useStore.getState().updateTrack(id, { soloed: true, muted: false })
        }
      })
      // Unsolo all others
      state.tracks.forEach(t => {
        if (!targetTrackIds.includes(t.id)) {
          useStore.getState().updateTrack(t.id, { soloed: false })
        }
      })
    }

    if (safeCtx.state === 'suspended') {
      try { await safeCtx.resume() } catch {}
    }
    if (Tone.context.state === 'suspended') {
      try { await Tone.context.resume() } catch {}
    }

    const bufferSize = 4096
    const recorderNode = safeCtx.createScriptProcessor(bufferSize, 2, 2)

    const leftChunks: Float32Array[] = []
    const rightChunks: Float32Array[] = []
    let totalSamples = 0
    let isRecording = true

    recorderNode.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0)
      const r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l

      // Pass-through to speakers so audio is physically heard and never optimized away
      const outL = e.outputBuffer.getChannelData(0)
      const outR = e.outputBuffer.numberOfChannels > 1 ? e.outputBuffer.getChannelData(1) : outL
      outL.set(l)
      outR.set(r)

      if (isRecording) {
        leftChunks.push(new Float32Array(l))
        rightChunks.push(new Float32Array(r))
        totalSamples += l.length
      }
    }

    const restoreBounceState = () => {
      isRecording = false
      try { recorderNode.disconnect() } catch { /* ignore */ }
      try { this.masterLimiter.disconnect() } catch { /* ignore */ }
      try { this.masterLimiter.toDestination() } catch { /* ignore */ }

      if (targetTrackIds) {
        state.tracks.forEach(t => {
          useStore.getState().updateTrack(t.id, {
            muted: savedMuteStates.get(t.id) ?? false,
            soloed: savedSoloStates.get(t.id) ?? false,
          })
        })
      }

      useStore.getState().setMetronomeEnabled(savedMetronomeEnabled)
      useStore.getState().updateStudio({ proceduralFxEnabled: savedProceduralFxEnabled })
      useStore.getState().setIsRecording(savedIsRecording)

      Tone.Transport.stop()
      this.stopActiveNotes()
      Tone.Transport.loop = savedLoopEnabled
      Tone.Transport.loopStart = savedLoopStart
      Tone.Transport.loopEnd = savedLoopEnd
      Tone.Transport.position = `${savedPlayhead}i`
      useStore.getState().setPlayheadPosition(savedPlayhead)

      if (savedIsPlaying && !this._realtimeBounceCancel) {
        Tone.Transport.start()
        useStore.getState().setIsPlaying(true)
        this.resumeActiveNotes()
      } else {
        useStore.getState().setIsPlaying(false)
      }
    }

    try {
      this.masterLimiter.disconnect()
      this.masterLimiter.connect(recorderNode)
      recorderNode.connect(safeCtx.destination)
    } catch (err) {
      console.warn('[RealtimeBounce] Could not connect recorder node to limiter (likely hardware direct routing):', err)
      try { this.masterLimiter.toDestination() } catch {}
    }

    return new Promise<AudioBuffer | null>((resolve) => {
      let progressInterval: any = null
      let finished = false

      const finish = () => {
        if (finished) return
        finished = true
        if (progressInterval) clearInterval(progressInterval)
        this._realtimeBounceStop = null

        restoreBounceState()

        if (this._realtimeBounceCancel) {
          console.warn('[RealtimeBounce] Bounce was cancelled by user.')
          resolve(null)
          return
        }

        if (totalSamples === 0) {
          console.warn('[RealtimeBounce] Bounce recorded 0 samples (hardware direct routing). Fallback renderer will compute audio.')
          resolve(null)
          return
        }

        try {
          const audioBuffer = safeCtx.createBuffer(2, totalSamples, safeCtx.sampleRate)
          const ch0 = audioBuffer.getChannelData(0)
          const ch1 = audioBuffer.getChannelData(1)
          let offset = 0
          for (let i = 0; i < leftChunks.length; i++) {
            ch0.set(leftChunks[i], offset)
            ch1.set(rightChunks[i], offset)
            offset += leftChunks[i].length
          }
          resolve(audioBuffer)
        } catch (e) {
          console.error('Failed to construct realtime AudioBuffer:', e)
          resolve(null)
        }
      }

      this._realtimeBounceStop = finish

      // Set transport to start position and begin playback
      Tone.Transport.position = `${options.startTick}i`
      Tone.Transport.start()
      useStore.getState().setIsPlaying(true)

      // Progress reporting & auto-stop
      const startTime = performance.now()
      progressInterval = setInterval(() => {
        if (this._realtimeBounceCancel) {
          finish()
          return
        }
        const elapsed = (performance.now() - startTime) / 1000
        options.onProgress?.(elapsed, totalRecordSeconds)

        if (elapsed >= totalRecordSeconds) {
          finish()
        }
      }, 50)
    })
  }

  /** Preview a VoicePreset by singing the "Daisy Bell" chorus — the first song ever sung by a computer (IBM 7094, 1961) */
  previewVoicePreset(preset: VoicePreset) {
    try {
      const ctx = Tone.getContext().rawContext as AudioContext
      if (ctx.state === 'suspended') ctx.resume()

      // Cleanly terminate any running preview to avoid overlapping voices / cacophony
      if (this.activeVoicePreviewGain) {
        try {
          this.activeVoicePreviewGain.gain.setValueAtTime(this.activeVoicePreviewGain.gain.value, ctx.currentTime)
          this.activeVoicePreviewGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.04)
          const oldGain = this.activeVoicePreviewGain
          setTimeout(() => {
            try { oldGain.disconnect() } catch {}
          }, 60)
        } catch {}
      }
      if (this.activeVoicePreviewTimer) {
        clearTimeout(this.activeVoicePreviewTimer)
        this.activeVoicePreviewTimer = null
      }

      // Create a clean preview gain connected to destination
      const previewGain = ctx.createGain()
      previewGain.gain.setValueAtTime(1.0, ctx.currentTime)
      previewGain.connect(ctx.destination)
      this.activeVoicePreviewGain = previewGain

      // "Daisy Bell" chorus melody (Harry Dacre, 1892) — key of C, 3/4 waltz
      // "Dai-sy, Dai-sy, give me your an-swer, do!
      //  I'm half cra-zy, all for the love of you!"
      const DAISY_MELODY: { syllable: string; midi: number; dur: number; breathPause?: number }[] = [
        // "Dai-sy, Dai-sy,"
        { syllable: 'Dai',  midi: 64, dur: 0.55 },  // E4
        { syllable: 'sy',   midi: 60, dur: 0.38, breathPause: 0.08 },  // C4
        { syllable: 'Dai',  midi: 62, dur: 0.55 },  // D4
        { syllable: 'sy',   midi: 55, dur: 0.38, breathPause: 0.12 },  // G3
        // "give me your an-swer, do!"
        { syllable: 'give', midi: 57, dur: 0.32 },  // A3
        { syllable: 'me',   midi: 59, dur: 0.32 },  // B3
        { syllable: 'your', midi: 60, dur: 0.35 },  // C4
        { syllable: 'an',   midi: 62, dur: 0.32 },  // D4
        { syllable: 'swer', midi: 64, dur: 0.35 },  // E4
        { syllable: 'do',   midi: 60, dur: 0.75, breathPause: 0.14 },  // C4
        // "I'm half cra-zy,"
        { syllable: "I'm",  midi: 64, dur: 0.45 },  // E4
        { syllable: 'half', midi: 65, dur: 0.38 },  // F4
        { syllable: 'cra',  midi: 64, dur: 0.38 },  // E4
        { syllable: 'zy',   midi: 62, dur: 0.50, breathPause: 0.10 },  // D4
        // "all for the love of you!"
        { syllable: 'all',  midi: 60, dur: 0.40 },  // C4
        { syllable: 'for',  midi: 62, dur: 0.30 },  // D4
        { syllable: 'the',  midi: 64, dur: 0.28 },  // E4
        { syllable: 'love', midi: 62, dur: 0.35 },  // D4
        { syllable: 'of',   midi: 60, dur: 0.30 },  // C4
        { syllable: 'you',  midi: 60, dur: 0.95 },  // C4
      ]

      // Each trigger renders its syllable synchronously (200-400 ms in waveguide/FOF). Rendering all 20
      // in one click froze the UI for 4-7 s and WebAudio then clamped the opening syllables to "now",
      // stacking them into a chord. Schedule in small chunks, re-reading the clock per syllable.
      const generation = ++this.activeVoicePreviewGeneration
      let index = 0
      let nextStart = ctx.currentTime + 0.05

      const scheduleChunk = () => {
        if (generation !== this.activeVoicePreviewGeneration) {
          try { previewGain.disconnect() } catch {}
          return
        }
        const chunkStart = performance.now()
        while (index < DAISY_MELODY.length) {
          const note = DAISY_MELODY[index++]
          const freq = 440 * Math.pow(2, (note.midi - 69) / 12)
          // Never schedule into the past — this is the guard that removes the opening chord.
          const start = Math.max(nextStart, ctx.currentTime + 0.02)
          const voice = new VocalModelVoice(previewGain)
          voice.trigger(freq, note.dur, start, 1.0, preset, note.syllable)
          nextStart = start + note.dur + (note.breathPause || 0.0) // Natural legato phrasing: smooth syllable connection, breath between phrases
          if (performance.now() - chunkStart > 90) break
        }

        if (index < DAISY_MELODY.length) {
          this.activeVoicePreviewTimer = setTimeout(scheduleChunk, 0)
          return
        }

        // Auto-disconnect after playback finishes
        const waitMs = Math.max(600, (nextStart - ctx.currentTime + 0.4) * 1000)
        this.activeVoicePreviewTimer = setTimeout(() => {
          try {
            previewGain.disconnect()
            if (this.activeVoicePreviewGain === previewGain) {
              this.activeVoicePreviewGain = null
            }
          } catch {}
        }, waitMs)
      }

      scheduleChunk()
    } catch (err) {
      console.error('Voice preview failed:', err)
    }
  }
}

export const audioEngine = new AudioEngine()
