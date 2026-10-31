import { useMemo, useState } from 'react'
import { useStore } from '../engine/store'
import { audioEngine } from '../engine/AudioEngine'
import { DEFAULT_DRUM_ROWS, type DrumRowConfig } from '../engine/store'
import { DEFAULT_DRUM_KIT, type DrumKit } from '../utils/instruments'
import { ACCENT, SliderRow, ToggleRow, chipStyle, sectionTitle } from './paneControls'
import { GENERATIVE_PPQ } from '../utils/generativeMusic'
import {
  DEFAULT_DRUM_GENERATE_SETTINGS,
  DRUM_STYLES,
  drumPadName,
  generateDrumPattern,
  resolveDrumStyle,
  type DrumGenerateSettings,
  type DrumStyleId,
  type GeneratedDrumPattern,
} from '../utils/generativeDrums'

const PAD_COLORS: Record<string, string> = {
  kick: '#ff6b6b',
  snare: '#ff922b',
  clap: '#fab005',
  hat: '#4dabf7',
  openHat: '#00e6ff',
  ghost: '#748ffc',
  perc: '#69db7c',
  tom: '#da77f2',
  crash: '#f783ac',
}

const TRACK_COLORS = ['#ff922b', '#4dabf7', '#69db7c', '#da77f2', '#ff6b6b']
const KIT_OPTIONS: Array<{ id: DrumKit; label: string }> = [
  { id: 'classic', label: 'Classic 808 kit' },
  { id: 'acoustic', label: 'Acoustic kit' },
  { id: 'tight', label: 'Tight kit' },
  { id: 'electro', label: 'Electro kit' },
  { id: 'eightOhEight', label: 'TR-808 kit' },
  { id: 'tabla', label: 'Tabla / hand drums' },
]
const newId = () => Math.random().toString(36).substr(2, 9)

const inputStyle = {
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '5px',
  padding: '4px 7px',
  color: '#ddd',
  fontSize: '10px',
  outline: 'none' as const,
}

const CARD = { background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '8px', border: '1px solid rgba(255,255,255,0.03)' }
const PANEL = { background: 'rgba(255,255,255,0.03)', padding: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }

