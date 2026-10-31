import { useMemo, useState } from 'react'
import { useStore } from '../engine/store'
import { audioEngine } from '../engine/AudioEngine'
import { ACCENT, SliderRow, ToggleRow, chipStyle, sectionTitle } from './paneControls'
import { NOTE_NAMES_SHARP, SCALE_MODES, resolveScaleMode } from '../utils/musicTheory'
import { DEFAULT_SYNTH_PRESET, DEFAULT_DRUM_KIT } from '../utils/instruments'
import {
  DEFAULT_GENERATIVE_SETTINGS,
  generateParts,
  type GeneratedPart,
  type GenerativeEngineId,
  type GenerativeSettings,
  type SourceSnapshot,
} from '../utils/generativeMusic'

const ENGINE_INFO: Array<{ id: GenerativeEngineId; label: string; hint: string }> = [
  { id: 'motif', label: 'Motif', hint: 'Develops a motif from the source: inversion, retrograde, transposition and afterimage echoes.' },
  { id: 'pulse', label: 'Pulse', hint: 'Euclidean drum and percussion patterns, or a learned map of the source drum groove.' },
  { id: 'choir', label: 'Choir', hint: 'Voice-led chords under the source melody, or a progression when there is no melody.' },
  { id: 'arrange', label: 'Arrange', hint: 'A section arc (intro, build, drop, breakdown, outro) across lead, pad/bass and beat parts.' },
  { id: 'respond', label: 'Respond', hint: 'Call and response: leaves the call bars open and answers on the next bar.' },
]

const TRACK_COLORS = ['#ff922b', '#4dabf7', '#69db7c', '#da77f2', '#ff6b6b']
const newId = () => Math.random().toString(36).substr(2, 9)

function MiniRoll({ part, startTick, endTick }: { part: GeneratedPart; startTick: number; endTick: number }) {
  const span = Math.max(1, endTick - startTick)
  const pitches = part.notes.map(n => n.pitch)
  const minPitch = pitches.length > 0 ? Math.min(...pitches) : 0
  const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 15
  const pitchRange = Math.max(1, maxPitch - minPitch)
  const drum = part.isDrum
  const color = drum ? '#ff922b' : '#4dabf7'

  return (
    <svg viewBox="0 0 300 86" style={{ width: '100%', height: '86px', display: 'block', background: 'rgba(0,0,0,0.35)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={4 + f * 292} y1={4} x2={4 + f * 292} y2={82} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      {part.notes.map((n, i) => {
        const x = 4 + ((n.time - startTick) / span) * 292
        const w = Math.max(2, (n.duration / span) * 292)
        const y = drum
          ? 4 + (1 - (n.pitch - minPitch) / pitchRange) * 74
          : 4 + (1 - (n.pitch - minPitch) / pitchRange) * 74
        return <rect key={i} x={x} y={y} width={Math.max(0, Math.min(w, 296 - x))} height={drum ? 3 : 4} rx={1} fill={color} opacity={0.35 + n.velocity * 0.65} />
      })}
      {part.notes.length === 0 && (
        <text x="150" y="46" textAnchor="middle" fill="#555" fontSize="9" fontFamily="Inter, sans-serif">No notes generated</text>
      )}
    </svg>
  )
}

