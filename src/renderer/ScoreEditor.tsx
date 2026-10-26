import React, { useState, useMemo, useRef } from 'react'
import { useStore } from '../engine/store'
import { snapToScale } from '../utils/musicTheory'
import { audioEngine } from '../engine/AudioEngine'
import { IconSkipBack, IconSliders, IconTrash } from '../ui/Icons'
import { useContextMenuDismissal } from '../ui/useContextMenuDismissal'
import * as Tone from 'tone'

import { getEdoStepInfo } from '../utils/edoNomenclature'

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

const NOTE_DURATIONS = [
  { id: '1', label: '𝅝 Whole', ticks: 768 },
  { id: '2', label: '𝅗𝅥 Half', ticks: 384 },
  { id: '4', label: '𝅘𝅥 Quarter', ticks: 192 },
  { id: '8', label: '𝅘𝅥𝅮 Eighth', ticks: 96 },
  { id: '16', label: '𝅘𝅥𝅯 Sixteenth', ticks: 48 }
]

// Converts MIDI/EDO pitch to a diatonic step number (where C4/Middle C = 0) and accidental
function getPitchDiatonic(pitch: number, edo: number = 12, rootNote: number = 60, preset?: string) {
  const safePitch = isFinite(pitch) ? (Math.round(pitch * 100000) / 100000) : 60
  const nearestMidi = Math.round(safePitch)
  const noteInOctave = ((nearestMidi % 12) + 12) % 12
  const octave = Math.floor((safePitch + 0.001) / 12) - 1

  const octaveSteps: Record<number, { step: number; accidental?: string }> = {
    0: { step: 0 },
    1: { step: 0, accidental: '♯' },
    2: { step: 1 },
    3: { step: 1, accidental: '♯' },
    4: { step: 2 },
    5: { step: 3 },
    6: { step: 3, accidental: '♯' },
    7: { step: 4 },
    8: { step: 4, accidental: '♯' },
    9: { step: 5 },
    10: { step: 5, accidental: '♯' },
    11: { step: 6 },
  }

  const mapping = octaveSteps[noteInOctave] || { step: 0 }
  const octDiff = octave - 4
  const finalStep = mapping.step + octDiff * 7

  const centsDiff = Math.round((safePitch - nearestMidi) * 100)
  let microAccidental: string | undefined = mapping.accidental
  let microBadge: string | undefined = undefined

  // If track is in microtonal EDO or pitch has fractional microtonal offset
  if (edo !== 12 || Math.abs(centsDiff) > 1) {
    const edoInfo = getEdoStepInfo(safePitch, edo, rootNote, preset)
    if (Math.abs(centsDiff) >= 35 && Math.abs(centsDiff) <= 65) {
      // Quarter-tone symbols
      microAccidental = centsDiff > 0 ? (mapping.accidental ? '𝄱' : '𝄲') : '𝄳'
    } else if (centsDiff !== 0) {
      microBadge = centsDiff > 0 ? `+${centsDiff}¢` : `${centsDiff}¢`
    }
    return {
      step: finalStep,
      accidental: microAccidental,
      microBadge,
      name: edoInfo.label,
      octave,
      fullName: edoInfo.fullLabel
    }
  }

  return {
    step: finalStep,
    accidental: mapping.accidental,
    microBadge: undefined,
    name: NOTE_NAMES[noteInOctave],
    octave,
    fullName: NOTE_NAMES[noteInOctave] + octave
  }
}

// Converts a diatonic step back to the corresponding MIDI pitch in C major
const diatonicScaleSteps = [0, 2, 4, 5, 7, 9, 11]
function stepToPitch(step: number): number {
  const octaveShift = Math.floor(step / 7)
  const index = ((step % 7) + 7) % 7
  return 60 + octaveShift * 12 + diatonicScaleSteps[index]
}