function DrumGridPreview({
  pattern,
  startTick,
  endTick,
  labelFor,
}: {
  pattern: GeneratedDrumPattern
  startTick: number
  endTick: number
  labelFor: (pad: number) => string
}) {
  const span = Math.max(1, endTick - startTick)
  const pads = Array.from(new Set(pattern.hits.map(hit => hit.pitch))).sort((a, b) => b - a)

  if (pads.length === 0) {
    return (
      <div style={{ height: '76px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', background: 'rgba(0,0,0,0.35)', border: '1px dashed rgba(255,255,255,0.08)', color: '#666', fontSize: '10px', textAlign: 'center', padding: '0 12px' }}>
        No hits with these pads — widen the source or raise Density.
      </div>
    )
  }

  return (
    <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '4px 6px 6px' }}>
      <div style={{ position: 'relative', height: '12px', marginLeft: '66px' }}>
        {pattern.windows.map(window => (
          <span
            key={window.index}
            style={{ position: 'absolute', left: `${((window.start - startTick) / span) * 100}%`, top: 0, fontSize: '8.5px', color: '#555', fontFamily: 'monospace' }}
          >
            {window.index + 1}
          </span>
        ))}
      </div>

      {pads.map(pad => {
        const hits = pattern.hits.filter(hit => hit.pitch === pad)
        const role = hits[0]?.role ?? 'perc'
        const color = PAD_COLORS[role] ?? '#4dabf7'
        return (
          <div key={pad} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '62px', flexShrink: 0, fontSize: '8.5px', color: '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelFor(pad)}</span>
            <div style={{ position: 'relative', flex: 1, height: '11px', background: 'rgba(255,255,255,0.02)', borderRadius: '2px', overflow: 'hidden' }}>
              {pattern.windows.map(window => (
                <span key={window.index} style={{ position: 'absolute', left: `${((window.start - startTick) / span) * 100}%`, top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.06)' }} />
              ))}
              {hits.map((hit, index) => (
                <span
                  key={index}
                  title={`bar ${Math.max(1, pattern.windows.findIndex(window => hit.time >= window.start && hit.time < window.end) + 1)} · ${hit.role}`}
                  style={{
                    position: 'absolute',
                    left: `${Math.max(0, Math.min(100, ((hit.time - startTick) / span) * 100))}%`,
                    width: `max(2px, ${Math.min(100, (hit.duration / span) * 100)}%)`,
                    top: '2px',
                    height: '7px',
                    borderRadius: '1px',
                    background: color,
                    opacity: 0.3 + hit.velocity * 0.7,
                  }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function GenerativeDrumsPane() {
  const tracks = useStore(s => s.tracks)
  const notes = useStore(s => s.notes)
  const activeTrackId = useStore(s => s.activeTrackId)
  const selectedTrackIds = useStore(s => s.selectedTrackIds)
  const timelineSelection = useStore(s => s.timelineSelection)
  const playheadPosition = useStore(s => s.playheadPosition)
  const meterMap = useStore(s => s.meterMap)
  const timeSignature = useStore(s => s.timeSignature)
  const snapResolution = useStore(s => s.snapResolution)
  const regionPickMode = useStore(s => s.regionPickMode)

  const addTrack = useStore(s => s.addTrack)
  const addNotes = useStore(s => s.addNotes)
  const removeNotes = useStore(s => s.removeNotes)
  const commitHistory = useStore(s => s.commitHistory)
  const setActiveTrackId = useStore(s => s.setActiveTrackId)
  const setRegionPickMode = useStore(s => s.setRegionPickMode)
  const showToast = useStore(s => s.showToast)

  const [settings, setSettings] = useState<DrumGenerateSettings>(DEFAULT_DRUM_GENERATE_SETTINGS)
  const [sourceMode, setSourceMode] = useState<'none' | 'active' | 'selected' | 'all'>('active')
  const [destMode, setDestMode] = useState<'new' | 'current'>('new')
  const [writeMode, setWriteMode] = useState<'overdub' | 'replace'>('overdub')
  const [startMode, setStartMode] = useState<'playhead' | 'region' | 'end'>('playhead')
  const [kit, setKit] = useState<DrumKit>(DEFAULT_DRUM_KIT)
  const [trackName, setTrackName] = useState('')

  const update = (patch: Partial<DrumGenerateSettings>) => setSettings(prev => ({ ...prev, ...patch }))

  const activeTrack = tracks.find(t => t.id === activeTrackId) ?? null
  const activeIsDrum = activeTrack?.instrument === 'drum'
  const targetIsDrum = destMode === 'new' || activeIsDrum

  const regionMin = timelineSelection ? Math.min(timelineSelection.startTick, timelineSelection.endTick) : null
  const regionMax = timelineSelection ? Math.max(timelineSelection.startTick, timelineSelection.endTick) : null

  const startTick = useMemo(() => {
    if (startMode === 'end') {
      const maxNote = notes.length > 0 ? Math.max(...notes.map(n => n.time + n.duration)) : 0
      return Math.ceil(Math.max(maxNote, 0) / GENERATIVE_PPQ) * GENERATIVE_PPQ
    }
    if (startMode === 'region' && regionMin !== null) return Math.max(0, Math.round(regionMin))
    return Math.max(0, Math.round(playheadPosition))
  }, [startMode, notes, regionMin, playheadPosition])

  const targetRows: DrumRowConfig[] = useMemo(() => {
    if (destMode === 'current' && activeIsDrum && activeTrack?.drumRows?.length) return activeTrack.drumRows
    return DEFAULT_DRUM_ROWS
  }, [destMode, activeIsDrum, activeTrack])

  const allowedPads = useMemo(() => targetRows.map(row => row.pitch), [targetRows])
  const padLabel = (pad: number) => targetRows.find(row => row.pitch === pad)?.name ?? drumPadName(pad)

  const learnedIds = useMemo(() => {
    if (sourceMode === 'none') return null
    if (sourceMode === 'all') return null
    return sourceMode === 'selected'
      ? (selectedTrackIds.length > 0 ? selectedTrackIds : activeTrackId ? [activeTrackId] : [])
      : (activeTrackId ? [activeTrackId] : [])
  }, [sourceMode, selectedTrackIds, activeTrackId])

  const drumById = useMemo(() => new Map(tracks.filter(t => t.instrument === 'drum').map(t => [t.id, t])), [tracks])

  const learned = useMemo(() => {
    let pool = notes.filter(n => drumById.has(n.trackId) && n.pitch >= 0 && n.pitch <= 15)
    if (learnedIds) pool = pool.filter(n => learnedIds.includes(n.trackId))
    if (startMode === 'region' && regionMin !== null && regionMax !== null) {
      pool = pool.filter(n => n.time >= regionMin && n.time < regionMax)
    }
    return pool.map(n => ({ pitch: n.pitch, time: n.time, duration: n.duration, velocity: n.velocity / 127 }))
  }, [notes, drumById, learnedIds, startMode, regionMin, regionMax])

  const harmony = useMemo(() => {
    const pitched = notes.filter(n => {
      if (drumById.has(n.trackId)) return false
      return n.pitch >= 24 && n.pitch <= 108
    })
    return pitched.map(n => ({ pitch: n.pitch, time: n.time, duration: n.duration, velocity: n.velocity / 127 }))
  }, [notes, drumById])

  const pattern = useMemo(() => {
    if (!targetIsDrum) return null
    return generateDrumPattern({
      settings,
      startTick,
      meterMap,
      timeSignature,
      kit: destMode === 'new' ? kit : (activeTrack?.drumKit ?? kit),
      allowedPads,
      learned,
      harmony,
      snapTicks: snapResolution,
    })
  }, [settings, startTick, meterMap, timeSignature, destMode, kit, activeTrack, allowedPads, learned, harmony, snapResolution, targetIsDrum])

  const endTick = useMemo(() => {
    if (!pattern) return startTick + 1
    const last = pattern.hits.reduce((max, hit) => Math.max(max, hit.time + hit.duration), startTick)
    const lastWindow = pattern.windows[pattern.windows.length - 1]
    return Math.max(last, lastWindow?.end ?? startTick + 1, startTick + 1)
  }, [pattern, startTick])

  const resolvedStyle = resolveDrumStyle(settings.style, destMode === 'new' ? kit : (activeTrack?.drumKit ?? kit))
  const styleInfo = DRUM_STYLES.find(info => info.id === settings.style) ?? DRUM_STYLES[0]
  const resolvedInfo = DRUM_STYLES.find(info => info.id === resolvedStyle) ?? DRUM_STYLES[0]
  const gridLabel = snapResolution > 0 && GENERATIVE_PPQ % snapResolution === 0 ? `1/${GENERATIVE_PPQ / snapResolution}` : `${snapResolution} ticks`
  const padCount = pattern ? new Set(pattern.hits.map(hit => hit.pitch)).size : 0

  const changeStyle = (style: DrumStyleId) => update({ style })

  const rollVariation = () => update({ variation: Math.floor(Math.random() * 999999) })

  const armRegion = () => {
    setStartMode('region')
    setRegionPickMode(true)
    showToast('Drag across the timeline to set the start and the learn span.', 'info')
  }

  const applyPattern = () => {
    if (!pattern || pattern.hits.length === 0) {
      showToast('Nothing to apply — this setting produced no hits.', 'info')
      return
    }
    if (destMode === 'current' && !activeIsDrum) {
      showToast('The active track is not a drum track. Choose New Drum Track.', 'info')
      return
    }

    commitHistory()

    let targetId = activeTrackId
    if (destMode === 'new' || !targetId) {
      targetId = newId()
      const baseName = trackName.trim() || `${resolvedInfo.label} Drums ${new Date().toISOString().slice(11, 19)}`
      addTrack({
        id: targetId,
        name: baseName,
        instrument: 'drum',
        color: ACCENT,
        drumKit: kit,
        volume: activeTrack?.volume ?? 1,
        pan: 0,
        muted: false,
        soloed: false,
      })
      audioEngine.createInstrument(targetId, 'drum')
      audioEngine.setTrackDrumKit(targetId, kit)
    }
    if (!targetId) return

    if (destMode === 'current' && writeMode === 'replace') {
      const spanStart = Math.min(...pattern.hits.map(hit => hit.time))
      const spanEnd = Math.max(...pattern.hits.map(hit => hit.time + hit.duration))
      const overlapping = notes.filter(n =>
        n.trackId === targetId && n.time < spanEnd && n.time + n.duration > spanStart
      )
      if (overlapping.length > 0) removeNotes(overlapping.map(n => n.id))
    }

    addNotes(pattern.hits.map(hit => ({
      id: `drumgen-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      trackId: targetId as string,
      time: Math.round(hit.time),
      duration: Math.max(6, Math.round(hit.duration)),
      pitch: Math.round(hit.pitch),
      velocity: Math.max(1, Math.min(127, Math.round(hit.velocity * 127))),
    })))

    if (destMode === 'new') setActiveTrackId(targetId)

    const harmonyNote = pattern.harmonyChangeBars.length > 0 ? ` · ${pattern.harmonyChangeBars.length} harmony accent bar${pattern.harmonyChangeBars.length === 1 ? '' : 's'}` : ''
    const fillBar = pattern.hits.some(hit => hit.role === 'tom') ? ' · fill placed' : ''
    showToast(`Dropped ${pattern.hits.length} hits across ${pattern.windows.length} bar${pattern.windows.length === 1 ? '' : 's'} in ${resolvedInfo.label}${harmonyNote}${fillBar}.`, 'success')
  }

  const randomizeAll = () => {
    const rand = (min: number, max: number) => min + Math.random() * (max - min)
    const styles = DRUM_STYLES.filter(info => info.id !== 'auto').map(info => info.id)
    update({
      variation: Math.floor(Math.random() * 999999),
      style: settings.style === 'auto' ? 'auto' : styles[Math.floor(Math.random() * styles.length)],
      density: rand(0.4, 0.95),
      syncopation: rand(0.1, 0.7),
      ghost: rand(0.05, 0.6),
      fills: rand(0.2, 0.9),
      energy: rand(0.3, 0.9),
      swing: rand(0, 0.35),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Style */}
      <div style={PANEL}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px', background: 'rgba(0,0,0,0.4)', padding: '3px', borderRadius: '6px' }}>
          {DRUM_STYLES.map(info => (
            <button
              key={info.id}
              onClick={() => changeStyle(info.id)}
              title={info.hint}
              style={{ ...chipStyle(settings.style === info.id, ACCENT), padding: '5px 2px' }}
            >
              {info.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: '8px', fontSize: '10px', color: '#8b92a5', lineHeight: 1.45 }}>
          {settings.style === 'auto' ? `${styleInfo.hint} Currently resolving to ${resolvedInfo.label}.` : styleInfo.hint}
        </div>
      </div>

      {/* Groove source */}
      <div style={CARD}>
        {sectionTitle('Groove Source')}
        <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px' }}>
          <button onClick={() => setSourceMode('active')} style={chipStyle(sourceMode === 'active')}>Active</button>
          <button onClick={() => setSourceMode('selected')} style={chipStyle(sourceMode === 'selected')}>Selected</button>
          <button onClick={() => setSourceMode('all')} style={chipStyle(sourceMode === 'all')}>All Drums</button>
          <button onClick={() => setSourceMode('none')} style={chipStyle(sourceMode === 'none')}>None</button>
        </div>

        <SliderRow
          label="Learned"
          value={settings.learnedBlend}
          min={0}
          max={1}
          suffix="%"
          color="#4dabf7"
          onChange={v => update({ learnedBlend: Math.max(0, Math.min(1, v)) })}
        />
        <div style={{ fontSize: '9px', color: '#666', lineHeight: 1.4, marginBottom: '5px' }}>
          0% invents every hit, 100% replays the {learned.length} hit{learned.length === 1 ? '' : 's'} in the
          {sourceMode === 'all' ? ' all-drums source' : sourceMode === 'selected' ? ' selected source' : sourceMode === 'active' ? ' active source' : ' empty source'} — in between, learned hits keep the groove and invented lanes fill around them.
        </div>

        <ToggleRow
          label="Follow Harmony"
          hint={settings.followHarmony ? `${harmony.length} pitched notes read` : 'off'}
          active={settings.followHarmony}
          onClick={() => update({ followHarmony: !settings.followHarmony })}
          title="Crash on chord changes and answer the bassline's low notes with a kick"
        />

        {settings.followHarmony && harmony.length === 0 && (
          <div style={{ marginTop: '5px', fontSize: '9px', color: '#ffc9c9', lineHeight: 1.4 }}>
            No pitched notes in the project yet, so harmony accents have nothing to follow.
          </div>
        )}
        {settings.learnedBlend > 0 && learned.length === 0 && (
          <div style={{ marginTop: '5px', fontSize: '9px', color: '#ffc9c9', lineHeight: 1.4 }}>
            This source has no drum hits. The blend falls back to invented lanes.
          </div>
        )}
      </div>

      {/* Destination + placement */}
      <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: '7px' }}>
        <div>
          {sectionTitle('Destination')}
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px' }}>
            <button onClick={() => setDestMode('new')} style={chipStyle(destMode === 'new')}>New Drum Track</button>
            <button
              onClick={() => {
                if (!activeIsDrum) {
                  showToast('The active track is not a drum track. Pick New Drum Track, or select a drum channel first.', 'info')
                  return
                }
                setDestMode('current')
              }}
              style={{ ...chipStyle(destMode === 'current'), opacity: activeIsDrum ? 1 : 0.5 }}
              title={activeIsDrum ? 'Write onto the active drum channel' : 'Active track is not a drum channel'}
            >
              {activeTrack?.name ? `Into ${activeTrack.name}` : 'Current Track'}
            </button>
          </div>

          {destMode === 'new' ? (
            <div style={{ display: 'flex', gap: '4px', marginTop: '5px' }}>
              <input
                value={trackName}
                onChange={e => setTrackName(e.target.value)}
                placeholder={`${resolvedInfo.label} Drums`}
                style={{ ...inputStyle, flex: 1 }}
              />
              <select value={kit} onChange={e => setKit(e.target.value as DrumKit)} style={{ ...inputStyle, flex: '0 0 108px' }}>
                {KIT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px', marginTop: '5px' }}>
                <button onClick={() => setWriteMode('overdub')} style={chipStyle(writeMode === 'overdub')}>Overdub</button>
                <button onClick={() => setWriteMode('replace')} style={chipStyle(writeMode === 'replace')}>Replace Span</button>
              </div>
              <div style={{ fontSize: '9px', color: '#666', marginTop: '4px', lineHeight: 1.4 }}>
                Kit {activeTrack?.drumKit ?? kit} · {allowedPads.length} lane{allowedPads.length === 1 ? '' : 's'} on this channel.
              </div>
            </>
          )}
          {!targetIsDrum && (
            <div style={{ marginTop: '5px', padding: '6px 7px', borderRadius: '6px', background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.3)', fontSize: '9.5px', color: '#ffc9c9', lineHeight: 1.4 }}>
              Drums only write to a drum channel. Select a drum track, or use New Drum Track.
            </div>
          )}
        </div>

        <div>
          {sectionTitle('Start Position')}
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px' }}>
            <button onClick={() => setStartMode('playhead')} style={chipStyle(startMode === 'playhead')}>Playhead</button>
            <button onClick={armRegion} style={{ ...chipStyle(startMode === 'region', ACCENT), border: startMode === 'region' ? '1px solid rgba(255,146,43,0.35)' : '1px solid transparent' }}>
              {startMode === 'region' && regionPickMode ? 'Drag...' : 'Region'}
            </button>
            <button onClick={() => setStartMode('end')} style={chipStyle(startMode === 'end')}>End</button>
          </div>
          <div style={{ fontSize: '9px', color: '#666', marginTop: '4px', fontFamily: 'monospace' }}>
            starts at tick {startTick}{startMode === 'region' && regionMin !== null && regionMax !== null ? ` · region ${regionMax - regionMin} ticks` : ''}
          </div>
        </div>

        <SliderRow label="Bars" value={settings.bars} min={1} max={32} step={1} suffix="bars" onChange={v => update({ bars: Math.round(v) })} />
      </div>

      {/* Feel */}
      <div style={CARD}>
        {sectionTitle('Feel')}
        <SliderRow label="Density" value={settings.density} min={0.05} max={1} suffix="%" onChange={v => update({ density: v })} />
        <SliderRow label="Syncopate" value={settings.syncopation} min={0} max={1} suffix="%" color="#4dabf7" onChange={v => update({ syncopation: v })} />
        <SliderRow label="Ghosts" value={settings.ghost} min={0} max={1} suffix="%" color="#748ffc" onChange={v => update({ ghost: v })} />
        <SliderRow label="Fills" value={settings.fills} min={0} max={1} suffix="%" color="#da77f2" onChange={v => update({ fills: v })} />
        <SliderRow label="Energy Arc" value={settings.energy} min={0} max={1} suffix="%" color="#69db7c" onChange={v => update({ energy: v })} />
        <SliderRow label="Swing" value={settings.swing} min={0} max={1} suffix="%" color="#fab005" onChange={v => update({ swing: v })} />
        <SliderRow label="Humanize" value={settings.humanize} min={0} max={1} suffix="%" color="#00e6ff" onChange={v => update({ humanize: v })} />

        <div style={{ marginTop: '8px', paddingTop: '7px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <ToggleRow
            label="Grid Snap"
            hint={`hits land on ${gridLabel}`}
            active={settings.snap}
            onClick={() => update({ snap: !settings.snap })}
            title="Round hit times and lengths to the project grid"
          />
          <div style={{ fontSize: '9px', color: '#666', lineHeight: 1.4 }}>
            Off-beat open hats always get a closing hat two steps later, so chokes stay clean on and off the grid.
          </div>
        </div>
      </div>

      {/* Variation */}
      <div style={CARD}>
        {sectionTitle('Variation')}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            type="number"
            value={settings.variation}
            onChange={e => update({ variation: parseInt(e.target.value, 10) || 0 })}
            style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }}
          />
          <button onClick={rollVariation} style={{ ...chipStyle(true, ACCENT), flex: '0 0 auto', padding: '4px 10px', background: 'rgba(255,146,43,0.16)', border: '1px solid rgba(255,146,43,0.3)' }}>Roll</button>
        </div>
        <div style={{ fontSize: '9px', color: '#666', marginTop: '5px', lineHeight: 1.4 }}>
          Same number, same groove. Roll for a new take without losing your settings.
        </div>
      </div>

      {/* Preview */}
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: ACCENT }}>Preview</span>
          <span style={{ fontSize: '9px', color: '#888', fontWeight: 600 }}>
            {pattern ? `${pattern.hits.length} hits · ${padCount} pads · ${resolvedInfo.label}` : 'needs a drum channel'}
          </span>
        </div>

        {pattern ? (
          <DrumGridPreview pattern={pattern} startTick={startTick} endTick={endTick} labelFor={padLabel} />
        ) : (
          <div style={{ height: '76px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', background: 'rgba(0,0,0,0.35)', border: '1px dashed rgba(255,255,255,0.08)', color: '#666', fontSize: '10px', textAlign: 'center', padding: '0 12px' }}>
            Select a drum channel or switch to New Drum Track.
          </div>
        )}

        <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
          <button
            onClick={applyPattern}
            disabled={!pattern || pattern.hits.length === 0}
            style={{
              flex: 1,
              padding: '7px 8px',
              borderRadius: '6px',
              border: '1px solid rgba(255,146,43,0.35)',
              background: 'rgba(255,146,43,0.16)',
              color: pattern && pattern.hits.length > 0 ? '#ffc078' : '#666',
              fontSize: '10.5px',
              fontWeight: 800,
              cursor: pattern && pattern.hits.length > 0 ? 'pointer' : 'not-allowed',
              opacity: pattern && pattern.hits.length > 0 ? 1 : 0.5,
            }}
          >
            Apply to {destMode === 'new' ? 'New Drum Track' : (activeTrack?.name ?? 'Current Track')}
          </button>
          <button
            onClick={randomizeAll}
            title="Roll a new variation and randomise the feel"
            style={{ flex: '0 0 auto', padding: '7px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#aaa', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
          >
            Surprise
          </button>
        </div>
      </div>
    </div>
  )
}
