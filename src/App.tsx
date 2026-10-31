// MuseGrid App Component - Updated pull request submission
import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import GridCanvas from './renderer/GridCanvas'
import DrumSequencer from './renderer/DrumSequencer'
import ScoreEditor from './renderer/ScoreEditor'
import LeftPane from './ui/LeftPane'
import ScorePreviewModal from './ui/ScorePreviewModal'
import ImportAudioModal from './ui/ImportAudioModal'
import { RightPane } from './ui/RightPane'
import HelpPane from './ui/HelpPane'
import StartScreenModal from './ui/StartScreenModal'
import { ScriptingModal } from './ui/ScriptingModal'
import { SynthStudioModal } from './ui/SynthStudioModal'
import { DrumDesignerModal } from './ui/DrumDesignerModal'
import { audioEngine } from './engine/AudioEngine'
import { recordingEngine } from './engine/RecordingEngine'
import { scheduler } from './engine/Scheduler'
import { useStore, saveRecentProject, type ProjectTab } from './engine/store'
import { DEFAULT_DRUM_KIT, DEFAULT_SYNTH_PRESET } from './utils/instruments'
import { saveFileWithDialog } from './utils/fileExport'
import { readMuzTrackExpression } from './utils/scoreExport'
import { ProjectTabBar } from './ui/ProjectTabBar'
import { IconTrash, IconDownload, IconSave, IconPlay, IconStop, IconMidi, IconAlign, IconSkipBack, IconChevronDown, IconMaximize, IconMusic, IconStretch, IconChevronLeft, IconChevronRight, IconSync, IconHelp, IconTarget, IconSliders, IconAlertTriangle, IconMuseLogo } from './ui/Icons'

function TransportTimeDisplay() {
  const playheadPosition = useStore(s => s.playheadPosition)
  const ticks = Math.max(0, Math.round(playheadPosition))
  const bar = Math.floor(ticks / 192) + 1
  const beat = Math.floor((ticks % 192) / 48) + 1
  const subTick = Math.floor(ticks % 48)

  const pad = (n: number, width: number = 2) => String(n).padStart(width, '0')

  return (
    <div
      title="Current Position (Bar : Beat : Ticks)"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        background: 'rgba(0, 0, 0, 0.45)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '5px',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: '11px',
        fontWeight: 700,
        color: '#00e6ff',
        letterSpacing: '0.04em',
        userSelect: 'none',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)'
      }}
    >
      <span style={{ fontSize: '8.5px', color: '#68738a', fontWeight: 800, marginRight: '2px' }}>BAR</span>
      <span>{pad(bar, 3)}</span>
      <span style={{ opacity: 0.35 }}>:</span>
      <span>{pad(beat, 2)}</span>
      <span style={{ opacity: 0.35 }}>:</span>
      <span style={{ color: '#8899aa' }}>{pad(subTick, 2)}</span>
    </div>
  )
}

export const getProjectDataString = () => {
  const state = useStore.getState()
  return JSON.stringify({
    bpm: state.bpm, tracks: state.tracks, notes: state.notes, activeTrackId: state.activeTrackId,
    midiRemapData: { ...state.midiRemapData, midi: null }, loopEnabled: state.loopEnabled, loopStart: state.loopStart, loopEnd: state.loopEnd,
    scaleLock: state.scaleLock, snapEnabled: state.snapEnabled, snapResolution: state.snapResolution, gridBlockTicks: state.gridBlockTicks,
    gridShadeEvery: state.gridShadeEvery, gridColumnCount: state.gridColumnCount, swing: state.swing, metronomeEnabled: state.metronomeEnabled,
    metronomeVolume: state.metronomeVolume, quantizeInputEnabled: state.quantizeInputEnabled,
    dropSnap: state.dropSnap, activeTool: state.activeTool, noteInspectorEnabled: state.noteInspectorEnabled,
    midiOverdub: state.midiOverdub, completeNotesOnPause: state.completeNotesOnPause,
    playheadFollowMode: state.playheadFollowMode, automationCurves: state.automationCurves,
    // Without the target map a reloaded project would read a pan/volume/VST3 curve as velocity.
    automationTargets: state.automationTargets,
    automationLanes: state.automationLanes, tempoMap: state.tempoMap, meterMap: state.meterMap, showConductor: state.showConductor,
    clips: state.clips, groups: state.groups, drumSteps: state.drumSteps,
    timeSignature: state.timeSignature, metronomeSettings: state.metronomeSettings, studioSettings: state.studioSettings, micSettings: state.micSettings, customFxConfigs: state.customFxConfigs,
    pitchSnapEnabled: state.pitchSnapEnabled, pitchDropSnap: state.pitchDropSnap, pitchSnapSensitivity: state.pitchSnapSensitivity, verticalMergeThreshold: state.verticalMergeThreshold,
    verticalStretchMode: state.verticalStretchMode, customSynthRows: state.customSynthRows, customDrumRows: state.customDrumRows, synthLowerOctave: state.synthLowerOctave,
    synthUpperOctave: state.synthUpperOctave, minNoteSize: state.minNoteSize, autoExtendGrid: state.autoExtendGrid, gridResizable: state.gridResizable, readOnlyMode: state.readOnlyMode,
    // Modern settings & presets
    voicePresets: state.voicePresets,
    deduplicateEnabled: state.deduplicateEnabled, deduplicateOverlapThreshold: state.deduplicateOverlapThreshold, deduplicateProximityTolerance: state.deduplicateProximityTolerance,
    grooveTemplates: state.grooveTemplates, activeGrooveTemplateId: state.activeGrooveTemplateId, grooveTimingStrength: state.grooveTimingStrength, grooveVelocityStrength: state.grooveVelocityStrength, grooveExtractionTargetAll: state.grooveExtractionTargetAll, quantizeStrength: state.quantizeStrength,
    articulationPresets: state.articulationPresets,
    zoomSynth: state.zoomSynth, zoomDrum: state.zoomDrum, syncZoom: state.syncZoom,
    gridSplitOrder: state.gridSplitOrder, gridPaneMode: state.gridPaneMode,
    showSynthVelocity: state.showSynthVelocity, showDrumVelocity: state.showDrumVelocity, vocalVelocityMin: state.vocalVelocityMin, vocalVelocityMax: state.vocalVelocityMax, vocalVelocityScale: state.vocalVelocityScale, vocalVelocityEnabled: state.vocalVelocityEnabled,
    horizScrollLockEnabled: state.horizScrollLockEnabled, vertScrollLockEnabled: state.vertScrollLockEnabled, scrollBoth: state.scrollBoth,
    columnWidths: state.columnWidths, sharedPanX: state.sharedPanX
  })
}

function ToastContainer() {
  const toast = useStore(s => s.toast)
  const clearToast = useStore(s => s.clearToast)
  if (!toast) return null
  return (
    <div style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 999999,
      background: toast.type === 'error' ? '#ff3366' : toast.type === 'success' ? '#69db7c' : '#333',
      color: toast.type === 'info' ? 'white' : '#111',
      padding: '12px 24px', borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      fontWeight: 600, fontSize: '13px',
      display: 'flex', alignItems: 'center', gap: '12px',
      animation: 'slideUp 0.3s ease-out'
    }}>
      {toast.message}
      <button onClick={clearToast} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.7, padding: 0, fontSize: '16px', lineHeight: 1 }}>×</button>
    </div>
  )
}

const TIME_SIGNATURE_PRESETS = ['4/4', '3/4', '2/4', '5/4', '6/4', '7/4', '6/8', '7/8', '12/8']

/** BPM is stored as a float; the pod shows two decimals so fractional tempo is visible. */
const formatBpm = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : '120.00')

