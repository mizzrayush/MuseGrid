import React, { useState, useMemo } from 'react'
import { useStore, deduplicateNotes } from '../engine/store'
import type { Note, Track } from '../engine/store'
import {
  IconUndo, IconRedo, IconZap, IconScissors, IconMusic, IconSliders,
  IconShuffle, IconTarget, IconChevronDown, IconChevronRight
} from './Icons'
import { sliderProgress } from './AppSlider'
import {
  applyLegato, applyStrum, applyFlam, applyGlue, applyDice,
  applyRemoveOverlaps, applyChop, applyArpeggio, applyTranspose,
  applyModalTranspose, applyForceToScale, applyHarmonize,
  applyChordInversion, applyFlipHorizontal, applyFlipVertical,
  applyTimeStretch, applyVelocityRamp, applyVelocityCompress,
  applyVelocityNormalize, applyFixedVelocity, applyHumanize,
  filterOddEvenNotes, filterVoiceNotes, applyPurgeShortNotes,
  applyRatchet, applyMicroNudge, applyGlideChain, clearNoteGlides
} from '../utils/midiEditing'
import type {
  ChopPattern, ArpPattern, VelocityCurve, HarmonizeType,
  GlideCurveType, GlideOrderType, GlideDurationMode
} from '../utils/midiEditing'

interface MidiEditSectionProps {
  activeTrack?: Track | null
}

type TabType = 'quick' | 'chopArp' | 'pitch' | 'velocity' | 'humanize' | 'select'

