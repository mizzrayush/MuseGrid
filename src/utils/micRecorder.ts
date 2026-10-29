import * as Tone from 'tone'
import { useStore, type MicRecordingSettings, DEFAULT_MIC_SETTINGS } from '../engine/store'

export interface MicRecordingResult {
  blob: Blob
  buffer: AudioBuffer
  detectedMidiNote?: number
  durationSec: number
}

// Autocorrelation pitch detection algorithm to track dominant pitch in an audio segment
export function detectFundamentalPitch(
  signal: Float32Array,
  sampleRate: number,
  thresh = 0.2,
  minHz = 45,
  maxHz = 1800
): number | null {
  const SIZE = signal.length
  if (SIZE < 256) return null

  // Calculate autocorrelation
  const r = new Float32Array(SIZE)
  for (let lag = 0; lag < SIZE; lag++) {
    let sum = 0
    for (let i = 0; i < SIZE - lag; i++) {
      sum += signal[i] * signal[i + lag]
    }
    r[lag] = sum
  }

  let peak = -1
  let maxVal = -1

  let startLag = 0
  while (startLag < SIZE - 1 && r[startLag] >= r[startLag + 1]) {
    startLag++
  }

  for (let lag = startLag; lag < SIZE; lag++) {
    if (r[lag] > r[lag - 1] && r[lag] > r[lag + 1]) {
      if (r[lag] > maxVal) {
        maxVal = r[lag]
        peak = lag
      }
    }
  }

  if (peak !== -1 && maxVal > r[0] * thresh) {
    const freq = sampleRate / peak
    if (freq >= minHz && freq <= maxHz) {
      return freq
    }
  }
  return null
}

export function hzToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69)
}

// Peak normalize AudioBuffer to target dBFS (default -0.5 dB)
export function normalizeAudioBuffer(buffer: AudioBuffer, targetDb = -0.5, rawCtx?: AudioContext): AudioBuffer {
  let peak = 0
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i])
      if (abs > peak) peak = abs
    }
  }

  if (peak <= 0.00001) return buffer
  const targetLinear = Math.pow(10, targetDb / 20)
  const multiplier = targetLinear / peak

  const ctx = rawCtx || (Tone.getContext().rawContext as AudioContext)
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const inData = buffer.getChannelData(c)
    const outData = out.getChannelData(c)
    for (let i = 0; i < inData.length; i++) {
      outData[i] = inData[i] * multiplier
    }
  }
  return out
}

// Trim leading and trailing silence below dB threshold
export function trimAudioBufferSilence(buffer: AudioBuffer, silenceThresholdDb = -42, rawCtx?: AudioContext): AudioBuffer {
  const thresholdLinear = Math.pow(10, silenceThresholdDb / 20)
  const numChannels = buffer.numberOfChannels
  const len = buffer.length
  let startIdx = 0
  let endIdx = len - 1

  // Find start
  outerStart: for (let i = 0; i < len; i++) {
    for (let c = 0; c < numChannels; c++) {
      if (Math.abs(buffer.getChannelData(c)[i]) >= thresholdLinear) {
        startIdx = Math.max(0, i - 128) // include small 128-sample ramp
        break outerStart
      }
    }
  }

  // Find end
  outerEnd: for (let i = len - 1; i >= startIdx; i--) {
    for (let c = 0; c < numChannels; c++) {
      if (Math.abs(buffer.getChannelData(c)[i]) >= thresholdLinear) {
        endIdx = Math.min(len - 1, i + 128)
        break outerEnd
      }
    }
  }

  const trimmedLen = endIdx - startIdx + 1
  if (trimmedLen <= 0 || trimmedLen === len) return buffer

  const ctx = rawCtx || (Tone.getContext().rawContext as AudioContext)
  const out = ctx.createBuffer(numChannels, trimmedLen, buffer.sampleRate)
  for (let c = 0; c < numChannels; c++) {
    const inData = buffer.getChannelData(c)
    const outData = out.getChannelData(c)
    for (let i = 0; i < trimmedLen; i++) {
      outData[i] = inData[startIdx + i]
    }
  }
  return out
}

