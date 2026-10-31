/**
 * Deterministic generative drum engine.
 *
 * Drum-only by design: every lane resolves to one of the kit's 16 pads, so this
 * generator never touches scale lock, chord stamping or pitched material. Bar windows
 * come from the same meter-aware conductor helpers as the melodic generators, which
 * keeps odd meters (7/8, 5/4, 11/16) working without hard-coded 4/4 math.
 */
import { buildBarWindows, hashSeed, mulberry32, type BarWindow } from './generativeMusic'
import type { MeterPoint } from './conductor'

export type DrumStyleId = 'auto' | 'rock' | 'boomBap' | 'house' | 'trap' | 'dnb' | 'breakbeat' | 'tabla'
type ResolvedStyleId = Exclude<DrumStyleId, 'auto'>

export type DrumRole = 'kick' | 'snare' | 'clap' | 'hat' | 'openHat' | 'ghost' | 'perc' | 'tom' | 'crash'

export interface DrumGenerateSettings {
  style: DrumStyleId
  variation: number
  bars: number
  density: number
  syncopation: number
  ghost: number
  swing: number
  humanize: number
  fills: number
  energy: number
  /** 0 = invented only, 1 = learned source groove only. */
  learnedBlend: number
  followHarmony: boolean
  snap: boolean
}

export const DEFAULT_DRUM_GENERATE_SETTINGS: DrumGenerateSettings = {
  style: 'auto',
  variation: 1337,
  bars: 4,
  density: 0.7,
  syncopation: 0.3,
  ghost: 0.25,
  swing: 0.08,
  humanize: 0.2,
  fills: 0.5,
  energy: 0.55,
  learnedBlend: 0,
  followHarmony: true,
  snap: true,
}

export const DRUM_STYLES: Array<{ id: DrumStyleId; label: string; hint: string }> = [
  { id: 'auto', label: 'Auto', hint: 'Picks a style from the active kit: Classic → Boom Bap, Acoustic → Breakbeat, Tight → House, Electric/808 → Trap, Tabla → Tabla.' },
  { id: 'rock', label: 'Rock', hint: 'Straight backbeat with downbeat kick, snare on 2 and 4, and steady eighth hats.' },
  { id: 'boomBap', label: 'Boom Bap', hint: 'Loose hip-hop backbeat with pushed kicks, swung hats and ghost snares.' },
  { id: 'house', label: 'House', hint: 'Four-on-the-floor kick, offbeat open hats and clap on 2 and 4.' },
  { id: 'trap', label: 'Trap', hint: 'Rolling 808 kick, snare on 3, dense hat rolls and long sub hits.' },
  { id: 'dnb', label: 'DnB', hint: 'Fast two-step break with ghost snares and open-hat lifters.' },
  { id: 'breakbeat', label: 'Breakbeat', hint: 'Amen-style kick/snare displacement with ghost notes and a late open hat.' },
  { id: 'tabla', label: 'Tabla', hint: 'Hand-drum feel: rim/clave backbeat, conga and cowbell colour, tom fills instead of cymbals.' },
]

export interface DrumSourceNote {
  pitch: number
  time: number
  duration: number
  velocity: number
}

export interface DrumGenerateInput {
  settings: DrumGenerateSettings
  startTick: number
  meterMap: MeterPoint[]
  timeSignature: string
  kit?: string
  /** Pads present on the target track's lanes (0-15). */
  allowedPads: number[]
  /** Existing drum hits used by the learned/invented blend. */
  learned: DrumSourceNote[]
  /** Pitched notes used for chord-change crashes and kick accents. */
  harmony: DrumSourceNote[]
  snapTicks?: number
}

export interface GeneratedDrumHit {
  time: number
  duration: number
  pitch: number
  velocity: number
  role: DrumRole
}

export interface GeneratedDrumPattern {
  hits: GeneratedDrumHit[]
  style: ResolvedStyleId
  windows: BarWindow[]
  learnedAvailable: number
  harmonyChangeBars: number[]
}

const PAD_NAMES = [
  'Kick', 'Snare', 'Closed Hat', 'Open Hat', 'Clap', 'Low Tom', 'Mid Tom', 'High Tom',
  'Crash', 'Ride', 'Cowbell', 'Tambourine', 'Low Conga', 'High Conga', 'Claves', 'Rimshot',
]