export default function ScoreEditor() {
  const tracks = useStore(state => state.tracks)
  const notes = useStore(state => state.notes)
  const activeTrackId = useStore(state => state.activeTrackId)
  const readOnlyMode = useStore(state => state.readOnlyMode)
  const addNote = useStore(state => state.addNote)
  const removeNote = useStore(state => state.removeNote)
  const updateNote = useStore(state => state.updateNote)
  const scaleLock = useStore(state => state.scaleLock)
  const timeSignature = useStore(state => state.timeSignature)
  const setTimeSignature = useStore(state => state.setTimeSignature)

  const playheadPosition = useStore(state => state.playheadPosition)
  const setPlayheadPosition = useStore(state => state.setPlayheadPosition)
  const selectedNoteIds = useStore(state => state.selectedNoteIds)
  const setSelectedNoteIds = useStore(state => state.setSelectedNoteIds)
  const setIsRightPaneVisible = useStore(state => state.setIsRightPaneVisible)
  const setNoteInspectorEnabled = useStore(state => state.setNoteInspectorEnabled)

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tick: number; noteId?: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  useContextMenuDismissal(contextMenu !== null, setContextMenu, contextMenuRef)

  const [sigNum, sigDen] = useMemo(() => {
    const parts = timeSignature.split('/')
    return [parts[0] || '4', parts[1] || '4']
  }, [timeSignature])

  // Current active track
  const activeTrack = useMemo(() => tracks.find(t => t.id === activeTrackId), [tracks, activeTrackId])
  const trackColor = activeTrack?.color || '#4dabf7'

  // Editor configuration
  const [selectedDurationTicks, setSelectedDurationTicks] = useState<number>(192) // Default: Quarter note
  const [showNoteNames, setShowNoteNames] = useState<boolean>(true)

  // Filter notes belonging to all non-hidden synth tracks
  const trackNotes = useMemo(() => {
    const synthTrackIds = new Set(tracks.filter(t => t.instrument === 'synth' && !t.hidden).map(t => t.id))
    return notes.filter(n => synthTrackIds.has(n.trackId)).sort((a, b) => a.time - b.time)
  }, [notes, tracks])


  // Mouse hover tracking for previews
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number; time: number; pitch: number; step: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // Timing limits & pagination
  const beatsPerMeasure = parseInt(sigNum) || 4
  const beatType = parseInt(sigDen) || 4
  const ticksPerBeat = beatType === 8 ? 96 : (beatType === 2 ? 384 : 192)
  const ticksPerMeasure = beatsPerMeasure * ticksPerBeat
  const measuresPerSystem = 4
  const ticksPerSystem = ticksPerMeasure * measuresPerSystem

  const [extraSystems, setExtraSystems] = useState(0)

  // Generate 8 measures of editable score by default, expanding if notes exceed
  const maxNoteTime = trackNotes.length > 0 ? Math.max(...trackNotes.map(n => n.time + n.duration)) : 0
  const totalMeasures = Math.max(Math.ceil((maxNoteTime + 48) / ticksPerMeasure), 8)
  const baseSystems = Math.ceil(totalMeasures / measuresPerSystem)
  const totalSystems = baseSystems + extraSystems

  // Sizing constants for SVG Systems
  const svgWidth = 840
  const svgHeight = 140
  const clefWidth = 60
  const margin = 20
  const noteAreaWidth = svgWidth - clefWidth - margin

  // Staff Line calculations
  const yCenter = 70
  const stepHeight = 4.5
  const middleCY = yCenter + 6 * stepHeight // C4 = step 0

  const staffLinesY = [
    yCenter + 4 * stepHeight, // E4 (Line 1)
    yCenter + 2 * stepHeight, // G4 (Line 2)
    yCenter,                  // B4 (Line 3)
    yCenter - 2 * stepHeight, // D5 (Line 4)
    yCenter - 4 * stepHeight  // F5 (Line 5)
  ]

  // Track mouse coordinates on SVG system
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>, systemIndex: number) => {
    if (!svgRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    // Don't register hovers inside the Clef header area
    if (mouseX < clefWidth) {
      setHoverPos(null)
      return
    }

    // 1. Calculate matching beat/tick snapped to grid (default snap: sixteenth note = 12 ticks)
    const relX = mouseX - clefWidth
    const ratio = relX / noteAreaWidth
    const rawTime = ratio * ticksPerSystem
    
    // Snap to nearest 12 ticks (sixteenth note grid alignment)
    const snapGrid = 12
    const snappedTimeInSystem = Math.max(0, Math.min(ticksPerSystem - snapGrid, Math.round(rawTime / snapGrid) * snapGrid))
    const finalTime = systemIndex * ticksPerSystem + snappedTimeInSystem

    // 2. Calculate nearest diatonic step
    const step = Math.round((middleCY - mouseY) / stepHeight)
    
    // 3. Convert step to pitch and lock to scale override if active
    let pitch = stepToPitch(step)
    
    // Scale snap mapping if Scale Lock is enabled
    const overrideScale = activeTrack?.scaleOverride || scaleLock
    if (overrideScale && overrideScale.enabled) {
      pitch = snapToScale(pitch, overrideScale.root, overrideScale.mode, overrideScale.customIntervals)
    }

    // Coordinate calculation back to SVG space for drawing the shadow preview note
    const previewX = clefWidth + (snappedTimeInSystem / ticksPerSystem) * noteAreaWidth
    const previewY = middleCY - getPitchDiatonic(pitch).step * stepHeight

    setHoverPos({
      x: previewX,
      y: previewY,
      time: finalTime,
      pitch,
      step: getPitchDiatonic(pitch).step
    })
  }

  const handleMouseLeave = () => {
    setHoverPos(null)
  }

  const getTickAndPitchFromEvent = (e: React.MouseEvent<SVGSVGElement>, systemIndex: number) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    if (mouseX < clefWidth) return null

    const relX = mouseX - clefWidth
    const ratio = relX / noteAreaWidth
    const rawTime = ratio * ticksPerSystem
    
    const snapGrid = 12
    const snappedTimeInSystem = Math.max(0, Math.min(ticksPerSystem - snapGrid, Math.round(rawTime / snapGrid) * snapGrid))
    const finalTime = systemIndex * ticksPerSystem + snappedTimeInSystem

    const step = Math.round((middleCY - mouseY) / stepHeight)
    let pitch = stepToPitch(step)
    
    const overrideScale = activeTrack?.scaleOverride || scaleLock
    if (overrideScale && overrideScale.enabled) {
      pitch = snapToScale(pitch, overrideScale.root, overrideScale.mode, overrideScale.customIntervals)
    }

    return { time: finalTime, pitch }
  }

  // Add/remove note on click
  const handleSvgClick = () => {
    if (contextMenu) {
      setContextMenu(null)
      return
    }
    if (!hoverPos || !activeTrackId) return

    const existingNote = trackNotes.find(n => n.pitch === hoverPos.pitch && Math.abs(n.time - hoverPos.time) < 12)

    if (existingNote) {
      // Select if not selected, otherwise delete (unless read-only)
      const isSelected = selectedNoteIds.includes(existingNote.id)
      if (!isSelected) {
        setSelectedNoteIds([existingNote.id])
        setIsRightPaneVisible(true)
        setNoteInspectorEnabled(true)
      } else if (!readOnlyMode) {
        useStore.getState().commitHistory()
        removeNote(existingNote.id)
        setSelectedNoteIds([])
      }
    } else if (!readOnlyMode) {
      // Create new note
      useStore.getState().commitHistory()
      const id = Math.random().toString(36).substr(2, 9)
      addNote({
        id,
        trackId: activeTrackId,
        pitch: hoverPos.pitch,
        time: hoverPos.time,
        duration: selectedDurationTicks,
        velocity: 100
      })

      // Audition note if active track is not muted
      if (activeTrack && !activeTrack.muted) {
        const playedPitch = hoverPos.pitch
        audioEngine.triggerLiveNote(activeTrackId, playedPitch, 100)
        setTimeout(() => {
          audioEngine.releaseLiveNote(activeTrackId, playedPitch)
        }, 250)
      }
    }
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#0a0a0f',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 1. Score Editor Header Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: '#12121a',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0
      }}>
        {/* Note Length selection */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#666', fontWeight: 800 }}>NOTE LENGTH:</span>
          <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.02)', padding: '2px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
            {NOTE_DURATIONS.map(dur => {
              const isActive = selectedDurationTicks === dur.ticks
              return (
                <button
                  key={dur.id}
                  onClick={() => setSelectedDurationTicks(dur.ticks)}
                  style={{
                    background: isActive ? `${trackColor}22` : 'transparent',
                    border: isActive ? `1px solid ${trackColor}66` : '1px solid transparent',
                    color: isActive ? trackColor : '#888',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {dur.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Time Signature selection */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#666', fontWeight: 800 }}>TIME SIGNATURE:</span>
          <select
            value={timeSignature}
            onChange={e => setTimeSignature(e.target.value)}
            style={{
              background: '#161720',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '10px',
              fontWeight: 700,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="2/4">2/4</option>
            <option value="6/8">6/8</option>
          </select>
        </div>

        {/* Active Track EDO Tuning System Indicator */}
        {activeTrack?.instrument === 'synth' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(0, 230, 255, 0.08)',
            border: '1px solid rgba(0, 230, 255, 0.25)',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '10px',
            fontWeight: 700,
            color: '#00e6ff'
          }}>
            <span>EDO TUNING:</span>
            <span style={{ color: '#fff' }}>
              {activeTrack.edoDivision && activeTrack.edoDivision !== 12
                ? `${activeTrack.edoDivision}-EDO (${(1200 / activeTrack.edoDivision).toFixed(1)}¢)`
                : '12-TET Standard'}
            </span>
          </div>
        )}


        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {readOnlyMode && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 8px',
              borderRadius: '4px',
              background: 'rgba(255, 170, 0, 0.12)',
              border: '1px solid rgba(255, 170, 0, 0.4)',
              color: '#ffa94d',
              fontSize: '10px',
              fontWeight: 800
            }}>
              READ ONLY (LOCKED)
            </div>
          )}
          {/* Note name display setting */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showNoteNames}
              onChange={e => setShowNoteNames(e.target.checked)}
              style={{ accentColor: trackColor, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '10px', color: '#888', fontWeight: 700 }}>SHOW NOTE LETTERS</span>
          </label>
        </div>
      </div>

      {/* 2. Scrollable Visual Notation Sheet (Dark Neon Mode!) */}
      <div 
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px'
        }}
        className="thin-scroll"
      >
        {Array.from({ length: totalSystems }).map((_, systemIndex) => {
          const startTick = systemIndex * ticksPerSystem
          const endTick = startTick + ticksPerSystem

          // Get active notes inside this system row
          const systemNotes = trackNotes.filter(n => n.time >= startTick && n.time < endTick)

          // Group notes by start tick to render chord stacks elegantly
          const chordGroups: Record<number, typeof trackNotes> = {}
          systemNotes.forEach(note => {
            if (!chordGroups[note.time]) chordGroups[note.time] = []
            chordGroups[note.time].push(note)
          })

          const sortedChordTimes = Object.keys(chordGroups).map(Number).sort((a, b) => a - b)

          return (
            <div 
              key={systemIndex} 
              style={{
                background: 'rgba(255,255,255,0.01)',
                border: '1px solid rgba(255,255,255,0.04)',
                borderRadius: '8px',
                padding: '16px 20px',
                width: '100%',
                maxWidth: '860px',
                boxSizing: 'border-box',
                position: 'relative'
              }}
            >
              {systemIndex >= baseSystems && (
                <button
                  onClick={() => setExtraSystems(Math.max(0, systemIndex - baseSystems))}
                  title="Remove this row"
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    width: '24px',
                    height: '24px',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.05)',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    lineHeight: 1,
                    transition: 'all 0.15s',
                    zIndex: 10
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,50,50,0.15)'
                    e.currentTarget.style.color = '#ff6b6b'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                    e.currentTarget.style.color = '#888'
                  }}
                >
                  ×
                </button>
              )}
              <svg 
                width="100%" 
                height={svgHeight} 
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                ref={svgIndex => { if (systemIndex === 0) svgRef.current = svgIndex }}
                onMouseMove={e => handleMouseMove(e, systemIndex)}
                onMouseLeave={handleMouseLeave}
                onClick={handleSvgClick}
                onContextMenu={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const pos = getTickAndPitchFromEvent(e, systemIndex)
                  if (pos) {
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      tick: pos.time
                    })
                  }
                }}
                style={{ cursor: 'crosshair', display: 'block' }}
              >
                {/* A. Glow Effect Filter definition */}
                <defs>
                  <filter id="glow-neon" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* B. 5 Staff lines (Glowing dark style!) */}
                {staffLinesY.map((lineY, i) => (
                  <line 
                    key={i} 
                    x1="0" 
                    y1={lineY} 
                    x2={svgWidth} 
                    y2={lineY} 
                    stroke="rgba(255,255,255,0.12)" 
                    strokeWidth="1.2" 
                  />
                ))}

                {/* C. Left Boundary border */}
                <line x1="1" y1={staffLinesY[4]} x2="1" y2={staffLinesY[0]} stroke="rgba(255,255,255,0.3)" strokeWidth="2" />

                {/* D. Premium glowing G-Clef symbol */}
                <text 
                  x="8" 
                  y={yCenter + 15} 
                  fontSize="48" 
                  fontFamily="serif" 
                  fill={trackColor}
                  opacity="0.8"
                  style={{ filter: 'url(#glow-neon)' }}
                >
                  𝄞
                </text>

                {/* E. Time signature indicator */}
                {systemIndex === 0 && (
                  <g opacity="0.6">
                    <text x="45" y={yCenter - 8} fontSize="18" fontWeight="800" fontFamily="serif" fill="white">{sigNum}</text>
                    <text x="45" y={yCenter + 10} fontSize="18" fontWeight="800" fontFamily="serif" fill="white">{sigDen}</text>
                  </g>
                )}

                {/* F. Measure boundary bars */}
                {Array.from({ length: measuresPerSystem }).map((_, mIndex) => {
                  const measureNumber = systemIndex * measuresPerSystem + mIndex + 1
                  
                  const relTime = mIndex + 1
                  const x = clefWidth + (relTime / measuresPerSystem) * noteAreaWidth

                  return (
                    <g key={mIndex}>
                      <line 
                        x1={x} 
                        y1={staffLinesY[4]} 
                        x2={x} 
                        y2={staffLinesY[0]} 
                        stroke="rgba(255,255,255,0.15)" 
                        strokeWidth="1" 
                      />
                      <text 
                        x={x - noteAreaWidth / (measuresPerSystem * 2)} 
                        y={staffLinesY[4] - 8} 
                        fontSize="9" 
                        fontWeight="600" 
                        fontFamily="sans-serif" 
                        textAnchor="middle" 
                        fill="rgba(255,255,255,0.25)"
                      >
                        {measureNumber}
                      </text>
                    </g>
                  )
                })}

                {/* G. Render placed notes inside this system */}
                {sortedChordTimes.map(time => {
                  const chordNotes = chordGroups[time]
                  const relTime = time - startTick
                  const x = clefWidth + (relTime / ticksPerSystem) * noteAreaWidth

                  return (
                    <g key={time}>
                      {chordNotes.map(note => {
                        const noteTrack = tracks.find(t => t.id === note.trackId)
                        const mapping = getPitchDiatonic(note.pitch, noteTrack?.edoDivision || 12, noteTrack?.edoRootNote ?? 60, noteTrack?.edoPreset)
                        const y = middleCY - mapping.step * stepHeight
                        const noteColor = noteTrack?.color || trackColor

                        // Ledger lines logic
                        const ledgers: number[] = []
                        if (mapping.step <= 0) {
                          for (let s = 0; s >= mapping.step; s -= 2) {
                            ledgers.push(s)
                          }
                        } else if (mapping.step >= 12) {
                          for (let s = 12; s <= mapping.step; s += 2) {
                            ledgers.push(s)
                          }
                        }

                        const stemUp = mapping.step < 6
                        const isWhole = note.duration >= 144
                        const isHalf = note.duration >= 72 && note.duration < 144
                        const isEighth = note.duration >= 18 && note.duration < 36
                        const isSixteenth = note.duration < 18

                        const hasStem = !isWhole
                        const isHollow = isWhole || isHalf
                        const isActiveTrackNote = note.trackId === activeTrackId
                        const opacity = isActiveTrackNote ? 1 : 0.6

                        const isSelected = selectedNoteIds.includes(note.id)
                        return (
                          <g 
                            key={note.id} 
                            style={{ 
                              transition: 'opacity 0.2s', 
                              opacity,
                              cursor: 'pointer'
                            }}
                            onClick={e => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (!isSelected) {
                                setSelectedNoteIds([note.id])
                                setIsRightPaneVisible(true)
                                setNoteInspectorEnabled(true)
                              } else if (!readOnlyMode) {
                                useStore.getState().commitHistory()
                                removeNote(note.id)
                                setSelectedNoteIds([])
                              }
                            }}
                            onContextMenu={e => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedNoteIds([note.id])
                              setIsRightPaneVisible(true)
                              setNoteInspectorEnabled(true)
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                tick: note.time,
                                noteId: note.id
                              })
                            }}
                          >
                            {/* Ledger lines */}
                            {ledgers.map(lStep => {
                              const lY = middleCY - lStep * stepHeight
                              return (
                                <line 
                                  key={lStep} 
                                  x1={x - 10} 
                                  y1={lY} 
                                  x2={x + 10} 
                                  y2={lY} 
                                  stroke="rgba(255,255,255,0.4)" 
                                  strokeWidth="1.2" 
                                />
                              )
                            })}

                            {/* Stem line */}
                            {hasStem && (stemUp ? (
                              <line x1={x + 5.5} y1={y} x2={x + 5.5} y2={y - 25} stroke={noteColor} strokeWidth="1.5" />
                            ) : (
                              <line x1={x - 5.5} y1={y} x2={x - 5.5} y2={y + 25} stroke={noteColor} strokeWidth="1.5" />
                            ))}

                            {/* Eighth note flag */}
                            {isEighth && hasStem && (stemUp ? (
                              <path d={`M ${x + 5.5} ${y - 25} c 3 6, 7 8, 3 15 c -1.5 -3.5, -2.5 -6.5, -3 -8`} fill="none" stroke={noteColor} strokeWidth="1.5" strokeLinecap="round" />
                            ) : (
                              <path d={`M ${x - 5.5} ${y + 25} c 3 -6, 7 -8, 3 -15 c -1.5 3.5, -2.5 6.5, -3 8`} fill="none" stroke={noteColor} strokeWidth="1.5" strokeLinecap="round" />
                            ))}

                            {/* Sixteenth note flag (double flag) */}
                            {isSixteenth && hasStem && (stemUp ? (
                              <g>
                                <path d={`M ${x + 5.5} ${y - 25} c 3 6, 7 8, 3 15 c -1.5 -3.5, -2.5 -6.5, -3 -8`} fill="none" stroke={noteColor} strokeWidth="1.5" strokeLinecap="round" />
                                <path d={`M ${x + 5.5} ${y - 20} c 3 6, 7 8, 3 15 c -1.5 -3.5, -2.5 -6.5, -3 -8`} fill="none" stroke={noteColor} strokeWidth="1.5" strokeLinecap="round" />
                              </g>
                            ) : (
                              <g>
                                <path d={`M ${x - 5.5} ${y + 25} c 3 -6, 7 -8, 3 -15 c -1.5 3.5, -2.5 6.5, -3 8`} fill="none" stroke={noteColor} strokeWidth="1.5" strokeLinecap="round" />
                                <path d={`M ${x - 5.5} ${y + 20} c 3 -6, 7 -8, 3 -15 c -1.5 3.5, -2.5 6.5, -3 8`} fill="none" stroke={noteColor} strokeWidth="1.5" strokeLinecap="round" />
                              </g>
                            ))}

                            {/* Accidental (sharp / flat / quarter-tone) */}
                            {mapping.accidental && (
                              <text x={x - 13} y={y + 4.5} fontSize="14" fontWeight="bold" fontFamily="serif" fill={noteColor} style={{ filter: 'url(#glow-neon)' }}>{mapping.accidental}</text>
                            )}

                            {/* Microtonal Cents / Comma Badge */}
                            {mapping.microBadge && (
                              <text x={x} y={stemUp ? y + 16 : y - 14} fontSize="8" fontWeight="800" fontFamily="sans-serif" fill="#00e6ff" textAnchor="middle">{mapping.microBadge}</text>
                            )}

                            {/* Glowing Neon Notehead */}
                            {showNoteNames && (
                              <text
                                x={x}
                                y={y - 10}
                                fontSize="7.5"
                                fontWeight="800"
                                fontFamily="sans-serif"
                                fill="rgba(255, 255, 255, 0.75)"
                                textAnchor="middle"
                              >
                                {mapping.fullName}
                              </text>
                            )}
                            <ellipse 
                              cx={x} 
                              cy={y} 
                              rx="6.2" 
                              ry="4.4" 
                              transform={`rotate(-22 ${x} ${y})`} 
                              fill={isHollow ? 'none' : noteColor} 
                              stroke={isSelected ? '#ff3366' : noteColor}
                              strokeWidth={isSelected ? 2.2 : (isHollow ? 1.8 : 0)}
                              style={{ 
                                filter: isSelected 
                                  ? 'drop-shadow(0 0 4px #ff3366)' 
                                  : (isActiveTrackNote ? 'url(#glow-neon)' : 'none'), 
                                cursor: 'pointer' 
                              }}
                            />

                            {/* Note Name overlay letter */}
                            {showNoteNames && (
                              <text 
                                x={x} 
                                y={y + 1} 
                                fontSize="5.8" 
                                fontWeight="bold" 
                                fontFamily="sans-serif" 
                                fill={isHollow ? noteColor : "#07070a"} 
                                textAnchor="middle" 
                                alignmentBaseline="middle"
                                style={{ pointerEvents: 'none', userSelect: 'none' }}
                              >
                                {mapping.name}
                              </text>
                            )}
                          </g>
                        )
                      })}
                    </g>
                  )
                })}

                {/* H. Draw active Hover Preview shadow note */}
                {hoverPos && (() => {
                  const isWholeH = selectedDurationTicks >= 144
                  const isHalfH = selectedDurationTicks >= 72 && selectedDurationTicks < 144
                  const isEighthH = selectedDurationTicks >= 18 && selectedDurationTicks < 36
                  const isSixteenthH = selectedDurationTicks < 18

                  const hasStemH = !isWholeH
                  const isHollowH = isWholeH || isHalfH
                  const previewMapping = getPitchDiatonic(hoverPos.pitch, activeTrack?.edoDivision || 12, activeTrack?.edoRootNote ?? 60, activeTrack?.edoPreset)
                  const stemUp = previewMapping.step < 6

                  return (
                    <g opacity="0.6">
                      {/* Shadow ledger lines if needed */}
                      {hoverPos.step <= 0 && hoverPos.step % 2 === 0 && (
                        <line x1={hoverPos.x - 10} y1={hoverPos.y} x2={hoverPos.x + 10} y2={hoverPos.y} stroke={trackColor} strokeWidth="1.2" strokeDasharray="2 2" />
                      )}
                      {hoverPos.step >= 12 && hoverPos.step % 2 === 0 && (
                        <line x1={hoverPos.x - 10} y1={hoverPos.y} x2={hoverPos.x + 10} y2={hoverPos.y} stroke={trackColor} strokeWidth="1.2" strokeDasharray="2 2" />
                      )}

                      {/* Stem line */}
                      {hasStemH && (stemUp ? (
                        <line x1={hoverPos.x + 5.5} y1={hoverPos.y} x2={hoverPos.x + 5.5} y2={hoverPos.y - 25} stroke={trackColor} strokeWidth="1.5" />
                      ) : (
                        <line x1={hoverPos.x - 5.5} y1={hoverPos.y} x2={hoverPos.x - 5.5} y2={hoverPos.y + 25} stroke={trackColor} strokeWidth="1.5" />
                      ))}

                      {/* Eighth note flag */}
                      {isEighthH && hasStemH && (stemUp ? (
                        <path d={`M ${hoverPos.x + 5.5} ${hoverPos.y - 25} c 3 6, 7 8, 3 15 c -1.5 -3.5, -2.5 -6.5, -3 -8`} fill="none" stroke={trackColor} strokeWidth="1.5" strokeLinecap="round" />
                      ) : (
                        <path d={`M ${hoverPos.x - 5.5} ${hoverPos.y + 25} c 3 -6, 7 -8, 3 -15 c -1.5 3.5, -2.5 6.5, -3 8`} fill="none" stroke={trackColor} strokeWidth="1.5" strokeLinecap="round" />
                      ))}

                      {/* Sixteenth note flag (double flag) */}
                      {isSixteenthH && hasStemH && (stemUp ? (
                        <g>
                          <path d={`M ${hoverPos.x + 5.5} ${hoverPos.y - 25} c 3 6, 7 8, 3 15 c -1.5 -3.5, -2.5 -6.5, -3 -8`} fill="none" stroke={trackColor} strokeWidth="1.5" strokeLinecap="round" />
                          <path d={`M ${hoverPos.x + 5.5} ${hoverPos.y - 20} c 3 6, 7 8, 3 15 c -1.5 -3.5, -2.5 -6.5, -3 -8`} fill="none" stroke={trackColor} strokeWidth="1.5" strokeLinecap="round" />
                        </g>
                      ) : (
                        <g>
                          <path d={`M ${hoverPos.x - 5.5} ${hoverPos.y + 25} c 3 -6, 7 -8, 3 -15 c -1.5 3.5, -2.5 6.5, -3 8`} fill="none" stroke={trackColor} strokeWidth="1.5" strokeLinecap="round" />
                          <path d={`M ${hoverPos.x - 5.5} ${hoverPos.y + 20} c 3 -6, 7 -8, 3 -15 c -1.5 3.5, -2.5 6.5, -3 8`} fill="none" stroke={trackColor} strokeWidth="1.5" strokeLinecap="round" />
                        </g>
                      ))}

                      {/* Shadow accidental */}
                      {previewMapping.accidental && (
                        <text x={hoverPos.x - 13} y={hoverPos.y + 4.5} fontSize="14" fontWeight="bold" fontFamily="serif" fill={trackColor}>
                          {previewMapping.accidental}
                        </text>
                      )}

                      {/* Shadow Pitch octave name (C4, F#5) above notehead */}
                      <text
                        x={hoverPos.x}
                        y={hoverPos.y - 10}
                        fontSize="7.5"
                        fontWeight="800"
                        fontFamily="sans-serif"
                        fill={trackColor}
                        textAnchor="middle"
                      >
                        {previewMapping.fullName}
                      </text>

                      {/* Shadow Notehead */}
                      <ellipse 
                        cx={hoverPos.x} 
                        cy={hoverPos.y} 
                        rx="6.2" 
                        ry="4.4" 
                        transform={`rotate(-22 ${hoverPos.x} ${hoverPos.y})`} 
                        fill={isHollowH ? 'none' : trackColor} 
                        stroke={trackColor}
                        strokeWidth={isHollowH ? 1.5 : 0}
                        style={{ filter: 'url(#glow-neon)' }}
                      />
                      
                      {/* Note letter index */}
                      <text 
                        x={hoverPos.x} 
                        y={hoverPos.y + 1} 
                        fontSize="5.8" 
                        fontWeight="bold" 
                        fontFamily="sans-serif" 
                        fill={isHollowH ? trackColor : "#07070a"} 
                        textAnchor="middle" 
                        alignmentBaseline="middle"
                      >
                        {previewMapping.name}
                      </text>
                    </g>
                  )
                })()}
              </svg>
            </div>
          )
        })}

        {/* Add Row Button */}
        <div style={{ width: '100%', maxWidth: '860px', display: 'flex', justifyContent: 'center', paddingBottom: '32px' }}>
          <button 
            onClick={() => setExtraSystems(s => s + 1)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px dashed rgba(255,255,255,0.15)',
              color: '#aaa',
              padding: '12px 32px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s',
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = trackColor
              e.currentTarget.style.color = trackColor
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
              e.currentTarget.style.color = '#aaa'
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            }}
          >
            <span style={{ fontSize: '14px', lineHeight: 1 }}>+</span> Add Row (4 Measures)
          </button>
        </div>
      </div>

      {/* Visual Playhead line drawn on top of each system */}
      {Array.from({ length: totalSystems }).map((_, systemIndex) => {
        const startTick = systemIndex * ticksPerSystem
        const endTick = startTick + ticksPerSystem
        if (playheadPosition >= startTick && playheadPosition < endTick) {
          const playheadX = clefWidth + ((playheadPosition - startTick) / ticksPerSystem) * noteAreaWidth
          // We absolute-position it relative to the parent system container!
          return (
            <div
              key={`playhead-${systemIndex}`}
              style={{
                position: 'absolute',
                top: '16px', // Align with SVG padding
                left: `${20 + playheadX}px`, // Align with padding (20px) + SVG offset
                width: '1.5px',
                height: `${svgHeight}px`,
                background: '#ff3366',
                boxShadow: '0 0 8px #ff3366',
                pointerEvents: 'none',
                zIndex: 5
              }}
            />
          )
        }
        return null
      })}

      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#12121a',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            zIndex: 9999,
            minWidth: '150px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            overflow: 'hidden'
          }}
          ref={contextMenuRef}
        >
          <button
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onClick={() => {
              setPlayheadPosition(contextMenu.tick)
              Tone.Transport.ticks = contextMenu.tick
              setContextMenu(null)
            }}
          >
            <IconSkipBack size={12} style={{ color: '#ff3366' }} /> Place playhead here
          </button>
          
          {contextMenu.noteId && (
            <>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />
              <button
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  color: '#4dabf7',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 600
                }}
                onClick={() => {
                  setSelectedNoteIds([contextMenu.noteId!])
                  setIsRightPaneVisible(true)
                  setNoteInspectorEnabled(true)
                  setContextMenu(null)
                }}
              >
                <IconSliders size={12} style={{ color: '#4dabf7' }} /> Inspect Note
              </button>
              {!readOnlyMode && (
                <>
                  {activeTrack?.instrument === 'synth' && (
                    <>
                      <button
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: 'none',
                          border: 'none',
                          color: '#00e6ff',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '11px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: 600
                        }}
                        onClick={() => {
                          const step = (activeTrack.edoDivision && activeTrack.edoDivision !== 12) ? (12 / activeTrack.edoDivision) : 1
                          const n = notes.find(x => x.id === contextMenu.noteId)
                          if (n) {
                            updateNote(n.id, { pitch: Math.round((n.pitch + step) * 1000) / 1000 })
                          }
                          setContextMenu(null)
                        }}
                      >
                        Tune +1 EDO Step ({activeTrack.edoDivision ? `${(1200 / activeTrack.edoDivision).toFixed(1)}¢` : '100¢'})
                      </button>
                      <button
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: 'none',
                          border: 'none',
                          color: '#00e6ff',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '11px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: 600
                        }}
                        onClick={() => {
                          const step = (activeTrack.edoDivision && activeTrack.edoDivision !== 12) ? (12 / activeTrack.edoDivision) : 1
                          const n = notes.find(x => x.id === contextMenu.noteId)
                          if (n) {
                            updateNote(n.id, { pitch: Math.round((n.pitch - step) * 1000) / 1000 })
                          }
                          setContextMenu(null)
                        }}
                      >
                        Tune -1 EDO Step ({activeTrack.edoDivision ? `${(1200 / activeTrack.edoDivision).toFixed(1)}¢` : '100¢'})
                      </button>
                    </>
                  )}
                  <button
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'none',
                      border: 'none',
                      color: '#ff6b6b',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onClick={() => {
                      useStore.getState().commitHistory()
                      removeNote(contextMenu.noteId!)
                      setContextMenu(null)
                    }}
                  >
                    <IconTrash size={12} style={{ color: '#ff6b6b' }} /> Delete Note
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
