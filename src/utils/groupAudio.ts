import type { Track, TrackGroup } from '../engine/store'

export interface GroupAudioState {
  volume: number
  muted: boolean
  soloed: boolean
}

/** Group controls are non-destructive: they multiply/OR on top of the track's own state. */
export function getGroupAudioForTrack(trackId: string, groups: TrackGroup[] | undefined): GroupAudioState {
  const state: GroupAudioState = { volume: 1, muted: false, soloed: false }
  if (!groups) return state
  for (const group of groups) {
    if (!group.trackIds.includes(trackId)) continue
    state.volume *= typeof group.volume === 'number' && isFinite(group.volume) ? group.volume : 1
    state.muted = state.muted || Boolean(group.muted)
    state.soloed = state.soloed || Boolean(group.soloed)
  }
  state.volume = Math.max(0, Math.min(2, state.volume))
  return state
}

export function getEffectiveTrackLevel(track: Track, groups: TrackGroup[] | undefined) {
  const group = getGroupAudioForTrack(track.id, groups)
  return {
    volume: Math.max(0, Math.min(2, (track.volume ?? 0.8) * group.volume)),
    muted: Boolean(track.muted) || group.muted,
    soloed: Boolean(track.soloed) || group.soloed
  }
}