export const drumPadName = (pitch: number) => PAD_NAMES[pitch] ?? `Pad ${pitch}`

const LANE_PRIORITY: Record<DrumRole, number[]> = {
  kick: [0, 5, 7],
  snare: [1, 4, 15, 14],
  clap: [4, 11, 15],
  hat: [2, 9, 11],
  openHat: [3, 9, 2],
  ghost: [1, 4, 15],
  perc: [10, 11, 14, 15, 12, 13],
  tom: [7, 6, 5, 13, 12],
  crash: [8, 3, 9],
}

const ROLE_DURATION_STEPS: Record<DrumRole, number> = {
  kick: 2, snare: 2, clap: 1, hat: 1, openHat: 4, ghost: 1, perc: 1, tom: 2, crash: 8,
}

const ROLE_VELOCITY: Record<DrumRole, number> = {
  kick: 0.92, snare: 0.86, clap: 0.8, hat: 0.58, openHat: 0.62, ghost: 0.3, perc: 0.58, tom: 0.72, crash: 0.95,
}

interface StylePattern {
  kick: number[]
  snare: number[]
  clap: number[]
  hat: number[]
  openHat: number[]
  ghost: number[]
  perc: number[]
  percPads: number[]
  hatRolls: number
  longKick: boolean
}

const STYLE_PATTERNS: Record<ResolvedStyleId, StylePattern> = {
  rock: {
    kick: [0, 8, 10], snare: [4, 12], clap: [], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [], ghost: [7], perc: [], percPads: [], hatRolls: 0.05, longKick: false,
  },
  boomBap: {
    kick: [0, 3, 7, 10, 11], snare: [4, 12], clap: [], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [], ghost: [7, 15], perc: [], percPads: [], hatRolls: 0.1, longKick: false,
  },
  house: {
    kick: [0, 4, 8, 12], snare: [], clap: [4, 12], hat: [0, 4, 8, 12],
    openHat: [2, 6, 10, 14], ghost: [], perc: [], percPads: [], hatRolls: 0.08, longKick: false,
  },
  trap: {
    kick: [0, 6, 10, 14], snare: [8], clap: [], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    openHat: [], ghost: [11, 15], perc: [], percPads: [], hatRolls: 0.45, longKick: true,
  },
  dnb: {
    kick: [0, 10], snare: [4, 12], clap: [], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [6, 14], ghost: [7, 15], perc: [], percPads: [], hatRolls: 0.2, longKick: false,
  },
  breakbeat: {
    kick: [0, 3, 10], snare: [4, 12], clap: [], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [14], ghost: [7, 9, 15], perc: [], percPads: [], hatRolls: 0.18, longKick: false,
  },
  tabla: {
    kick: [0, 8], snare: [4, 12], clap: [], hat: [],
    openHat: [], ghost: [3, 7, 11, 15], perc: [2, 6, 10, 14], percPads: [14, 15, 10, 11, 12, 13],
    hatRolls: 0.3, longKick: false,
  },
}

export function resolveDrumStyle(style: DrumStyleId, kit?: string): ResolvedStyleId {
  if (style !== 'auto') return style
  switch (kit) {
    case 'tabla': return 'tabla'
    case 'electro':
    case 'eightOhEight': return 'trap'
    case 'tight': return 'house'
    case 'acoustic': return 'breakbeat'
    case 'classic':
    default: return 'boomBap'
  }
}

function lanePad(role: DrumRole, allowed: Set<number>): number | null {
  const priority = LANE_PRIORITY[role]
  for (const pad of priority) {
    if (allowed.has(pad)) return pad
  }
  return null
}

function sectionEnergy(barIndex: number, total: number, energy: number): number {
  if (total <= 1) return 0.55 + energy * 0.45
  const progress = barIndex / (total - 1)
  const arch = Math.sin(Math.PI * Math.min(1, Math.max(0, progress)))
  const base = 0.42 + energy * 0.5
  let factor = 0.55 + arch * 0.45
  if (barIndex === 0 && total >= 4) factor = 0.42
  if (barIndex === total - 1 && total >= 4) factor = 0.6
  return Math.max(0.22, Math.min(1, base * factor + energy * 0.12))
}

