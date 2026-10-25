// @ts-ignore
import * as lameModule from '@breezystack/lamejs'

type Mp3EncoderInstance = {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array
  flush(): Int8Array
}

// Resolve Mp3Encoder constructor across ESM, CJS, and Vite bundling
const Mp3EncoderClass: any =
  (lameModule as any).Mp3Encoder ||
  (lameModule as any).default?.Mp3Encoder ||
  (lameModule as any).default ||
  (typeof window !== 'undefined' && (window as any).lamejs?.Mp3Encoder)

function floatToInt16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output
}

function toArrayBuffer(bytes: Int8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

export function audioBufferToMp3(audioBuffer: AudioBuffer, kbps = 192): Blob {
  const channelCount = Math.min(2, audioBuffer.numberOfChannels)
  if (!Mp3EncoderClass) {
    throw new Error('MP3 Encoder module is unavailable in this environment')
  }
  const encoder: Mp3EncoderInstance = new Mp3EncoderClass(
    channelCount,
    audioBuffer.sampleRate,
    kbps,
  )
  const left = floatToInt16(audioBuffer.getChannelData(0))
  const right = channelCount === 2 ? floatToInt16(audioBuffer.getChannelData(1)) : undefined
  const chunks: BlobPart[] = []
  const sampleBlockSize = 1152

  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize)
    const rightChunk = right?.subarray(i, i + sampleBlockSize)
    const encoded = rightChunk ? encoder.encodeBuffer(leftChunk, rightChunk) : encoder.encodeBuffer(leftChunk)
    if (encoded.length > 0) chunks.push(toArrayBuffer(encoded))
  }

  const finalChunk = encoder.flush()
  if (finalChunk.length > 0) chunks.push(toArrayBuffer(finalChunk))

  return new Blob(chunks, { type: 'audio/mpeg' })
}
