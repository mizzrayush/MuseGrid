import React, { useMemo, useState } from 'react'
import { useStore, deduplicateNotes, isPluginDrum, isPluginSynth, getPluginInstrumentType, type Note, type FxInstance, type CustomFxConfig } from '../engine/store'
import { SYNTH_PRESETS, DRUM_KITS, type SynthPreset, type DrumKit } from '../utils/instruments'
import { audioEngine } from '../engine/AudioEngine'
import { NOTE_FX_DEFAULTS } from '../utils/noteFxChain'
import { NOTE_NAMES_SHARP, snapToScale, detectChord, detectScaleDegree } from '../utils/musicTheory'
import { applyRatchet, applyMicroNudge } from '../utils/midiEditing'
import { IconX, IconVolume, IconTimeline, IconMusic, IconDrum, IconSpeaker, IconTrash, IconPlus } from './Icons'

const PITCH_TO_PIECE: Record<number, string> = {
  0: 'Kick', 1: 'Snare', 2: 'Hihat Closed', 3: 'Hihat Open', 4: 'Clap',
  5: 'Tom Low', 6: 'Tom Mid', 7: 'Tom High', 8: 'Crash', 9: 'Ride',
  10: 'Cowbell', 11: 'Tambourine', 12: 'Conga Low', 13: 'Conga High', 14: 'Claves', 15: 'Rimshot'
}

const getNoteName = (p: number) => {
  const octave = Math.floor(p / 12) - 1
  const name = NOTE_NAMES_SHARP[p % 12]
  return `${name}${octave}`
}

const getDrumTunedName = (pitch: number, offset: number, kit?: DrumKit): string => {
  let baseMidi = 24
  if (pitch === 0) baseMidi = kit === 'eightOhEight' ? 21 : kit === 'tabla' ? 43 : 24
  else if (pitch === 5) baseMidi = 31
  else if (pitch === 6) baseMidi = 36
  else if (pitch === 7) baseMidi = 40
  else if (pitch === 10) baseMidi = 67
  else if (pitch === 12) baseMidi = 40
  else if (pitch === 13) baseMidi = 43
  else if (pitch === 14) baseMidi = 60
  else return offset === 0 ? 'Standard' : `${offset > 0 ? '+' : ''}${offset} st`

  const baseStr = getNoteName(baseMidi)
  const tunedStr = getNoteName(baseMidi + offset)
  return `${baseStr} → ${tunedStr} (${offset >= 0 ? '+' : ''}${offset}st)`
}
interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  color?: string
  suffix?: string
  onChange: (value: number) => void
}