// Scale gain of AudioBuffer
export function applyGainToAudioBuffer(buffer: AudioBuffer, gain: number, rawCtx?: AudioContext): AudioBuffer {
  if (Math.abs(gain - 1.0) < 0.001) return buffer
  const ctx = rawCtx || (Tone.getContext().rawContext as AudioContext)
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const inData = buffer.getChannelData(c)
    const outData = out.getChannelData(c)
    for (let i = 0; i < inData.length; i++) {
      outData[i] = inData[i] * gain
    }
  }
  return out
}

export class QuickMicRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private audioCtx: AudioContext | null = null
  private isRecording: boolean = false
  private autoStopTimer: any = null
  private settings: MicRecordingSettings

  constructor(customSettings?: Partial<MicRecordingSettings>) {
    const liveSettings = useStore.getState().micSettings || DEFAULT_MIC_SETTINGS
    this.settings = { ...liveSettings, ...(customSettings || {}) }
  }

  public async start(): Promise<void> {
    if (this.isRecording) return
    this.chunks = []

    // Refresh settings from current store
    const liveSettings = useStore.getState().micSettings || DEFAULT_MIC_SETTINGS
    this.settings = { ...liveSettings, ...this.settings }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: this.settings.echoCancellation,
        noiseSuppression: this.settings.noiseSuppression,
        autoGainControl: this.settings.autoGainControl
      }
    })

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    this.audioCtx = new AudioCtx()

    this.mediaRecorder = new MediaRecorder(this.stream)
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data)
      }
    }

    this.mediaRecorder.start(100)
    this.isRecording = true

    // Safety duration timeout
    if (this.settings.maxDurationSec > 0) {
      this.autoStopTimer = setTimeout(() => {
        if (this.isRecording) {
          this.stop().catch(() => {})
        }
      }, this.settings.maxDurationSec * 1000)
    }
  }

  public get recording(): boolean {
    return this.isRecording
  }

  public stop(): Promise<MicRecordingResult> {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer)
      this.autoStopTimer = null
    }

    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        reject(new Error('Recorder not active'))
        return
      }

      this.mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(this.chunks, { type: 'audio/wav' })
          const arrayBuffer = await blob.arrayBuffer()
          const rawCtx = Tone.getContext().rawContext as AudioContext
          let audioBuffer = await rawCtx.decodeAudioData(arrayBuffer)

          // 1. Apply software input gain if configured
          if (this.settings.inputGain !== 1.0) {
            audioBuffer = applyGainToAudioBuffer(audioBuffer, this.settings.inputGain, rawCtx)
          }

          // 2. Auto-trim silence from start/end
          if (this.settings.autoTrimSilence) {
            audioBuffer = trimAudioBufferSilence(audioBuffer, this.settings.silenceTrimThresholdDb, rawCtx)
          }

          // 3. Peak normalize to clear studio volume
          if (this.settings.autoNormalize) {
            audioBuffer = normalizeAudioBuffer(audioBuffer, -0.5, rawCtx)
          }

          // 4. Fundamental pitch detection
          let detectedMidiNote: number | undefined
          if (this.settings.pitchDetectionEnabled && audioBuffer.length > 1024) {
            const channelData = audioBuffer.getChannelData(0)
            const sampleSliceSize = Math.min(4096, channelData.length)
            const midStart = Math.max(0, Math.floor((channelData.length - sampleSliceSize) / 2))
            const sampleSlice = channelData.slice(midStart, midStart + sampleSliceSize)
            const freq = detectFundamentalPitch(
              sampleSlice,
              audioBuffer.sampleRate,
              this.settings.pitchConfidenceThreshold,
              this.settings.minPitchHz,
              this.settings.maxPitchHz
            )
            if (freq) {
              detectedMidiNote = Math.max(21, Math.min(108, hzToMidi(freq)))
            }
          }

          resolve({
            blob,
            buffer: audioBuffer,
            detectedMidiNote,
            durationSec: audioBuffer.duration
          })
        } catch (err) {
          reject(err)
        } finally {
          this.cleanup()
        }
      }

      this.mediaRecorder.stop()
      this.isRecording = false
    })
  }

  public cancel(): void {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer)
      this.autoStopTimer = null
    }
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop()
      } catch {}
    }
    this.cleanup()
  }

  private cleanup(): void {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer)
      this.autoStopTimer = null
    }
    this.isRecording = false
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close()
      } catch {}
      this.audioCtx = null
    }
    this.chunks = []
  }
}
