import { useState, useEffect, useMemo } from 'react'
import { useStore, getRecentProjects, saveRecentProject, removeRecentProject, clearAllRecentProjects, type RecentProjectItem, type ScaleLock } from '../engine/store'
import { DAW_TEMPLATES, getUserTemplates, saveUserTemplate, deleteUserTemplate, buildPreviewPattern, type DawTemplate } from '../utils/dawTemplates'
import { selectAndReadFile, parseProjectPayload } from '../utils/fileDialog'
import { AppSlider } from './AppSlider'
import { generateAiMelody, generateAiDrums, generateAutoHarmony } from '../utils/aiLab'
import { audioEngine } from '../engine/AudioEngine'
import {
  IconMuseLogo, IconNewFile, IconOpen, IconSparkles, IconMusic, IconDrum,
  IconX, IconSearch, IconZap, IconLayers, IconTrash, IconAlertTriangle, IconPlus
} from './Icons'

interface StartScreenModalProps {
  onNewProject: () => void
  onOpenProject: () => void
  isInitialLaunch?: boolean
}

const SCALE_ROOTS = [
  { label: 'C', value: 0 },
  { label: 'C#', value: 1 },
  { label: 'D', value: 2 },
  { label: 'D#', value: 3 },
  { label: 'E', value: 4 },
  { label: 'F', value: 5 },
  { label: 'F#', value: 6 },
  { label: 'G', value: 7 },
  { label: 'G#', value: 8 },
  { label: 'A', value: 9 },
  { label: 'A#', value: 10 },
  { label: 'B', value: 11 }
]

const SCALE_MODES = [
  { label: 'Natural Minor (Aeolian)', value: 'minor' },
  { label: 'Major (Ionian)', value: 'major' },
  { label: 'Dorian (Cyber / Funk)', value: 'dorian' },
  { label: 'Minor Pentatonic', value: 'pentatonicMinor' },
  { label: 'Blues Scale', value: 'blues' },
  { label: 'Lydian (Space Ambient)', value: 'lydian' }
]

