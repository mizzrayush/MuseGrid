import { useState, useRef } from 'react'
import { useStore, DEFAULT_DRUM_ROWS } from '../engine/store'
import { audioEngine } from '../engine/AudioEngine'
import { IconPin, IconSliders, IconTrash } from '../ui/Icons'
import { useContextMenuDismissal } from '../ui/useContextMenuDismissal'
import { sliderProgress } from '../ui/AppSlider'

// We'll use the store's snapResolution as the dynamic STEP_TICKS

function newId() {
  return Math.random().toString(36).substr(2, 9)
}

function layeredBackground(colors: string[], fallback: string): string {
  if (colors.length === 0) return fallback
  if (colors.length === 1) return colors[0]
  const slice = 100 / colors.length
  return `linear-gradient(90deg, ${colors.map((color, index) => `${color} ${index * slice}% ${(index + 1) * slice}%`).join(', ')})`
}

export default function DrumSequencer() {
  const allNotes = useStore(s => s.notes)
  const addNote = useStore(s => s.addNote)
  const removeNote = useStore(s => s.removeNote)
  const updateNote = useStore(s => s.updateNote)
  const commitHistory = useStore(s => s.commitHistory)
  const loopEnabled = useStore(s => s.loopEnabled)
  const loopStart = useStore(s => s.loopStart)
  const loopEnd = useStore(s => s.loopEnd)
  const tracks = useStore(s => s.tracks)
  const activeTrackId = useStore(s => s.activeTrackId)
  const gridShadeEvery = useStore(s => s.gridShadeEvery)
  const activeTrack = tracks.find(track => track.id === activeTrackId)
  const drumTracks = tracks.filter(track => track.instrument === 'drum')
  const drumTrackIds = new Set(drumTracks.filter(track => !track.hidden).map(track => track.id))
  const bothGridActive = useStore(s => s.bothGridActive)
  const lastActiveDrumTrackId = useStore(s => s.lastActiveDrumTrackId)
  const targetId = bothGridActive ? lastActiveDrumTrackId : activeTrackId
  const editTrack = drumTracks.find(track => track.id === targetId) ?? drumTracks.find(track => track.id === activeTrackId) ?? drumTracks[0]
  const rows = editTrack?.drumRows ?? DEFAULT_DRUM_ROWS
  const readOnlyMode = useStore(s => s.readOnlyMode)
  const isReadOnly = bothGridActive ? readOnlyMode : (activeTrack ? activeTrack.instrument !== 'drum' : false)
  const setPlayhead = useStore(s => s.setPlayheadPosition)
  const setSelectedNoteIds = useStore(s => s.setSelectedNoteIds)
  const setIsRightPaneVisible = useStore(s => s.setIsRightPaneVisible)
  const setNoteInspectorEnabled = useStore(s => s.setNoteInspectorEnabled)

  const snapResolution = useStore(s => s.snapResolution)
  const setSnapResolution = useStore(s => s.setSnapResolution)
  const STEP_TICKS = snapResolution

  const drumSteps = useStore(s => s.drumSteps)
  const setDrumSteps = useStore(s => s.setDrumSteps)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tick: number; noteId?: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  useContextMenuDismissal(contextMenu !== null, setContextMenu, contextMenuRef)

  const notes = allNotes.filter(note => drumTrackIds.has(note.trackId))
  const editTrackNotes = editTrack ? notes.filter(note => note.trackId === editTrack.id) : []


  const currentStep = useStore(s => {
    const target = s.bothGridActive ? s.lastActiveDrumTrackId : s.activeTrackId
    const eTrack = s.tracks.find(t => t.id === target) ?? s.tracks.find(t => t.id === s.activeTrackId) ?? s.tracks.filter(t => t.instrument === 'drum')[0]
    const globalBpm = s.bpm
    const multiplier = (eTrack?.targetTempo ?? globalBpm) / globalBpm
    const STEP_TICKS = s.snapResolution
    const drumSteps = s.drumSteps
    return Math.floor((s.playheadPosition * multiplier) / STEP_TICKS) % drumSteps
  })

  const getCellNotes = (pitch: number, step: number) =>
    notes.filter(note => note.pitch === pitch && Math.floor(note.time / STEP_TICKS) === step)

  const getEditNote = (pitch: number, step: number) =>
    editTrackNotes.find(note => note.pitch === pitch && Math.floor(note.time / STEP_TICKS) === step)

  const toggleStep = (pitch: number, step: number) => {
    if (isReadOnly || !editTrack) return
    const existing = getEditNote(pitch, step)
    if (existing) {
      commitHistory()
      removeNote(existing.id)
    } else {
      commitHistory()
      addNote({ id: newId(), trackId: editTrack.id, time: step * STEP_TICKS, duration: STEP_TICKS, pitch, velocity: 100 })
      audioEngine.playNote(editTrack.id, 'drum', pitch, '16n')
    }
  }

  const changeVelocity = (pitch: number, step: number, vel: number) => {
    const note = getEditNote(pitch, step)
    if (note) updateNote(note.id, { velocity: Math.max(1, Math.min(127, vel)) })
  }

  const clearActiveTrack = () => {
    if (isReadOnly || editTrackNotes.length === 0) return
    commitHistory()
    editTrackNotes.forEach(note => removeNote(note.id))
  }

  const sectionBg = (step: number) =>
    Math.floor(step / Math.max(1, gridShadeEvery)) % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#141414', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontWeight: 700, fontSize: '12px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Step Sequencer - {editTrack?.name ?? 'No drum track'}{isReadOnly ? ' - Read only' : ''}
          </span>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: '#555', fontWeight: 600 }}>Resolution</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '2px 8px', borderRadius: '4px' }}>
              {[192, 96, 64, 48, 32, 24, 12].map(res => {
                const label = res === 192 ? '1/4'
                  : res === 96 ? '1/8'
                  : res === 64 ? '1/8T'
                  : res === 48 ? '1/16'
                  : res === 32 ? '1/16T'
                  : res === 24 ? '1/32'
                  : '1/64'
                return (
                  <button
                    key={res}
                    onClick={() => setSnapResolution(res)}
                    style={{ background: 'none', border: 'none', padding: 0, color: snapResolution === res ? '#4dabf7' : '#444', fontSize: '10px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s' }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: '10px' }}>
              <span style={{ fontSize: '9px', color: '#444', fontWeight: 800 }}>Custom Ticks</span>
              <input
                type="number"
                value={snapResolution}
                onChange={e => setSnapResolution(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ width: '42px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(77,171,247,0.2)', borderRadius: '4px', color: '#4dabf7', fontSize: '10px', fontWeight: 900, padding: '3px 6px', outline: 'none', textAlign: 'center', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)' }}
                title="Enter custom ticks for glitch/polyrhythmic patterns"
              />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: '#555', fontWeight: 600 }}>Steps</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '2px 8px', borderRadius: '4px' }}>
            {[16, 32, 64].map(s => (
              <button
                key={s}
                onClick={() => setDrumSteps(s)}
                style={{ background: 'none', border: 'none', padding: 0, color: drumSteps === s ? '#4dabf7' : '#444', fontSize: '10px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s' }}
              >
                {s}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: '10px' }}>
            <input
              type="number"
              value={drumSteps}
              onChange={e => setDrumSteps(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ width: '42px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(77,171,247,0.2)', borderRadius: '4px', color: '#4dabf7', fontSize: '10px', fontWeight: 900, padding: '3px 6px', outline: 'none', textAlign: 'center', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)' }}
              title="Enter custom number of steps"
            />
          </div>
          <button onClick={clearActiveTrack} disabled={isReadOnly} style={{ marginLeft: '10px', padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(255,80,80,0.3)', background: 'rgba(255,80,80,0.08)', color: isReadOnly ? '#555' : '#ff6b6b', cursor: isReadOnly ? 'default' : 'pointer', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Clear
          </button>
        </div>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ minWidth: `calc(104px + ${drumSteps * 28}px + 32px)`, display: 'flex', flexDirection: 'column', flex: 1, position: 'relative' }}>

          {/* Header */}
          <div style={{ display: 'flex', paddingLeft: '104px', paddingRight: '16px', paddingTop: '8px', flexShrink: 0, position: 'relative', zIndex: 5 }}>
            <div style={{ position: 'sticky', left: 0, width: '104px', height: '100%', background: '#0f1015', zIndex: 12, marginLeft: '-104px', borderRight: '1px solid rgba(255,255,255,0.03)' }} />

            {/* Loop Region Overlay */}
            {loopEnabled && (
              <div style={{
                position: 'absolute',
                top: 0, bottom: -4,
                left: `calc(104px + ${(loopStart / (drumSteps * STEP_TICKS)) * 100}%)`,
                width: `${((loopEnd - loopStart) / (drumSteps * STEP_TICKS)) * 100}%`,
                maxWidth: 'calc(100% - 120px)',
                background: 'rgba(77,171,247,0.1)',
                borderLeft: '1px solid rgba(77,171,247,0.3)',
                borderRight: '1px solid rgba(77,171,247,0.3)',
                pointerEvents: 'none',
                zIndex: 0
              }} />
            )}
            {Array.from({ length: drumSteps }).map((_, i) => {
              const stepTick = i * STEP_TICKS
              const inLoop = loopEnabled && stepTick >= loopStart && stepTick < loopEnd
              return (
                <div key={i} style={{ flex: 1, minWidth: '28px', textAlign: 'center', fontSize: '9px', color: i % 4 === 0 ? (inLoop ? '#fff' : '#4dabf7') : '#333', fontWeight: i % 4 === 0 ? 700 : 400, position: 'relative', height: '16px', zIndex: 1 }}>
                  {i === currentStep && <span style={{ position: 'absolute', left: 0, top: 0, bottom: -4, width: 2, background: '#ff3366', boxShadow: '0 0 8px rgba(255,51,102,0.75)', zIndex: 2 }} />}
                  {i % 4 === 0 ? Math.floor(i / 4) + 1 : '.'}
                </div>
              )
            })}
          </div>

          {/* Rows */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: '4px', padding: '10px 16px 12px 16px' }}>
            {rows.map(row => (
              <div key={row.pitch} style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '46px' }}>
                <div style={{ width: '80px', flexShrink: 0, position: 'sticky', left: '16px', background: '#0f1015', zIndex: 10, paddingRight: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.75)' }}>{row.name}</span>
                </div>

                {Array.from({ length: drumSteps }).map((_, step) => {
                  const cellNotes = getCellNotes(row.pitch, step)
                  const editNote = getEditNote(row.pitch, step)
                  const isCurrent = currentStep === step
                  const vel = editNote?.velocity ?? 100
                  const colors = cellNotes.map(note => tracks.find(track => track.id === note.trackId)?.color ?? row.color)
                  const active = cellNotes.length > 0
                  return (
                    <div key={step} style={{ flex: 1, minWidth: '28px', display: 'flex', flexDirection: 'column', gap: '2px', background: sectionBg(step), borderRadius: '3px', padding: '2px' }}>
                      <button
                        onClick={() => toggleStep(row.pitch, step)}
                        style={{
                          width: '100%', height: '34px', borderRadius: '4px',
                          border: `1px solid ${isCurrent ? '#4dabf7' : editNote ? editTrack?.color ?? row.color : step % 4 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)'}`,
                          background: active ? layeredBackground(colors, row.color) : isCurrent ? 'rgba(77,171,247,0.12)' : step % 4 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                          cursor: isReadOnly ? 'default' : 'pointer',
                          boxShadow: editNote ? `0 0 10px ${(editTrack?.color ?? row.color)}55` : 'none',
                          opacity: active && !editNote ? 0.55 : 1,
                          transition: 'all 0.07s',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                        onContextMenu={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (editNote) {
                            setSelectedNoteIds([editNote.id])
                            setIsRightPaneVisible(true)
                            setNoteInspectorEnabled(true)
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              tick: step * STEP_TICKS,
                              noteId: editNote.id
                            })
                          } else {
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              tick: step * STEP_TICKS
                            })
                          }
                        }}
                      >
                        {editNote && (
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${(vel / 127) * 100}%`, background: 'rgba(0,0,0,0.25)', pointerEvents: 'none' }} />
                        )}
                        {editNote && editNote.pitchOffset !== undefined && editNote.pitchOffset !== 0 && (
                          <span style={{ position: 'absolute', top: '2px', right: '3px', fontSize: '8px', fontWeight: 800, color: '#ffcc00', pointerEvents: 'none', lineHeight: 1 }}>
                            {editNote.pitchOffset > 0 ? `+${editNote.pitchOffset}` : editNote.pitchOffset}
                          </span>
                        )}
                      </button>
                      {editNote && !isReadOnly && (
                        <input
                          className="modern-slider compact-slider"
                          type="range"
                          min={1}
                          max={127}
                          value={vel}
                          onChange={e => changeVelocity(row.pitch, step, +e.target.value)}
                          onClick={e => e.stopPropagation()}
                          style={{ '--slider-color': editTrack?.color ?? row.color, '--slider-progress': sliderProgress(vel, 1, 127), accentColor: editTrack?.color ?? row.color } as React.CSSProperties}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: '#12121a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', zIndex: 9999, minWidth: '160px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', overflow: 'hidden' }}
          ref={contextMenuRef}
        >
          <button
            style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: 'white', cursor: 'pointer', textAlign: 'left', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}
            onClick={() => {
              setPlayhead(contextMenu.tick)
              import('tone').then(Tone => Tone.Transport.ticks = contextMenu.tick)
              setContextMenu(null)
            }}
          >
            <IconPin size={14} style={{ color: '#ff3366' }} /> Place playhead here
          </button>

          {contextMenu.noteId && (
            <>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)' }} />
              <button
                style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}
                onClick={() => {
                  setSelectedNoteIds([contextMenu.noteId!])
                  setIsRightPaneVisible(true)
                  setNoteInspectorEnabled(true)
                  setContextMenu(null)
                }}
              >
                <IconSliders size={13} style={{ color: '#aaa' }} /> Inspect Note
              </button>
              <button
                style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', textAlign: 'left', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}
                onClick={() => {
                  removeNote(contextMenu.noteId!)
                  setContextMenu(null)
                }}
              >
                <IconTrash size={13} style={{ color: '#ff6b6b' }} /> Delete Note
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ padding: '8px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '11px', color: '#444', flexShrink: 0 }}>
        Step {currentStep + 1} / {drumSteps} - {editTrack && <span style={{ color: editTrack.color }}>{editTrack.name}</span>}
      </div>
    </div>
  )
}