function App() {
  const isPlaying = useStore(state => state.isPlaying)
  const bpm = useStore(state => state.bpm)
  const timeSignature = useStore(state => state.timeSignature)
  const setTimeSignature = useStore(state => state.setTimeSignature)
  const isInit = useRef(false)

  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea') return
      e.preventDefault()
    }
    window.addEventListener('contextmenu', handleGlobalContextMenu)
    return () => window.removeEventListener('contextmenu', handleGlobalContextMenu)
  }, [])


  const tracks = useStore(s => s.tracks)
  const updateTracks = useStore(s => s.updateTracks)
  const requestCanvasAlign = useStore(s => s.requestCanvasAlign)
  const playheadFollowMode = useStore(s => s.playheadFollowMode)
  const setPlayheadFollowMode = useStore(s => s.setPlayheadFollowMode)
  const gridResizable = useStore(s => s.gridResizable)
  const setGridResizable = useStore(s => s.setGridResizable)
  const readOnlyMode = useStore(s => s.readOnlyMode)

  const [drumSequencerMode, setDrumSequencerMode] = useState(false)
  const [synthScoreMode, setSynthScoreMode] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const saveContainerRef = useRef<HTMLDivElement>(null)
  const exportContainerRef = useRef<HTMLDivElement>(null)
  const isScorePreviewVisible = useStore(s => s.isScorePreviewVisible)
  const setIsScorePreviewVisible = useStore(s => s.setIsScorePreviewVisible)
  const [showNewProjectConfirm, setShowNewProjectConfirm] = useState(false)
  const [newProjectClosing, setNewProjectClosing] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearConfirmClosing, setClearConfirmClosing] = useState(false)
  const [showSaveCloseConfirm, setShowSaveCloseConfirm] = useState(false)
  const [saveCloseClosing, setSaveCloseClosing] = useState(false)
  const [isSavingAndClosing, setIsSavingAndClosing] = useState(false)
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const openTabs = useStore(s => s.openTabs)
  const activeTabId = useStore(s => s.activeTabId)
  const openProjectInTab = useStore(s => s.openProjectInTab)
  const closeTab = useStore(s => s.closeTab)
  const [tabPendingClose, setTabPendingClose] = useState<ProjectTab | null>(null)
  const [isInitialLaunch, setIsInitialLaunch] = useState(() => {
    return localStorage.getItem('musegrid_show_start_screen') !== 'false'
  })
  const hasOpenProjects = openTabs.length > 0 && !isInitialLaunch

  const handleRequestCloseTab = (tab: ProjectTab) => {
    const state = useStore.getState()
    const isActive = state.activeTabId === tab.id
    const isDirty = isActive ? state.isDirty : tab.isDirty
    const hasNotes = isActive ? (state.notes.length > 0) : ((tab.projectData?.notes?.length ?? 0) > 0)
    const filePath = isActive ? state.projectFilePath : tab.filePath
    const name = isActive ? (state.projectName || tab.name) : tab.name

    const hasUnsavedChanges = isDirty || (!filePath && hasNotes)

    if (hasUnsavedChanges) {
      setTabPendingClose({ ...tab, name, filePath, isDirty: true })
    } else {
      closeTab(tab.id)
    }
  }

  const projectName = useStore(s => s.projectName)
  const isDirty = useStore(s => s.isDirty)
  const dirtyTabCount = openTabs.filter(t => t.id === activeTabId ? isDirty : t.isDirty).length
  const projectFilePath = useStore(s => s.projectFilePath)
  const resetZoom = useStore(s => s.resetZoom)
  const projectExportData = useStore(s => s.projectExportData)
  const isExporting = projectExportData?.isRendering

  const isDraggingDivider = useRef(false)
  const isDraggingVerticalDivider = useRef(false)

  const leftPaneWidth = useStore(s => s.leftPaneWidth)
  const setLeftPaneWidth = useStore(s => s.setLeftPaneWidth)
  const leftPaneCollapsed = useStore(s => s.leftPaneCollapsed)
  const setLeftPaneCollapsed = useStore(s => s.setLeftPaneCollapsed)
  const splitRatio = useStore(s => s.splitRatio)
  const setSplitRatio = useStore(s => s.setSplitRatio)
  const gridSplitOrder = useStore(s => s.gridSplitOrder)
  const gridPaneMode = useStore(s => s.gridPaneMode)
  const bothGridActive = useStore(s => s.bothGridActive)
  const activeTrackId = useStore(s => s.activeTrackId)
  const zoomSynth = useStore(s => s.zoomSynth)
  const setZoomSynth = useStore(s => s.setZoomSynth)
  const zoomDrum = useStore(s => s.zoomDrum)
  const setZoomDrum = useStore(s => s.setZoomDrum)
  const syncZoom = useStore(s => s.syncZoom)
  const setSyncZoom = useStore(s => s.setSyncZoom)

  const [synthZoomInput, setSynthZoomInput] = useState(String(Math.round(zoomSynth * 100)))
  const [drumZoomInput, setDrumZoomInput] = useState(String(Math.round(zoomDrum * 100)))
  const isSynthZoomFocused = useRef(false)
  const isDrumZoomFocused = useRef(false)

  const [localBpm, setLocalBpm] = useState(formatBpm(bpm))
  const isBpmFocused = useRef(false)

  useEffect(() => {
    if (!isBpmFocused.current) {
      setLocalBpm(formatBpm(bpm))
    }
  }, [bpm])

  useEffect(() => {
    if (!isSynthZoomFocused.current) {
      setSynthZoomInput(String(Math.round(zoomSynth * 100)))
    }
  }, [zoomSynth])

  useEffect(() => {
    if (!isDrumZoomFocused.current) {
      setDrumZoomInput(String(Math.round(zoomDrum * 100)))
    }
  }, [zoomDrum])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingDivider.current) {
        const workspaceHeight = window.innerHeight - 56
        const newRatio = (e.clientY - 56) / workspaceHeight
        setSplitRatio(Math.max(0.2, Math.min(0.8, newRatio)))
      }
      if (isDraggingVerticalDivider.current) {
        setLeftPaneWidth(Math.max(240, Math.min(700, e.clientX)))
      }
    }
    const handleMouseUp = () => {
      isDraggingDivider.current = false
      isDraggingVerticalDivider.current = false
      document.body.style.cursor = 'default'
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportContainerRef.current && !exportContainerRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
      if (saveContainerRef.current && !saveContainerRef.current.contains(e.target as Node)) {
        setShowSaveMenu(false)
      }
    }
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  useEffect(() => {
    document.title = `MuseGrid - ${projectName || 'Untitled'}${isDirty ? '*' : ''}`
  }, [projectName, isDirty])

  const handleSaveProject = async (): Promise<boolean> => {
    const ipc = (window as any).ipcRenderer
    const state = useStore.getState()
    if (ipc) {
      if (state.projectFilePath) {
        const success = await ipc.invoke('save-project-path', getProjectDataString(), state.projectFilePath)
        if (success) {
          state.setIsDirty(false)
          state.showToast('Project saved', 'success')
          saveRecentProject({
            name: state.projectName || 'Untitled Project',
            filePath: state.projectFilePath || undefined,
            bpm: state.bpm,
            trackCount: state.tracks.length
          })
          return true
        } else {
          state.showToast('Failed to save project', 'error')
          return false
        }
      } else {
        const filePath = await ipc.invoke('save-project', getProjectDataString())
        if (filePath) {
          const pName = filePath.split(/[\\/]/).pop()?.replace('.muz', '') || 'Project'
          state.setProjectInfo({ projectFilePath: filePath, projectName: pName })
          state.setIsDirty(false)
          state.showToast('Project saved', 'success')
          saveRecentProject({
            name: pName,
            filePath: filePath,
            bpm: state.bpm,
            trackCount: state.tracks.length
          })
          return true
        }
        return false // cancelled
      }
    } else {
      const blob = new Blob([getProjectDataString()], { type: 'application/json' })
      const saved = await saveFileWithDialog(blob, {
        filename: 'project.muz',
        title: 'Save Project',
        filters: [{ name: 'MuseGrid Project', extensions: ['muz', 'muse'] }]
      })
      if (saved) {
        state.setIsDirty(false)
        return true
      }
      return false
    }
  }

  const forceQuitApp = () => {
    const ipc = (window as any).ipcRenderer
    if (ipc && typeof ipc.invoke === 'function') {
      ipc.invoke('force-quit-app').catch(() => ipc.invoke('quit-app')).catch(() => window.close())
    } else {
      window.close()
    }
  }

  const requestAppClose = () => {
    const state = useStore.getState()
    const hasNotes = state.notes.length > 0
    // Background tabs can hold unsaved edits too; quitting must not skip them.
    const hasDirtyTab = state.isDirty || state.openTabs.some(t => t.id !== state.activeTabId && t.isDirty)
    if (hasDirtyTab || (hasNotes && !state.projectFilePath)) {
      setShowSaveCloseConfirm(true)
    } else {
      forceQuitApp()
    }
  }

  const handleOpenProject = async () => {
    const ipc = (window as any).ipcRenderer
    if (ipc) {
      try {
        const res = await ipc.invoke('open-project')
        if (!res) return
        if (res.error) {
          useStore.getState().showToast(res.error, 'error')
          return
        }
        if (res.filePath && (res.filePath.toLowerCase().endsWith('.mid') || res.filePath.toLowerCase().endsWith('.midi'))) {
          useStore.getState().showToast('Standard MIDI files (.mid) require channel mapping. Please open a .muz project.', 'info')
          return
        }

        let parsed: any
        try {
          parsed = JSON.parse(res.data)
        } catch {
          useStore.getState().showToast('File is corrupted or not a valid JSON/MUZ project.', 'error')
          return
        }

        if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.tracks) && !Array.isArray(parsed.notes) && parsed.format !== 'muztrack')) {
          useStore.getState().showToast('Invalid project file: missing valid track/note structures.', 'error')
          return
        }

        if (parsed.format === 'muztrack') {
          const data = parsed
          const pName = res.filePath.split(/[\\/]/).pop().replace(/\.(muz|muztrack)$/i, '')
          openProjectInTab({
            name: pName,
            filePath: res.filePath,
            projectData: {
              projectName: pName,
              projectFilePath: res.filePath,
              automationTargets: {},
              automationLanes: {},
              bpm: data.bpm || 120,
              timeSignature: data.timeSignature || '4/4',
              tracks: (data.tracks || []).map((t: any) => ({
                ...t,
                instrument: t.instrument || 'synth',
                volume: t.volume ?? 0.8,
                pan: t.pan ?? 0,
                muted: false,
                soloed: false
              })),
              notes: (data.notes || []).map((n: any) => ({
                id: n.id || `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                trackId: n.trackId,
                pitch: n.pitch,
                time: n.time,
                duration: n.duration,
                velocity: n.velocity ?? 0.8,
                lyric: n.lyric,
                ...(n.velocityInspectorModified ? { velocityInspectorModified: true } : {}),
                ...readMuzTrackExpression(n)
              }))
            }
          })
          setIsInitialLaunch(false)
          ipc.invoke('set-fullscreen', true).catch(() => {})
          useStore.getState().showToast(`Opened .muztrack project (${data.tracks.length} tracks)`, 'success')
          return
        }
        const pName = res.filePath.split(/[\\/]/).pop().replace(/\.(muz|muztrack)$/i, '')
        openProjectInTab({
          name: pName,
          filePath: res.filePath,
          projectData: {
            ...parsed,
            automationTargets: parsed.automationTargets ?? {},
            automationLanes: parsed.automationLanes ?? {},
            projectFilePath: res.filePath,
            projectName: pName
          }
        })
        setIsInitialLaunch(false)
        ipc.invoke('set-fullscreen', true).catch(() => {})
        useStore.getState().showToast(`Opened ${res.filePath.split(/[\\/]/).pop()}`, 'success')
      } catch (err) {
        console.error(err)
        useStore.getState().showToast('Failed to load project: Corrupted or unreadable file', 'error')
      }
    } else {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = '.muz,.muztrack'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const parsed = JSON.parse(text)
          if (parsed.format === 'muztrack') {
            const data = parsed
            useStore.getState().loadState({
              projectName: file.name.replace(/\.(muz|muztrack)$/i, ''),
              automationTargets: {},
              automationLanes: {},
              bpm: data.bpm || 120,
              timeSignature: data.timeSignature || '4/4',
              tracks: data.tracks.map((t: any) => ({
                ...t,
                instrument: t.instrument || 'synth',
                volume: t.volume ?? 0.8,
                pan: t.pan ?? 0,
                muted: false,
                soloed: false
              })),
              notes: data.notes.map((n: any) => ({
                id: n.id || `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                trackId: n.trackId,
                pitch: n.pitch,
                time: n.time,
                duration: n.duration,
                velocity: n.velocity ?? 0.8,
                lyric: n.lyric
              }))
            })
            audioEngine.setBpm(data.bpm || 120)
            useStore.getState().tracks.forEach(track => { audioEngine.createInstrument(track.id, track.instrument || 'synth') })
            const state = useStore.getState()
            if (state.tracks.length > 0) state.setActiveTrackId(state.tracks[0].id)
            useStore.getState().showToast(`Opened .muztrack project (${data.tracks.length} tracks)`, 'success')
            return
          }
          useStore.getState().loadState({ ...parsed, automationTargets: parsed.automationTargets ?? {}, automationLanes: parsed.automationLanes ?? {}, projectName: file.name.replace('.muz', '') })
          audioEngine.setBpm(parsed.bpm || 120)
          useStore.getState().tracks.forEach(track => { audioEngine.createInstrument(track.id, track.instrument || 'synth') })
          const state = useStore.getState()
          const activeExists = state.tracks.some(t => t.id === state.activeTrackId)
          if (!activeExists && state.tracks.length > 0) state.setActiveTrackId(state.tracks[0].id)
        } catch (err) { console.error('Failed to parse project file', err); useStore.getState().showToast('Failed to load project: Invalid file format', 'error') }
      }
      input.click()
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault()
        if ((window as any).ipcRenderer) {
          (window as any).ipcRenderer.invoke('toggle-fullscreen').catch(() => {})
        } else {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {})
          } else {
            document.exitFullscreen().catch(() => {})
          }
        }
        return
      }

      const activeEl = document.activeElement
      const isInput =
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.tagName === 'SELECT' ||
        activeEl?.hasAttribute('contenteditable') ||
        Boolean(activeEl?.closest('.monaco-editor')) ||
        Boolean(activeEl?.closest('.animate-modal-bg')) ||
        Boolean(activeEl?.closest('.animate-modal-card'))

      const isTargetInModal =
        e.target instanceof HTMLElement &&
        (Boolean(e.target.closest('.monaco-editor')) ||
         Boolean(e.target.closest('.animate-modal-bg')) ||
         Boolean(e.target.closest('.animate-modal-card')))

      if (isInput || isTargetInModal || useStore.getState().isScriptingModalVisible) return

      // Global Spacebar Play / Pause
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        audioEngine.togglePlay()
        return
      }

      // Ctrl+S / Cmd+S (Save Project)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveProject()
        return
      }

      // Ctrl+N / Cmd+N (New Project Tab)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleNewProject()
        return
      }

      // Ctrl+O / Cmd+O (Open Project)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handleOpenProject()
        return
      }

      // Tool Switching Shortcuts (when no modifier key is held)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'b' || k === 'd') {
          useStore.getState().setActiveTool('draw')
          return
        }
        if (k === 'e') {
          useStore.getState().setActiveTool('erase')
          return
        }
        if (k === 'v' || k === 's') {
          useStore.getState().setActiveTool('select')
          return
        }
        if (k === 'c' || k === 'x') {
          useStore.getState().setActiveTool('slice')
          return
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    recordingEngine.init()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])


  const handleExportAudio = (format: 'wav' | 'mp3') => {
    const state = useStore.getState()
    if (state.notes.length === 0) { useStore.getState().showToast('No notes to export', 'error'); return }
    const lastNoteTick = state.notes.length > 0 ? Math.max(...state.notes.map(n => n.time + n.duration)) : 768

    state.setProjectExportData({
      type: format,
      trackId: undefined,
      octaveOffset: 0,
      semitoneOffset: 0,
      normalize: true,
      includeMetronome: false,
      autoFade: true,
      isRendering: false,
      progress: 0,
      startTick: state.loopEnabled ? state.loopStart : 0,
      endTick: state.loopEnabled ? state.loopEnd : lastNoteTick,
      includeProceduralFx: state.studioSettings.proceduralFxEnabled,
      bounceMode: 'hybrid',
      mp3Kbps: 320,
      realtimeTailSeconds: 2
    })
  }


  const initDefaultTracks = () => {
    useStore.getState().addTrack({
      id: 'track_synth',
      name: 'Default Synth',
      instrument: 'synth',
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      color: '#4dabf7',
      collapsed: true,
      synthPreset: DEFAULT_SYNTH_PRESET,
      delayTime: 0.25,
      delayFeedback: 0.25
    })
    audioEngine.createInstrument('track_synth', 'synth')

    useStore.getState().addTrack({
      id: 'track_drum',
      name: 'Drum Machine',
      instrument: 'drum',
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      color: '#ff9900',
      collapsed: true,
      drumKit: DEFAULT_DRUM_KIT,
      delayTime: 0.25,
      delayFeedback: 0.25
    })
    audioEngine.createInstrument('track_drum', 'drum')
    useStore.getState().setActiveTrackId('track_synth')
  }

  const confirmClearProject = () => {
    setClearConfirmClosing(true)
    setTimeout(() => {
      setShowClearConfirm(false)
      setClearConfirmClosing(false)
      useStore.getState().clearProject()
      useStore.getState().showToast('Project cleared', 'success')
    }, 180)
  }

  const confirmNewProject = () => {
    setNewProjectClosing(true)
    setTimeout(() => {
      setShowNewProjectConfirm(false)
      setNewProjectClosing(false)
      // Stop playback and completely clear all tracks and VST3 instances
      audioEngine.resetForNewProject()
      // Reset store to blank state with default tracks to prevent layout shifting / unmounting flicker
      useStore.getState().loadState({
        projectName: null,
        projectFilePath: null,
        bpm: 120,
        scaleLock: {
          enabled: false,
          root: 0,
          mode: 'major',
          accidental: 'sharp'
        },
        gridSplitOrder: 'synth-first',
        gridPaneMode: 'split',
        tracks: [
          {
            id: 'track_synth',
            name: 'Default Synth',
            instrument: 'synth',
            volume: 1,
            pan: 0,
            muted: false,
            soloed: false,
            color: '#4dabf7',
            collapsed: true,
            synthPreset: DEFAULT_SYNTH_PRESET,
            delayTime: 0.25,
            delayFeedback: 0.25
          },
          {
            id: 'track_drum',
            name: 'Drum Machine',
            instrument: 'drum',
            volume: 1,
            pan: 0,
            muted: false,
            soloed: false,
            color: '#ff9900',
            collapsed: true,
            drumKit: DEFAULT_DRUM_KIT,
            delayTime: 0.25,
            delayFeedback: 0.25
          }
        ],
        notes: [],
        loopEnabled: false,
        loopStart: 0,
        loopEnd: 768,
        columnWidths: {},
        sharedPanX: 0,
        gridBlockTicks: 48,
        gridShadeEvery: 4,
        gridColumnCount: 200,
        activeTrackId: 'track_synth',
        selectedNoteIds: [],
        clips: [],
        groups: [],
        automationCurves: {},
        automationTargets: {},
        automationLanes: {},
        tempoMap: [],
        meterMap: [],
        showConductor: false,
        playheadFollowMode: 'playhead',
        snapResolution: 48,
        projectExportData: null,
        midiRemapData: {
          midi: null,
          filename: '',
          drumMap: { 35: 0, 36: 0, 38: 1, 40: 1, 42: 2, 44: 2, 46: 3, 49: 4, 51: 4 },
          synthMap: {},
          pitchSensitivity: 50,
          channelStates: {},
          octaveOffset: 0,
          semitoneOffset: 0,
          timeScale: 1.0,
          velocityScale: 1.0,
          velocityOffset: 0,
          humanizeTiming: 0,
          humanizeVelocity: 0,
          repeatCount: 1
        }
      })

      // Create instruments on Audio Engine eagerly
      audioEngine.createInstrument('track_synth', 'synth')
      audioEngine.createInstrument('track_drum', 'drum')

      // Remove autosave
      localStorage.removeItem('musegrid_autosave')

      // Re-apply default preferences if user saved any
      try {
        const savedDefaults = localStorage.getItem('musegrid_default_preferences')
        if (savedDefaults) {
          const parsed = JSON.parse(savedDefaults)
          if (parsed && typeof parsed === 'object') {
            const topUpdates: any = {}
            const keys = [
              'engineMode', 'metronomeEnabled', 'metronomeVolume',
              'bpm', 'timeSignature', 'swing',
              'playheadFollowMode', 'completeNotesOnPause', 'midiOverdub',
              'activeTool', 'noteInspectorEnabled', 'readOnlyMode',
              'snapEnabled', 'snapResolution', 'gridBlockTicks', 'dropSnap',
              'gridShadeEvery', 'gridColumnCount', 'drumSteps', 'autoExtendGrid',
              'minNoteSize', 'gridResizable', 'quantizeInputEnabled', 'quantizeStrength',
              'scaleLock', 'pitchSnapEnabled', 'pitchDropSnap', 'pitchSnapSensitivity',
              'verticalMergeThreshold', 'verticalStretchMode', 'glideStyle',
              'synthLowerOctave', 'synthUpperOctave', 'customSynthRows', 'customDrumRows',
              'gridSplitOrder', 'gridPaneMode', 'splitRatio', 'leftPaneTopRatio',
              'isLeftPaneFlipped', 'leftPaneWidth', 'leftPaneCollapsed', 'scrollBoth',
              'bothGridActive', 'horizScrollLockEnabled', 'vertScrollLockEnabled',
              'zoomSynth', 'zoomDrum', 'syncZoom', 'ghostNotesEnabled',
              'ghostNoteOpacity', 'ghostCrossInstrument', 'showSynthVelocity',
              'showDrumVelocity', 'vocalVelocityEnabled', 'vocalVelocityMin',
              'vocalVelocityMax', 'vocalVelocityScale', 'deduplicateEnabled',
              'deduplicateProximityTolerance', 'deduplicateOverlapThreshold',
              'grooveTemplates', 'activeGrooveTemplateId', 'grooveTimingStrength',
              'grooveVelocityStrength', 'grooveExtractionTargetAll',
              'customFxConfigs', 'voicePresets', 'midiRemapData',
              'articulationPresets'
            ]
            keys.forEach(k => {
              if (parsed[k] !== undefined) topUpdates[k] = parsed[k]
            })
            if (parsed.studioSettings) {
              topUpdates.studioSettings = { ...useStore.getState().studioSettings, ...parsed.studioSettings }
            }
            if (parsed.metronomeSettings) {
              topUpdates.metronomeSettings = { ...useStore.getState().metronomeSettings, ...parsed.metronomeSettings }
            }
            if (parsed.micSettings) {
              topUpdates.micSettings = { ...useStore.getState().micSettings, ...parsed.micSettings }
            }
            if (parsed.bpm) audioEngine.setBpm(parsed.bpm)
            useStore.setState(topUpdates)
          }
        }
      } catch (e) {
        console.error('Failed to load default preferences on new project', e)
      }

      // Switch window to fullscreen for workspace
      const ipc = (window as any).ipcRenderer
      if (ipc && typeof ipc.invoke === 'function') {
        ipc.invoke('set-fullscreen', true).catch(() => {})
      }
    }, 200)
  }

  const handleNewProject = () => {
    setIsInitialLaunch(false)
    openProjectInTab({ name: 'Untitled Project', isDirty: false, previewSnippet: 'Blank Project' })
    const ipc = (window as any).ipcRenderer
    if (ipc && typeof ipc.invoke === 'function') {
      ipc.invoke('set-fullscreen', true).catch(() => {})
    }
  }

  useEffect(() => {
    if (isInit.current) return
    isInit.current = true

    // Initialize the scheduler so it listens to store changes
    scheduler.init()

    // EAGERLY init audio engine so AudioContext is ready before first Play click
    audioEngine.init()

    // Create a default synth and drum track if none exist
    if (useStore.getState().tracks.length === 0) {
      initDefaultTracks()
    } else {
      // Initialize existing instruments from autosave
      const state = useStore.getState()
      state.tracks.forEach(track => {
        audioEngine.createInstrument(track.id, track.instrument || 'synth')
      })

      // Auto-select first track if none selected OR selected track doesn't exist
      const activeExists = state.tracks.some(t => t.id === state.activeTrackId)
      if (!activeExists && state.tracks.length > 0) {
        state.setActiveTrackId(state.tracks[0].id)
      }
    }

    // Auto-open Start Hub on startup if enabled
    const showStartup = localStorage.getItem('musegrid_show_start_screen') !== 'false'
    if (showStartup) {
      useStore.getState().setIsStartScreenOpen(true)
    } else {
      const ipc = (window as any).ipcRenderer
      if (ipc && typeof ipc.invoke === 'function') {
        ipc.invoke('set-fullscreen', true).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    ;(window as any).__handleAppCloseRequest = () => {
      requestAppClose()
    }

    const handleCustomCloseEvent = () => {
      requestAppClose()
    }
    window.addEventListener('app-request-close', handleCustomCloseEvent)

    const ipc = (window as any).ipcRenderer
    if (ipc && typeof ipc.on === 'function') {
      ipc.on('app-request-close', handleCustomCloseEvent)
    }

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useStore.getState()
      if (state.isDirty || state.openTabs.some(t => t.id !== state.activeTabId && t.isDirty) || (state.notes.length > 0 && !state.projectFilePath)) {
        e.preventDefault()
        e.returnValue = ''
        requestAppClose()
        return ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      delete (window as any).__handleAppCloseRequest
      window.removeEventListener('app-request-close', handleCustomCloseEvent)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (ipc && typeof ipc.off === 'function') {
        ipc.off('app-request-close', handleCustomCloseEvent)
      }
    }
  }, [])

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', flexDirection: 'column', background: '#0a0a0f', overflow: 'hidden' }}>
      <ToastContainer />
      {/* If no project is open (e.g. startup or all closed), render full-screen Start Screen edge-to-edge without tabs */}
      {!hasOpenProjects ? (
        <StartScreenModal
          embedded={true}
          isInitialLaunch={isInitialLaunch}
          onNewProject={handleNewProject}
          onOpenProject={handleOpenProject}
          onProjectLoaded={() => setIsInitialLaunch(false)}
        />
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          overflow: 'hidden'
        }}>
          {/* Top Header / Studio Pro Transport Deck */}
          <div className="glass-panel" style={{ height: '54px', width: '100%', maxWidth: '100vw', boxSizing: 'border-box', overflow: 'visible', position: 'relative', display: 'flex', alignItems: 'center', padding: '0 12px', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', zIndex: 100 }}>
            
            {/* Left Header Section: Brand + Project Tabs Strip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
              {/* Top-Left Corner Brand Icon */}
              <div
                onClick={() => useStore.getState().openStartTab()}
                title="MuseGrid Studio (Return to Start Screen)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  flexShrink: 0,
                  transition: 'opacity 0.15s ease'
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                <IconMuseLogo size={22} />
                <span style={{ fontSize: '13px', fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>
                  MUSE<span style={{ color: '#4dabf7' }}>GRID</span>
                </span>
              </div>

              <div style={{ width: '1px', height: '18px', background: 'rgba(255, 255, 255, 0.08)', flexShrink: 0 }} />

              {/* Project Tabs Strip */}
              <ProjectTabBar onRequestCloseTab={handleRequestCloseTab} />
            </div>

        {activeTabId !== 'start' ? (
          <>
            {/* Central Hardware Transport Deck */}
            <div className="transport-deck" style={{ margin: '0 auto', flexShrink: 0 }}>
          {/* Return to Zero */}
          <button
            onClick={() => {
              useStore.getState().setPlayheadPosition(0)
              Tone.Transport.ticks = 0
            }}
            title="Return to Zero (Ticks: 0)"
            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#b8c0d4', borderRadius: '5px', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <IconSkipBack size={13} />
          </button>

          {/* Main Play / Stop Button */}
          <button
            className={`btn-transport-play ${isPlaying ? 'playing' : 'idle'}`}
            onClick={() => audioEngine.togglePlay()}
            title={isPlaying ? "Stop Playback (Space)" : "Start Playback (Space)"}
          >
            {isPlaying ? <><IconStop size={12} fill="#05190e" /> STOP</> : <><IconPlay size={12} fill="#00e676" /> PLAY</>}
          </button>

          {/* Live Position Counter */}
          <TransportTimeDisplay />

          <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />

          {/* Tempo (BPM) Pod */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', padding: '2px 6px' }}>
            <span style={{ fontSize: '9px', color: '#6d7588', fontWeight: 800, letterSpacing: '0.04em' }}>BPM</span>
            <button
              onClick={() => {
                const cur = Number(localBpm) || 120
                const next = Math.max(20, Math.round((cur - 1) * 100) / 100)
                setLocalBpm(formatBpm(next))
                audioEngine.setBpm(next)
              }}
              title="Decrease Tempo by 1 BPM"
              style={{ background: 'transparent', border: 'none', color: '#8b92a5', cursor: 'pointer', padding: '0 2px', fontSize: '11px', fontWeight: 900, lineHeight: 1 }}
            >−</button>
            <input
              type="number"
              step="any"
              value={localBpm}
              onFocus={(e) => { isBpmFocused.current = true; e.currentTarget.select() }}
              onBlur={() => {
                isBpmFocused.current = false
                const parsed = Number(localBpm)
                if (!isNaN(parsed) && parsed > 0) {
                  const rounded = Number(parsed.toFixed(2))
                  audioEngine.setBpm(rounded)
                  setLocalBpm(formatBpm(rounded))
                } else {
                  setLocalBpm(formatBpm(useStore.getState().bpm))
                }
              }}
              onChange={(e) => {
                setLocalBpm(e.target.value)
                const parsed = Number(e.target.value)
                if (!isNaN(parsed) && parsed > 0) {
                  audioEngine.setBpm(parsed)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
              style={{ width: '56px', background: 'transparent', border: 'none', color: '#fff', fontWeight: 800, fontSize: '12px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", outline: 'none', padding: 0 }}
            />
            <button
              onClick={() => {
                const cur = Number(localBpm) || 120
                const next = Math.min(999, Math.round((cur + 1) * 100) / 100)
                setLocalBpm(formatBpm(next))
                audioEngine.setBpm(next)
              }}
              title="Increase Tempo by 1 BPM"
              style={{ background: 'transparent', border: 'none', color: '#8b92a5', cursor: 'pointer', padding: '0 2px', fontSize: '11px', fontWeight: 900, lineHeight: 1 }}
            >+</button>
          </div>

          {/* Time Signature: shows the real signature; custom values are edited in the left pane */}
          <select
            value={timeSignature}
            onChange={e => setTimeSignature(e.target.value)}
            title="Project time signature. Any value is available under Custom… in the left pane."
            style={{ fontSize: '10px', color: '#9aa3b2', fontWeight: 800, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', padding: '3px 4px', borderRadius: '4px', letterSpacing: '0.04em', outline: 'none', cursor: 'pointer' }}
          >
            {!TIME_SIGNATURE_PRESETS.includes(timeSignature) && (
              <option value={timeSignature} style={{ background: '#12141c', color: 'white' }}>{timeSignature} (Custom)</option>
            )}
            {TIME_SIGNATURE_PRESETS.map(sig => (
              <option key={sig} value={sig} style={{ background: '#12141c', color: 'white' }}>{sig}</option>
            ))}
          </select>

          <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />

          {/* Follow Mode */}
          <div role="group" aria-label="Playhead follow mode" style={{ display: 'flex', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', background: 'rgba(0,0,0,0.25)' }}>
            <button
              onClick={() => setPlayheadFollowMode('playhead')}
              title="Playhead sweeps across static grid"
              style={{ minWidth: '38px', height: '24px', border: 'none', borderRight: '1px solid rgba(255,255,255,0.08)', background: playheadFollowMode === 'playhead' ? 'rgba(0,230,255,0.18)' : 'transparent', color: playheadFollowMode === 'playhead' ? '#00e6ff' : '#8b92a5', cursor: 'pointer', fontSize: '9.5px', fontWeight: 800, padding: '0 6px' }}
            >
              Head
            </button>
            <button
              onClick={() => setPlayheadFollowMode('grid')}
              title="Grid continuously scrolls under playhead"
              style={{ minWidth: '36px', height: '24px', border: 'none', background: playheadFollowMode === 'grid' ? 'rgba(255,51,102,0.18)' : 'transparent', color: playheadFollowMode === 'grid' ? '#ff6b8b' : '#8b92a5', cursor: 'pointer', fontSize: '9.5px', fontWeight: 800, padding: '0 6px' }}
            >
              Grid
            </button>
          </div>

          {/* Align Grid to Playhead */}
          <button
            onClick={requestCanvasAlign}
            title="Align visible grid view to the playhead"
            style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#b8c0d4', borderRadius: '5px', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <IconAlign size={13} />
          </button>

          {/* Level Zoom Toggle */}
          <button
            onClick={() => setGridResizable(!gridResizable)}
            title="Toggle resizable grid columns (visual timeline zoom)"
            style={{
              height: '26px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: gridResizable ? 'rgba(0,230,255,0.16)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${gridResizable ? 'rgba(0,230,255,0.5)' : 'rgba(255,255,255,0.1)'}`,
              color: gridResizable ? '#00e6ff' : '#b8c0d4',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '9.5px',
              fontWeight: 800,
              padding: '0 8px',
              transition: 'all 0.15s ease'
            }}
          >
            <IconStretch size={12} style={{ marginRight: '4px' }} /> Zoom
          </button>

          <button
            onClick={resetZoom}
            title="Reset column stretch zoom"
            style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#b8c0d4', borderRadius: '5px', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <IconMaximize size={12} />
          </button>

          {/* Full Screen Mode Toggle */}
          <button
            onClick={() => {
              if ((window as any).ipcRenderer) {
                (window as any).ipcRenderer.invoke('toggle-fullscreen').catch(() => {})
              } else {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen().catch(() => {})
                } else {
                  document.exitFullscreen().catch(() => {})
                }
              }
            }}
            title="Toggle Full Screen View (F11)"
            style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#b8c0d4', borderRadius: '5px', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <IconTarget size={12} />
          </button>
        </div>

        {/* Right Workspace Controls */}
        <div style={{ display: 'flex', gap: '7px', marginLeft: 'auto', alignItems: 'center', flexShrink: 0 }}>
          {/* Clear */}
          <button
            onClick={() => setShowClearConfirm(true)}
            title="Clear Project"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#d0d5e2', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, transition: 'all 0.12s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff8a8a'; e.currentTarget.style.borderColor = 'rgba(255,80,80,0.35)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#d0d5e2'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
          >
            <IconTrash size={13} /> Clear
          </button>
          {/* Save */}
          <div ref={saveContainerRef} style={{ position: 'relative', display: 'flex' }}>
            <div style={{ display: 'flex', alignItems: 'stretch', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px' }}>
              <button
                style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', color: '#d0d5e2', borderRadius: projectFilePath ? '5px 0 0 5px' : '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, border: 'none', transition: 'all 0.12s' }}
                title={projectFilePath ? "Save (Ctrl+S)" : "Save Project (Ctrl+S)"}
                onClick={handleSaveProject}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = '#d0d5e2'}
              >
                <IconSave size={13} /> Save
              </button>
              {projectFilePath && (
                <button
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', background: 'transparent', color: '#d0d5e2', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', borderRadius: '0 5px 5px 0' }}
                  onClick={() => setShowSaveMenu(!showSaveMenu)}
                >
                  <IconChevronDown size={11} style={{ opacity: 0.6 }} />
                </button>
              )}
            </div>
            {showSaveMenu && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: '#181924', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px', width: '120px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', zIndex: 100 }}>
                {[
                  {
                    id: 'save', label: 'Save', icon: <IconSave size={12} />, action: async () => {
                      const state = useStore.getState()
                      const ipc = (window as any).ipcRenderer
                      if (!ipc || !state.projectFilePath) return
                      const projectData = getProjectDataString()
                      const success = await ipc.invoke('save-project-path', projectData, state.projectFilePath)
                      if (success) { state.setIsDirty(false); state.showToast('Project saved', 'success') }
                      else { state.showToast('Failed to save project', 'error') }
                    }
                  },
                  {
                    id: 'save_as', label: 'Save As...', icon: <IconSave size={12} />, action: async () => {
                      const state = useStore.getState()
                      const ipc = (window as any).ipcRenderer
                      if (!ipc) return
                      const projectData = getProjectDataString()
                      const filePath = await ipc.invoke('save-project', projectData)
                      if (filePath) {
                        const pName = filePath.split(/[\\/]/).pop().replace('.muz', '')
                        state.setProjectInfo({ projectFilePath: filePath, projectName: pName })
                        state.setIsDirty(false)
                        state.showToast('Project saved as new file', 'success')
                        saveRecentProject({
                          name: pName,
                          filePath: filePath,
                          bpm: state.bpm,
                          trackCount: state.tracks.length
                        })
                      }
                    }
                  }
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => { item.action(); setShowSaveMenu(false) }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px', background: 'transparent', border: 'none', color: '#bbb', fontSize: '11px', fontWeight: 600, borderRadius: '5px', cursor: 'pointer', transition: 'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#bbb' }}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Score View */}
          <button
            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(0, 230, 255, 0.08)', border: '1px solid rgba(0, 230, 255, 0.25)', color: '#00e6ff', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: 700, transition: 'all 0.12s' }}
            title="View and Print Sheet Music Score"
            onClick={() => setIsScorePreviewVisible(true)}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 230, 255, 0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(0, 230, 255, 0.08)'}
          >
            <IconMusic size={13} /> Score
          </button>

          {/* Consolidated Export Mix */}
          <div ref={exportContainerRef} style={{ position: 'relative', display: 'flex' }}>
            <button
              onClick={() => !isExporting && setShowExportMenu(!showExportMenu)}
              disabled={isExporting}
              title="Export project in various formats"
              style={{
                background: 'rgba(77, 171, 247, 0.1)',
                border: '1px solid rgba(77, 171, 247, 0.35)',
                borderRadius: '6px',
                padding: '5px 10px',
                color: '#4dabf7',
                fontSize: '11px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: isExporting ? 'wait' : 'pointer',
                transition: 'all 0.12s'
              }}
              onMouseEnter={e => !isExporting && (e.currentTarget.style.background = 'rgba(77, 171, 247, 0.18)')}
              onMouseLeave={e => !isExporting && (e.currentTarget.style.background = 'rgba(77, 171, 247, 0.1)')}
            >
              <IconDownload size={13} /> {isExporting ? 'Exporting...' : 'Export'} <IconChevronDown size={11} style={{ opacity: 0.7 }} />
            </button>

            {showExportMenu && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: '#181924', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px', width: '155px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', zIndex: 100 }}>
                {[
                  { id: 'wav', label: 'WAV AUDIO', icon: <IconDownload size={12} />, action: () => handleExportAudio('wav') },
                  { id: 'mp3', label: 'MP3 AUDIO', icon: <IconDownload size={12} />, action: () => handleExportAudio('mp3') },
                  {
                    id: 'musicxml', label: 'MUSICXML SCORE', icon: <IconMusic size={12} />, action: () => {
                      const state = useStore.getState()
                      const lastNoteTick = state.notes.length > 0 ? Math.max(...state.notes.map(n => n.time + n.duration)) : 768
                      state.setProjectExportData({
                        type: 'musicxml',
                        trackId: undefined,
                        octaveOffset: 0,
                        semitoneOffset: 0,
                        normalize: false,
                        includeMetronome: false,
                        autoFade: false,
                        isRendering: false,
                        progress: 0,
                        startTick: state.loopEnabled ? state.loopStart : 0,
                        endTick: state.loopEnabled ? state.loopEnd : lastNoteTick,
                        includeProceduralFx: false
                      })
                    }
                  },
                  {
                    id: 'muztrack', label: '.MUZTRACK GRID', icon: <IconDownload size={12} />, action: () => {
                      const state = useStore.getState()
                      const lastNoteTick = state.notes.length > 0 ? Math.max(...state.notes.map(n => n.time + n.duration)) : 768
                      state.setProjectExportData({
                        type: 'muztrack',
                        trackId: undefined,
                        octaveOffset: 0,
                        semitoneOffset: 0,
                        normalize: false,
                        includeMetronome: false,
                        autoFade: false,
                        isRendering: false,
                        progress: 0,
                        startTick: state.loopEnabled ? state.loopStart : 0,
                        endTick: state.loopEnabled ? state.loopEnd : lastNoteTick,
                        includeProceduralFx: false
                      })
                    }
                  },
                  {
                    id: 'midi', label: 'MIDI FILE', icon: <IconMidi size={12} />, action: () => {
                      const state = useStore.getState()
                      const lastNoteTick = state.notes.length > 0 ? Math.max(...state.notes.map(n => n.time + n.duration)) : 768
                      state.setProjectExportData({
                        type: 'midi',
                        trackId: undefined,
                        octaveOffset: 0,
                        semitoneOffset: 0,
                        normalize: false,
                        includeMetronome: false,
                        autoFade: false,
                        isRendering: false,
                        progress: 0,
                        startTick: state.loopEnabled ? state.loopStart : 0,
                        endTick: state.loopEnabled ? state.loopEnd : lastNoteTick,
                        includeProceduralFx: false,
                        exportScalaWithMidi: true
                      })
                    }
                  },
                  {
                    id: 'scala', label: 'SCALA TUNING (.SCL)', icon: <IconSliders size={12} />, action: () => {
                      const state = useStore.getState()
                      const lastNoteTick = state.notes.length > 0 ? Math.max(...state.notes.map(n => n.time + n.duration)) : 768
                      state.setProjectExportData({
                        type: 'scala',
                        trackId: undefined,
                        octaveOffset: 0,
                        semitoneOffset: 0,
                        normalize: false,
                        includeMetronome: false,
                        autoFade: false,
                        isRendering: false,
                        progress: 0,
                        startTick: state.loopEnabled ? state.loopStart : 0,
                        endTick: state.loopEnabled ? state.loopEnd : lastNoteTick,
                        includeProceduralFx: false,
                        exportScalaWithMidi: true
                      })
                    }
                  }
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => { item.action(); setShowExportMenu(false) }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px', background: 'transparent', border: 'none', color: '#bbb', fontSize: '11px', fontWeight: 600, borderRadius: '5px', cursor: 'pointer', transition: 'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#bbb' }}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Help Manual */}
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#b8c0d4',
              borderRadius: '6px',
              padding: '5px 8px',
              height: '25px',
              minWidth: '27px',
              cursor: 'pointer',
              transition: 'all 0.12s'
            }}
            title="Open DAW Manual & MIDI Theory Reference (Help)"
            onClick={() => useStore.getState().setIsHelpPaneVisible(true)}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#b8c0d4' }}
          >
            <IconHelp size={14} />
          </button>
        </div>
        </>
        ) : (
          <div style={{ display: 'flex', gap: '7px', marginLeft: 'auto', alignItems: 'center', flexShrink: 0 }}>
            {/* Minimalist Help on Start tab */}
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#b8c0d4',
                borderRadius: '6px',
                padding: '5px 8px',
                height: '25px',
                minWidth: '27px',
                cursor: 'pointer',
                transition: 'all 0.12s'
              }}
              title="Open DAW Manual & MIDI Theory Reference (Help)"
              onClick={() => useStore.getState().setIsHelpPaneVisible(true)}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#b8c0d4' }}
            >
              <IconHelp size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Main Workspace */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {activeTabId === 'start' ? (
          <StartScreenModal
            embedded={true}
            onNewProject={handleNewProject}
            onOpenProject={handleOpenProject}
          />
        ) : (
          <>
            <div style={{
              width: leftPaneCollapsed ? '0px' : `${leftPaneWidth}px`,
              minWidth: leftPaneCollapsed ? '0px' : '240px',
              flexShrink: 0,
              display: 'flex',
              overflow: 'hidden',
              transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease-in-out',
              opacity: leftPaneCollapsed ? 0 : 1
            }}>
              <LeftPane />
            </div>

        {/* Vertical Splitter */}
        <div
          onMouseDown={() => { if (!leftPaneCollapsed) { isDraggingVerticalDivider.current = true; document.body.style.cursor = 'col-resize' } }}
          style={{
            width: '4px',
            cursor: leftPaneCollapsed ? 'default' : 'col-resize',
            background: 'rgba(255,255,255,0.05)',
            borderLeft: '1px solid rgba(255,255,255,0.05)',
            borderRight: '1px solid rgba(255,255,255,0.05)',
            zIndex: 100,
            transition: 'background 0.2s',
            flexShrink: 0,
            display: leftPaneCollapsed ? 'none' : 'block'
          }}
          onMouseEnter={e => { if (!leftPaneCollapsed) e.currentTarget.style.background = 'rgba(77,171,247,0.3)' }}
          onMouseLeave={e => !isDraggingVerticalDivider.current && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        />

        {/* Sidebar Collapse Toggle Button (Floating in lower left corner) */}
        <button
          onClick={() => setLeftPaneCollapsed(!leftPaneCollapsed)}
          title={leftPaneCollapsed ? "Expand Tracks Panel" : "Collapse Tracks Panel"}
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'rgba(20, 20, 28, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#b8c0d4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 1000,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            opacity: 0.6,
            transition: 'background 0.15s, border-color 0.15s, color 0.15s, transform 0.15s, opacity 0.15s',
            outline: 'none'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.background = 'rgba(77,171,247,0.2)';
            e.currentTarget.style.borderColor = 'rgba(77,171,247,0.6)';
            e.currentTarget.style.color = '#4dabf7';
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = '0.6';
            e.currentTarget.style.background = 'rgba(20, 20, 28, 0.85)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            e.currentTarget.style.color = '#b8c0d4';
            e.currentTarget.style.transform = 'none';
          }}
        >
          {leftPaneCollapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
        </button>

        {/* Persistent Split View */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {(() => {
            const synthTracks = tracks.filter(t => t.instrument === 'synth' || t.instrument === 'vst3' || (!t.instrument && !(t as any).isDrumTrack))
            const drumTracks = tracks.filter(t => t.instrument === 'drum')

            const hasSynth = synthTracks.length > 0
            const hasDrums = drumTracks.length > 0

            const activeTrack = tracks.find(t => t.id === activeTrackId)
            const activeInstrument = (activeTrack?.instrument === 'drum') ? 'drum' : 'synth'

            // Determine if each pane should be visible
            let showSynth = hasSynth
            let showDrums = hasDrums

            if (gridPaneMode === 'synth-only') {
              showDrums = false
            } else if (gridPaneMode === 'drum-only') {
              showSynth = false
            } else if (gridPaneMode === 'active') {
              if (activeInstrument === 'synth') {
                showDrums = false
              } else {
                showSynth = false
              }
            }

            const showDivider = showSynth && showDrums && gridPaneMode === 'split'

            // Determine flex order
            const isSynthTop = gridSplitOrder === 'synth-first'
            const synthOrder = isSynthTop ? 1 : 3
            const dividerOrder = 2
            const drumOrder = isSynthTop ? 3 : 1

            // Determine dimensions for Split mode vs. Maximized mode
            const synthStyle: React.CSSProperties = {
              display: showSynth ? 'flex' : 'none',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative',
              order: synthOrder
            }

            const drumStyle: React.CSSProperties = {
              display: showDrums ? 'flex' : 'none',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative',
              order: drumOrder
            }

            if (showSynth && showDrums && gridPaneMode === 'split') {
              // Split view
              if (isSynthTop) {
                synthStyle.height = `${splitRatio * 100}%`
                synthStyle.flex = 'none'
                drumStyle.flex = 1
                drumStyle.height = 'auto'
              } else {
                drumStyle.height = `${splitRatio * 100}%`
                drumStyle.flex = 'none'
                synthStyle.flex = 1
                synthStyle.height = 'auto'
              }
            } else {
              // Maximized or single-instrument view
              if (showSynth) {
                synthStyle.flex = 1
                synthStyle.height = '100%'
              }
              if (showDrums) {
                drumStyle.flex = 1
                drumStyle.height = '100%'
              }
            }

            return (
              <>
                {/* ── Synth Pane ── */}
                <div style={synthStyle}>
                  {/* Synth Pane Header with mode toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 14px', background: '#161620', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                    <span style={{ fontSize: '11px', color: activeInstrument === 'synth' ? '#fff' : '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Synth Track</span>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: ((activeInstrument === 'synth' || bothGridActive) && !readOnlyMode) ? 'rgba(77,171,247,0.15)' : 'rgba(255,255,255,0.02)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: `1px solid ${((activeInstrument === 'synth' || bothGridActive) && !readOnlyMode) ? 'rgba(77,171,247,0.3)' : 'rgba(255,255,255,0.05)'}`,
                      marginRight: '6px'
                    }}>
                      <div style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: ((activeInstrument === 'synth' || bothGridActive) && !readOnlyMode) ? '#4dabf7' : '#555',
                        boxShadow: ((activeInstrument === 'synth' || bothGridActive) && !readOnlyMode) ? '0 0 6px #4dabf7' : 'none'
                      }} />
                      <span style={{ fontSize: '9px', fontWeight: 800, color: ((activeInstrument === 'synth' || bothGridActive) && !readOnlyMode) ? '#4dabf7' : '#555', textTransform: 'uppercase' }}>
                        {((activeInstrument === 'synth' || bothGridActive) && !readOnlyMode) ? 'Active Write' : 'Read Only'}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: !synthScoreMode ? '#aaa' : '#444' }}>Piano Roll</span>
                    {/* Toggle */}
                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={synthScoreMode} onChange={e => setSynthScoreMode(e.target.checked)} style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
                      <span style={{ display: 'inline-block', width: '34px', height: '18px', borderRadius: '9px', background: synthScoreMode ? '#3a3a4a' : '#252530', border: `1px solid ${synthScoreMode ? '#555' : '#333'}`, position: 'relative', transition: 'background 0.2s, border-color 0.2s' }}>
                        <span style={{ position: 'absolute', top: '2px', left: synthScoreMode ? '17px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: synthScoreMode ? '#8888aa' : '#444', transition: 'left 0.2s, background 0.2s' }} />
                      </span>
                    </label>
                    <span style={{ fontSize: '11px', color: synthScoreMode ? '#aaa' : '#444', marginLeft: '-6px' }}>Score Editor</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {synthTracks.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={(e) => {
                            e.stopPropagation()
                            const anyMuted = synthTracks.some(t => t.muted)
                            updateTracks(synthTracks.map(t => t.id), { muted: !anyMuted })
                          }} 
                          title="Mute All"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: synthTracks.every(t => t.muted) ? 'rgba(255,51,102,0.15)' : synthTracks.some(t => t.muted) ? 'rgba(255,51,102,0.08)' : 'rgba(255,255,255,0.05)', border: `1px solid ${synthTracks.every(t => t.muted) ? 'rgba(255,51,102,0.3)' : synthTracks.some(t => t.muted) ? 'rgba(255,51,102,0.15)' : 'rgba(255,255,255,0.1)'}`, color: synthTracks.some(t => t.muted) ? '#ff3366' : '#aaa', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 800, padding: 0 }}
                          onMouseEnter={e => {
                            if (!synthTracks.some(t => t.muted)) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                            else e.currentTarget.style.background = synthTracks.every(t => t.muted) ? 'rgba(255,51,102,0.2)' : 'rgba(255,51,102,0.15)'
                          }}
                          onMouseLeave={e => {
                            if (!synthTracks.some(t => t.muted)) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                            else e.currentTarget.style.background = synthTracks.every(t => t.muted) ? 'rgba(255,51,102,0.15)' : 'rgba(255,51,102,0.08)'
                          }}>M</button>
                          <button onClick={(e) => {
                            e.stopPropagation()
                            const anySoloed = synthTracks.some(t => t.soloed)
                            updateTracks(synthTracks.map(t => t.id), { soloed: !anySoloed })
                          }} 
                          title="Solo All"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: synthTracks.every(t => t.soloed) ? 'rgba(0,230,255,0.15)' : synthTracks.some(t => t.soloed) ? 'rgba(0,230,255,0.08)' : 'rgba(255,255,255,0.05)', border: `1px solid ${synthTracks.every(t => t.soloed) ? 'rgba(0,230,255,0.3)' : synthTracks.some(t => t.soloed) ? 'rgba(0,230,255,0.15)' : 'rgba(255,255,255,0.1)'}`, color: synthTracks.some(t => t.soloed) ? '#00e6ff' : '#aaa', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 800, padding: 0 }}
                          onMouseEnter={e => {
                            if (!synthTracks.some(t => t.soloed)) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                            else e.currentTarget.style.background = synthTracks.every(t => t.soloed) ? 'rgba(0,230,255,0.2)' : 'rgba(0,230,255,0.15)'
                          }}
                          onMouseLeave={e => {
                            if (!synthTracks.some(t => t.soloed)) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                            else e.currentTarget.style.background = synthTracks.every(t => t.soloed) ? 'rgba(0,230,255,0.15)' : 'rgba(0,230,255,0.08)'
                          }}>S</button>
                        </div>
                      )}
                      {!synthScoreMode && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '9px', color: '#555', fontWeight: 600, marginRight: '4px' }}>ZOOM</span>
                        <button
                          onClick={() => setZoomSynth(Math.max(0.1, zoomSynth / 1.2))}
                          title="Zoom Out"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 800, padding: 0 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        >
                          −
                        </button>
                        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={synthZoomInput}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
                              setSynthZoomInput(val)
                            }}
                            onFocus={() => {
                              isSynthZoomFocused.current = true
                            }}
                            onBlur={() => {
                              isSynthZoomFocused.current = false
                              const numVal = parseInt(synthZoomInput, 10)
                              if (!isNaN(numVal)) {
                                const clampedVal = Math.max(10, Math.min(300, numVal))
                                setZoomSynth(clampedVal / 100)
                                setSynthZoomInput(String(clampedVal))
                              } else {
                                setSynthZoomInput(String(Math.round(zoomSynth * 100)))
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur()
                              }
                            }}
                            style={{
                              width: '26px',
                              height: '16px',
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '3px',
                              color: '#fff',
                              fontSize: '10px',
                              fontWeight: 'bold',
                              textAlign: 'center',
                              padding: 0,
                              outline: 'none',
                              fontFamily: 'Inter, sans-serif'
                            }}
                          />
                          <span style={{ fontSize: '10px', color: '#666', marginLeft: '2px', marginRight: '2px', fontWeight: 'bold' }}>%</span>
                        </div>
                        <button
                          onClick={() => setZoomSynth(Math.min(3, zoomSynth * 1.2))}
                          title="Zoom In"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 800, padding: 0 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        >
                          +
                        </button>
                        <button
                          onClick={() => setZoomSynth(1.0)}
                          title="Reset Zoom"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', borderRadius: '4px', cursor: 'pointer', padding: 0 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        >
                          <IconMaximize size={8} />
                        </button>
                        <div style={{ width: '1px', height: '12px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                        <button
                          onClick={() => setSyncZoom(!syncZoom)}
                          title="Sync Zoom across tracks"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: syncZoom ? 'rgba(0,230,255,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${syncZoom ? 'rgba(0,230,255,0.3)' : 'rgba(255,255,255,0.1)'}`, color: syncZoom ? '#00e6ff' : '#aaa', borderRadius: '4px', cursor: 'pointer', padding: 0 }}
                          onMouseEnter={e => e.currentTarget.style.background = syncZoom ? 'rgba(0,230,255,0.2)' : 'rgba(255,255,255,0.1)'}
                          onMouseLeave={e => e.currentTarget.style.background = syncZoom ? 'rgba(0,230,255,0.15)' : 'rgba(255,255,255,0.05)'}
                        >
                          <IconSync size={9} />
                        </button>
                      </div>
                    )}
                    </div>
                  </div>

                  <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {synthScoreMode ? (
                      <ScoreEditor />
                    ) : (
                      <GridCanvas key="synth" instrument="synth" />
                    )}
                  </div>
                </div>

                {/* ── Split Divider ── */}
                <div
                  style={{
                    display: showDivider ? 'block' : 'none',
                    height: '6px',
                    background: 'rgba(255,255,255,0.05)',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    borderBottom: '1px solid rgba(0,0,0,0.3)',
                    cursor: 'row-resize',
                    zIndex: 20,
                    order: dividerOrder,
                    transition: 'background 0.2s'
                  }}
                  onMouseDown={() => {
                    isDraggingDivider.current = true
                    document.body.style.cursor = 'row-resize'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(77,171,247,0.3)'}
                  onMouseLeave={e => !isDraggingDivider.current && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                />

                {/* ── Drum Pane ── */}
                <div style={drumStyle}>
                  {/* Drum Pane Header with mode toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 14px', background: '#161620', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                    <span style={{ fontSize: '11px', color: activeInstrument === 'drum' ? '#fff' : '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Drum Track</span>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: ((activeInstrument === 'drum' || bothGridActive) && !readOnlyMode) ? 'rgba(255,153,0,0.15)' : 'rgba(255,255,255,0.02)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: `1px solid ${((activeInstrument === 'drum' || bothGridActive) && !readOnlyMode) ? 'rgba(255,153,0,0.3)' : 'rgba(255,255,255,0.05)'}`,
                      marginRight: '6px'
                    }}>
                      <div style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: ((activeInstrument === 'drum' || bothGridActive) && !readOnlyMode) ? '#ff9900' : '#555',
                        boxShadow: ((activeInstrument === 'drum' || bothGridActive) && !readOnlyMode) ? '0 0 6px #ff9900' : 'none'
                      }} />
                      <span style={{ fontSize: '9px', fontWeight: 800, color: ((activeInstrument === 'drum' || bothGridActive) && !readOnlyMode) ? '#ff9900' : '#555', textTransform: 'uppercase' }}>
                        {((activeInstrument === 'drum' || bothGridActive) && !readOnlyMode) ? 'Active Write' : 'Read Only'}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: !drumSequencerMode ? '#aaa' : '#444' }}>Piano Roll</span>
                    {/* Toggle */}
                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={drumSequencerMode} onChange={e => setDrumSequencerMode(e.target.checked)} style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
                      <span style={{ display: 'inline-block', width: '34px', height: '18px', borderRadius: '9px', background: drumSequencerMode ? '#3a3a4a' : '#252530', border: `1px solid ${drumSequencerMode ? '#555' : '#333'}`, position: 'relative', transition: 'background 0.2s, border-color 0.2s' }}>
                        <span style={{ position: 'absolute', top: '2px', left: drumSequencerMode ? '17px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: drumSequencerMode ? '#8888aa' : '#444', transition: 'left 0.2s, background 0.2s' }} />
                      </span>
                    </label>
                    <span style={{ fontSize: '11px', color: drumSequencerMode ? '#aaa' : '#444', marginLeft: '-6px' }}>Step Sequencer</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {drumTracks.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={(e) => {
                            e.stopPropagation()
                            const anyMuted = drumTracks.some(t => t.muted)
                            updateTracks(drumTracks.map(t => t.id), { muted: !anyMuted })
                          }} 
                          title="Mute All"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: drumTracks.every(t => t.muted) ? 'rgba(255,51,102,0.15)' : drumTracks.some(t => t.muted) ? 'rgba(255,51,102,0.08)' : 'rgba(255,255,255,0.05)', border: `1px solid ${drumTracks.every(t => t.muted) ? 'rgba(255,51,102,0.3)' : drumTracks.some(t => t.muted) ? 'rgba(255,51,102,0.15)' : 'rgba(255,255,255,0.1)'}`, color: drumTracks.some(t => t.muted) ? '#ff3366' : '#aaa', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 800, padding: 0 }}
                          onMouseEnter={e => {
                            if (!drumTracks.some(t => t.muted)) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                            else e.currentTarget.style.background = drumTracks.every(t => t.muted) ? 'rgba(255,51,102,0.2)' : 'rgba(255,51,102,0.15)'
                          }}
                          onMouseLeave={e => {
                            if (!drumTracks.some(t => t.muted)) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                            else e.currentTarget.style.background = drumTracks.every(t => t.muted) ? 'rgba(255,51,102,0.15)' : 'rgba(255,51,102,0.08)'
                          }}>M</button>
                          <button onClick={(e) => {
                            e.stopPropagation()
                            const anySoloed = drumTracks.some(t => t.soloed)
                            updateTracks(drumTracks.map(t => t.id), { soloed: !anySoloed })
                          }} 
                          title="Solo All"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: drumTracks.every(t => t.soloed) ? 'rgba(0,230,255,0.15)' : drumTracks.some(t => t.soloed) ? 'rgba(0,230,255,0.08)' : 'rgba(255,255,255,0.05)', border: `1px solid ${drumTracks.every(t => t.soloed) ? 'rgba(0,230,255,0.3)' : drumTracks.some(t => t.soloed) ? 'rgba(0,230,255,0.15)' : 'rgba(255,255,255,0.1)'}`, color: drumTracks.some(t => t.soloed) ? '#00e6ff' : '#aaa', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 800, padding: 0 }}
                          onMouseEnter={e => {
                            if (!drumTracks.some(t => t.soloed)) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                            else e.currentTarget.style.background = drumTracks.every(t => t.soloed) ? 'rgba(0,230,255,0.2)' : 'rgba(0,230,255,0.15)'
                          }}
                          onMouseLeave={e => {
                            if (!drumTracks.some(t => t.soloed)) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                            else e.currentTarget.style.background = drumTracks.every(t => t.soloed) ? 'rgba(0,230,255,0.15)' : 'rgba(0,230,255,0.08)'
                          }}>S</button>
                        </div>
                      )}
                      {!drumSequencerMode && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '9px', color: '#555', fontWeight: 600, marginRight: '4px' }}>ZOOM</span>
                        <button
                          onClick={() => setZoomDrum(Math.max(0.1, zoomDrum / 1.2))}
                          title="Zoom Out"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 800, padding: 0 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        >
                          −
                        </button>
                        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={drumZoomInput}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
                              setDrumZoomInput(val)
                            }}
                            onFocus={() => {
                              isDrumZoomFocused.current = true
                            }}
                            onBlur={() => {
                              isDrumZoomFocused.current = false
                              const numVal = parseInt(drumZoomInput, 10)
                              if (!isNaN(numVal)) {
                                const clampedVal = Math.max(10, Math.min(300, numVal))
                                setZoomDrum(clampedVal / 100)
                                setDrumZoomInput(String(clampedVal))
                              } else {
                                setDrumZoomInput(String(Math.round(zoomDrum * 100)))
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur()
                              }
                            }}
                            style={{
                              width: '26px',
                              height: '16px',
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '3px',
                              color: '#fff',
                              fontSize: '10px',
                              fontWeight: 'bold',
                              textAlign: 'center',
                              padding: 0,
                              outline: 'none',
                              fontFamily: 'Inter, sans-serif'
                            }}
                          />
                          <span style={{ fontSize: '10px', color: '#666', marginLeft: '2px', marginRight: '2px', fontWeight: 'bold' }}>%</span>
                        </div>
                        <button
                          onClick={() => setZoomDrum(Math.min(3, zoomDrum * 1.2))}
                          title="Zoom In"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 800, padding: 0 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        >
                          +
                        </button>
                        <button
                          onClick={() => setZoomDrum(1.0)}
                          title="Reset Zoom"
                          style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', borderRadius: '4px', cursor: 'pointer', padding: 0 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        >
                          <IconMaximize size={8} />
                        </button>
                      </div>
                    )}
                    </div>
                  </div>

                  {/* Drum Content (Piano Roll vs Step Sequencer permanently mounted) */}
                  <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    <div style={{ display: drumSequencerMode ? 'none' : 'block', height: '100%', width: '100%', position: 'relative' }}>
                      <GridCanvas key="drum" instrument="drum" />
                    </div>
                    <div style={{ display: drumSequencerMode ? 'block' : 'none', height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
                      <DrumSequencer />
                    </div>
                  </div>
                </div>

                {/* Empty State */}
                {!hasSynth && !hasDrums && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                    Add a track to start editing
                  </div>
                )}
              </>
            )
          })()}
        </div>
        <RightPane />
      </>
    )}
  </div>
  </div>
  )}

      {isScorePreviewVisible && (
        <ScorePreviewModal onClose={() => setIsScorePreviewVisible(false)} />
      )}

      {showNewProjectConfirm && (
        <div className={newProjectClosing ? "animate-modal-bg-exit" : "animate-modal-bg"} style={{ position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className={`${newProjectClosing ? "animate-modal-card-exit" : "animate-modal-card"}`} style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', boxShadow: '0 30px 70px rgba(0,0,0,0.85)', overflow: 'hidden', background: '#12131a' }}>
            <div style={{ padding: '24px', textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(255,80,80,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto', border: '1px solid rgba(255,80,80,0.3)' }}>
                <IconTrash size={24} style={{ color: '#ff6b6b' }} />
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: 'white', fontWeight: 800, letterSpacing: '-0.5px' }}>Start New Project?</h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#888', lineHeight: 1.5, fontWeight: 500 }}>
                This will discard all patterns, automation, and track cards in your active workspace.
              </p>
            </div>
            <div style={{ padding: '16px 24px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  setNewProjectClosing(true)
                  setTimeout(() => {
                    setShowNewProjectConfirm(false)
                    setNewProjectClosing(false)
                  }, 180)
                }}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#aaa', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = '#aaa'}
              >
                Cancel
              </button>
              <button
                onClick={() => confirmNewProject()}
                style={{
                  flex: 1,
                  border: 'none',
                  background: '#c92a4e',
                  color: 'white',
                  borderRadius: '10px',
                  padding: '10px 18px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#d93a5e'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#c92a4e'
                }}
              >
                Yes, Start New
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearConfirm && (
        <div className={clearConfirmClosing ? "animate-modal-bg-exit" : "animate-modal-bg"} style={{ position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className={clearConfirmClosing ? "animate-modal-card-exit" : "animate-modal-card"} style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', boxShadow: '0 30px 70px rgba(0,0,0,0.85)', overflow: 'hidden', background: '#12131a' }}>
            <div style={{ padding: '24px', textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(255,80,80,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto', border: '1px solid rgba(255,80,80,0.3)' }}>
                <IconTrash size={24} style={{ color: '#ff6b6b' }} />
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: 'white', fontWeight: 800, letterSpacing: '-0.5px' }}>Clear This Project?</h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#888', lineHeight: 1.5, fontWeight: 500 }}>
                Would you like to clear "{projectName || 'Untitled Project'}"? Every note, track and automation setting goes back to a blank project.
                {isDirty && <><br /><span style={{ color: '#ff922b' }}>Unsaved changes will be lost.</span></>}
              </p>
            </div>
            <div style={{ padding: '16px 24px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  setClearConfirmClosing(true)
                  setTimeout(() => {
                    setShowClearConfirm(false)
                    setClearConfirmClosing(false)
                  }, 180)
                }}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#aaa', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = '#aaa'}
              >
                Cancel
              </button>
              <button
                onClick={confirmClearProject}
                style={{ flex: 1, border: 'none', background: '#c92a4e', color: 'white', borderRadius: '10px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'background 0.15s ease' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#d93a5e' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#c92a4e' }}
              >
                Yes, Clear Project
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveCloseConfirm && (
        <div
          className={saveCloseClosing ? "animate-modal-bg-exit" : "animate-modal-bg"}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(8, 9, 14, 0.82)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            zIndex: 1000000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            className={saveCloseClosing ? "animate-modal-card-exit" : "animate-modal-card"}
            style={{
              width: '100%',
              maxWidth: '430px',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '24px',
              boxShadow: '0 30px 80px rgba(0, 0, 0, 0.9)',
              overflow: 'hidden',
              background: '#12131a'
            }}
          >
            <div style={{ padding: '28px 24px 20px', textAlign: 'center' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'rgba(255, 146, 43, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                border: '1px solid rgba(255, 146, 43, 0.35)'
              }}>
                <IconAlertTriangle size={26} style={{ color: '#ff922b' }} />
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: 'white', fontWeight: 800, letterSpacing: '-0.5px' }}>
                Save Changes Before Closing?
              </h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#999', lineHeight: 1.5, fontWeight: 500 }}>
                {dirtyTabCount > 1 ? (
                  <>You have unsaved changes in <strong style={{ color: '#fff' }}>{dirtyTabCount} project tabs</strong>. Do you want to save all of them before quitting?</>
                ) : (
                  <>You have unsaved changes in <strong style={{ color: '#fff' }}>"{projectName || 'Untitled Project'}"</strong>. Do you want to save them before quitting?</>
                )}
              </p>
            </div>

            <div style={{
              padding: '16px 20px',
              background: 'rgba(0, 0, 0, 0.25)',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px'
            }}>
              <button
                onClick={() => {
                  setSaveCloseClosing(true)
                  setTimeout(() => {
                    setShowSaveCloseConfirm(false)
                    setSaveCloseClosing(false)
                  }, 180)
                }}
                disabled={isSavingAndClosing}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'transparent',
                  color: '#aaa',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.background = 'transparent' }}
              >
                Cancel
              </button>

              <button
                onClick={() => {
                  setSaveCloseClosing(true)
                  setTimeout(() => {
                    setShowSaveCloseConfirm(false)
                    setSaveCloseClosing(false)
                    forceQuitApp()
                  }, 120)
                }}
                disabled={isSavingAndClosing}
                style={{
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 75, 75, 0.25)',
                  background: 'rgba(255, 75, 75, 0.12)',
                  color: '#ff6b6b',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#e03131'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 75, 75, 0.12)'; e.currentTarget.style.color = '#ff6b6b' }}
              >
                Don't Save
              </button>

              <button
                onClick={async () => {
                  setIsSavingAndClosing(true)
                  try {
                    const current = useStore.getState()
                    const dirtyIds = current.openTabs
                      .filter(t => t.isDirty || (t.id === current.activeTabId && current.isDirty))
                      .map(t => t.id)
                    // Save every edited tab, not just the visible one; a cancelled
                    // save dialog aborts the quit so nothing is lost silently.
                    for (const id of dirtyIds) {
                      if (useStore.getState().activeTabId !== id) useStore.getState().switchTab(id)
                      const saved = await handleSaveProject()
                      if (!saved) {
                        setIsSavingAndClosing(false)
                        return
                      }
                    }
                    setSaveCloseClosing(true)
                    setTimeout(() => {
                      setShowSaveCloseConfirm(false)
                      setSaveCloseClosing(false)
                      forceQuitApp()
                    }, 120)
                  } catch (e) {
                    setIsSavingAndClosing(false)
                  }
                }}
                disabled={isSavingAndClosing}
                style={{
                  padding: '10px 18px',
                  borderRadius: '10px',
                  border: '1px solid rgba(40, 199, 111, 0.3)',
                  background: 'rgba(40, 199, 111, 0.14)',
                  color: '#2ecc71',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: isSavingAndClosing ? 'wait' : 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={e => {
                  if (isSavingAndClosing) return
                  e.currentTarget.style.background = '#2b8a3e'
                  e.currentTarget.style.color = '#fff'
                }}
                onMouseLeave={e => {
                  if (isSavingAndClosing) return
                  e.currentTarget.style.background = 'rgba(40, 199, 111, 0.14)'
                  e.currentTarget.style.color = '#2ecc71'
                }}
              >
                {isSavingAndClosing ? 'Saving...' : dirtyTabCount > 1 ? 'Save All & Close' : 'Save & Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ImportAudioModal />
      <HelpPane />
      {/* Dirty Tab Close Confirmation Modal */}
      {tabPendingClose && (
        <div
          className="animate-modal-bg"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 5, 10, 0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setTabPendingClose(null)
          }}
        >
          <div
            className="animate-modal-card"
            style={{
              width: '100%',
              maxWidth: '440px',
              background: '#13141f',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <IconAlertTriangle size={20} style={{ color: '#f59f00' }} />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                Save Changes to "{tabPendingClose.name}"?
              </h3>
            </div>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#a0a6b8', lineHeight: '1.5' }}>
              This project tab has unsaved changes. If you close it without saving, your modifications will be permanently lost.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setTabPendingClose(null)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '7px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#bbb',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = tabPendingClose.id
                  setTabPendingClose(null)
                  closeTab(id)
                }}
                style={{
                  padding: '7px 14px',
                  borderRadius: '7px',
                  background: 'rgba(255, 75, 75, 0.14)',
                  border: '1px solid rgba(255, 75, 75, 0.3)',
                  color: '#ff6b6b',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Don't Save
              </button>
              <button
                onClick={async () => {
                  const tabToClose = tabPendingClose
                  if (!tabToClose) return
                  setTabPendingClose(null)
                  if (activeTabId !== tabToClose.id) {
                    useStore.getState().switchTab(tabToClose.id)
                  }
                  const saved = await handleSaveProject()
                  if (saved) {
                    closeTab(tabToClose.id)
                  }
                }}
                style={{
                  padding: '7px 16px',
                  borderRadius: '7px',
                  background: 'rgba(0, 230, 118, 0.18)',
                  border: '1px solid rgba(0, 230, 118, 0.4)',
                  color: '#00e676',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
      <ScriptingModal />
      <SynthStudioModal />
      <DrumDesignerModal />
    </div>
  )
}

export default App
