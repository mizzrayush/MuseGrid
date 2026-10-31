import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useStore } from '../engine/store'
import {
  getBarStartTick,
  getMeterPositionAtTick,
  getTempoAtTick,
  resolveKeyAtTick,
  MAX_CONDUCTOR_BPM,
  MAX_METER_BEATS,
  MAX_METER_DENOMINATOR,
  type TempoCurve,
  type TempoPoint,
} from '../utils/conductor'
import { NOTE_NAMES_FLAT, NOTE_NAMES_SHARP, SCALE_MODES } from '../utils/musicTheory'

const HEADER_HEIGHT = 24
const TOOLBAR_HEIGHT = 30
const TEMPO_HEIGHT = 68
const METER_HEIGHT = 24
const KEY_HEIGHT = 22
const TEMPO_TOP = 8
const TEMPO_BOTTOM = TEMPO_HEIGHT
const METER_TOP = TEMPO_HEIGHT + 6
const KEY_TOP = METER_TOP + METER_HEIGHT + 2
const BODY_HEIGHT = KEY_TOP + KEY_HEIGHT + 4

const ACCENT = '#4dabf7'
const METER_ACCENT = '#ffa94d'
const KEY_ACCENT = '#69db7c'
const POINT_SIZE = 7

interface ConductorLaneProps {
  getView: (width: number) => { panX: number; zoom: number }
  tickToX: (tick: number) => number
  xToTick: (x: number) => number
  sidebarWidth: number
}

type Selection = { kind: 'tempo' | 'meter' | 'key'; id: string } | null