interface HarmonyPlan {
  changeBars: Set<number>
  lowOnsets: Map<number, number>
}

function analyzeHarmony(harmony: DrumSourceNote[], windows: BarWindow[]): HarmonyPlan {
  const changeBars = new Set<number>()
  const lowOnsets = new Map<number, number>()
  let previousPitchClass: number | null = null

  windows.forEach((window, index) => {
    const inBar = harmony
      .filter(n => n.time >= window.start && n.time < window.end)
      .sort((a, b) => a.time - b.time || a.pitch - b.pitch)
    if (inBar.length === 0) return
    const lowest = inBar.reduce((low, note) => (note.pitch < low.pitch ? note : low), inBar[0])
    const pitchClass = ((lowest.pitch % 12) + 12) % 12
    if (previousPitchClass !== null && pitchClass !== previousPitchClass) changeBars.add(index)
    previousPitchClass = pitchClass
    lowOnsets.set(index, lowest.time)
  })

  return { changeBars, lowOnsets }
}

function roleForPad(pitch: number): DrumRole {
  if (pitch === 0) return 'kick'
  if (pitch === 1) return 'snare'
  if (pitch === 2) return 'hat'
  if (pitch === 3) return 'openHat'
  if (pitch === 4) return 'clap'
  if (pitch === 8) return 'crash'
  if (pitch >= 5 && pitch <= 7) return 'tom'
  return 'perc'
}

