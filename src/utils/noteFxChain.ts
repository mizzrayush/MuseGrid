import type { Note } from '../engine/store'

/** Parameters the Note Inspector shows for a freshly added effect, matching the track card. */
export const NOTE_FX_DEFAULTS: Record<string, Record<string, number>> = {
  eq: { lowGain: 0, midGain: 0, highGain: 0 },
  distortion: { wet: 0, amount: 0.4 },
  chorus: { wet: 0, frequency: 1.5, depth: 0.7, delayTime: 3.5 },
  phaser: { wet: 0, frequency: 0.5, baseFreq: 350, octaves: 3 },
  delay: { wet: 0, time: 0.25, feedback: 0.25 },
  dpreverb: { wet: 0, tail: 2, decay: 0.65, tone: 0.55 },
  reverb: { wet: 0, decay: 2.5, preDelay: 0.01 },
  freeverb: { wet: 0, roomSize: 0.7, dampening: 4000 }
}

export function getNoteFxSetting(note: Note, instId: string, instType: string, key: string): number {
  const stored = note.fxSettings?.[instId]?.[key]
  if (typeof stored === 'number' && isFinite(stored)) return stored
  return NOTE_FX_DEFAULTS[instType]?.[key] ?? 0
}

export function noteFxChainId(trackId: string, noteId: string): number {
  // FNV-1a over the note identity, kept in the positive int range and never 0.
  let h = 0x811c9dc5
  const key = `${trackId}::${noteId}`
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % 2147483646) + 1
}

export interface NoteFxEffectSpec {
  type: string
  pluginId?: string
  bypassed?: number
  wet?: number
  params?: Record<string, number>
}

export interface NoteFxChainSpec {
  chainId: number
  signature: string
  effects: NoteFxEffectSpec[]
}

/**
 * Native chain description for a note. Empty when the note uses the track rack.
 * Custom JS effects are browser-only and are left out; VST3 and built-ins are kept.
 */
export function buildNoteFxChain(note: Note): NoteFxChainSpec | undefined {
  const instances = note.fxInstances ?? []
  if (instances.length === 0) return undefined

  const effects: NoteFxEffectSpec[] = []
  for (const inst of instances) {
    const stored = note.fxSettings?.[inst.id] ?? {}
    if (inst.type === 'vst3') {
      if (!inst.pluginId) continue
      effects.push({
        type: 'vst3',
        pluginId: inst.pluginId,
        bypassed: stored.bypassed ?? 0,
        wet: stored.wet ?? 0.4
      })
    } else if (NOTE_FX_DEFAULTS[inst.type]) {
      const params = { ...NOTE_FX_DEFAULTS[inst.type], ...stored }
      effects.push({
        type: inst.type,
        bypassed: params.bypassed ?? 0,
        params
      })
    }
  }

  if (effects.length === 0) return undefined
  const signature = JSON.stringify(effects)
  return {
    chainId: noteFxChainId(note.trackId, note.id),
    signature,
    effects
  }
}