const makeId = () => `cond_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

const tempoRange = (map: TempoPoint[], baseBpm: number) => {
  const values = [baseBpm, ...map.map(point => point.bpm)]
  const lo = Math.max(20, Math.min(...values) - 15)
  const rawHi = Math.min(MAX_CONDUCTOR_BPM, Math.max(...values) + 15)
  return { lo, hi: Math.max(lo + 30, rawHi) }
}

const keyLabel = (root: number, mode: string, accidental: 'sharp' | 'flat') =>
  `${(accidental === 'flat' ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[root]} ${mode}`

const CURVE_OPTIONS: Array<{ value: TempoCurve; label: string }> = [
  { value: 'step', label: 'Step' },
  { value: 'linear', label: 'Linear' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'formula', label: 'Formula f(x)' },
]

const buttonStyle = (active = false): CSSProperties => ({
  height: '20px',
  padding: '0 7px',
  borderRadius: '3px',
  border: `1px solid ${active ? 'rgba(77,171,247,0.45)' : 'rgba(255,255,255,0.09)'}`,
  background: active ? 'rgba(77,171,247,0.16)' : 'rgba(255,255,255,0.03)',
  color: active ? ACCENT : '#a4a9b6',
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
})

const inputStyle: CSSProperties = {
  height: '20px',
  width: '48px',
  padding: '0 4px',
  borderRadius: '3px',
  border: '1px solid rgba(255,255,255,0.09)',
  background: '#14161c',
  color: '#d6d9e0',
  fontSize: '10px',
  fontFamily: "'JetBrains Mono', monospace",
  outline: 'none',
}

export default function ConductorLane({ getView, tickToX, xToTick, sidebarWidth }: ConductorLaneProps) {
  const showConductor = useStore(state => state.showConductor)
  const setShowConductor = useStore(state => state.setShowConductor)
  const tempoMap = useStore(state => state.tempoMap)
  const meterMap = useStore(state => state.meterMap)
  const keyMap = useStore(state => state.keyMap)
  const scaleLock = useStore(state => state.scaleLock)
  const timeSignature = useStore(state => state.timeSignature)
  const baseBpm = useStore(state => state.bpm)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ kind: 'tempo'; id: string } | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  // Clearing the whole map is a double-click confirmation instead of an OS dialog.
  const [confirmClear, setConfirmClear] = useState(false)
  useEffect(() => {
    if (!confirmClear) return
    const timer = setTimeout(() => setConfirmClear(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  const selectedTempo = selection?.kind === 'tempo'
    ? tempoMap.find(point => point.id === selection.id)
    : undefined
  const selectedMeter = selection?.kind === 'meter'
    ? meterMap.find(point => point.id === selection.id)
    : undefined
  const selectedKey = selection?.kind === 'key'
    ? keyMap.find(point => point.id === selection.id)
    : undefined

  // Draw loop: it reads live store state so edits, playback, and panning stay in sync.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !showConductor) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let frame = 0

    const draw = () => {
      frame = requestAnimationFrame(draw)
      const state = useStore.getState()
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      const { panX, zoom } = getView(width)
      const toScreenX = (tick: number) => panX + sidebarWidth + tickToX(tick) * zoom
      const toTickX = (x: number) => Math.max(0, xToTick((x - sidebarWidth - panX) / zoom))

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#14161c'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, sidebarWidth, height)
      ctx.fillStyle = 'rgba(255,255,255,0.02)'
      ctx.fillRect(sidebarWidth, METER_TOP, width - sidebarWidth, METER_HEIGHT)
      ctx.fillStyle = 'rgba(105,219,124,0.035)'
      ctx.fillRect(sidebarWidth, KEY_TOP, width - sidebarWidth, KEY_HEIGHT)

      // Bar lines follow the meter map so the conductor and the grid agree.
      const startTick = Math.max(0, toTickX(sidebarWidth))
      const endTick = toTickX(width)
      let barTick = Math.max(0, getMeterPositionAtTick(state.meterMap, state.timeSignature, startTick).barStartTick)
      let guard = 0
      while (barTick <= endTick && guard < 4000) {
        guard += 1
        const x = toScreenX(barTick)
        if (x >= sidebarWidth) {
          ctx.strokeStyle = 'rgba(255,255,255,0.10)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, TEMPO_BOTTOM)
          ctx.stroke()
        }
        const position = getMeterPositionAtTick(state.meterMap, state.timeSignature, barTick + 0.5)
        const nextMeterPoint = state.meterMap.find(point => point.tick > barTick)
        const nextBar = position.barStartTick + position.barTicks
        barTick = nextMeterPoint && nextMeterPoint.tick < nextBar ? nextMeterPoint.tick : nextBar
        if (barTick <= position.barStartTick) break
      }

      // Tempo grid + labels.
      const range = tempoRange(state.tempoMap, state.bpm)
      const bpmToY = (bpm: number) => TEMPO_TOP +
        (1 - (bpm - range.lo) / (range.hi - range.lo)) * (TEMPO_BOTTOM - TEMPO_TOP)
      const labelStep = (range.hi - range.lo) > 120 ? 40 : (range.hi - range.lo) > 60 ? 20 : 10
      ctx.font = '9px "JetBrains Mono", monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const firstLabel = Math.ceil(range.lo / labelStep) * labelStep
      for (let bpm = firstLabel; bpm <= range.hi; bpm += labelStep) {
        const y = bpmToY(bpm)
        if (y < TEMPO_TOP - 1 || y > TEMPO_BOTTOM + 1) continue
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.beginPath()
        ctx.moveTo(sidebarWidth, y)
        ctx.lineTo(width, y)
        ctx.stroke()
        ctx.fillStyle = '#6d7382'
        ctx.fillText(String(bpm), sidebarWidth - 6, y)
      }

      // Base tempo reference.
      const baseY = bpmToY(state.bpm)
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(sidebarWidth, baseY)
      ctx.lineTo(width, baseY)
      ctx.stroke()
      ctx.setLineDash([])

      // Tempo curve.
      const hasTempoMap = state.tempoMap.length > 0
      ctx.beginPath()
      let started = false
      for (let x = sidebarWidth; x <= width; x += 2) {
        const tick = toTickX(x)
        const bpm = getTempoAtTick(state.tempoMap, state.bpm, tick, state.meterMap, state.timeSignature)
        const y = bpmToY(bpm)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.6
      ctx.stroke()

      if (!hasTempoMap) {
        ctx.fillStyle = '#6d7382'
        ctx.font = '10px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Click the lane to add a tempo point · drag a point to shape the curve', sidebarWidth + (width - sidebarWidth) / 2, TEMPO_HEIGHT / 2 + 8)
      }

      // Tempo points.
      let lastLabelX = -100
      state.tempoMap.forEach(point => {
        const x = toScreenX(point.tick)
        if (x < sidebarWidth - 8 || x > width + 8) return
        const y = bpmToY(point.bpm)
        const selected = selection?.kind === 'tempo' && selection.id === point.id
        ctx.fillStyle = selected ? '#ffffff' : ACCENT
        ctx.fillRect(x - POINT_SIZE / 2, y - POINT_SIZE / 2, POINT_SIZE, POINT_SIZE)
        if (selected) {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1
          ctx.strokeRect(x - POINT_SIZE / 2 - 2, y - POINT_SIZE / 2 - 2, POINT_SIZE + 4, POINT_SIZE + 4)
        }
        if (Math.abs(x - lastLabelX) > 36) {
          lastLabelX = x
          ctx.fillStyle = '#d6d9e0'
          ctx.font = '9px "JetBrains Mono", monospace'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'bottom'
          ctx.fillText(`${point.bpm.toFixed(1).replace(/\.0$/, '')}`, x + 5, y - 4)
        }
      })

      // Meter change markers.
      state.meterMap.forEach(point => {
        const x = toScreenX(point.tick)
        if (x < sidebarWidth - 8 || x > width + 8) return
        const selected = selection?.kind === 'meter' && selection.id === point.id
        ctx.strokeStyle = METER_ACCENT
        ctx.lineWidth = selected ? 1.6 : 1
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, METER_TOP + METER_HEIGHT)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = selected ? '#ffffff' : METER_ACCENT
        ctx.font = 'bold 9px "JetBrains Mono", monospace'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${point.numerator}/${point.denominator}`, x + 4, METER_TOP + METER_HEIGHT / 2)
      })

      if (state.meterMap.length === 0) {
        ctx.fillStyle = '#6d7382'
        ctx.font = '9px Inter, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${state.timeSignature} · click the strip to add a meter change`, sidebarWidth + 6, METER_TOP + METER_HEIGHT / 2)
      }

      // Key signature markers. Analysis and snap read the latest marker at a tick.
      state.keyMap.forEach(point => {
        const x = toScreenX(point.tick)
        if (x < sidebarWidth - 8 || x > width + 8) return
        const selected = selection?.kind === 'key' && selection.id === point.id
        ctx.strokeStyle = KEY_ACCENT
        ctx.lineWidth = selected ? 1.6 : 1
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, KEY_TOP + KEY_HEIGHT)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = selected ? '#ffffff' : KEY_ACCENT
        ctx.font = 'bold 9px "JetBrains Mono", monospace'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(keyLabel(point.root, point.mode, point.accidental), x + 4, KEY_TOP + KEY_HEIGHT / 2)
      })

      if (state.keyMap.length === 0) {
        ctx.fillStyle = '#6d7382'
        ctx.font = '9px Inter, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(
          `${keyLabel(state.scaleLock.root, state.scaleLock.mode, state.scaleLock.accidental)} · click the strip to add a key change`,
          sidebarWidth + 6,
          KEY_TOP + KEY_HEIGHT / 2
        )
      }

      // Sidebar captions.
      ctx.fillStyle = '#8a8a95'
      ctx.font = 'bold 9px Inter, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('TEMPO', 8, 8)
      ctx.fillText('METER', 8, METER_TOP + 6)
      ctx.fillText('KEY', 8, KEY_TOP + 6)

      // Playhead.
      const playheadX = toScreenX(state.playheadPosition)
      if (playheadX >= sidebarWidth && playheadX <= width) {
        ctx.strokeStyle = '#ff2d55'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(playheadX, 0)
        ctx.lineTo(playheadX, TEMPO_BOTTOM)
        ctx.stroke()
      }
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [showConductor, getView, sidebarWidth, tickToX, xToTick, selection])

  const addTempoAtPlayhead = () => {
    const state = useStore.getState()
    const tick = Math.max(0, Math.round(state.playheadPosition))
    const id = makeId()
    state.addTempoPoint({
      id,
      tick,
      bpm: Math.round(getTempoAtTick(state.tempoMap, state.bpm, tick, state.meterMap, state.timeSignature) * 100) / 100,
      curve: 'linear',
    })
    setSelection({ kind: 'tempo', id })
  }

  const addMeterAtPlayhead = () => {
    const state = useStore.getState()
    const tick = getBarStartTick(state.meterMap, state.timeSignature, state.playheadPosition)
    const position = getMeterPositionAtTick(state.meterMap, state.timeSignature, tick)
    const id = makeId()
    state.addMeterPoint({
      id,
      tick,
      numerator: position.meter.numerator,
      denominator: position.meter.denominator,
    })
    setSelection({ kind: 'meter', id })
  }

  const addKeyAtPlayhead = () => {
    const state = useStore.getState()
    const tick = getBarStartTick(state.meterMap, state.timeSignature, state.playheadPosition)
    const current = resolveKeyAtTick(state.keyMap, state.scaleLock, tick)
    const id = makeId()
    state.addKeyPoint({
      id,
      tick,
      root: current.root,
      mode: current.mode,
      accidental: current.accidental,
      customIntervals: current.customIntervals,
    })
    setSelection({ kind: 'key', id })
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const state = useStore.getState()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < sidebarWidth) return
    const width = rect.width
    const { panX, zoom } = getView(width)
    const toScreenX = (tick: number) => panX + sidebarWidth + tickToX(tick) * zoom
    const toTick = (screenX: number) => Math.max(0, xToTick((screenX - sidebarWidth - panX) / zoom))

    if (y >= KEY_TOP) {
      const hit = state.keyMap.find(point => Math.abs(toScreenX(point.tick) - x) <= 6)
      if (hit) {
        setSelection({ kind: 'key', id: hit.id })
        return
      }
      const tick = getBarStartTick(state.meterMap, state.timeSignature, toTick(x))
      const current = resolveKeyAtTick(state.keyMap, state.scaleLock, tick)
      const id = makeId()
      state.addKeyPoint({
        id,
        tick,
        root: current.root,
        mode: current.mode,
        accidental: current.accidental,
        customIntervals: current.customIntervals,
      })
      setSelection({ kind: 'key', id })
      return
    }

    if (y >= METER_TOP) {
      const hit = state.meterMap.find(point => Math.abs(toScreenX(point.tick) - x) <= 6)
      if (hit) {
        setSelection({ kind: 'meter', id: hit.id })
        return
      }
      const tick = getBarStartTick(state.meterMap, state.timeSignature, toTick(x))
      const position = getMeterPositionAtTick(state.meterMap, state.timeSignature, tick)
      const id = makeId()
      state.addMeterPoint({
        id,
        tick,
        numerator: position.meter.numerator,
        denominator: position.meter.denominator,
      })
      setSelection({ kind: 'meter', id })
      return
    }

    if (y > TEMPO_BOTTOM) return
    const range = tempoRange(state.tempoMap, state.bpm)
    const bpmToY = (bpm: number) => TEMPO_TOP +
      (1 - (bpm - range.lo) / (range.hi - range.lo)) * (TEMPO_BOTTOM - TEMPO_TOP)
    const yToBpm = (screenY: number) => Math.round((
      range.lo + (1 - (screenY - TEMPO_TOP) / (TEMPO_BOTTOM - TEMPO_TOP)) * (range.hi - range.lo)
    ) * 10) / 10

    const hit = state.tempoMap.find(point =>
      Math.abs(toScreenX(point.tick) - x) <= 6 && Math.abs(bpmToY(point.bpm) - y) <= 7
    )
    if (hit) {
      setSelection({ kind: 'tempo', id: hit.id })
      dragRef.current = { kind: 'tempo', id: hit.id }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }

    const rawTick = toTick(x)
    const tick = state.snapEnabled
      ? Math.max(0, Math.round(rawTick / Math.max(1, state.snapResolution)) * Math.max(1, state.snapResolution))
      : Math.round(rawTick)
    const id = makeId()
    state.addTempoPoint({ id, tick, bpm: yToBpm(y), curve: 'linear' })
    setSelection({ kind: 'tempo', id })
    dragRef.current = { kind: 'tempo', id }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const state = useStore.getState()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = Math.min(TEMPO_BOTTOM, Math.max(TEMPO_TOP, e.clientY - rect.top))
    const { panX, zoom } = getView(rect.width)
    const rawTick = Math.max(0, xToTick((x - sidebarWidth - panX) / zoom))
    const tick = state.snapEnabled
      ? Math.max(0, Math.round(rawTick / Math.max(1, state.snapResolution)) * Math.max(1, state.snapResolution))
      : Math.round(rawTick)
    const range = tempoRange(state.tempoMap, state.bpm)
    const bpm = Math.round((
      range.lo + (1 - (y - TEMPO_TOP) / (TEMPO_BOTTOM - TEMPO_TOP)) * (range.hi - range.lo)
    ) * 10) / 10
    state.updateTempoPoint(drag.id, { tick, bpm })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const tempoSummary = tempoMap.length > 0
    ? `${tempoMap[0].bpm}${tempoMap.length > 1 ? ` → ${tempoMap[tempoMap.length - 1].bpm}` : ''} BPM`
    : `${baseBpm} BPM`
  const meterSummary = meterMap.length > 0
    ? meterMap.map(point => `${point.numerator}/${point.denominator}`).join(' · ')
    : timeSignature
  const keySummary = keyMap.length > 0
    ? keyMap.map(point => keyLabel(point.root, point.mode, point.accidental)).join(' · ')
    : keyLabel(scaleLock.root, scaleLock.mode, scaleLock.accidental)

  return (
    <div style={{
      flexShrink: 0,
      background: '#1a1a1a',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div
        style={{
          height: `${HEADER_HEIGHT}px`,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 10px',
          background: '#222',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setShowConductor(!showConductor)}
        title={showConductor ? 'Collapse conductor lane' : 'Show tempo, meter, and key lanes'}
      >
        <span style={{
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#a4a9b6',
        }}>
          Conductor
        </span>
        <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: ACCENT }}>
          {tempoSummary}
        </span>
        <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: METER_ACCENT }}>
          {meterSummary}
        </span>
        <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: KEY_ACCENT }}>
          {keySummary}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#6d7382' }}>
          {showConductor ? '▾' : '▸'}
        </span>
      </div>

      {showConductor && (
        <>
          <div style={{
            height: `${TOOLBAR_HEIGHT}px`,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '0 8px',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            overflowX: 'auto',
            overflowY: 'hidden',
          }}>
            <button style={buttonStyle()} onClick={addTempoAtPlayhead} title="Add a tempo point at the playhead">
              + Tempo
            </button>
            <button style={buttonStyle()} onClick={addMeterAtPlayhead} title="Add a meter change at the playhead's bar">
              + Meter
            </button>
            <button style={buttonStyle()} onClick={addKeyAtPlayhead} title="Add a key change at the playhead's bar">
              + Key
            </button>

            {selectedTempo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: '6px' }}>
                <input
                  type="number"
                  min={20}
                  max={MAX_CONDUCTOR_BPM}
                  step={0.01}
                  value={selectedTempo.bpm}
                  onChange={e => useStore.getState().updateTempoPoint(selectedTempo.id, { bpm: Number(e.target.value) })}
                  style={inputStyle}
                  title="Tempo at this point (BPM)"
                />
                <select
                  value={selectedTempo.curve}
                  onChange={e => useStore.getState().updateTempoPoint(selectedTempo.id, { curve: e.target.value as TempoCurve })}
                  style={{ ...inputStyle, width: '92px' }}
                  title="How tempo travels to the next point"
                >
                  {CURVE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {selectedTempo.curve === 'formula' && (
                  <input
                    type="text"
                    value={selectedTempo.formula ?? ''}
                    placeholder="v + 20*sin(t*3.14)"
                    onChange={e => useStore.getState().updateTempoPoint(selectedTempo.id, { formula: e.target.value })}
                    style={{ ...inputStyle, width: '170px' }}
                    title="t = segment progress 0–1 · b = beats · m = bars · ticks = absolute tick · v = linear interpolation"
                  />
                )}
                <button
                  style={buttonStyle()}
                  onClick={() => {
                    useStore.getState().removeTempoPoint(selectedTempo.id)
                    setSelection(null)
                  }}
                  title="Delete this tempo point"
                >
                  Delete
                </button>
              </div>
            )}

            {selectedMeter && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: '6px' }}>
                <input
                  type="number"
                  min={1}
                  max={MAX_METER_BEATS}
                  step={1}
                  value={selectedMeter.numerator}
                  onChange={e => useStore.getState().updateMeterPoint(selectedMeter.id, { numerator: Number(e.target.value) })}
                  style={inputStyle}
                  title="Beats per bar (1–64)"
                />
                <span style={{ color: '#6d7382', fontSize: '10px' }}>/</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_METER_DENOMINATOR}
                  step={1}
                  value={selectedMeter.denominator}
                  onChange={e => useStore.getState().updateMeterPoint(selectedMeter.id, { denominator: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '52px' }}
                  title="Beat unit (1–64); any whole number works, e.g. 7/11"
                />
                <button
                  style={buttonStyle()}
                  onClick={() => {
                    useStore.getState().removeMeterPoint(selectedMeter.id)
                    setSelection(null)
                  }}
                  title="Delete this meter change"
                >
                  Delete
                </button>
              </div>
            )}

            {selectedKey && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: '6px' }}>
                <select
                  value={selectedKey.root}
                  onChange={e => useStore.getState().updateKeyPoint(selectedKey.id, { root: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '56px' }}
                  title="Key root"
                >
                  {(selectedKey.accidental === 'flat' ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP).map((name, index) => (
                    <option key={index} value={index}>{name}</option>
                  ))}
                </select>
                <select
                  value={selectedKey.mode}
                  onChange={e => useStore.getState().updateKeyPoint(selectedKey.id, { mode: e.target.value })}
                  style={{ ...inputStyle, width: '118px' }}
                  title="Scale mode for this segment"
                >
                  {SCALE_MODES.map(mode => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
                <button
                  style={buttonStyle(selectedKey.accidental === 'sharp')}
                  onClick={() => useStore.getState().updateKeyPoint(selectedKey.id, { accidental: 'sharp' })}
                  title="Spell note names with sharps"
                >
                  ♯
                </button>
                <button
                  style={buttonStyle(selectedKey.accidental === 'flat')}
                  onClick={() => useStore.getState().updateKeyPoint(selectedKey.id, { accidental: 'flat' })}
                  title="Spell note names with flats"
                >
                  ♭
                </button>
                <button
                  style={buttonStyle()}
                  onClick={() => {
                    useStore.getState().removeKeyPoint(selectedKey.id)
                    setSelection(null)
                  }}
                  title="Delete this key change"
                >
                  Delete
                </button>
              </div>
            )}

            <span style={{ flex: 1 }} />
            <button
              style={confirmClear ? { ...buttonStyle(true), color: '#ff6b8b', borderColor: 'rgba(255,51,102,0.45)', background: 'rgba(255,51,102,0.16)' } : buttonStyle()}
              onClick={() => {
                if (tempoMap.length === 0 && meterMap.length === 0 && keyMap.length === 0) return
                if (!confirmClear) {
                  setConfirmClear(true)
                  return
                }
                useStore.getState().resetConductor()
                setSelection(null)
                setConfirmClear(false)
              }}
              title={confirmClear
                ? 'Click again to clear all conductor points. The project BPM and time signature stay as they are.'
                : 'Remove all conductor points'}
            >
              {confirmClear ? 'Confirm Clear' : 'Clear'}
            </button>
          </div>

          <canvas
            ref={canvasRef}
            height={BODY_HEIGHT}
            style={{ width: '100%', height: `${BODY_HEIGHT}px`, display: 'block', cursor: 'crosshair' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onContextMenu={e => e.preventDefault()}
            title="Click to add, drag a tempo point to shape the curve. Key and meter points snap to bar starts."
          />
        </>
      )}
    </div>
  )
}
