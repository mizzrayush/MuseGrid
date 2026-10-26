import { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import * as Tone from 'tone'
import {
  IconPin, IconPlus, IconTrash, IconChevronLeft, IconMusic, IconDrum, IconSettings,
  IconVolume, IconVolumeX, IconCopy, IconPaste, IconScissors, IconZap,
  IconLayers, IconArrowUp, IconArrowDown, IconSparkles, IconShuffle, IconList, IconAlign
} from '../ui/Icons'
import { useContextMenuDismissal } from '../ui/useContextMenuDismissal'
import { useStore, DEFAULT_DRUM_ROWS, EXPRESSION_LANE_TARGETS, expressionLaneLabel, parseAutomationTarget, getTrackAutomationPoints, type ExpressionLaneTarget } from '../engine/store'
import { audioEngine } from '../engine/AudioEngine'
import type { Vst3ParameterInfo } from '../engine/AudioEngine'
import { isInScale, snapToScale, snapTick, NOTE_NAMES_SHARP, NOTE_NAMES_FLAT, CHORD_STAMPS, getDiatonicChord, detectScaleDegree } from '../utils/musicTheory'
import { getLaneValueAtTick, laneNeutralValue, laneTargetLabel, sortAutomationPoints } from '../utils/automation'
import { DEFAULT_DRUM_KIT, DEFAULT_SYNTH_PRESET } from '../utils/instruments'
import {
  applyLegato,
  applyGlue,
  applyTranspose,
  applyStrum,
  applyChop,
  applyHumanize,
  applyFlipHorizontal,
  applyFlipVertical,
  applyVelocityRamp,
  applyMicroNudge,
  applyGlideChain,
  clearNoteGlides,
  type GlideChainOptions
} from '../utils/midiEditing'
import { getEdoStepInfo } from '../utils/edoNomenclature'

const TRACK_COLORS = ['#4dabf7', '#ff9900', '#69db7c', '#da77f2', '#ff6b6b', '#00e6ff', '#ffd43b']
const newId = () => Math.random().toString(36).substr(2, 9)

function getComplementaryColor(hex: string, isSelected: boolean): string {
  if (isSelected) {
    return '#151820'
  }
  let cleanHex = hex.replace('#', '')
  if (cleanHex.length === 3) {
    cleanHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2]
  }
  const r = parseInt(cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.substring(4, 6), 16)

  let compR = 255 - r
  let compG = 255 - g
  let compB = 255 - b

  const origLum = 0.299 * r + 0.587 * g + 0.114 * b
  const compLum = 0.299 * compR + 0.587 * compG + 0.114 * compB

  if (Math.abs(origLum - compLum) < 40) {
    if (origLum > 128) {
      compR = Math.max(0, compR - 100)
      compG = Math.max(0, compG - 100)
      compB = Math.max(0, compB - 100)
    } else {
      compR = Math.min(255, compR + 100)
      compG = Math.min(255, compG + 100)
      compB = Math.min(255, compB + 100)
    }
  }

  const toHex = (c: number) => {
    const h = Math.round(c).toString(16)
    return h.length === 1 ? '0' + h : h
  }
  return `#${toHex(compR)}${toHex(compG)}${toHex(compB)}`
}

const TIMELINE_HEIGHT = 30
const STICKY_TIMELINE_HEIGHT = 24
const AUTOMATION_HEIGHT = 100
const SIDEBAR_WIDTH = 110
const PLAYHEAD_ANCHOR_X = 128

type DragMode = 'none' | 'pan' | 'move_note' | 'resize_note_right' | 'resize_note_top' | 'resize_note_bottom' | 'resize_column' | 'box_select' | 'draw_automation' | 'scrub_playhead' | 'stretch_left' | 'stretch_right' | 'adjust_loop_start' | 'adjust_loop_end' | 'edit_note_velocity' | 'draw_export_region' | 'draw_timeline_range'

interface GridCanvasProps {
  instrument: 'synth' | 'drum'
}

function getPlayheadAnchorX(canvasWidth: number) {
  return Math.min(PLAYHEAD_ANCHOR_X, Math.max(72, canvasWidth * 0.35))
}