export function generateDrumPattern(input: DrumGenerateInput): GeneratedDrumPattern {
  const settings: DrumGenerateSettings = {
    ...DEFAULT_DRUM_GENERATE_SETTINGS,
    ...input.settings,
    bars: Math.max(1, Math.min(64, Math.round(input.settings.bars))),
  }
  const styleId = resolveDrumStyle(settings.style, input.kit)
  const pattern = STYLE_PATTERNS[styleId]
  const windows = buildBarWindows(input.meterMap, input.timeSignature, input.startTick, settings.bars)
  const rng = mulberry32(hashSeed(`${settings.variation}:${styleId}:${input.startTick}:${windows.length}`))
  const allowed = new Set(input.allowedPads.filter(pad => Number.isFinite(pad) && pad >= 0 && pad <= 15))
  if (allowed.size === 0) {
    for (let pad = 0; pad <= 15; pad += 1) allowed.add(pad)
  }

  const kickPad = lanePad('kick', allowed)
  const snarePad = styleId === 'tabla'
    ? ([15, 14, 10, 1, 4].find(pad => allowed.has(pad)) ?? lanePad('snare', allowed))
    : lanePad('snare', allowed)
  const clapPad = lanePad('clap', allowed)
  const hatPad = lanePad('hat', allowed)
  const openHatPad = lanePad('openHat', allowed)
  const percPads = pattern.percPads.filter(pad => allowed.has(pad))
  const fallbackPercPad = lanePad('perc', allowed)
  // Hand-drum kits have no cymbal, so their phrase accents land on a tom instead.
  const crashPad = styleId === 'tabla' ? lanePad('tom', allowed) : lanePad('crash', allowed)
  const crashRole: DrumRole = styleId === 'tabla' ? 'tom' : 'crash'
  const tomPads = LANE_PRIORITY.tom.filter(pad => allowed.has(pad))

  const hits: GeneratedDrumHit[] = []
  const harmony = settings.followHarmony ? analyzeHarmony(input.harmony, windows) : { changeBars: new Set<number>(), lowOnsets: new Map<number, number>() }
  const learnedAvailable = input.learned.filter(n =>
    n.time >= windows[0].start && n.time < windows[windows.length - 1].end
  ).length

  const clampPitch = (pitch: number) => Math.max(0, Math.min(15, Math.round(pitch)))
  const pushHit = (hit: GeneratedDrumHit) => {
    const pitch = clampPitch(hit.pitch)
    if (!allowed.has(pitch)) return
    hits.push({ ...hit, pitch })
  }

  let pendingCrash = false

  windows.forEach((window, barIndex) => {
    const steps = Math.max(4, Math.round(window.beats * 4))
    const stepTicks = (window.end - window.start) / steps
    const isIntro = windows.length >= 4 && barIndex === 0
    const isOutro = windows.length >= 4 && barIndex === windows.length - 1
    const isFillBar = !isIntro && !isOutro && settings.fills > 0.02 &&
      (barIndex === windows.length - 1 || (windows.length >= 8 && (barIndex + 1) % 4 === 0))
    const energy = sectionEnergy(barIndex, windows.length, settings.energy)
    const inventedWeight = 1 - settings.learnedBlend
    const gateScale = 0.35 + settings.density * 0.65
    const crashFromFill = pendingCrash
    pendingCrash = false
    let lastOpenStep = -Infinity

    const rhythmToTime = (step: number) => {
      const swung = step + (step % 2 === 1 ? settings.swing * 0.33 : 0)
      const jitter = (rng() * 2 - 1) * settings.humanize * Math.min(10, stepTicks * 0.25)
      return Math.max(window.start, Math.min(window.end - 1, Math.round(window.start + swung * stepTicks + jitter)))
    }

    const add = (step: number, role: DrumRole, pad: number | null, options: { velocity?: number; gate?: number; accent?: boolean; long?: boolean } = {}) => {
      if (pad === null || step < 0 || step >= steps) return
      if (rng() > (options.gate ?? 1) * inventedWeight) return
      const time = rhythmToTime(step)
      const durationSteps = (options.long ? 6 : ROLE_DURATION_STEPS[role]) * stepTicks
      const remaining = Math.max(6, window.end - time)
      const accent = options.accent ?? (step % 4 === 0)
      const velocityBase = options.velocity ?? ROLE_VELOCITY[role]
      const velocity = velocityBase * (accent ? 1 : 0.82) * (0.72 + energy * 0.28)
      const jitter = (rng() * 2 - 1) * settings.humanize * 0.08
      pushHit({
        time,
        duration: Math.max(6, Math.min(remaining, Math.round(durationSteps))),
        pitch: pad,
        velocity: Math.max(0.05, Math.min(1, velocity + jitter)),
        role,
      })
    }

    const schedule = (
      positions: number[],
      role: DrumRole,
      pad: number | null,
      options: { gate?: number; velocity?: number; long?: boolean; skipSteps?: Set<number> } = {}
    ) => {
      if (pad === null) return
      for (let step = 0; step < steps; step += 1) {
        if (options.skipSteps?.has(step)) continue
        if (!positions.includes(step % 16)) continue
        const downbeat = step === 0
        const gate = downbeat ? Math.max(0.92, options.gate ?? gateScale) : (options.gate ?? gateScale) * 0.92
        add(step, role, pad, { ...options, gate, accent: downbeat || step % 4 === 0 })
      }
    }

    // Learned hits are placed first; invented layers then fill the gaps.
    if (settings.learnedBlend > 0) {
      input.learned
        .filter(n => n.time >= window.start && n.time < window.end)
        .forEach(n => {
          if (rng() > settings.learnedBlend) return
          const pitch = clampPitch(n.pitch)
          if (!allowed.has(pitch)) return
          pushHit({
            time: Math.max(window.start, Math.min(window.end - 1, Math.round(n.time))),
            duration: Math.max(6, Math.min(Math.round(window.end - n.time), Math.round(n.duration))),
            pitch,
            velocity: Math.max(0.05, Math.min(1, n.velocity || 0.8)),
            role: roleForPad(pitch),
          })
        })
    }

    if (inventedWeight > 0.001) {
      const hatGate = isIntro ? 0.55 + settings.density * 0.3 : gateScale
      const kickGate = isIntro ? 0.55 : (0.25 + settings.density * 0.75) * (0.6 + energy * 0.4)
      const snareGate = isIntro ? 0 : (0.62 + settings.density * 0.38) * (0.72 + energy * 0.28)

      schedule(pattern.kick, 'kick', kickPad, { gate: kickGate, long: pattern.longKick && styleId === 'trap' })
      if (!isIntro) schedule(pattern.snare, 'snare', snarePad, { gate: snareGate })
      if (!isIntro) schedule(pattern.clap, 'clap', clapPad, { gate: snareGate * 0.95 })
      if (!isOutro || rng() < 0.5) schedule(pattern.hat, 'hat', hatPad, { gate: hatGate })
      if (!isIntro) schedule(pattern.perc, 'perc', fallbackPercPad, { gate: 0.2 + settings.density * 0.5 })
      if (!isIntro) {
        pattern.percPads.forEach((pad, index) => {
          if (!allowed.has(pad)) return
          const gate = (0.2 + settings.density * 0.45) * (index === 0 ? 1 : 0.75)
          schedule(pattern.perc, 'perc', pad, { gate })
        })
      }

      // Open hats: one at a time, each followed by a closed hat so the choke is real.
      if (!isIntro && openHatPad !== null) {
        const openPositions = pattern.openHat
        for (let step = 0; step < steps; step += 1) {
          if (!openPositions.includes(step % 16)) continue
          if (step - lastOpenStep < 4) continue
          if (rng() > (0.35 + settings.density * 0.5) * inventedWeight) continue
          add(step, 'openHat', openHatPad, { gate: 1, accent: step % 4 === 0 })
          lastOpenStep = step
          if (hatPad !== null && step + 2 < steps) {
            add(step + 2, 'hat', hatPad, { gate: 1, velocity: 0.52 })
          }
        }
      }

      // Ghost snares between the backbeat.
      if (!isIntro && snarePad !== null && settings.ghost > 0.01) {
        pattern.ghost.forEach(position => {
          for (let step = position; step < steps; step += 16) {
            if (rng() > settings.ghost * (0.3 + settings.density * 0.7)) continue
            add(step, 'ghost', snarePad, { gate: 1, velocity: 0.26 + settings.ghost * 0.14, accent: false })
          }
        })
      }

      // Syncopation: extra kicks and snares on the off-grid.
      if (!isIntro) {
        for (let step = 1; step < steps; step += 2) {
          if (rng() < settings.syncopation * 0.18) {
            add(step, 'kick', kickPad, { gate: 1, velocity: 0.7, accent: false })
          }
          if (rng() < settings.syncopation * 0.1) {
            add(step, 'snare', snarePad, { gate: 1, velocity: 0.55, accent: false })
          }
          if (rng() < settings.syncopation * 0.08 && clapPad !== null) {
            add(step, 'clap', clapPad, { gate: 1, velocity: 0.42, accent: false })
          }
        }
      }

      // Hat rolls: a second 32nd hit on the following step. Only for styles that actually
      // run a subdivision lane, so hand-drum kits do not grow a hi-hat.
      if (!isIntro && hatPad !== null && pattern.hat.length > 0) {
        for (let step = 0; step < steps - 1; step += 1) {
          const rollChance = pattern.hatRolls * (0.35 + settings.fills * 0.65) + (isFillBar ? 0.1 : 0)
          if (rng() > rollChance) continue
          if (rng() > inventedWeight) continue
          const time = rhythmToTime(step) + Math.round(stepTicks * 0.5)
          if (time >= window.end) continue
          pushHit({
            time,
            duration: Math.max(6, Math.round(stepTicks * 0.8)),
            pitch: hatPad,
            velocity: Math.max(0.06, ROLE_VELOCITY.hat * (0.42 + energy * 0.2)),
            role: 'hat',
          })
        }
      }

      // Fills: toms and rim/clap replacing the last two beats of a phrase.
      if (isFillBar) {
        const fillStart = Math.max(0, steps - 8)
        const fillSteps = steps - fillStart
        for (let step = fillStart; step < steps; step += 1) {
          const progress = fillSteps <= 1 ? 1 : (step - fillStart) / (fillSteps - 1)
          const gate = (0.35 + settings.fills * 0.6) * (0.55 + progress * 0.45)
          if (rng() > gate) continue
          const tomPad = tomPads.length > 0
            ? tomPads[Math.min(tomPads.length - 1, Math.floor(progress * tomPads.length))]
            : null
          const useSnare = step >= steps - 2 && snarePad !== null && rng() < 0.5
          const role: DrumRole = useSnare ? 'snare' : 'tom'
          const pad = useSnare ? snarePad : (tomPad ?? snarePad)
          if (pad === null) continue
          pushHit({
            time: rhythmToTime(step),
            duration: Math.max(6, Math.round(stepTicks * 1.1)),
            pitch: pad,
            velocity: Math.max(0.12, Math.min(1, 0.4 + progress * 0.5)),
            role,
          })
        }
        if (crashPad !== null && rng() < settings.fills) {
          add(steps - 1, crashRole, crashPad, { gate: 1, velocity: 0.55, accent: false })
        }
        pendingCrash = true
      }
    }

    // Crashes: phrase starts, afterfills and chord changes from the harmony source.
    const shouldCrash = crashPad !== null && (
      (barIndex === 0 && windows.length > 1) ||
      crashFromFill ||
      (settings.followHarmony && harmony.changeBars.has(barIndex)) ||
      (barIndex > 0 && barIndex % 8 === 0)
    )
    if (shouldCrash && !isIntro) {
      add(0, crashRole, crashPad, { gate: 1, velocity: 0.9, accent: true })
    }

    // Follow harmony: move a kick onto the low-note onset when the bar has no early kick.
    if (settings.followHarmony && !isIntro && kickPad !== null) {
      const onset = harmony.lowOnsets.get(barIndex)
      const isChange = harmony.changeBars.has(barIndex) || barIndex === 0
      if (isChange && onset !== undefined) {
        const step = Math.max(0, Math.min(steps - 1, Math.round((onset - window.start) / stepTicks)))
        if (step < steps / 2 && rng() < 0.75) {
          const time = Math.round(onset)
          const occupied = hits.some(h => h.pitch === kickPad && Math.abs(h.time - time) < stepTicks * 0.5)
          if (!occupied) {
            pushHit({
              time,
              duration: Math.max(6, Math.round(stepTicks * 2)),
              pitch: kickPad,
              velocity: 0.68,
              role: 'kick',
            })
          }
        }
      }
    }

    if (isOutro && crashPad !== null) {
      add(0, crashRole, crashPad, { gate: 1, velocity: 0.8, accent: true })
    }
  })

  // Choke/dedupe pass: no stacked open hats, no crash collision, one hit per pad per instant.
  const rowOpenPad = lanePad('openHat', allowed)
  const sorted = [...hits].sort((a, b) => a.time - b.time || b.velocity - a.velocity)
  const cleaned: GeneratedDrumHit[] = []
  for (const hit of sorted) {
    if (!allowed.has(hit.pitch)) continue
    if (rowOpenPad !== null && hit.pitch === rowOpenPad) {
      const previousOpen = [...cleaned].reverse().find(h => h.pitch === rowOpenPad)
      if (previousOpen && hit.time - previousOpen.time < 4 * 48) continue
    }
    const collision = cleaned.find(h => h.pitch === hit.pitch && Math.abs(h.time - hit.time) < 6)
    if (collision) {
      if (hit.velocity > collision.velocity) Object.assign(collision, hit)
      continue
    }
    cleaned.push({ ...hit, duration: Math.max(6, Math.round(hit.duration)) })
  }

  const grid = Math.max(1, Math.round(input.snapTicks ?? 0))
  const finalHits = settings.snap && input.snapTicks && input.snapTicks > 0
    ? cleaned.map(hit => ({
        ...hit,
        time: Math.max(0, Math.round(hit.time / grid) * grid),
        duration: Math.max(grid, Math.round(hit.duration / grid) * grid),
      }))
    : cleaned

  // Snap can reintroduce same-instant duplicates on a pad; keep the loudest.
  const deduped: GeneratedDrumHit[] = []
  finalHits.sort((a, b) => a.time - b.time || b.velocity - a.velocity).forEach(hit => {
    const collision = deduped.find(h => h.pitch === hit.pitch && h.time === hit.time)
    if (collision) {
      if (hit.velocity > collision.velocity) Object.assign(collision, hit)
      return
    }
    deduped.push(hit)
  })

  return {
    hits: deduped,
    style: styleId,
    windows,
    learnedAvailable,
    harmonyChangeBars: Array.from(harmony.changeBars),
  }
}