export default function StartScreenModal({ onNewProject, onOpenProject, isInitialLaunch = false }: StartScreenModalProps) {
  const isStartScreenOpen = useStore(s => s.isStartScreenOpen)
  const setIsStartScreenOpen = useStore(s => s.setIsStartScreenOpen)
  const showToast = useStore(s => s.showToast)
  const currentNotes = useStore(s => s.notes)
  const hasActiveSession = currentNotes.length > 0 || !isInitialLaunch

  const [activeTab, setActiveTab] = useState<'library' | 'templates' | 'ai'>('library')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [templateCategory, setTemplateCategory] = useState<string>('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [recentList, setRecentList] = useState<RecentProjectItem[]>([])
  const [userTemplates, setUserTemplates] = useState<DawTemplate[]>(() => getUserTemplates())
  const [newTemplateModal, setNewTemplateModal] = useState<{
    isOpen: boolean
    title: string
    category: string
    tagsString: string
    description: string
    bpm: number
    keyName: string
    scaleLock: ScaleLock
    tracks: any[]
    notes: any[]
    previewPattern: {
      synth: Array<{ t: number; p: number; len: number }>
      drum: Array<{ t: number; r: number }>
    }
  } | null>(null)

  const allTemplates = useMemo(() => {
    return [...userTemplates, ...DAW_TEMPLATES]
  }, [userTemplates])

  // Startup checkbox preference
  const [showOnStartup, setShowOnStartup] = useState<boolean>(() => {
    return localStorage.getItem('musegrid_show_start_screen') !== 'false'
  })

  // AI Generator Form State
  const [aiMode, setAiMode] = useState<'full' | 'melody' | 'drums' | 'bach'>('full')
  const [aiMood, setAiMood] = useState('Cyberpunk Synth')
  const [aiBpm, setAiBpm] = useState(120)
  const [aiScaleRoot, setAiScaleRoot] = useState(2) // D
  const [aiScaleMode, setAiScaleMode] = useState('minor')
  const [aiBars, setAiBars] = useState<2 | 4 | 8 | 16>(4)
  const [aiTemperature, setAiTemperature] = useState(1.0)
  const [aiDensity, setAiDensity] = useState(0.85)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiStatusText, setAiStatusText] = useState('')

  useEffect(() => {
    if (isStartScreenOpen) {
      setRecentList(getRecentProjects())
    }
  }, [isStartScreenOpen])

  const [contextMenu, setContextMenu] = useState<{ item: RecentProjectItem; x: number; y: number } | null>(null)
  const [confirmModal, setConfirmModal] = useState<{
    type: 'clear-all' | 'delete' | 'permanent-delete'
    item?: RecentProjectItem
  } | null>(null)
  const [confirmModalClosing, setConfirmModalClosing] = useState(false)
  const [newTemplateClosing, setNewTemplateClosing] = useState(false)
  const [animatingDeleteIds, setAnimatingDeleteIds] = useState<Set<string>>(new Set())

  // Dismiss context menu on outside click or escape
  useEffect(() => {
    if (!contextMenu) return
    const handleCloseMenu = () => setContextMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', handleCloseMenu)
    window.addEventListener('contextmenu', handleCloseMenu)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleCloseMenu)
      window.removeEventListener('contextmenu', handleCloseMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  const handleCloseConfirmModal = () => {
    setConfirmModalClosing(true)
    setTimeout(() => {
      setConfirmModal(null)
      setConfirmModalClosing(false)
    }, 180)
  }

  const handleCloseNewTemplateModal = () => {
    setNewTemplateClosing(true)
    setTimeout(() => {
      setNewTemplateModal(null)
      setNewTemplateClosing(false)
    }, 180)
  }

  const handleRemoveFromRecent = (item: RecentProjectItem) => {
    setContextMenu(null)
    setAnimatingDeleteIds(prev => new Set(prev).add(item.id))
    setTimeout(() => {
      const updated = removeRecentProject(item.id)
      setRecentList(updated)
      setAnimatingDeleteIds(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      showToast(`Removed "${item.name}" from recents`, 'info')
    }, 220)
  }

  const handleClearAllRecents = () => {
    setConfirmModal({ type: 'clear-all' })
  }

  const handleExecuteClearAll = () => {
    handleCloseConfirmModal()
    const allIds = new Set(recentList.map(r => r.id))
    setAnimatingDeleteIds(allIds)
    setTimeout(() => {
      clearAllRecentProjects()
      setRecentList([])
      setAnimatingDeleteIds(new Set())
      showToast('Cleared all recent projects', 'info')
    }, 240)
  }

  const handleExecuteDelete = async (item: RecentProjectItem, permanent: boolean) => {
    handleCloseConfirmModal()
    setAnimatingDeleteIds(prev => new Set(prev).add(item.id))

    if (item.filePath) {
      const ipc = (window as any).ipcRenderer
      if (ipc && typeof ipc.invoke === 'function') {
        try {
          const channel = permanent ? 'permanent-delete-file' : 'delete-file'
          const ok = await ipc.invoke(channel, item.filePath)
          if (!ok) {
            setAnimatingDeleteIds(prev => {
              const next = new Set(prev)
              next.delete(item.id)
              return next
            })
            showToast(permanent ? 'Could not delete file permanently from disk' : 'Could not move file to Recycle Bin', 'error')
            return
          }
        } catch (err) {
          console.error('Failed to delete file from disk:', err)
          setAnimatingDeleteIds(prev => {
            const next = new Set(prev)
            next.delete(item.id)
            return next
          })
          showToast('Failed to delete file from disk', 'error')
          return
        }
      }
    }

    setTimeout(() => {
      const updated = removeRecentProject(item.id)
      setRecentList(updated)
      setAnimatingDeleteIds(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      showToast(permanent ? `Permanently deleted "${item.name}"` : `Moved "${item.name}" to Recycle Bin`, 'success')
    }, 220)
  }

  const handleStartAddTemplate = async () => {
    try {
      const file = await selectAndReadFile({
        title: 'Select .muz Project File as Template',
        accept: '.muz,.muztrack',
        extensions: ['muz', 'muztrack'],
        fileTypeName: 'MuseGrid Project (*.muz, *.muztrack)'
      })
      if (!file) return

      let parsed: any
      try {
        parsed = await parseProjectPayload(file)
      } catch (err) {
        console.error('Failed to parse project file:', err)
        showToast('Corrupted or invalid JSON format in project file', 'error')
        return
      }

      if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.tracks) && !Array.isArray(parsed.notes) && parsed.format !== 'muztrack')) {
        showToast('Invalid project: missing tracks or notes', 'error')
        return
      }

      const defaultTitle = file.name.replace(/\.(muz|muztrack)$/i, '')
      const bpm = parsed.bpm || 120
      const notes = Array.isArray(parsed.notes) ? parsed.notes : []
      const tracks = Array.isArray(parsed.tracks) ? parsed.tracks : []
      const rawScale = parsed.scaleLock || {}
      const rawMode = rawScale.mode ? String(rawScale.mode).toLowerCase() : 'major'
      const scaleMode = rawMode === 'minor' ? 'minor' : 'major'
      const scaleLock: ScaleLock = {
        enabled: Boolean(rawScale.enabled),
        root: typeof rawScale.root === 'number' ? rawScale.root : 0,
        mode: scaleMode,
        accidental: rawScale.accidental === 'flat' ? 'flat' : 'sharp'
      }
      const rootObj = SCALE_ROOTS.find(r => r.value === scaleLock.root)
      const rootLabel = rootObj ? rootObj.label : 'C'
      const modeLabel = scaleLock.mode === 'minor' ? 'Minor' : 'Major'
      const keyName = scaleLock.enabled ? `${rootLabel} ${modeLabel}` : 'Chromatic Free'
      const previewPattern = buildPreviewPattern(notes)

      setNewTemplateModal({
        isOpen: true,
        title: defaultTitle,
        category: 'Custom',
        tagsString: 'Custom, User Project',
        description: `${tracks.length} tracks • ${notes.length} notes`,
        bpm,
        keyName,
        scaleLock,
        tracks,
        notes,
        previewPattern
      })
    } catch (err) {
      console.error('Failed to import template:', err)
      showToast('Could not import template file', 'error')
    }
  }

  const handleSaveNewTemplate = () => {
    if (!newTemplateModal) return
    const title = newTemplateModal.title.trim()
    if (!title) {
      showToast('Please enter a name for the template', 'error')
      return
    }
    const tags = newTemplateModal.tagsString
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
    if (tags.length === 0) tags.push('Custom')

    const newTmpl: DawTemplate = {
      id: `user_tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      category: newTemplateModal.category || 'Custom',
      description: newTemplateModal.description.trim() || 'Custom user template',
      bpm: newTemplateModal.bpm || 120,
      keyName: newTemplateModal.keyName || 'C Major',
      badgeColor: '#ff922b',
      tags,
      scaleLock: newTemplateModal.scaleLock,
      tracks: newTemplateModal.tracks,
      notes: newTemplateModal.notes,
      previewPattern: newTemplateModal.previewPattern,
      isUserTemplate: true
    }

    const updated = saveUserTemplate(newTmpl)
    setUserTemplates(updated)
    handleCloseNewTemplateModal()
    showToast(`Added template "${title}"`, 'success')
  }

  const handleDeleteUserTemplate = (tmplId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = deleteUserTemplate(tmplId)
    setUserTemplates(updated)
    showToast('Removed custom template', 'info')
  }

  const handleToggleStartup = (enabled: boolean) => {
    setShowOnStartup(enabled)
    localStorage.setItem('musegrid_show_start_screen', enabled ? 'true' : 'false')
  }

  const handleClose = () => {
    if (hasActiveSession) {
      setIsStartScreenOpen(false)
    } else {
      // Clean quit on initial launch without session via centralized close request handler
      if (typeof (window as any).__handleAppCloseRequest === 'function') {
        (window as any).__handleAppCloseRequest()
      } else {
        const ipc = (window as any).ipcRenderer
        if (ipc && typeof ipc.invoke === 'function') {
          ipc.invoke('quit-app').catch(() => window.close())
        } else {
          window.close()
        }
      }
    }
  }

  const enterDawFullscreen = () => {
    const ipc = (window as any).ipcRenderer
    if (ipc && typeof ipc.invoke === 'function') {
      ipc.invoke('set-fullscreen', true).catch(() => {})
    }
  }

  const handleSkipToWorkspace = () => {
    setIsStartScreenOpen(false)
    enterDawFullscreen()
  }

  const handleLoadTemplate = (tmpl: DawTemplate) => {
    audioEngine.resetForNewProject()

    useStore.getState().loadState({
      projectName: tmpl.title,
      projectFilePath: null,
      bpm: tmpl.bpm,
      scaleLock: tmpl.scaleLock,
      tracks: tmpl.tracks,
      notes: tmpl.notes,
      activeTrackId: tmpl.tracks[0]?.id || 'track_synth',
      sharedPanX: 0
    })

    tmpl.tracks.forEach(track => {
      audioEngine.createInstrument(track.id, track.instrument || 'synth')
      if (track.instrument === 'drum' && track.drumKit) {
        audioEngine.setTrackDrumKit(track.id, track.drumKit)
      }
    })

    saveRecentProject({
      name: tmpl.title,
      bpm: tmpl.bpm,
      trackCount: tmpl.tracks.length,
      previewSnippet: tmpl.description
    })

    setIsStartScreenOpen(false)
    enterDawFullscreen()
    showToast(`Loaded ${tmpl.title}`, 'success')
  }

  const handleOpenRecent = async (item: RecentProjectItem) => {
    // 1. If it's a saved project file on disk
    if (item.filePath) {
      if (item.filePath.toLowerCase().endsWith('.mid') || item.filePath.toLowerCase().endsWith('.midi')) {
        showToast('Standard MIDI files require channel mapping. Please open a .muz project.', 'info')
        return
      }

      setOpeningId(item.id)
      const ipc = (window as any).ipcRenderer
      if (ipc && typeof ipc.invoke === 'function') {
        try {
          const res = await ipc.invoke('open-project-path', item.filePath)
          if (res && res.error) {
            showToast(res.error, 'error')
            setOpeningId(null)
            return
          }
          if (res && res.data) {
            let parsed: any
            try {
              parsed = JSON.parse(res.data)
            } catch {
              showToast('Corrupted file: Invalid JSON or .muz format', 'error')
              setOpeningId(null)
              return
            }

            if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.tracks) && !Array.isArray(parsed.notes) && parsed.format !== 'muztrack')) {
              showToast('Invalid project: Missing valid track or note data', 'error')
              setOpeningId(null)
              return
            }

            audioEngine.resetForNewProject()
            useStore.getState().loadState({
              ...parsed,
              projectFilePath: res.filePath,
              projectName: res.filePath.split(/[\\/]/).pop().replace(/\.(muz|muztrack)$/i, '')
            })
            if (parsed.bpm) audioEngine.setBpm(parsed.bpm)
            useStore.getState().tracks.forEach(track => {
              audioEngine.createInstrument(track.id, track.instrument || 'synth')
            })
            saveRecentProject({
              name: res.filePath.split(/[\\/]/).pop().replace(/\.(muz|muztrack)$/i, ''),
              filePath: res.filePath,
              bpm: parsed.bpm || 120,
              trackCount: (parsed.tracks || []).length
            })
            setIsStartScreenOpen(false)
            enterDawFullscreen()
            showToast(`Opened ${item.name}`, 'success')
            setOpeningId(null)
            return
          } else {
            showToast('Could not read project data from disk.', 'error')
            setOpeningId(null)
            return
          }
        } catch (err) {
          console.error('Failed to open recent project file', err)
          showToast('Failed to open project file: unreadable or corrupted', 'error')
          setOpeningId(null)
          return
        }
      }
    }

    // 2. If it matches a production or user template
    const tmpl = allTemplates.find(
      t => t.title.toLowerCase() === item.name.toLowerCase() ||
           t.id.toLowerCase() === item.id.toLowerCase()
    )
    if (tmpl) {
      setOpeningId(item.id)
      setTimeout(() => {
        handleLoadTemplate(tmpl)
        setOpeningId(null)
      }, 60)
      return
    }

    // 3. Fallback: if user already has an active session
    if (hasActiveSession) {
      setIsStartScreenOpen(false)
      enterDawFullscreen()
      showToast(`Returned to active workspace`, 'info')
    } else {
      showToast(`Project file not found on disk: ${item.name}`, 'error')
    }
  }

  const handleGenerateAiProject = async () => {
    try {
      setAiGenerating(true)
      setAiStatusText('Warming up neural network...')
      audioEngine.resetForNewProject()

      const ticksPerBar = 768
      const totalSteps = aiBars * 16 // 16 steps per bar

      const scaleConfig: ScaleLock = {
        enabled: true,
        root: aiScaleRoot,
        mode: aiScaleMode,
        accidental: 'sharp'
      }

      const generatedNotes: any[] = []

      const synthTrack = {
        id: 'track_synth',
        name: 'AI Neural Lead',
        instrument: 'synth' as const,
        volume: 0.95,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#da77f2',
        collapsed: true,
        synthPreset: aiMood.includes('Pluck') ? 'pluck' : (aiMood.includes('Piano') ? 'piano' : 'bright'),
        delayTime: 0.25,
        delayFeedback: 0.3
      }

      const drumTrack = {
        id: 'track_drum',
        name: 'AI Drum Machine',
        instrument: 'drum' as const,
        volume: 1.0,
        pan: 0,
        muted: false,
        soloed: false,
        color: '#ff922b',
        collapsed: true,
        drumKit: aiMood.includes('Trap') ? '808' : (aiMood.includes('Techno') ? 'tight' : 'acoustic'),
        delayTime: 0.25,
        delayFeedback: 0.15
      }

      const tracksToUse: any[] = []

      if (aiMode === 'full' || aiMode === 'melody') {
        tracksToUse.push(synthTrack)
        setAiStatusText('Synthesizing melody hooks with MusicRNN...')
        const melody = await generateAiMelody(
          [],
          totalSteps,
          aiTemperature,
          aiDensity,
          0,
          scaleConfig,
          0
        )
        melody.forEach((n, idx) => {
          generatedNotes.push({
            id: `ai_m_${idx}_${Date.now()}`,
            trackId: 'track_synth',
            time: n.time,
            duration: n.duration,
            pitch: n.pitch,
            velocity: Math.round(n.velocity)
          })
        })
      }

      if (aiMode === 'full' || aiMode === 'drums') {
        tracksToUse.push(drumTrack)
        setAiStatusText('Generating rhythmic grooves with Drums RNN...')
        const drums = await generateAiDrums(
          [],
          totalSteps,
          aiTemperature,
          aiDensity,
          undefined,
          0
        )
        drums.forEach((n, idx) => {
          generatedNotes.push({
            id: `ai_d_${idx}_${Date.now()}`,
            trackId: 'track_drum',
            time: n.time,
            duration: n.duration,
            pitch: n.pitch,
            velocity: Math.round(n.velocity)
          })
        })
      }

      if (aiMode === 'bach') {
        tracksToUse.push(synthTrack)
        tracksToUse.push({
          ...synthTrack,
          id: 'track_synth_2',
          name: 'AI Counterpoint Voice',
          color: '#ffd43b',
          synthPreset: 'warm'
        })
        setAiStatusText('Harmonizing 4-part counterpoint with Coconet...')
        const seedNote = [{
          id: 'coconet_seed',
          trackId: 'track_synth',
          time: 0,
          duration: 96,
          pitch: aiScaleRoot + 60,
          velocity: 90
        }]
        const harmony = await generateAutoHarmony(seedNote)
        harmony.voice1.forEach((n: any, idx: number) => {
          generatedNotes.push({
            id: `ai_b1_${idx}_${Date.now()}`,
            trackId: 'track_synth',
            time: n.time,
            duration: n.duration,
            pitch: n.pitch,
            velocity: Math.round(n.velocity)
          })
        })
        harmony.voice2.forEach((n: any, idx: number) => {
          generatedNotes.push({
            id: `ai_b2_${idx}_${Date.now()}`,
            trackId: 'track_synth_2',
            time: n.time,
            duration: n.duration,
            pitch: n.pitch,
            velocity: Math.round(n.velocity)
          })
        })
      }

      // Load state
      useStore.getState().loadState({
        projectName: `AI - ${aiMood} (${aiBars} Bars)`,
        projectFilePath: null,
        bpm: aiBpm,
        scaleLock: scaleConfig,
        tracks: tracksToUse,
        notes: generatedNotes,
        activeTrackId: tracksToUse[0]?.id || 'track_synth',
        loopEnabled: true,
        loopStart: 0,
        loopEnd: aiBars * ticksPerBar,
        sharedPanX: 0
      })

      tracksToUse.forEach(t => {
        audioEngine.createInstrument(t.id, t.instrument || 'synth')
        if (t.instrument === 'drum' && t.drumKit) {
          audioEngine.setTrackDrumKit(t.id, t.drumKit)
        }
      })

      saveRecentProject({
        name: `AI - ${aiMood}`,
        bpm: aiBpm,
        trackCount: tracksToUse.length,
        previewSnippet: `Generated with Magenta AI (${aiBars} bars)`
      })

      setIsStartScreenOpen(false)
      enterDawFullscreen()
      showToast(`Generated ${generatedNotes.length} notes across ${tracksToUse.length} tracks!`, 'success')
    } catch (err: any) {
      console.error('AI Generation Failed:', err)
      showToast('AI Generation failed. Check console for details.', 'error')
    } finally {
      setAiGenerating(false)
      setAiStatusText('')
    }
  }

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return allTemplates.filter(tmpl => {
      const matchesCat = templateCategory === 'All' || tmpl.category === templateCategory
      const q = searchQuery.trim().toLowerCase()
      if (!q) return matchesCat
      const matchesText = tmpl.title.toLowerCase().includes(q) ||
        tmpl.description.toLowerCase().includes(q) ||
        tmpl.keyName.toLowerCase().includes(q) ||
        tmpl.tags.some(tag => tag.toLowerCase().includes(q))
      return matchesCat && matchesText
    })
  }, [allTemplates, templateCategory, searchQuery])

  if (!isStartScreenOpen) return null

  return (
    <div
      className={hasActiveSession ? "animate-modal-bg" : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: hasActiveSession ? 'rgba(6, 7, 11, 0.86)' : '#0d0e15',
        backdropFilter: hasActiveSession ? 'blur(16px)' : undefined,
        WebkitBackdropFilter: hasActiveSession ? 'blur(16px)' : undefined,
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: hasActiveSession ? '24px' : 0
      }}
      onClick={e => {
        if (e.target === e.currentTarget && hasActiveSession) {
          setIsStartScreenOpen(false)
        }
      }}
    >
      <div
        className={hasActiveSession ? "animate-modal-card" : undefined}
        style={{
          width: hasActiveSession ? '92%' : '100%',
          maxWidth: hasActiveSession ? '940px' : '100%',
          height: hasActiveSession ? '80vh' : '100%',
          maxHeight: hasActiveSession ? '620px' : '100%',
          background: '#111219',
          border: hasActiveSession ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
          borderRadius: hasActiveSession ? '20px' : 0,
          display: 'flex',
          overflow: 'hidden',
          boxShadow: hasActiveSession ? '0 30px 90px rgba(0, 0, 0, 0.9), 0 0 40px rgba(77, 171, 247, 0.08)' : 'none'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Left Navigation Sidebar */}
        <div style={{
          width: '260px',
          background: 'rgba(255, 255, 255, 0.02)',
          borderRight: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0
        }}>
          {/* Logo & Header */}
          <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <IconMuseLogo size={28} />
              <div>
                <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>
                  MUSE<span style={{ color: '#4dabf7' }}>GRID</span>
                </h1>
                <span style={{ fontSize: '10.5px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>
                  Studio Hub
                </span>
              </div>
            </div>
          </div>

          {/* Navigation Items */}
          <div style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              onClick={() => setActiveTab('library')}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: '10px',
                border: 'none',
                background: activeTab === 'library' ? 'rgba(77, 171, 247, 0.14)' : 'transparent',
                color: activeTab === 'library' ? '#4dabf7' : '#999',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: activeTab === 'library' ? 700 : 500,
                textAlign: 'left',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => { if (activeTab !== 'library') e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)' }}
              onMouseLeave={e => { if (activeTab !== 'library') e.currentTarget.style.background = 'transparent' }}
            >
              <IconOpen size={16} color={activeTab === 'library' ? '#4dabf7' : '#888'} />
              <span>Library & Projects</span>
            </button>

            <button
              onClick={() => setActiveTab('templates')}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: '10px',
                border: 'none',
                background: activeTab === 'templates' ? 'rgba(255, 146, 43, 0.14)' : 'transparent',
                color: activeTab === 'templates' ? '#ff922b' : '#999',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: activeTab === 'templates' ? 700 : 500,
                textAlign: 'left',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => { if (activeTab !== 'templates') e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)' }}
              onMouseLeave={e => { if (activeTab !== 'templates') e.currentTarget.style.background = 'transparent' }}
            >
              <IconLayers size={16} color={activeTab === 'templates' ? '#ff922b' : '#888'} />
              <span>Templates</span>
              <span style={{
                marginLeft: 'auto',
                fontSize: '10px',
                fontWeight: 700,
                background: 'rgba(255, 146, 43, 0.2)',
                color: '#ff922b',
                padding: '2px 6px',
                borderRadius: '10px'
              }}>
                {allTemplates.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: '10px',
                border: 'none',
                background: activeTab === 'ai' ? 'rgba(218, 119, 242, 0.14)' : 'transparent',
                color: activeTab === 'ai' ? '#da77f2' : '#999',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: activeTab === 'ai' ? 700 : 500,
                textAlign: 'left',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => { if (activeTab !== 'ai') e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)' }}
              onMouseLeave={e => { if (activeTab !== 'ai') e.currentTarget.style.background = 'transparent' }}
            >
              <IconSparkles size={16} color={activeTab === 'ai' ? '#da77f2' : '#888'} />
              <span>MuseAI Studio</span>
            </button>
          </div>

          {/* Bottom Footer Options */}
          <div style={{
            padding: '16px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11.5px', color: '#999', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showOnStartup}
                onChange={e => handleToggleStartup(e.target.checked)}
                style={{ accentColor: '#4dabf7', width: '14px', height: '14px', cursor: 'pointer' }}
              />
              <span>Show on app startup</span>
            </label>
            <div style={{ fontSize: '10px', color: '#555', display: 'flex', justifyContent: 'space-between' }}>
              <span>MuseGrid Native v1.1.0</span>
              <span>JUCE + Magenta</span>
            </div>
          </div>
        </div>

        {/* Central / Right Workspace Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {/* Header Bar */}
          <div style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.015)'
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#fff' }}>
                {activeTab === 'library' && 'Project Library & Starters'}
                {activeTab === 'templates' && 'Production Templates'}
                {activeTab === 'ai' && 'MuseAI Generative Studio'}
              </h2>
              <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#777' }}>
                {activeTab === 'library' && 'Create empty projects, open saved compositions, or load demo sessions.'}
                {activeTab === 'templates' && 'Jumpstart tracks with pre-configured scales, synths, and drum machines.'}
                {activeTab === 'ai' && 'Generate customized neural compositions with Google Magenta models.'}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {hasActiveSession ? (
                <button
                  onClick={handleClose}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#ccc',
                    padding: '6px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'; e.currentTarget.style.color = '#fff' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.color = '#ccc' }}
                  title="Close and return to active project (Esc)"
                >
                  <IconX size={13} />
                  <span>Close Hub</span>
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={handleSkipToWorkspace}
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#888',
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
                  >
                    Skip to Blank Workspace →
                  </button>
                  <button
                    onClick={handleClose}
                    style={{
                      background: 'rgba(255, 51, 102, 0.12)',
                      border: '1px solid rgba(255, 51, 102, 0.25)',
                      borderRadius: '8px',
                      color: '#ff6b8b',
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                    title="Quit MuseGrid Application"
                  >
                    <IconX size={13} />
                    <span>Quit</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Tab 1: Library & Projects */}
          {activeTab === 'library' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }} className="thin-scroll">
              {/* Quick Action Hero Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>
                <div
                  onClick={() => {
                    useStore.getState().setScaleLock({ enabled: false, root: 0, mode: 'major', accidental: 'sharp' })
                    onNewProject()
                    setIsStartScreenOpen(false)
                    enterDawFullscreen()
                  }}
                  style={{
                    background: 'linear-gradient(135deg, rgba(77, 171, 247, 0.08), rgba(77, 171, 247, 0.02))',
                    border: '1px solid rgba(77, 171, 247, 0.25)',
                    borderRadius: '16px',
                    padding: '20px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.borderColor = '#4dabf7'
                    e.currentTarget.style.boxShadow = '0 10px 25px rgba(77, 171, 247, 0.15)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.borderColor = 'rgba(77, 171, 247, 0.25)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(77, 171, 247, 0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconNewFile size={20} color="#4dabf7" />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', color: '#fff', fontWeight: 700 }}>New Blank Project</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '11.5px', color: '#888', lineHeight: 1.4 }}>
                      Start clean with a default synthesizer and drum machine.
                    </p>
                  </div>
                </div>

                <div
                  onClick={() => {
                    onOpenProject()
                    setIsStartScreenOpen(false)
                    enterDawFullscreen()
                  }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '16px',
                    padding: '20px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
                  }}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconOpen size={20} color="#ccc" />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', color: '#fff', fontWeight: 700 }}>Open File...</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '11.5px', color: '#888', lineHeight: 1.4 }}>
                      Load an existing .muz or .muztrack project.
                    </p>
                  </div>
                </div>

                <div
                  onClick={() => {
                    const showcase = DAW_TEMPLATES[0] // Synthwave Cyberpunk
                    handleLoadTemplate(showcase)
                  }}
                  style={{
                    background: 'linear-gradient(135deg, rgba(247, 37, 133, 0.08), rgba(247, 37, 133, 0.02))',
                    border: '1px solid rgba(247, 37, 133, 0.25)',
                    borderRadius: '16px',
                    padding: '20px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.borderColor = '#f72585'
                    e.currentTarget.style.boxShadow = '0 10px 25px rgba(247, 37, 133, 0.15)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.borderColor = 'rgba(247, 37, 133, 0.25)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(247, 37, 133, 0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconZap size={20} color="#f72585" />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', color: '#fff', fontWeight: 700 }}>Showcase Demo</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '11.5px', color: '#888', lineHeight: 1.4 }}>
                      Instant play of the Synthwave Cyberpunk showcase.
                    </p>
                  </div>
                </div>
              </div>

              {/* Recent Projects Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0, fontSize: '13px', color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    Recent Projects
                  </h4>
                  {recentList.length > 0 && (
                    <button
                      onClick={handleClearAllRecents}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        color: '#888',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = '#ff6b8b'
                        e.currentTarget.style.borderColor = 'rgba(255, 51, 102, 0.35)'
                        e.currentTarget.style.background = 'rgba(255, 51, 102, 0.08)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = '#888'
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
                      }}
                      title="Clear recent projects history (files on disk will not be deleted)"
                    >
                      <IconTrash size={12} />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>

                {recentList.length === 0 ? (
                  <div style={{
                    padding: '40px 20px',
                    border: '1px dashed rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    textAlign: 'center',
                    color: '#666'
                  }}>
                    <IconMusic size={28} color="#444" style={{ marginBottom: '8px' }} />
                    <p style={{ margin: 0, fontSize: '13px', color: '#888' }}>No recent projects found</p>
                    <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#555' }}>
                      Projects you create, open, or save will appear here for fast access.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {recentList.map(item => {
                      const isTemplate = DAW_TEMPLATES.some(
                        t => t.title.toLowerCase() === item.name.toLowerCase() ||
                             t.id.toLowerCase() === item.id.toLowerCase()
                      )
                      const isDeleting = animatingDeleteIds.has(item.id)
                      return (
                        <div
                          key={item.id}
                          onClick={() => !isDeleting && handleOpenRecent(item)}
                          onContextMenu={e => {
                            if (isDeleting) return
                            e.preventDefault()
                            e.stopPropagation()
                            setContextMenu({
                              item,
                              x: e.clientX,
                              y: e.clientY
                            })
                          }}
                          title="Left-click to open • Right-click for options"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: isDeleting ? '0px 16px' : '12px 16px',
                            maxHeight: isDeleting ? '0px' : '72px',
                            opacity: isDeleting ? 0 : 1,
                            transform: isDeleting ? 'scale(0.92) translateX(30px)' : 'scale(1) translateX(0)',
                            marginBottom: isDeleting ? '-8px' : '0px',
                            overflow: 'hidden',
                            background: 'rgba(255, 255, 255, 0.025)',
                            border: isDeleting ? '0px solid transparent' : '1px solid rgba(255, 255, 255, 0.06)',
                            borderRadius: '10px',
                            cursor: isDeleting ? 'default' : 'pointer',
                            pointerEvents: isDeleting ? 'none' : 'auto',
                            transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
                          }}
                          onMouseEnter={e => {
                            if (isDeleting) return
                            e.currentTarget.style.background = 'rgba(77, 171, 247, 0.08)'
                            e.currentTarget.style.borderColor = 'rgba(77, 171, 247, 0.35)'
                            e.currentTarget.style.transform = 'translateY(-1px)'
                          }}
                          onMouseLeave={e => {
                            if (isDeleting) return
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)'
                            e.currentTarget.style.transform = 'translateY(0)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: isTemplate ? 'rgba(255, 146, 43, 0.15)' : 'rgba(77, 171, 247, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <IconMusic size={16} color={isTemplate ? '#ff922b' : '#4dabf7'} />
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#eee' }}>{item.name}</span>
                                <span style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  background: isTemplate ? 'rgba(255, 146, 43, 0.18)' : 'rgba(77, 171, 247, 0.18)',
                                  color: isTemplate ? '#ff922b' : '#4dabf7'
                                }}>
                                  {isTemplate ? 'Template' : (item.filePath ? 'Saved File' : 'Session')}
                                </span>
                              </div>
                              <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>
                                {item.filePath ? item.filePath : (item.previewSnippet || 'Studio Project')}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                            {item.bpm && (
                              <span style={{ fontSize: '11px', color: '#888', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                                {item.bpm} BPM
                              </span>
                            )}
                            {openingId === item.id ? (
                              <span style={{
                                fontSize: '11px',
                                color: '#00e6ff',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}>
                                <span style={{
                                  width: '9px',
                                  height: '9px',
                                  border: '2px solid rgba(0, 230, 255, 0.25)',
                                  borderTopColor: '#00e6ff',
                                  borderRadius: '50%',
                                  display: 'inline-block',
                                  animation: 'spin 0.8s linear infinite'
                                }} />
                                Opening...
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#666' }}>
                                {new Date(item.lastModified).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: DAW Templates */}
          {activeTab === 'templates' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Category Pills & Search */}
              <div style={{
                padding: '12px 24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap'
              }}>
                <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
                  {['All', 'Custom', 'Electronic', 'Hip-Hop', 'Dance', 'Ambient', 'World', 'Acoustic', 'Experimental'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setTemplateCategory(cat)}
                      style={{
                        padding: '5px 11px',
                        borderRadius: '20px',
                        border: '1px solid',
                        borderColor: templateCategory === cat ? '#ff922b' : 'rgba(255, 255, 255, 0.08)',
                        background: templateCategory === cat ? 'rgba(255, 146, 43, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                        color: templateCategory === cat ? '#ff922b' : '#aaa',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.12s'
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '20px',
                    padding: '4px 12px',
                    width: '160px'
                  }}>
                    <IconSearch size={12} color="#666" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search templates..."
                      style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: '11px', width: '100%' }}
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0 }}>
                        <IconX size={11} />
                      </button>
                    )}
                  </div>

                  <button
                    onClick={handleStartAddTemplate}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: 'rgba(255, 146, 43, 0.12)',
                      border: '1px solid rgba(255, 146, 43, 0.3)',
                      borderRadius: '20px',
                      padding: '5px 12px',
                      color: '#ff922b',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255, 146, 43, 0.22)'
                      e.currentTarget.style.color = '#fff'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255, 146, 43, 0.12)'
                      e.currentTarget.style.color = '#ff922b'
                    }}
                    title="Choose a .muz file to add as a custom template"
                  >
                    <IconPlus size={12} />
                    <span>Add Template</span>
                  </button>
                </div>
              </div>

              {/* Templates Grid */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="thin-scroll">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
                  {filteredTemplates.map(tmpl => (
                    <div
                      key={tmpl.id}
                      onClick={() => handleLoadTemplate(tmpl)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.025)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '14px',
                        padding: '14px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        transition: 'all 0.18s',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.transform = 'translateY(-2px)'
                        e.currentTarget.style.borderColor = tmpl.badgeColor
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                        e.currentTarget.style.boxShadow = `0 10px 25px ${tmpl.badgeColor}22`
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.transform = 'translateY(0)'
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)'
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      {/* Mini Grid Thumbnail Preview (SVG) */}
                      <div style={{
                        width: '100%',
                        height: '76px',
                        background: '#0d0e14',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.04)',
                        overflow: 'hidden',
                        position: 'relative'
                      }}>
                        <svg width="100%" height="100%" viewBox="0 0 160 60" preserveAspectRatio="none">
                          {/* Grid background lines */}
                          <line x1="0" y1="15" x2="160" y2="15" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                          <line x1="0" y1="30" x2="160" y2="30" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                          <line x1="0" y1="45" x2="160" y2="45" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                          <line x1="40" y1="0" x2="40" y2="60" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                          <line x1="80" y1="0" x2="80" y2="60" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8" />
                          <line x1="120" y1="0" x2="120" y2="60" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />

                          {/* Render preview notes */}
                          {(tmpl.previewPattern?.synth || []).map((item, idx) => {
                            const x = (item.t / 8) * 160
                            const y = 45 - (item.p / 9) * 40
                            const width = (item.len / 8) * 160 - 2
                            return (
                              <rect
                                key={`syn_${idx}`}
                                x={x}
                                y={y}
                                width={Math.max(4, width)}
                                height="4.5"
                                rx="1.5"
                                fill={tmpl.badgeColor}
                                opacity="0.9"
                              />
                            )
                          })}

                          {/* Render preview drums */}
                          {(tmpl.previewPattern?.drum || []).map((item, idx) => {
                            const x = (item.t / 8) * 160 + 2
                            const y = 50 + item.r * 2.5
                            return (
                              <circle
                                key={`drm_${idx}`}
                                cx={x}
                                cy={Math.min(56, y)}
                                r="2"
                                fill="#ffd43b"
                                opacity="0.85"
                              />
                            )
                          })}
                        </svg>

                        <div style={{
                          position: 'absolute',
                          top: '6px',
                          right: '6px',
                          background: 'rgba(0,0,0,0.6)',
                          backdropFilter: 'blur(4px)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontSize: '9px',
                          fontWeight: 700,
                          color: '#fff'
                        }}>
                          {tmpl.bpm} BPM
                        </div>
                      </div>

                      {/* Title & Key */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#fff' }}>
                            {tmpl.title}
                          </h4>
                          {tmpl.isUserTemplate && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'rgba(255, 146, 43, 0.2)', color: '#ff922b' }}>
                                Custom
                              </span>
                              <button
                                onClick={(e) => handleDeleteUserTemplate(tmpl.id, e)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#777',
                                  cursor: 'pointer',
                                  padding: '2px',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = '#ff6b8b'}
                                onMouseLeave={e => e.currentTarget.style.color = '#777'}
                                title="Delete this custom template"
                              >
                                <IconTrash size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: '10px', color: tmpl.badgeColor, fontWeight: 700, marginTop: '2px' }}>
                          {tmpl.keyName}
                        </div>
                      </div>

                      {/* Description */}
                      <p style={{ margin: 0, fontSize: '11px', color: '#777', lineHeight: 1.35, flex: 1 }}>
                        {tmpl.description}
                      </p>

                      {/* Tags */}
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: 'auto' }}>
                        {tmpl.tags.map(tag => (
                          <span
                            key={tag}
                            style={{
                              fontSize: '9px',
                              background: 'rgba(255,255,255,0.04)',
                              color: '#888',
                              padding: '2px 5px',
                              borderRadius: '4px'
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: AI Studio */}
          {activeTab === 'ai' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }} className="thin-scroll">
              <div style={{ maxWidth: '680px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Mode Selector */}
                <div>
                  <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#999', letterSpacing: '0.2px', display: 'block', marginBottom: '8px' }}>
                    1. Generation mode
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    {[
                      { id: 'full', label: 'Full Production', sub: 'Melody + Drums', icon: <IconMusic size={14} color="#da77f2" /> },
                      { id: 'melody', label: 'Melody Hook', sub: 'MusicRNN', icon: <IconMusic size={14} color="#4dabf7" /> },
                      { id: 'drums', label: 'Rhythm Groove', sub: 'Drums RNN', icon: <IconDrum size={14} color="#ff922b" /> },
                      { id: 'bach', label: 'Bach Polyphony', sub: 'Coconet 4-Part', icon: <IconLayers size={14} color="#ffd43b" /> }
                    ].map(item => (
                      <button
                        key={item.id}
                        onClick={() => setAiMode(item.id as any)}
                        style={{
                          padding: '12px 10px',
                          borderRadius: '12px',
                          border: '1px solid',
                          borderColor: aiMode === item.id ? '#da77f2' : 'rgba(255,255,255,0.08)',
                          background: aiMode === item.id ? 'rgba(218, 119, 242, 0.12)' : 'rgba(255,255,255,0.02)',
                          color: aiMode === item.id ? '#fff' : '#aaa',
                          textAlign: 'center',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.15s'
                        }}
                      >
                        {item.icon}
                        <span style={{ fontSize: '12px', fontWeight: 700 }}>{item.label}</span>
                        <span style={{ fontSize: '9.5px', color: '#777' }}>{item.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mood Presets */}
                <div>
                  <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#999', letterSpacing: '0.2px', display: 'block', marginBottom: '8px' }}>
                    2. Genre & mood
                  </label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[
                      'Cyberpunk Synth', 'Dark Trap 808', 'Melodic Techno', 'Dreamy Lo-Fi',
                      'Classical Chamber', 'Funky Syncopation', 'Acid Groove', 'Ambient Glass'
                    ].map(m => (
                      <button
                        key={m}
                        onClick={() => {
                          setAiMood(m)
                          if (m.includes('Trap')) { setAiBpm(140); setAiScaleMode('minor') }
                          else if (m.includes('Techno')) { setAiBpm(126); setAiScaleMode('minor') }
                          else if (m.includes('Lo-Fi')) { setAiBpm(82); setAiScaleMode('major') }
                          else if (m.includes('Ambient')) { setAiBpm(68); setAiScaleMode('lydian') }
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '20px',
                          border: '1px solid',
                          borderColor: aiMood === m ? '#da77f2' : 'rgba(255,255,255,0.06)',
                          background: aiMood === m ? 'rgba(218,119,242,0.15)' : 'rgba(255,255,255,0.02)',
                          color: aiMood === m ? '#fff' : '#888',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Musical Scale & Tempo */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>
                      Root Key
                    </label>
                    <select
                      value={aiScaleRoot}
                      onChange={e => setAiScaleRoot(Number(e.target.value))}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: '#181924',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '12px',
                        outline: 'none'
                      }}
                    >
                      {SCALE_ROOTS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>
                      Scale Mode
                    </label>
                    <select
                      value={aiScaleMode}
                      onChange={e => setAiScaleMode(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: '#181924',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '12px',
                        outline: 'none'
                      }}
                    >
                      {SCALE_MODES.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>
                      BPM (Tempo)
                    </label>
                    <input
                      type="number"
                      min={40}
                      max={240}
                      value={aiBpm}
                      onChange={e => setAiBpm(Number(e.target.value))}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: '#181924',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '12px',
                        outline: 'none'
                      }}
                    />
                  </div>
                </div>

                {/* Length & Parameters */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '6px' }}>
                      Length: <strong style={{ color: '#fff' }}>{aiBars} Bars</strong>
                    </label>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[2, 4, 8, 16].map(b => (
                        <button
                          key={b}
                          onClick={() => setAiBars(b as any)}
                          style={{
                            flex: 1,
                            padding: '6px 0',
                            borderRadius: '6px',
                            border: '1px solid',
                            borderColor: aiBars === b ? '#da77f2' : 'rgba(255,255,255,0.08)',
                            background: aiBars === b ? 'rgba(218,119,242,0.15)' : 'transparent',
                            color: aiBars === b ? '#da77f2' : '#888',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          {b}B
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '8px' }}>
                      Creativity: <strong style={{ color: '#fff' }}>{aiTemperature.toFixed(2)}</strong>
                    </label>
                    <AppSlider
                      min={0.4}
                      max={1.4}
                      step={0.05}
                      value={aiTemperature}
                      onChange={setAiTemperature}
                      color="#da77f2"
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#666', marginTop: '4px' }}>
                      <span>Tight</span>
                      <span>Wild</span>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '8px' }}>
                      Density: <strong style={{ color: '#fff' }}>{Math.round(aiDensity * 100)}%</strong>
                    </label>
                    <AppSlider
                      min={0.3}
                      max={1.0}
                      step={0.05}
                      value={aiDensity}
                      onChange={setAiDensity}
                      color="#da77f2"
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#666', marginTop: '4px' }}>
                      <span>Sparse</span>
                      <span>Intense</span>
                    </div>
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  disabled={aiGenerating}
                  onClick={handleGenerateAiProject}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid #6741d9',
                    background: '#4c2889',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: aiGenerating ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: 'none',
                    transition: 'all 0.15s',
                    opacity: aiGenerating ? 0.6 : 1
                  }}
                  onMouseEnter={e => {
                    if (!aiGenerating) {
                      e.currentTarget.style.background = '#5c3dbd'
                      e.currentTarget.style.borderColor = '#7950f2'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!aiGenerating) {
                      e.currentTarget.style.background = '#4c2889'
                      e.currentTarget.style.borderColor = '#6741d9'
                    }
                  }}
                >
                  <IconMusic size={15} color="#fff" />
                  <span>{aiGenerating ? (aiStatusText || 'Generating template...') : 'Generate template'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Project Context Menu */}
      {contextMenu && (
        <div
          className="animate-pop-in"
          style={{
            position: 'fixed',
            left: Math.max(10, Math.min(contextMenu.x, window.innerWidth - 220)),
            top: Math.max(10, Math.min(contextMenu.y, window.innerHeight - 190)),
            zIndex: 100005,
            background: '#151722',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '10px',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.7), 0 0 20px rgba(0, 0, 0, 0.5)',
            padding: '5px',
            minWidth: '200px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)'
          }}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
        >
          {/* 1. Open */}
          <button
            onClick={() => {
              const it = contextMenu.item
              setContextMenu(null)
              handleOpenRecent(it)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: '#eee',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.12s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(77, 171, 247, 0.16)'
              e.currentTarget.style.color = '#4dabf7'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#eee'
            }}
          >
            <IconOpen size={14} color="#4dabf7" />
            <span>Open</span>
          </button>

          {/* Separator */}
          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.07)', margin: '3px 4px' }} />

          {/* 2. Remove from Recent */}
          <button
            onClick={() => handleRemoveFromRecent(contextMenu.item)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: '#ccc',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.12s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
              e.currentTarget.style.color = '#fff'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#ccc'
            }}
          >
            <IconX size={14} color="#888" />
            <span>Remove from Recent</span>
          </button>

          {/* Separator */}
          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.07)', margin: '3px 4px' }} />

          {/* 3. Delete */}
          <button
            onClick={() => {
              const it = contextMenu.item
              setContextMenu(null)
              setConfirmModal({ type: 'delete', item: it })
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: '#ffa94d',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.12s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 169, 77, 0.14)'
              e.currentTarget.style.color = '#ff922b'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#ffa94d'
            }}
          >
            <IconTrash size={14} color="#ffa94d" />
            <span>Delete</span>
          </button>

          {/* 4. Permanent Delete */}
          <button
            onClick={() => {
              const it = contextMenu.item
              setContextMenu(null)
              setConfirmModal({ type: 'permanent-delete', item: it })
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: '#ff6b8b',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.12s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 51, 102, 0.16)'
              e.currentTarget.style.color = '#ff3366'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#ff6b8b'
            }}
          >
            <IconAlertTriangle size={14} color="#ff6b8b" />
            <span>Permanent Delete</span>
          </button>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmModal && (
        <div
          className={confirmModalClosing ? 'animate-modal-bg-exit' : 'animate-modal-bg'}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 100010,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={handleCloseConfirmModal}
        >
          <div
            className={confirmModalClosing ? 'animate-modal-card-exit' : 'animate-modal-card'}
            style={{
              width: '100%',
              maxWidth: '420px',
              background: '#161823',
              border: confirmModal.type === 'permanent-delete'
                ? '1px solid rgba(255, 51, 102, 0.35)'
                : confirmModal.type === 'delete'
                  ? '1px solid rgba(255, 169, 77, 0.35)'
                  : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: confirmModal.type === 'permanent-delete'
                  ? 'rgba(255, 51, 102, 0.16)'
                  : confirmModal.type === 'delete'
                    ? 'rgba(255, 169, 77, 0.16)'
                    : 'rgba(77, 171, 247, 0.16)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {confirmModal.type === 'permanent-delete' && <IconAlertTriangle size={22} color="#ff6b8b" />}
                {confirmModal.type === 'delete' && <IconTrash size={22} color="#ffa94d" />}
                {confirmModal.type === 'clear-all' && <IconTrash size={22} color="#4dabf7" />}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                  {confirmModal.type === 'permanent-delete' && 'Permanent Delete Project'}
                  {confirmModal.type === 'delete' && 'Move Project to Recycle Bin'}
                  {confirmModal.type === 'clear-all' && 'Clear Recent Projects History'}
                </h3>
                <p style={{ margin: '6px 0 0', fontSize: '12.5px', color: '#999', lineHeight: 1.5 }}>
                  {confirmModal.type === 'permanent-delete' && (
                    confirmModal.item?.filePath
                      ? `Are you sure you want to permanently delete "${confirmModal.item.name}" from your computer? This file will be completely erased and CANNOT be restored.`
                      : `Remove "${confirmModal.item?.name}" from your recent projects list? (No file exists on disk).`
                  )}
                  {confirmModal.type === 'delete' && (
                    confirmModal.item?.filePath
                      ? `Are you sure you want to delete "${confirmModal.item.name}"? It will be moved to your computer's Recycle Bin / Trash.`
                      : `Remove "${confirmModal.item?.name}" from your recent projects list? (No file exists on disk).`
                  )}
                  {confirmModal.type === 'clear-all' && (
                    'Are you sure you want to clear all projects from the recent list? Your saved files on disk will NOT be deleted.'
                  )}
                </p>
                {confirmModal.item?.filePath && confirmModal.type !== 'clear-all' && (
                  <div style={{
                    marginTop: '10px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    fontSize: '11px',
                    color: '#777',
                    wordBreak: 'break-all'
                  }}>
                    {confirmModal.item.filePath}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                onClick={handleCloseConfirmModal}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#ccc',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.color = '#ccc' }}
              >
                Cancel
              </button>

              {confirmModal.type === 'clear-all' ? (
                <button
                  onClick={handleExecuteClearAll}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: 'rgba(255, 51, 102, 0.15)',
                    border: '1px solid rgba(255, 51, 102, 0.35)',
                    color: '#ff6b8b',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 51, 102, 0.25)'; e.currentTarget.style.color = '#fff' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 51, 102, 0.15)'; e.currentTarget.style.color = '#ff6b8b' }}
                >
                  Clear All
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (confirmModal.item) {
                      handleExecuteDelete(confirmModal.item, confirmModal.type === 'permanent-delete')
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: confirmModal.type === 'permanent-delete'
                      ? 'linear-gradient(135deg, #ff3366, #e03131)'
                      : 'linear-gradient(135deg, #f76707, #d9480f)',
                    border: 'none',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: confirmModal.type === 'permanent-delete'
                      ? '0 4px 15px rgba(255, 51, 102, 0.35)'
                      : '0 4px 15px rgba(247, 103, 7, 0.35)'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
                >
                  {confirmModal.type === 'permanent-delete' ? 'Permanently Delete' : 'Move to Trash'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Template Modal */}
      {newTemplateModal && (
        <div
          className={newTemplateClosing ? 'animate-modal-bg-exit' : 'animate-modal-bg'}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 100015,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={handleCloseNewTemplateModal}
        >
          <div
            className={newTemplateClosing ? 'animate-modal-card-exit' : 'animate-modal-card'}
            style={{
              width: '100%',
              maxWidth: '520px',
              background: '#151722',
              border: '1px solid rgba(255, 146, 43, 0.3)',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(255, 146, 43, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: 'rgba(255, 146, 43, 0.16)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <IconLayers size={16} color="#ff922b" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#fff' }}>
                    Add Custom Template
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#777' }}>
                    Configure metadata and preview your new template card.
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseNewTemplateModal}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}
              >
                <IconX size={16} />
              </button>
            </div>

            {/* Template Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Row 1: Name */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>
                  Template Name
                </label>
                <input
                  type="text"
                  value={newTemplateModal.title}
                  onChange={e => setNewTemplateModal({ ...newTemplateModal, title: e.target.value })}
                  placeholder="e.g. My Cyberpunk Synth"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#1a1c28',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Row 2: Category & BPM */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>
                    Category
                  </label>
                  <select
                    value={newTemplateModal.category}
                    onChange={e => setNewTemplateModal({ ...newTemplateModal, category: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: '#1a1c28',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  >
                    {['Custom', 'Electronic', 'Hip-Hop', 'Dance', 'Ambient', 'World', 'Acoustic', 'Experimental'].map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>
                    BPM (Tempo)
                  </label>
                  <input
                    type="number"
                    min={40}
                    max={240}
                    value={newTemplateModal.bpm}
                    onChange={e => setNewTemplateModal({ ...newTemplateModal, bpm: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: '#1a1c28',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              {/* Row 3: Tags */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={newTemplateModal.tagsString}
                  onChange={e => setNewTemplateModal({ ...newTemplateModal, tagsString: e.target.value })}
                  placeholder="e.g. Synth, Lead, Fast Beats, 808"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#1a1c28',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Row 4: Description */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={newTemplateModal.description}
                  onChange={e => setNewTemplateModal({ ...newTemplateModal, description: e.target.value })}
                  placeholder="Short description of this template..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#1a1c28',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Thumbnail Card Preview */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '6px' }}>
                  Live Thumbnail & Card Preview:
                </label>
                <div style={{
                  background: 'rgba(255, 255, 255, 0.025)',
                  border: '1px solid rgba(255, 146, 43, 0.3)',
                  borderRadius: '12px',
                  padding: '12px',
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'center'
                }}>
                  {/* SVG mini thumbnail */}
                  <div style={{
                    width: '130px',
                    height: '64px',
                    background: '#0d0e14',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    overflow: 'hidden',
                    position: 'relative',
                    flexShrink: 0
                  }}>
                    <svg width="100%" height="100%" viewBox="0 0 160 60" preserveAspectRatio="none">
                      <line x1="0" y1="15" x2="160" y2="15" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                      <line x1="0" y1="30" x2="160" y2="30" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                      <line x1="0" y1="45" x2="160" y2="45" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                      {(newTemplateModal.previewPattern?.synth || []).map((item, idx) => {
                        const x = (item.t / 8) * 160
                        const y = 45 - (item.p / 9) * 40
                        const width = (item.len / 8) * 160 - 2
                        return (
                          <rect
                            key={`pre_syn_${idx}`}
                            x={x}
                            y={y}
                            width={Math.max(4, width)}
                            height="4.5"
                            rx="1.5"
                            fill="#ff922b"
                            opacity="0.9"
                          />
                        )
                      })}
                      {(newTemplateModal.previewPattern?.drum || []).map((item, idx) => {
                        const x = (item.t / 8) * 160 + 2
                        const y = 50 + item.r * 2.5
                        return (
                          <circle
                            key={`pre_drm_${idx}`}
                            cx={x}
                            cy={Math.min(56, y)}
                            r="2"
                            fill="#ffd43b"
                            opacity="0.85"
                          />
                        )
                      })}
                    </svg>
                    <div style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      background: 'rgba(0,0,0,0.6)',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontSize: '8.5px',
                      fontWeight: 700,
                      color: '#fff'
                    }}>
                      {newTemplateModal.bpm} BPM
                    </div>
                  </div>

                  {/* Card info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {newTemplateModal.title || 'Untitled Template'}
                      </span>
                      <span style={{ fontSize: '9px', fontWeight: 700, color: '#ff922b', background: 'rgba(255,146,43,0.18)', padding: '1px 5px', borderRadius: '4px' }}>
                        {newTemplateModal.category}
                      </span>
                    </div>
                    <div style={{ fontSize: '10px', color: '#ff922b', fontWeight: 600, marginTop: '2px' }}>
                      {newTemplateModal.keyName}
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#777', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {newTemplateModal.description || 'Custom user template'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                onClick={handleCloseNewTemplateModal}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#ccc',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewTemplate}
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  background: 'rgba(255, 146, 43, 0.2)',
                  border: '1px solid #ff922b',
                  color: '#ff922b',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#ff922b'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 146, 43, 0.2)'; e.currentTarget.style.color = '#ff922b' }}
              >
                Add as Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
