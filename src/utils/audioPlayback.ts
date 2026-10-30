type SampleTrack = {
  instrument?: string
  synthMode?: string
  synthSampler?: { audioBase64?: string }
  drumPadModes?: Record<number, string>
  drumPadSamples?: Record<number, unknown>
}

export function getSamplerPlaybackPlan(
  noteDurationSeconds: number,
  regionDurationSeconds: number,
  loopWhileHeld: boolean,
): { shouldLoop: boolean; sourceDuration: number | undefined } {
  const shouldLoop = loopWhileHeld || noteDurationSeconds > regionDurationSeconds + 0.05
  return {
    shouldLoop,
    sourceDuration: shouldLoop ? undefined : regionDurationSeconds,
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