export const MidiEditSection: React.FC<MidiEditSectionProps> = ({ activeTrack }) => {
  const notes = useStore(s => s.notes)
  const selectedNoteIds = useStore(s => s.selectedNoteIds)
  const setSelectedNoteIds = useStore(s => s.setSelectedNoteIds)
  const commitHistory = useStore(s => s.commitHistory)
  const undo = useStore(s => s.undo)
  const redo = useStore(s => s.redo)
  const snapResolution = useStore(s => s.snapResolution)
  const scaleLock = useStore(s => s.scaleLock)
  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    useStore.getState().showToast(msg, type)
  }

  const isDrum = activeTrack?.instrument === 'drum'

  // Active Tab synchronized with global store (supports hotkey switching from Grid)
  const storeActiveTab = useStore(s => s.activeMidiEditTab)
  const setActiveMidiEditTab = useStore(s => s.setActiveMidiEditTab)
  const activeTab = storeActiveTab || 'quick'
  const setActiveTab = (tab: TabType) => setActiveMidiEditTab(tab)

  // Target Scope Override: 'auto' (selected if any on active track, else all active track), 'selected', 'track'
  const [scopeMode, setScopeMode] = useState<'auto' | 'selected' | 'track'>('auto')

  // Tool Drawer States
  const [openDrawer, setOpenDrawer] = useState<string | null>(null)

  // Tool Configs:
  // 1. Strum
  const [strumTime, setStrumTime] = useState(12)
  const [strumDirection, setStrumDirection] = useState<'up' | 'down' | 'alternate'>('up')
  const [strumTension, setStrumTension] = useState(0) // -1 to 1
  const [strumVelRamp, setStrumVelRamp] = useState(0) // -40 to 40
  const [strumAlignEnds, setStrumAlignEnds] = useState(false)

  // 2. Legato
  const [legatoGap, setLegatoGap] = useState(0) // ticks

  // 3. Flam
  const [flamDelay, setFlamDelay] = useState(12)
  const [flamVelRatio, setFlamVelRatio] = useState(0.65)

  // 4. Chopper & Arp
  const [chopGate, setChopGate] = useState(1.0)
  const [arpPattern, setArpPattern] = useState<ArpPattern>('up')
  const [arpRate, setArpRate] = useState<number>(48) // 48 = 1/16
  const [arpOctaves, setArpOctaves] = useState<number>(1)
  const [arpGate, setArpGate] = useState<number>(0.85)

  // 5. Pitch
  const [transposeSliderVal, setTransposeSliderVal] = useState(0)
  const [harmonizeType, setHarmonizeType] = useState<HarmonizeType>('triad')

  // 6. Velocity Ramp
  const [rampStartVel, setRampStartVel] = useState(40)
  const [rampEndVel, setRampEndVel] = useState(115)
  const [rampCurve, setRampCurve] = useState<VelocityCurve>('linear')
  const [compTarget, setCompTarget] = useState(85)
  const [compRatio, setCompRatio] = useState(0.5)

  // 7. Humanize
  const [humTiming, setHumTiming] = useState(8) // ticks
  const [humVel, setHumVel] = useState(15) // %
  const [humDur, setHumDur] = useState(10) // %
  const [humPitch, setHumPitch] = useState(0) // semitones

  // 8. Time Stretch
  const [stretchRatio, setStretchRatio] = useState(1.0)

  // 9. Ratchet / Rolls & Micro-Nudge
  const [ratchetSlices, setRatchetSlices] = useState(4)
  const [ratchetCurve, setRatchetCurve] = useState<'flat' | 'crescendo' | 'decrescendo'>('flat')

  // 10. Multi-Note Glide Chain
  const [glideCurve, setGlideCurve] = useState<GlideCurveType>('cubicInOut')
  const [glideCustomEquation, setGlideCustomEquation] = useState('t * t * t')
  const [glideOrder, setGlideOrder] = useState<GlideOrderType>('time')
  const [glideDurationMode, setGlideDurationMode] = useState<GlideDurationMode>('full')
  const [glideExtendLegato, setGlideExtendLegato] = useState(true)
  const [glideLoopChain, setGlideLoopChain] = useState(false)

  // Enforce: MIDI edit tools affect ONLY the active/selected track!
  const activeTrackNotes = useMemo(() => {
    if (!activeTrack) return []
    return notes.filter(n => n.trackId === activeTrack.id)
  }, [notes, activeTrack])

  const targetNotes = useMemo(() => {
    if (!activeTrack) return []
    if (scopeMode === 'track') return activeTrackNotes

    // If notes are selected, only include selected notes that belong to activeTrack
    const activeSelected = activeTrackNotes.filter(n => selectedNoteIds.includes(n.id))
    if (scopeMode === 'selected') return activeSelected

    // 'auto' mode:
    if (activeSelected.length > 0) return activeSelected
    return activeTrackNotes
  }, [activeTrackNotes, selectedNoteIds, activeTrack, scopeMode])

  const targetLabel = useMemo(() => {
    if (!activeTrack) return 'No active track'
    const activeSelected = activeTrackNotes.filter(n => selectedNoteIds.includes(n.id))
    if (activeSelected.length > 0 && (scopeMode === 'auto' || scopeMode === 'selected')) {
      return `${activeTrack.name} • ${activeSelected.length} note${activeSelected.length === 1 ? '' : 's'} sel`
    }
    return `${activeTrack.name} • All ${activeTrackNotes.length} notes`
  }, [activeTrack, activeTrackNotes, selectedNoteIds, scopeMode])

  const effectiveScale = activeTrack?.scaleOverride || scaleLock

  // Core Mutation Helper with strict active track isolation
  const replaceTargetNotes = (newTargetNotes: Note[], successMessage: string) => {
    if (!activeTrack || targetNotes.length === 0) {
      showToast('No notes to edit on active track! Select notes or add notes.', 'error')
      return
    }

    commitHistory()
    const targetIdSet = new Set(targetNotes.map(n => n.id))
    // Strict isolation: only notes in targetIdSet are replaced; all notes on other tracks are untouched!
    const unchangedNotes = notes.filter(n => !targetIdSet.has(n.id))
    const finalNotes = deduplicateNotes([...unchangedNotes, ...newTargetNotes])

    useStore.setState({ notes: finalNotes })

    // Update selection if appropriate
    const newTargetIds = newTargetNotes.map(n => n.id)
    if (selectedNoteIds.length > 0) {
      setSelectedNoteIds(newTargetIds)
    }

    showToast(successMessage, 'success')
  }

  // --- ACTIONS ---

  // 1. Quick Tools
  const handleQuickLegato = () => {
    const updated = applyLegato(targetNotes, { gapTicks: legatoGap })
    replaceTargetNotes(updated, 'Legato applied (Ctrl+L)')
  }

  const handleQuickStrum = () => {
    const updated = applyStrum(targetNotes, {
      strumTime,
      direction: strumDirection,
      tension: strumTension,
      velocityRamp: strumVelRamp,
      alignEnds: strumAlignEnds,
    })
    replaceTargetNotes(updated, `Strummed ${targetNotes.length} notes (Alt+S)`)
  }

  const handleQuickFlam = () => {
    const updated = applyFlam(targetNotes, { delayTicks: flamDelay, velocityRatio: flamVelRatio })
    replaceTargetNotes(updated, `Flam grace notes added`)
  }

  const handleQuickGlue = () => {
    const updated = applyGlue(targetNotes)
    if (updated.length < targetNotes.length) {
      replaceTargetNotes(updated, 'Joined notes (Ctrl+G)')
    } else {
      useStore.getState().showToast('No same-pitch notes joined', 'info')
    }
  }

  const handleQuickDice = () => {
    const updated = applyDice(targetNotes, snapResolution)
    replaceTargetNotes(updated, `Diced notes at grid (${snapResolution}t)`)
  }

  const handleQuickRemoveOverlaps = () => {
    const updated = applyRemoveOverlaps(targetNotes)
    replaceTargetNotes(updated, 'Polyphonic overlaps cleaned')
  }

  // 2. Chop & Arp
  const handleChop = (pattern: ChopPattern) => {
    const updated = applyChop(targetNotes, { pattern, gateRatio: chopGate })
    replaceTargetNotes(updated, `Chopped into ${pattern} slices`)
  }

  const handleArp = () => {
    const updated = applyArpeggio(targetNotes, {
      pattern: arpPattern,
      rateTicks: arpRate,
      octaves: arpOctaves,
      gateRatio: arpGate,
    })
    replaceTargetNotes(updated, `Arpeggiated (${arpPattern.toUpperCase()}, ${arpOctaves} Oct)`)
  }

  const handleApplyRatchet = (slices = ratchetSlices, curve = ratchetCurve) => {
    const updated = applyRatchet(targetNotes, slices, curve)
    replaceTargetNotes(updated, `Subdivided into ${slices}x Ratchet Roll`)
  }

  const handleMicroNudge = (ticks: number) => {
    const updated = applyMicroNudge(targetNotes, ticks)
    replaceTargetNotes(updated, `Nudged ${ticks > 0 ? '+' : ''}${ticks} ticks`)
  }

  // 3. Pitch & Scale
  const handleTranspose = (semis: number) => {
    const updated = applyTranspose(targetNotes, semis)
    const sign = semis > 0 ? `+${semis}` : `${semis}`
    replaceTargetNotes(updated, `Transposed ${sign} semitones`)
  }

  const handleModalTranspose = (degreeDelta: number) => {
    const updated = applyModalTranspose(
      targetNotes,
      degreeDelta,
      effectiveScale.root,
      effectiveScale.mode,
      effectiveScale.customIntervals
    )
    const sign = degreeDelta > 0 ? `+${degreeDelta}` : `${degreeDelta}`
    replaceTargetNotes(updated, `Modal transposed ${sign} scale degree(s)`)
  }

  const handleForceToScale = () => {
    const updated = applyForceToScale(
      targetNotes,
      effectiveScale.root,
      effectiveScale.mode,
      effectiveScale.customIntervals
    )
    replaceTargetNotes(updated, `Conformed to ${effectiveScale.mode}`)
  }

  const handleHarmonize = () => {
    const updated = applyHarmonize(
      targetNotes,
      harmonizeType,
      effectiveScale.root,
      effectiveScale.mode,
      effectiveScale.customIntervals
    )
    replaceTargetNotes(updated, `Harmonized: ${harmonizeType}`)
  }

  const handleChordInversion = (dir: 'up' | 'down') => {
    const updated = applyChordInversion(targetNotes, dir)
    replaceTargetNotes(updated, `Chord inversion ${dir}`)
  }

  // Multi-Note Glide Chain Handlers
  const handleApplyGlideChain = () => {
    if (targetNotes.length < 2) {
      showToast('Select at least 2 notes to create a glide chain!', 'info')
      return
    }
    const updated = applyGlideChain(targetNotes, {
      order: glideOrder,
      curve: glideCurve,
      customEquation: glideCustomEquation,
      durationMode: glideDurationMode,
      extendLegato: glideExtendLegato,
      loopLastNote: glideLoopChain,
    })
    replaceTargetNotes(updated, `Glide chain applied across ${targetNotes.length} notes!`)
  }

  const handleClearGlides = () => {
    if (targetNotes.length === 0) return
    const updated = clearNoteGlides(targetNotes)
    replaceTargetNotes(updated, `Cleared glides from ${targetNotes.length} notes`)
  }

  // 4. Dynamics & Velocity
  const handleVelocityRamp = () => {
    const updated = applyVelocityRamp(targetNotes, {
      startVelocity: rampStartVel,
      endVelocity: rampEndVel,
      curve: rampCurve,
    })
    replaceTargetNotes(updated, `Ramped velocity: ${rampStartVel} → ${rampEndVel}`)
  }

  const handleVelocityCompress = () => {
    const updated = applyVelocityCompress(targetNotes, compTarget, compRatio)
    replaceTargetNotes(updated, `Dynamics compressed (Target: ${compTarget})`)
  }

  const handleVelocityNormalize = () => {
    const updated = applyVelocityNormalize(targetNotes, 127)
    replaceTargetNotes(updated, 'Velocity normalized to 127')
  }

  const handleFixedVelocity = (vel: number) => {
    const updated = applyFixedVelocity(targetNotes, vel)
    replaceTargetNotes(updated, `Set velocity to ${vel}`)
  }

  // 5. Humanize & Transformations
  const handleHumanize = () => {
    const updated = applyHumanize(targetNotes, {
      timingJitterTicks: humTiming,
      velocityJitterPercent: humVel,
      durationJitterPercent: humDur,
      pitchJitterSemis: humPitch,
      scaleLock: effectiveScale,
    })
    replaceTargetNotes(updated, 'Humanized timing & velocity (Alt+R)')
  }

  const handleFlipHorizontal = () => {
    const updated = applyFlipHorizontal(targetNotes)
    replaceTargetNotes(updated, 'Flipped horizontally (Time reversed, Alt+Y)')
  }

  const handleFlipVertical = () => {
    const updated = applyFlipVertical(targetNotes, effectiveScale)
    replaceTargetNotes(updated, 'Flipped vertically (Inverted pitch)')
  }

  const handleTimeStretch = (factor: number) => {
    const updated = applyTimeStretch(targetNotes, factor)
    const label = factor === 0.5 ? 'Double Time (2x)' : factor === 2 ? 'Half Time (0.5x)' : `${factor}x`
    replaceTargetNotes(updated, `Time stretched: ${label}`)
  }

  // 6. Selection & Clean
  const handleSelectOddEven = (parity: 'odd' | 'even') => {
    const ids = filterOddEvenNotes(targetNotes, parity)
    setSelectedNoteIds(ids)
    showToast(`Selected ${ids.length} ${parity} notes`, 'info')
  }

  const handleExtractVoice = (voice: 'top' | 'bottom') => {
    const ids = filterVoiceNotes(targetNotes, voice)
    setSelectedNoteIds(ids)
    showToast(`Selected ${ids.length} ${voice === 'top' ? 'top-line melody' : 'bassline'} notes`, 'info')
  }

  const handlePurgeShort = () => {
    const updated = applyPurgeShortNotes(targetNotes, 12)
    const purgedCount = targetNotes.length - updated.length
    replaceTargetNotes(updated, `Purged ${purgedCount} micro-notes (<12t)`)
  }

  const handleSelectAll = () => {
    if (!activeTrack) return
    const trackNoteIds = notes.filter(n => n.trackId === activeTrack.id).map(n => n.id)
    setSelectedNoteIds(trackNoteIds)
    showToast(`Selected all ${trackNoteIds.length} notes on active track`, 'info')
  }

  const handleInvertSelection = () => {
    if (!activeTrack) return
    const trackNotes = notes.filter(n => n.trackId === activeTrack.id)
    const invertedIds = trackNotes.filter(n => !selectedNoteIds.includes(n.id)).map(n => n.id)
    setSelectedNoteIds(invertedIds)
    showToast(`Inverted selection (${invertedIds.length} notes)`, 'info')
  }

  const handleDeselect = () => {
    setSelectedNoteIds([])
    showToast('Cleared note selection', 'info')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* 1. Header: Undo / Redo + Scope Badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
          <button
            onClick={undo}
            title="Undo (Ctrl+Z)"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '5px 8px',
              borderRadius: '5px',
              background: 'rgba(77,171,247,0.12)',
              border: '1px solid rgba(77,171,247,0.25)',
              color: '#4dabf7',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <IconUndo size={12} /> Undo
          </button>
          <button
            onClick={redo}
            title="Redo (Ctrl+Y)"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '5px 8px',
              borderRadius: '5px',
              background: 'rgba(0,230,255,0.12)',
              border: '1px solid rgba(0,230,255,0.25)',
              color: '#00e6ff',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <IconRedo size={12} /> Redo
          </button>
        </div>

        {/* Scope Selector Badge */}
        <div
          onClick={() => {
            const nextMode = scopeMode === 'auto' ? 'selected' : scopeMode === 'selected' ? 'track' : 'auto'
            setScopeMode(nextMode)
          }}
          title="Click to cycle target scope: Auto → Selected → Track"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 8px',
            borderRadius: '12px',
            background: targetNotes.length > 0 ? 'rgba(105,219,124,0.12)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${targetNotes.length > 0 ? 'rgba(105,219,124,0.3)' : 'rgba(255,255,255,0.1)'}`,
            color: targetNotes.length > 0 ? '#69db7c' : '#777',
            fontSize: '10px',
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: targetNotes.length > 0 ? '#69db7c' : '#777' }} />
          <span>{targetLabel}</span>
        </div>
      </div>

      {/* 2. Category Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: isDrum ? 'repeat(5, 1fr)' : 'repeat(6, 1fr)', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '6px' }}>
        {[
          { id: 'quick', label: 'Quick', icon: <IconZap size={11} />, color: '#4dabf7' },
          { id: 'chopArp', label: isDrum ? 'Rolls' : 'Chop', icon: <IconScissors size={11} />, color: '#ffcc00' },
          ...(isDrum ? [] : [{ id: 'pitch', label: 'Pitch', icon: <IconMusic size={11} />, color: '#da77f2' }]),
          { id: 'velocity', label: 'Dyn', icon: <IconSliders size={11} />, color: '#ff3366' },
          { id: 'humanize', label: 'Human', icon: <IconShuffle size={11} />, color: '#69db7c' },
          { id: 'select', label: 'Select', icon: <IconTarget size={11} />, color: '#00e6ff' },
        ].map(tab => {
          const effectiveTab = (isDrum && activeTab === 'pitch') ? 'quick' : activeTab
          const isActive = effectiveTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                padding: '5px 2px',
                borderRadius: '4px',
                border: 'none',
                background: isActive ? `${tab.color}22` : 'transparent',
                color: isActive ? tab.color : '#888',
                cursor: 'pointer',
                fontSize: '9px',
                fontWeight: 800,
                transition: 'all 0.15s',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* 3. TAB CONTENT */}

      {/* TAB: QUICK ARTICULATIONS */}
      {activeTab === 'quick' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <button
              onClick={handleQuickLegato}
              title="Extend notes to the start of the next note (Ctrl+L)"
              style={actionBtnStyle('#4dabf7')}
            >
              Legato (Ctrl+L)
            </button>
            <button
              onClick={handleQuickGlue}
              title="Join notes on same pitch (Ctrl+G)"
              style={actionBtnStyle('#00e6ff')}
            >
              Join (Ctrl+G)
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <button
              onClick={handleQuickStrum}
              title="Stagger chord notes like a guitar strum (Alt+S)"
              style={actionBtnStyle('#ff9900')}
            >
              Strum (Alt+S)
            </button>
            <button
              onClick={handleQuickFlam}
              title="Add quick grace notes before each note"
              style={actionBtnStyle('#da77f2')}
            >
              Flam Grace
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <button
              onClick={handleQuickDice}
              title="Slice all notes across current grid intervals"
              style={actionBtnStyle('#ffcc00')}
            >
              Dice @ Grid
            </button>
            <button
              onClick={handleQuickRemoveOverlaps}
              title="Shorten notes to prevent overlapping collisions on same pitch"
              style={actionBtnStyle('#ff6b6b')}
            >
              Fix Overlaps
            </button>
          </div>

          {/* Micro-Nudge Toolbar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 600 }}>MICRO-NUDGE (TICKS)</span>
              <span style={{ fontSize: '9px', color: '#666' }}>Sub-grid pocketing</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
              <button onClick={() => handleMicroNudge(-6)} title="Nudge backward 6 ticks (1/128)" style={actionBtnStyle('#4dabf7')}>
                ◄ -6t
              </button>
              <button onClick={() => handleMicroNudge(-1)} title="Nudge backward 1 tick" style={actionBtnStyle('#4dabf7')}>
                ◄ -1t
              </button>
              <button onClick={() => handleMicroNudge(1)} title="Nudge forward 1 tick" style={actionBtnStyle('#4dabf7')}>
                +1t ►
              </button>
              <button onClick={() => handleMicroNudge(6)} title="Nudge forward 6 ticks (1/128)" style={actionBtnStyle('#4dabf7')}>
                +6t ►
              </button>
            </div>
          </div>

          {/* Strum Genre Presets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', background: 'rgba(255,153,0,0.05)', borderRadius: '6px', border: '1px solid rgba(255,153,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: '#ff9900', fontWeight: 700 }}>STRUM GENRE MACROS</span>
              <span style={{ fontSize: '9px', color: '#888' }}>1-Click Vibe</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              <button
                onClick={() => {
                  setStrumTime(24)
                  setStrumDirection('down')
                  setStrumTension(0.35)
                  setStrumVelRamp(20)
                  const updated = applyStrum(targetNotes, { strumTime: 24, direction: 'down', tension: 0.35, velocityRamp: 20 })
                  replaceTargetNotes(updated, 'Flamenco Rake applied')
                }}
                title="Downstroke strum with positive tension rake and accent ramp"
                style={{ ...actionBtnStyle('#ff9900'), fontSize: '10px', padding: '4px 2px' }}
              >
                Flamenco
              </button>
              <button
                onClick={() => {
                  setStrumTime(16)
                  setStrumDirection('up')
                  setStrumTension(-0.2)
                  setStrumVelRamp(-15)
                  const updated = applyStrum(targetNotes, { strumTime: 16, direction: 'up', tension: -0.2, velocityRamp: -15 })
                  replaceTargetNotes(updated, 'Neo-Soul Strum applied')
                }}
                title="Gentle upward rake with soft release"
                style={{ ...actionBtnStyle('#ff9900'), fontSize: '10px', padding: '4px 2px' }}
              >
                Neo-Soul
              </button>
              <button
                onClick={() => {
                  setStrumTime(10)
                  setStrumDirection('alternate')
                  setStrumTension(0)
                  setStrumVelRamp(0)
                  const updated = applyStrum(targetNotes, { strumTime: 10, direction: 'alternate', tension: 0, velocityRamp: 0 })
                  replaceTargetNotes(updated, 'Acoustic Chime applied')
                }}
                title="Tight alternating acoustic pick chime"
                style={{ ...actionBtnStyle('#ff9900'), fontSize: '10px', padding: '4px 2px' }}
              >
                Acoustic
              </button>
            </div>
          </div>

          {/* Strum & Legato Fine-Tuning Drawer */}
          <div style={drawerBoxStyle}>
            <div
              onClick={() => setOpenDrawer(openDrawer === 'strum' ? null : 'strum')}
              style={drawerHeaderStyle}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#ff9900' }}>
                <IconSliders size={12} /> Strummer & Articulation Config
              </span>
              <span>{openDrawer === 'strum' ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}</span>
            </div>

            {openDrawer === 'strum' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                <SliderRow
                  label="Strum Delay"
                  value={strumTime}
                  min={2}
                  max={48}
                  step={1}
                  suffix="t"
                  color="#ff9900"
                  onChange={setStrumTime}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', color: '#aaa' }}>Direction</span>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {(['up', 'down', 'alternate'] as const).map(dir => (
                      <button
                        key={dir}
                        onClick={() => setStrumDirection(dir)}
                        style={miniPillStyle(strumDirection === dir, '#ff9900')}
                      >
                        {dir.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <SliderRow
                  label="Tension (Curve)"
                  value={strumTension}
                  min={-1}
                  max={1}
                  step={0.05}
                  suffix=""
                  color="#ff9900"
                  onChange={setStrumTension}
                />
                <SliderRow
                  label="Vel Ramp"
                  value={strumVelRamp}
                  min={-40}
                  max={40}
                  step={1}
                  suffix=""
                  color="#ff9900"
                  onChange={setStrumVelRamp}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', color: '#aaa' }}>Align Chord Ends</span>
                  <input
                    type="checkbox"
                    checked={strumAlignEnds}
                    onChange={e => setStrumAlignEnds(e.target.checked)}
                    style={{ accentColor: '#ff9900' }}
                  />
                </div>
                <SliderRow
                  label="Legato Gap"
                  value={legatoGap}
                  min={-24}
                  max={24}
                  step={1}
                  suffix="t"
                  color="#4dabf7"
                  onChange={setLegatoGap}
                />
                <SliderRow
                  label="Flam Delay"
                  value={flamDelay}
                  min={4}
                  max={48}
                  step={1}
                  suffix="t"
                  color="#da77f2"
                  onChange={setFlamDelay}
                />
                <SliderRow
                  label="Flam Vel %"
                  value={Math.round(flamVelRatio * 100)}
                  min={20}
                  max={100}
                  step={1}
                  suffix="%"
                  color="#da77f2"
                  onChange={v => setFlamVelRatio(v / 100)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: CHOP & ARPEGGIATOR (SYNTH) or ROLLS & RATCHETS (DRUM) */}
      {activeTab === 'chopArp' && isDrum && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: '#ffcc00', fontWeight: 700 }}>DRUM RATCHETS & ROLLS</span>
            <span style={{ fontSize: '9px', color: '#888' }}>Trap Hats / Snare Fills</span>
          </div>

          {/* Direct Ratchet Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '3px' }}>
            {[
              { label: '2x', slices: 2 },
              { label: '3x', slices: 3 },
              { label: '4x', slices: 4 },
              { label: '6x', slices: 6 },
              { label: '8x', slices: 8 },
              { label: '12x', slices: 12 },
            ].map(r => (
              <button
                key={r.label}
                onClick={() => handleApplyRatchet(r.slices)}
                title={`Subdivide into ${r.slices} slices`}
                style={{ ...actionBtnStyle('#ffcc00'), padding: '6px 2px', fontSize: '10px', fontWeight: 800 }}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Velocity Profile for Rolls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
            <span style={{ fontSize: '10px', color: '#aaa' }}>Velocity Profile</span>
            <div style={{ display: 'flex', gap: '3px' }}>
              {(['flat', 'crescendo', 'decrescendo'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setRatchetCurve(c)}
                  style={miniPillStyle(ratchetCurve === c, '#ffcc00')}
                >
                  {c === 'flat' ? 'Flat' : c === 'crescendo' ? 'Cresc ▲' : 'Decresc ▼'}
                </button>
              ))}
            </div>
          </div>

          <SliderRow
            label="Roll Slices"
            value={ratchetSlices}
            min={2}
            max={16}
            step={1}
            suffix="x"
            color="#ffcc00"
            onChange={setRatchetSlices}
          />

          <button
            onClick={() => handleApplyRatchet(ratchetSlices, ratchetCurve)}
            style={{ ...actionBtnStyle('#ffcc00'), padding: '6px' }}
          >
            Execute {ratchetSlices}x Roll ({ratchetCurve})
          </button>

          {/* Quick Rhythmic Chopper */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
            <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700, display: 'block', marginBottom: '4px' }}>TRAP BURSTS & RHYTHMIC CHOP</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
              {(['1/8', '1/16', '1/32', '1/16t'] as ChopPattern[]).map(p => (
                <button key={p} onClick={() => handleChop(p)} style={actionBtnStyle('#ff9900')}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'chopArp' && !isDrum && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Quick Genre Roll Macros */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', background: 'rgba(255,204,0,0.05)', borderRadius: '6px', border: '1px solid rgba(255,204,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: '#ffcc00', fontWeight: 700 }}>ROLL & CHOP MACROS</span>
              <span style={{ fontSize: '9px', color: '#888' }}>Instant Slicing</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              <button
                onClick={() => {
                  const updated = applyChop(targetNotes, { pattern: '1/32', gateRatio: 0.9 })
                  replaceTargetNotes(updated, 'Trap 32nd Roll applied')
                }}
                title="Rapid 1/32nd slices for trap rolls"
                style={{ ...actionBtnStyle('#ffcc00'), fontSize: '10px', padding: '4px 2px' }}
              >
                Trap 32nd
              </button>
              <button
                onClick={() => {
                  const updated = applyChop(targetNotes, { pattern: '1/16', gateRatio: 0.7 })
                  replaceTargetNotes(updated, '16th Stutter applied')
                }}
                title="1/16th gated stutter slices"
                style={{ ...actionBtnStyle('#ffcc00'), fontSize: '10px', padding: '4px 2px' }}
              >
                16th Stutter
              </button>
              <button
                onClick={() => {
                  const updated = applyChop(targetNotes, { pattern: '1/16t', gateRatio: 0.85 })
                  replaceTargetNotes(updated, 'Drill Triplet Burst applied')
                }}
                title="Triplet burst standard in drill/grime"
                style={{ ...actionBtnStyle('#ffcc00'), fontSize: '10px', padding: '4px 2px' }}
              >
                Drill 3-let
              </button>
            </div>
          </div>

          <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700 }}>RHYTHMIC CHOPPER (FL ALT+U)</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            {(['1/4', '1/8', '1/16', '1/32'] as ChopPattern[]).map(p => (
              <button key={p} onClick={() => handleChop(p)} style={actionBtnStyle('#ffcc00')}>
                {p}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
            {(['1/8t', '1/16t', '1/32t'] as ChopPattern[]).map(p => (
              <button key={p} onClick={() => handleChop(p)} style={actionBtnStyle('#ffcc00')}>
                {p} (Trip)
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            <button onClick={() => handleChop('trapAccelerando')} style={actionBtnStyle('#ff9900')}>
              Trap Roll (Acc.)
            </button>
            <button onClick={() => handleChop('trapDecelerando')} style={actionBtnStyle('#ff9900')}>
              Trap Roll (Dec.)
            </button>
          </div>
          <SliderRow
            label="Slice Gate"
            value={Math.round(chopGate * 100)}
            min={10}
            max={100}
            step={1}
            suffix="%"
            color="#ffcc00"
            onChange={v => setChopGate(v / 100)}
          />

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px', marginTop: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700 }}>ARPEGGIATOR (FL ALT+A)</span>
              <button onClick={handleArp} style={{ ...actionBtnStyle('#69db7c'), padding: '4px 10px' }}>
                Run Arp
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', color: '#aaa' }}>Pattern</span>
                <select
                  value={arpPattern}
                  onChange={e => setArpPattern(e.target.value as ArpPattern)}
                  style={selectStyle('#69db7c')}
                >
                  <option value="up">Up (Ascending)</option>
                  <option value="down">Down (Descending)</option>
                  <option value="upDown">Up & Down</option>
                  <option value="downUp">Down & Up</option>
                  <option value="converge">Converge (Inward)</option>
                  <option value="diverge">Diverge (Outward)</option>
                  <option value="random">Random Walk</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', color: '#aaa' }}>Rate</span>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {[
                    { label: '1/8', ticks: 96 },
                    { label: '1/16', ticks: 48 },
                    { label: '1/32', ticks: 24 },
                    { label: '1/16t', ticks: 32 },
                  ].map(r => (
                    <button
                      key={r.label}
                      onClick={() => setArpRate(r.ticks)}
                      style={miniPillStyle(arpRate === r.ticks, '#69db7c')}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <SliderRow
                label="Octave Range"
                value={arpOctaves}
                min={1}
                max={3}
                step={1}
                suffix=" oct"
                color="#69db7c"
                onChange={setArpOctaves}
              />
              <SliderRow
                label="Arp Gate"
                value={Math.round(arpGate * 100)}
                min={20}
                max={100}
                step={1}
                suffix="%"
                color="#69db7c"
                onChange={v => setArpGate(v / 100)}
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB: PITCH, SCALE & HARMONY (SYNTH ONLY) */}
      {activeTab === 'pitch' && !isDrum && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Octave & Semitone Transpose */}
          <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700 }}>TRANSPOSE SUITE (OCTAVES & SEMITONES)</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            <button onClick={() => handleTranspose(24)} title="Two Octaves Up (+24 semitones)" style={actionBtnStyle('#cc5de8')}>
              +2 Oct
            </button>
            <button onClick={() => handleTranspose(-24)} title="Two Octaves Down (-24 semitones)" style={actionBtnStyle('#cc5de8')}>
              -2 Oct
            </button>
            <button onClick={() => handleTranspose(36)} title="Three Octaves Up (+36 semitones)" style={actionBtnStyle('#9c36b5')}>
              +3 Oct
            </button>
            <button onClick={() => handleTranspose(-36)} title="Three Octaves Down (-36 semitones)" style={actionBtnStyle('#9c36b5')}>
              -3 Oct
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            <button onClick={() => handleTranspose(12)} title="Octave Up (Shift+Up)" style={actionBtnStyle('#da77f2')}>
              +1 Oct
            </button>
            <button onClick={() => handleTranspose(-12)} title="Octave Down (Shift+Down)" style={actionBtnStyle('#da77f2')}>
              -1 Oct
            </button>
            <button onClick={() => handleTranspose(1)} title="Semitone Up (Ctrl+Up / Up)" style={actionBtnStyle('#4dabf7')}>
              +1 Semi
            </button>
            <button onClick={() => handleTranspose(-1)} title="Semitone Down (Ctrl+Down / Down)" style={actionBtnStyle('#4dabf7')}>
              -1 Semi
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            <button
              onClick={() => handleModalTranspose(1)}
              title="Shift up 1 scale degree in current key"
              style={actionBtnStyle('#69db7c')}
            >
              +1 Scale Deg
            </button>
            <button
              onClick={() => handleModalTranspose(-1)}
              title="Shift down 1 scale degree in current key"
              style={actionBtnStyle('#69db7c')}
            >
              -1 Scale Deg
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ flex: 1 }}>
              <SliderRow
                label="Custom Semi"
                value={transposeSliderVal}
                min={-48}
                max={48}
                step={1}
                suffix=" st"
                color="#da77f2"
                onChange={setTransposeSliderVal}
              />
            </div>
            <button
              onClick={() => handleTranspose(transposeSliderVal)}
              style={{ ...actionBtnStyle('#da77f2'), padding: '4px 8px', height: '24px' }}
            >
              Apply
            </button>
          </div>

          {/* Scale Conforming */}
          <button
            onClick={handleForceToScale}
            title={`Force all notes to snap strictly to ${effectiveScale.mode}`}
            style={{ ...actionBtnStyle('#ff9900'), width: '100%', padding: '7px' }}
          >
            Force to Scale ({effectiveScale.mode})
          </button>

          {/* Harmonizer & Chords */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
            <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
              HARMONIZER & CHORD VOICINGS
            </span>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <select
                value={harmonizeType}
                onChange={e => setHarmonizeType(e.target.value as HarmonizeType)}
                style={{ ...selectStyle('#da77f2'), flex: 1 }}
              >
                <option value="triad">Diatonic Triad (1-3-5)</option>
                <option value="seventh">Diatonic 7th (1-3-5-7)</option>
                <option value="third">Diatonic Third (+3rd)</option>
                <option value="fifth">Diatonic Fifth (+5th)</option>
                <option value="powerChord">Power Chord (Root+5th)</option>
                <option value="octaveUp">Octave Double (+12)</option>
                <option value="octaveDown">Sub-Octave (-12)</option>
              </select>
              <button onClick={handleHarmonize} style={{ ...actionBtnStyle('#da77f2'), padding: '4px 12px' }}>
                Add
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button
                onClick={() => handleChordInversion('up')}
                title="Invert Up: Lowest chord note +12"
                style={actionBtnStyle('#b197fc')}
              >
                Invert Up ↑
              </button>
              <button
                onClick={() => handleChordInversion('down')}
                title="Invert Down: Highest chord note -12"
                style={actionBtnStyle('#b197fc')}
              >
                Invert Down ↓
              </button>
            </div>
          </div>

          {/* MULTI-NOTE GLIDE & MATHEMATICAL GLISSANDO CHAIN */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px', marginTop: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: '#00e6ff', fontWeight: 800, letterSpacing: '0.4px' }}>
                MULTI-NOTE GLIDE CHAIN
              </span>
              <span style={{ fontSize: '9px', color: targetNotes.length >= 2 ? '#00e6ff' : '#666', background: 'rgba(0,230,255,0.08)', padding: '1px 6px', borderRadius: '10px', border: '1px solid rgba(0,230,255,0.2)' }}>
                {targetNotes.length} notes
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(0,230,255,0.03)', padding: '8px', borderRadius: '6px', border: '1px solid rgba(0,230,255,0.1)' }}>
              {/* Curve Selection */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 600 }}>Curve Shape</span>
                <select
                  value={glideCurve}
                  onChange={e => setGlideCurve(e.target.value as GlideCurveType)}
                  style={{ ...selectStyle('#00e6ff'), fontSize: '10.5px' }}
                >
                  <option value="cubicInOut">Cubic In-Out (Smooth)</option>
                  <option value="cubicIn">Cubic Ease-In (Flick)</option>
                  <option value="cubicOut">Cubic Ease-Out (Float)</option>
                  <option value="sigmoid">Sigmoid (S-Curve)</option>
                  <option value="exponential">Exponential (Rave)</option>
                  <option value="logarithmic">Logarithmic (Quick Dive)</option>
                  <option value="linear">Linear (Classic Gliss)</option>
                  <option value="custom">Custom Equation (f(t))</option>
                </select>
              </div>

              {/* Custom Equation Input if custom curve */}
              {glideCurve === 'custom' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(0,0,0,0.3)', padding: '6px', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '9px', color: '#888' }}>Equation (var: t, 0 to 1)</span>
                  </div>
                  <input
                    type="text"
                    value={glideCustomEquation}
                    onChange={e => setGlideCustomEquation(e.target.value)}
                    placeholder="e.g. t * t * t"
                    style={{
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid rgba(0,230,255,0.3)',
                      color: '#00e6ff',
                      borderRadius: '4px',
                      padding: '4px 6px',
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      outline: 'none'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginTop: '2px' }}>
                    {[
                      { label: 't³', eq: 't * t * t' },
                      { label: 't²', eq: 't * t' },
                      { label: 'sin', eq: 'Math.sin(t * Math.PI / 2)' },
                      { label: 'sqrt', eq: 'Math.sqrt(t)' },
                    ].map(p => (
                      <button
                        key={p.label}
                        onClick={() => setGlideCustomEquation(p.eq)}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#aaa',
                          fontSize: '8.5px',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Order Selection */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 600 }}>Note Order</span>
                <select
                  value={glideOrder}
                  onChange={e => setGlideOrder(e.target.value as GlideOrderType)}
                  style={{ ...selectStyle('#00e6ff'), fontSize: '10.5px' }}
                >
                  <option value="time">Time (Chronological)</option>
                  <option value="reverseTime">Reverse Time</option>
                  <option value="pitchAscending">Pitch Ascending (Low → High)</option>
                  <option value="pitchDescending">Pitch Descending (High → Low)</option>
                </select>
              </div>

              {/* Duration Mode */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 600 }}>Glide Span</span>
                <div style={{ display: 'flex', gap: '2px' }}>
                  {[
                    { label: '100%', val: 'full' as GlideDurationMode },
                    { label: '75%', val: 'threeQuarters' as GlideDurationMode },
                    { label: '50%', val: 'half' as GlideDurationMode },
                    { label: '1/16', val: 'fixed' as GlideDurationMode },
                  ].map(m => (
                    <button
                      key={m.label}
                      onClick={() => setGlideDurationMode(m.val)}
                      style={miniPillStyle(glideDurationMode === m.val, '#00e6ff')}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Options: Extend Legato & Loop Chain */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '2px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9.5px', color: '#ccc', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={glideExtendLegato}
                    onChange={e => setGlideExtendLegato(e.target.checked)}
                    style={{ accentColor: '#00e6ff', cursor: 'pointer' }}
                  />
                  Gapless Legato
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9.5px', color: '#ccc', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={glideLoopChain}
                    onChange={e => setGlideLoopChain(e.target.checked)}
                    style={{ accentColor: '#00e6ff', cursor: 'pointer' }}
                  />
                  Loop Chain
                </label>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                <button
                  onClick={handleApplyGlideChain}
                  style={{
                    ...actionBtnStyle('#00e6ff'),
                    flex: 1.5,
                    padding: '6px 8px',
                    fontWeight: 700,
                    background: 'rgba(0,230,255,0.18)',
                    color: '#00e6ff',
                    border: '1px solid rgba(0,230,255,0.5)'
                  }}
                  title="Chain selected notes into a continuous mathematical pitch glide"
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <IconZap size={11} color="#00e6ff" /> Chain Glides
                  </span>
                </button>
                <button
                  onClick={handleClearGlides}
                  style={{
                    ...actionBtnStyle('#ff4d6d'),
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: '10px'
                  }}
                  title="Remove all pitch glide slides from selected notes"
                >
                  Clear Glides
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: VELOCITY & DYNAMICS */}
      {activeTab === 'velocity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700 }}>VELOCITY PRESETS</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '3px' }}>
            {[
              { label: 'pp 30', vel: 30 },
              { label: 'p 60', vel: 60 },
              { label: 'mf 85', vel: 85 },
              { label: 'f 105', vel: 105 },
              { label: 'ff 127', vel: 127 },
            ].map(p => (
              <button key={p.label} onClick={() => handleFixedVelocity(p.vel)} style={actionBtnStyle('#ff3366')}>
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleVelocityNormalize}
            title="Scale highest note to 127 while preserving relative dynamic balance"
            style={{ ...actionBtnStyle('#00e6ff'), width: '100%', padding: '6px' }}
          >
            Normalize Peak to 127
          </button>

          {/* Velocity Ramp */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700 }}>VELOCITY RAMP (CRESCENDO)</span>
              <button onClick={handleVelocityRamp} style={{ ...actionBtnStyle('#ff3366'), padding: '3px 8px' }}>
                Apply Ramp
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <SliderRow label="Start Vel" value={rampStartVel} min={1} max={127} step={1} color="#ff3366" onChange={setRampStartVel} />
              <SliderRow label="End Vel" value={rampEndVel} min={1} max={127} step={1} color="#ff3366" onChange={setRampEndVel} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
              <span style={{ fontSize: '10px', color: '#aaa' }}>Ramp Curve</span>
              <div style={{ display: 'flex', gap: '3px' }}>
                {(['linear', 'exponential', 'logarithmic', 'sCurve'] as VelocityCurve[]).map(c => (
                  <button
                    key={c}
                    onClick={() => setRampCurve(c)}
                    style={miniPillStyle(rampCurve === c, '#ff3366')}
                  >
                    {c === 'sCurve' ? 'S-Curve' : c.slice(0, 4).toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Dynamics Compressor */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700 }}>DYNAMICS COMPRESSOR</span>
              <button onClick={handleVelocityCompress} style={{ ...actionBtnStyle('#da77f2'), padding: '3px 8px' }}>
                Compress
              </button>
            </div>
            <SliderRow label="Target" value={compTarget} min={20} max={120} step={1} color="#da77f2" onChange={setCompTarget} />
            <SliderRow label="Strength" value={Math.round(compRatio * 100)} min={10} max={100} step={1} suffix="%" color="#da77f2" onChange={v => setCompRatio(v / 100)} />
          </div>
        </div>
      )}

      {/* TAB: HUMANIZE & GEOMETRY */}
      {activeTab === 'humanize' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Alt+R Humanizer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700 }}>HUMANIZER / RANDOMIZE (ALT+R)</span>
            <button onClick={handleHumanize} style={{ ...actionBtnStyle('#69db7c'), padding: '4px 10px' }}>
              Humanize Now
            </button>
          </div>

          {/* Quick Humanize Genre Macros */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', background: 'rgba(105,219,124,0.05)', borderRadius: '6px', border: '1px solid rgba(105,219,124,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: '#69db7c', fontWeight: 700 }}>HUMANIZE GENRE MACROS</span>
              <span style={{ fontSize: '9px', color: '#888' }}>1-Click Vibe</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              <button
                onClick={() => {
                  setHumTiming(14)
                  setHumVel(22)
                  setHumDur(15)
                  setHumPitch(0)
                  const updated = applyHumanize(targetNotes, { timingJitterTicks: 14, velocityJitterPercent: 22, durationJitterPercent: 15, pitchJitterSemis: 0, scaleLock: effectiveScale })
                  replaceTargetNotes(updated, 'Lofi Swing humanize applied')
                }}
                title="Heavy drunken swing and expressive velocity variation"
                style={{ ...actionBtnStyle('#69db7c'), fontSize: '10px', padding: '4px 2px' }}
              >
                Lofi Swing
              </button>
              <button
                onClick={() => {
                  setHumTiming(6)
                  setHumVel(14)
                  setHumDur(8)
                  setHumPitch(0)
                  const updated = applyHumanize(targetNotes, { timingJitterTicks: 6, velocityJitterPercent: 14, durationJitterPercent: 8, pitchJitterSemis: 0, scaleLock: effectiveScale })
                  replaceTargetNotes(updated, 'Pianist Touch humanize applied')
                }}
                title="Nuanced, authentic classical/jazz acoustic touch"
                style={{ ...actionBtnStyle('#69db7c'), fontSize: '10px', padding: '4px 2px' }}
              >
                Pianist Touch
              </button>
              <button
                onClick={() => {
                  setHumTiming(3)
                  setHumVel(8)
                  setHumDur(4)
                  setHumPitch(0)
                  const updated = applyHumanize(targetNotes, { timingJitterTicks: 3, velocityJitterPercent: 8, durationJitterPercent: 4, pitchJitterSemis: 0, scaleLock: effectiveScale })
                  replaceTargetNotes(updated, 'Subtle Pocket humanize applied')
                }}
                title="Tight sub-grid pocketing to remove robotic stiffness"
                style={{ ...actionBtnStyle('#69db7c'), fontSize: '10px', padding: '4px 2px' }}
              >
                Subtle Pocket
              </button>
            </div>
          </div>

          <SliderRow label="Timing Jitter" value={humTiming} min={0} max={24} step={1} suffix="t" color="#69db7c" onChange={setHumTiming} />
          <SliderRow label="Vel Jitter" value={humVel} min={0} max={40} step={1} suffix="%" color="#69db7c" onChange={setHumVel} />
          <SliderRow label="Length Jitter" value={humDur} min={0} max={30} step={1} suffix="%" color="#69db7c" onChange={setHumDur} />
          <SliderRow label="Pitch Jitter" value={humPitch} min={0} max={2} step={1} suffix=" st" color="#69db7c" onChange={setHumPitch} />

          {/* Alt+Y Flip */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
            <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
              GEOMETRY & TIME (ALT+Y)
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button
                onClick={handleFlipHorizontal}
                title="Reverse notes chronologically in time (Alt+Y)"
                style={actionBtnStyle('#00e6ff')}
              >
                Flip Time (Reverse)
              </button>
              <button
                onClick={handleFlipVertical}
                title="Invert notes across pitch axis"
                style={actionBtnStyle('#4dabf7')}
              >
                Flip Pitch (Invert)
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginTop: '6px' }}>
              <button onClick={() => handleTimeStretch(0.5)} title="Double speed (2x)" style={actionBtnStyle('#ff9900')}>
                Double-Time (2x)
              </button>
              <button onClick={() => handleTimeStretch(2.0)} title="Half speed (0.5x)" style={actionBtnStyle('#ff9900')}>
                Half-Time (0.5x)
              </button>
              <button onClick={() => handleTimeStretch(0.75)} title="75% length" style={actionBtnStyle('#ffcc00')}>
                Stretch 75%
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
              <div style={{ flex: 1 }}>
                <SliderRow
                  label="Custom %"
                  value={Math.round(stretchRatio * 100)}
                  min={25}
                  max={300}
                  step={5}
                  suffix="%"
                  color="#ff9900"
                  onChange={v => setStretchRatio(v / 100)}
                />
              </div>
              <button
                onClick={() => handleTimeStretch(stretchRatio)}
                style={{ ...actionBtnStyle('#ff9900'), padding: '4px 8px', height: '24px' }}
              >
                Stretch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB: SELECTION & CLEAN */}
      {activeTab === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700 }}>SELECTION FILTERS</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
            <button onClick={handleSelectAll} style={actionBtnStyle('#00e6ff')}>
              Select All
            </button>
            <button onClick={handleInvertSelection} style={actionBtnStyle('#4dabf7')}>
              Invert Sel
            </button>
            <button onClick={handleDeselect} style={actionBtnStyle('#aaa')}>
              Deselect
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            <button
              onClick={() => handleSelectOddEven('odd')}
              title="Select 1st, 3rd, 5th notes (perfect for 16th hi-hat grooves)"
              style={actionBtnStyle('#ffcc00')}
            >
              Select Odd Notes
            </button>
            <button
              onClick={() => handleSelectOddEven('even')}
              title="Select 2nd, 4th, 6th notes"
              style={actionBtnStyle('#ffcc00')}
            >
              Select Even Notes
            </button>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
            <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
              VOICE EXTRACTION
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button
                onClick={() => handleExtractVoice('top')}
                title="Extract lead melody line (highest notes)"
                style={actionBtnStyle('#69db7c')}
              >
                Top-Line Melody
              </button>
              <button
                onClick={() => handleExtractVoice('bottom')}
                title="Extract bassline (lowest notes)"
                style={actionBtnStyle('#da77f2')}
              >
                Bassline Voice
              </button>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
            <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
              CLEAN UP
            </span>
            <button
              onClick={handlePurgeShort}
              title="Delete accidental micro-notes under 12 ticks"
              style={{ ...actionBtnStyle('#ff6b6b'), width: '100%', padding: '6px' }}
            >
              Purge Micro-Notes (&lt;12t)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// STYLES & SUBCOMPONENTS
// ---------------------------------------------------------------------------

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '6px 6px',
    borderRadius: '5px',
    border: `1px solid ${color}33`,
    background: `${color}12`,
    color: color,
    fontSize: '10px',
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s ease',
  }
}

function miniPillStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '3px 6px',
    borderRadius: '4px',
    border: `1px solid ${active ? `${color}66` : 'rgba(255,255,255,0.06)'}`,
    background: active ? `${color}28` : 'rgba(255,255,255,0.03)',
    color: active ? color : 'var(--text-muted, #8b92a5)',
    fontSize: '9px',
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'all 0.12s ease',
  }
}

function selectStyle(color: string): React.CSSProperties {
  return {
    background: 'var(--bg-panel-solid, #191b21)',
    border: `1px solid ${color}44`,
    borderRadius: '4px',
    color: color,
    fontSize: '10px',
    fontWeight: 700,
    padding: '4px 6px',
    outline: 'none',
    cursor: 'pointer',
  }
}

const drawerBoxStyle: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.25)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: '6px',
  padding: '8px 10px',
}

const drawerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer',
  fontSize: '10px',
  fontWeight: 800,
  userSelect: 'none',
}

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  color?: string
  onChange: (v: number) => void
}

const SliderRow: React.FC<SliderRowProps> = ({
  label, value, min, max, step = 1, suffix = '', color = '#4dabf7', onChange
}) => {
  const progress = sliderProgress(value, min, max)

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <span style={{ fontSize: '10px', color: 'var(--text-muted, #8b92a5)', minWidth: '70px', fontWeight: 600 }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="modern-slider compact-slider"
        style={{
          flex: 1,
          '--slider-color': color,
          '--slider-progress': progress,
        } as React.CSSProperties & Record<string, string | number>}
      />
      <span style={{ fontSize: '10px', color: color, fontWeight: 800, minWidth: '36px', textAlign: 'right', fontFamily: 'monospace' }}>
        {value}{suffix}
      </span>
    </div>
  )
}

export default MidiEditSection
