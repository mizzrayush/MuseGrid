type SampleTrack = {
  instrument?: string
  synthMode?: string
  synthSampler?: { audioBase64?: string }
  drumPadModes?: Record<number, string>
  drumPadSamples?: Record<number, unknown>
}

export type SamplerRegionConfig = {
  startOffset?: number
  endOffset?: number
  loopStartOffset?: number
  loopEndOffset?: number
  reverse?: boolean
}

// Normalized positions inside the buffer that is actually played (the reversed buffer when
// reverse is on). playStart/playEnd are the trim; loopStart/loopEnd are the sustain span.
export type SamplerRegion = {
  playStart: number
  playEnd: number
  loopStart: number
  loopEnd: number
}

const MIN_LOOP_SPAN = 0.005

export type SamplerLoopMode = 'sustain' | 'releaseTail'

export function resolveSamplerLoopMode(mode: string | undefined): SamplerLoopMode {
  return mode === 'releaseTail' ? 'releaseTail' : 'sustain'
}

export function resolveSamplerRegion(cfg: SamplerRegionConfig): SamplerRegion {
  const start = Math.max(0, Math.min(0.99, cfg.startOffset ?? 0))
  const end = Math.max(start + 0.01, Math.min(1, cfg.endOffset ?? 1))
  const loopStart = Math.max(start, Math.min(cfg.loopStartOffset ?? start, end - MIN_LOOP_SPAN))
  const loopEnd = Math.max(loopStart + MIN_LOOP_SPAN, Math.min(cfg.loopEndOffset ?? end, end))
  const rev = !!cfg.reverse
  return {
    playStart: rev ? 1 - end : start,
    playEnd: rev ? 1 - start : end,
    loopStart: rev ? 1 - loopEnd : loopStart,
    loopEnd: rev ? 1 - loopStart : loopEnd,
  }
}

// Time from the first sample played until playback first reaches the loop end. Notes longer
// than this need the loop; notes shorter than it never wrap.
export function getSamplerFirstPassSeconds(region: SamplerRegion, bufferDuration: number) {
  return Math.max(0, (region.loopEnd - region.playStart) * bufferDuration)
}

export type SamplerPlayPlan = {
  shouldLoop: boolean
  sourceDuration: number | undefined
  loopMode: SamplerLoopMode
  // Buffer offset (seconds) and wall-clock length (seconds) of the part after the loop end.
  tailStartSeconds: number
  tailDurationSeconds: number
}

export function getSamplerPlayPlan(
  noteDurationSeconds: number,
  region: SamplerRegion,
  bufferDuration: number,
  playbackRate: number,
  loopWhileHeld: boolean,
  loopMode: SamplerLoopMode = 'sustain',
): SamplerPlayPlan {
  const rate = Math.max(0.05, playbackRate)
  const firstPass = getSamplerFirstPassSeconds(region, bufferDuration) / rate
  const base = getSamplerPlaybackPlan(noteDurationSeconds, firstPass, loopWhileHeld)
  return {
    ...base,
    loopMode: resolveSamplerLoopMode(loopMode),
    tailStartSeconds: region.loopEnd * bufferDuration,
    tailDurationSeconds: Math.max(0, region.playEnd - region.loopEnd) * bufferDuration / rate,
  }
}

// Drums are one-shots unless the pad opts into a loop mode, so they get their own switch instead
// of the synth sampler's "long note auto-loops" rule.
export function drumSampleShouldLoop(
  noteDurationSeconds: number,
  region: SamplerRegion,
  bufferDuration: number,
  playbackRate: number,
  loopMode: string | undefined,
): boolean {
  if (loopMode !== 'sustain' && loopMode !== 'releaseTail') return false
  const firstPass = getSamplerFirstPassSeconds(region, bufferDuration) / Math.max(0.05, playbackRate)
  return noteDurationSeconds > firstPass + 0.05
}

export function getSamplerPlaybackPlan(
  noteDurationSeconds: number,
  firstPassSeconds: number,
  loopWhileHeld: boolean,
): { shouldLoop: boolean; sourceDuration: number | undefined } {
  const shouldLoop = loopWhileHeld || noteDurationSeconds > firstPassSeconds + 0.05
  return {
    shouldLoop,
    sourceDuration: shouldLoop ? undefined : firstPassSeconds,
  }
}

export function usesWebAudioSamplePlayback(
  track: SampleTrack | undefined,
  type: 'synth' | 'drum' | 'vst3',
  pitch: number,
): boolean {
  const isCustomDrumSample = (type === 'drum' || track?.instrument === 'drum') && (
    track?.drumPadModes?.[pitch] === 'sample' || !!track?.drumPadSamples?.[pitch]
  )
  const isCustomSynthSampler = (type === 'synth' || track?.instrument === 'synth') && (
    track?.synthMode === 'sampler' || !!track?.synthSampler?.audioBase64
  )
  return isCustomDrumSample || isCustomSynthSampler
}
