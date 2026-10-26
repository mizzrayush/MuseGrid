import * as Tone from 'tone'

export interface TrackChannelOptions {
  volume: number
  pan: number
  mute: boolean
  solo: boolean
}

/**
 * Tone.Channel's PanVol panner runs at channelCount 1 with explicit mode, so every
 * track is folded to mono before the master: centre pan costs 3 dB and per-note pans
 * inside the track are erased. A centred strip keeps two channels; a panned strip
 * uses the mono equal-power panner, which is the intended behaviour.
 */
export function createTrackChannel(options: TrackChannelOptions): Tone.Channel {
  return new Tone.Channel({
    ...options,
    channelCount: options.pan === 0 ? 2 : 1,
  })
}

export function setTrackChannelPan(channel: Tone.Channel, pan: number): void {
  const panner = (channel as any)._panVol?._panner?._panner as StereoPannerNode | undefined
  if (panner) panner.channelCount = pan === 0 ? 2 : 1
  channel.pan.value = pan
}