export default function GenerativeMusicPane() {
  const tracks = useStore(s => s.tracks)
  const notes = useStore(s => s.notes)
  const activeTrackId = useStore(s => s.activeTrackId)
  const selectedTrackIds = useStore(s => s.selectedTrackIds)
  const timelineSelection = useStore(s => s.timelineSelection)
  const playheadPosition = useStore(s => s.playheadPosition)
  const meterMap = useStore(s => s.meterMap)
  const timeSignature = useStore(s => s.timeSignature)
  const scaleLock = useStore(s => s.scaleLock)
  const regionPickMode = useStore(s => s.regionPickMode)
  const snapResolution = useStore(s => s.snapResolution)

  const addTrack = useStore(s => s.addTrack)
  const addNotes = useStore(s => s.addNotes)
  const removeNotes = useStore(s => s.removeNotes)
  const commitHistory = useStore(s => s.commitHistory)
  const setActiveTrackId = useStore(s => s.setActiveTrackId)
  const setRegionPickMode = useStore(s => s.setRegionPickMode)
  const showToast = useStore(s => s.showToast)

  const [settings, setSettings] = useState<GenerativeSettings>(() => ({
    ...DEFAULT_GENERATIVE_SETTINGS,
    scaleRoot: scaleLock.root,
    scaleMode: resolveScaleMode(scaleLock.mode) ?? 'Major',
    scaleSnap: true,
  }))
  const [sourceMode, setSourceMode] = useState<'active' | 'selected' | 'all' | 'region'>('active')
  const [destMode, setDestMode] = useState<'new' | 'current'>('new')
  const [writeMode, setWriteMode] = useState<'overdub' | 'replace'>('overdub')
  const [startMode, setStartMode] = useState<'playhead' | 'region' | 'end'>('playhead')
  const [trackName, setTrackName] = useState('')
  const [previewPartIndex, setPreviewPartIndex] = useState(0)

  const update = (patch: Partial<GenerativeSettings>) => setSettings(prev => ({ ...prev, ...patch }))

  const activeTrack = tracks.find(t => t.id === activeTrackId) ?? null
  const regionMin = timelineSelection ? Math.min(timelineSelection.startTick, timelineSelection.endTick) : null
  const regionMax = timelineSelection ? Math.max(timelineSelection.startTick, timelineSelection.endTick) : null

  const regionTrackIds = useMemo(() => {
    if (!timelineSelection) return [] as string[]
    return timelineSelection.trackIds ?? (timelineSelection.trackId ? [timelineSelection.trackId] : [])
  }, [timelineSelection])

  const startTick = useMemo(() => {
    if (startMode === 'end') {
      const maxNote = notes.length > 0 ? Math.max(...notes.map(n => n.time + n.duration)) : 0
      const raw = Math.max(maxNote, 0)
      return Math.ceil(raw / 192) * 192
    }
    if (startMode === 'region' && regionMin !== null) return Math.max(0, Math.round(regionMin))
    return Math.max(0, Math.round(playheadPosition))
  }, [startMode, notes, regionMin, playheadPosition])

  const source = useMemo<SourceSnapshot>(() => {
    const trackIds = sourceMode === 'selected'
      ? (selectedTrackIds.length > 0 ? selectedTrackIds : activeTrackId ? [activeTrackId] : [])
      : sourceMode === 'region'
        ? regionTrackIds
        : sourceMode === 'all'
          ? null
          : activeTrackId
            ? [activeTrackId]
            : []

    let pool = trackIds === null ? notes : notes.filter(n => trackIds.includes(n.trackId))
    if (sourceMode === 'region' && regionMin !== null && regionMax !== null) {
      pool = pool.filter(n => n.time >= regionMin && n.time < regionMax)
    }

    const instrumentTrackId = sourceMode === 'region' && regionTrackIds.length > 0
      ? regionTrackIds[0]
      : (trackIds && trackIds.length > 0 ? (trackIds.includes(activeTrackId ?? '') ? activeTrackId : trackIds[0]) : activeTrackId)
    const instrumentTrack = tracks.find(t => t.id === instrumentTrackId) ?? activeTrack
    const isDrum = instrumentTrack?.instrument === 'drum'
    const trackById = new Map(tracks.map(t => [t.id, t]))

    // Mixed selections: keep drum pads out of melodic phrases and pitched notes out of
    // drum patterns, so a two-track region can feed either kind of engine.
    const pitched = pool.filter(n => {
      const drumTrack = trackById.get(n.trackId)?.instrument === 'drum'
      return isDrum ? drumTrack : !drumTrack
    }).map(n => ({
      pitch: n.pitch,
      time: n.time,
      duration: Math.max(12, n.duration),
      velocity: n.velocity,
    })).sort((a, b) => a.time - b.time)

    const melodicPitches = pitched.filter(n => n.pitch >= 12 && n.pitch <= 108).map(n => n.pitch)
    const anchorPitch = melodicPitches.length > 0
      ? melodicPitches.sort((a, b) => a - b)[Math.floor(melodicPitches.length / 2)]
      : 60

    return { notes: pitched, isDrum, anchorPitch }
  }, [sourceMode, selectedTrackIds, activeTrackId, notes, tracks, activeTrack, regionTrackIds, regionMin, regionMax])

  const barsEnd = useMemo(() => {
    // Rough span used only by the preview ruler; the engine builds the real bar windows.
    const base = Math.round((768 / 4) * 4)
    return Math.max(startTick + 1, startTick + base * settings.bars)
  }, [startTick, settings.bars])

  const settingsKey = JSON.stringify(settings)
  const sourceKey = `${source.notes.length}:${source.isDrum}:${source.anchorPitch}:${startTick}:${meterMap.length}:${timeSignature}:${snapResolution}`
  const regionKey = `${regionMin}:${regionMax}:${regionTrackIds.join(',')}`

  const previewParts = useMemo(() => {
    if (sourceMode === 'region' && (!timelineSelection || regionMin === null)) return null
    return generateParts({
      settings,
      source,
      startTick,
      meterMap,
      timeSignature,
      snapTicks: snapResolution,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey, sourceKey, regionKey, sourceMode])

  const previewPart = previewParts ? previewParts[Math.min(previewPartIndex, previewParts.length - 1)] : null
  const totalNotes = previewParts?.reduce((sum, part) => sum + part.notes.length, 0) ?? 0
  const engineInfo = ENGINE_INFO.find(info => info.id === settings.engine) ?? ENGINE_INFO[0]
  const gridLabel = snapResolution > 0 && 768 % snapResolution === 0 ? `1/${768 / snapResolution}` : `${snapResolution} ticks`

  const changeEngine = (engine: GenerativeEngineId) => {
    update({ engine })
    setPreviewPartIndex(0)
  }

  const rollSeed = () => {
    update({ seed: Math.floor(Math.random() * 999999) })
  }

  const armRegion = () => {
    setSourceMode('region')
    setRegionPickMode(true)
    showToast('Drag across the timeline to select a region (Ctrl/Shift not needed). Multi-select tracks first to span several.', 'info')
  }

  const applyGeneration = () => {
    if (!previewParts || previewParts.length === 0 || totalNotes === 0) {
      showToast('Nothing to apply — generate some notes first.', 'info')
      return
    }

    const targetInstrument = activeTrack?.instrument ?? 'synth'
    const parts = destMode === 'current'
      ? previewParts.filter(part => (part.isDrum ? targetInstrument === 'drum' : targetInstrument !== 'drum'))
      : previewParts

    if (parts.length === 0) {
      showToast(`The active track is a ${targetInstrument} track. Choose New Tracks or another engine.`, 'info')
      return
    }

    commitHistory()
    const createdIds: string[] = []
    const stamp = new Date().toISOString().slice(11, 19)

    parts.forEach((part, index) => {
      const instrument: 'synth' | 'drum' = part.isDrum ? 'drum' : 'synth'
      let targetId = activeTrackId

      if (destMode === 'new' || !targetId) {
        targetId = newId()
        const baseName = trackName.trim() || `${engineInfo.label} ${stamp}`
        const partName = parts.length > 1 ? `${baseName} · ${part.label}` : baseName
        addTrack({
          id: targetId,
          name: partName,
          instrument,
          color: instrument === 'drum' ? TRACK_COLORS[(index + 1) % TRACK_COLORS.length] : TRACK_COLORS[index % TRACK_COLORS.length],
          synthPreset: instrument === 'synth' ? (activeTrack?.synthPreset ?? DEFAULT_SYNTH_PRESET) : undefined,
          drumKit: instrument === 'drum' ? (activeTrack?.drumKit ?? DEFAULT_DRUM_KIT) : undefined,
          volume: activeTrack?.volume ?? 1,
          pan: 0,
          muted: false,
          soloed: false,
        })
        audioEngine.createInstrument(targetId, instrument)
        createdIds.push(targetId)
      }

      if (!targetId) return

      if (destMode === 'current' && writeMode === 'replace' && part.notes.length > 0) {
        const spanStart = Math.min(...part.notes.map(n => n.time))
        const spanEnd = Math.max(...part.notes.map(n => n.time + n.duration))
        const overlapping = notes.filter(n =>
          n.trackId === targetId && n.time < spanEnd && n.time + n.duration > spanStart
        )
        if (overlapping.length > 0) removeNotes(overlapping.map(n => n.id))
      }

      addNotes(part.notes.map(n => ({
        id: `gen-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        trackId: targetId as string,
        time: Math.round(n.time),
        duration: Math.max(12, Math.round(n.duration)),
        pitch: Math.round(n.pitch),
        velocity: Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
      })))
    })

    if (createdIds.length > 0) setActiveTrackId(createdIds[0])
    setPreviewPartIndex(0)
    showToast(`Generated ${totalNotes} notes across ${parts.length} part${parts.length === 1 ? '' : 's'}.`, 'success')
  }

  const randomizeAll = () => {
    const rand = (min: number, max: number) => min + Math.random() * (max - min)
    update({
      seed: Math.floor(Math.random() * 999999),
      density: rand(0.35, 0.85),
      complexity: rand(0.2, 0.8),
      motion: rand(0.25, 0.85),
      tension: rand(0.1, 0.7),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Engine picker */}
      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px', background: 'rgba(0,0,0,0.4)', padding: '3px', borderRadius: '6px' }}>
          {ENGINE_INFO.map(info => (
            <button
              key={info.id}
              onClick={() => changeEngine(info.id)}
              title={info.hint}
              style={{ ...chipStyle(settings.engine === info.id, ACCENT), padding: '5px 2px' }}
            >
              {info.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: '8px', fontSize: '10px', color: '#8b92a5', lineHeight: 1.45 }}>{engineInfo.hint}</div>
      </div>

      {/* Source */}
      <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
        {sectionTitle('Source Notes')}
        <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px' }}>
          <button onClick={() => setSourceMode('active')} style={chipStyle(sourceMode === 'active')}>Active</button>
          <button onClick={() => setSourceMode('selected')} style={chipStyle(sourceMode === 'selected')}>Selected</button>
          <button onClick={() => setSourceMode('all')} style={chipStyle(sourceMode === 'all')}>All</button>
          <button onClick={armRegion} style={chipStyle(sourceMode === 'region', ACCENT)}>Region</button>
        </div>

        {sourceMode === 'region' && (
          <div style={{ marginTop: '6px', padding: '7px 8px', borderRadius: '6px', background: timelineSelection ? 'rgba(255,146,43,0.08)' : 'rgba(255,107,107,0.08)', border: `1px solid ${timelineSelection ? 'rgba(255,146,43,0.3)' : 'rgba(255,107,107,0.3)'}` }}>
            {timelineSelection && regionMin !== null && regionMax !== null ? (
              <>
                <div style={{ fontSize: '10px', color: '#ffd8a8', fontWeight: 700 }}>
                  {regionMax - regionMin} ticks · {Math.max(1, regionTrackIds.length)} track{regionTrackIds.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '9px', color: '#a98b63', marginTop: '2px' }}>
                  {tracks.filter(t => regionTrackIds.includes(t.id)).map(t => t.name).join(', ')}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '10px', color: '#ffc9c9', lineHeight: 1.4 }}>
                No region yet. Press <strong>Region</strong> again, then drag across the timeline. Ctrl/Shift also works.
              </div>
            )}
            <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
              <button onClick={armRegion} style={{ ...chipStyle(regionPickMode, ACCENT), border: '1px solid rgba(255,146,43,0.35)', background: regionPickMode ? 'rgba(255,146,43,0.18)' : 'transparent' }}>
                {regionPickMode ? 'Drag in timeline...' : 'Redraw Region'}
              </button>
              <button
                onClick={() => {
                  setRegionPickMode(false)
                  useStore.getState().setTimelineSelection(null)
                }}
                style={{ ...chipStyle(false, '#ff8787') }}
              >
                Clear
              </button>
            </div>
            <div style={{ fontSize: '9px', color: '#777', marginTop: '5px', lineHeight: 1.4 }}>
              Select tracks first (Ctrl/Shift click in the track list) to span more than one track.
            </div>
          </div>
        )}

        <div style={{ marginTop: '7px', fontSize: '9px', color: '#666', display: 'flex', justifyContent: 'space-between' }}>
          <span>{source.notes.length} source notes · {source.isDrum ? 'drum' : 'pitched'}</span>
          <span>anchor {source.isDrum ? '—' : NOTE_NAMES_SHARP[source.anchorPitch % 12]}</span>
        </div>
      </div>

      {/* Destination + placement */}
      <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '8px', border: '1px solid rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column', gap: '7px' }}>
        <div>
          {sectionTitle('Destination')}
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px' }}>
            <button onClick={() => setDestMode('new')} style={chipStyle(destMode === 'new')}>New Track{previewParts && previewParts.length > 1 ? 's' : ''}</button>
            <button onClick={() => setDestMode('current')} style={chipStyle(destMode === 'current')}>{activeTrack?.name ? `Into ${activeTrack.name}` : 'Current Track'}</button>
          </div>
          {destMode === 'new' && (
            <input
              value={trackName}
              onChange={e => setTrackName(e.target.value)}
              placeholder={`${engineInfo.label} ${new Date().toISOString().slice(11, 19)}`}
              style={{ marginTop: '5px', width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', padding: '5px 7px', color: '#ddd', fontSize: '10px', outline: 'none' }}
            />
          )}
          {destMode === 'current' && (
            <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px', marginTop: '5px' }}>
              <button onClick={() => setWriteMode('overdub')} style={chipStyle(writeMode === 'overdub')}>Overdub</button>
              <button onClick={() => setWriteMode('replace')} style={chipStyle(writeMode === 'replace')}>Replace Span</button>
            </div>
          )}
        </div>

        <div>
          {sectionTitle('Start Position')}
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px' }}>
            <button onClick={() => setStartMode('playhead')} style={chipStyle(startMode === 'playhead')}>Playhead</button>
            <button onClick={() => setStartMode('region')} style={chipStyle(startMode === 'region')} disabled={!timelineSelection}>Region</button>
            <button onClick={() => setStartMode('end')} style={chipStyle(startMode === 'end')}>End</button>
          </div>
          <div style={{ fontSize: '9px', color: '#666', marginTop: '4px', fontFamily: 'monospace' }}>starts at tick {startTick}</div>
        </div>

        <SliderRow label="Bars" value={settings.bars} min={1} max={32} step={1} suffix="bars" onChange={v => update({ bars: Math.round(v) })} />
      </div>

      {/* Musical controls */}
      <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
        {sectionTitle('Shape')}
        <SliderRow label="Density" value={settings.density} min={0.05} max={1} suffix="%" onChange={v => update({ density: v })} />
        <SliderRow label="Complexity" value={settings.complexity} min={0} max={1} suffix="%" onChange={v => update({ complexity: v })} />
        <SliderRow label="Motion" value={settings.motion} min={0} max={1} suffix="%" onChange={v => update({ motion: v })} />
        <SliderRow label="Tension" value={settings.tension} min={0} max={1} suffix="%" color="#ff6b6b" onChange={v => update({ tension: v })} />
        <SliderRow label="Velocity" value={settings.velocity} min={0.1} max={1} suffix="%" color="#69db7c" onChange={v => update({ velocity: v })} />
        <SliderRow label="Register" value={settings.register} min={-2} max={2} step={1} onChange={v => update({ register: Math.round(v) })} />
        <SliderRow label="Humanize" value={settings.humanize} min={0} max={1} suffix="%" color="#da77f2" onChange={v => update({ humanize: v })} />
        <SliderRow label="Swing" value={settings.swing} min={0} max={1} suffix="%" color="#da77f2" onChange={v => update({ swing: v })} />
        <SliderRow label="Afterimage" value={settings.echo} min={0} max={1} suffix="%" color="#00e6ff" onChange={v => update({ echo: v })} />

        <div style={{ marginTop: '8px', paddingTop: '7px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <ToggleRow
            label="Grid Snap"
            hint={`starts on ${gridLabel}`}
            active={settings.snapTime}
            onClick={() => update({ snapTime: !settings.snapTime })}
            title="Round generated note start times to the project grid"
          />
          <ToggleRow
            label="Note Sizes"
            hint={`multiples of ${gridLabel}`}
            active={settings.snapDuration}
            onClick={() => update({ snapDuration: !settings.snapDuration })}
            title="Round generated note durations to whole grid steps"
          />
        </div>
      </div>

      {/* Variation and scale */}
      <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
        {sectionTitle('Variation')}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            type="number"
            value={settings.seed}
            onChange={e => update({ seed: parseInt(e.target.value, 10) || 0 })}
            style={{ flex: 1, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', padding: '4px 7px', color: '#ddd', fontSize: '10px', fontFamily: 'monospace', outline: 'none' }}
          />
          <button onClick={rollSeed} style={{ ...chipStyle(true, ACCENT), flex: '0 0 auto', padding: '4px 10px', background: 'rgba(255,146,43,0.16)', border: '1px solid rgba(255,146,43,0.3)' }}>Roll</button>
        </div>

        {!source.isDrum && (
          <>
            <div style={{ marginTop: '8px' }}>
              <ToggleRow label="Scale Snap" active={settings.scaleSnap} onClick={() => update({ scaleSnap: !settings.scaleSnap })} title="Keep generated pitches inside the chosen scale" />
            </div>
            {settings.scaleSnap && (
              <div style={{ display: 'flex', gap: '4px', marginTop: '5px' }}>
                <select
                  value={settings.scaleRoot}
                  onChange={e => update({ scaleRoot: parseInt(e.target.value, 10) })}
                  style={{ flex: '0 0 64px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', padding: '4px', color: '#ddd', fontSize: '10px', outline: 'none' }}
                >
                  {NOTE_NAMES_SHARP.map((name, index) => <option key={name} value={index}>{name}</option>)}
                </select>
                <select
                  value={settings.scaleMode}
                  onChange={e => update({ scaleMode: e.target.value })}
                  style={{ flex: 1, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', padding: '4px', color: '#ddd', fontSize: '10px', outline: 'none' }}
                >
                  {SCALE_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                </select>
              </div>
            )}
          </>
        )}
        {source.isDrum && (
          <div style={{ marginTop: '7px', fontSize: '9px', color: '#666', lineHeight: 1.4 }}>
            Drum source: scale snapping is hidden because pads have no pitch.
          </div>
        )}
      </div>

      {/* Preview */}
      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: ACCENT }}>Preview</span>
          <span style={{ fontSize: '9px', color: '#888', fontWeight: 600 }}>
            {previewParts ? `${totalNotes} notes · ${previewParts.length} part${previewParts.length === 1 ? '' : 's'}` : 'select a region'}
          </span>
        </div>

        {previewParts && previewParts.length > 1 && (
          <div style={{ display: 'flex', gap: '3px', marginBottom: '6px' }}>
            {previewParts.map((part, index) => (
              <button
                key={`${part.label}-${index}`}
                onClick={() => setPreviewPartIndex(index)}
                style={{ ...chipStyle(previewPartIndex === index, part.isDrum ? '#ff922b' : '#4dabf7'), border: '1px solid rgba(255,255,255,0.08)', padding: '3px 4px' }}
              >
                {part.label}
              </button>
            ))}
          </div>
        )}

        {previewPart
          ? <MiniRoll part={previewPart} startTick={startTick} endTick={Math.max(barsEnd, ...previewParts!.flatMap(p => p.notes.map(n => n.time + n.duration)), startTick + 1)} />
          : (
            <div style={{ height: '86px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', background: 'rgba(0,0,0,0.35)', border: '1px dashed rgba(255,255,255,0.08)', color: '#666', fontSize: '10px', textAlign: 'center', padding: '0 12px' }}>
              Select a timeline region to use it as the source.
            </div>
          )}

        <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
          <button
            onClick={applyGeneration}
            disabled={!previewParts || totalNotes === 0}
            style={{
              flex: 1,
              padding: '7px 8px',
              borderRadius: '6px',
              border: '1px solid rgba(255,146,43,0.35)',
              background: 'rgba(255,146,43,0.16)',
              color: totalNotes > 0 ? '#ffc078' : '#666',
              fontSize: '10.5px',
              fontWeight: 800,
              cursor: totalNotes > 0 ? 'pointer' : 'not-allowed',
              opacity: totalNotes > 0 ? 1 : 0.5,
            }}
          >
            Apply to {destMode === 'new' ? (previewParts && previewParts.length > 1 ? 'New Tracks' : 'New Track') : (activeTrack?.name ?? 'Current Track')}
          </button>
          <button
            onClick={randomizeAll}
            title="Roll a new seed and randomise shape"
            style={{ flex: '0 0 auto', padding: '7px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#aaa', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
          >
            Surprise
          </button>
        </div>
      </div>
    </div>
  )
}