export default function GridCanvas({ instrument }: GridCanvasProps) {
  const zoomSynth = useStore(s => s.zoomSynth)
  const setZoomSynth = useStore(s => s.setZoomSynth)
  const zoomDrum = useStore(s => s.zoomDrum)
  const setZoomDrum = useStore(s => s.setZoomDrum)

  const zoom = instrument === 'drum' ? zoomDrum : zoomSynth
  const setZoom = (val: number | ((prev: number) => number)) => {
    const newVal = typeof val === 'function' ? val(zoom) : val
    if (instrument === 'drum') setZoomDrum(newVal)
    else setZoomSynth(newVal)
  }

  // Active track needed early for pan calculation
  const tracks = useStore(state => state.tracks)
  const trackMap = useMemo(() => new Map(tracks.map(t => [t.id, t])), [tracks])
  const activeTrackId = useStore(state => state.activeTrackId)
  const selectedTrack = tracks.find(t => t.id === activeTrackId)
  const globalBpm = useStore(s => s.bpm)
  const activeTrackTargetTempo = selectedTrack?.targetTempo ?? globalBpm
  const isInitialDrum = instrument === 'drum'
  const initialPanCenteredRef = useRef(false)

  const [pan, setPan] = useState({ x: 0, y: isInitialDrum ? 0 : -1150 })
  const projectRevision = useStore(state => state.projectRevision)
  const [prevRevision, setPrevRevision] = useState(projectRevision)

  if (projectRevision !== prevRevision) {
    setPrevRevision(projectRevision)
    initialPanCenteredRef.current = false
    setPan({ x: 0, y: isInitialDrum ? 0 : -1150 })
  }
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })
  const containerRef = useRef<HTMLDivElement>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timelineCanvasRef = useRef<HTMLCanvasElement>(null)
  const automationCanvasRef = useRef<HTMLCanvasElement>(null)

  const playheadFollowMode = useStore(state => state.playheadFollowMode)



  const canvasAlignRequest = useStore(state => state.canvasAlignRequest)
  const allNotes = useStore(state => state.notes)
  const columnWidths = useStore(state => state.columnWidths)
  const gridBlockTicks = useStore(state => state.gridBlockTicks)
  const gridColumnCount = useStore(state => state.gridColumnCount)
  const setGridColumnCount = useStore(state => state.setGridColumnCount)
  const autoExtendGrid = useStore(state => state.autoExtendGrid)
  const getMaxTicks = useStore(state => state.getMaxTicks)
  const selectedNoteIds = useStore(state => state.selectedNoteIds)
  const gridResizable = useStore(state => state.gridResizable)

  const utilityPicker = useStore(state => state.utilityPicker)
  const [pickerHoverPos, setPickerHoverPos] = useState<{ x: number, y: number } | null>(null)

  const addNote = useStore(state => state.addNote)
  const updateNote = useStore(state => state.updateNote)
  const removeNote = useStore(state => state.removeNote)
  const setColumnWidth = useStore(state => state.setColumnWidth)
  const setSelectedNoteIds = useStore(state => state.setSelectedNoteIds)
  const addAutomationPoint = useStore(state => state.addAutomationPoint)
  const updateAutomationPoint = useStore(state => state.updateAutomationPoint)
  const removeAutomationPoint = useStore(state => state.removeAutomationPoint)
  const automationTargets = useStore(state => state.automationTargets)
  const setAutomationTarget = useStore(state => state.setAutomationTarget)
  const automationLanes = useStore(state => state.automationLanes)
  const updateAutomationLane = useStore(state => state.updateAutomationLane)
  const addTrack = useStore(state => state.addTrack)
  const updateTrack = useStore(state => state.updateTrack)

  const instrumentTracks = useMemo(() => tracks.filter(t => t.instrument === instrument), [tracks, instrument])
  const instrumentTrackIds = useMemo(() => new Set(instrumentTracks.map(t => t.id)), [instrumentTracks])
  const bothGridActive = useStore(state => state.bothGridActive)
  const lastActiveSynthTrackId = useStore(s => s.lastActiveSynthTrackId)
  const lastActiveDrumTrackId = useStore(s => s.lastActiveDrumTrackId)
  const targetId = bothGridActive ? (instrument === 'synth' ? lastActiveSynthTrackId : lastActiveDrumTrackId) : activeTrackId
  const editTrack = instrumentTracks.find(t => t.id === targetId) ?? instrumentTracks.find(t => t.id === activeTrackId) ?? instrumentTracks[0]
  const targetTrackId = editTrack?.id ?? ''
  const currentTrack = editTrack ?? selectedTrack

  const horizScrollLockEnabled = useStore(state => state.horizScrollLockEnabled)
  const vertScrollLockEnabled = useStore(state => state.vertScrollLockEnabled)
  const readOnlyMode = useStore(state => state.readOnlyMode)
  const scrollBoth = useStore(state => state.scrollBoth)
  const sharedPanX = useStore(state => state.sharedPanX)
  const setSharedPanX = useStore(state => state.setSharedPanX)
  const ghostNotesEnabled = useStore(state => state.ghostNotesEnabled)
  const ghostNoteOpacity = useStore(state => state.ghostNoteOpacity)
  const ghostCrossInstrument = useStore(state => state.ghostCrossInstrument)

  const isActiveGrid = targetTrackId === activeTrackId
  const isHorizScrollLocked = horizScrollLockEnabled && isActiveGrid
  const isVertScrollLocked = vertScrollLockEnabled && isActiveGrid

  const isReadOnly = bothGridActive ? readOnlyMode : ((currentTrack ? currentTrack.instrument !== instrument : false) || readOnlyMode)
  const isDrum = instrument === 'drum'

  const synthLowerOctave = useStore(state => state.synthLowerOctave)
  const synthUpperOctave = useStore(state => state.synthUpperOctave)
  const noteInspectorEnabled = useStore(state => state.noteInspectorEnabled)
  const isRightPaneVisible = useStore(state => state.isRightPaneVisible)

  const globalScaleLock = useStore(state => state.scaleLock)
  const trackScaleLock = currentTrack?.scaleOverride ?? globalScaleLock
  const scaleLock = trackScaleLock
  const scaleFoldEnabled = useStore(state => state.scaleFoldEnabled)
  const activeChordStamp = useStore(state => state.activeChordStamp)

  const drumRows = currentTrack?.drumRows ?? DEFAULT_DRUM_ROWS
  const customRowOrder = (!isDrum && currentTrack?.customRowOrder) ? currentTrack.customRowOrder : null
  const isMicroEdo = !isDrum && !!currentTrack?.edoDivision && currentTrack.edoDivision !== 12
  const edo = currentTrack?.edoDivision || 12
  const stepSize = isMicroEdo ? (12 / edo) : 1

  const gridSizeY = isDrum ? 60 : (isMicroEdo ? Math.max(10, Math.min(32, Math.round(520 / edo))) : 40)
  const highestPitch = isDrum ? Math.max(...drumRows.map(r => r.pitch), 15) : ((synthUpperOctave + 2) * 12 - stepSize)
  const lowestPitch = isDrum ? Math.min(...drumRows.map(r => r.pitch), 0) : ((synthLowerOctave + 1) * 12)

  const scaleFoldRowOrder = useMemo(() => {
    if (!scaleFoldEnabled || isDrum || isMicroEdo) return null
    const rows: string[] = []
    const trackNotes = allNotes.filter(n => n.trackId === targetTrackId)
    const existingPitches = new Set(trackNotes.map(n => Math.round(n.pitch)))
    for (let p = highestPitch; p >= lowestPitch; p--) {
      if (isInScale(p, scaleLock.root, scaleLock.mode, scaleLock.customIntervals) || existingPitches.has(p)) {
        rows.push(String(p))
      }
    }
    return rows
  }, [scaleFoldEnabled, isDrum, isMicroEdo, highestPitch, lowestPitch, scaleLock, allNotes, targetTrackId])

  const effectiveRowOrder = customRowOrder || scaleFoldRowOrder
  const totalOctaves = synthUpperOctave - synthLowerOctave + 1
  const numRows = isDrum ? drumRows.length : (effectiveRowOrder ? effectiveRowOrder.length : totalOctaves * (isMicroEdo ? edo : 12))

  const totalHeight = (TIMELINE_HEIGHT + numRows * gridSizeY) * zoom + 40
  const maxPanY = -Math.max(0, totalHeight - canvasSize.height)

  const getPitchY = useCallback((p: number) => {
    if (effectiveRowOrder) {
      const idx = effectiveRowOrder.indexOf(String(Math.round(p)))
      if (idx !== -1) {
        const frac = p - Math.round(p)
        return idx * gridSizeY - frac * gridSizeY
      }
      return -1000 // hide
    }
    return ((highestPitch - p) / stepSize) * gridSizeY
  }, [effectiveRowOrder, highestPitch, stepSize, gridSizeY])

  const getYPitch = useCallback((y: number) => {
    if (effectiveRowOrder) {
      const idx = Math.floor(y / gridSizeY)
      if (idx >= 0 && idx < effectiveRowOrder.length) {
        return Number(effectiveRowOrder[idx])
      }
      return 60
    }
    const raw = highestPitch - (y / gridSizeY) * stepSize
    return Math.round(raw * 100000) / 100000
  }, [effectiveRowOrder, highestPitch, stepSize, gridSizeY])

  const getPitchFromIndex = useCallback((i: number) => {
    if (effectiveRowOrder) return Number(effectiveRowOrder[i] || 60)
    const raw = highestPitch - i * stepSize
    return Math.round(raw * 100000) / 100000
  }, [effectiveRowOrder, highestPitch, stepSize])

  const getCenterPanYForPitch = useCallback((targetPitch: number = 60) => {
    if (isDrum) return 0
    let pitchY = getPitchY(targetPitch)
    if (pitchY < 0 && effectiveRowOrder && effectiveRowOrder.length > 0) {
      pitchY = Math.floor(effectiveRowOrder.length / 2) * gridSizeY
    }
    const vHeight = canvasSize.height
    if (vHeight <= 0) return -1150
    const worldY = (TIMELINE_HEIGHT + pitchY + gridSizeY / 2) * zoom
    const targetY = -(worldY - vHeight / 2)
    return Math.min(0, Math.max(maxPanY, targetY))
  }, [isDrum, getPitchY, effectiveRowOrder, canvasSize.height, gridSizeY, zoom, maxPanY])

  const prevTrackConfigRef = useRef<{ trackId: string; edoDivision?: number; edoPreset?: string }>({
    trackId: currentTrack?.id || '',
    edoDivision: currentTrack?.edoDivision,
    edoPreset: currentTrack?.edoPreset
  })

  // Center on Middle C on initial mount or when tuning style / track changes
  useEffect(() => {
    if (isDrum || !currentTrack) return
    const prev = prevTrackConfigRef.current
    const changedEdo = prev.edoDivision !== currentTrack.edoDivision || prev.edoPreset !== currentTrack.edoPreset
    const changedTrack = prev.trackId !== currentTrack.id

    if (!initialPanCenteredRef.current && canvasSize.height > 0) {
      initialPanCenteredRef.current = true
      setPan(p => ({ ...p, y: getCenterPanYForPitch(60) }))
      return
    }

    if (changedEdo || changedTrack) {
      prevTrackConfigRef.current = {
        trackId: currentTrack.id,
        edoDivision: currentTrack.edoDivision,
        edoPreset: currentTrack.edoPreset
      }
      if (canvasSize.height > 0) {
        setPan(p => ({ ...p, y: getCenterPanYForPitch(60) }))
      }
    }
  }, [currentTrack?.id, currentTrack?.edoDivision, currentTrack?.edoPreset, isDrum, canvasSize.height, getCenterPanYForPitch])

  // Prevent pan.y from being stranded out-of-bounds when totalHeight shrinks
  useEffect(() => {
    if (canvasSize.height <= 0) return
    setPan(p => {
      if (p.y < maxPanY) {
        return { ...p, y: maxPanY }
      }
      return p
    })
  }, [maxPanY, canvasSize.height])
  const notes = useMemo(() => {
    if (!ghostNotesEnabled) {
      return allNotes.filter(n => n.trackId === targetTrackId)
    }
    return allNotes.filter(n => instrumentTrackIds.has(n.trackId))
  }, [allNotes, instrumentTrackIds, targetTrackId, ghostNotesEnabled])

  const crossInstrumentNotes = useMemo(() => {
    if (!ghostCrossInstrument || !ghostNotesEnabled) return []
    return allNotes.filter(n => !instrumentTrackIds.has(n.trackId))
  }, [allNotes, instrumentTrackIds, ghostCrossInstrument, ghostNotesEnabled])
  const selectableTrackIds = useMemo(() => {
    const ids = new Set<string>()
    if (targetTrackId) ids.add(targetTrackId)
    tracks.forEach(t => {
      if (t.allowMultiTrackSelect) {
        ids.add(t.id)
      }
    })
    return ids
  }, [tracks, targetTrackId])
  const editableNotes = useMemo(() => notes.filter(n => selectableTrackIds.has(n.trackId)), [notes, selectableTrackIds])

  const [dragMode, setDragMode] = useState<DragMode>('none')
  const [dragTargetId, setDragTargetId] = useState<string | null>(null)
  const [dragTargetCol, setDragTargetCol] = useState<number | null>(null)
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 })
  const [dragStartValue, setDragStartValue] = useState(0)
  const [dragStartValueY, setDragStartValueY] = useState(0)
  const [dragStartSelectedNotes, setDragStartSelectedNotes] = useState<Array<{ id: string, time: number, pitch: number, pitchEnd?: number }>>([])

  const [boxSelectStart, setBoxSelectStart] = useState({ x: 0, y: 0 })
  const [boxSelectCurrent, setBoxSelectCurrent] = useState({ x: 0, y: 0 })
  const showSynthVelocity = useStore(state => state.showSynthVelocity)
  const showDrumVelocity = useStore(state => state.showDrumVelocity)
  const setShowSynthVelocity = useStore(state => state.setShowSynthVelocity)
  const setShowDrumVelocity = useStore(state => state.setShowDrumVelocity)

  const showAutomation = instrument === 'drum' ? showDrumVelocity : showSynthVelocity
  const automationTarget = automationTargets[targetTrackId] ?? 'velocity'
  const automationLane = automationLanes[targetTrackId]
  const laneIsFormula = automationLane?.source === 'formula'
  const laneTargetKind = parseAutomationTarget(automationTarget)?.kind ?? 'builtin'
  // Each engine only follows the parameters it actually reads. A pad now wobbles and sweeps in all
  // four paths, so a drum lane gets those two plus pitch; tremolo stays synth-only by design.
  const exprTargets: ExpressionLaneTarget[] = instrument === 'drum'
    ? ['filterCutoff', 'vibratoDepth', 'vibratoRate', 'detune', 'glideAmount']
    : currentTrack?.instrument === 'vst3'
      ? ['detune', 'glideAmount']
      : EXPRESSION_LANE_TARGETS
  const exprTargetId = laneTargetKind === 'expr' ? automationTarget.slice(5) : ''
  const setShowAutomation = (val: boolean | ((prev: boolean) => boolean)) => {
    const newVal = typeof val === 'function' ? val(showAutomation) : val
    if (instrument === 'drum') setShowDrumVelocity(newVal)
    else setShowSynthVelocity(newVal)
  }
  const [dragAutomationPointId, setDragAutomationPointId] = useState<string | null>(null)
  const [vst3Params, setVst3Params] = useState<Vst3ParameterInfo[]>([])
  const vst3ParamTrackKey = currentTrack?.vst3InstrumentId ? `${currentTrack.id}:${currentTrack.vst3InstrumentId}` : ''
  const vst3TargetIndex = automationTarget.startsWith('vst3:') ? Number(automationTarget.slice(5)) : -1
  const vst3TargetParam = vst3TargetIndex >= 0 ? vst3Params.find(p => p.index === vst3TargetIndex) : undefined
  const [dragVelocityNoteId, setDragVelocityNoteId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tick: number; mode: 'main' | 'subtrack_parent' | 'glide' | 'timeline_range' } | null>(null)
  const [glideMenu, setGlideMenu] = useState<GlideChainOptions>({
    order: 'time',
    curve: 'cubicInOut',
    durationMode: 'full',
    extendLegato: true,
    loopLastNote: false,
    glideVoice: 'source'
  })
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  useContextMenuDismissal(contextMenu !== null, setContextMenu, contextMenuRef)

  // Custom Scrollbars Drag States
  const [dragScrollY, setDragScrollY] = useState<{ startY: number, startPanY: number } | null>(null)
  const [dragScrollX, setDragScrollX] = useState<{ startX: number, startPanX: number } | null>(null)
  const [hoverScrollY, setHoverScrollY] = useState(false)
  const [hoverScrollX, setHoverScrollX] = useState(false)

  // Stretch tool: remember original note times/durations and anchor
  const stretchStateRef = useRef<{ anchor: number; edge: number; notes: Array<{ id: string; time: number; duration: number }> } | null>(null)
  const wasAlreadySelectedRef = useRef(false)
  const previousPlayheadFollowModeRef = useRef(playheadFollowMode)

  const exportRegionMode = useStore(state => state.exportRegionMode)
  const exportRegions = useStore(state => state.exportRegions)
  const addExportRegion = useStore(state => state.addExportRegion)
  const removeExportRegion = useStore(state => state.removeExportRegion)
  const setExportRegions = useStore(state => state.setExportRegions)

  const timelineSelection = useStore(state => state.timelineSelection)
  const setTimelineSelection = useStore(state => state.setTimelineSelection)
  const duplicateTimelineRange = useStore(state => state.duplicateTimelineRange)
  const muteTimelineRange = useStore(state => state.muteTimelineRange)
  const deleteTimelineRange = useStore(state => state.deleteTimelineRange)
  const splitTimelineRange = useStore(state => state.splitTimelineRange)
  const quantizeTimelineRange = useStore(state => state.quantizeTimelineRange)
  const [timelineRangeStart, setTimelineRangeStart] = useState<number | null>(null)
  const timelineDragStateRef = useRef<{ startX: number; startClientX: number; startTick: number; isRight: boolean } | null>(null)
  const gridTimelineDragRef = useRef<{ startX: number; startClientX: number; startTick: number } | null>(null)

  const [activeDragRegion, setActiveDragRegion] = useState<{ startTick: number, endTick: number } | null>(null)
  const snapEnabled = useStore(state => state.snapEnabled)
  const snapResolution = useStore(state => state.snapResolution)
  const loopEnabled = useStore(state => state.loopEnabled)
  const loopStart = useStore(state => state.loopStart)
  const loopEnd = useStore(state => state.loopEnd)

  const pointerRef = useRef({ rawX: 0, rawY: 0 })
  const dragScrollIntervalRef = useRef<number | null>(null)

  const visualStateRef = useRef<{
    activeDragRegion: { startTick: number; endTick: number; opacity: number } | null;
    regions: Array<{ id: string; startTick: number; endTick: number; opacity: number }>;
  }>({
    activeDragRegion: null,
    regions: []
  })

  // Use a ref to store rapidly changing local state so we don't tear down the render loop
  const stateRef = useRef({
    pan, zoom, dragMode, boxSelectStart, boxSelectCurrent, canvasSize, showAutomation, scaleLock,
    snapEnabled, snapResolution, loopEnabled, loopStart, loopEnd, activeDragRegion, exportRegionMode, exportRegions,
    timelineSelection, scrollBoth, sharedPanX, isHorizScrollLocked, isVertScrollLocked
  })
  useEffect(() => {
    stateRef.current = {
      pan, zoom, dragMode, boxSelectStart, boxSelectCurrent, canvasSize, showAutomation, scaleLock,
      snapEnabled, snapResolution, loopEnabled, loopStart, loopEnd, activeDragRegion, exportRegionMode, exportRegions,
      timelineSelection, scrollBoth, sharedPanX, isHorizScrollLocked, isVertScrollLocked
    }
  }, [
    pan, zoom, dragMode, boxSelectStart, boxSelectCurrent, canvasSize, showAutomation, scaleLock,
    snapEnabled, snapResolution, loopEnabled, loopStart, loopEnd, activeDragRegion, exportRegionMode, exportRegions,
    timelineSelection, scrollBoth, sharedPanX, isHorizScrollLocked, isVertScrollLocked
  ])

  const cachedColsRef = useRef<{ cols: any[]; key: string }>({ cols: [], key: '' })
  const getColumns = useCallback((maxCols = gridColumnCount) => {
    if (maxCols === gridColumnCount) {
      const colWidthCount = columnWidths ? Object.keys(columnWidths).length : 0
      const key = `${gridColumnCount}_${gridBlockTicks}_${colWidthCount}`
      if (cachedColsRef.current.key === key && cachedColsRef.current.cols.length === gridColumnCount) {
        return cachedColsRef.current.cols
      }
      const cols = []
      let currentX = 0
      for (let i = 0; i < gridColumnCount; i++) {
        const w = columnWidths[i] ?? gridBlockTicks
        cols.push({
          index: i,
          x: currentX,
          width: w,
          tick: i * gridBlockTicks,
          durationTicks: gridBlockTicks
        })
        currentX += w
      }
      cachedColsRef.current = { cols, key }
      return cols
    }
    const cols = []
    let currentX = 0
    for (let i = 0; i < maxCols; i++) {
      const w = columnWidths[i] ?? gridBlockTicks
      cols.push({
        index: i,
        x: currentX,
        width: w,
        tick: i * gridBlockTicks,
        durationTicks: gridBlockTicks
      })
      currentX += w
    }
    return cols
  }, [columnWidths, gridBlockTicks, gridColumnCount])

  useEffect(() => {
    const isGridScrollableDrag = [
      'box_select',
      'move_note',
      'resize_note_right',
      'resize_note_top',
      'resize_note_bottom',
      'stretch_left',
      'stretch_right'
    ].includes(dragMode)

    if (!isGridScrollableDrag) {
      if (dragScrollIntervalRef.current !== null) {
        clearInterval(dragScrollIntervalRef.current)
        dragScrollIntervalRef.current = null
      }
      return
    }

    if (dragScrollIntervalRef.current === null) {
      dragScrollIntervalRef.current = window.setInterval(() => {
        const px = pointerRef.current.rawX
        const py = pointerRef.current.rawY
        if (px === 0 && py === 0) return

        const edge = 40
        let dx = 0
        let dy = 0

        if (px < SIDEBAR_WIDTH + edge) {
          const dist = (SIDEBAR_WIDTH + edge) - px
          dx = Math.min(25, Math.max(2, Math.round(dist * 0.4)))
        } else if (px > canvasSize.width - edge) {
          const dist = px - (canvasSize.width - edge)
          dx = -Math.min(25, Math.max(2, Math.round(dist * 0.4)))
        }

        if (py < TIMELINE_HEIGHT + edge) {
          const dist = (TIMELINE_HEIGHT + edge) - py
          dy = Math.min(25, Math.max(2, Math.round(dist * 0.4)))
        } else if (py > canvasSize.height - edge) {
          const dist = py - (canvasSize.height - edge)
          dy = -Math.min(25, Math.max(2, Math.round(dist * 0.4)))
        }

        if (dx !== 0 || dy !== 0) {
          const { zoom, isHorizScrollLocked, isVertScrollLocked, scrollBoth } = stateRef.current
          const totalTicks = getColumns().reduce((sum, col) => sum + col.width, 0)
          const totalWidth = totalTicks * zoom
          const viewportWidth = Math.max(1, canvasSize.width - SIDEBAR_WIDTH)
          const maxPanX = -Math.max(0, totalWidth - viewportWidth)

          const totalHeight = (TIMELINE_HEIGHT + numRows * gridSizeY) * zoom + 40
          const maxPanY = -Math.max(0, totalHeight - canvasSize.height)

          setPan(p => {
            let nextX = p.x + dx
            if (isHorizScrollLocked) nextX = p.x
            else {
              nextX = Math.min(0, Math.max(maxPanX, nextX))
              if (scrollBoth) setSharedPanX(nextX)
            }

            let nextY = p.y + dy
            if (isVertScrollLocked) nextY = p.y
            else {
              nextY = Math.min(0, Math.max(maxPanY, nextY))
            }
            return { x: nextX, y: nextY }
          })

          if (containerRef.current) {
            const event = new PointerEvent('pointermove', {
              clientX: px + containerRef.current.getBoundingClientRect().left,
              clientY: py + containerRef.current.getBoundingClientRect().top,
              bubbles: true
            })
            containerRef.current.dispatchEvent(event)
          }
        }
      }, 16)
    }

    return () => {
      if (dragScrollIntervalRef.current !== null) {
        clearInterval(dragScrollIntervalRef.current)
        dragScrollIntervalRef.current = null
      }
    }
  }, [dragMode, canvasSize.width, canvasSize.height, getColumns, gridSizeY, numRows, setSharedPanX])

  const getEffectivePanX = useCallback((width = canvasSize.width) => {
    const state = useStore.getState()
    if (state.playheadFollowMode === 'grid' && !isHorizScrollLocked) {
      return getPlayheadAnchorX(width) - state.playheadPosition * zoom
    }
    return pan.x
  }, [canvasSize.width, isHorizScrollLocked, pan.x, zoom])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setCanvasSize(prev => {
          const newW = entries[0].contentRect.width
          const newH = entries[0].contentRect.height
          if (Math.abs(prev.width - newW) > 1 || Math.abs(prev.height - newH) > 1) {
            return { width: newW, height: newH }
          }
          return prev
        })
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // A track with a VST3 instrument exposes its plugin parameters as lane targets.
  useEffect(() => {
    const trackId = currentTrack?.id
    if (!vst3ParamTrackKey || !trackId || !currentTrack?.vst3InstrumentId) {
      setVst3Params([])
      return
    }
    let cancelled = false
    audioEngine.getTrackVst3Parameters(trackId).then(list => {
      if (!cancelled) setVst3Params(list)
    })
    return () => { cancelled = true }
  }, [vst3ParamTrackKey, showAutomation, currentTrack?.id, currentTrack?.vst3InstrumentId])

  // Synchronize local pan.x with sharedPanX if scrollBoth is enabled
  useEffect(() => {
    if (scrollBoth && pan.x !== sharedPanX) {
      const frame = requestAnimationFrame(() => {
        setPan(prev => prev.x === sharedPanX ? prev : { ...prev, x: sharedPanX })
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [scrollBoth, sharedPanX, pan.x])

  useEffect(() => {
    if (isHorizScrollLocked) return
    const previousMode = previousPlayheadFollowModeRef.current
    if (previousMode === 'grid' && playheadFollowMode === 'playhead') {
      const frame = requestAnimationFrame(() => {
        const { canvasSize, zoom } = stateRef.current
        const playhead = useStore.getState().playheadPosition
        const nextX = getPlayheadAnchorX(canvasSize.width) - playhead * zoom
        if (scrollBoth) {
          setSharedPanX(nextX)
        }
        setPan(current => ({
          ...current,
          x: nextX,
        }))
      })
      previousPlayheadFollowModeRef.current = playheadFollowMode
      return () => cancelAnimationFrame(frame)
    }

    previousPlayheadFollowModeRef.current = playheadFollowMode
  }, [playheadFollowMode, isHorizScrollLocked, scrollBoth, setSharedPanX])

  useEffect(() => {
    if (canvasAlignRequest === 0 || isHorizScrollLocked) return
    const frame = requestAnimationFrame(() => {
      const state = useStore.getState()
      if (state.playheadFollowMode === 'grid') return
      const { canvasSize, zoom } = stateRef.current
      const nextX = getPlayheadAnchorX(canvasSize.width) - state.playheadPosition * zoom
      if (scrollBoth) {
        setSharedPanX(nextX)
      }
      setPan(current => ({
        ...current,
        x: nextX,
      }))
    })
    return () => cancelAnimationFrame(frame)
  }, [canvasAlignRequest, isHorizScrollLocked, scrollBoth, setSharedPanX])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'SELECT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.tagName === 'BUTTON' ||
        activeEl?.hasAttribute('contenteditable')
      ) {
        return
      }

      const store = useStore.getState()

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); return }

      // Timeline Selection Shortcuts
      if (store.timelineSelection) {
        const { startTick, endTick } = store.timelineSelection
        const minT = Math.min(startTick, endTick)
        const maxT = Math.max(startTick, endTick)

        if (e.key === 'Escape') {
          e.preventDefault()
          store.setTimelineSelection(null)
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
          e.preventDefault()
          store.duplicateTimelineRange(startTick, endTick, targetTrackId)
          return
        }
        if (!e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === 'm' || (e.altKey && e.key.toLowerCase() === 'm'))) {
          e.preventDefault()
          store.muteTimelineRange(startTick, endTick, targetTrackId)
          return
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          store.deleteTimelineRange(startTick, endTick, targetTrackId)
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
          e.preventDefault()
          store.splitTimelineRange(startTick, endTick, targetTrackId)
          return
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'q') {
          e.preventDefault()
          store.quantizeTimelineRange(startTick, endTick, targetTrackId)
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
          e.preventDefault()
          store.setLoopStart(minT)
          store.setLoopEnd(maxT)
          store.setLoopEnabled(true)
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          e.preventDefault()
          const notesToCopy = allNotes.filter(n => n.time >= minT && n.time < maxT && (!targetTrackId || n.trackId === targetTrackId))
          if (notesToCopy.length > 0) {
            store.setClipboard(notesToCopy)
            store.showToast(`Copied ${notesToCopy.length} note${notesToCopy.length === 1 ? '' : 's'} in region`, 'info')
          }
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
          e.preventDefault()
          const notesToCopy = allNotes.filter(n => n.time >= minT && n.time < maxT && (!targetTrackId || n.trackId === targetTrackId))
          if (notesToCopy.length > 0) {
            store.setClipboard(notesToCopy)
            store.deleteTimelineRange(startTick, endTick, targetTrackId)
            store.showToast(`Cut ${notesToCopy.length} note${notesToCopy.length === 1 ? '' : 's'} in region`, 'info')
          }
          return
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        const notesToCopy = allNotes.filter(n => selectedNoteIds.includes(n.id))
        if (notesToCopy.length > 0) {
          store.setClipboard(notesToCopy)
          store.showToast(`Copied ${notesToCopy.length} note${notesToCopy.length === 1 ? '' : 's'}`, 'info')
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault()
        const notesToCopy = allNotes.filter(n => selectedNoteIds.includes(n.id))
        if (isReadOnly || notesToCopy.length === 0) return
        store.commitHistory()
        store.setClipboard(notesToCopy)
        selectedNoteIds.forEach(id => removeNote(id))
        setSelectedNoteIds([])
        store.showToast(`Cut ${notesToCopy.length} note${notesToCopy.length === 1 ? '' : 's'}`, 'info')
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        const selectedNotes = allNotes.filter(n => selectedNoteIds.includes(n.id))
        if (isReadOnly || !targetTrackId || selectedNotes.length === 0) return
        store.commitHistory()
        const minTime = Math.min(...selectedNotes.map(n => n.time))
        const maxEndTime = Math.max(...selectedNotes.map(n => n.time + n.duration))
        const span = maxEndTime - minTime
        const offset = Math.max(snapResolution || 48, span)
        const newSelectedIds: string[] = []
        selectedNotes.forEach(note => {
          const id = Math.random().toString(36).substr(2, 9)
          newSelectedIds.push(id)
          addNote({ ...note, id, trackId: targetTrackId, time: note.time + offset })
        })
        setSelectedNoteIds(newSelectedIds)
        store.showToast(`Duplicated ${selectedNotes.length} note${selectedNotes.length === 1 ? '' : 's'}`, 'info')
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        const clipboard = store.clipboard
        if (isReadOnly || !targetTrackId || clipboard.length === 0) return
        const minTime = Math.min(...clipboard.map(n => n.time))
        const offset = store.playheadPosition - minTime
        const newSelectedIds: string[] = []
        clipboard.forEach(note => {
          const id = Math.random().toString(36).substr(2, 9)
          newSelectedIds.push(id)
          addNote({ ...note, id, trackId: targetTrackId, time: Math.max(0, note.time + offset) })
        })
        setSelectedNoteIds(newSelectedIds)
        store.commitHistory()
        store.showToast(`Pasted ${clipboard.length} note${clipboard.length === 1 ? '' : 's'}`, 'info')
        return
      }

      if (!e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === 'm' || (e.altKey && e.key.toLowerCase() === 'm'))) {
        e.preventDefault()
        const selectedNotes = allNotes.filter(n => selectedNoteIds.includes(n.id))
        if (isReadOnly || selectedNotes.length === 0) return
        store.commitHistory()
        const allMuted = selectedNotes.every(n => n.muted)
        store.updateNotes(selectedNoteIds, { muted: !allMuted })
        store.showToast(allMuted ? `Unmuted ${selectedNotes.length} note(s)` : `Muted ${selectedNotes.length} note(s)`, 'info')
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isReadOnly || selectedNoteIds.length === 0) return
        store.commitHistory()
        selectedNoteIds.forEach(id => removeNote(id))
        setSelectedNoteIds([])
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        store.commitHistory()
        store.quantizeSelectedNotes()
        return
      }

      // Helper for MIDI roll transforms
      const getActiveTargets = () => {
        const s = useStore.getState()
        if (selectedNoteIds.length > 0) {
          return s.notes.filter(n => selectedNoteIds.includes(n.id))
        }
        if (targetTrackId) {
          return s.notes.filter(n => n.trackId === targetTrackId)
        }
        return []
      }

      const applyMidiTransform = (transform: (targets: any[]) => any[], toastMsg: string) => {
        if (isReadOnly) return
        const targets = getActiveTargets()
        if (targets.length === 0) return
        store.commitHistory()
        const targetIdSet = new Set(targets.map(n => n.id))
        const remaining = store.notes.filter(n => !targetIdSet.has(n.id))
        const updated = transform(targets)
        useStore.setState({ notes: [...remaining, ...updated] })
        if (selectedNoteIds.length > 0) {
          setSelectedNoteIds(updated.map((n: any) => n.id))
        }
        store.showToast(toastMsg, 'success')
      }

      // Piano Roll Shortcuts:
      // Quick Legato (Ctrl+L)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        applyMidiTransform(applyLegato, 'Quick Legato applied (Ctrl+L)')
        return
      }

      // Glue / Merge Notes (Ctrl+G)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        applyMidiTransform(applyGlue, 'Glue applied (Ctrl+G)')
        return
      }

      // Transpose Octave (Shift+Up / Shift+Down)
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const delta = e.key === 'ArrowUp' ? 12 : -12
        applyMidiTransform(t => applyTranspose(t, delta), `Transposed ${delta > 0 ? '+1' : '-1'} Octave`)
        return
      }

      // Transpose Semitone or EDO Step (Ctrl+Up / Ctrl+Down)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const editTrack = store.tracks.find(t => t.id === targetTrackId)
        const edo = editTrack?.edoDivision || 12
        const isMicro = !isDrum && edo !== 12
        const step = isMicro ? (12 / edo) : 1
        const direction = e.key === 'ArrowUp' ? 1 : -1
        const delta = direction * step
        const label = isMicro
          ? `${direction > 0 ? '+1' : '-1'} EDO Step (${(1200 / edo).toFixed(1)}¢)`
          : `${delta > 0 ? '+1' : '-1'} Semitone`
        applyMidiTransform(t => applyTranspose(t, delta), `Transposed ${label}`)
        return
      }

      // Strum (Alt+S)
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (store.leftPaneCollapsed) store.setLeftPaneCollapsed(false)
        store.setActiveMidiEditTab('quick')
        applyMidiTransform(applyStrum, 'Strum Tool (Alt+S)')
        return
      }

      // Chop 1/16 (Alt+U)
      if (e.altKey && e.key.toLowerCase() === 'u') {
        e.preventDefault()
        if (store.leftPaneCollapsed) store.setLeftPaneCollapsed(false)
        store.setActiveMidiEditTab('chopArp')
        applyMidiTransform(t => applyChop(t, { pattern: '1/16' }), 'Chop Tool (Alt+U)')
        return
      }

      // Arpeggiator (Alt+A)
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (store.leftPaneCollapsed) store.setLeftPaneCollapsed(false)
        store.setActiveMidiEditTab('chopArp')
        store.showToast('Arpeggiator Tool (Alt+A)', 'info')
        return
      }

      // Humanize (Alt+R)
      if (e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        if (store.leftPaneCollapsed) store.setLeftPaneCollapsed(false)
        store.setActiveMidiEditTab('humanize')
        applyMidiTransform(applyHumanize, 'Humanize Tool (Alt+R)')
        return
      }

      // Flip Horizontal / Time Reverse (Alt+Y)
      if (e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        applyMidiTransform(applyFlipHorizontal, 'Flip Horizontal / Reverse (Alt+Y)')
        return
      }

      // Mute / Unmute Selected Notes ('m' key)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'm') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault()
          store.commitHistory()
          const selected = store.notes.filter(n => selectedNoteIds.includes(n.id))
          const allMuted = selected.length > 0 && selected.every(n => n.muted)
          const targetMute = !allMuted
          store.updateNotes(selectedNoteIds, { muted: targetMute })
          store.showToast(
            targetMute
              ? `Muted ${selectedNoteIds.length} note${selectedNoteIds.length === 1 ? '' : 's'}`
              : `Unmuted ${selectedNoteIds.length} note${selectedNoteIds.length === 1 ? '' : 's'}`,
            'info'
          )
          return
        }
      }

      // Select All on Active Track (Ctrl+A)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (targetTrackId) {
          const trackIds = store.notes.filter(n => n.trackId === targetTrackId).map(n => n.id)
          setSelectedNoteIds(trackIds)
          store.showToast(`Selected all ${trackIds.length} notes`, 'info')
        }
        return
      }

      // Deselect (Escape)
      if (e.key === 'Escape') {
        if (selectedNoteIds.length > 0) {
          setSelectedNoteIds([])
          store.showToast('Cleared note selection', 'info')
        }
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [allNotes, selectedNoteIds, targetTrackId, addNote, removeNote, setSelectedNoteIds, isReadOnly])

  const tickToX = useCallback((tick: number) => {
    const cols = getColumns()
    if (cols.length === 0) return tick
    const colIndex = Math.min(cols.length - 1, Math.max(0, Math.floor(tick / gridBlockTicks)))
    const col = cols[colIndex]
    const offsetTicks = tick - col.tick
    const ratio = col.width / col.durationTicks
    return col.x + offsetTicks * ratio
  }, [getColumns, gridBlockTicks])

  const xToTick = useCallback((x: number) => {
    const cols = getColumns()
    if (cols.length === 0) return x
    if (x <= 0) return 0
    let col = cols[0]
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]
      if (x >= c.x && x <= c.x + c.width) {
        col = c
        break
      }
      if (i === cols.length - 1) {
        col = c
      }
    }
    const offsetX = x - col.x
    const ratio = col.durationTicks / col.width
    return Math.max(0, col.tick + offsetX * ratio)
  }, [getColumns])

  useEffect(() => {
    if (!autoExtendGrid) return

    const rightmostX = (canvasSize.width - SIDEBAR_WIDTH - getEffectivePanX(canvasSize.width)) / zoom
    const rightmostTick = xToTick(rightmostX)

    const maxNoteTick = getMaxTicks()
    const twoSecondsTicks = 2 * 192 * (globalBpm / 60)

    const maxTick = Math.max(rightmostTick, maxNoteTick)
    const currentGridTicks = gridColumnCount * gridBlockTicks

    if (maxTick + twoSecondsTicks > currentGridTicks) {
      const neededCols = Math.ceil((maxTick + twoSecondsTicks) / gridBlockTicks)
      if (neededCols > gridColumnCount) {
        setGridColumnCount(neededCols)
      }
    }
  }, [autoExtendGrid, canvasSize.width, pan.x, sharedPanX, scrollBoth, zoom, gridColumnCount, gridBlockTicks, globalBpm, getMaxTicks, setGridColumnCount, xToTick, getEffectivePanX])

  const findResizableColumn = (x: number) => {
    if (!gridResizable) return null
    const cols = getColumns()
    for (const col of cols) {
      if (Math.abs(x - (col.x + col.width)) < 10 / zoom) return col
    }
    return null
  }

  const setPlayheadFromWorldX = (x: number) => {
    const newPlayhead = Math.max(0, xToTick(x))
    const st = useStore.getState()
    st.setPlayheadPosition(newPlayhead)
    if (st.isStepRecording) {
      const baseTicks = st.stepRecordStepSize > 0 ? st.stepRecordStepSize : st.snapResolution
      const colTicks = Math.max(1, Math.round(baseTicks * (st.stepRecordStepColumns || 1)))
      const snappedStep = Math.floor(newPlayhead / colTicks) * colTicks
      st.setStepRecordCursorTick(snappedStep)
    }
    Tone.Transport.ticks = newPlayhead
    setContextMenu(null)
  }

  const getWorldXFromPointer = (clientX: number, rect: DOMRect) =>
    (clientX - rect.left - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom

  // STICKY TIMELINE RENDER LOOP
  useEffect(() => {
    if (!timelineCanvasRef.current || instrumentTracks.length === 0) return
    const canvas = timelineCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number

    const render = () => {
      const { pan, zoom, activeDragRegion, exportRegionMode, exportRegions } = stateRef.current
      const storeState = useStore.getState()
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      if (width <= 0 || height <= 0) {
        animationFrameId = requestAnimationFrame(render)
        return
      }

      // Interpolate activeDragRegion for smooth animation
      const targetActive = activeDragRegion
      if (targetActive) {
        if (!visualStateRef.current.activeDragRegion) {
          visualStateRef.current.activeDragRegion = {
            startTick: targetActive.startTick,
            endTick: targetActive.endTick,
            opacity: 0
          }
        }
        const visual = visualStateRef.current.activeDragRegion
        visual.startTick += (targetActive.startTick - visual.startTick) * 0.2
        visual.endTick += (targetActive.endTick - visual.endTick) * 0.2
        visual.opacity += (1.0 - visual.opacity) * 0.2
      } else if (visualStateRef.current.activeDragRegion) {
        const visual = visualStateRef.current.activeDragRegion
        visual.opacity += (0.0 - visual.opacity) * 0.2
        if (visual.opacity < 0.01) {
          visualStateRef.current.activeDragRegion = null
        }
      }

      // Interpolate exportRegions for smooth animation
      const targetRegions = exportRegions || []
      const currentVisualRegions = visualStateRef.current.regions

      targetRegions.forEach(target => {
        let visual = currentVisualRegions.find(r => r.id === target.id)
        if (!visual) {
          visual = {
            id: target.id,
            startTick: target.startTick,
            endTick: target.endTick,
            opacity: 0
          }
          currentVisualRegions.push(visual)
        }
        visual.startTick += (target.startTick - visual.startTick) * 0.2
        visual.endTick += (target.endTick - visual.endTick) * 0.2
        visual.opacity += (1.0 - visual.opacity) * 0.2
      })

      visualStateRef.current.regions = currentVisualRegions.filter(visual => {
        const hasTarget = targetRegions.some(t => t.id === visual.id)
        if (!hasTarget) {
          visual.opacity += (0.0 - visual.opacity) * 0.2
          return visual.opacity >= 0.01
        }
        return true
      })

      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#151820'
      ctx.fillRect(0, 0, width, height)

      const effectivePanX = (storeState.playheadFollowMode === 'grid' && !isHorizScrollLocked)
        ? getPlayheadAnchorX(width) - tickToX(storeState.playheadPosition) * zoom
        : pan.x
      const cols = getColumns()
      const shadeEvery = Math.max(1, storeState.gridShadeEvery)
      const majorEveryColumns = Math.max(shadeEvery, Math.round(768 / Math.max(1, storeState.gridBlockTicks)))

      cols.forEach(col => {
        const x = effectivePanX + SIDEBAR_WIDTH + col.x * zoom
        const w = col.width * zoom
        if (x > width || x + w < 0) return

        const isDark = Math.floor(col.index / shadeEvery) % 2 === 0
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.08)'
        ctx.fillRect(x, 0, w, height)

        const isMajor = col.index % majorEveryColumns === 0
        ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)'
        ctx.lineWidth = isMajor ? 1.5 : 1
        ctx.beginPath()
        ctx.moveTo(x, isMajor ? 0 : height * 0.46)
        ctx.lineTo(x, height)
        ctx.stroke()

        // Structural Indexing (New)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
        ctx.font = 'bold 10px "JetBrains Mono", monospace'
        ctx.fillText((col.index + 1).toString(), x + w / 2, 6)

        if (isMajor) {
          const bar = Math.floor(col.x / 768) + 1
          const tps = (storeState.bpm / 60) * 192 // PPQ=192
          const seconds = (col.x / tps).toFixed(2)

          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'

          // Render Bar Number (Primary)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 10px Inter, sans-serif'
          ctx.fillText(`${bar}`, x + 5, 4)

          // Render Seconds | Ticks (Secondary / Technical)
          ctx.fillStyle = '#8b92a5'
          ctx.font = '9px "JetBrains Mono", "Courier New", monospace'
          ctx.fillText(`${seconds}s | ${col.x}t`, x + 5, 16)
        }
      })

      if (storeState.loopEnabled) {
        const loopXStart = effectivePanX + SIDEBAR_WIDTH + tickToX(storeState.loopStart) * zoom
        const loopWidth = (tickToX(storeState.loopEnd) - tickToX(storeState.loopStart)) * zoom
        ctx.fillStyle = 'rgba(77,171,247,0.14)'
        ctx.fillRect(loopXStart, 0, loopWidth, height)
      }

      if (storeState.timelineSelection) {
        const minT = Math.min(storeState.timelineSelection.startTick, storeState.timelineSelection.endTick)
        const maxT = Math.max(storeState.timelineSelection.startTick, storeState.timelineSelection.endTick)
        const sxStart = effectivePanX + SIDEBAR_WIDTH + tickToX(minT) * zoom
        const sxEnd = effectivePanX + SIDEBAR_WIDTH + tickToX(maxT) * zoom
        const sWidth = sxEnd - sxStart
        if (sWidth > 0) {
          ctx.fillStyle = 'rgba(255, 170, 0, 0.22)'
          ctx.fillRect(sxStart, 0, sWidth, height)
          ctx.strokeStyle = '#ffa94d'
          ctx.lineWidth = 1.5
          ctx.strokeRect(sxStart, 0, sWidth, height)

          if (sWidth > 24) {
            ctx.fillStyle = '#ffa94d'
            ctx.fillRect(sxStart, 0, Math.min(sWidth, 64), 11)
            ctx.fillStyle = '#14141c'
            ctx.font = 'bold 8.5px "Inter", sans-serif'
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillText(`${maxT - minT}t Range`, sxStart + 4, 6)
          }
        }
      }

      if (exportRegionMode) {
        visualStateRef.current.regions.forEach((region, index) => {
          const rxStart = effectivePanX + SIDEBAR_WIDTH + tickToX(region.startTick) * zoom
          const rxEnd = effectivePanX + SIDEBAR_WIDTH + tickToX(region.endTick) * zoom
          const rWidth = rxEnd - rxStart

          // Green overlay with smooth visual opacity
          ctx.fillStyle = `rgba(18,184,134,${0.14 * region.opacity})`
          ctx.fillRect(rxStart, 0, rWidth, height)

          // Border with smooth visual opacity
          ctx.strokeStyle = `rgba(18,184,134,${region.opacity})`
          ctx.lineWidth = 1
          ctx.strokeRect(rxStart, 0, rWidth, height)

          // Draw small number badge in top right corner of the region
          if (rWidth > 14) {
            ctx.fillStyle = `rgba(18,184,134,${region.opacity})`
            ctx.fillRect(rxEnd - 16, 2, 14, 12)
            ctx.fillStyle = `rgba(255,255,255,${region.opacity})`
            ctx.font = 'bold 9px "Inter", sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(`${index + 1}`, rxEnd - 9, 8)
            ctx.textAlign = 'left'
            ctx.textBaseline = 'top'
          }
        })

        // Draw active drag region preview with smooth visual opacity
        const visualActive = visualStateRef.current.activeDragRegion
        if (visualActive) {
          const rxStart = effectivePanX + SIDEBAR_WIDTH + tickToX(Math.min(visualActive.startTick, visualActive.endTick)) * zoom
          const rxEnd = effectivePanX + SIDEBAR_WIDTH + tickToX(Math.max(visualActive.startTick, visualActive.endTick)) * zoom
          const rWidth = rxEnd - rxStart

          ctx.fillStyle = `rgba(18,184,134,${0.25 * visualActive.opacity})`
          ctx.fillRect(rxStart, 0, rWidth, height)
          ctx.strokeStyle = `rgba(18,184,134,${visualActive.opacity})`
          ctx.lineWidth = 1.5
          ctx.strokeRect(rxStart, 0, rWidth, height)
        }
      }

      // Draw Step Recording Active Step on Sticky Timeline
      if (storeState.isStepRecording) {
        const baseTicks = storeState.stepRecordStepSize > 0 ? storeState.stepRecordStepSize : storeState.snapResolution
        const stepWidthTicks = Math.round(baseTicks * (storeState.stepRecordStepColumns || 1))
        const stepStartX = effectivePanX + SIDEBAR_WIDTH + tickToX(storeState.stepRecordCursorTick) * zoom
        const stepEndX = effectivePanX + SIDEBAR_WIDTH + tickToX(storeState.stepRecordCursorTick + stepWidthTicks) * zoom
        const stepW = Math.max(4, stepEndX - stepStartX)

        ctx.fillStyle = 'rgba(255, 45, 85, 0.28)'
        ctx.fillRect(stepStartX, 0, stepW, height)
        ctx.strokeStyle = '#ff2d55'
        ctx.lineWidth = 1.5
        ctx.strokeRect(stepStartX, 0, stepW, height)

        ctx.fillStyle = '#ff2d55'
        ctx.font = 'bold 8.5px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('STEP', stepStartX + stepW / 2, 10)
      }

      const playheadX = effectivePanX + SIDEBAR_WIDTH + tickToX(storeState.playheadPosition) * zoom
      ctx.strokeStyle = 'rgba(255,51,102,0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, height)
      ctx.stroke()

      ctx.fillStyle = 'rgba(255,51,102,0.95)'
      ctx.beginPath()
      ctx.moveTo(playheadX, height)
      ctx.lineTo(playheadX - 5, height - 7)
      ctx.lineTo(playheadX + 5, height - 7)
      ctx.closePath()
      ctx.fill()

      // Solid sidebar blocker for sticky timeline
      ctx.fillStyle = '#14141c' // Matches standard header dark color
      ctx.fillRect(0, 0, SIDEBAR_WIDTH, height)
      ctx.strokeStyle = '#333'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(SIDEBAR_WIDTH, 0)
      ctx.lineTo(SIDEBAR_WIDTH, height)
      ctx.stroke()

      animationFrameId = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(animationFrameId)
  }, [instrumentTracks.length, getColumns, tickToX, isHorizScrollLocked])

  // MAIN RENDER LOOP
  useEffect(() => {
    if (!canvasRef.current || instrumentTracks.length === 0) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    let animationFrameId: number

    const render = () => {
      // Pull fresh data directly from refs/store to avoid restarting the loop
      const { pan, zoom, dragMode, boxSelectStart, boxSelectCurrent } = stateRef.current
      const storeState = useStore.getState()
      const playheadPosition = storeState.playheadPosition
      const visibleTrackIds = new Set(storeState.tracks.filter(track => track.instrument === instrument && !track.hidden).map(track => track.id))
      const trackMap = new Map(storeState.tracks.map(track => [track.id, track]))
      const notes = storeState.notes.filter(n => visibleTrackIds.has(n.trackId))
      const selectedNoteIds = storeState.selectedNoteIds

      const canvasWidth = canvasRef.current!.clientWidth
      const canvasHeight = canvasRef.current!.clientHeight

      const effectivePanX = (storeState.playheadFollowMode === 'grid' && !isHorizScrollLocked)
        ? getPlayheadAnchorX(canvasWidth) - tickToX(playheadPosition) * zoom
        : pan.x

      // Update canvas resolution (handle high DPI screens) only when changed
      const dpr = window.devicePixelRatio || 1
      if (canvasWidth > 0 && canvasHeight > 0) {
        const targetW = Math.round(canvasWidth * dpr)
        const targetH = Math.round(canvasHeight * dpr)
        if (canvasRef.current!.width !== targetW || canvasRef.current!.height !== targetH) {
          canvasRef.current!.width = targetW
          canvasRef.current!.height = targetH
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Clear
      ctx.clearRect(0, 0, canvasWidth, canvasHeight)

      ctx.save()

      ctx.translate(effectivePanX + SIDEBAR_WIDTH, pan.y)
      ctx.scale(zoom, zoom)

      const cols = getColumns()
      const gridHeight = numRows * gridSizeY
      const width = cols[cols.length - 1].x + cols[cols.length - 1].width
      const shadeEvery = Math.max(1, storeState.gridShadeEvery)
      const majorEveryColumns = Math.max(shadeEvery, Math.round(768 / Math.max(1, storeState.gridBlockTicks)))

      // Viewport culling boundaries in grid coordinates (with safe margins)
      const viewMarginX = 200 / zoom
      const minVisibleX = (-effectivePanX - SIDEBAR_WIDTH) / zoom - viewMarginX
      const maxVisibleX = (canvasWidth - effectivePanX - SIDEBAR_WIDTH) / zoom + viewMarginX

      // Pre-compute BPM conflict ticks once per frame instead of O(Cols * Notes)
      const conflictTicks = new Set<number>()
      const hasAnyTempoDifference = storeState.tracks.some(t => (t.targetTempo ?? storeState.bpm) !== activeTrackTargetTempo)
      if (hasAnyTempoDifference) {
        for (let i = 0; i < storeState.notes.length; i++) {
          const n = storeState.notes[i]
          const noteTrack = trackMap.get(n.trackId)
          const noteTrackBpm = noteTrack?.targetTempo ?? storeState.bpm
          if (noteTrackBpm !== activeTrackTargetTempo) {
            conflictTicks.add(n.time)
          }
        }
      }

      // Draw Grid Headers (Columns & Timeline)
      ctx.lineWidth = 1 / zoom // Keep borders crisp

      cols.forEach(col => {
        if (col.x + col.width < minVisibleX || col.x > maxVisibleX) return
        const isDark = Math.floor(col.index / shadeEvery) % 2 === 0
        ctx.fillStyle = isDark ? '#1a1a1a' : '#222222'
        ctx.fillRect(col.x, 0, col.width, TIMELINE_HEIGHT)

        ctx.strokeStyle = '#444'
        ctx.strokeRect(col.x, 0, col.width, TIMELINE_HEIGHT)
      })

      // Draw vertical lines & background shading
      cols.forEach(col => {
        if (col.x + col.width < minVisibleX || col.x > maxVisibleX) return
        const isDark = Math.floor(col.index / shadeEvery) % 2 === 0

        // DRAW GRID & SHADE LOCKED COLUMNS
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.06)'
        ctx.beginPath()
        ctx.moveTo(col.x, TIMELINE_HEIGHT)
        ctx.lineTo(col.x, TIMELINE_HEIGHT + gridHeight)
        ctx.stroke()

        if (isDark) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
          ctx.fillRect(col.x, TIMELINE_HEIGHT, col.width, gridHeight)
        }

        // UX LOCK: Shade columns that contain notes on a track with a different BPM (O(1) lookup)
        if (conflictTicks.has(col.tick)) {
          ctx.fillStyle = 'rgba(255, 51, 102, 0.08)' // Subtle red for locked columns
          ctx.fillRect(col.x, TIMELINE_HEIGHT, col.width, gridHeight)
        }

        if (col.index % majorEveryColumns === 0) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
          ctx.lineWidth = 2 / zoom
        } else {
          ctx.strokeStyle = 'rgba(85, 85, 85, 0.5)'
          ctx.lineWidth = 1 / zoom
        }
        ctx.stroke()
      })

      // Scale row highlighting (synth 12-TET only)
      if (!isDrum && !isMicroEdo && scaleLock.enabled) {
        const transpose = currentTrack?.transpose ?? 0
        for (let i = 0; i < numRows; i++) {
          const pitch = getPitchFromIndex(i)
          const soundingPitch = pitch + transpose
          const inScale = isInScale(soundingPitch, scaleLock.root, scaleLock.mode, scaleLock.customIntervals)
          const isRoot = ((soundingPitch - scaleLock.root + 1200) % 12) === 0
          const rowY = TIMELINE_HEIGHT + i * gridSizeY
          if (isRoot) {
            ctx.fillStyle = 'rgba(77, 171, 247, 0.12)'
            ctx.fillRect(0, rowY, width, gridSizeY)
          } else if (!inScale) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
            ctx.fillRect(0, rowY, width, gridSizeY)
          }
        }
      }

      // Microtonal EDO row backgrounds
      if (!isDrum && isMicroEdo) {
        const rootNote = currentTrack?.edoRootNote ?? 60
        const preset = currentTrack?.edoPreset
        for (let i = 0; i < numRows; i++) {
          const pitch = getPitchFromIndex(i)
          const info = getEdoStepInfo(pitch, edo, rootNote, preset)
          const rowY = TIMELINE_HEIGHT + i * gridSizeY
          if (info.isRoot) {
            ctx.fillStyle = 'rgba(0, 230, 255, 0.08)' // Accent glow on octave roots
            ctx.fillRect(0, rowY, width, gridSizeY)
          } else if (info.isNatural) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.025)' // Natural degree tint
            ctx.fillRect(0, rowY, width, gridSizeY)
          } else if (info.isPrimaryDegree) {
            ctx.fillStyle = 'rgba(0, 230, 255, 0.02)' // Perde tint
            ctx.fillRect(0, rowY, width, gridSizeY)
          } else if (i % 2 === 1) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
            ctx.fillRect(0, rowY, width, gridSizeY)
          }
        }
      } else {
        // Zebra stripes for standard 12-TET and drums
        for (let i = 0; i < numRows; i++) {
          if (i % 2 === 1) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.02)'
            const rowY = TIMELINE_HEIGHT + i * gridSizeY
            ctx.fillRect(0, rowY, width, gridSizeY)
          }
        }
      }

      // Loop region overlay on timeline
      if (loopEnabled) {
        const loopXStart = tickToX(loopStart)
        const loopXEnd = tickToX(loopEnd)
        const loopWidth = loopXEnd - loopXStart
        ctx.fillStyle = 'rgba(77, 171, 247, 0.15)'
        ctx.fillRect(loopXStart, 0, loopWidth, TIMELINE_HEIGHT)
        ctx.fillStyle = 'rgba(77, 171, 247, 0.08)'
        ctx.fillRect(loopXStart, TIMELINE_HEIGHT, loopWidth, gridHeight)
        // Loop boundary lines
        ctx.strokeStyle = '#4dabf7'
        ctx.lineWidth = 2 / zoom
        ctx.beginPath()
        ctx.moveTo(loopXStart, 0); ctx.lineTo(loopXStart, TIMELINE_HEIGHT + gridHeight)
        ctx.moveTo(loopXEnd, 0); ctx.lineTo(loopXEnd, TIMELINE_HEIGHT + gridHeight)
        ctx.stroke()
      }

      if (exportRegionMode) {
        visualStateRef.current.regions.forEach((region) => {
          const rxStart = tickToX(region.startTick)
          const rxEnd = tickToX(region.endTick)
          const rWidth = rxEnd - rxStart

          // Translucent green overlay on grid with smooth visual opacity
          ctx.fillStyle = `rgba(18, 184, 134, ${0.05 * region.opacity})`
          ctx.fillRect(rxStart, TIMELINE_HEIGHT, rWidth, gridHeight)

          // Translucent green overlay on timeline header
          ctx.fillStyle = `rgba(18, 184, 134, ${0.15 * region.opacity})`
          ctx.fillRect(rxStart, 0, rWidth, TIMELINE_HEIGHT)

          // Boundary lines with smooth visual opacity
          ctx.strokeStyle = `rgba(18, 184, 134, ${0.45 * region.opacity})`
          ctx.lineWidth = 2 / zoom
          ctx.beginPath()
          ctx.moveTo(rxStart, 0); ctx.lineTo(rxStart, TIMELINE_HEIGHT + gridHeight)
          ctx.moveTo(rxEnd, 0); ctx.lineTo(rxEnd, TIMELINE_HEIGHT + gridHeight)
          ctx.stroke()
        })

        const visualActive = visualStateRef.current.activeDragRegion
        if (visualActive) {
          const rxStart = tickToX(Math.min(visualActive.startTick, visualActive.endTick))
          const rxEnd = tickToX(Math.max(visualActive.startTick, visualActive.endTick))
          const rWidth = rxEnd - rxStart

          ctx.fillStyle = `rgba(18, 184, 134, ${0.1 * visualActive.opacity})`
          ctx.fillRect(rxStart, TIMELINE_HEIGHT, rWidth, gridHeight)

          ctx.fillStyle = `rgba(18, 184, 134, ${0.22 * visualActive.opacity})`
        }
      }

      if (storeState.timelineSelection) {
        const minT = Math.min(storeState.timelineSelection.startTick, storeState.timelineSelection.endTick)
        const maxT = Math.max(storeState.timelineSelection.startTick, storeState.timelineSelection.endTick)
        const sxStart = tickToX(minT)
        const sxEnd = tickToX(maxT)
        const sWidth = sxEnd - sxStart
        if (sWidth > 0) {
          ctx.fillStyle = 'rgba(255, 170, 0, 0.08)'
          ctx.fillRect(sxStart, TIMELINE_HEIGHT, sWidth, gridHeight)
          ctx.fillStyle = 'rgba(255, 170, 0, 0.20)'
          ctx.fillRect(sxStart, 0, sWidth, TIMELINE_HEIGHT)
          ctx.strokeStyle = 'rgba(255, 170, 0, 0.7)'
          ctx.lineWidth = 1.5 / zoom
          ctx.beginPath()
          ctx.moveTo(sxStart, 0); ctx.lineTo(sxStart, TIMELINE_HEIGHT + gridHeight)
          ctx.moveTo(sxEnd, 0); ctx.lineTo(sxEnd, TIMELINE_HEIGHT + gridHeight)
          ctx.stroke()
        }
      }

      // Draw horizontal lines
      if (!isDrum && isMicroEdo) {
        const rootNote = currentTrack?.edoRootNote ?? 60
        const preset = currentTrack?.edoPreset
        for (let i = 0; i <= numRows; i++) {
          const p = getPitchFromIndex(i)
          const info = getEdoStepInfo(p, edo, rootNote, preset)
          ctx.beginPath()
          ctx.moveTo(0, TIMELINE_HEIGHT + i * gridSizeY)
          ctx.lineTo(width, TIMELINE_HEIGHT + i * gridSizeY)
          if (info.isRoot) {
            ctx.strokeStyle = 'rgba(0, 230, 255, 0.55)'
            ctx.lineWidth = 1.5 / zoom
          } else if (info.isNatural) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
            ctx.lineWidth = 1 / zoom
          } else if (info.isPrimaryDegree) {
            ctx.strokeStyle = 'rgba(0, 230, 255, 0.22)'
            ctx.lineWidth = 1 / zoom
          } else {
            ctx.strokeStyle = 'rgba(75, 75, 75, 0.35)'
            ctx.lineWidth = 0.8 / zoom
          }
          ctx.stroke()
        }
      } else {
        ctx.beginPath()
        for (let i = 0; i <= numRows; i++) {
          ctx.moveTo(0, TIMELINE_HEIGHT + i * gridSizeY)
          ctx.lineTo(width, TIMELINE_HEIGHT + i * gridSizeY)
        }
        ctx.strokeStyle = 'rgba(85, 85, 85, 1)' // Brighter for contrast
        ctx.lineWidth = 1 / zoom
        ctx.stroke()
      }

      // Draw Custom Synth Rows Lines
      if (!isDrum) {
        const customRows = storeState.customSynthRows.filter(r => r.trackId === targetTrackId)
        if (customRows.length > 0) {
          ctx.beginPath()
          customRows.forEach(row => {
            const rowY = TIMELINE_HEIGHT + getPitchY(row.pitch)
            ctx.moveTo(0, rowY)
            ctx.lineTo(width, rowY)
          })
          ctx.strokeStyle = 'rgba(32, 201, 151, 0.4)'
          ctx.lineWidth = 2 / zoom
          ctx.stroke()
        }
      }

      // Draw Labels BG and Text



      const selectedNoteSet = new Set(selectedNoteIds)

      // CULL OFFSCREEN NOTES: Only process and draw notes that intersect the horizontal viewport
      const visibleNotes = notes.filter(note => {
        const x = tickToX(note.time)
        const noteEndX = tickToX(note.time + note.duration)
        return noteEndX >= minVisibleX && x <= maxVisibleX
      })

      const overlapPositions = new Map<string, number>()
      const overlapTotals = new Map<string, number>()
      visibleNotes.forEach(note => {
        const key = `${note.time}|${note.pitch}|${note.duration}`
        overlapTotals.set(key, (overlapTotals.get(key) ?? 0) + 1)
      })

      // Draw glide connectors underneath the notes
      const glideSources = notes.filter(n => n.glideToNoteId)
      if (glideSources.length > 0) {
        const notesById = new Map(notes.map(n => [n.id, n]))
        glideSources.forEach(note => {
          const target = notesById.get(note.glideToNoteId as string)
          if (!target) return
          const destVoiced = note.glideVoice === 'destination' || note.glideVoice === 'morph'
          const slideTicks = note.pitchSlideTime ?? note.duration
          const x1 = destVoiced
            ? tickToX(Math.max(0, target.time - slideTicks))
            : tickToX(note.time + note.duration)
          const x2 = tickToX(target.time)
          if (Math.max(x1, x2) < minVisibleX || Math.min(x1, x2) > maxVisibleX) return
          const sourcePitch = destVoiced ? note.pitch : (note.pitchEnd !== undefined ? note.pitchEnd : note.pitch)
          const y1 = TIMELINE_HEIGHT + getPitchY(sourcePitch) + gridSizeY * 0.5
          const y2 = TIMELINE_HEIGHT + getPitchY(target.pitch) + gridSizeY * 0.5
          if (y1 < TIMELINE_HEIGHT || y2 < TIMELINE_HEIGHT) return

          const color = trackMap.get(note.trackId)?.color || '#4dabf7'
          const dx = x2 - x1

          let shape: 'line' | 'easeIn' | 'easeOut' | 'sCurve' = 'sCurve'
          if (note.pitchSlideRamp === 'linear') shape = 'line'
          else if (note.pitchSlideRamp === 'exponential') shape = 'easeIn'
          else if (note.pitchSlideRamp === 'logarithmic') shape = 'easeOut'
          else if (note.pitchSlideRamp === 'custom') {
            const equation = (note.pitchSlideCustomCurve || '').replace(/\s+/g, ' ')
            if (equation.startsWith('1 - Math.pow(1 - t, 3)')) shape = 'easeOut'
            else if (equation.startsWith('t * t * t')) shape = 'easeIn'
          }

          ctx.save()
          ctx.strokeStyle = color
          ctx.fillStyle = color
          ctx.globalAlpha = selectedNoteSet.has(note.id) ? 0.95 : (note.trackId === targetTrackId ? 0.7 : 0.4)
          ctx.lineWidth = 1.5 / zoom
          if (destVoiced) ctx.setLineDash([5 / zoom, 4 / zoom])
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          if (shape === 'line') {
            ctx.lineTo(x2, y2)
          } else {
            let cp1x = x1 + dx * 0.5
            let cp1y = y1
            let cp2x = x1 + dx * 0.5
            let cp2y = y2
            if (shape === 'easeIn') {
              cp1x = x1 + dx * 0.6
              cp1y = y1
              cp2x = x1 + dx * 0.9
              cp2y = y2
            } else if (shape === 'easeOut') {
              cp1x = x1 + dx * 0.1
              cp1y = y1
              cp2x = x1 + dx * 0.4
              cp2y = y2
            }
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2)
          }
          ctx.stroke()

          ctx.beginPath()
          ctx.arc(x1, y1, 1.6, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x2, y2, 2.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        })
      }

      // Draw Notes
      visibleNotes.forEach(note => {
        const key = `${note.time}|${note.pitch}|${note.duration}`
        const overlapIndex = overlapPositions.get(key) ?? 0
        const overlapTotal = overlapTotals.get(key) ?? 1
        overlapPositions.set(key, overlapIndex + 1)
        const stackOffset = overlapTotal > 1 ? Math.min(5, gridSizeY * 0.12) : 0
        const x = tickToX(note.time)
        const topPitch = note.pitchEnd !== undefined ? Math.max(note.pitch, note.pitchEnd) : note.pitch
        const bottomPitch = note.pitchEnd !== undefined ? Math.min(note.pitch, note.pitchEnd) : note.pitch
        const y = TIMELINE_HEIGHT + getPitchY(topPitch) + overlapIndex * stackOffset
        const w = Math.max(5 / zoom, tickToX(note.time + note.duration) - x)

        const noteTrack = trackMap.get(note.trackId)
        const isFromCurrentTrack = note.trackId === targetTrackId
        const otherStepSize = noteTrack?.instrument === 'drum' ? 1 : (noteTrack?.edoDivision && noteTrack.edoDivision !== 12 ? (12 / noteTrack.edoDivision) : 1)
        const heightInPitch = isFromCurrentTrack
          ? ((topPitch - bottomPitch) + stepSize)
          : ((topPitch - bottomPitch) + otherStepSize)
        const baseHeight = (heightInPitch / stepSize) * gridSizeY
        const h = Math.max(isMicroEdo ? 5 : 8, baseHeight - (overlapTotal - 1) * stackOffset)
        const noteColor = noteTrack?.color || '#4dabf7'

        const isSelected = selectedNoteSet.has(note.id)
        const isMuted = note.muted === true
        ctx.fillStyle = isSelected ? '#ffffff' : (isMuted ? '#686b7c' : noteColor)
        ctx.globalAlpha = isMuted
          ? (isFromCurrentTrack ? (isSelected ? 0.75 : 0.35) : 0.18)
          : (isFromCurrentTrack ? 0.9 : ghostNoteOpacity)
        ctx.fillRect(x, y, w, h)

        ctx.strokeStyle = isMuted
          ? (isSelected ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.25)')
          : (isFromCurrentTrack ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.3)')
        if (isMuted) {
          ctx.setLineDash([2, 2])
          ctx.strokeRect(x, y, w, h)
          ctx.setLineDash([])
          if (w >= 8 && h >= 5) {
            ctx.save()
            ctx.strokeStyle = isSelected ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.45)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(x + 2, y + h / 2)
            ctx.lineTo(x + w - 2, y + h / 2)
            ctx.stroke()
            ctx.restore()
          }
        } else if (!isFromCurrentTrack && Math.abs(otherStepSize - stepSize) > 0.001) {
          ctx.setLineDash([3, 2])
          ctx.strokeRect(x, y, w, h)
          ctx.setLineDash([])
        } else {
          ctx.strokeRect(x, y, w, h)
        }

        // Resize handle
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
        if (note.trackId === targetTrackId && !isReadOnly) ctx.fillRect(x + w - 6, y, 6, h)

        // Customized note indicator
        const noteTrackTargetTempo = noteTrack?.targetTempo ?? globalBpm
        const isCustomBpm = note.bpm !== undefined && note.bpm !== noteTrackTargetTempo
        const isCustomVelocity = note.velocityInspectorModified === true && note.velocity !== 100
        const isCustomDetune = note.detune !== undefined && note.detune !== 0
        const isCustomPitchOffset = isDrum && note.pitchOffset !== undefined && note.pitchOffset !== 0
        const isCustomized = isCustomBpm || note.instrumentOverride !== undefined || isCustomVelocity || isCustomDetune || isCustomPitchOffset || (note.pitchSlide !== undefined && note.pitchSlide !== 0) || (note.vibratoDepth !== undefined && note.vibratoDepth !== 0) || (note.tremoloDepth !== undefined && note.tremoloDepth !== 0) || (note.filterStart !== undefined && note.filterStart !== 20000) || note.completeNotesOnPause !== undefined
        if (isCustomized) {
          const r = Math.min(2.5, w / 4, h / 4)
          if (r > 0.5) {
            ctx.beginPath()
            ctx.arc(x + Math.min(6, w / 2), y + h / 2, r, 0, Math.PI * 2)
            ctx.fillStyle = getComplementaryColor(noteColor, isSelected)
            ctx.fill()
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }

        // Draw pitch offset text on drum notes if wide enough
        if (isDrum && note.pitchOffset !== undefined && note.pitchOffset !== 0 && w >= 14) {
          ctx.save()
          ctx.font = 'bold 9px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const label = note.pitchOffset > 0 ? `+${note.pitchOffset}` : `${note.pitchOffset}`
          ctx.fillStyle = isSelected ? '#000000' : '#ffffff'
          ctx.fillText(label, x + Math.min(w / 2, 16), y + h / 2)
          ctx.restore()
        }

        // Draw Microtonal Cents / EDO Badge on synth notes
        if (!isDrum && w >= 22) {
          const noteTrackObj = noteTrack || tracks.find(t => t.id === note.trackId)
          const isMicro = Math.abs(note.pitch - Math.round(note.pitch)) > 0.005 || (noteTrackObj?.edoDivision !== undefined && noteTrackObj.edoDivision !== 12)
          if (isMicro) {
            const centsFromNearest = Math.round((note.pitch - Math.round(note.pitch)) * 100)
            const edo = noteTrackObj?.edoDivision || 53
            const root = noteTrackObj?.edoRootNote ?? 60
            const stepFromRoot = Math.round((note.pitch - root) / (12 / edo))
            const stepInOctave = ((stepFromRoot % edo) + edo) % edo

            ctx.save()
            ctx.font = 'bold 8px monospace'
            ctx.textAlign = 'right'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = isSelected ? '#000000' : '#00e6ff'

            let badgeText = ''
            if (centsFromNearest !== 0) {
              badgeText = centsFromNearest > 0 ? `+${centsFromNearest}¢` : `${centsFromNearest}¢`
            } else if (noteTrackObj?.edoDivision && noteTrackObj.edoDivision !== 12) {
              badgeText = `k${stepInOctave}`
            }
            if (w >= 54 && noteTrackObj?.edoDivision && noteTrackObj.edoDivision !== 12 && centsFromNearest !== 0) {
              badgeText = `${badgeText} [k${stepInOctave}]`
            }
            if (badgeText) {
              ctx.fillText(badgeText, x + w - (note.trackId === targetTrackId ? 8 : 4), y + h / 2)
            }
            ctx.restore()
          }
        }

        // Draw Pitch Glide / Slide Trajectory on Synth notes. A destination-voiced
        // source note stores the interval but must not draw a ramp its own voice never plays.
        const destVoicedSource = note.glideVoice === 'destination' && !!note.glideToNoteId
        if (!isDrum && !destVoicedSource && note.pitchSlide !== undefined && note.pitchSlide !== 0 && w >= 12) {
          ctx.save()
          const isUp = note.pitchSlide > 0
          const startY = isUp ? y + h - 3 : y + 3
          const endY = isUp ? y + 3 : y + h - 3
          const slideSpanX = Math.min(w, Math.max(8, w * ((note.pitchSlideTime || note.duration) / note.duration)))
          
          ctx.strokeStyle = '#00e6ff'
          ctx.lineWidth = 1.8
          ctx.lineCap = 'round'
          ctx.shadowColor = '#00e6ff'
          ctx.shadowBlur = 4
          
          ctx.beginPath()
          ctx.moveTo(x + 3, startY)
          
          // Draw curve based on ramp
          const ramp = note.pitchSlideRamp || 'linear'
          if (ramp === 'sigmoid' || ramp === 'custom') {
            // S-curve bezier
            const midX = x + slideSpanX * 0.5
            ctx.bezierCurveTo(midX, startY, midX, endY, x + slideSpanX - 2, endY)
          } else if (ramp === 'exponential') {
            // Slow start, fast end
            ctx.quadraticCurveTo(x + slideSpanX * 0.8, startY, x + slideSpanX - 2, endY)
          } else if (ramp === 'logarithmic') {
            // Fast start, slow end
            ctx.quadraticCurveTo(x + slideSpanX * 0.2, endY, x + slideSpanX - 2, endY)
          } else {
            // Linear
            ctx.lineTo(x + slideSpanX - 2, endY)
          }
          ctx.stroke()
          
          // Draw arrow tip
          ctx.fillStyle = '#00e6ff'
          ctx.beginPath()
          ctx.arc(x + slideSpanX - 2, endY, 2, 0, Math.PI * 2)
          ctx.fill()

          // Draw small text label if note is wide enough
          if (w >= 36) {
            ctx.font = 'bold 8.5px monospace'
            ctx.textAlign = 'right'
            ctx.textBaseline = isUp ? 'bottom' : 'top'
            ctx.fillStyle = '#00e6ff'
            ctx.shadowBlur = 0
            const sign = note.pitchSlide > 0 ? `+${note.pitchSlide}` : `${note.pitchSlide}`
            ctx.fillText(`${sign}st`, x + w - 4, isUp ? y + h - 2 : y + 2)
          }
          ctx.restore()
        }
      })

      // Draw Cross-Instrument Ghost Notes (e.g. Drums on Synth roll or Synths on Drum sequencer)
      if (crossInstrumentNotes.length > 0) {
        crossInstrumentNotes.forEach(cNote => {
          const cx = tickToX(cNote.time)
          const cw = Math.max(3 / zoom, tickToX(cNote.time + cNote.duration) - cx)
          const cTrack = trackMap.get(cNote.trackId)
          const cColor = cTrack?.color || (isDrum ? '#4dabf7' : '#ff922b')
          ctx.fillStyle = cColor
          ctx.globalAlpha = ghostNoteOpacity * 0.45
          if (!isDrum) {
            ctx.fillRect(cx, TIMELINE_HEIGHT + numRows * gridSizeY - 6, cw, 5)
          } else {
            ctx.fillRect(cx, TIMELINE_HEIGHT, cw, numRows * gridSizeY)
          }
        })
      }
      ctx.globalAlpha = 1.0

      // Draw Utility Picker Highlight
      if (utilityPicker && pickerHoverPos) {
        const { x, y } = pickerHoverPos
        if (utilityPicker.type === 'row') {
          const gridY = y - TIMELINE_HEIGHT
          if (gridY >= 0) {
            const rowIdx = Math.floor(gridY / gridSizeY)
            if (rowIdx >= 0 && rowIdx < numRows) {
              const rowY = TIMELINE_HEIGHT + rowIdx * gridSizeY
              ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
              ctx.fillRect(0, rowY, width, gridSizeY)
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth = 2 / zoom
              ctx.strokeRect(0, rowY, width, gridSizeY)
            }
          }
        } else if (utilityPicker.type === 'col') {
          const cols = getColumns()
          const hoverCol = cols.find(c => x >= c.tick && x < c.tick + c.durationTicks)
          if (hoverCol) {
            ctx.fillStyle = 'rgba(0, 230, 255, 0.25)'
            ctx.fillRect(hoverCol.x, TIMELINE_HEIGHT, hoverCol.width, gridHeight)
            ctx.strokeStyle = '#00e6ff'
            ctx.lineWidth = 2 / zoom
            ctx.strokeRect(hoverCol.x, TIMELINE_HEIGHT, hoverCol.width, gridHeight)
          }
        }
      }

      // Draw Box Selection
      if (dragMode === 'box_select') {
        const x = Math.min(boxSelectStart.x, boxSelectCurrent.x)
        const y = Math.min(boxSelectStart.y, boxSelectCurrent.y)
        const w = Math.abs(boxSelectStart.x - boxSelectCurrent.x)
        const h = Math.abs(boxSelectStart.y - boxSelectCurrent.y)
        ctx.fillStyle = 'rgba(77, 171, 247, 0.2)'
        ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = 'rgba(77, 171, 247, 0.8)'
        ctx.strokeRect(x, y, w, h)
      }

      // Draw Stretch handles when stretch tool is active + notes selected
      const { activeTool: at } = useStore.getState()
      if (at === 'stretch' && selectedNoteIds.length > 0) {
        const sel = notes.filter(n => selectedNoteIds.includes(n.id))
        if (sel.length > 0) {
          const selLeft = tickToX(Math.min(...sel.map(n => n.time)))
          const selRight = tickToX(Math.max(...sel.map(n => n.time + n.duration)))
          const selTop = TIMELINE_HEIGHT + Math.min(...sel.map(n => getPitchY(n.pitch)))
          const selBot = TIMELINE_HEIGHT + Math.max(...sel.map(n => getPitchY(n.pitch) + gridSizeY))
          const hw = 10 / zoom // handle width
          // Bounding box outline
          ctx.strokeStyle = '#b197fc'
          ctx.lineWidth = 1.5 / zoom
          ctx.setLineDash([4 / zoom, 3 / zoom])
          ctx.strokeRect(selLeft, selTop, selRight - selLeft, selBot - selTop)
          ctx.setLineDash([])
          // Left handle
          ctx.fillStyle = '#b197fc'
          ctx.fillRect(selLeft - hw / 2, selTop, hw, selBot - selTop)
          // Right handle
          ctx.fillRect(selRight - hw / 2, selTop, hw, selBot - selTop)
          ctx.lineWidth = 1 / zoom
        }
      }

      // Draw Step Recording Active Column Glow Beam
      if (storeState.isStepRecording) {
        const baseTicks = storeState.stepRecordStepSize > 0 ? storeState.stepRecordStepSize : snapResolution
        const stepWidthTicks = Math.round(baseTicks * (storeState.stepRecordStepColumns || 1))
        const stepLeftX = tickToX(storeState.stepRecordCursorTick)
        const stepRightX = tickToX(storeState.stepRecordCursorTick + stepWidthTicks)
        const colWidth = Math.max(2, stepRightX - stepLeftX)

        ctx.save()
        // Column Glow Beam
        const colGrad = ctx.createLinearGradient(stepLeftX, 0, stepRightX, 0)
        colGrad.addColorStop(0, 'rgba(255, 45, 85, 0.15)')
        colGrad.addColorStop(0.5, 'rgba(255, 45, 85, 0.28)')
        colGrad.addColorStop(1, 'rgba(255, 45, 85, 0.15)')
        ctx.fillStyle = colGrad
        ctx.fillRect(stepLeftX, 0, colWidth, TIMELINE_HEIGHT + gridHeight)

        // Left and Right Accent borders
        ctx.strokeStyle = '#ff2d55'
        ctx.lineWidth = 1.5 / zoom
        ctx.beginPath()
        ctx.moveTo(stepLeftX, 0)
        ctx.lineTo(stepLeftX, TIMELINE_HEIGHT + gridHeight)
        ctx.moveTo(stepRightX, 0)
        ctx.lineTo(stepRightX, TIMELINE_HEIGHT + gridHeight)
        ctx.stroke()

        // Top Header Tag
        const badgeW = Math.max(36 / zoom, colWidth)
        const badgeH = 14 / zoom
        ctx.fillStyle = '#ff2d55'
        ctx.fillRect(stepLeftX, 0, badgeW, badgeH)
        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${Math.max(8, 10 / zoom)}px Inter, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('STEP', stepLeftX + badgeW / 2, badgeH / 2)
        ctx.restore()
      }

      // Draw Playhead
      ctx.beginPath()
      const multiplier = (editTrack?.targetTempo ?? globalBpm) / globalBpm
      const px = tickToX(playheadPosition * multiplier)
      ctx.moveTo(px, 0)
      ctx.lineTo(px, TIMELINE_HEIGHT + gridHeight)
      ctx.strokeStyle = 'rgba(255, 51, 102, 0.8)'
      ctx.lineWidth = 2 / zoom
      ctx.stroke()

      ctx.restore()

      // STICKY ROW LABELS PANEL
      ctx.save()
      const LABEL_WIDTH = SIDEBAR_WIDTH
      const scaledTimelineHeight = TIMELINE_HEIGHT * stateRef.current.zoom
      const scaledGridHeight = gridHeight * stateRef.current.zoom + 100
      const scaledGridSizeY = gridSizeY * stateRef.current.zoom

      // 1. Top Left Corner (Timeline Blocker) - Fixed to screen Y=0
      ctx.fillStyle = '#14141c' // Matches timeline header color
      ctx.fillRect(0, 0, LABEL_WIDTH, scaledTimelineHeight)
      ctx.strokeStyle = '#333'
      ctx.beginPath()
      ctx.moveTo(0, scaledTimelineHeight)
      ctx.lineTo(LABEL_WIDTH, scaledTimelineHeight)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(LABEL_WIDTH, 0)
      ctx.lineTo(LABEL_WIDTH, scaledTimelineHeight)
      ctx.stroke()

      if (!isDrum && currentTrack?.instrument === 'synth' && currentTrack?.edoDivision && currentTrack.edoDivision !== 12) {
        ctx.fillStyle = '#00e6ff'
        ctx.font = 'bold 9.5px Inter, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${currentTrack.edoDivision}-EDO`, LABEL_WIDTH / 2, scaledTimelineHeight / 2)
      }
      // 2. Translate vertically for the scrollable row labels
      ctx.translate(0, stateRef.current.pan.y)

      // 3. Solid left panel background
      ctx.fillStyle = '#1a1a24' // Slightly lighter than timeline for piano roll
      ctx.fillRect(0, scaledTimelineHeight, LABEL_WIDTH, scaledGridHeight)

      // 4. Right border of panel
      ctx.strokeStyle = '#333'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(LABEL_WIDTH, scaledTimelineHeight)
      ctx.lineTo(LABEL_WIDTH, scaledTimelineHeight + scaledGridHeight)
      ctx.stroke()

      // 5. Labels Text
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '600 11px Inter, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'

      if (isDrum) {
        const drumRowsList = currentTrack?.drumRows ?? DEFAULT_DRUM_ROWS
        drumRowsList.forEach((row, i) => {
          const y = scaledTimelineHeight + i * scaledGridSizeY + scaledGridSizeY / 2
          ctx.fillStyle = 'rgba(255,255,255,0.75)'
          ctx.fillText(row.name, 8, y)
        })
      } else if (isMicroEdo) {
        const transpose = currentTrack?.transpose ?? 0
        const rootNote = currentTrack?.edoRootNote ?? 60
        const preset = currentTrack?.edoPreset
        const fontSize = Math.max(7.5, Math.min(10.5, scaledGridSizeY * 0.72))

        for (let i = 0; i < numRows; i++) {
          const pitch = getPitchFromIndex(i)
          const soundingPitch = pitch + transpose
          const info = getEdoStepInfo(soundingPitch, edo, rootNote, preset)
          const y = scaledTimelineHeight + i * scaledGridSizeY + scaledGridSizeY / 2
          const rowTopY = scaledTimelineHeight + i * scaledGridSizeY

          // Reset alpha so per-row tint alpha doesn't compound with the previous row's text
          ctx.globalAlpha = 1.0

          // Key background tint
          if (info.isRoot) {
            ctx.fillStyle = 'rgba(0, 230, 255, 0.18)'
            ctx.fillRect(0, rowTopY, LABEL_WIDTH, scaledGridSizeY)
          } else if (info.isNatural) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
            ctx.fillRect(0, rowTopY, LABEL_WIDTH, scaledGridSizeY)
          } else if (info.isPrimaryDegree) {
            ctx.fillStyle = 'rgba(56, 217, 169, 0.07)'
            ctx.fillRect(0, rowTopY, LABEL_WIDTH, scaledGridSizeY)
          }

          // Key separator border
          ctx.strokeStyle = info.isRoot
            ? 'rgba(0, 230, 255, 0.55)'
            : (info.isNatural ? 'rgba(255, 255, 255, 0.14)' : (info.isPrimaryDegree ? 'rgba(56, 217, 169, 0.22)' : 'rgba(50, 50, 60, 0.35)'))
          ctx.lineWidth = info.isRoot ? 1.5 : 1
          ctx.beginPath()
          ctx.moveTo(0, rowTopY + scaledGridSizeY)
          ctx.lineTo(LABEL_WIDTH, rowTopY + scaledGridSizeY)
          ctx.stroke()

          // Key text
          ctx.font = `${info.isRoot ? 'bold' : '600'} ${fontSize}px Inter, sans-serif`
          if (info.isRoot) {
            ctx.fillStyle = '#00e6ff'
            ctx.globalAlpha = 1.0
            ctx.fillText(info.label, 6, y)
          } else if (info.isNatural) {
            ctx.fillStyle = '#ffffff'
            ctx.globalAlpha = 0.95
            ctx.fillText(info.label, 6, y)
          } else if (info.isPrimaryDegree) {
            ctx.fillStyle = '#38d9a9'
            ctx.globalAlpha = 0.9
            ctx.fillText(info.label, 6, y)
          } else if (scaledGridSizeY >= 13) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
            ctx.globalAlpha = 0.55
            ctx.fillText(info.label, 6, y)
          } else if (scaledGridSizeY >= 9 && edo === 53) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
            ctx.globalAlpha = 0.4
            ctx.font = `500 ${Math.max(6.5, fontSize * 0.9)}px monospace`
            ctx.fillText(`\\${info.stepInOctave}`, 6, y)
          }
        }

        const customRows = storeState.customSynthRows.filter(r => r.trackId === targetTrackId)
        customRows.forEach(row => {
          const y = scaledTimelineHeight + getPitchY(row.pitch) * (scaledGridSizeY/gridSizeY) + scaledGridSizeY / 2
          ctx.fillStyle = '#20c997'
          ctx.globalAlpha = 0.9
          ctx.fillText(row.name, 8, y)
        })
      } else {
        const transpose = currentTrack?.transpose ?? 0
        const noteNames = scaleLock.accidental === 'sharp' ? NOTE_NAMES_SHARP : NOTE_NAMES_FLAT
        for (let i = 0; i < numRows; i++) {
          const pitch = getPitchFromIndex(i)
          const soundingPitch = Math.round((pitch + transpose) * 1000) / 1000
          const pc = ((Math.round(soundingPitch) % 12) + 12) % 12
          const noteName = noteNames[pc] + Math.floor((soundingPitch + 0.001) / 12 - 1)
          const y = scaledTimelineHeight + i * scaledGridSizeY + scaledGridSizeY / 2
          const rowTopY = scaledTimelineHeight + i * scaledGridSizeY
          const isBlack = noteName.includes('#') || noteName.includes('b')
          const isC = pc === 0

          // Reset alpha so row fills don't inherit the previous row's text alpha
          ctx.globalAlpha = 1.0

          // Piano key styling
          if (isBlack) {
            ctx.fillStyle = '#14141d'
            ctx.fillRect(0, rowTopY, LABEL_WIDTH, scaledGridSizeY)
            ctx.fillStyle = '#222232'
            ctx.fillRect(0, rowTopY + 2, LABEL_WIDTH * 0.62, scaledGridSizeY - 4)
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
            ctx.strokeRect(0, rowTopY + 2, LABEL_WIDTH * 0.62, scaledGridSizeY - 4)
          } else {
            ctx.fillStyle = isC ? 'rgba(0, 230, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)'
            ctx.fillRect(0, rowTopY, LABEL_WIDTH, scaledGridSizeY)
          }

          // Key separator border
          ctx.strokeStyle = isC ? 'rgba(0, 230, 255, 0.45)' : (isBlack ? 'rgba(40, 40, 50, 0.6)' : 'rgba(255, 255, 255, 0.12)')
          ctx.lineWidth = isC ? 1.5 : 1
          ctx.beginPath()
          ctx.moveTo(0, rowTopY + scaledGridSizeY)
          ctx.lineTo(LABEL_WIDTH, rowTopY + scaledGridSizeY)
          ctx.stroke()

          // Key text
          if (scaleFoldEnabled) {
            const degree = detectScaleDegree(soundingPitch, scaleLock.root, scaleLock.mode)
            const isRoot = ((soundingPitch - scaleLock.root + 1200) % 12) === 0
            if (isRoot) {
              ctx.fillStyle = '#00e6ff'
              ctx.globalAlpha = 1.0
            } else {
              ctx.fillStyle = 'rgba(255,255,255,0.85)'
              ctx.globalAlpha = 0.85
            }
            ctx.fillText(`${noteName} ${degree ? `(${degree})` : ''}`, 8, y)
          } else {
            if (isC) {
              ctx.fillStyle = '#00e6ff'
              ctx.font = 'bold 11px Inter, sans-serif'
              ctx.globalAlpha = 1.0
            } else if (!isBlack) {
              ctx.fillStyle = 'rgba(255,255,255,0.9)'
              ctx.font = '600 11px Inter, sans-serif'
              ctx.globalAlpha = 0.9
            } else {
              ctx.fillStyle = 'rgba(255,255,255,0.5)'
              ctx.font = '500 10.5px Inter, sans-serif'
              ctx.globalAlpha = 0.6
            }
            ctx.fillText(noteName, isBlack ? 10 : 8, y)
          }
        }

        const customRows = storeState.customSynthRows.filter(r => r.trackId === targetTrackId)
        customRows.forEach(row => {
          const y = scaledTimelineHeight + getPitchY(row.pitch) * (scaledGridSizeY/gridSizeY) + scaledGridSizeY / 2
          ctx.fillStyle = '#20c997'
          ctx.globalAlpha = 0.9
          ctx.fillText(row.name, 8, y)
        })
      }
      ctx.restore()

      animationFrameId = requestAnimationFrame(render)
    }
    render()

    return () => cancelAnimationFrame(animationFrameId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentTracks.length, targetTrackId, instrument, isDrum, numRows, gridSizeY, getColumns, loopEnabled, loopStart, loopEnd, scaleLock, scaleFoldEnabled, isReadOnly, activeTrackTargetTempo, isMicroEdo, edo, stepSize])

  // AUTOMATION RENDER LOOP
  useEffect(() => {
    if (!showAutomation) return
    if (!automationCanvasRef.current || !editTrack) return
    const canvas = automationCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let lastWidth = 0
    let lastHeight = 0

    const render = () => {
      const { pan, zoom } = stateRef.current
      const storeState = useStore.getState()
      const isTrackHidden = storeState.tracks.find(t => t.id === targetTrackId)?.hidden
      const notes = isTrackHidden ? [] : storeState.notes.filter(n => n.trackId === targetTrackId)
      const laneTarget = storeState.automationTargets[targetTrackId] ?? 'velocity'
      const points = sortAutomationPoints(getTrackAutomationPoints(storeState.automationCurves, targetTrackId, laneTarget))

      // Measure directly from the canvas DOM element — always accurate
      const canvasWidth = canvas.clientWidth
      const canvasHeight = canvas.clientHeight
      const effectivePanX = (storeState.playheadFollowMode === 'grid' && !isHorizScrollLocked)
        ? getPlayheadAnchorX(canvasWidth) - storeState.playheadPosition * zoom
        : pan.x
      if (canvasWidth <= 0 || canvasHeight <= 0) {
        animationFrameId = requestAnimationFrame(render)
        return
      }

      const dpr = window.devicePixelRatio || 1

      // Only resize pixel buffer when dimensions actually change — prevents transform accumulation
      if (Math.abs(canvasWidth - lastWidth) > 0.5 || Math.abs(canvasHeight - lastHeight) > 0.5) {
        canvas.width = Math.round(canvasWidth * dpr)
        canvas.height = Math.round(canvasHeight * dpr)
        lastWidth = canvasWidth
        lastHeight = canvasHeight
      }

      // Always reset transform before drawing — never accumulate
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvasWidth, canvasHeight)

      ctx.fillStyle = '#15151c'
      ctx.fillRect(0, 0, canvasWidth, canvasHeight)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      for (let i = 1; i < 4; i += 1) {
        const y = (canvasHeight / 4) * i
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(canvasWidth, y)
        ctx.stroke()
      }

      ctx.save()
      ctx.translate(effectivePanX + SIDEBAR_WIDTH, 0)
      ctx.scale(zoom, 1)

      notes.forEach(note => {
        if (laneTarget !== 'velocity') return
        const x = tickToX(note.time + note.duration / 2)
        const targetY = canvasHeight - (note.velocity / 127) * canvasHeight

        const trackWidth = 2 / zoom // Match the thin UI sliders
        const handleRadius = 5 / zoom
        const trackColor = editTrack.color || '#4dabf7'

        // 1. Full Slider Track (Unfilled part)
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, targetY)
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.lineWidth = trackWidth
        ctx.stroke()

        // 2. Filled Part (Below Handle - Vibrant)
        ctx.beginPath()
        ctx.moveTo(x, canvasHeight)
        ctx.lineTo(x, targetY)
        ctx.strokeStyle = trackColor
        ctx.lineWidth = trackWidth
        ctx.stroke()

        // 3. Industrial Thumb (The "Exact Match")
        // White Thumb
        ctx.beginPath()
        ctx.arc(x, targetY, handleRadius, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()

        // Track-colored border
        ctx.strokeStyle = trackColor
        ctx.lineWidth = 2 / zoom
        ctx.stroke()

        // Subtle glow to match premium UI
        ctx.shadowBlur = 6 / zoom
        ctx.shadowColor = trackColor + '44'
        ctx.stroke()
        ctx.shadowBlur = 0
      })

      const maxTick = Math.max(
        768,
        ...notes.map(note => note.time + note.duration),
        ...points.map(point => point.time),
      )

      const formulaLane = storeState.automationLanes?.[targetTrackId]
      if (points.length === 0 && formulaLane?.source !== 'formula') {
        // The dashed baseline is the value the lane holds when untouched: the old 100
        // default for velocity, unity gain for volume, dead centre for pan, mid-range for
        // an expression parameter (whose neutral is each note's own value).
        const baselineValue = parseAutomationTarget(laneTarget)?.kind === 'expr'
          ? 64
          : laneNeutralValue(laneTarget, 100)
        ctx.beginPath()
        ctx.moveTo(0, canvasHeight - (baselineValue / 127) * canvasHeight)
        ctx.lineTo(tickToX(maxTick), canvasHeight - (baselineValue / 127) * canvasHeight)
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 1 / zoom
        ctx.setLineDash([5 / zoom, 5 / zoom])
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.beginPath()
        const step = Math.max(4, 8 / zoom)
        for (let tick = 0; tick <= maxTick; tick += step) {
          const velocity = getLaneValueAtTick({
            points,
            lane: formulaLane,
            target: laneTarget,
            tick,
            fallback: 100,
            bpm: storeState.bpm,
          })
          const y = canvasHeight - (velocity / 127) * canvasHeight
          const x = tickToX(tick)
          if (tick === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = editTrack.color || '#4dabf7'
        ctx.lineWidth = 2 / zoom
        ctx.stroke()

        points.forEach(point => {
          const x = tickToX(point.time)
          const y = canvasHeight - (point.value / 127) * canvasHeight
          const radius = point.id === dragAutomationPointId ? 7 / zoom : 5 / zoom

          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fillStyle = point.id === dragAutomationPointId ? '#ffffff' : (editTrack.color || '#4dabf7')
          ctx.fill()
          ctx.strokeStyle = '#111'
          ctx.lineWidth = 2 / zoom
          ctx.stroke()
        })
      }

      const playheadX = tickToX(storeState.playheadPosition)
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, canvasHeight)
      ctx.strokeStyle = 'rgba(255, 51, 102, 0.7)'
      ctx.lineWidth = 1.5 / zoom
      ctx.stroke()

      ctx.restore()

      // Solid sidebar blocker for the automation lane
      ctx.fillStyle = '#1a1a24' // Matches left label sidebar background
      ctx.fillRect(0, 0, SIDEBAR_WIDTH, canvasHeight)

      // Right border of panel
      ctx.strokeStyle = '#333'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(SIDEBAR_WIDTH, 0)
      ctx.lineTo(SIDEBAR_WIDTH, canvasHeight)
      ctx.stroke()

      // Draw the lane's own target name in the sidebar blocker
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = '600 11px Inter, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(laneTargetLabel(laneTarget), 8, canvasHeight / 2)

      animationFrameId = requestAnimationFrame(render)
    }
    render()

    return () => cancelAnimationFrame(animationFrameId)
  }, [showAutomation, editTrack, targetTrackId, dragAutomationPointId, isHorizScrollLocked, tickToX])

  // --- Note Selection Actions & DAW Controls ---
  const selectedNotesList = useMemo(() => allNotes.filter(n => selectedNoteIds.includes(n.id)), [allNotes, selectedNoteIds])
  const mutedCount = useMemo(() => selectedNotesList.filter(n => n.muted).length, [selectedNotesList])
  const allSelectedNotesMuted = useMemo(() => selectedNotesList.length > 0 && mutedCount === selectedNotesList.length, [selectedNotesList, mutedCount])
  const hasMixedMuteState = useMemo(() => mutedCount > 0 && mutedCount < selectedNotesList.length, [mutedCount, selectedNotesList])

  const handleMuteSelectedNotes = (targetMute: boolean) => {
    if (selectedNoteIds.length === 0) return
    useStore.getState().commitHistory()
    useStore.getState().updateNotes(selectedNoteIds, { muted: targetMute })
    useStore.getState().showToast(
      targetMute
        ? `Muted ${selectedNoteIds.length} note${selectedNoteIds.length === 1 ? '' : 's'}`
        : `Unmuted ${selectedNoteIds.length} note${selectedNoteIds.length === 1 ? '' : 's'}`,
      'info'
    )
    setContextMenu(null)
  }

  const handleToggleMuteSelectedNotes = () => {
    handleMuteSelectedNotes(!allSelectedNotesMuted)
  }

  const handleCopyNotes = () => {
    if (selectedNotesList.length === 0) return
    useStore.getState().setClipboard(selectedNotesList)
    useStore.getState().showToast(`Copied ${selectedNotesList.length} note${selectedNotesList.length === 1 ? '' : 's'}`, 'info')
    setContextMenu(null)
  }

  const handleCutNotes = () => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    const store = useStore.getState()
    store.commitHistory()
    store.setClipboard(selectedNotesList)
    selectedNoteIds.forEach(id => removeNote(id))
    setSelectedNoteIds([])
    store.showToast(`Cut ${selectedNotesList.length} note${selectedNotesList.length === 1 ? '' : 's'}`, 'info')
    setContextMenu(null)
  }

  const handlePasteNotes = (targetTick?: number) => {
    const store = useStore.getState()
    const clipboard = store.clipboard
    if (isReadOnly || !targetTrackId || clipboard.length === 0) return
    store.commitHistory()
    const minTime = Math.min(...clipboard.map(n => n.time))
    const pasteTick = targetTick !== undefined ? targetTick : store.playheadPosition
    const offset = pasteTick - minTime
    const newSelectedIds: string[] = []
    clipboard.forEach(note => {
      const id = Math.random().toString(36).substr(2, 9)
      newSelectedIds.push(id)
      addNote({ ...note, id, trackId: targetTrackId, time: Math.max(0, note.time + offset) })
    })
    setSelectedNoteIds(newSelectedIds)
    store.showToast(`Pasted ${clipboard.length} note${clipboard.length === 1 ? '' : 's'}`, 'info')
    setContextMenu(null)
  }

  const handleDuplicateSelectedNotes = () => {
    if (selectedNotesList.length === 0 || !targetTrackId || isReadOnly) return
    const store = useStore.getState()
    store.commitHistory()
    const minTime = Math.min(...selectedNotesList.map(n => n.time))
    const maxEndTime = Math.max(...selectedNotesList.map(n => n.time + n.duration))
    const span = maxEndTime - minTime
    const offset = Math.max(snapResolution || 48, span)
    const newSelectedIds: string[] = []
    selectedNotesList.forEach(note => {
      const id = Math.random().toString(36).substr(2, 9)
      newSelectedIds.push(id)
      addNote({ ...note, id, trackId: targetTrackId, time: note.time + offset })
    })
    setSelectedNoteIds(newSelectedIds)
    store.showToast(`Duplicated ${selectedNotesList.length} note${selectedNotesList.length === 1 ? '' : 's'}`, 'info')
    setContextMenu(null)
  }

  const handleQuantizeSelectedNotes = () => {
    if (selectedNoteIds.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    useStore.getState().quantizeSelectedNotes()
    useStore.getState().showToast('Quantized selected notes', 'info')
    setContextMenu(null)
  }

  const handleTransposeSelectedNotes = (semitones: number) => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const byId = new Map(applyTranspose(selectedNotesList, semitones).map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    useStore.getState().showToast(`Transposed ${semitones > 0 ? '+' : ''}${semitones} semitone${Math.abs(semitones) === 1 ? '' : 's'}`, 'info')
    setContextMenu(null)
  }

  const handleLegatoSelectedNotes = () => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const byId = new Map(applyLegato(selectedNotesList).map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    useStore.getState().showToast('Legato applied', 'info')
    setContextMenu(null)
  }

  const handleGlueSelectedNotes = () => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const targetIdSet = new Set(selectedNotesList.map(n => n.id))
    const remaining = useStore.getState().notes.filter(n => !targetIdSet.has(n.id))
    const glued = applyGlue(selectedNotesList)
    useStore.setState({ notes: [...remaining, ...glued] })
    setSelectedNoteIds(glued.map(n => n.id))
    useStore.getState().showToast('Glue applied', 'info')
    setContextMenu(null)
  }

  const handleStrumSelectedNotes = () => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const byId = new Map(applyStrum(selectedNotesList).map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    useStore.getState().showToast('Strum applied', 'info')
    setContextMenu(null)
  }

  const handleChopSelectedNotes = (pattern: '1/16' | '1/8' | '1/32' = '1/16') => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const targetIdSet = new Set(selectedNotesList.map(n => n.id))
    const remaining = useStore.getState().notes.filter(n => !targetIdSet.has(n.id))
    const chopped = applyChop(selectedNotesList, { pattern })
    useStore.setState({ notes: [...remaining, ...chopped] })
    setSelectedNoteIds(chopped.map(n => n.id))
    useStore.getState().showToast(`Chop (${pattern}) applied`, 'info')
    setContextMenu(null)
  }

  const handleHumanizeSelectedNotes = () => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const byId = new Map(applyHumanize(selectedNotesList).map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    useStore.getState().showToast('Humanize applied', 'info')
    setContextMenu(null)
  }

  const handleReverseSelectedNotes = () => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const byId = new Map(applyFlipHorizontal(selectedNotesList).map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    useStore.getState().showToast('Reverse (time) applied', 'info')
    setContextMenu(null)
  }

  const handleInvertPitchSelectedNotes = () => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const byId = new Map(applyFlipVertical(selectedNotesList).map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    useStore.getState().showToast('Invert (pitch) applied', 'info')
    setContextMenu(null)
  }

  const handleSetVelocitySelectedNotes = (vel: number) => {
    if (selectedNoteIds.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    useStore.getState().updateNotes(selectedNoteIds, { velocity: vel, velocityInspectorModified: true })
    useStore.getState().showToast(`Velocity set to ${vel}`, 'info')
    setContextMenu(null)
  }

  const handleNudgeSelectedNotes = (direction: 'left' | 'right') => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const step = snapResolution || 48
    const ticks = direction === 'left' ? -step : step
    const byId = new Map(applyMicroNudge(selectedNotesList, ticks).map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    useStore.getState().showToast(`Nudged ${direction} (${ticks > 0 ? '+' : ''}${ticks} ticks)`, 'info')
    setContextMenu(null)
  }

  const handleVelocityRampSelectedNotes = (direction: 'crescendo' | 'decrescendo') => {
    if (selectedNotesList.length === 0 || isReadOnly) return
    useStore.getState().commitHistory()
    const startVelocity = direction === 'crescendo' ? 36 : 124
    const endVelocity = direction === 'crescendo' ? 124 : 36
    const byId = new Map(applyVelocityRamp(selectedNotesList, { startVelocity, endVelocity, curve: 'linear' }).map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    useStore.getState().showToast(`${direction === 'crescendo' ? 'Crescendo (ramp up)' : 'Decrescendo (ramp down)'} applied`, 'info')
    setContextMenu(null)
  }

  const handleInvertTrackSelection = () => {
    if (!targetTrackId) return
    const trackNotes = allNotes.filter(n => n.trackId === targetTrackId)
    const currentSet = new Set(selectedNoteIds)
    const inverted = trackNotes.filter(n => !currentSet.has(n.id)).map(n => n.id)
    setSelectedNoteIds(inverted)
    useStore.getState().showToast(`Inverted selection (${inverted.length} note${inverted.length === 1 ? '' : 's'})`, 'info')
    setContextMenu(null)
  }

  const handleCreateNewTrackFromSelection = () => {
    if (selectedNoteIds.length === 0) return
    const selectedNotes = allNotes.filter(n => selectedNoteIds.includes(n.id))
    if (selectedNotes.length === 0) return

    useStore.getState().commitHistory()

    const newTrackId = `track_${newId()}`
    const currentTrack = tracks.find(t => t.id === targetTrackId)
    const name = currentTrack ? `${currentTrack.name} (Copy)` : (instrument === 'synth' ? 'New Synth' : 'Drum Machine')
    const color = TRACK_COLORS[tracks.length % TRACK_COLORS.length]

    const newTrack = {
      id: newTrackId,
      name,
      instrument,
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      color,
      collapsed: true,
      synthPreset: instrument === 'synth' ? DEFAULT_SYNTH_PRESET : undefined,
      drumKit: instrument === 'drum' ? DEFAULT_DRUM_KIT : undefined,
      delayTime: 0.25,
      delayFeedback: 0.25,
    }

    addTrack(newTrack)
    audioEngine.createInstrument(newTrackId, instrument)

    selectedNotes.forEach(note => {
      updateNote(note.id, { trackId: newTrackId })
    })

    setSelectedNoteIds([])
    setContextMenu(null)
  }

  const handleCreateSubtrackFromSelection = (parentId: string) => {
    if (selectedNoteIds.length === 0) return
    const selectedNotes = allNotes.filter(n => selectedNoteIds.includes(n.id))
    if (selectedNotes.length === 0) return

    const parentTrack = tracks.find(t => t.id === parentId)
    if (!parentTrack) return

    useStore.getState().commitHistory()

    const newTrackId = `track_${newId()}`
    const name = `${parentTrack.name} Layer`

    const newTrack = {
      id: newTrackId,
      name,
      instrument,
      volume: 0.8,
      pan: 0,
      muted: false,
      soloed: false,
      color: parentTrack.color,
      collapsed: true,
      parentId,
      synthPreset: instrument === 'synth' ? DEFAULT_SYNTH_PRESET : undefined,
      drumKit: instrument === 'drum' ? DEFAULT_DRUM_KIT : undefined,
      delayTime: 0.25,
      delayFeedback: 0.25,
    }

    addTrack(newTrack)
    audioEngine.createInstrument(newTrackId, instrument)

    selectedNotes.forEach(note => {
      updateNote(note.id, { trackId: newTrackId })
    })

    setSelectedNoteIds([])
    setContextMenu(null)
  }

  const handleDeleteSelectedNotes = () => {
    if (selectedNoteIds.length === 0) return
    useStore.getState().commitHistory()
    selectedNoteIds.forEach(id => removeNote(id))
    setSelectedNoteIds([])
    setContextMenu(null)
  }

  const handleApplyGlideChain = () => {
    const state = useStore.getState()
    const selected = state.notes.filter(n => selectedNoteIds.includes(n.id) &&
      state.tracks.find(t => t.id === n.trackId)?.instrument !== 'drum')
    if (selected.length < 2) {
      state.showToast('Select at least two synth notes to link', 'error')
      setContextMenu(null)
      return
    }
    state.commitHistory()
    const updated = applyGlideChain(selected, glideMenu)
    const byId = new Map(updated.map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    const linked = updated.filter(n => n.glideToNoteId).length
    state.showToast(`Glide chain: ${linked} link${linked === 1 ? '' : 's'} created`, 'success')
    setContextMenu(null)
  }

  const handleClearGlideChain = () => {
    const state = useStore.getState()
    const selected = state.notes.filter(n => selectedNoteIds.includes(n.id))
    if (selected.length === 0) return
    state.commitHistory()
    const updated = clearNoteGlides(selected)
    const byId = new Map(updated.map(n => [n.id, n]))
    useStore.setState(s => ({ notes: s.notes.map(n => byId.get(n.id) ?? n) }))
    state.showToast('Glide chain cleared', 'success')
    setContextMenu(null)
  }

  const glideCandidateCount = useMemo(() => {
    const drumTrackIds = new Set(tracks.filter(t => t.instrument === 'drum').map(t => t.id))
    return allNotes.filter(n => selectedNoteIds.includes(n.id) && !drumTrackIds.has(n.trackId)).length
  }, [allNotes, selectedNoteIds, tracks])

  const renderGlideChip = (label: string, active: boolean, onClick: () => void, title?: string) => (
    <button
      title={title}
      onClick={onClick}
      style={{
        padding: '4px 7px',
        borderRadius: '4px',
        border: `1px solid ${active ? 'rgba(218,119,242,0.45)' : 'rgba(255,255,255,0.07)'}`,
        background: active ? 'rgba(218,119,242,0.16)' : 'rgba(255,255,255,0.03)',
        color: active ? '#da77f2' : '#8a8a95',
        fontSize: '9px',
        fontWeight: 700,
        cursor: 'pointer',
        lineHeight: 1.2,
        whiteSpace: 'nowrap'
      }}
    >
      {label}
    </button>
  )

  const glideGroupLabel = (text: string) => (
    <div style={{ fontSize: '8px', fontWeight: 800, color: '#666', letterSpacing: '0.06em', marginBottom: '4px' }}>{text}</div>
  )

  const renderParentTracksSelectionTree = () => {
    const rootTracks = tracks.filter(t => !t.parentId)

    if (rootTracks.length === 0) {
      return (
        <div style={{ padding: '12px', textAlign: 'center', fontSize: '10px', color: '#555' }}>
          No parent tracks available
        </div>
      )
    }

    return rootTracks.map(parent => {
      const children = tracks.filter(t => t.parentId === parent.id)
      return (
        <div key={parent.id} style={{ display: 'flex', flexDirection: 'column' }}>
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              width: '100%',
              padding: '6px 12px',
              background: 'none',
              border: 'none',
              color: '#eee',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '11px',
              fontWeight: 500
            }}
            onClick={() => handleCreateSubtrackFromSelection(parent.id)}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: parent.color }} />
            {parent.instrument === 'synth' ? <IconMusic size={11} style={{ opacity: 0.7 }} /> : <IconDrum size={11} style={{ opacity: 0.7 }} />}
            {parent.name}
          </button>

          {children.map(child => (
            <div key={child.id} style={{ paddingLeft: '22px', position: 'relative', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: '10px', top: '-6px', bottom: '15px', width: '2px', background: `${child.color}33`, borderRadius: '1px' }} />
              <div style={{ position: 'absolute', left: '10px', top: '10px', width: '10px', height: '2px', background: `${child.color}33`, borderRadius: '1px' }} />
              
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  width: '100%',
                  padding: '4px 12px',
                  color: '#555',
                  fontSize: '10px',
                  fontWeight: 500,
                  userSelect: 'none'
                }}
              >
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: child.color, opacity: 0.4 }} />
                {child.instrument === 'synth' ? <IconMusic size={9} style={{ opacity: 0.4 }} /> : <IconDrum size={9} style={{ opacity: 0.4 }} />}
                {child.name} (Subtrack)
              </div>
            </div>
          ))}
        </div>
      )
    })
  }

  // --- Interaction Logic ---
  const commitDragExportRegion = (e: React.PointerEvent<any>, xVal: number) => {
    const xTick = xToTick(xVal)
    let finalStart = Math.min(dragStartValue, xTick)
    let finalEnd = Math.max(dragStartValue, xTick)

    if (Math.abs(finalEnd - finalStart) > 5) {
      const { snapEnabled, snapResolution } = useStore.getState()
      if (snapEnabled) {
        finalStart = Math.round(finalStart / snapResolution) * snapResolution
        finalEnd = Math.round(finalEnd / snapResolution) * snapResolution
      } else {
        finalStart = Math.round(finalStart)
        finalEnd = Math.round(finalEnd)
      }
      finalStart = Math.max(0, finalStart)

      // Snap to notes (no notes cut in between)
      const overlappingNotes = notes.filter(n => {
        const noteStart = n.time
        const noteEnd = n.time + n.duration
        return noteStart < finalEnd && noteEnd > finalStart
      })

      if (overlappingNotes.length > 0) {
        const minNoteStart = Math.min(...overlappingNotes.map(n => n.time))
        const maxNoteEnd = Math.max(...overlappingNotes.map(n => n.time + n.duration))
        finalStart = Math.min(finalStart, minNoteStart)
        finalEnd = Math.max(finalEnd, maxNoteEnd)
      }

      const newRegion = {
        id: Math.random().toString(36).substr(2, 9),
        startTick: finalStart,
        endTick: finalEnd,
        gap: 0
      }

      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        addExportRegion(newRegion)
      } else {
        setExportRegions([newRegion])
      }
    }
    setActiveDragRegion(null)
  }

  const handleTimelinePointerDown = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!targetTrackId) return
    // e.currentTarget is nulled once dispatch ends, so hold the node before awaiting.
    const canvasEl = e.currentTarget
    if (Tone.context.state !== 'running') {
      await Tone.start()
    }

    const rect = canvasEl.getBoundingClientRect()
    const rawX = e.clientX - rect.left
    const x = getWorldXFromPointer(e.clientX, rect)

    if (exportRegionMode) {
      if (e.button === 2) {
        const clickTick = Math.max(0, Math.floor(xToTick(x)))
        const clickedRegion = exportRegions.find(r => clickTick >= r.startTick && clickTick <= r.endTick)
        if (clickedRegion) {
          removeExportRegion(clickedRegion.id)
          e.preventDefault()
          e.stopPropagation()
          return
        }
      } else if (e.button === 0) {
        canvasEl.setPointerCapture(e.pointerId)
        setDragMode('draw_export_region')
        setDragStartPos({ x: rawX, y: 0 })
        setDragStartValue(xToTick(x))
        setActiveDragRegion({ startTick: xToTick(x), endTick: xToTick(x) })
        return
      }
    }
    const resizeCol = findResizableColumn(x)

    canvasEl.setPointerCapture(e.pointerId)
    if (resizeCol) {
      setDragMode('resize_column')
      setDragTargetCol(resizeCol.index)
      setDragStartPos({ x: rawX, y: 0 })
      setDragStartValue(resizeCol.width)
      return
    }

    // Check for loop boundary dragging
    const { loopEnabled, loopStart, loopEnd } = useStore.getState()
    if (loopEnabled) {
      const startX = tickToX(loopStart)
      const endX = tickToX(loopEnd)
      const threshold = 10 / zoom
      if (Math.abs(x - startX) < threshold) {
        setDragMode('adjust_loop_start')
        setDragStartPos({ x: rawX, y: 0 })
        setDragStartValue(loopStart)
        return
      }
      if (Math.abs(x - endX) < threshold) {
        setDragMode('adjust_loop_end')
        setDragStartPos({ x: rawX, y: 0 })
        setDragStartValue(loopEnd)
        return
      }
    }

    const rawTick = xToTick(x)
    const startTick = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)

    if (e.button === 2) {
      canvasEl.setPointerCapture(e.pointerId)
      timelineDragStateRef.current = {
        startX: x,
        startClientX: e.clientX,
        startTick,
        isRight: true
      }
      return
    }

    if (e.button === 0) {
      canvasEl.setPointerCapture(e.pointerId)
      timelineDragStateRef.current = {
        startX: x,
        startClientX: e.clientX,
        startTick,
        isRight: false
      }
      if (e.ctrlKey || e.shiftKey) {
        setDragMode('draw_timeline_range')
        setTimelineRangeStart(startTick)
        setTimelineSelection({ startTick, endTick: startTick, trackId: targetTrackId })
        return
      }

      setDragMode('scrub_playhead')
      setPlayheadFromWorldX(x)
      return
    }
  }

  const handleTimelinePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rawX = e.clientX - rect.left
    const x = getWorldXFromPointer(e.clientX, rect)

    if (dragMode === 'none') {
      const resizeCol = findResizableColumn(x)
      if (resizeCol) {
        e.currentTarget.style.cursor = 'col-resize'
        return
      }

      const { loopEnabled, loopStart, loopEnd } = useStore.getState()
      if (loopEnabled) {
        const threshold = 10 / zoom
        if (Math.abs(x - loopStart) < threshold || Math.abs(x - loopEnd) < threshold) {
          e.currentTarget.style.cursor = 'col-resize'
          return
        }
      }

      e.currentTarget.style.cursor = 'ew-resize'
      return
    }

    // Auto-transition to timeline range selection when dragging horizontally on ruler
    if (timelineDragStateRef.current && (dragMode === 'scrub_playhead' || timelineDragStateRef.current.isRight)) {
      const dist = Math.abs(e.clientX - timelineDragStateRef.current.startClientX)
      if (dist >= 5) {
        setDragMode('draw_timeline_range')
        const sTick = timelineDragStateRef.current.startTick
        setTimelineRangeStart(sTick)
        const rawTick = xToTick(x)
        const curTick = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
        setTimelineSelection({ startTick: sTick, endTick: curTick, trackId: targetTrackId })
        e.currentTarget.style.cursor = 'crosshair'
        return
      }
    }

    if (dragMode === 'draw_timeline_range' && timelineRangeStart !== null) {
      e.currentTarget.style.cursor = 'crosshair'
      const rawTick = xToTick(x)
      const curTick = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
      setTimelineSelection({ startTick: timelineRangeStart, endTick: curTick, trackId: targetTrackId })
      return
    }

    if (dragMode === 'resize_column' && dragTargetCol !== null) {
      e.currentTarget.style.cursor = 'col-resize'
      const dx = (rawX - dragStartPos.x) / zoom
      setColumnWidth(dragTargetCol, Math.max(12, Math.floor(dragStartValue + dx)))
      return
    }

    if (dragMode === 'draw_export_region') {
      e.currentTarget.style.cursor = 'crosshair'
      setActiveDragRegion({ startTick: dragStartValue, endTick: xToTick(x) })
    } else if (dragMode === 'scrub_playhead') {
      e.currentTarget.style.cursor = 'ew-resize'
      setPlayheadFromWorldX(x)
    } else if (dragMode === 'adjust_loop_start') {
      const { snapEnabled, snapResolution, setLoopStart, loopEnd } = useStore.getState()
      const rawTick = xToTick(x)
      const newStart = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
      setLoopStart(Math.max(0, Math.min(loopEnd - 48, newStart)))
    } else if (dragMode === 'adjust_loop_end') {
      const { snapEnabled, snapResolution, setLoopEnd, loopStart } = useStore.getState()
      const rawTick = xToTick(x)
      const newEnd = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
      setLoopEnd(Math.max(loopStart + 48, newEnd))
    }
  }

  const handleTimelinePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = getWorldXFromPointer(e.clientX, rect)
    if (dragMode === 'draw_export_region') {
      commitDragExportRegion(e, x)
    }

    if (dragMode === 'draw_timeline_range') {
      const currentSel = useStore.getState().timelineSelection
      if (currentSel && Math.abs(currentSel.endTick - currentSel.startTick) < (snapEnabled ? Math.max(6, snapResolution / 4) : 6)) {
        setTimelineSelection(null)
      }
      setTimelineRangeStart(null)
      setDragMode('none')
      timelineDragStateRef.current = null
      return
    }

    if (timelineDragStateRef.current?.isRight) {
      const clickTick = Math.max(0, Math.round(xToTick(x)))
      const currentSel = useStore.getState().timelineSelection
      if (currentSel) {
        const minT = Math.min(currentSel.startTick, currentSel.endTick)
        const maxT = Math.max(currentSel.startTick, currentSel.endTick)
        if (clickTick >= minT && clickTick <= maxT) {
          setContextMenu({ x: e.clientX, y: e.clientY, tick: clickTick, mode: 'timeline_range' })
          timelineDragStateRef.current = null
          setDragMode('none')
          return
        }
      }
      setPlayheadFromWorldX(x)
      setSelectedNoteIds([])
      setContextMenu({ x: e.clientX, y: e.clientY, tick: clickTick, mode: 'main' })
      timelineDragStateRef.current = null
      setDragMode('none')
      return
    }

    if (dragMode === 'scrub_playhead') {
      const currentSel = useStore.getState().timelineSelection
      if (currentSel) {
        const clickTick = Math.max(0, Math.round(xToTick(x)))
        const minT = Math.min(currentSel.startTick, currentSel.endTick)
        const maxT = Math.max(currentSel.startTick, currentSel.endTick)
        if (clickTick < minT || clickTick > maxT) {
          setTimelineSelection(null)
        }
      }
    }

    setDragMode('none')
    setDragTargetCol(null)
    timelineDragStateRef.current = null
    const { loopEnabled, loopStart, loopEnd } = useStore.getState()
    const threshold = 10 / zoom
    if (loopEnabled && (Math.abs(x - loopStart) < threshold || Math.abs(x - loopEnd) < threshold)) {
      e.currentTarget.style.cursor = 'col-resize'
    } else {
      e.currentTarget.style.cursor = 'ew-resize'
    }
  }

  const handlePointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    const { utilityPicker, setUtilityPicker, setUtilitySourcePitch, setUtilityTargetPitch, setUtilitySourceCol, setUtilityTargetCol } = useStore.getState()

    // e.currentTarget is nulled once dispatch ends, so hold the node before awaiting.
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const rawX = e.clientX - rect.left
    const rawY = e.clientY - rect.top
    const x = (rawX - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom
    const y = (rawY - pan.y) / zoom

    if (utilityPicker) {
      if (utilityPicker.type === 'row') {
        const gridY = y - TIMELINE_HEIGHT
        if (gridY >= 0) {
          const rowIdx = Math.floor(gridY / gridSizeY)
          const pitch = getPitchFromIndex(rowIdx)
          if (pitch >= 0 && pitch < numRows) {
            if (utilityPicker.slot === 'source') setUtilitySourcePitch(pitch)
            else setUtilityTargetPitch(pitch)
            setUtilityPicker(null)
          }
        }
      } else {
        const cols = getColumns()
        const col = cols.find(c => x >= c.x && x < c.x + c.width)
        if (col) {
          if (utilityPicker.slot === 'source') setUtilitySourceCol(col.index)
          else setUtilityTargetCol(col.index)
          setUtilityPicker(null)
        }
      }
      return
    }

    if (!targetTrackId) return

    // Ensure AudioContext is resumed on user interaction
    if (Tone.context.state !== 'running') {
      await Tone.start()
    }

    if (e.button === 1 || e.buttons === 4 || e.altKey) {
      setDragMode('pan')
      return
    }

    if (exportRegionMode) {
      if (e.button === 2) {
        const clickTick = Math.max(0, Math.floor(xToTick(x)))
        const clickedRegion = exportRegions.find(r => clickTick >= r.startTick && clickTick <= r.endTick)
        if (clickedRegion) {
          removeExportRegion(clickedRegion.id)
          e.preventDefault()
          e.stopPropagation()
          return
        }
      } else if (e.button === 0) {
        el.setPointerCapture(e.pointerId)
        setDragMode('draw_export_region')
        setDragStartPos({ x: rawX, y: rawY })
        setDragStartValue(xToTick(x))
        setActiveDragRegion({ startTick: xToTick(x), endTick: xToTick(x) })
        return
      }
    }

    if (y >= 0 && y <= TIMELINE_HEIGHT) {
      const resizeCol = findResizableColumn(x)

      if (resizeCol) {
        setDragMode('resize_column')
        setDragTargetCol(resizeCol.index)
        setDragStartPos({ x: rawX, y: rawY })
        setDragStartValue(resizeCol.width)
      } else {
        const { loopEnabled, loopStart, loopEnd } = useStore.getState()
        const threshold = 10 / zoom
        const loopStartX = tickToX(loopStart)
        const loopEndX = tickToX(loopEnd)
        if (loopEnabled && Math.abs(x - loopStartX) < threshold) {
          setDragMode('adjust_loop_start')
          setDragStartPos({ x: rawX, y: rawY })
          setDragStartValue(loopStart)
        } else if (loopEnabled && Math.abs(x - loopEndX) < threshold) {
          setDragMode('adjust_loop_end')
          setDragStartPos({ x: rawX, y: rawY })
          setDragStartValue(loopEnd)
        } else if (e.button === 2) {
          const clickTick = Math.max(0, Math.round(xToTick(x)))
          if (timelineSelection) {
            const minT = Math.min(timelineSelection.startTick, timelineSelection.endTick)
            const maxT = Math.max(timelineSelection.startTick, timelineSelection.endTick)
            if (clickTick >= minT && clickTick <= maxT) {
              setContextMenu({ x: e.clientX, y: e.clientY, tick: clickTick, mode: 'timeline_range' })
              return
            }
          }
          setPlayheadFromWorldX(x)
          setSelectedNoteIds([])
          setContextMenu({ x: e.clientX, y: e.clientY, tick: clickTick, mode: 'main' })
          return
        } else {
          el.setPointerCapture(e.pointerId)
          const rawTick = xToTick(x)
          const startTick = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
          gridTimelineDragRef.current = { startX: x, startClientX: e.clientX, startTick }

          if (e.ctrlKey || e.shiftKey) {
            setDragMode('draw_timeline_range')
            setTimelineRangeStart(startTick)
            setTimelineSelection({ startTick, endTick: startTick, trackId: targetTrackId })
          } else {
            setDragMode('scrub_playhead')
            setPlayheadFromWorldX(x)
          }
        }
      }
      return
    }

    if (rawX < SIDEBAR_WIDTH) {
      const gridY = y - TIMELINE_HEIGHT
      if (gridY >= 0) {
        const rowIdx = Math.floor(gridY / gridSizeY)
        const pitch = getPitchFromIndex(rowIdx)
        if (pitch >= lowestPitch - 0.01 && pitch <= highestPitch + 0.01) {
          const isMicro = !isDrum && (Math.abs(pitch - Math.round(pitch)) > 0.001 || (currentTrack?.edoDivision !== undefined && currentTrack.edoDivision !== 12))
          const sounding = pitch + (currentTrack?.transpose ?? 0)
          const noteSound = isDrum ? pitch : (isMicro ? Tone.Frequency(sounding, 'midi').toFrequency() : Tone.Frequency(sounding, 'midi').toNote())
          audioEngine.playNote(targetTrackId, isDrum ? 'drum' : 'synth', noteSound, '16n')
        }
      }
      return
    }

    const gridY = y - TIMELINE_HEIGHT
    if (gridY < 0) return

    let clickedNote = null
    let clickedResize = false
    let clickedResizeTop = false
    let clickedResizeBottom = false

    for (let i = editableNotes.length - 1; i >= 0; i--) {
      const n = editableNotes[i]
      const topPitch = n.pitchEnd !== undefined ? Math.max(n.pitch, n.pitchEnd) : n.pitch
      const bottomPitch = n.pitchEnd !== undefined ? Math.min(n.pitch, n.pitchEnd) : n.pitch
      const noteY = getPitchY(topPitch)
      const nTrack = trackMap.get(n.trackId)
      const isFromCurrentTrack = n.trackId === targetTrackId
      const nStep = isFromCurrentTrack ? stepSize : (nTrack?.instrument === 'drum' ? 1 : (nTrack?.edoDivision && nTrack.edoDivision !== 12 ? (12 / nTrack.edoDivision) : 1))
      const heightInPitch = (topPitch - bottomPitch) + nStep
      const noteH = Math.max(isMicroEdo ? 5 : 8, (heightInPitch / stepSize) * gridSizeY)
      
      if (gridY >= noteY && gridY <= noteY + noteH) {
        const noteXStart = tickToX(n.time)
        const noteXEnd = Math.max(noteXStart + 8 / zoom, tickToX(n.time + n.duration))
        if (x >= noteXStart && x <= noteXEnd) {
          clickedNote = n
          const edgeYDist = 6 / zoom
          if (!isDrum && !useStore.getState().pitchSnapEnabled) {
            if (gridY <= noteY + edgeYDist) clickedResizeTop = true
            else if (gridY >= noteY + noteH - edgeYDist) clickedResizeBottom = true
          }
          if (!clickedResizeTop && !clickedResizeBottom && x >= noteXEnd - 8 / zoom) {
            clickedResize = true
          }
          break
        }
      }
    }

    if (e.button === 2) {
      if (contextMenu) {
        setContextMenu(null)
      }
      const clickTick = Math.max(0, Math.round(xToTick(x)))
      if (timelineSelection) {
        const minT = Math.min(timelineSelection.startTick, timelineSelection.endTick)
        const maxT = Math.max(timelineSelection.startTick, timelineSelection.endTick)
        if (clickTick >= minT && clickTick <= maxT) {
          setContextMenu({ x: e.clientX, y: e.clientY, tick: clickTick, mode: 'timeline_range' })
          return
        }
      }
      if (clickedNote) {
        if (!selectedNoteIds.includes(clickedNote.id)) {
          setSelectedNoteIds([clickedNote.id])
        }
        setContextMenu({ x: e.clientX, y: e.clientY, tick: clickTick, mode: 'main' })
      } else {
        setSelectedNoteIds([])
        setContextMenu({ x: e.clientX, y: e.clientY, tick: clickTick, mode: 'main' })
      }
      return
    }

    if (e.button === 0) {
      el.setPointerCapture(e.pointerId)
      const activeTool = useStore.getState().activeTool
      const playheadPos = useStore.getState().playheadPosition

      // Allow grabbing the playhead from anywhere in the grid
      if (!clickedNote && Math.abs(x - tickToX(playheadPos)) < 15 / zoom) {
        setDragMode('scrub_playhead')
        return
      }

      // If stretch tool is active, check for handle hits first
      if (!isReadOnly && activeTool === 'stretch' && selectedNoteIds.length > 0) {
        const sel = editableNotes.filter(n => selectedNoteIds.includes(n.id))
        if (sel.length > 0) {
          const selLeft = tickToX(Math.min(...sel.map(n => n.time)))
          const selRight = tickToX(Math.max(...sel.map(n => n.time + n.duration)))
          const hw = 12 / zoom
          if (Math.abs(x - selLeft) < hw) {
            stretchStateRef.current = { anchor: Math.max(...sel.map(n => n.time + n.duration)), edge: Math.min(...sel.map(n => n.time)), notes: sel.map(n => ({ id: n.id, time: n.time, duration: n.duration })) }
            useStore.getState().commitHistory()
            setDragMode('stretch_left'); el.setPointerCapture(e.pointerId); return
          }
          if (Math.abs(x - selRight) < hw) {
            stretchStateRef.current = { anchor: Math.min(...sel.map(n => n.time)), edge: Math.max(...sel.map(n => n.time + n.duration)), notes: sel.map(n => ({ id: n.id, time: n.time, duration: n.duration })) }
            useStore.getState().commitHistory()
            setDragMode('stretch_right'); el.setPointerCapture(e.pointerId); return
          }
        }
      }

      if (!isReadOnly && !clickedNote && (e.ctrlKey || e.metaKey)) {
        setDragMode('draw_timeline_range')
        const rawTick = xToTick(x)
        const startTick = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
        setTimelineRangeStart(startTick)
        setTimelineSelection({ startTick, endTick: startTick, trackId: targetTrackId })
        return
      }

      if (!isReadOnly && (!clickedNote && (activeTool === 'select' || e.shiftKey))) {
        setDragMode('box_select')
        setBoxSelectStart({ x, y })
        setBoxSelectCurrent({ x, y })
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setSelectedNoteIds([])
        return
      }

      if (!isReadOnly && activeTool === 'erase') {
        if (clickedNote) {
          useStore.getState().commitHistory()
          removeNote(clickedNote.id)
        }
        return
      }

      if (!isReadOnly && activeTool === 'slice' && clickedNote) {
        // Split note at cursor X position
        const splitAt = Math.max(clickedNote.time + 1, Math.min(clickedNote.time + clickedNote.duration - 1, Math.round(xToTick(x))))
        const id1 = Math.random().toString(36).substr(2, 9)
        const id2 = Math.random().toString(36).substr(2, 9)
        useStore.getState().commitHistory()
        removeNote(clickedNote.id)
        addNote({ ...clickedNote, id: id1, duration: splitAt - clickedNote.time })
        addNote({ ...clickedNote, id: id2, time: splitAt, duration: clickedNote.time + clickedNote.duration - splitAt })
        return
      }

      if (!isReadOnly && clickedNote) {
        if (e.ctrlKey || e.metaKey) {
          if (selectedNoteIds.includes(clickedNote.id)) {
            setSelectedNoteIds(selectedNoteIds.filter(id => id !== clickedNote.id))
          } else {
            setSelectedNoteIds([...selectedNoteIds, clickedNote.id])
          }
          return
        }

        if (!selectedNoteIds.includes(clickedNote.id)) {
          wasAlreadySelectedRef.current = false
          setSelectedNoteIds([clickedNote.id])
          setDragStartSelectedNotes([{ id: clickedNote.id, time: clickedNote.time, pitch: clickedNote.pitch }])
        } else {
          wasAlreadySelectedRef.current = true
          setDragStartSelectedNotes(editableNotes.filter(n => selectedNoteIds.includes(n.id)).map(n => ({ id: n.id, time: n.time, pitch: n.pitch, pitchEnd: n.pitchEnd })))
        }
        setDragTargetId(clickedNote.id)
        setDragStartPos({ x: rawX, y: rawY })
        if (clickedResizeTop) {
          setDragMode('resize_note_top')
          setDragStartValueY(clickedNote.pitchEnd !== undefined ? Math.max(clickedNote.pitch, clickedNote.pitchEnd) : clickedNote.pitch)
        } else if (clickedResizeBottom) {
          setDragMode('resize_note_bottom')
          setDragStartValueY(clickedNote.pitchEnd !== undefined ? Math.min(clickedNote.pitch, clickedNote.pitchEnd) : clickedNote.pitch)
        } else if (clickedResize) {
          setDragMode('resize_note_right')
          setDragStartValue(clickedNote.duration)
        } else {
          setDragMode('move_note')
          setDragStartValue(clickedNote.time)
          setDragStartValueY(clickedNote.pitch)
        }
      } else if (!isReadOnly && activeTool === 'draw') {
        const { dropSnap: ds, snapResolution: sr } = useStore.getState()
        let snappedTime: number
        const snappedWidth: number = sr // Always use Quantize resolution for note length
        const tick = xToTick(x)

        if (ds) {
          snappedTime = Math.floor(Math.max(0, tick) / sr) * sr
        } else {
          // Free positioning when snap is off, but maintain the Quantize-defined length
          snappedTime = Math.max(0, Math.floor(tick))
        }

        const currentTargetBpm = currentTrack?.targetTempo ?? activeTrackTargetTempo
        const hasTrackBpmConflict = useStore.getState().notes.some(n => {
          if (n.time !== snappedTime) return false
          const noteTrack = useStore.getState().tracks.find(t => t.id === n.trackId)
          const noteTrackBpm = noteTrack?.targetTempo ?? useStore.getState().bpm
          return noteTrackBpm !== currentTargetBpm
        })

        if (hasTrackBpmConflict) {
          return // Column is locked due to track BPM conflict
        }

        let pitch = getYPitch(gridY)
        const { pitchDropSnap, scaleLock: sl } = useStore.getState()
        
        if (isDrum || pitchDropSnap) {
          pitch = getPitchFromIndex(Math.floor(gridY / gridSizeY))
        }

        if (!isDrum && !isMicroEdo && sl.enabled && pitchDropSnap) {
          pitch = snapToScale(pitch, sl.root, sl.mode, sl.customIntervals)
        }

        if (pitch >= lowestPitch - 0.01 && pitch <= highestPitch + 0.01) {
          const currentStamp = activeChordStamp
          let pitchesToInsert = [pitch]

          if (!isDrum && currentStamp) {
            if (currentStamp === 'triad') {
              pitchesToInsert = getDiatonicChord(pitch, sl.root, sl.mode, 'Triad', sl.customIntervals)
            } else if (currentStamp === 'seventh') {
              pitchesToInsert = getDiatonicChord(pitch, sl.root, sl.mode, 'Seventh', sl.customIntervals)
            } else {
              const stampDef = CHORD_STAMPS.find(s => s.id === currentStamp)
              if (stampDef) {
                pitchesToInsert = stampDef.intervals.map(iv => pitch + iv)
              }
            }
          }

          const validPitches = pitchesToInsert.filter(p => p >= lowestPitch - 0.01 && p <= highestPitch + 0.01)
          const newPitches = validPitches.filter(p => !notes.some(n => n.trackId === targetTrackId && n.time === snappedTime && n.pitch === p))

          if (newPitches.length > 0) {
            useStore.getState().commitHistory()
            newPitches.forEach((p, idx) => {
              const id = Math.random().toString(36).substr(2, 9)
              const vel = idx === 0 ? 100 : Math.max(75, 100 - idx * 4)
              addNote({ id, trackId: targetTrackId, time: snappedTime, duration: snappedWidth, pitch: p, velocity: vel, bpm: currentTargetBpm })
              if (editTrack) {
                setTimeout(() => {
                  let noteName: any = p
                  if (!isDrum) {
                    const isMicrotonal = Math.abs(p - Math.round(p)) > 0.001 || (editTrack.edoDivision !== undefined && editTrack.edoDivision !== 12)
                    const sounding = p + (editTrack.transpose ?? 0)
                    noteName = isMicrotonal ? Tone.Frequency(sounding, 'midi').toFrequency() : Tone.Frequency(sounding, 'midi').toNote()
                  }
                  audioEngine.playNote(targetTrackId, editTrack.instrument, noteName, '8n')
                }, idx * 16)
              }
            })
          }
        }
      }
    }
  }

  const handlePointerMove = (e: any) => {
    const rect = e.currentTarget instanceof HTMLElement ? e.currentTarget.getBoundingClientRect() : containerRef.current!.getBoundingClientRect()
    const rawX = (e as any).clientX - rect.left
    const rawY = (e as any).clientY - rect.top
    pointerRef.current = { rawX, rawY }
    const x = (rawX - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom
    const y = (rawY - pan.y) / zoom

    const { utilityPicker } = useStore.getState()
    if (utilityPicker) {
      setPickerHoverPos({ x, y })
      e.currentTarget.style.cursor = 'crosshair'
    } else {
      if (pickerHoverPos) setPickerHoverPos(null)
    }

    if (dragMode === 'none') {

      if (y >= 0 && y <= TIMELINE_HEIGHT) {
        const { loopEnabled, loopStart, loopEnd } = useStore.getState()
        const threshold = 10 / zoom
        const loopStartX = tickToX(loopStart)
        const loopEndX = tickToX(loopEnd)
        if (loopEnabled && (Math.abs(x - loopStartX) < threshold || Math.abs(x - loopEndX) < threshold)) {
          e.currentTarget.style.cursor = 'col-resize'
        } else {
          e.currentTarget.style.cursor = findResizableColumn(x) ? 'col-resize' : 'ew-resize'
        }
      } else if (Math.abs(x - tickToX(useStore.getState().playheadPosition)) < 15 / zoom) {
        e.currentTarget.style.cursor = 'ew-resize'
      } else {
        const activeTool = useStore.getState().activeTool
        e.currentTarget.style.cursor = isReadOnly ? 'default' : (activeTool === 'draw' ? 'crosshair' : (activeTool === 'erase' ? 'cell' : 'default'))
      }
      return
    }

    if (dragMode === 'pan') {
      if (isHorizScrollLocked && isVertScrollLocked) return
      e.currentTarget.style.cursor = 'grabbing'
      setPan(p => {
        const nextY = isVertScrollLocked ? p.y : p.y + e.movementY
        if (isHorizScrollLocked) {
          return { x: p.x, y: nextY }
        }
        if (scrollBoth) {
          const nextX = sharedPanX + e.movementX
          setSharedPanX(nextX)
          return { x: nextX, y: nextY }
        }
        const nextX = useStore.getState().playheadFollowMode === 'grid' ? p.x : p.x + e.movementX
        return { x: nextX, y: nextY }
      })
    } else if (dragMode === 'draw_export_region') {
      e.currentTarget.style.cursor = 'crosshair'
      setActiveDragRegion({ startTick: dragStartValue, endTick: xToTick(x) })
    } else if (dragMode === 'resize_column' && dragTargetCol !== null) {
      e.currentTarget.style.cursor = 'ew-resize'
      const dx = (e.clientX - e.currentTarget.getBoundingClientRect().left - dragStartPos.x) / zoom
      setColumnWidth(dragTargetCol, Math.max(10, Math.floor(dragStartValue + dx)))
    } else if (dragMode === 'resize_note_right' && dragTargetId) {
      e.currentTarget.style.cursor = 'ew-resize'
      const dx = (e.clientX - e.currentTarget.getBoundingClientRect().left - dragStartPos.x) / zoom
      const note = notes.find(n => n.id === dragTargetId)
      if (note) {
        const origVisualEnd = tickToX(note.time + dragStartValue)
        const newVisualEnd = origVisualEnd + dx
        const minNoteSize = useStore.getState().minNoteSize ?? 12
        const newDuration = Math.max(minNoteSize, Math.floor(xToTick(newVisualEnd) - note.time))
        updateNote(dragTargetId, { duration: newDuration })
      }
    } else if (dragMode === 'resize_note_top' && dragTargetId) {
      e.currentTarget.style.cursor = 'ns-resize'
      const dy = (e.clientY - e.currentTarget.getBoundingClientRect().top - dragStartPos.y) / zoom
      const note = notes.find(n => n.id === dragTargetId)
      if (note) {
        let pitchDelta = (dy / gridSizeY) * stepSize
        const { pitchSnapEnabled, pitchSnapSensitivity } = useStore.getState()
        if (pitchSnapEnabled) pitchDelta = Math.floor(dy / gridSizeY) * stepSize
        let newPitch = dragStartValueY - pitchDelta
        
        if (!pitchSnapEnabled && pitchSnapSensitivity > 0) {
           const nearest = Math.round(newPitch / stepSize) * stepSize
           if (Math.abs(newPitch - nearest) < (pitchSnapSensitivity / 100) * (stepSize * 0.5)) newPitch = nearest
        }
        
        newPitch = Math.max(lowestPitch, Math.min(highestPitch, newPitch))
        const currentBottom = note.pitchEnd !== undefined ? Math.min(note.pitch, note.pitchEnd) : note.pitch
        updateNote(dragTargetId, { pitchEnd: Math.max(currentBottom, newPitch) })
      }
    } else if (dragMode === 'resize_note_bottom' && dragTargetId) {
      e.currentTarget.style.cursor = 'ns-resize'
      const dy = (e.clientY - e.currentTarget.getBoundingClientRect().top - dragStartPos.y) / zoom
      const note = notes.find(n => n.id === dragTargetId)
      if (note) {
        let pitchDelta = (dy / gridSizeY) * stepSize
        const { pitchSnapEnabled, pitchSnapSensitivity } = useStore.getState()
        if (pitchSnapEnabled) pitchDelta = Math.floor(dy / gridSizeY) * stepSize
        let newPitch = dragStartValueY - pitchDelta
        
        if (!pitchSnapEnabled && pitchSnapSensitivity > 0) {
           const nearest = Math.round(newPitch / stepSize) * stepSize
           if (Math.abs(newPitch - nearest) < (pitchSnapSensitivity / 100) * (stepSize * 0.5)) newPitch = nearest
        }
        
        newPitch = Math.max(lowestPitch, Math.min(highestPitch, newPitch))
        const currentTop = note.pitchEnd !== undefined ? Math.max(note.pitch, note.pitchEnd) : note.pitch
        updateNote(dragTargetId, { pitchEnd: Math.min(currentTop, newPitch) })
      }
    } else if (dragMode === 'move_note' && dragTargetId) {
      e.currentTarget.style.cursor = 'grabbing'
      const dx = (e.clientX - e.currentTarget.getBoundingClientRect().left - dragStartPos.x) / zoom
      const dy = (e.clientY - e.currentTarget.getBoundingClientRect().top - dragStartPos.y) / zoom
      const note = notes.find(n => n.id === dragTargetId)
      if (note) {
        const origVisualStart = tickToX(dragStartValue)
        const newVisualStart = origVisualStart + dx
        let newTime = Math.max(0, Math.floor(xToTick(newVisualStart)))
        const { snapEnabled, snapResolution, pitchSnapEnabled, pitchSnapSensitivity } = useStore.getState()
        if (snapEnabled) {
          newTime = Math.round(newTime / snapResolution) * snapResolution
        }

        let newPitch = dragStartValueY
        let indexDelta = 0
        if (effectiveRowOrder) {
           const startIdx = effectiveRowOrder.indexOf(String(Math.round(dragStartValueY)))
           if (startIdx !== -1) {
              indexDelta = Math.round(dy / gridSizeY)
              const newIdx = Math.max(0, Math.min(numRows - 1, startIdx + indexDelta))
              newPitch = Number(effectiveRowOrder[newIdx])
           }
        } else {
           let pitchDelta = (dy / gridSizeY) * stepSize
           if (pitchSnapEnabled) pitchDelta = Math.round(dy / gridSizeY) * stepSize
           newPitch = dragStartValueY - pitchDelta
           if (!pitchSnapEnabled && pitchSnapSensitivity > 0) {
              const nearest = Math.round(newPitch / stepSize) * stepSize
              if (Math.abs(newPitch - nearest) < (pitchSnapSensitivity / 100) * (stepSize * 0.5)) newPitch = nearest
           }
        }
        newPitch = Math.max(lowestPitch, Math.min(highestPitch, newPitch))

        const timeDelta = newTime - dragStartValue
        const pitchDeltaTotal = newPitch - dragStartValueY

        if (selectedNoteIds.includes(dragTargetId)) {
          dragStartSelectedNotes.forEach(startState => {
            let updatedPitch = startState.pitch
            let updatedEnd = startState.pitchEnd
            if (effectiveRowOrder) {
               const sIdx = effectiveRowOrder.indexOf(String(Math.round(startState.pitch)))
               if (sIdx !== -1) {
                 const nIdx = Math.max(0, Math.min(numRows - 1, sIdx + indexDelta))
                 updatedPitch = Number(effectiveRowOrder[nIdx])
               }
               if (updatedEnd !== undefined) {
                 const eIdx = effectiveRowOrder.indexOf(String(Math.round(updatedEnd)))
                 if (eIdx !== -1) {
                   const nIdx = Math.max(0, Math.min(numRows - 1, eIdx + indexDelta))
                   updatedEnd = Number(effectiveRowOrder[nIdx])
                 }
               }
            } else {
               updatedPitch = Math.max(lowestPitch, Math.min(highestPitch, startState.pitch + pitchDeltaTotal))
               updatedEnd = startState.pitchEnd !== undefined ? Math.max(lowestPitch, Math.min(highestPitch, startState.pitchEnd + pitchDeltaTotal)) : undefined
            }
            
            updateNote(startState.id, {
              time: Math.max(0, startState.time + timeDelta),
              pitch: updatedPitch,
              pitchEnd: updatedEnd
            })
          })
        } else {
          let updatedEnd = note.pitchEnd
          if (effectiveRowOrder && note.pitchEnd !== undefined) {
             const eIdx = effectiveRowOrder.indexOf(String(Math.round(note.pitchEnd)))
             if (eIdx !== -1) {
               const nIdx = Math.max(0, Math.min(numRows - 1, eIdx + indexDelta))
               updatedEnd = Number(effectiveRowOrder[nIdx])
             }
          } else if (note.pitchEnd !== undefined) {
             updatedEnd = Math.max(lowestPitch, Math.min(highestPitch, note.pitchEnd + pitchDeltaTotal))
          }
          updateNote(dragTargetId, { time: newTime, pitch: newPitch, pitchEnd: updatedEnd })
        }
      }
    } else if (dragMode === 'scrub_playhead') {
      if (gridTimelineDragRef.current) {
        const dist = Math.abs((e as any).clientX - gridTimelineDragRef.current.startClientX)
        if (dist >= 5) {
          setDragMode('draw_timeline_range')
          const sTick = gridTimelineDragRef.current.startTick
          setTimelineRangeStart(sTick)
          const rawTick = xToTick(x)
          const curTick = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
          setTimelineSelection({ startTick: sTick, endTick: curTick, trackId: targetTrackId })
          e.currentTarget.style.cursor = 'crosshair'
          return
        }
      }
      e.currentTarget.style.cursor = 'ew-resize'
      setPlayheadFromWorldX(x)
    } else if (dragMode === 'draw_timeline_range' && timelineRangeStart !== null) {
      e.currentTarget.style.cursor = 'crosshair'
      const rawTick = xToTick(x)
      const curTick = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
      setTimelineSelection({ startTick: timelineRangeStart, endTick: curTick, trackId: targetTrackId })
      return
    } else if (dragMode === 'box_select') {
      e.currentTarget.style.cursor = 'cell'
      setBoxSelectCurrent({ x, y })
    } else if (dragMode === 'stretch_left' || dragMode === 'stretch_right') {
      e.currentTarget.style.cursor = 'ew-resize'
      const st = stretchStateRef.current
      if (!st) return
      const curX = Math.max(0, x)
      const anchor = st.anchor
      const origSpan = Math.abs(st.edge - anchor)
      if (origSpan < 1) return
      const newSpan = Math.abs(curX - anchor)
      const scale = newSpan / origSpan
      if (dragMode === 'stretch_right') {
        st.notes.forEach(orig => {
          const relStart = orig.time - anchor
          const newTime = Math.max(0, Math.round(anchor + relStart * scale))
          const newEnd = Math.max(newTime + 4, Math.round(anchor + (relStart + orig.duration) * scale))
          updateNote(orig.id, { time: newTime, duration: newEnd - newTime })
        })
      } else {
        // stretch_left: anchor is on the right
        st.notes.forEach(orig => {
          const relEnd = (orig.time + orig.duration) - anchor
          const newEnd = Math.max(4, Math.round(anchor + relEnd * scale))
          const newTime = Math.max(0, newEnd - Math.max(4, Math.round(orig.duration * scale)))
          updateNote(orig.id, { time: newTime, duration: Math.max(4, newEnd - newTime) })
        })
      }
    } else if (dragMode === 'adjust_loop_start') {
      const { snapEnabled, snapResolution, setLoopStart, loopEnd } = useStore.getState()
      const rect = e.currentTarget.getBoundingClientRect()
      const x = (e.clientX - rect.left - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom
      const rawTick = xToTick(x)
      const newStart = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
      setLoopStart(Math.max(0, Math.min(loopEnd - 48, newStart)))
    } else if (dragMode === 'adjust_loop_end') {
      const { snapEnabled, snapResolution, setLoopEnd, loopStart } = useStore.getState()
      const rect = e.currentTarget.getBoundingClientRect()
      const x = (e.clientX - rect.left - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom
      const rawTick = xToTick(x)
      const newEnd = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
      setLoopEnd(Math.max(loopStart + 48, newEnd))
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode === 'draw_export_region') {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = (e.clientX - rect.left - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom
      commitDragExportRegion(e, x)
    }

    if (dragMode === 'draw_timeline_range') {
      const currentSel = useStore.getState().timelineSelection
      if (currentSel && Math.abs(currentSel.endTick - currentSel.startTick) < (snapEnabled ? Math.max(6, snapResolution / 4) : 6)) {
        setTimelineSelection(null)
      }
      setTimelineRangeStart(null)
      setDragMode('none')
      gridTimelineDragRef.current = null
      return
    }

    if (dragMode === 'scrub_playhead' && gridTimelineDragRef.current) {
      const currentSel = useStore.getState().timelineSelection
      if (currentSel) {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = (e.clientX - rect.left - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom
        const clickTick = Math.max(0, Math.round(xToTick(x)))
        const minT = Math.min(currentSel.startTick, currentSel.endTick)
        const maxT = Math.max(currentSel.startTick, currentSel.endTick)
        if (clickTick < minT || clickTick > maxT) {
          setTimelineSelection(null)
        }
      }
      gridTimelineDragRef.current = null
    }

    if (dragMode === 'box_select') {
      const minX = Math.min(boxSelectStart.x, boxSelectCurrent.x)
      const maxX = Math.max(boxSelectStart.x, boxSelectCurrent.x)
      const minY = Math.min(boxSelectStart.y, boxSelectCurrent.y) - TIMELINE_HEIGHT
      const maxY = Math.max(boxSelectStart.y, boxSelectCurrent.y) - TIMELINE_HEIGHT

      const selected = editableNotes.filter(n => {
        const nxStart = tickToX(n.time)
        const nxEnd = tickToX(n.time + n.duration)
        const noteOverlapX = nxStart <= maxX && nxEnd >= minX

        const topPitch = n.pitchEnd !== undefined ? Math.max(n.pitch, n.pitchEnd) : n.pitch
        const bottomPitch = n.pitchEnd !== undefined ? Math.min(n.pitch, n.pitchEnd) : n.pitch
        const nyStart = getPitchY(topPitch)
        const nTrack = trackMap.get(n.trackId)
        const isFromCurrentTrack = n.trackId === targetTrackId
        const nStep = isFromCurrentTrack ? stepSize : (nTrack?.instrument === 'drum' ? 1 : (nTrack?.edoDivision && nTrack.edoDivision !== 12 ? (12 / nTrack.edoDivision) : 1))
        const heightInPitch = (topPitch - bottomPitch) + nStep
        const noteH = Math.max(isMicroEdo ? 5 : 8, (heightInPitch / stepSize) * gridSizeY)
        const nyEnd = nyStart + noteH
        const noteOverlapY = nyStart <= maxY && nyEnd >= minY

        return noteOverlapX && noteOverlapY
      }).map(n => n.id)

      setSelectedNoteIds(selected)
    }

    if (dragMode === 'move_note' || dragMode === 'resize_note_right') {
      const rect = e.currentTarget.getBoundingClientRect()
      const rawX = e.clientX - rect.left
      const rawY = e.clientY - rect.top
      if (Math.abs(rawX - dragStartPos.x) < 3 && Math.abs(rawY - dragStartPos.y) < 3) {
        if (dragTargetId && wasAlreadySelectedRef.current && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          setSelectedNoteIds(selectedNoteIds.filter(id => id !== dragTargetId))
        }
      }
    }

    setDragMode('none')
    setDragTargetId(null)
    setDragTargetCol(null)

    const activeTool = useStore.getState().activeTool
    e.currentTarget.style.cursor = isReadOnly ? 'default' : (activeTool === 'draw' ? 'crosshair' : (activeTool === 'erase' ? 'cell' : 'default'))
  }

  // --- Custom Scrollbar Calculations & Handlers ---
  const cols = getColumns()
  const totalTicks = cols.reduce((sum, col) => sum + col.width, 0)
  const totalWidth = totalTicks * zoom
  const viewportWidth = Math.max(1, canvasSize.width - SIDEBAR_WIDTH)

  const scrollbarHeightY = Math.max(1, canvasSize.height - 16)
  const thumbHeightY = Math.max(24, Math.min(scrollbarHeightY, (canvasSize.height / totalHeight) * scrollbarHeightY))
  const scrollRatioY = maxPanY === 0 ? 0 : pan.y / maxPanY
  const thumbTopY = scrollRatioY * (scrollbarHeightY - thumbHeightY)

  const scrollbarWidthX = Math.max(1, canvasSize.width - SIDEBAR_WIDTH - 24)
  const thumbWidthX = Math.max(24, Math.min(scrollbarWidthX, (viewportWidth / totalWidth) * scrollbarWidthX))
  const effectivePanXForScroll = getEffectivePanX(canvasSize.width)
  const maxPanX = -Math.max(0, totalWidth - viewportWidth)
  const scrollRatioX = maxPanX === 0 ? 0 : effectivePanXForScroll / maxPanX
  const thumbLeftX = scrollRatioX * (scrollbarWidthX - thumbWidthX)

  const handleScrollXPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragScrollX({
      startX: e.clientX,
      startPanX: scrollBoth ? sharedPanX : pan.x
    })
  }

  const handleScrollXPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isHorizScrollLocked) return
    if (!dragScrollX) return
    e.stopPropagation()
    const dx = e.clientX - dragScrollX.startX
    if (maxPanX === 0) return
    const scrollbarTravel = scrollbarWidthX - thumbWidthX
    const deltaPanX = (dx / Math.max(1, scrollbarTravel)) * maxPanX
    const nextX = Math.max(maxPanX, Math.min(0, dragScrollX.startPanX + deltaPanX))
    if (scrollBoth) {
      setSharedPanX(nextX)
    }
    setPan(p => ({
      ...p,
      x: nextX
    }))
  }

  const handleScrollXPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setDragScrollX(null)
  }

  const handleScrollYPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragScrollY({
      startY: e.clientY,
      startPanY: pan.y
    })
  }

  const handleScrollYPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isVertScrollLocked) return
    if (!dragScrollY) return
    e.stopPropagation()
    const dy = e.clientY - dragScrollY.startY
    if (maxPanY === 0) return
    const scrollbarTravel = scrollbarHeightY - thumbHeightY
    const deltaPanY = (dy / Math.max(1, scrollbarTravel)) * maxPanY
    setPan(p => ({
      ...p,
      y: Math.max(maxPanY, Math.min(0, dragScrollY.startPanY + deltaPanY))
    }))
  }

  const handleScrollYPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setDragScrollY(null)
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      const zoomFactor = 1 - e.deltaY * 0.001
      setZoom(z => Math.max(0.1, Math.min(3, z * zoomFactor)))
    } else {
      if (isHorizScrollLocked && isVertScrollLocked) return
      setPan(p => {
        const nextY = isVertScrollLocked ? p.y : Math.max(maxPanY, Math.min(0, p.y - e.deltaY))
        if (isHorizScrollLocked) {
          return { ...p, y: nextY }
        }
        if (scrollBoth) {
          const nextX = Math.max(maxPanX, Math.min(0, sharedPanX - e.deltaX))
          setSharedPanX(nextX)
          return { x: nextX, y: nextY }
        }
        const nextX = useStore.getState().playheadFollowMode === 'grid' ? p.x : Math.max(maxPanX, Math.min(0, p.x - e.deltaX))
        return { x: nextX, y: nextY }
      })
    }
  }

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rawX = e.clientX - rect.left
    const rawY = e.clientY - rect.top
    const x = (rawX - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom
    const y = (rawY - pan.y) / zoom
    const gridY = y - TIMELINE_HEIGHT
    if (gridY < 0) return

    // Check all notes (including ghost notes)
    for (let i = allNotes.length - 1; i >= 0; i--) {
      const n = allNotes[i]
      const topPitch = n.pitchEnd !== undefined ? Math.max(n.pitch, n.pitchEnd) : n.pitch
      const bottomPitch = n.pitchEnd !== undefined ? Math.min(n.pitch, n.pitchEnd) : n.pitch
      const noteY = getPitchY(topPitch)
      const nTrack = tracks.find(t => t.id === n.trackId)
      const isFromCurrentTrack = n.trackId === targetTrackId
      const nStep = isFromCurrentTrack ? stepSize : (nTrack?.instrument === 'drum' ? 1 : (nTrack?.edoDivision && nTrack.edoDivision !== 12 ? (12 / nTrack.edoDivision) : 1))
      const heightInPitch = (topPitch - bottomPitch) + nStep
      const noteH = Math.max(isMicroEdo ? 5 : 8, (heightInPitch / stepSize) * gridSizeY)

      if (gridY >= noteY && gridY <= noteY + noteH) {
        const noteXStart = tickToX(n.time)
        const noteXEnd = Math.max(noteXStart + 8 / zoom, tickToX(n.time + n.duration))
        if (x >= noteXStart && x <= noteXEnd) {
          if (n.trackId !== targetTrackId) {
            useStore.getState().setActiveTrackId(n.trackId)
            useStore.getState().setSelectedNoteIds([n.id])
            const targetTrack = tracks.find(t => t.id === n.trackId)
            useStore.getState().showToast(`Switched active track to: ${targetTrack?.name || 'Track'}`, 'info')
          }
          break
        }
      }
    }
  }, [allNotes, targetTrackId, zoom, pan.y, getEffectivePanX, getPitchY, gridSizeY, tickToX, tracks])

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {instrumentTracks.length > 0 && (
        <div style={{ position: 'relative', width: '100%', height: `${STICKY_TIMELINE_HEIGHT}px`, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <canvas
            ref={timelineCanvasRef}
            height={STICKY_TIMELINE_HEIGHT}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'ew-resize' }}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerUp}
            onPointerLeave={handleTimelinePointerUp}
            onContextMenu={e => e.preventDefault()}
          />
          {/* Quick Style Switcher in Top-Left Corner (above Keys) */}
          {!isDrum && currentTrack?.instrument === 'synth' && (
            <div
              style={{
                position: 'absolute',
                top: '3px',
                left: '4px',
                width: `${SIDEBAR_WIDTH - 8}px`,
                height: `${STICKY_TIMELINE_HEIGHT - 6}px`,
                display: 'flex',
                alignItems: 'center',
                zIndex: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', width: '100%', height: '100%' }}>
                <select
                  value={isMicroEdo ? (currentTrack.edoPreset || (currentTrack.edoDivision ? `${currentTrack.edoDivision}-edo` : '53-edo')) : '12-edo'}
                  onChange={e => {
                    const val = e.target.value
                    if (val === '12-edo') {
                      updateTrack(currentTrack.id, { edoDivision: 12, edoPreset: '12-edo', edoRootNote: 60 })
                    } else if (val === 'custom') {
                      updateTrack(currentTrack.id, { edoPreset: 'custom', edoDivision: currentTrack.edoDivision && currentTrack.edoDivision !== 12 ? currentTrack.edoDivision : 69 })
                    } else {
                      const div = parseInt(val)
                      updateTrack(currentTrack.id, { edoDivision: div, edoPreset: val as any })
                    }
                  }}
                  style={{
                    flex: currentTrack?.edoPreset === 'custom' ? '1 1 auto' : '1 1 100%',
                    height: '100%',
                    background: isMicroEdo ? 'rgba(0, 230, 255, 0.16)' : '#1a1a24',
                    color: isMicroEdo ? '#00e6ff' : '#aaa',
                    border: isMicroEdo ? '1px solid rgba(0, 230, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.18)',
                    borderRadius: '4px',
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '0 2px',
                    cursor: 'pointer',
                    outline: 'none',
                    minWidth: 0
                  }}
                  title="Switch Grid Tuning Style & Nomenclature"
                >
                  <option value="12-edo" style={{ background: '#181822', color: '#fff' }}>12-EDO</option>
                  <option value="53-edo" style={{ background: '#181822', color: '#00e6ff' }}>53-EDO</option>
                  <option value="24-edo" style={{ background: '#181822', color: '#ffb300' }}>24-EDO</option>
                  <option value="19-edo" style={{ background: '#181822', color: '#b197fc' }}>19-EDO</option>
                  <option value="31-edo" style={{ background: '#181822', color: '#38d9a9' }}>31-EDO</option>
                  <option value="47-edo" style={{ background: '#181822', color: '#ff922b' }}>47-EDO</option>
                  <option value="custom" style={{ background: '#181822', color: '#e599f7' }}>Custom</option>
                </select>
                {currentTrack?.edoPreset === 'custom' && (
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={currentTrack.edoDivision || 69}
                    onChange={e => {
                      const n = Math.max(5, Math.min(120, parseInt(e.target.value) || 12))
                      updateTrack(currentTrack.id, { edoDivision: n, edoPreset: 'custom' })
                    }}
                    title="Divisions Per Octave (N)"
                    style={{
                      width: '32px',
                      height: '100%',
                      background: '#1a1a24',
                      color: '#e599f7',
                      border: '1px solid rgba(229, 153, 247, 0.5)',
                      borderRadius: '4px',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      textAlign: 'center',
                      padding: '0 1px'
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Main canvas area — takes all space minus the footer */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0, // critical: prevents flex child from overflowing
          overflow: 'hidden',
          background: '#121212',
          position: 'relative'
        }}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onContextMenu={e => {
          e.preventDefault()
        }}
      >
        {instrumentTracks.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
            Select a track to start editing
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: '100%', display: 'block' }}
              onContextMenu={e => e.preventDefault()}
            />

            {/* Custom Vertical Scrollbar */}
            {totalHeight > canvasSize.height && (
              <div
                style={{
                  position: 'absolute',
                  right: '4px',
                  top: '8px',
                  bottom: '8px',
                  width: '6px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '3px',
                  zIndex: 20
                }}
              >
                <div
                  onPointerDown={handleScrollYPointerDown}
                  onPointerMove={handleScrollYPointerMove}
                  onPointerUp={handleScrollYPointerUp}
                  onPointerLeave={handleScrollYPointerUp}
                  onMouseEnter={() => setHoverScrollY(true)}
                  onMouseLeave={() => setHoverScrollY(false)}
                  style={{
                    position: 'absolute',
                    width: '100%',
                    height: `${thumbHeightY}px`,
                    top: `${thumbTopY}px`,
                    borderRadius: '3px',
                    background: dragScrollY || hoverScrollY
                      ? 'rgba(139, 146, 165, 0.45)'
                      : 'rgba(139, 146, 165, 0.26)',
                    border: '1px solid rgba(15, 16, 21, 0.75)',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                />
              </div>
            )}

            {/* Custom Horizontal Scrollbar */}
            {totalWidth > viewportWidth && (
              <div
                style={{
                  position: 'absolute',
                  left: `${SIDEBAR_WIDTH + 8}px`,
                  right: '16px',
                  bottom: '4px',
                  height: '6px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '3px',
                  zIndex: 20
                }}
              >
                <div
                  onPointerDown={handleScrollXPointerDown}
                  onPointerMove={handleScrollXPointerMove}
                  onPointerUp={handleScrollXPointerUp}
                  onPointerLeave={handleScrollXPointerUp}
                  onMouseEnter={() => setHoverScrollX(true)}
                  onMouseLeave={() => setHoverScrollX(false)}
                  style={{
                    position: 'absolute',
                    height: '100%',
                    width: `${thumbWidthX}px`,
                    left: `${thumbLeftX}px`,
                    borderRadius: '3px',
                    background: dragScrollX || hoverScrollX
                      ? 'rgba(139, 146, 165, 0.45)'
                      : 'rgba(139, 146, 165, 0.26)',
                    border: '1px solid rgba(15, 16, 21, 0.75)',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Automation Lane Footer — all tracks, fixed pixel height */}
      {targetTrackId && (
        <div style={{
          flexShrink: 0,
          height: showAutomation ? `${AUTOMATION_HEIGHT + 30}px` : '30px',
          background: '#1a1a1a',
          borderTop: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div
            style={{
              height: '30px',
              flexShrink: 0,
              padding: '0 15px',
              background: '#222',
              fontSize: '11px',
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#888',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
            onClick={() => setShowAutomation(prev => !prev)}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {laneTargetKind === 'vst3'
                ? `VST3 · ${vst3TargetParam?.name ?? `#${vst3TargetIndex + 1}`}`
                : laneTargetLabel(automationTarget)} Automation
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              {(['velocity', 'volume', 'pan'] as const).map(t => {
                const curvePoints = getTrackAutomationPoints(useStore.getState().automationCurves, targetTrackId, t)
                const hasActiveData = curvePoints.length > 0
                return (
                  <button
                    key={t}
                    onClick={(e) => { e.stopPropagation(); setAutomationTarget(targetTrackId, t) }}
                    style={{
                      padding: '3px 7px',
                      borderRadius: '4px',
                      border: `1px solid ${automationTarget === t ? 'rgba(77,171,247,0.45)' : hasActiveData ? 'rgba(0,230,255,0.3)' : 'rgba(255,255,255,0.07)'}`,
                      background: automationTarget === t ? 'rgba(77,171,247,0.16)' : 'rgba(255,255,255,0.03)',
                      color: automationTarget === t ? '#4dabf7' : hasActiveData ? '#00e6ff' : '#8a8a95',
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'none',
                      letterSpacing: 0,
                      cursor: 'pointer',
                      lineHeight: 1.2,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>{t === 'velocity' ? 'Velocity' : t === 'volume' ? 'Volume' : 'Pan'}</span>
                    {hasActiveData && (
                      <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#00e6ff', boxShadow: '0 0 5px #00e6ff' }} title="Active curve modulation" />
                    )}
                  </button>
                )
              })}
              {vst3Params.length > 0 && (
                <select
                  value={vst3TargetIndex >= 0 ? String(vst3TargetIndex) : ''}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation()
                    if (e.currentTarget.value !== '') {
                      setAutomationTarget(targetTrackId, `vst3:${Number(e.currentTarget.value)}`)
                    }
                  }}
                  title="Automate a VST3 parameter"
                  style={{
                    padding: '3px 6px',
                    borderRadius: '4px',
                    border: `1px solid ${vst3TargetIndex >= 0 ? 'rgba(77,171,247,0.45)' : 'rgba(255,255,255,0.07)'}`,
                    background: vst3TargetIndex >= 0 ? 'rgba(77,171,247,0.16)' : 'rgba(255,255,255,0.03)',
                    color: vst3TargetIndex >= 0 ? '#4dabf7' : '#8a8a95',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'none',
                    letterSpacing: 0,
                    cursor: 'pointer',
                    lineHeight: 1.2,
                    maxWidth: '150px'
                  }}
                >
                  <option value="">VST3 Param…</option>
                  {vst3Params.map(p => (
                    <option key={p.index} value={String(p.index)} style={{ background: '#12141c', color: '#e0e0e0' }}>
                      {p.name || `Param ${p.index + 1}`}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={exprTargetId}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation()
                  if (e.currentTarget.value !== '') {
                    setAutomationTarget(targetTrackId, `expr:${e.currentTarget.value as ExpressionLaneTarget}`)
                  } else {
                    setAutomationTarget(targetTrackId, 'velocity')
                  }
                }}
                title="Automate a per-note expression parameter"
                style={{
                  padding: '3px 6px',
                  borderRadius: '4px',
                  border: `1px solid ${laneTargetKind === 'expr' ? 'rgba(77,171,247,0.45)' : 'rgba(255,255,255,0.07)'}`,
                  background: laneTargetKind === 'expr' ? 'rgba(77,171,247,0.16)' : 'rgba(255,255,255,0.03)',
                  color: laneTargetKind === 'expr' ? '#4dabf7' : '#8a8a95',
                  fontSize: '9px',
                  fontWeight: 700,
                  textTransform: 'none',
                  letterSpacing: 0,
                  cursor: 'pointer',
                  lineHeight: 1.2,
                  maxWidth: '150px'
                }}
              >
                <option value="">Expression…</option>
                {exprTargets.map(t => (
                  <option key={t} value={t} style={{ background: '#12141c', color: '#e0e0e0' }}>
                    {expressionLaneLabel[t]}
                  </option>
                ))}
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  updateAutomationLane(targetTrackId, { source: laneIsFormula ? 'drawn' : 'formula' })
                }}
                title={laneIsFormula
                  ? 'Lane is driven by an equation (edit it in Automation (Procedural)). Click to draw points instead.'
                  : 'Drive this lane with any equation, like the FX modulators. Click to turn it off.'}
                style={{
                  padding: '3px 7px',
                  borderRadius: '4px',
                  border: `1px solid ${laneIsFormula ? 'rgba(77,171,247,0.45)' : 'rgba(255,255,255,0.07)'}`,
                  background: laneIsFormula ? 'rgba(77,171,247,0.16)' : 'rgba(255,255,255,0.03)',
                  color: laneIsFormula ? '#4dabf7' : '#8a8a95',
                  fontFamily: 'monospace',
                  fontSize: '9px',
                  fontWeight: 700,
                  textTransform: 'none',
                  letterSpacing: 0,
                  cursor: 'pointer',
                  lineHeight: 1.2
                }}
              >
                f(x)
              </button>
              <span style={{ marginLeft: '6px' }}>{showAutomation ? '▼' : '▲'}</span>
            </div>
          </div>
          {showAutomation && (
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <canvas
                ref={automationCanvasRef}
                style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const rawX = e.clientX - rect.left
                  if (rawX < SIDEBAR_WIDTH) return

                  e.currentTarget.setPointerCapture(e.pointerId)
                  const rawY = e.clientY - rect.top
                  const x = Math.max(0, (rawX - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom)
                  const clickVelocity = Math.max(1, Math.min(127, Math.round((1 - rawY / rect.height) * 127)))
                  const rawTick = xToTick(x)
                  const time = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)

                  // 1. Proximity check for note stems/handles in this track. These handles
                  // write note velocity, so they only apply when the lane targets velocity.
                  let targetNote: { id: string; velocity: number } | null = null
                  if (automationTarget === 'velocity') {
                    const notesInTrack = useStore.getState().notes.filter(n => n.trackId === targetTrackId)
                    const horizontalThreshold = 15 / zoom
                    const candidateNotes = notesInTrack.filter(n => {
                      const noteCenterX = tickToX(n.time + n.duration / 2)
                      return Math.abs(noteCenterX - x) < horizontalThreshold
                    })

                    if (candidateNotes.length > 0) {
                      let minDiff = Infinity
                      candidateNotes.forEach(n => {
                        const diff = Math.abs(n.velocity - clickVelocity)
                        if (diff < minDiff) {
                          minDiff = diff
                          targetNote = n
                        }
                      })
                    }
                  }

                  if (targetNote) {
                    setDragVelocityNoteId((targetNote as any).id)
                    setDragMode('edit_note_velocity')
                    updateNote((targetNote as any).id, { velocity: clickVelocity, velocityInspectorModified: false })
                    return
                  }

                  // 2. Fallback to general automation curves
                  const points = getTrackAutomationPoints(useStore.getState().automationCurves, targetTrackId, automationTarget)
                  const nearest = points.find(point => {
                    const pointX = tickToX(point.time)
                    const pointY = rect.height - (point.value / 127) * rect.height
                    return Math.abs(pointX - x) < 14 / zoom && Math.abs(pointY - rawY) < 14
                  })

                  if (e.button === 2) {
                    if (nearest) removeAutomationPoint(targetTrackId, nearest.id, automationTarget)
                    return
                  }

                  if (nearest) {
                    setDragAutomationPointId(nearest.id)
                    updateAutomationPoint(targetTrackId, nearest.id, { time, value: clickVelocity }, automationTarget)
                  } else {
                    const id = Math.random().toString(36).substr(2, 9)
                    addAutomationPoint(targetTrackId, { id, time, value: clickVelocity }, automationTarget)
                    setDragAutomationPointId(id)
                  }
                  setDragMode('draw_automation')
                }}
                onPointerMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const rawY = e.clientY - rect.top
                  const velocity = Math.max(1, Math.min(127, Math.round((1 - rawY / rect.height) * 127)))

                  if (dragMode === 'edit_note_velocity' && dragVelocityNoteId) {
                    updateNote(dragVelocityNoteId, { velocity, velocityInspectorModified: false })
                  } else if (dragMode === 'draw_automation' && dragAutomationPointId) {
                    const rawX = e.clientX - rect.left
                    if (rawX < SIDEBAR_WIDTH) return
                    const x = Math.max(0, (rawX - SIDEBAR_WIDTH - getEffectivePanX(rect.width)) / zoom)
                    const rawTick = xToTick(x)
                    const time = snapEnabled ? snapTick(rawTick, snapResolution) : Math.round(rawTick)
                    updateAutomationPoint(targetTrackId, dragAutomationPointId, { time, value: velocity }, automationTarget)
                  }
                }}
                onPointerUp={() => {
                  setDragMode('none')
                  setDragAutomationPointId(null)
                  setDragVelocityNoteId(null)
                }}
                onPointerLeave={() => {
                  setDragMode('none')
                  setDragAutomationPointId(null)
                  setDragVelocityNoteId(null)
                }}
                onContextMenu={e => e.preventDefault()}
              />
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.mode === 'glide' ? Math.max(8, Math.min(contextMenu.y, window.innerHeight - 360)) : Math.max(8, Math.min(contextMenu.y, window.innerHeight - 520)),
            left: contextMenu.mode === 'glide' ? Math.max(8, Math.min(contextMenu.x, window.innerWidth - 260)) : Math.max(8, Math.min(contextMenu.x, window.innerWidth - 280)),
            background: '#14141c',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '8px',
            zIndex: 9999,
            minWidth: contextMenu.mode === 'glide' ? '248px' : '230px',
            maxWidth: '280px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            overflow: 'hidden'
          }}
          ref={contextMenuRef}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.mode === 'main' ? (
            <div style={{ padding: '4px 0', maxHeight: '520px', overflowY: 'auto' }} className="thin-scroll">
              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  setPlayheadFromWorldX(contextMenu.tick)
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconPin size={13} style={{ color: '#ff3366' }} /> Place playhead here
                </div>
              </button>

              {selectedNoteIds.length > 0 ? (
                <>
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                  {/* Header with selection info */}
                  <div style={{ padding: '4px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#888', fontWeight: 800 }}>
                      {selectedNoteIds.length === 1 ? '1 Note Selected' : `${selectedNoteIds.length} Notes Selected`}
                    </span>
                    {allSelectedNotesMuted ? (
                      <span style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(255,51,102,0.18)', color: '#ff6b8b', fontWeight: 700, letterSpacing: '0.4px' }}>
                        MUTED
                      </span>
                    ) : hasMixedMuteState ? (
                      <span style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(255,170,0,0.18)', color: '#ffa94d', fontWeight: 700, letterSpacing: '0.4px' }}>
                        PARTIALLY MUTED
                      </span>
                    ) : null}
                  </div>

                  {/* Group Mute / Unmute Button */}
                  <button
                    style={{
                      width: '100%',
                      padding: '7px 12px',
                      background: allSelectedNotesMuted ? 'rgba(105, 219, 124, 0.08)' : 'rgba(255, 51, 102, 0.08)',
                      border: 'none',
                      color: allSelectedNotesMuted ? '#69db7c' : '#ff6b8b',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontWeight: 700
                    }}
                    onClick={handleToggleMuteSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = allSelectedNotesMuted ? 'rgba(105, 219, 124, 0.16)' : 'rgba(255, 51, 102, 0.16)'}
                    onMouseLeave={e => e.currentTarget.style.background = allSelectedNotesMuted ? 'rgba(105, 219, 124, 0.08)' : 'rgba(255, 51, 102, 0.08)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {allSelectedNotesMuted ? <IconVolume size={13} /> : <IconVolumeX size={13} />}
                      {allSelectedNotesMuted ? 'Unmute Selection' : 'Mute Selection'}
                    </div>
                    <span style={{ fontSize: '10px', color: '#888', fontWeight: 600 }}>M</span>
                  </button>

                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                  {/* Clipboard Section */}
                  <div style={{ padding: '3px 12px 2px', fontSize: '8.5px', textTransform: 'uppercase', color: '#555', fontWeight: 800, letterSpacing: '0.6px' }}>
                    Clipboard
                  </div>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleCopyNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconCopy size={13} style={{ color: '#4dabf7' }} /> Copy
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+C</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleCutNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconScissors size={13} style={{ color: '#da77f2' }} /> Cut
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+X</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleDuplicateSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconLayers size={13} style={{ color: '#ffd43b' }} /> Duplicate
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+D</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: useStore.getState().clipboard.length > 0 ? 'pointer' : 'default', opacity: useStore.getState().clipboard.length > 0 ? 1 : 0.4, textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => {
                      if (useStore.getState().clipboard.length > 0) {
                        handlePasteNotes(contextMenu.tick)
                      }
                    }}
                    onMouseEnter={e => { if (useStore.getState().clipboard.length > 0) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconPaste size={13} style={{ color: '#69db7c' }} /> Paste (at click)
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+V</span>
                  </button>

                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                  {/* Pitch & Transpose */}
                  <div style={{ padding: '3px 12px 2px', fontSize: '8.5px', textTransform: 'uppercase', color: '#555', fontWeight: 800, letterSpacing: '0.6px' }}>
                    Pitch & Transpose
                  </div>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleTransposeSelectedNotes(12)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconArrowUp size={13} style={{ color: '#4dabf7' }} /> Transpose +1 Octave
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Shift+↑</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleTransposeSelectedNotes(-12)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconArrowDown size={13} style={{ color: '#4dabf7' }} /> Transpose -1 Octave
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Shift+↓</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleTransposeSelectedNotes(1)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconArrowUp size={13} style={{ color: '#74c0fc' }} /> Transpose +1 Semitone
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+↑</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleTransposeSelectedNotes(-1)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconArrowDown size={13} style={{ color: '#74c0fc' }} /> Transpose -1 Semitone
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+↓</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleInvertPitchSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconShuffle size={13} style={{ color: '#b197fc' }} /> Invert Pitch
                    </div>
                  </button>

                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                  {/* Timing & Articulations */}
                  <div style={{ padding: '3px 12px 2px', fontSize: '8.5px', textTransform: 'uppercase', color: '#555', fontWeight: 800, letterSpacing: '0.6px' }}>
                    Timing & Articulation
                  </div>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleQuantizeSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconZap size={13} style={{ color: '#ffd43b' }} /> Quantize to Grid
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Q</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleLegatoSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconMusic size={13} style={{ color: '#69db7c' }} /> Quick Legato
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+L</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleGlueSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconLayers size={13} style={{ color: '#ff922b' }} /> Glue / Merge
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+G</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleStrumSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconSparkles size={13} style={{ color: '#da77f2' }} /> Strum Chords
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Alt+S</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleChopSelectedNotes('1/16')}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconScissors size={13} style={{ color: '#fa5252' }} /> Chop 1/16th Notes
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Alt+U</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleHumanizeSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconSparkles size={13} style={{ color: '#20c997' }} /> Humanize (Jitter)
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Alt+R</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={handleReverseSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconShuffle size={13} style={{ color: '#4dabf7' }} /> Reverse (Time)
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Alt+Y</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleNudgeSelectedNotes('left')}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconAlign size={13} style={{ color: '#4dabf7' }} /> Nudge Left
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Alt+←</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleNudgeSelectedNotes('right')}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconAlign size={13} style={{ color: '#4dabf7' }} /> Nudge Right
                    </div>
                    <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Alt+→</span>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleVelocityRampSelectedNotes('crescendo')}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconArrowUp size={13} style={{ color: '#ffd43b' }} /> Crescendo (Ramp Up)
                    </div>
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => handleVelocityRampSelectedNotes('decrescendo')}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconArrowDown size={13} style={{ color: '#ffd43b' }} /> Decrescendo (Ramp Down)
                    </div>
                  </button>

                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                  {/* Velocity Quick Bar */}
                  <div style={{ padding: '3px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '8.5px', textTransform: 'uppercase', color: '#555', fontWeight: 800, letterSpacing: '0.6px' }}>Velocity</span>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {[
                        { label: '25%', val: 32 },
                        { label: '50%', val: 64 },
                        { label: '75%', val: 96 },
                        { label: '100%', val: 127 },
                      ].map(v => (
                        <button
                          key={v.val}
                          onClick={() => handleSetVelocitySelectedNotes(v.val)}
                          style={{
                            padding: '2px 5px',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '3px',
                            color: '#aaa',
                            fontSize: '9px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#aaa' }}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                  {/* DAW Track & Linking Tools */}
                  <div style={{ padding: '3px 12px 2px', fontSize: '8.5px', textTransform: 'uppercase', color: '#555', fontWeight: 800, letterSpacing: '0.6px' }}>
                    DAW Tools
                  </div>

                  {noteInspectorEnabled && (
                    <button
                      style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                      onClick={() => {
                        useStore.getState().setIsRightPaneVisible(!isRightPaneVisible)
                        setContextMenu(null)
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <IconSettings size={13} /> {isRightPaneVisible ? 'Hide Note Inspector' : 'Show Note Inspector'}
                    </button>
                  )}

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                    onClick={handleCreateNewTrackFromSelection}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <IconPlus size={13} /> Create New Track from Selection
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#b197fc', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    onClick={handleInvertTrackSelection}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <IconList size={13} /> Invert Selection on Track
                  </button>

                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#ff9900', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                    onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'subtrack_parent' } : null)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <IconPlus size={13} /> Create Subtrack of...
                  </button>

                  {selectedNoteIds.length >= 2 && (
                    <button
                      style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#da77f2', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                      onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'glide' } : null)}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <IconMusic size={13} /> Link Glides...
                    </button>
                  )}

                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                  {/* Delete */}
                  <button
                    style={{ width: '100%', padding: '6px 12px', background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}
                    onClick={handleDeleteSelectedNotes}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,51,102,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconTrash size={13} /> Delete Selected Notes
                    </div>
                    <span style={{ fontSize: '10px', color: '#888', fontWeight: 600 }}>Del</span>
                  </button>
                </>
              ) : (
                <>
                  {useStore.getState().clipboard.length > 0 && (
                    <>
                      <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
                      <button
                        style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                        onClick={() => handlePasteNotes(contextMenu.tick)}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <IconPaste size={13} style={{ color: '#69db7c' }} /> Paste at Cursor ({useStore.getState().clipboard.length} notes)
                        </div>
                        <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+V</span>
                      </button>
                    </>
                  )}

                  {targetTrackId && (
                    <>
                      <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
                      <button
                        style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                        onClick={() => {
                          const trackNotes = allNotes.filter(n => n.trackId === targetTrackId)
                          setSelectedNoteIds(trackNotes.map(n => n.id))
                          setContextMenu(null)
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <IconList size={13} style={{ color: '#4dabf7' }} /> Select All Notes on Track
                        </div>
                        <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+A</span>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ) : contextMenu.mode === 'timeline_range' ? (
            <div style={{ padding: '4px 0', maxHeight: '520px', overflowY: 'auto' }} className="thin-scroll">
              <div style={{ padding: '6px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#ffa94d', fontWeight: 800 }}>
                  Timeline Region
                </span>
                {timelineSelection && (
                  <span style={{ fontSize: '9px', color: '#888', fontFamily: 'monospace' }}>
                    {Math.abs(timelineSelection.endTick - timelineSelection.startTick)} ticks
                  </span>
                )}
              </div>

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  if (timelineSelection) {
                    duplicateTimelineRange(timelineSelection.startTick, timelineSelection.endTick, targetTrackId)
                  }
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconLayers size={13} style={{ color: '#ffd43b' }} /> Duplicate Region
                </div>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+D</span>
              </button>

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  if (timelineSelection) {
                    muteTimelineRange(timelineSelection.startTick, timelineSelection.endTick, targetTrackId)
                  }
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconVolumeX size={13} style={{ color: '#ff6b8b' }} /> Mute / Unmute Region
                </div>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>M</span>
              </button>

              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  if (timelineSelection) {
                    const minT = Math.min(timelineSelection.startTick, timelineSelection.endTick)
                    const maxT = Math.max(timelineSelection.startTick, timelineSelection.endTick)
                    const notesToCopy = allNotes.filter(n => n.time >= minT && n.time < maxT && (!targetTrackId || n.trackId === targetTrackId))
                    if (notesToCopy.length > 0) {
                      useStore.getState().setClipboard(notesToCopy)
                      deleteTimelineRange(timelineSelection.startTick, timelineSelection.endTick, targetTrackId)
                      useStore.getState().showToast(`Cut ${notesToCopy.length} notes in region`, 'info')
                    }
                  }
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconScissors size={13} style={{ color: '#da77f2' }} /> Cut Region
                </div>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+X</span>
              </button>

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  if (timelineSelection) {
                    const minT = Math.min(timelineSelection.startTick, timelineSelection.endTick)
                    const maxT = Math.max(timelineSelection.startTick, timelineSelection.endTick)
                    const notesToCopy = allNotes.filter(n => n.time >= minT && n.time < maxT && (!targetTrackId || n.trackId === targetTrackId))
                    if (notesToCopy.length > 0) {
                      useStore.getState().setClipboard(notesToCopy)
                      useStore.getState().showToast(`Copied ${notesToCopy.length} notes in region`, 'info')
                    }
                  }
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconCopy size={13} style={{ color: '#4dabf7' }} /> Copy Region
                </div>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+C</span>
              </button>

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}
                onClick={() => {
                  if (timelineSelection) {
                    deleteTimelineRange(timelineSelection.startTick, timelineSelection.endTick, targetTrackId)
                  }
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,51,102,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconTrash size={13} /> Delete Region
                </div>
                <span style={{ fontSize: '10px', color: '#888', fontWeight: 600 }}>Del</span>
              </button>

              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  if (timelineSelection) {
                    splitTimelineRange(timelineSelection.startTick, timelineSelection.endTick, targetTrackId)
                  }
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconScissors size={13} style={{ color: '#fa5252' }} /> Split Notes at Boundaries
                </div>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+E</span>
              </button>

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  if (timelineSelection) {
                    quantizeTimelineRange(timelineSelection.startTick, timelineSelection.endTick, targetTrackId)
                  }
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconZap size={13} style={{ color: '#ffd43b' }} /> Quantize Region
                </div>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Q</span>
              </button>

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  if (timelineSelection) {
                    const minT = Math.min(timelineSelection.startTick, timelineSelection.endTick)
                    const maxT = Math.max(timelineSelection.startTick, timelineSelection.endTick)
                    useStore.getState().setLoopStart(minT)
                    useStore.getState().setLoopEnd(maxT)
                    useStore.getState().setLoopEnabled(true)
                  }
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconMusic size={13} style={{ color: '#4dabf7' }} /> Set as Loop Range
                </div>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Ctrl+L</span>
              </button>

              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

              <button
                style={{ width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: '#888', cursor: 'pointer', textAlign: 'left', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => {
                  setTimelineSelection(null)
                  setContextMenu(null)
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <span>Deselect Region</span>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 500 }}>Esc</span>
              </button>
            </div>
          ) : contextMenu.mode === 'glide' ? (
            <div style={{ padding: '6px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <button
                  onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'main' } : null)}
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                >
                  <IconChevronLeft size={13} />
                </button>
                <span style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase', fontWeight: 800 }}>Glide Chain</span>
                <span style={{ marginLeft: 'auto', fontSize: '9px', color: '#666', fontWeight: 600 }}>
                  {glideCandidateCount} note{glideCandidateCount === 1 ? '' : 's'}
                </span>
              </div>

              {glideCandidateCount < 2 ? (
                <div style={{ padding: '10px 12px', fontSize: '10px', color: '#666' }}>
                  Select at least two synth notes to link.
                </div>
              ) : (
                <div style={{ padding: '8px 12px 6px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <div>
                    {glideGroupLabel('ORDER')}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {renderGlideChip('Time', (glideMenu.order || 'time') === 'time', () => setGlideMenu(m => ({ ...m, order: 'time' })))}
                      {renderGlideChip('Reverse', glideMenu.order === 'reverseTime', () => setGlideMenu(m => ({ ...m, order: 'reverseTime' })))}
                      {renderGlideChip('Pitch ↑', glideMenu.order === 'pitchAscending', () => setGlideMenu(m => ({ ...m, order: 'pitchAscending' })))}
                      {renderGlideChip('Pitch ↓', glideMenu.order === 'pitchDescending', () => setGlideMenu(m => ({ ...m, order: 'pitchDescending' })))}
                    </div>
                  </div>

                  <div>
                    {glideGroupLabel('VOICE')}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {renderGlideChip('Source', (glideMenu.glideVoice ?? 'source') === 'source', () => setGlideMenu(m => ({ ...m, glideVoice: 'source' })), "The first note's instrument carries the pitch ramp")}
                      {renderGlideChip('Dest', glideMenu.glideVoice === 'destination', () => setGlideMenu(m => ({ ...m, glideVoice: 'destination' })), "The next note's instrument starts early at the previous pitch and carries the ramp")}
                      {renderGlideChip('Morph', glideMenu.glideVoice === 'morph', () => setGlideMenu(m => ({ ...m, glideVoice: 'morph' })), "Both instruments sound across the junction: the source fades out while the next note fades in")}
                    </div>
                  </div>

                  <div>
                    {glideGroupLabel('CURVE')}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {renderGlideChip('Line', glideMenu.curve === 'linear', () => setGlideMenu(m => ({ ...m, curve: 'linear' })))}
                      {renderGlideChip('S-Curve', (glideMenu.curve || 'cubicInOut') === 'cubicInOut', () => setGlideMenu(m => ({ ...m, curve: 'cubicInOut' })))}
                      {renderGlideChip('Ease In', glideMenu.curve === 'cubicIn', () => setGlideMenu(m => ({ ...m, curve: 'cubicIn' })))}
                      {renderGlideChip('Ease Out', glideMenu.curve === 'cubicOut', () => setGlideMenu(m => ({ ...m, curve: 'cubicOut' })))}
                      {renderGlideChip('Exp', glideMenu.curve === 'exponential', () => setGlideMenu(m => ({ ...m, curve: 'exponential' })))}
                      {renderGlideChip('Log', glideMenu.curve === 'logarithmic', () => setGlideMenu(m => ({ ...m, curve: 'logarithmic' })))}
                      {renderGlideChip('Sig', glideMenu.curve === 'sigmoid', () => setGlideMenu(m => ({ ...m, curve: 'sigmoid' })))}
                      {renderGlideChip('Math', glideMenu.curve === 'custom', () => setGlideMenu(m => ({ ...m, curve: 'custom' })))}
                    </div>
                    {glideMenu.curve === 'custom' && (
                      <input
                        type="text"
                        value={glideMenu.customEquation || ''}
                        placeholder="e.g. t * t, Math.sin(t * Math.PI / 2)"
                        onChange={e => setGlideMenu(m => ({ ...m, customEquation: e.target.value }))}
                        style={{
                          width: '100%',
                          marginTop: '5px',
                          background: '#191b21',
                          border: '1px solid rgba(255,255,255,0.08)',
                          color: '#da77f2',
                          borderRadius: '4px',
                          padding: '5px 8px',
                          fontSize: '10px',
                          fontFamily: 'monospace',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    )}
                  </div>

                  <div>
                    {glideGroupLabel('LENGTH')}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {renderGlideChip('Full', (glideMenu.durationMode || 'full') === 'full', () => setGlideMenu(m => ({ ...m, durationMode: 'full' })))}
                      {renderGlideChip('3/4', glideMenu.durationMode === 'threeQuarters', () => setGlideMenu(m => ({ ...m, durationMode: 'threeQuarters' })))}
                      {renderGlideChip('1/2', glideMenu.durationMode === 'half', () => setGlideMenu(m => ({ ...m, durationMode: 'half' })))}
                      {renderGlideChip('Fixed', glideMenu.durationMode === 'fixed', () => setGlideMenu(m => ({ ...m, durationMode: 'fixed', fixedTicks: m.fixedTicks ?? 48 })))}
                      {glideMenu.durationMode === 'fixed' && (
                        <input
                          type="number"
                          min={12}
                          step={12}
                          value={glideMenu.fixedTicks ?? 48}
                          onChange={e => setGlideMenu(m => ({ ...m, fixedTicks: Math.max(12, +e.target.value || 12) }))}
                          style={{
                            width: '58px',
                            background: '#191b21',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: '#da77f2',
                            borderRadius: '4px',
                            padding: '3px 6px',
                            fontSize: '9px',
                            outline: 'none'
                          }}
                        />
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    {renderGlideChip('Extend Legato', glideMenu.extendLegato ?? true, () => setGlideMenu(m => ({ ...m, extendLegato: !(m.extendLegato ?? true) })), 'Stretch each note so the glide reaches the next note (Source voice only)')}
                    {renderGlideChip('Loop Last', glideMenu.loopLastNote ?? false, () => setGlideMenu(m => ({ ...m, loopLastNote: !(m.loopLastNote ?? false) })), 'Glide from the last note back to the first')}
                  </div>

                  <button
                    onClick={handleApplyGlideChain}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      background: 'rgba(218,119,242,0.14)',
                      border: '1px solid rgba(218,119,242,0.35)',
                      borderRadius: '5px',
                      color: '#da77f2',
                      cursor: 'pointer',
                      fontSize: '10px',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(218,119,242,0.22)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(218,119,242,0.14)'}
                  >
                    <IconMusic size={12} /> Apply to {glideCandidateCount} Notes
                  </button>

                  <button
                    onClick={handleClearGlideChain}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      background: 'none',
                      border: '1px solid rgba(255,255,255,0.07)',
                      borderRadius: '5px',
                      color: '#999',
                      cursor: 'pointer',
                      fontSize: '10px',
                      fontWeight: 600
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    Clear Glides
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '6px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '4px' }}>
                <button
                  onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'main' } : null)}
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                >
                  <IconChevronLeft size={13} />
                </button>
                <span style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase', fontWeight: 800 }}>Select Parent Track</span>
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }} className="thin-scroll">
                {renderParentTracksSelectionTree()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
