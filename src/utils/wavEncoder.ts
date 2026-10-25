// @ts-ignore
import * as lameModule from '@breezystack/lamejs'

// Resolve Mp3Encoder across ESM / CJS / Vite bundling variants
const Mp3EncoderClass: any =
  (lameModule as any).Mp3Encoder ||
  (lameModule as any).default?.Mp3Encoder ||
  (lameModule as any).default ||
  (typeof window !== 'undefined' && (window as any).lamejs?.Mp3Encoder)

/**
 * Encodes an AudioBuffer to a WAV Blob: 16- or 24-bit PCM, or 32-bit IEEE float,
 * with all channels interleaved.
 */
export function audioBufferToWav(audioBuffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Blob {
  const numChannels = audioBuffer.numberOfChannels
  const sampleRate  = audioBuffer.sampleRate
  const bytesPerSample = bitDepth / 8
  const numSamples  = audioBuffer.length * numChannels
  const byteLength  = 44 + numSamples * bytesPerSample
  const arrayBuf    = new ArrayBuffer(byteLength)
  const view        = new DataView(arrayBuf)

  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  // RIFF header
  str(0,  'RIFF');  view.setUint32(4,  byteLength - 8,             true)
  str(8,  'WAVE'); str(12, 'fmt ')
  view.setUint32(16, 16,                                            true)  // chunk size
  view.setUint16(20, bitDepth === 32 ? 3 : 1,                      true)  // 3 = IEEE float
  view.setUint16(22, numChannels,                                   true)
  view.setUint32(24, sampleRate,                                    true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample,     true)  // byte-rate
  view.setUint16(32, numChannels * bytesPerSample,                  true)  // block align
  view.setUint16(34, bitDepth,                                      true)
  str(36, 'data'); view.setUint32(40, numSamples * bytesPerSample,  true)

  // Interleave channels and write samples
  let offset = 44
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]))
      if (bitDepth === 16) {
        view.setInt16(offset, s * 0x7FFF, true)
      } else if (bitDepth === 24) {
        const v = Math.max(-0x7FFFFF, Math.min(0x7FFFFF, Math.round(s * 0x7FFFFF)))
        const raw = v < 0 ? v + 0x1000000 : v
        view.setUint8(offset, raw & 0xFF)
        view.setUint8(offset + 1, (raw >> 8) & 0xFF)
        view.setUint8(offset + 2, (raw >> 16) & 0xFF)
      } else {
        view.setFloat32(offset, s, true)
      }
      offset += bytesPerSample
    }
  }

  return new Blob([arrayBuf], { type: 'audio/wav' })
}

/**
 * Encodes an AudioBuffer to an MP3 Blob using lamejs.
 */
export function audioBufferToMp3(audioBuffer: AudioBuffer, kbps = 192): Blob {
  const numChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  if (!Mp3EncoderClass) {
    throw new Error('MP3 Encoder module is unavailable in this environment')
  }
  const mp3encoder = new Mp3EncoderClass(numChannels, sampleRate, kbps)

  // lamejs requires 16-bit integers
  const samplesLeft = new Int16Array(audioBuffer.length)
  const samplesRight = numChannels > 1 ? new Int16Array(audioBuffer.length) : samplesLeft

  const channelDataLeft = audioBuffer.getChannelData(0)
  const channelDataRight = numChannels > 1 ? audioBuffer.getChannelData(1) : channelDataLeft

  // Convert float to 16-bit PCM
  for (let i = 0; i < audioBuffer.length; i++) {
    samplesLeft[i] = Math.max(-1, Math.min(1, channelDataLeft[i])) * 0x7FFF
    if (numChannels > 1) {
      samplesRight[i] = Math.max(-1, Math.min(1, channelDataRight[i])) * 0x7FFF
    }
  }

  const sampleBlockSize = 1152
  const mp3Data: any[] = []

  for (let i = 0; i < samplesLeft.length; i += sampleBlockSize) {
    const leftChunk = samplesLeft.subarray(i, i + sampleBlockSize)
    const rightChunk = numChannels > 1 ? samplesRight.subarray(i, i + sampleBlockSize) : leftChunk
    
    // Ensure chunks are exactly sampleBlockSize or less (subarray handles bounds)
    const mp3buf = numChannels > 1 
      ? mp3encoder.encodeBuffer(leftChunk, rightChunk)
      : mp3encoder.encodeBuffer(leftChunk)
      
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf)
    }
  }

  const mp3buf = mp3encoder.flush()
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf)
  }

  return new Blob(mp3Data, { type: 'audio/mp3' })
}