const SliderRow: React.FC<SliderRowProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  color = '#4dabf7',
  suffix = '',
  onChange,
}) => {
  const [inputValue, setInputValue] = useState(value.toString())
  const [prevValue, setPrevValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!isFocused) {
      setInputValue(Number.isInteger(value) ? value.toString() : value.toFixed(2))
    }
  }

  const progress = ((value - min) / (max - min)) * 100
  const progressStr = `${Math.max(0, Math.min(100, progress))}%`

  const handleCommit = () => {
    const val = parseFloat(inputValue)
    if (!isNaN(val)) {
      onChange(val)
    } else {
      setInputValue(value.toString())
    }
  }

  return (
    <div style={{ marginBottom: '8px' }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', color: '#aaa' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <input
            type="text"
            value={inputValue}
            onFocus={() => setIsFocused(true)}
            onBlur={() => { setIsFocused(false); handleCommit() }}
            onChange={e => setInputValue(e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            onMouseUp={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            style={{
              fontSize: '10px',
              color,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '4px',
              width: '42px',
              textAlign: 'right',
              outline: 'none',
              padding: '1px 4px',
              cursor: 'text',
              transition: 'all 0.2s',
              borderColor: isFocused ? color : 'rgba(255,255,255,0.08)',
              boxShadow: isFocused ? `0 0 8px ${color}33` : 'none'
            }}
          />
          {suffix && <span style={{ fontSize: '10px', color, marginLeft: '2px', opacity: 0.8 }}>{suffix}</span>}
        </div>
      </div>
      <input
        className="modern-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, value))}
        onChange={e => onChange(+e.target.value)}
        style={{
          width: '100%',
          margin: 0,
          '--slider-color': color,
          '--slider-progress': progressStr,
          accentColor: color
        } as React.CSSProperties & Record<string, string | number>}
      />
    </div>
  )
}

interface SelectRowProps {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}

const NOTE_FX_INFO: Record<string, { label: string; color: string }> = {
  eq: { label: 'EQ (Equalizer)', color: '#69db7c' },
  distortion: { label: 'Distortion (Drive)', color: '#ff6b6b' },
  chorus: { label: 'Chorus', color: '#da77f2' },
  phaser: { label: 'Phaser', color: '#00e6ff' },
  delay: { label: 'Delay (Echo)', color: '#74c0fc' },
  dpreverb: { label: 'DPreverb (Pre-Wash)', color: '#22d3ee' },
  reverb: { label: 'Reverb (Space)', color: '#b197fc' },
  freeverb: { label: 'Freeverb (Live Space)', color: '#e599f7' }
}

interface NoteFxChainSectionProps {
  notes: Note[]
  selectedNoteIds: string[]
  vst3FxPlugins: any[]
  customFxConfigs: CustomFxConfig[]
}

/**
 * Per-note FX override. An empty chain keeps the track rack; once an effect is added the
 * note renders through this chain instead, matching the track card's sleeve and cards.
 */
const NoteFxChainSection: React.FC<NoteFxChainSectionProps> = ({ notes, selectedNoteIds, vst3FxPlugins, customFxConfigs }) => {
  const commitHistory = useStore(state => state.commitHistory)
  const updateNotes = useStore(state => state.updateNotes)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  if (notes.length === 0) return null

  const first = notes[0]
  const instances = first.fxInstances ?? []
  const settings = first.fxSettings ?? {}
  const mixed = notes.some(n => JSON.stringify(n.fxInstances ?? []) !== JSON.stringify(instances))
  const title = mixed ? 'Mixed note chains' : instances.length > 0 ? `${instances.length} effect${instances.length === 1 ? '' : 's'}` : 'Track rack applies'

  const commit = (nextInstances: FxInstance[], nextSettings: Record<string, Record<string, number>>) => {
    commitHistory()
    updateNotes(selectedNoteIds, {
      fxInstances: nextInstances.length > 0 ? nextInstances : undefined,
      fxSettings: nextInstances.length > 0 ? nextSettings : undefined
    })
    audioEngine.syncNoteVst3Overrides()
  }

  const setValue = (instId: string, key: string, value: number) => {
    const next = JSON.parse(JSON.stringify(settings)) as Record<string, Record<string, number>>
    next[instId] = { ...(next[instId] || {}), [key]: value }
    updateNotes(selectedNoteIds, { fxSettings: next })
  }

  const addEffect = (value: string) => {
    if (!value) return
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    let inst: FxInstance
    if (value.startsWith('vst3:')) {
      const pluginId = value.slice(5)
      const plugin = vst3FxPlugins.find(p => String(p.fileOrIdentifier) === pluginId || String(p.uniqueId) === pluginId)
      inst = {
        id: `vst3_${id}`,
        type: 'vst3',
        pluginId: plugin?.fileOrIdentifier || pluginId,
        pluginName: plugin?.name || 'VST3 Effect'
      }
    } else {
      inst = { id: `${value}_${id}`, type: value }
    }
    const nextSettings = { ...settings, [inst.id]: inst.type === 'vst3' ? { wet: 0.4, bypassed: 0 } : { ...NOTE_FX_DEFAULTS[inst.type] } }
    commit([...instances, inst], nextSettings)
    useStore.getState().showToast(`Added ${inst.type === 'vst3' ? (inst.pluginName || 'VST3') : (NOTE_FX_INFO[inst.type]?.label || inst.type)} to note`, 'success')
  }

  const get = (inst: FxInstance, key: string, fallback = 0) => {
    const stored = settings[inst.id]?.[key]
    if (typeof stored === 'number' && isFinite(stored)) return stored
    return NOTE_FX_DEFAULTS[inst.type]?.[key] ?? fallback
  }

  const renderControls = (inst: FxInstance) => {
    const update = (key: string, value: number) => setValue(inst.id, key, value)
    switch (inst.type) {
      case 'eq':
        return (
          <>
            <SliderRow label="Low EQ" value={get(inst, 'lowGain')} min={-12} max={12} step={0.5} suffix="dB" color="#69db7c" onChange={v => update('lowGain', v)} />
            <SliderRow label="Mid EQ" value={get(inst, 'midGain')} min={-12} max={12} step={0.5} suffix="dB" color="#ffd43b" onChange={v => update('midGain', v)} />
            <SliderRow label="High EQ" value={get(inst, 'highGain')} min={-12} max={12} step={0.5} suffix="dB" color="#ff8787" onChange={v => update('highGain', v)} />
          </>
        )
      case 'distortion':
        return (
          <>
            <SliderRow label="Drive" value={get(inst, 'wet')} min={0} max={1} step={0.01} color="#ff6b6b" onChange={v => update('wet', v)} />
            <SliderRow label="Grit" value={get(inst, 'amount', 0.4)} min={0} max={1} step={0.01} color="#ff6b6b" onChange={v => update('amount', v)} />
          </>
        )
      case 'chorus':
        return (
          <>
            <SliderRow label="Chorus" value={get(inst, 'wet')} min={0} max={1} step={0.01} color="#da77f2" onChange={v => update('wet', v)} />
            <SliderRow label="C-Rate" value={get(inst, 'frequency', 1.5)} min={0.1} max={10} step={0.1} suffix="Hz" color="#da77f2" onChange={v => update('frequency', v)} />
            <SliderRow label="C-Depth" value={get(inst, 'depth', 0.7)} min={0} max={1} step={0.01} color="#da77f2" onChange={v => update('depth', v)} />
            <SliderRow label="C-Delay" value={get(inst, 'delayTime', 3.5)} min={0.1} max={20} step={0.1} suffix="ms" color="#da77f2" onChange={v => update('delayTime', v)} />
          </>
        )
      case 'phaser':
        return (
          <>
            <SliderRow label="Phaser" value={get(inst, 'wet')} min={0} max={1} step={0.01} color="#00e6ff" onChange={v => update('wet', v)} />
            <SliderRow label="P-Rate" value={get(inst, 'frequency', 0.5)} min={0.1} max={10} step={0.1} suffix="Hz" color="#00e6ff" onChange={v => update('frequency', v)} />
            <SliderRow label="P-BaseFreq" value={get(inst, 'baseFreq', 350)} min={20} max={4000} step={10} suffix="Hz" color="#00e6ff" onChange={v => update('baseFreq', v)} />
          </>
        )
      case 'delay':
        return (
          <>
            <SliderRow label="Delay" value={get(inst, 'wet')} min={0} max={1} step={0.01} color="#74c0fc" onChange={v => update('wet', v)} />
            <SliderRow label="D-Time" value={get(inst, 'time', 0.25)} min={0.01} max={2} step={0.01} suffix="s" color="#74c0fc" onChange={v => update('time', v)} />
            <SliderRow label="Feedback" value={get(inst, 'feedback', 0.25)} min={0} max={0.9} step={0.01} color="#74c0fc" onChange={v => update('feedback', v)} />
          </>
        )
      case 'dpreverb':
        return (
          <>
            <SliderRow label="DPreverb" value={get(inst, 'wet')} min={0} max={1} step={0.01} color="#22d3ee" onChange={v => update('wet', v)} />
            <SliderRow label="Tail (s)" value={get(inst, 'tail', 2)} min={0} max={120} step={0.1} suffix="s" color="#22d3ee" onChange={v => update('tail', v)} />
            <SliderRow label="Shape" value={get(inst, 'decay', 0.65)} min={0.05} max={1} step={0.01} color="#5eead4" onChange={v => update('decay', v)} />
            <SliderRow label="Tone" value={get(inst, 'tone', 0.55)} min={0} max={1} step={0.01} color="#67e8f9" onChange={v => update('tone', v)} />
          </>
        )
      case 'reverb':
        return (
          <>
            <SliderRow label="Reverb" value={get(inst, 'wet')} min={0} max={1} step={0.01} color="#b197fc" onChange={v => update('wet', v)} />
            <SliderRow label="R-Decay" value={get(inst, 'decay', 2.5)} min={0.1} max={10} step={0.1} suffix="s" color="#b197fc" onChange={v => update('decay', v)} />
          </>
        )
      case 'freeverb':
        return (
          <>
            <SliderRow label="Freeverb" value={get(inst, 'wet')} min={0} max={1} step={0.01} color="#e599f7" onChange={v => update('wet', v)} />
            <SliderRow label="F-Room" value={get(inst, 'roomSize', 0.7)} min={0} max={1} step={0.01} color="#e599f7" onChange={v => update('roomSize', v)} />
            <SliderRow label="F-Damp" value={get(inst, 'dampening', 4000)} min={0} max={20000} step={100} suffix="Hz" color="#e599f7" onChange={v => update('dampening', v)} />
          </>
        )
      case 'vst3':
        return (
          <SliderRow
            label="Mix (Wet)"
            value={get(inst, 'wet', 0.4)}
            min={0}
            max={1}
            step={0.01}
            color="#00ff88"
            onChange={v => update('wet', v)}
          />
        )
      default: {
        const config = customFxConfigs.find(c => c.id === inst.type)
        if (!config) return null
        return (
          <>
            {config.params.map(p => (
              <SliderRow
                key={p.name}
                label={p.label || p.name}
                value={settings[inst.id]?.[p.name] ?? p.defaultVal}
                min={p.min}
                max={p.max}
                step={p.max - p.min <= 2 ? 0.01 : 0.1}
                color={config.mode === 'offline' ? '#22d3ee' : '#74c0fc'}
                onChange={v => update(p.name, v)}
              />
            ))}
          </>
        )
      }
    }
  }

  return (
    <details style={{ marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <summary style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', userSelect: 'none', outline: 'none', listStyle: 'none' }}>
        <span>Note Effects Override</span>
        <span style={{ fontSize: '9px', fontWeight: 800, color: instances.length > 0 ? '#00e6ff' : '#555', letterSpacing: '0.05em' }}>
          {title}
        </span>
      </summary>

      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {mixed && (
          <div style={{ fontSize: '9px', color: '#ffcc00', lineHeight: 1.4 }}>
            Selected notes use different chains. Adding or removing an effect applies this chain to all of them.
          </div>
        )}

        {instances.map((inst, index) => {
          const isDragging = draggingIndex === index
          const isOver = dragOverIndex === index
          const isBypassed = (settings[inst.id]?.bypassed ?? 0) > 0.5
          const info = inst.type === 'vst3'
            ? { label: inst.pluginName ? `${inst.pluginName} (VST3)` : 'VST3 Effect', color: '#00ff88' }
            : NOTE_FX_INFO[inst.type] || { label: customFxConfigs.find(c => c.id === inst.type)?.name || inst.type, color: '#74c0fc' }

          return (
            <div
              key={inst.id}
              draggable
              onDragStart={e => { setDraggingIndex(index); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={e => { e.preventDefault(); if (dragOverIndex !== index) setDragOverIndex(index) }}
              onDragLeave={() => { if (dragOverIndex === index) setDragOverIndex(null) }}
              onDrop={e => {
                e.preventDefault()
                if (draggingIndex !== null && draggingIndex !== index) {
                  const next = [...instances]
                  const [moved] = next.splice(draggingIndex, 1)
                  next.splice(index, 0, moved)
                  commit(next, settings)
                }
                setDraggingIndex(null)
                setDragOverIndex(null)
              }}
              onDragEnd={() => { setDraggingIndex(null); setDragOverIndex(null) }}
              style={{
                background: isOver ? 'rgba(77, 171, 247, 0.12)' : isBypassed ? 'rgba(15, 17, 24, 0.45)' : 'rgba(255, 255, 255, 0.02)',
                border: `1px solid ${isOver ? '#4dabf7' : isBypassed ? 'rgba(255, 51, 102, 0.25)' : 'rgba(255, 255, 255, 0.05)'}`,
                borderRadius: '6px',
                padding: '8px 10px 10px',
                opacity: isDragging ? 0.4 : isBypassed ? 0.6 : 1,
                cursor: 'grab',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', userSelect: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '10px', fontWeight: 'bold', cursor: 'grab' }}>⋮⋮</span>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setValue(inst.id, 'bypassed', isBypassed ? 0 : 1)
                      audioEngine.syncNoteVst3Overrides()
                    }}
                    title={isBypassed ? `Turn ${info.label} ON` : `Bypass ${info.label}`}
                    style={{
                      padding: '2px 6px',
                      borderRadius: '3px',
                      border: `1px solid ${isBypassed ? '#ff3366' : '#00ff88'}`,
                      background: isBypassed ? 'rgba(255, 51, 102, 0.15)' : 'rgba(0, 255, 136, 0.15)',
                      color: isBypassed ? '#ff3366' : '#00ff88',
                      fontSize: '8px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      lineHeight: '1'
                    }}
                  >
                    {isBypassed ? 'OFF' : 'ON'}
                  </button>
                  <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: isBypassed ? '#777' : info.color, textDecoration: isBypassed ? 'line-through' : 'none' }}>
                    {info.label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    onClick={() => {
                      const copy: FxInstance = { ...inst, id: `${inst.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
                      const next = [...instances]
                      next.splice(index + 1, 0, copy)
                      commit(next, { ...settings, [copy.id]: { ...(settings[inst.id] || {}) } })
                    }}
                    title="Duplicate Effect"
                    style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#aaa', padding: '2px 5px', borderRadius: '3px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    <IconPlus size={10} />
                  </button>
                  <button
                    onClick={() => {
                      const nextSettings = { ...settings }
                      delete nextSettings[inst.id]
                      commit(instances.filter(i => i.id !== inst.id), nextSettings)
                    }}
                    title="Delete Effect"
                    style={{ background: 'rgba(255,68,68,0.1)', border: 'none', color: '#ff4444', padding: '2px 5px', borderRadius: '3px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    <IconX size={10} />
                  </button>
                  <span style={{ fontSize: '7.5px', color: 'rgba(255,255,255,0.2)', fontWeight: 700 }}>
                    STEP {index + 1}/{instances.length}
                  </span>
                </div>
              </div>
              <div style={{ cursor: 'default' }} onMouseDown={e => e.stopPropagation()}>
                {renderControls(inst)}
              </div>
            </div>
          )
        })}

        <select
          value=""
          onChange={e => addEffect(e.target.value)}
          onMouseDown={e => e.stopPropagation()}
          style={{
            width: '100%',
            background: '#12141c',
            border: '1px solid rgba(0, 230, 255, 0.3)',
            color: '#00e6ff',
            fontSize: '10px',
            padding: '5px 8px',
            borderRadius: '6px',
            outline: 'none',
            cursor: 'pointer',
            colorScheme: 'dark'
          }}
        >
          <option value="" style={{ background: '#12141c', color: '#8b92a5' }}>+ Add Effect to Note Chain...</option>
          {vst3FxPlugins.length > 0 && (
            <optgroup label="── VST3 EFFECTS ──" style={{ background: '#0a0b10', color: '#00ff88', fontWeight: 800 }}>
              {vst3FxPlugins.map(plugin => (
                <option key={plugin.uniqueId} value={`vst3:${plugin.fileOrIdentifier || plugin.uniqueId}`} style={{ background: '#12141c', color: '#00ff88' }}>
                  {plugin.name} {plugin.category ? `(${plugin.category})` : ''}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="── BUILT-IN EFFECTS ──" style={{ background: '#0a0b10', color: '#888', fontWeight: 800 }}>
            {Object.entries(NOTE_FX_INFO).map(([type, info]) => (
              <option key={type} value={type} style={{ background: '#12141c', color: info.color }}>
                {info.label}
              </option>
            ))}
          </optgroup>
          {customFxConfigs.length > 0 && (
            <optgroup label="── CUSTOM JS FX ──" style={{ background: '#0a0b10', color: '#bf5af2', fontWeight: 800 }}>
              {customFxConfigs.map(c => (
                <option key={c.id} value={c.id} style={{ background: '#12141c', color: '#bf5af2' }}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {instances.length > 0 && (
          <button
            onClick={() => commit([], {})}
            style={{
              alignSelf: 'flex-end',
              background: 'transparent',
              border: 'none',
              color: '#ff3366',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 700,
              padding: 0
            }}
          >
            Clear Note Chain
          </button>
        )}
      </div>
    </details>
  )
}

const SelectRow: React.FC<SelectRowProps> = ({ label, value, options, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
    <span style={{ fontSize: '11px', color: '#aaa' }}>{label}</span>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onMouseDown={e => e.stopPropagation()}
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'white',
        fontSize: '11px',
        fontWeight: 600,
        borderRadius: '6px',
        padding: '6px 10px',
        outline: 'none',
        cursor: 'pointer'
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ background: '#12141c', color: 'white' }}>{o.label}</option>
      ))}
    </select>
  </div>
)

export const RightPane: React.FC = () => {
  const selectedNoteIds = useStore(state => state.selectedNoteIds)
  const notes = useStore(state => state.notes)
  const tracks = useStore(state => state.tracks)
  const voicePresets = useStore(state => state.voicePresets)
  const vst3Plugins = useStore(state => state.vst3Plugins || [])
  const vst3ActivePluginIds = useStore(state => state.vst3ActivePluginIds || [])
  const vst3DrumTags = useStore(state => state.vst3DrumTags || {})
  const customFxConfigs = useStore(state => state.customFxConfigs || [])
  const activeTrackId = useStore(state => state.activeTrackId)
  const scaleLock = useStore(state => state.scaleLock)
  const scaleLockEnabled = scaleLock.enabled
  const scaleLockRoot = scaleLock.root
  const scaleLockMode = scaleLock.mode
  const snapResolution = useStore(state => state.snapResolution)
  const noteInspectorEnabled = useStore(state => state.noteInspectorEnabled)
  const isRightPaneVisible = useStore(state => state.isRightPaneVisible)
  const deduplicateOverlapThreshold = useStore(state => state.deduplicateOverlapThreshold)
  const deduplicateProximityTolerance = useStore(state => state.deduplicateProximityTolerance)
  const glideStyle = useStore(state => state.glideStyle)

  const updateNotes = useStore(state => state.updateNotes)
  const removeNotes = useStore(state => state.removeNotes)
  const setDeduplicateOverlapThreshold = useStore(state => state.setDeduplicateOverlapThreshold)
  const setDeduplicateProximityTolerance = useStore(state => state.setDeduplicateProximityTolerance)
  const commitHistory = useStore(state => state.commitHistory)

  // Find all selected notes
  const selectedNotes = useMemo(() => {
    return notes.filter(n => selectedNoteIds.includes(n.id))
  }, [notes, selectedNoteIds])

  // If no selected notes, or if inspector is disabled from left pane, or if the user hasn't explicitly opened it, the pane is hidden
  const isOpen = selectedNotes.length > 0 && noteInspectorEnabled && isRightPaneVisible

  // Calculate common properties or mixed flags
  const isSingle = selectedNotes.length === 1
  const firstNote = selectedNotes[0]

  const activeTrack = useMemo(() => tracks.find(t => t.id === activeTrackId), [tracks, activeTrackId])
  const isDrum = activeTrack?.instrument === 'drum'

  // Chord Detective analysis
  const detectedChordInfo = useMemo(() => {
    if (isDrum || selectedNotes.length === 0) return null
    const pitches = selectedNotes.map(n => n.pitch)
    const chord = detectChord(pitches)
    if (!chord) return null

    const degree = detectScaleDegree(chord.rootPitch, scaleLock.root, scaleLock.mode)
    return {
      ...chord,
      degree
    }
  }, [selectedNotes, isDrum, scaleLock])

  // Drum Piece Distribution analysis
  const drumDistribution = useMemo(() => {
    if (!isDrum || selectedNotes.length === 0) return null
    const counts: Record<string, number> = {}
    selectedNotes.forEach(n => {
      const pieceName = PITCH_TO_PIECE[n.pitch] || `Pad ${n.pitch}`
      counts[pieceName] = (counts[pieceName] || 0) + 1
    })
    return counts
  }, [selectedNotes, isDrum])

  const handleRatchet = (slices: number, curve: 'flat' | 'crescendo' | 'decrescendo' = 'flat') => {
    if (selectedNotes.length === 0) return
    commitHistory()
    const targetIdSet = new Set(selectedNotes.map(n => n.id))
    const untouched = notes.filter(n => !targetIdSet.has(n.id))
    const ratcheted = applyRatchet(selectedNotes, slices, curve)
    useStore.setState({
      notes: deduplicateNotes([...untouched, ...ratcheted]),
      selectedNoteIds: ratcheted.map(n => n.id)
    })
    useStore.getState().showToast(`Subdivided into ${slices}x Ratchet Roll`, 'success')
  }

  const handleNudge = (ticks: number) => {
    if (selectedNotes.length === 0) return
    commitHistory()
    const targetIdSet = new Set(selectedNotes.map(n => n.id))
    const untouched = notes.filter(n => !targetIdSet.has(n.id))
    const nudged = applyMicroNudge(selectedNotes, ticks)
    useStore.setState({
      notes: deduplicateNotes([...untouched, ...nudged]),
      selectedNoteIds: nudged.map(n => n.id)
    })
    useStore.getState().showToast(`Nudged ${ticks > 0 ? '+' : ''}${ticks}t`, 'success')
  }

  const commonLyric = useMemo(() => {
    if (selectedNotes.length === 0 || !firstNote) return ''
    const ly = firstNote.lyric || ''
    return selectedNotes.every(n => (n.lyric || '') === ly) ? ly : 'Mixed'
  }, [selectedNotes, firstNote])

  const commonVoicePresetId = useMemo(() => {
    if (selectedNotes.length === 0 || !firstNote) return ''
    const vpid = firstNote.voicePresetId || ''
    return selectedNotes.every(n => (n.voicePresetId || '') === vpid) ? vpid : 'mixed'
  }, [selectedNotes, firstNote])

  const hasVocalNote = useMemo(() => {
    return selectedNotes.some(n => {
      const track = tracks.find(t => t.id === n.trackId)
      return n.instrumentOverride === 'vocal' || (track?.instrument === 'synth' && track.synthPreset === 'vocal')
    })
  }, [selectedNotes, tracks])

  const commonTrackId = useMemo(() => {
    if (selectedNotes.length === 0 || !firstNote) return ''
    const tid = firstNote.trackId
    return selectedNotes.every(n => n.trackId === tid) ? tid : 'mixed'
  }, [selectedNotes, firstNote])

  const commonVelocity = useMemo(() => {
    if (selectedNotes.length === 0 || !firstNote) return 0
    const vel = firstNote.velocity
    return selectedNotes.every(n => n.velocity === vel) ? vel : -1
  }, [selectedNotes, firstNote])

  const commonOverride = useMemo(() => {
    if (selectedNotes.length === 0 || !firstNote) return undefined
    const ov = firstNote.instrumentOverride
    return selectedNotes.every(n => n.instrumentOverride === ov) ? ov : 'mixed'
  }, [selectedNotes, firstNote])

  const commonPitch = useMemo(() => {
    if (selectedNotes.length === 0 || !firstNote) return 0
    const pitch = firstNote.pitch
    return selectedNotes.every(n => n.pitch === pitch) ? pitch : -1
  }, [selectedNotes, firstNote])

  const commonDetune = useMemo(() => {
    if (selectedNotes.length === 0 || !firstNote) return 0
    const detune = firstNote.detune || 0
    return selectedNotes.every(n => (n.detune || 0) === detune) ? detune : 'mixed'
  }, [selectedNotes, firstNote])

  const commonPitchOffset = useMemo(() => {
    if (selectedNotes.length === 0 || !firstNote) return 0
    const offset = firstNote.pitchOffset ?? 0
    return selectedNotes.every(n => (n.pitchOffset ?? 0) === offset) ? offset : 'mixed'
  }, [selectedNotes, firstNote])

  // MPE Getters
  const getCommonMPE = (key: keyof Note, fallback: number): number | 'mixed' => {
    if (selectedNotes.length === 0 || !firstNote) return fallback
    const val = (firstNote[key] as number) ?? fallback
    return selectedNotes.every(n => ((n[key] as number) ?? fallback) === val) ? val : 'mixed'
  }

  const getCommonStringMPE = (key: keyof Note, fallback: string): string | 'mixed' => {
    if (selectedNotes.length === 0 || !firstNote) return fallback
    const val = (firstNote[key] as string) ?? fallback
    return selectedNotes.every(n => ((n[key] as string) ?? fallback) === val) ? val : 'mixed'
  }

  const commonVibratoDepth = getCommonMPE('vibratoDepth', 0)
  const commonVibratoRate = getCommonMPE('vibratoRate', 5)
  const commonTremoloDepth = getCommonMPE('tremoloDepth', 0)
  const commonTremoloRate = getCommonMPE('tremoloRate', 5)
  const commonPitchSlide = getCommonMPE('pitchSlide', 0)
  const commonPitchSlideTime = getCommonMPE('pitchSlideTime', 48)
  const commonPitchSlideRamp = getCommonStringMPE('pitchSlideRamp', 'linear')
  const commonPitchSlideCustomCurve = getCommonStringMPE('pitchSlideCustomCurve', 't * t')
  const commonGlideStyle = getCommonStringMPE('glideStyle', 'default')
  const commonVibratoDelay = getCommonMPE('vibratoDelay', 0)
  const commonVibratoFade = getCommonMPE('vibratoFade', 0)
  const commonVibratoWave = getCommonStringMPE('vibratoWave', 'sine')
  const commonTremoloWave = getCommonStringMPE('tremoloWave', 'sine')
  const commonFilterStart = getCommonMPE('filterStart', 20000)
  const commonFilterEnd = getCommonMPE('filterEnd', 20000)
  const commonFilterSweepTime = getCommonMPE('filterSweepTime', 48)
  const commonFilterSweepRamp = getCommonStringMPE('filterSweepRamp', 'linear')

  // A note-level choice overrides the track-wide glide style from the left pane.
  const effectiveSmooth = commonGlideStyle === 'mixed'
    ? true
    : commonGlideStyle === 'default'
      ? (glideStyle || 'smooth') === 'smooth'
      : commonGlideStyle === 'smooth'

  // Determine current active track instrument type
  const targetTrackId = commonTrackId !== 'mixed' ? commonTrackId : activeTrackId
  const currentTrack = tracks.find(t => t.id === targetTrackId)
  const trackType = currentTrack?.instrument || 'synth'

  const noteVst3Instruments = useMemo(() => {
    const activeSet = new Set((vst3ActivePluginIds || []).map(String))
    const isActive = (p: any) => activeSet.has(String(p.uniqueId)) || activeSet.has(String(p.fileOrIdentifier))
    return (vst3Plugins || []).filter(p =>
      p && p.isInstrument && isActive(p) &&
      (trackType === 'drum' ? isPluginDrum(p, vst3DrumTags) : isPluginSynth(p, vst3DrumTags))
    )
  }, [vst3Plugins, vst3ActivePluginIds, vst3DrumTags, trackType])

  const currentOverrideVst = useMemo(() => {
    if (typeof commonOverride !== 'string' || commonOverride === 'mixed' || !commonOverride.startsWith('vst3:')) return undefined
    const id = commonOverride.slice(5)
    return (vst3Plugins || []).find(p => String(p.fileOrIdentifier) === id || String(p.uniqueId) === id)
  }, [commonOverride, vst3Plugins])

  const vst3ActiveFx = useMemo(() => {
    const activeSet = new Set((vst3ActivePluginIds || []).map(String))
    return (vst3Plugins || []).filter(p => p && !p.isInstrument &&
      (activeSet.has(String(p.uniqueId)) || activeSet.has(String(p.fileOrIdentifier))))
  }, [vst3Plugins, vst3ActivePluginIds])

  // Edit Handlers
  const handleTrackChange = (newTrackId: string) => {
    if (newTrackId === 'mixed' || !newTrackId) return
    const targetTrack = tracks.find(t => t.id === newTrackId)
    if (!targetTrack) return

    useStore.setState(state => {
      const idSet = new Set(selectedNoteIds)
      const updatedNotes = state.notes.map(n => {
        if (!idSet.has(n.id)) return n

        const origTrack = state.tracks.find(t => t.id === n.trackId)
        const origType = origTrack?.instrument || 'synth'
        const targetType = targetTrack.instrument

        const updates: Partial<Note> = { trackId: newTrackId }

        if (origType === 'synth' && targetType === 'drum') {
          updates.pitch = Math.max(0, Math.min(15, n.pitch % 16))
          updates.instrumentOverride = undefined
        } else if (origType === 'drum' && targetType === 'synth') {
          updates.pitch = 60 + n.pitch
          updates.instrumentOverride = undefined
        }

        return { ...n, ...updates }
      })

      return {
        notes: deduplicateNotes(updatedNotes)
      }
    })
  }

  const handleVelocityChange = (vel: number) => {
    const clamped = Math.max(1, Math.min(127, vel))
    updateNotes(selectedNoteIds, { velocity: clamped, velocityInspectorModified: true })
  }

  const handleDetuneChange = (detune: number) => {
    updateNotes(selectedNoteIds, { detune })
  }

  const handleOverrideChange = (val: string) => {
    if (val === 'none') {
      updateNotes(selectedNoteIds, { instrumentOverride: undefined })
      return
    }
    if (val.startsWith('vst3:')) {
      const pluginId = val.slice(5)
      const plugin = vst3Plugins.find(p =>
        String(p.fileOrIdentifier) === pluginId || String(p.uniqueId) === pluginId || p.name === pluginId
      )
      const targetId = plugin?.fileOrIdentifier || plugin?.uniqueId || pluginId
      commitHistory()
      updateNotes(selectedNoteIds, { instrumentOverride: `vst3:${targetId}` })
      const trackIds = new Set(selectedNotes.map(n => n.trackId))
      trackIds.forEach(tid => audioEngine.ensureNoteVst3Instrument(tid, targetId))
      useStore.getState().showToast(`Note override: ${plugin?.name || targetId}`, 'success')
      return
    }
    const override = val as SynthPreset | DrumKit
    updateNotes(selectedNoteIds, { instrumentOverride: override })
  }

  const handlePitchChange = (pitch: number) => {
    if (trackType === 'synth') {
      let finalPitch = Math.max(12, Math.min(120, pitch))
      if (scaleLockEnabled && scaleLockRoot !== undefined && scaleLockMode) {
        finalPitch = snapToScale(finalPitch, scaleLockRoot, scaleLockMode, scaleLock.customIntervals)
      }
      updateNotes(selectedNoteIds, { pitch: finalPitch })
    } else {
      const finalPitch = Math.max(0, Math.min(15, pitch))
      updateNotes(selectedNoteIds, { pitch: finalPitch })
    }
  }

  const handleDrumPitchOffsetChange = (val: number) => {
    commitHistory()
    const clamped = Math.max(-24, Math.min(24, Math.round(val)))
    updateNotes(selectedNoteIds, { pitchOffset: clamped })
  }

  const handleDrumPitchOffsetStep = (delta: number) => {
    commitHistory()
    const targetIdSet = new Set(selectedNoteIds)
    const updatedNotes = notes.map(n => {
      if (targetIdSet.has(n.id)) {
        const curr = n.pitchOffset ?? 0
        const clamped = Math.max(-24, Math.min(24, curr + delta))
        return { ...n, pitchOffset: clamped }
      }
      return n
    })
    useStore.setState({ notes: updatedNotes })
  }

  const handleMPEChange = (key: keyof Note, value: any) => {
    updateNotes(selectedNoteIds, { [key]: value })
  }

  const handleTranspose = (semitones: number) => {
    // Shifts all selected notes by X semitones
    const newNotes = selectedNotes.map(n => {
      let newPitch = n.pitch + semitones
      if (trackType === 'synth') {
        newPitch = Math.max(12, Math.min(120, newPitch))
        if (scaleLockEnabled && scaleLockRoot !== undefined && scaleLockMode) {
          newPitch = snapToScale(newPitch, scaleLockRoot, scaleLockMode, scaleLock.customIntervals)
        }
      } else {
        newPitch = Math.max(0, Math.min(15, newPitch))
      }
      return { id: n.id, pitch: newPitch }
    })
    newNotes.forEach(item => {
      updateNoteInStore(item.id, { pitch: item.pitch })
    })
  }

  // Use store setState to update pitch of multiple notes with offsets
  const updateNoteInStore = (id: string, updates: Partial<Note>) => {
    useStore.setState(state => ({
      notes: state.notes.map(n => n.id === id ? { ...n, ...updates } : n)
    }))
  }

  const handleNudgeTime = (ticks: number) => {
    selectedNotes.forEach(n => {
      const newTime = Math.max(0, n.time + ticks)
      updateNoteInStore(n.id, { time: newTime })
    })
  }

  const handleNudgeDuration = (ticks: number) => {
    selectedNotes.forEach(n => {
      const newDuration = Math.max(12, n.duration + ticks)
      updateNoteInStore(n.id, { duration: newDuration })
    })
  }

  const handleNudgeEndTime = (ticks: number) => {
    selectedNotes.forEach(n => {
      const newDuration = Math.max(12, n.duration + ticks)
      updateNoteInStore(n.id, { duration: newDuration })
    })
  }

  // Local state for text input values
  const [localStartTime, setLocalStartTime] = useState<string>('')
  const [localEndTime, setLocalEndTime] = useState<string>('')
  const [localDuration, setLocalDuration] = useState<string>('')
  const [localBpmInput, setLocalBpmInput] = useState<string>('')

  const [prevNoteId, setPrevNoteId] = useState<string | null>(null)
  const [prevNotesCount, setPrevNotesCount] = useState<number>(0)

  const formatTick = (val: number): string => {
    return (Math.round(val * 1000) / 1000).toString()
  }

  const firstNoteId = firstNote?.id || null
  const notesCount = selectedNotes.length

  if (firstNoteId !== prevNoteId || notesCount !== prevNotesCount) {
    setPrevNoteId(firstNoteId)
    setPrevNotesCount(notesCount)

    if (isSingle && firstNote) {
      setLocalStartTime(formatTick(firstNote.time))
      setLocalEndTime(formatTick(firstNote.time + firstNote.duration))
      setLocalDuration(formatTick(firstNote.duration))
      setLocalBpmInput(firstNote.bpm ? formatTick(firstNote.bpm) : '')
    } else if (notesCount > 0) {
      setLocalStartTime('')
      setLocalEndTime('')
      setLocalDuration('')

      const firstBpm = firstNote?.bpm
      const allSame = selectedNotes.every(n => n.bpm === firstBpm)
      if (allSame) {
        setLocalBpmInput(firstBpm ? formatTick(firstBpm) : '')
      } else {
        setLocalBpmInput('Mixed')
      }
    } else {
      setLocalStartTime('')
      setLocalEndTime('')
      setLocalDuration('')
      setLocalBpmInput('')
    }
  }

  const handleCommitStartTime = (val: string) => {
    const parsed = parseFloat(val)
    if (!isNaN(parsed) && parsed >= 0) {
      updateNotes(selectedNoteIds, { time: parsed })
    } else {
      if (isSingle && firstNote) {
        setLocalStartTime(formatTick(firstNote.time))
      } else {
        setLocalStartTime('')
      }
    }
  }

  const handleCommitEndTime = (val: string) => {
    const parsed = parseFloat(val)
    if (!isNaN(parsed) && parsed > 0) {
      selectedNotes.forEach(n => {
        const newDuration = Math.max(12, parsed - n.time)
        updateNoteInStore(n.id, { duration: newDuration })
      })
    } else {
      if (isSingle && firstNote) {
        setLocalEndTime(formatTick(firstNote.time + firstNote.duration))
      } else {
        setLocalEndTime('')
      }
    }
  }

  const handleCommitDuration = (val: string) => {
    const parsed = parseFloat(val)
    if (!isNaN(parsed) && parsed >= 12) {
      updateNotes(selectedNoteIds, { duration: parsed })
    } else {
      if (isSingle && firstNote) {
        setLocalDuration(formatTick(firstNote.duration))
      } else {
        setLocalDuration('')
      }
    }
  }

  const handleCommitBpmOverride = (val: string) => {
    const trimmed = val.trim()
    if (trimmed === '' || trimmed.toLowerCase() === 'mixed') {
      updateNotes(selectedNoteIds, { bpm: undefined })
      setLocalBpmInput('')
    } else {
      const parsed = parseFloat(trimmed)
      if (!isNaN(parsed) && parsed > 0) {
        updateNotes(selectedNoteIds, { bpm: parsed })
      } else {
        if (isSingle && firstNote) {
          setLocalBpmInput(firstNote.bpm ? formatTick(firstNote.bpm) : '')
        } else {
          setLocalBpmInput('')
        }
      }
    }
  }

  const handleDelete = () => {
    removeNotes(selectedNoteIds)
  }

  const handleRestoreDefault = () => {
    updateNotes(selectedNoteIds, {
      velocity: 100,
      bpm: undefined,
      instrumentOverride: undefined,
      velocityInspectorModified: false,
      completeNotesOnPause: undefined,
      detune: undefined,
      pitchSlide: undefined,
      pitchSlideTime: undefined,
      pitchSlideRamp: undefined,
      pitchSlideCustomCurve: undefined,
      vibratoDepth: undefined,
      vibratoRate: undefined,
      filterStart: undefined,
      filterEnd: undefined,
      filterSweepTime: undefined,
      tremoloDepth: undefined,
      tremoloRate: undefined,
      lyric: undefined,
      voicePresetId: undefined
    })
  }

  const handleDuplicate = () => {
    // Duplicate selected notes starting at the end of the selection's bounds
    if (selectedNotes.length === 0) return
    const minTime = Math.min(...selectedNotes.map(n => n.time))
    const maxTime = Math.max(...selectedNotes.map(n => n.time + n.duration))
    const span = maxTime - minTime

    // Default offset to the span, or 192 (1 bar) if span is 0
    const offset = span > 0 ? span : 192

    const duplicated: Note[] = selectedNotes.map(n => ({
      ...n,
      id: Math.random().toString(36).substr(2, 9),
      time: n.time + offset
    }))

    // Add them to the store and select the new ones
    useStore.setState(state => ({
      notes: [...state.notes, ...duplicated],
      selectedNoteIds: duplicated.map(n => n.id)
    }))
  }

  // Velocity slider percentage
  const velocityPercentage = commonVelocity >= 0 ? `${(commonVelocity / 127) * 100}%` : '50%'

  // Removed unmount condition to allow smooth sliding CSS transition
  return (
    <div
      className="glass-panel thin-scroll"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '300px',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        background: 'rgba(15, 16, 21, 0.92)',
        boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.5)',
        overflowY: 'auto'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'white' }}>Note Inspector</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {selectedNoteIds.length} {selectedNoteIds.length === 1 ? 'note' : 'notes'} selected
          </span>
        </div>
        <button
          onClick={() => useStore.getState().setIsRightPaneVisible(false)}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', borderRadius: '4px', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
        >
          <IconX size={16} />
        </button>
      </div>

      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '16px', gap: '20px' }}>

          {/* Real-Time Chord Detective & Scale Degree Badge */}
          {!isDrum && detectedChordInfo && (
            <div style={{
              background: 'rgba(218, 119, 242, 0.1)',
              border: '1px solid rgba(218, 119, 242, 0.35)',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '9px', fontWeight: 800, color: '#da77f2', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  CHORD DETECTIVE
                </span>
                {detectedChordInfo.degree && (
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#4dabf7', background: 'rgba(77, 171, 247, 0.15)', padding: '1px 5px', borderRadius: '3px', border: '1px solid rgba(77, 171, 247, 0.3)' }}>
                    {detectedChordInfo.degree} in {NOTE_NAMES_SHARP[scaleLock.root]} {scaleLock.mode}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.02em' }}>
                  {detectedChordInfo.fullName}
                </span>
                <span style={{ fontSize: '10px', color: '#da77f2', fontWeight: 600 }}>
                  ({detectedChordInfo.inversion})
                </span>
              </div>
              <div style={{ display: 'flex', gap: '4px', marginTop: '2px', flexWrap: 'wrap' }}>
                {detectedChordInfo.notes.map((n, i) => (
                  <span key={i} style={{ fontSize: '9px', background: 'rgba(255,255,255,0.08)', color: '#eee', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
                    {n}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Drum Voice Distribution Badge */}
          {isDrum && drumDistribution && (
            <div style={{
              background: 'rgba(255, 146, 43, 0.1)',
              border: '1px solid rgba(255, 146, 43, 0.35)',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '9px', fontWeight: 800, color: '#ff922b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  DRUM VOICE DISTRIBUTION
                </span>
                <span style={{ fontSize: '9px', fontWeight: 800, color: '#ffcc00' }}>
                  {selectedNotes.length} Total Hits
                </span>
              </div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                {Object.entries(drumDistribution).map(([piece, count]) => (
                  <span key={piece} style={{ fontSize: '9px', background: 'rgba(255, 146, 43, 0.2)', color: '#ffcc00', padding: '2px 6px', borderRadius: '3px', fontWeight: 700, border: '1px solid rgba(255,146,43,0.3)' }}>
                    {piece}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quick Rhythmic Ratchets & Micro-Nudge Card */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#ffcc00', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Ratchets & Rolls
              </span>
              <span style={{ fontSize: '9px', color: '#888' }}>Subdivide Selection</span>
            </div>
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
                  onClick={() => handleRatchet(r.slices)}
                  title={`Subdivide into ${r.slices} slices`}
                  style={{
                    padding: '5px 2px',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 204, 0, 0.3)',
                    background: 'rgba(255, 204, 0, 0.08)',
                    color: '#ffcc00',
                    fontSize: '10px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#4dabf7', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Micro-Nudge
              </span>
              <span style={{ fontSize: '9px', color: '#888' }}>Sub-grid Timing</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
              <button
                onClick={() => handleNudge(-6)}
                title="Nudge backward 6 ticks (1/128)"
                style={{
                  padding: '5px 0',
                  borderRadius: '4px',
                  border: '1px solid rgba(77, 171, 247, 0.3)',
                  background: 'rgba(77, 171, 247, 0.08)',
                  color: '#4dabf7',
                  fontSize: '10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ◄ -6t
              </button>
              <button
                onClick={() => handleNudge(-1)}
                title="Nudge backward 1 tick"
                style={{
                  padding: '5px 0',
                  borderRadius: '4px',
                  border: '1px solid rgba(77, 171, 247, 0.3)',
                  background: 'rgba(77, 171, 247, 0.08)',
                  color: '#4dabf7',
                  fontSize: '10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ◄ -1t
              </button>
              <button
                onClick={() => handleNudge(1)}
                title="Nudge forward 1 tick"
                style={{
                  padding: '5px 0',
                  borderRadius: '4px',
                  border: '1px solid rgba(77, 171, 247, 0.3)',
                  background: 'rgba(77, 171, 247, 0.08)',
                  color: '#4dabf7',
                  fontSize: '10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                +1t ►
              </button>
              <button
                onClick={() => handleNudge(6)}
                title="Nudge forward 6 ticks (1/128)"
                style={{
                  padding: '5px 0',
                  borderRadius: '4px',
                  border: '1px solid rgba(77, 171, 247, 0.3)',
                  background: 'rgba(77, 171, 247, 0.08)',
                  color: '#4dabf7',
                  fontSize: '10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                +6t ►
              </button>
            </div>
          </div>

          {/* Target Track */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Track Assignment</label>
            <select
              value={commonTrackId}
              onChange={e => handleTrackChange(e.target.value)}
              style={{
                background: '#191b21',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'white',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {commonTrackId === 'mixed' && <option value="mixed">Mixed Tracks</option>}
              {tracks.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.instrument})</option>
              ))}
            </select>
          </div>

          {/* Instrument Override Dropdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconSpeaker size={12} style={{ color: 'var(--text-muted)' }} />
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Instrument Override</label>
              </div>
              {selectedNotes.some(n => n.instrumentOverride !== undefined) && (
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff3366', boxShadow: '0 0 6px #ff3366' }} title="Overridden from track default" />
              )}
            </div>
            <select
              value={commonOverride === undefined ? 'none' : (commonOverride === 'mixed' ? 'mixed' : commonOverride)}
              onChange={e => handleOverrideChange(e.target.value)}
              onMouseDown={e => e.stopPropagation()}
              style={{
                width: '100%',
                background: '#12141c',
                color: trackType === 'drum' ? '#ff6b6b' : '#00e6ff',
                border: `1px solid ${trackType === 'drum' ? 'rgba(255, 107, 107, 0.25)' : 'rgba(0, 230, 255, 0.25)'}`,
                borderRadius: '4px',
                padding: '5px',
                fontSize: '11px',
                outline: 'none',
                cursor: 'pointer',
                colorScheme: 'dark'
              }}
            >
              {commonOverride === 'mixed' && <option value="mixed">Mixed Overrides</option>}
              <option value="none" style={{ background: '#12141c', color: '#8b92a5' }}>Use Track Default</option>
              {noteVst3Instruments.length > 0 && (
                <optgroup
                  label={trackType === 'drum' ? '── VST3 DRUM INSTRUMENTS ──' : '── VST3 SYNTH INSTRUMENTS ──'}
                  style={{ background: '#0a0b10', color: trackType === 'drum' ? '#ff6b6b' : '#00e6ff', fontWeight: 800 }}
                >
                  {noteVst3Instruments.map(plugin => (
                    <option
                      key={plugin.uniqueId}
                      value={`vst3:${plugin.fileOrIdentifier || plugin.uniqueId}`}
                      style={{ background: '#12141c', color: trackType === 'drum' ? '#ff6b6b' : '#00e6ff' }}
                    >
                      {plugin.name} {getPluginInstrumentType(plugin, vst3DrumTags) === 'both' ? '(Hybrid)' : '(VST3)'}
                    </option>
                  ))}
                </optgroup>
              )}
              {currentOverrideVst && !noteVst3Instruments.some(p =>
                String(p.fileOrIdentifier || p.uniqueId) === String(currentOverrideVst.fileOrIdentifier || currentOverrideVst.uniqueId)
              ) && (
                <optgroup label="── CURRENT VST3 ──" style={{ background: '#0a0b10', color: trackType === 'drum' ? '#ff6b6b' : '#00e6ff', fontWeight: 800 }}>
                  <option
                    value={`vst3:${currentOverrideVst.fileOrIdentifier || currentOverrideVst.uniqueId}`}
                    style={{ background: '#12141c', color: trackType === 'drum' ? '#ff6b6b' : '#00e6ff' }}
                  >
                    {currentOverrideVst.name || 'Active VST3'} (Active)
                  </option>
                </optgroup>
              )}
              {trackType === 'synth' ? (
                <optgroup label="── BUILT-IN INSTRUMENTS ──" style={{ background: '#0a0b10', color: '#888', fontWeight: 800 }}>
                  {SYNTH_PRESETS.map(p => (
                    <option key={p.value} value={p.value} style={{ background: '#12141c', color: '#e0e0e0' }}>{p.label}</option>
                  ))}
                </optgroup>
              ) : (
                <optgroup label="── DRUM KITS ──" style={{ background: '#0a0b10', color: '#888', fontWeight: 800 }}>
                  {DRUM_KITS.map(k => (
                    <option key={k.value} value={k.value} style={{ background: '#12141c', color: '#e0e0e0' }}>{k.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <NoteFxChainSection
            notes={selectedNotes}
            selectedNoteIds={selectedNoteIds}
            vst3FxPlugins={vst3ActiveFx}
            customFxConfigs={customFxConfigs}
          />

          {/* Note BPM Override */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconTimeline size={12} style={{ color: 'var(--text-muted)' }} />
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Note BPM Override</label>
                {selectedNotes.some(n => n.bpm !== undefined) && (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff3366', boxShadow: '0 0 6px #ff3366' }} title="Overridden from track default" />
                )}
              </div>
              {localBpmInput && localBpmInput !== 'Mixed' && (
                <button
                  onClick={() => handleCommitBpmOverride('')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ff3366',
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: 0
                  }}
                >
                  Clear Override
                </button>
              )}
            </div>
            <input
              type="text"
              value={localBpmInput}
              placeholder="Track Default"
              onChange={e => setLocalBpmInput(e.target.value)}
              onBlur={() => handleCommitBpmOverride(localBpmInput)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleCommitBpmOverride(localBpmInput)
                  e.currentTarget.blur()
                }
              }}
              style={{
                background: '#191b21',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'white',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Play Full Note on Pause</label>
                {selectedNotes.some(n => n.completeNotesOnPause !== undefined) && (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff3366', boxShadow: '0 0 6px #ff3366' }} title="Overridden from track default" />
                )}
              </div>
              {(selectedNotes.some(n => n.completeNotesOnPause !== undefined)) && (
                <button
                  onClick={() => updateNotes(selectedNoteIds, { completeNotesOnPause: undefined })}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#aaa',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    cursor: 'pointer'
                  }}
                >
                  Clear Override
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => updateNotes(selectedNoteIds, { completeNotesOnPause: true })}
                style={{
                  flex: 1,
                  background: selectedNotes.every(n => n.completeNotesOnPause === true) ? 'rgba(77, 171, 247, 0.2)' : 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${selectedNotes.every(n => n.completeNotesOnPause === true) ? '#4dabf7' : 'rgba(255,255,255,0.08)'}`,
                  color: selectedNotes.every(n => n.completeNotesOnPause === true) ? '#4dabf7' : '#aaa',
                  borderRadius: '6px',
                  padding: '8px 0',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                ON
              </button>
              <button
                onClick={() => updateNotes(selectedNoteIds, { completeNotesOnPause: false })}
                style={{
                  flex: 1,
                  background: selectedNotes.every(n => n.completeNotesOnPause === false) ? 'rgba(77, 171, 247, 0.2)' : 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${selectedNotes.every(n => n.completeNotesOnPause === false) ? '#4dabf7' : 'rgba(255,255,255,0.08)'}`,
                  color: selectedNotes.every(n => n.completeNotesOnPause === false) ? '#4dabf7' : '#aaa',
                  borderRadius: '6px',
                  padding: '8px 0',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                OFF
              </button>
            </div>
          </div>

          {/* Velocity Control */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconVolume size={12} style={{ color: 'var(--text-muted)' }} />
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Velocity</label>
                {selectedNotes.some(n => n.velocityInspectorModified === true && n.velocity !== 100) && (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff3366', boxShadow: '0 0 6px #ff3366' }} title="Overridden from default 100" />
                )}
              </div>
              <span style={{ fontSize: '12px', color: '#ff3366', fontWeight: 'bold' }}>
                {commonVelocity >= 0 ? commonVelocity : 'Mixed'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1"
                max="127"
                value={commonVelocity >= 0 ? commonVelocity : 100}
                onChange={e => handleVelocityChange(Number(e.target.value))}
                className="modern-slider"
                style={{
                  flex: 1,
                  margin: 0,
                  // CSS variable custom inject for the slider progress color matching the track
                  '--slider-color': '#ff3366',
                  '--slider-progress': velocityPercentage
                } as React.CSSProperties & Record<string, string | number>}
              />
              <input
                type="number"
                min="1"
                max="127"
                value={commonVelocity >= 0 ? commonVelocity : ''}
                placeholder={commonVelocity < 0 ? '--' : undefined}
                onChange={e => e.target.value !== '' && handleVelocityChange(Number(e.target.value))}
                style={{
                  width: '44px',
                  height: '28px',
                  background: '#191b21',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '5px',
                  color: 'white',
                  textAlign: 'center',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* Detune Control */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconMusic size={12} style={{ color: 'var(--text-muted)' }} />
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Detune (Cents)</label>
                {selectedNotes.some(n => n.detune !== undefined && n.detune !== 0) && (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff3366', boxShadow: '0 0 6px #ff3366' }} title="Overridden from default 0" />
                )}
              </div>
              <span style={{ fontSize: '12px', color: '#ffcc00', fontWeight: 'bold' }}>
                {commonDetune !== 'mixed' ? (commonDetune > 0 ? `+${commonDetune}` : commonDetune) : 'Mixed'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="-100"
                max="100"
                value={commonDetune !== 'mixed' ? Math.max(-100, Math.min(100, commonDetune)) : 0}
                onChange={e => handleDetuneChange(Number(e.target.value))}
                className="modern-slider"
                style={{
                  flex: 1,
                  margin: 0,
                  '--slider-color': '#ffcc00',
                  '--slider-progress': commonDetune !== 'mixed' ? `${((Math.max(-100, Math.min(100, commonDetune)) + 100) / 200) * 100}%` : '50%'
                } as React.CSSProperties & Record<string, string | number>}
              />
              <input
                type="number"
                value={commonDetune !== 'mixed' ? commonDetune : ''}
                placeholder={commonDetune === 'mixed' ? '--' : '0'}
                onChange={e => e.target.value !== '' && handleDetuneChange(Number(e.target.value))}
                style={{
                  width: '54px',
                  height: '28px',
                  background: '#191b21',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '5px',
                  color: 'white',
                  textAlign: 'center',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  outline: 'none'
                }}
              />
            </div>
          </div>


          {/* Pitch Control */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {trackType === 'synth' ? <IconMusic size={12} style={{ color: 'var(--text-muted)' }} /> : <IconDrum size={12} style={{ color: 'var(--text-muted)' }} />}
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pitch / Row</label>
              </div>
              <span style={{ fontSize: '12px', color: '#00e6ff', fontWeight: 'bold' }}>
                {trackType === 'synth' ? (
                  commonPitch >= 0 ? getNoteName(commonPitch) : 'Mixed'
                ) : (
                  commonPitch >= 0 ? (PITCH_TO_PIECE[commonPitch] || `Piece ${commonPitch}`) : 'Mixed'
                )}
              </span>
            </div>

            {/* If synth: allow exact semitone picker, otherwise drum piece & pitch tuning */}
            {trackType === 'synth' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {isSingle ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="number"
                      min="12"
                      max="120"
                      value={commonPitch}
                      onChange={e => handlePitchChange(Number(e.target.value))}
                      style={{
                        flex: 1,
                        background: '#191b21',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'white',
                        borderRadius: '6px',
                        padding: '8px 12px',
                        fontSize: '13px',
                        outline: 'none',
                        textAlign: 'center'
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <button
                        onClick={() => handlePitchChange(commonPitch + 1)}
                        style={{ height: '18px', width: '28px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '3px', fontSize: '10px' }}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => handlePitchChange(commonPitch - 1)}
                        style={{ height: '18px', width: '28px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '3px', fontSize: '10px' }}
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                ) : null}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  <button
                    onClick={() => handleTranspose(-12)}
                    title="Octave Down"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#aaa', borderRadius: '6px', height: '32px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    -12
                  </button>
                  <button
                    onClick={() => handleTranspose(-1)}
                    title="Semitone Down"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#aaa', borderRadius: '6px', height: '32px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    -1
                  </button>
                  <button
                    onClick={() => handleTranspose(1)}
                    title="Semitone Up"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#aaa', borderRadius: '6px', height: '32px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    +1
                  </button>
                  <button
                    onClick={() => handleTranspose(12)}
                    title="Octave Up"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#aaa', borderRadius: '6px', height: '32px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    +12
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Drum Piece / Row Selector */}
                <select
                  value={commonPitch >= 0 ? commonPitch : 'mixed'}
                  onChange={e => e.target.value !== 'mixed' && handlePitchChange(Number(e.target.value))}
                  style={{
                    background: '#191b21',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'white',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {commonPitch < 0 && <option value="mixed">Mixed Rows</option>}
                  {Array.from({ length: 16 }).map((_, idx) => (
                    <option key={idx} value={idx}>{PITCH_TO_PIECE[idx] || `Row ${idx}`}</option>
                  ))}
                </select>

                {/* Per-Note Drum Pitch Tuning & 808 Controls */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                      DRUM PITCH TUNING
                    </span>
                    <span style={{ fontSize: '11px', color: '#ffcc00', fontWeight: 700 }}>
                      {commonPitch >= 0 && commonPitchOffset !== 'mixed'
                        ? getDrumTunedName(commonPitch, commonPitchOffset as number, currentTrack?.drumKit)
                        : (commonPitchOffset !== 'mixed' ? `${(commonPitchOffset as number) > 0 ? '+' : ''}${commonPitchOffset} st` : 'Mixed')}
                    </span>
                  </div>

                  {/* Semitone Stepper Slider & Quick Jump Buttons */}
                  <SliderRow
                    label="Pitch Offset"
                    value={commonPitchOffset === 'mixed' ? 0 : commonPitchOffset}
                    min={-24}
                    max={24}
                    step={1}
                    color="#ffcc00"
                    suffix="st"
                    onChange={val => handleDrumPitchOffsetChange(val)}
                  />

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginTop: '2px' }}>
                    {[-12, -1, 0, 1, 12].map(amt => (
                      <button
                        key={amt}
                        onClick={() => amt === 0 ? handleDrumPitchOffsetChange(0) : handleDrumPitchOffsetStep(amt)}
                        style={{
                          background: amt === 0 ? 'rgba(255,204,0,0.1)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${amt === 0 ? 'rgba(255,204,0,0.3)' : 'rgba(255,255,255,0.08)'}`,
                          color: amt === 0 ? '#ffcc00' : '#bbb',
                          borderRadius: '4px',
                          height: '24px',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        {amt === 0 ? 'Reset' : (amt > 0 ? `+${amt}` : amt)}
                      </button>
                    ))}
                  </div>

                  {/* Fine Detune */}
                  <SliderRow
                    label="Fine Detune"
                    value={commonDetune === 'mixed' ? 0 : commonDetune}
                    min={-100}
                    max={100}
                    step={1}
                    color="#00e6ff"
                    suffix="c"
                    onChange={val => handleDetuneChange(val)}
                  />

                  {/* 808 Pitch Glide / Slide */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', fontWeight: 800, color: '#00e6ff' }}>
                        808 PITCH GLIDE
                      </span>
                      {selectedNotes.some(n => n.pitchSlide !== undefined && n.pitchSlide !== 0) && (
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#00e6ff', boxShadow: '0 0 6px #00e6ff' }} title="Active 808 slide" />
                      )}
                    </div>
                    <SliderRow
                      label="Slide Target"
                      value={commonPitchSlide === 'mixed' ? 0 : commonPitchSlide}
                      min={-48}
                      max={48}
                      step={1}
                      color="#00e6ff"
                      suffix="st"
                      onChange={val => handleMPEChange('pitchSlide', val === 0 ? undefined : val)}
                    />
                    <SliderRow
                      label="Slide Time"
                      value={commonPitchSlideTime === 'mixed' ? 48 : commonPitchSlideTime}
                      min={0}
                      max={3840}
                      step={1}
                      color="#00e6ff"
                      suffix=" ticks"
                      onChange={val => handleMPEChange('pitchSlideTime', val)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Vocal Settings (Lyrics & Voice Preset Selection) */}
          {hasVocalNote && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconMusic size={12} style={{ color: '#69db7c' }} />
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#69db7c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Vocal Singing Settings</label>
              </div>

              {/* Lyric Syllable */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>SINGING LYRIC / SYLLABLE</label>
                <input
                  type="text"
                  value={commonLyric === 'Mixed' ? '' : commonLyric}
                  placeholder={commonLyric === 'Mixed' ? 'Mixed Lyrics' : 'e.g. la, do, re, mi, song'}
                  onMouseDown={e => e.stopPropagation()}
                  onMouseUp={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                  onChange={e => updateNotes(selectedNoteIds, { lyric: e.target.value })}
                  style={{
                    background: '#191b21',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'white',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Voice Preset Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>VOICE CHARACTER PRESET</label>
                <select
                  value={commonVoicePresetId}
                  onMouseDown={e => e.stopPropagation()}
                  onChange={e => updateNotes(selectedNoteIds, { voicePresetId: e.target.value === 'mixed' ? undefined : e.target.value })}
                  style={{
                    background: '#191b21',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'white',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {commonVoicePresetId === 'mixed' && <option value="mixed">Mixed Presets</option>}
                  {voicePresets.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* MPE Infinite Expression Engine */}
          {trackType === 'synth' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconTimeline size={12} style={{ color: '#ff3366' }} />
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#ff3366', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Infinite Expression (MPE)</label>
                {selectedNotes.some(n =>
                  (n.pitchSlide !== undefined && n.pitchSlide !== 0) ||
                  (n.vibratoDepth !== undefined && n.vibratoDepth !== 0) ||
                  (n.tremoloDepth !== undefined && n.tremoloDepth !== 0) ||
                  (n.filterStart !== undefined && n.filterStart !== 20000)
                ) && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff3366', boxShadow: '0 0 6px #ff3366' }} title="Custom MPE parameters active" />
                  )}
              </div>

              {/* Pitch Slide */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)' }}>PITCH GLIDE</span>
                  {selectedNotes.some(n => n.pitchSlide !== undefined && n.pitchSlide !== 0) && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#00e6ff', boxShadow: '0 0 6px #00e6ff' }} title="Custom Pitch Glide active" />
                  )}
                </div>
                <SliderRow
                  label="Slide (Semitones)"
                  value={commonPitchSlide === 'mixed' ? 0 : commonPitchSlide}
                  min={-48} max={48} step={1}
                  color="#00e6ff" suffix="st"
                  onChange={val => handleMPEChange('pitchSlide', val === 0 ? undefined : val)}
                />
                <SliderRow
                  label="Slide Duration"
                  value={commonPitchSlideTime === 'mixed' ? 48 : commonPitchSlideTime}
                  min={0} max={3840} step={1}
                  color="#00e6ff" suffix=" ticks"
                  onChange={val => handleMPEChange('pitchSlideTime', val)}
                />
                <SelectRow
                  label="Glide Style"
                  value={commonGlideStyle}
                  options={[
                    ...(commonGlideStyle === 'mixed' ? [{ value: 'mixed', label: 'Mixed' }] : []),
                    { value: 'default', label: `Track Default (${(glideStyle || 'smooth') === 'stepped' ? 'Stepped' : 'Smooth'})` },
                    { value: 'smooth', label: 'Smooth Ramp' },
                    { value: 'stepped', label: 'Stepped Glissando' }
                  ]}
                  onChange={val => {
                    if (val === 'mixed') return
                    handleMPEChange('glideStyle', val === 'default' ? undefined : val)
                  }}
                />
                {effectiveSmooth && (
                  <>
                    <SelectRow
                      label="Ramp Shape"
                      value={commonPitchSlideRamp}
                      options={[
                        ...(commonPitchSlideRamp === 'mixed' ? [{ value: 'mixed', label: 'Mixed Ramps' }] : []),
                        { value: 'linear', label: 'Linear' },
                        { value: 'exponential', label: 'Exponential' },
                        { value: 'logarithmic', label: 'Logarithmic' },
                        { value: 'sigmoid', label: 'S-Curve (Sigmoid)' },
                        { value: 'custom', label: 'Custom Equation' }
                      ]}
                      onChange={val => handleMPEChange('pitchSlideRamp', val === 'mixed' ? undefined : val)}
                    />

                    {commonPitchSlideRamp === 'custom' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>CUSTOM MATH EQUATION</span>
                          <span style={{ fontSize: '9px', color: '#888' }}>var: t (0 to 1)</span>
                        </div>
                        <input
                          type="text"
                          value={commonPitchSlideCustomCurve === 'mixed' ? '' : commonPitchSlideCustomCurve}
                          placeholder="e.g. t * t, Math.sin(t * Math.PI / 2)"
                          onChange={e => handleMPEChange('pitchSlideCustomCurve', e.target.value)}
                          onMouseDown={e => e.stopPropagation()}
                          onMouseUp={e => e.stopPropagation()}
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => e.stopPropagation()}
                          style={{
                            background: '#191b21',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: '#00e6ff',
                            borderRadius: '4px',
                            padding: '6px 10px',
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            outline: 'none'
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Vibrato */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)' }}>VIBRATO WOBBLE</span>
                  {selectedNotes.some(n => n.vibratoDepth !== undefined && n.vibratoDepth !== 0) && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ffcc00', boxShadow: '0 0 6px #ffcc00' }} title="Custom Vibrato active" />
                  )}
                </div>
                <SliderRow
                  label="Depth"
                  value={commonVibratoDepth === 'mixed' ? 0 : commonVibratoDepth}
                  min={0} max={200} step={1}
                  color="#ffcc00" suffix="ct"
                  onChange={val => handleMPEChange('vibratoDepth', val === 0 ? undefined : val)}
                />
                <SliderRow
                  label="Rate"
                  value={commonVibratoRate === 'mixed' ? 5 : commonVibratoRate}
                  min={0.01} max={40} step={0.01}
                  color="#ffcc00" suffix="Hz"
                  onChange={val => handleMPEChange('vibratoRate', val)}
                />
                <SliderRow
                  label="Delay"
                  value={commonVibratoDelay === 'mixed' ? 0 : commonVibratoDelay}
                  min={0} max={2000} step={1}
                  color="#ffcc00" suffix=" ms"
                  onChange={val => handleMPEChange('vibratoDelay', val === 0 ? undefined : val)}
                />
                <SliderRow
                  label="Fade In"
                  value={commonVibratoFade === 'mixed' ? 0 : commonVibratoFade}
                  min={0} max={2000} step={1}
                  color="#ffcc00" suffix=" ms"
                  onChange={val => handleMPEChange('vibratoFade', val === 0 ? undefined : val)}
                />
                <SelectRow
                  label="Waveform"
                  value={commonVibratoWave}
                  options={[
                    ...(commonVibratoWave === 'mixed' ? [{ value: 'mixed', label: 'Mixed' }] : []),
                    { value: 'sine', label: 'Sine' },
                    { value: 'triangle', label: 'Triangle' },
                    { value: 'square', label: 'Square' }
                  ]}
                  onChange={val => {
                    if (val === 'mixed') return
                    handleMPEChange('vibratoWave', val)
                  }}
                />
              </div>

              {/* Filter Sweep */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)' }}>FILTER SWEEP (WAH)</span>
                  {selectedNotes.some(n => n.filterStart !== undefined && n.filterStart !== 20000) && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4dabf7', boxShadow: '0 0 6px #4dabf7' }} title="Custom Filter Sweep active" />
                  )}
                </div>
                <SliderRow
                  label="Start Freq"
                  value={commonFilterStart === 'mixed' ? 20000 : commonFilterStart}
                  min={20} max={20000} step={100}
                  color="#4dabf7" suffix="Hz"
                  onChange={val => handleMPEChange('filterStart', val >= 20000 ? undefined : val)}
                />
                <SliderRow
                  label="End Freq"
                  value={commonFilterEnd === 'mixed' ? 20000 : commonFilterEnd}
                  min={20} max={20000} step={100}
                  color="#4dabf7" suffix="Hz"
                  onChange={val => handleMPEChange('filterEnd', val)}
                />
                <SliderRow
                  label="Sweep Duration"
                  value={commonFilterSweepTime === 'mixed' ? 48 : commonFilterSweepTime}
                  min={0} max={3840} step={1}
                  color="#4dabf7" suffix=" ticks"
                  onChange={val => handleMPEChange('filterSweepTime', val)}
                />
                <SelectRow
                  label="Sweep Shape"
                  value={commonFilterSweepRamp}
                  options={[
                    ...(commonFilterSweepRamp === 'mixed' ? [{ value: 'mixed', label: 'Mixed' }] : []),
                    { value: 'linear', label: 'Linear' },
                    { value: 'exponential', label: 'Exponential' },
                    { value: 'logarithmic', label: 'Logarithmic' },
                    { value: 'sigmoid', label: 'S-Curve (Sigmoid)' }
                  ]}
                  onChange={val => {
                    if (val === 'mixed') return
                    handleMPEChange('filterSweepRamp', val)
                  }}
                />
              </div>

              {/* Tremolo */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)' }}>TREMOLO (GATER)</span>
                  {selectedNotes.some(n => n.tremoloDepth !== undefined && n.tremoloDepth !== 0) && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff3366', boxShadow: '0 0 6px #ff3366' }} title="Custom Tremolo active" />
                  )}
                </div>
                <SliderRow
                  label="Depth"
                  value={commonTremoloDepth === 'mixed' ? 0 : commonTremoloDepth}
                  min={0} max={1} step={0.01}
                  color="#ff3366" suffix=""
                  onChange={val => handleMPEChange('tremoloDepth', val === 0 ? undefined : val)}
                />
                <SliderRow
                  label="Rate"
                  value={commonTremoloRate === 'mixed' ? 5 : commonTremoloRate}
                  min={0.01} max={40} step={0.01}
                  color="#ff3366" suffix="Hz"
                  onChange={val => handleMPEChange('tremoloRate', val)}
                />
                <SelectRow
                  label="Waveform"
                  value={commonTremoloWave}
                  options={[
                    ...(commonTremoloWave === 'mixed' ? [{ value: 'mixed', label: 'Mixed' }] : []),
                    { value: 'sine', label: 'Sine' },
                    { value: 'triangle', label: 'Triangle' },
                    { value: 'square', label: 'Square' }
                  ]}
                  onChange={val => {
                    if (val === 'mixed') return
                    handleMPEChange('tremoloWave', val)
                  }}
                />
              </div>

            </div>
          )}

          {/* Timing (Time & Duration) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <IconTimeline size={12} style={{ color: 'var(--text-muted)' }} />
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Timing & Duration</label>
            </div>

            {/* Time Nudge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: '12px', color: '#aaa', fontWeight: 600 }}>Start Time</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => handleNudgeTime(-snapResolution)}
                  title={`Shift backward by grid snap (${snapResolution} ticks)`}
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  -{snapResolution}
                </button>
                <button
                  onClick={() => handleNudgeTime(-12)}
                  title="Shift backward by 1/64 note (12 ticks)"
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  -12
                </button>
                <input
                  type="text"
                  value={localStartTime}
                  placeholder={isSingle ? "" : "Mixed"}
                  onChange={(e) => setLocalStartTime(e.target.value)}
                  onBlur={() => handleCommitStartTime(localStartTime)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCommitStartTime(localStartTime)
                      e.currentTarget.blur()
                    }
                  }}
                  style={{
                    width: '45px',
                    height: '24px',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '4px',
                    color: 'white',
                    textAlign: 'center',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    outline: 'none',
                    padding: 0
                  }}
                />
                <button
                  onClick={() => handleNudgeTime(12)}
                  title="Shift forward by 1/64 note (12 ticks)"
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  +12
                </button>
                <button
                  onClick={() => handleNudgeTime(snapResolution)}
                  title={`Shift forward by grid snap (${snapResolution} ticks)`}
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  +{snapResolution}
                </button>
              </div>
            </div>

            {/* End Time Nudge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: '12px', color: '#aaa', fontWeight: 600 }}>End Time</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => handleNudgeEndTime(-snapResolution)}
                  title={`Shorten end by grid snap (${snapResolution} ticks)`}
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  -{snapResolution}
                </button>
                <button
                  onClick={() => handleNudgeEndTime(-12)}
                  title="Shorten end by 1/64 note (12 ticks)"
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  -12
                </button>
                <input
                  type="text"
                  value={localEndTime}
                  placeholder={isSingle ? "" : "Mixed"}
                  onChange={(e) => setLocalEndTime(e.target.value)}
                  onBlur={() => handleCommitEndTime(localEndTime)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCommitEndTime(localEndTime)
                      e.currentTarget.blur()
                    }
                  }}
                  style={{
                    width: '45px',
                    height: '24px',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '4px',
                    color: 'white',
                    textAlign: 'center',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    outline: 'none',
                    padding: 0
                  }}
                />
                <button
                  onClick={() => handleNudgeEndTime(12)}
                  title="Lengthen end by 1/64 note (12 ticks)"
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  +12
                </button>
                <button
                  onClick={() => handleNudgeEndTime(snapResolution)}
                  title={`Lengthen end by grid snap (${snapResolution} ticks)`}
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  +{snapResolution}
                </button>
              </div>
            </div>

            {/* Duration Nudge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: '12px', color: '#aaa', fontWeight: 600 }}>Duration</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => handleNudgeDuration(-snapResolution)}
                  title={`Shorten by grid snap (${snapResolution} ticks)`}
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  -{snapResolution}
                </button>
                <button
                  onClick={() => handleNudgeDuration(-12)}
                  title="Shorten by 1/64 note (12 ticks)"
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  -12
                </button>
                <input
                  type="text"
                  value={localDuration}
                  placeholder={isSingle ? "" : "Mixed"}
                  onChange={(e) => setLocalDuration(e.target.value)}
                  onBlur={() => handleCommitDuration(localDuration)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCommitDuration(localDuration)
                      e.currentTarget.blur()
                    }
                  }}
                  style={{
                    width: '45px',
                    height: '24px',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '4px',
                    color: 'white',
                    textAlign: 'center',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    outline: 'none',
                    padding: 0
                  }}
                />
                <button
                  onClick={() => handleNudgeDuration(12)}
                  title="Lengthen by 1/64 note (12 ticks)"
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  +12
                </button>
                <button
                  onClick={() => handleNudgeDuration(snapResolution)}
                  title={`Lengthen by grid snap (${snapResolution} ticks)`}
                  style={{ width: '28px', height: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}
                >
                  +{snapResolution}
                </button>
              </div>
            </div>
          </div>

          {/* Deduplication Settings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px', marginTop: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Merge / Deduplicate Settings</span>

            <SliderRow
              label="Overlap Tolerance"
              value={deduplicateOverlapThreshold * 100}
              min={0}
              max={100}
              step={1}
              color="#4dabf7"
              suffix="%"
              onChange={val => setDeduplicateOverlapThreshold(val / 100)}
            />

            <SliderRow
              label="Proximity Tolerance"
              value={deduplicateProximityTolerance}
              min={0}
              max={96}
              step={0.1}
              color="#4dabf7"
              suffix="ticks"
              onChange={val => setDeduplicateProximityTolerance(val)}
            />
          </div>

          {/* Restore Default button */}
          <div style={{ marginTop: '10px' }}>
            <button
              onClick={handleRestoreDefault}
              style={{
                width: '100%',
                background: 'rgba(77, 171, 247, 0.08)',
                border: '1px solid rgba(77, 171, 247, 0.25)',
                color: '#4dabf7',
                borderRadius: '6px',
                padding: '10px 0',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(77, 171, 247, 0.18)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(77, 171, 247, 0.08)' }}
            >
              Restore Default Settings
            </button>
          </div>

          {/* Action buttons (Duplicate & Delete) */}
          <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '20px', marginTop: '10px' }}>
            <button
              onClick={handleDuplicate}
              style={{
                flex: 1,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'white',
                borderRadius: '6px',
                padding: '10px 0',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
            >
              Duplicate
            </button>
            <button
              onClick={handleDelete}
              style={{
                flex: 1,
                background: 'rgba(255, 51, 102, 0.12)',
                border: '1px solid rgba(255, 51, 102, 0.28)',
                color: '#ff3366',
                borderRadius: '6px',
                padding: '10px 0',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 51, 102, 0.22)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 51, 102, 0.12)' }}
            >
              <IconTrash size={13} /> Delete
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
