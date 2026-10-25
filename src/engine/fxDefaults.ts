export type BuiltInFxType =
  | 'eq'
  | 'distortion'
  | 'chorus'
  | 'phaser'
  | 'delay'
  | 'dpreverb'
  | 'reverb'
  | 'freeverb'

export interface FxLike {
  id: string
  type: string
  pluginId?: string
  pluginName?: string
}

export type TrackFxHost = any

export interface DPreverbSettings {
  wet: number
  tail: number
  decay: number
  tone: number
}

export const DEFAULT_FX_INSTANCES: ReadonlyArray<Readonly<FxLike>> = [
  { id: 'eq-default', type: 'eq' },
  { id: 'distortion-default', type: 'distortion' },
  { id: 'chorus-default', type: 'chorus' },
  { id: 'phaser-default', type: 'phaser' },
  { id: 'delay-default', type: 'delay' },
  { id: 'dpreverb-default', type: 'dpreverb' },
  { id: 'reverb-default', type: 'reverb' },
  { id: 'freeverb-default', type: 'freeverb' }
]

export const BUILT_IN_FX_TYPES = DEFAULT_FX_INSTANCES.map(inst => inst.type)

export const BUILT_IN_FX_LABELS: Record<BuiltInFxType, string> = {
  eq: 'EQ',
  distortion: 'Distortion',
  chorus: 'Chorus',
  phaser: 'Phaser',
  delay: 'Delay',
  dpreverb: 'DPreverb',
  reverb: 'Reverb',
  freeverb: 'Freeverb'
}

export function createDefaultFxInstances(): FxLike[] {
  return DEFAULT_FX_INSTANCES.map(inst => ({ ...inst }))
}

export function getTrackFxInstances(instances?: FxLike[] | null, fxOrder?: string[]): FxLike[] {
  if (Array.isArray(instances) && instances.length > 0) {
    const result = instances.map(inst => ({ ...inst }))
    const defaultTypes = DEFAULT_FX_INSTANCES.map(inst => inst.type)

    DEFAULT_FX_INSTANCES.forEach(def => {
      if (result.some(inst => inst.type === def.type)) return

      const laterDefaultTypes = defaultTypes.slice(defaultTypes.indexOf(def.type) + 1)
      const insertAt = result.findIndex(inst => laterDefaultTypes.includes(inst.type))
      const newInst = { id: def.id, type: def.type }

      if (insertAt === -1) result.push(newInst)
      else result.splice(insertAt, 0, newInst)
    })

    return result
  }

  if (Array.isArray(fxOrder) && fxOrder.length > 0) {
    return fxOrder.map(type => ({ id: `${type}-default`, type }))
  }

  return createDefaultFxInstances()
}

export function isBuiltInFxType(type: string): type is BuiltInFxType {
  return BUILT_IN_FX_TYPES.includes(type)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function getTrackFxSetting(
  track: TrackFxHost,
  instId: string,
  instType: string,
  paramName: string,
  fallback: number
): number {
  const settings = track.fxSettings?.[instId] ?? {}
  if (typeof settings[paramName] === 'number' && isFinite(settings[paramName])) return settings[paramName]

  let flatKey = (instType + paramName.charAt(0).toUpperCase() + paramName.slice(1))
  if (instType === 'eq' && paramName === 'lowGain') flatKey = 'eqLowGain'
  if (instType === 'eq' && paramName === 'midGain') flatKey = 'eqMidGain'
  if (instType === 'eq' && paramName === 'highGain') flatKey = 'eqHighGain'
  if (instType === 'phaser' && paramName === 'baseFreq') flatKey = 'phaserBaseFreq'

  const flatValue = track[flatKey]
  if (typeof flatValue === 'number' && isFinite(flatValue)) return flatValue

  return typeof fallback === 'number' && isFinite(fallback) ? fallback : 0
}

export function getDPreverbSettings(track: TrackFxHost, inst: FxLike): DPreverbSettings {
  return {
    wet: clamp(getTrackFxSetting(track, inst.id, inst.type, 'wet', 0), 0, 1),
    tail: clamp(getTrackFxSetting(track, inst.id, inst.type, 'tail', 2), 0, 120),
    decay: clamp(getTrackFxSetting(track, inst.id, inst.type, 'decay', 0.65), 0.05, 1),
    tone: clamp(getTrackFxSetting(track, inst.id, inst.type, 'tone', 0.55), 0, 1)
  }
}

export function getActiveDPreverbInstances(track: TrackFxHost & { fxInstances?: FxLike[] }): Array<{ inst: FxLike; settings: DPreverbSettings }> {
  return getTrackFxInstances(track.fxInstances)
    .filter(inst => inst.type === 'dpreverb')
    .map(inst => ({ inst, settings: getDPreverbSettings(track, inst) }))
    .filter(({ settings }) => settings.wet > 0 && settings.tail > 0)
}

export function getMaxDPreverbTailSeconds(tracks: Array<TrackFxHost & { fxInstances?: FxLike[] }>): number {
  return tracks.reduce((maxTail, track) => {
    const trackMax = getActiveDPreverbInstances(track)
      .reduce((innerMax, { settings }) => Math.max(innerMax, settings.tail), 0)
    return Math.max(maxTail, trackMax)
  }, 0)
}
