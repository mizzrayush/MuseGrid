import * as Tone from 'tone'

export interface MicRecordingResult {
  blob: Blob
  buffer: AudioBuffer
  detectedMidiNote?: number
  durationSec: number
}

// Autocorrelation pitch detection algorithm to track dominant pitch in an audio segment
export function detectFundamentalPitch(signal: Float32Array, sampleRate: number): number | null {
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

  // Threshold to avoid picking noise peaks
  const thresh = 0.2
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
    // Valid vocal/melodic instrument range (45 Hz to 1800 Hz)
    if (freq >= 45 && freq <= 1800) {
      return freq
    }
  }
  return null
}

export function hzToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69)
}

export class QuickMicRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private audioCtx: AudioContext | null = null
  private isRecording: boolean = false

  public async start(): Promise<void> {
    if (this.isRecording) return
    this.chunks = []

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
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
  }

  public get recording(): boolean {
    return this.isRecording
  }

  public stop(): Promise<MicRecordingResult> {
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
          const audioBuffer = await rawCtx.decodeAudioData(arrayBuffer)

          // Try fundamental pitch detection on middle of recording
          let detectedMidiNote: number | undefined
          if (audioBuffer.length > 2048) {
            const channelData = audioBuffer.getChannelData(0)
            const sampleSliceSize = Math.min(4096, channelData.length)
            const midStart = Math.max(0, Math.floor((channelData.length - sampleSliceSize) / 2))
            const sampleSlice = channelData.slice(midStart, midStart + sampleSliceSize)
            const freq = detectFundamentalPitch(sampleSlice, audioBuffer.sampleRate)
            if (freq) {
              detectedMidiNote = Math.max(24, Math.min(96, hzToMidi(freq)))
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
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop()
      } catch {}
    }
    this.cleanup()
  }

  private cleanup(): void {
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
