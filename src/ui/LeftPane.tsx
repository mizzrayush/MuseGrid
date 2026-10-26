/* eslint-disable react-hooks/purity */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Midi } from '@tonejs/midi'
import * as Tone from 'tone'
import { useStore, DEFAULT_DRUM_ROWS, DEFAULT_VOICE_PRESETS, defaultGrooveTemplates, isPluginDrum, isPluginSynth, getPluginInstrumentType, type DrumRowConfig, type CustomFxConfig, type Note, type VoicePreset } from '../engine/store'
import { audioEngine } from '../engine/AudioEngine'
import { getTrackFxInstances } from '../engine/fxDefaults'
import { useContextMenuDismissal } from './useContextMenuDismissal'
import { AppSlider, sliderProgress } from './AppSlider'
import { NOTE_NAMES_SHARP, NOTE_NAMES_FLAT, CHORD_VOICINGS, snapTick, snapToScale, getDiatonicChord, SCALE_MODES, GENRE_PROGRESSIONS, type GenreProgression, CHORD_STAMPS } from '../utils/musicTheory'

import { createProceduralSuggestions, type ProceduralSuggestion, type SuggestionKind } from '../utils/proceduralSuggestions'
import { applyAudioBufferFadeOut, normalizeAudioBuffer, renderProjectAudio, stitchAudioBuffers } from '../utils/audioRender'
import { buildNativeBouncePayload, canUseNativeBounce, renderNativeAudioBuffer, renderNativeBounce, type NativeBitDepth } from '../utils/nativeBounce'
import { audioBufferToWav } from '../utils/wavEncoder'
import { audioBufferToMp3 } from '../utils/mp3Encoder'
import { createMidiData } from '../utils/midiExport'
import { generateMusicXML, downloadScore, generateMuzTrack, downloadMuzTrack, parseMuzTrack } from '../utils/scoreExport'
import { exportTrackScala, parseScalaContent } from '../utils/scalaExport'
import { saveFileWithDialog } from '../utils/fileExport'
import { generateAiMelody, generateAiDrums, generateBeatMorph, generateAutoHarmony, generateHumanGroove, generatePianoGenieNote, resetPianoGenie } from '../utils/aiLab'
import StemSplitterPane from './StemSplitterPane'
import { MidiEditSection } from './MidiEditSection'
import { DEFAULT_DRUM_KIT, DEFAULT_SYNTH_PRESET, DRUM_KITS, SYNTH_PRESETS, type DrumKit, type SynthPreset } from '../utils/instruments'
import {
  IconPencil, IconEraser, IconCursor, IconScissors,
  IconLoop, IconMusic, IconDrum,
  IconEdit, IconTrash, IconStretch, IconChord,
  IconChevronRight, IconChevronDown, IconDownload, IconUpload, IconPalette, IconOpen,
  IconSettings, IconSpeaker, IconMidi, IconSync, IconChevronLeft,
  IconX, IconVolume, IconVolumeX, IconTimeline, IconTarget, IconMic,
  IconPlus, IconSave, IconWand, IconPlay, IconCopy, IconList, IconColumns, IconAlign,
  IconAlertTriangle, IconInfo, IconZap, IconSliders, IconCheck, IconPiano, IconLayers
} from './Icons'
import { MathInput } from './MathInput'
import { calculateFourierPartials } from '../utils/mathWaveform'
import { recordingEngine } from '../engine/RecordingEngine'
import type { FxModulator } from '../engine/store'

const SNAP_OPTIONS = [
  { label: '1/4', value: 192 },
  { label: '1/8', value: 96 },
  { label: '1/16', value: 48 },
  { label: '1/32', value: 24 },
]

const PITCH_TO_PIECE: Record<number, string> = {
  0: 'kick', 1: 'snare', 2: 'hihatClosed', 3: 'hihatOpen', 4: 'clap',
  5: 'tomLow', 6: 'tomMid', 7: 'tomHigh', 8: 'crash', 9: 'ride',
  10: 'cowbell', 11: 'tambourine', 12: 'congaLow', 13: 'congaHigh', 14: 'claves', 15: 'rimshot'
}

const getDecayDefaultByPitch = (pitch: number): number => {
  const defaults: Record<number, number> = {
    0: 0.42, 1: 0.14, 2: 0.10, 3: 0.30, 4: 0.20,
    5: 0.40, 6: 0.30, 7: 0.20, 8: 2.00, 9: 3.00,
    10: 0.50, 11: 0.10, 12: 0.30, 13: 0.20, 14: 0.10, 15: 0.05
  }
  return defaults[pitch] ?? 0.40
}

const TRACK_COLORS = ['#4dabf7', '#ff9900', '#69db7c', '#da77f2', '#ff6b6b', '#00e6ff', '#ffd43b']

function newId() {
  return Math.random().toString(36).substr(2, 9)
}

const getNoteName = (p: number) => {
  const octave = Math.floor(p / 12) - 1
  const name = NOTE_NAMES_SHARP[p % 12]
  return `${name}${octave}`
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function formatExportSeconds(value = 0) {
  return `${Math.max(0, value).toFixed(1)}s`
}


const getBaselineDrumKitParams = (kit: 'default' | 'tight' | 'electro' | 'eightOhEight' | 'tabla'): Record<string, any> => {
  const tight = kit === 'tight'
  const electro = kit === 'electro'
  const eightOhEight = kit === 'eightOhEight'
  const tabla = kit === 'tabla'

  return {
    kick: {
      octaves: eightOhEight ? 7 : electro ? 5 : tabla ? 2 : 3,
      pitchDecay: tight ? 0.025 : eightOhEight ? 0.09 : tabla ? 0.018 : 0.05,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: tight ? 0.22 : tabla ? 0.28 : eightOhEight ? 0.65 : 0.42, sustain: 0, release: 0.08 }
    },
    snare: {
      noise: { type: electro || eightOhEight ? 'brown' : 'white' },
      envelope: { attack: 0.004, decay: tight ? 0.08 : tabla ? 0.06 : 0.14, sustain: 0 }
    },
    hihatClosed: {
      envelope: { attack: 0.001, decay: tight ? 0.06 : 0.1, release: 0.01 },
      harmonicity: electro || eightOhEight ? 7.2 : 5.1,
      modulationIndex: electro || eightOhEight ? 46 : 32,
      resonance: electro || eightOhEight ? 5200 : 4000
    },
    hihatOpen: {
      envelope: { attack: 0.001, decay: tight ? 0.18 : 0.3, release: 0.1 },
      harmonicity: electro || eightOhEight ? 7.2 : 5.1,
      modulationIndex: electro || eightOhEight ? 46 : 32,
      resonance: electro || eightOhEight ? 5200 : 4000
    },
    clap: {
      noise: { type: electro || eightOhEight ? 'white' : 'pink' },
      envelope: { attack: 0.005, decay: tight ? 0.12 : 0.2, sustain: 0 }
    },
    tomLow: { octaves: eightOhEight ? 6 : 4, pitchDecay: 0.05, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: (eightOhEight ? 0.8 : tight ? 0.15 : 0.4), sustain: 0, release: 0.1 } },
    tomMid: { octaves: eightOhEight ? 6 : 4, pitchDecay: 0.05, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: (eightOhEight ? 0.8 : tight ? 0.15 : 0.4) * 0.75, sustain: 0, release: 0.1 } },
    tomHigh: { octaves: eightOhEight ? 6 : 4, pitchDecay: 0.05, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: (eightOhEight ? 0.8 : tight ? 0.15 : 0.4) * 0.5, sustain: 0, release: 0.1 } },
    crash: { envelope: { attack: 0.001, decay: tight ? 0.8 : 2.0, release: 0.5 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000 },
    ride: { envelope: { attack: 0.001, decay: (tight ? 0.8 : 2.0) * 1.5, release: 0.5 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000 },
    cowbell: { envelope: { attack: 0.001, decay: 0.5, release: 0.1 }, harmonicity: eightOhEight ? 0.5 : 0.2, modulationIndex: 10, resonance: 800 },
    tambourine: { noise: { type: 'white' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0 } },
    congaLow: { octaves: 2, pitchDecay: 0.01, oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: tabla ? 0.4 : 0.3, sustain: 0, release: 0.1 } },
    congaHigh: { octaves: 2, pitchDecay: 0.01, oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: tabla ? 0.3 : 0.2, sustain: 0, release: 0.1 } },
    claves: { octaves: 1, pitchDecay: 0.01, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 } },
    rimshot: { noise: { type: 'brown' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }
  }
}

type StopPropSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

function StopPropSelect({ children, onMouseDown, onClick, onDragStart, onMouseUp, onKeyDown, style, ...props }: StopPropSelectProps) {
  return (
    <select
      style={{
        colorScheme: 'dark',
        background: '#12141c',
        color: '#e0e6ed',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '5px',
        ...style
      }}
      onMouseDown={e => {
        e.stopPropagation()
        onMouseDown?.(e)
      }}
      onMouseUp={e => {
        e.stopPropagation()
        onMouseUp?.(e)
      }}
      onKeyDown={e => {
        e.stopPropagation()
        onKeyDown?.(e)
      }}
      onClick={e => {
        e.stopPropagation()
        onClick?.(e)
      }}
      onDragStart={e => {
        e.stopPropagation()
        onDragStart?.(e)
      }}
      {...props}
    >
      {children}
    </select>
  )
}

function Section({ title, info, children, defaultOpen = false }: { title: React.ReactNode; info?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer', padding: '10px 20px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>{title}</span>
          {info && <span style={{ fontSize: '9px', color: '#555', fontWeight: 500, textTransform: 'none', letterSpacing: '0.02em', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: '8px' }}>{info}</span>}
        </div>
        <span style={{ opacity: 0.5, fontSize: '10px' }}>{open ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}</span>
      </button>
      <div style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        overflow: 'hidden',
        transition: 'grid-template-rows 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <div style={{ minHeight: 0 }}>
          <div style={{ padding: '0 20px 14px' }}>{children}</div>
        </div>
      </div>
    </div>
  )
}

function ToolBtn({ label, active, color, onClick, title }: { label: React.ReactNode; active: boolean; color: string; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} style={{ flex: 1, padding: '7px 4px', borderRadius: '6px', border: `1px solid ${active ? color : 'rgba(255,255,255,0.08)'}`, background: active ? `${color}22` : 'transparent', color: active ? color : '#aaa', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
      {label}
    </button>
  )
}

function ToggleSwitch({ checked, onChange, color = '#4dabf7', disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; color?: string; disabled?: boolean }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => !disabled && onChange(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{ position: 'absolute', inset: 0, borderRadius: '20px', background: checked ? color : '#333', transition: 'background 0.2s' }}>
        <span style={{ position: 'absolute', top: '3px', left: checked ? '19px' : '3px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
      </span>
    </label>
  )
}

function StringInputRow({ label, value, onChange, color = '#4dabf7' }: { label: string; value: string; onChange: (v: string) => void; color?: string }) {
  const [localValue, setLocalValue] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!isFocused) setLocalValue(value)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
      <span style={{ fontSize: '11px', color: '#888' }}>{label}</span>
      <input
        type="text"
        value={localValue}
        onFocus={() => setIsFocused(true)}
        onBlur={() => { setIsFocused(false); onChange(localValue) }}
        onChange={e => setLocalValue(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        style={{
          fontSize: '11px',
          color,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '4px',
          width: '50px',
          textAlign: 'right',
          outline: 'none',
          padding: '2px 6px',
        }}
      />
    </div>
  )
}

function TextInputRow({ label, value, onChange, color = '#4dabf7' }: { label: string; value: number; onChange: (v: number) => void; color?: string }) {
  const [localValue, setLocalValue] = useState(value.toString())
  const [prevValue, setPrevValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!isFocused) setLocalValue(value.toString())
  }

  const handleCommit = () => {
    const val = parseFloat(localValue)
    if (!isNaN(val)) onChange(val)
    else setLocalValue(value.toString())
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
      <span style={{ fontSize: '11px', color: '#888' }}>{label}</span>
      <input
        type="text"
        value={localValue}
        onFocus={() => setIsFocused(true)}
        onBlur={() => { setIsFocused(false); handleCommit() }}
        onChange={e => setLocalValue(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        style={{
          fontSize: '11px',
          color,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '4px',
          width: '50px',
          textAlign: 'right',
          outline: 'none',
          padding: '2px 6px',
        }}
      />
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  color = '#4dabf7',
  suffix = '',
  onChange,
  fxModulator,
  onFxModulatorChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  color?: string
  suffix?: string
  onChange: (value: number) => void
  fxModulator?: FxModulator | null
  onFxModulatorChange?: (mod: FxModulator | null) => void
}) {
  const [inputValue, setInputValue] = useState(value.toString())
  const [prevValue, setPrevValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!isFocused) {
      setInputValue(Number.isInteger(value) ? value.toString() : value.toFixed(2))
    }
  }

  const progress = sliderProgress(value, min, max)

  const handleCommit = () => {
    const val = parseFloat(inputValue)
    if (!isNaN(val)) {
      onChange(val)
    } else {
      setInputValue(value.toString())
    }
  }

  const proceduralFxEnabled = useStore(state => state.studioSettings.proceduralFxEnabled)
  const hasModulator = onFxModulatorChange !== undefined && proceduralFxEnabled
  const isModulating = fxModulator !== null && fxModulator !== undefined

  return (
    <div style={{ marginBottom: '8px' }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#aaa' }}>{label}</span>
          {hasModulator && (
            <button
              title="Procedural f(x)"
              onClick={() => {
                if (isModulating) onFxModulatorChange?.(null)
                else onFxModulatorChange?.({ formula: 't', mode: 'override' })
              }}
              style={{
                background: isModulating ? color : 'transparent',
                border: `1px solid ${isModulating ? color : '#444'}`,
                color: isModulating ? '#000' : '#888',
                borderRadius: '4px',
                fontSize: '9px',
                padding: '0px 3px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontWeight: 'bold'
              }}
            >
              f(x)
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {!isModulating && (
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
              } as React.CSSProperties}
            />
          )}
          {!isModulating && suffix && <span style={{ fontSize: '10px', color, marginLeft: '2px', opacity: 0.8 }}>{suffix}</span>}
        </div>
      </div>

      {isModulating ? (
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          <select
            value={fxModulator.mode}
            onChange={e => onFxModulatorChange?.({ ...fxModulator, mode: e.target.value as any })}
            style={{
              background: '#222',
              border: `1px solid ${color}66`,
              color: '#ccc',
              fontSize: '10px',
              padding: '2px',
              borderRadius: '3px',
              outline: 'none'
            }}
          >
            <option value="override">Override</option>
            <option value="add">Add</option>
            <option value="multiply">Multiply</option>
          </select>
          <div style={{ flex: 1 }}>
            <MathInput
              value={fxModulator.formula}
              onChange={v => onFxModulatorChange?.({ ...fxModulator, formula: v })}
              className="modulator-input"
            />
          </div>
        </div>
      ) : (
        <input
          className="modern-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(+e.target.value)}
          style={{ '--slider-color': color, '--slider-progress': progress, accentColor: color } as React.CSSProperties}
        />
      )}
    </div>
  )
}

function RealtimeTailBufferControl({
  value,
  onChange,
  color = '#ff6b6b',
}: {
  value: number
  onChange: (value: number) => void
  color?: string
}) {
  const [inputValue, setInputValue] = useState(value.toString())
  const [prevValue, setPrevValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)
  const sliderValue = clamp(value, 0, 10)
  const progress = sliderProgress(sliderValue, 0, 10)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!isFocused) {
      setInputValue(Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, ''))
    }
  }

  const commitInput = () => {
    const parsed = parseFloat(inputValue)
    if (Number.isFinite(parsed)) {
      const nextValue = Math.max(0, parsed)
      onChange(nextValue)
      setInputValue(Number.isInteger(nextValue) ? nextValue.toString() : nextValue.toFixed(2).replace(/\.?0+$/, ''))
    } else {
      setInputValue(Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, ''))
    }
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>FX Tail Buffer</div>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '1px' }}>Extra seconds to capture reverb/delay tails</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
          <input
            type="text"
            value={inputValue}
            onFocus={() => setIsFocused(true)}
            onBlur={() => { setIsFocused(false); commitInput() }}
            onChange={e => setInputValue(e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            onMouseUp={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setInputValue(Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, ''))
                e.currentTarget.blur()
              }
            }}
            style={{
              fontSize: '12px',
              color,
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${isFocused ? color : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '4px',
              width: '52px',
              textAlign: 'right',
              outline: 'none',
              padding: '2px 6px',
              fontWeight: 800,
              boxShadow: isFocused ? `0 0 8px ${color}33` : 'none',
              transition: 'all 0.2s',
            } as React.CSSProperties}
          />
          <span style={{ fontSize: '11px', color, fontWeight: 800, opacity: 0.8 }}>s</span>
        </div>
      </div>
      <input
        className="modern-slider"
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={sliderValue}
        onChange={e => onChange(parseFloat(e.target.value))}
        onMouseDown={e => e.stopPropagation()}
        style={{ '--slider-color': color, '--slider-progress': progress, accentColor: color } as React.CSSProperties}
      />
    </div>
  )
}

function buttonStyle(color: string, active = false): React.CSSProperties {
  return {
    flex: 1,
    padding: '5px',
    border: `1px solid ${active ? color : `${color}44`}`,
    borderRadius: '5px',
    background: active ? `${color}26` : `${color}12`,
    color,
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: 700,
  }
}

function NoteMixerSection({ activeTrackId }: { activeTrackId: string | null }) {
  const activeTrack = useStore(s => s.tracks.find(t => t.id === activeTrackId))
  const addCustomSynthRow = useStore(s => s.addCustomSynthRow)
  const removeCustomSynthRow = useStore(s => s.removeCustomSynthRow)
  const customSynthRows = useStore(s => s.customSynthRows)

  const addCustomDrumRow = useStore(s => s.addCustomDrumRow)
  const removeCustomDrumRow = useStore(s => s.removeCustomDrumRow)
  const customDrumRows = useStore(s => s.customDrumRows)

  const updateTrack = useStore(s => s.updateTrack)

  // Synth State
  const [synthMode, setSynthMode] = useState<'mix' | 'direct'>('mix')
  const [mixP1, setMixP1] = useState(60)
  const [mixP2, setMixP2] = useState(67)
  const [mixProp, setMixProp] = useState(0.5)
  const [directHz, setDirectHz] = useState(777)
  const [mixName, setMixName] = useState("Custom Pitch")

  // Drum State
  const [drumA, setDrumA] = useState(0)
  const [drumB, setDrumB] = useState(1)
  const [drumProp, setDrumProp] = useState(0.5)
  const [drumMixName, setDrumMixName] = useState("Custom Hit")

  const handleCreateSynthRow = () => {
    if (!activeTrackId) return

    let mixedPitch = 60
    if (synthMode === 'mix') {
      const freq1 = 440 * Math.pow(2, (mixP1 - 69) / 12)
      const freq2 = 440 * Math.pow(2, (mixP2 - 69) / 12)
      const mixedFreq = freq1 * (1 - mixProp) + freq2 * mixProp
      mixedPitch = 12 * Math.log2(mixedFreq / 440) + 69
    } else {
      mixedPitch = 12 * Math.log2(directHz / 440) + 69
    }

    addCustomSynthRow({ id: newId(), trackId: activeTrackId, name: mixName, pitch: mixedPitch })
    useStore.getState().showToast(`Added ${mixName}`, "success")
  }

  const handleCreateDrumRow = () => {
    if (!activeTrackId || !activeTrack) return
    const cId = newId()
    const syntheticPitch = 1000 + Date.now() % 10000 // Unique enough synthetic pitch
    addCustomDrumRow({ id: cId, trackId: activeTrackId, name: drumMixName, syntheticPitch, drumA, drumB, proportion: drumProp })

    const currentDrumRows = activeTrack.drumRows || DEFAULT_DRUM_ROWS
    updateTrack(activeTrackId, {
      drumRows: [...currentDrumRows, { name: drumMixName, pitch: syntheticPitch, color: '#ff9900' }]
    })

    useStore.getState().showToast(`Added ${drumMixName}`, "success")
  }

  const handleRemoveDrumRow = (row: typeof customDrumRows[0]) => {
    removeCustomDrumRow(row.id)
    if (activeTrack) {
      const newRows = (activeTrack.drumRows || []).filter(r => r.pitch !== row.syntheticPitch)
      useStore.getState().updateTrack(activeTrack.id, { drumRows: newRows })
    }
  }

  if (!activeTrack) {
    return <div style={{ fontSize: '11px', color: '#888', padding: '10px' }}>Select a track to use the Note Mixer.</div>
  }

  if (activeTrack.instrument === 'drum') {
    return (
      <>
        <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px', fontWeight: 800 }}>PROPORTIONAL DRUM MIXER</div>
        <SliderRow label="Drum A (Pitch)" value={drumA} min={0} max={15} step={1} color="#ff9900" onChange={setDrumA} />
        <SliderRow label="Drum B (Pitch)" value={drumB} min={0} max={15} step={1} color="#ff9900" onChange={setDrumB} />
        <SliderRow label="Mix Proportion" value={drumProp} min={0} max={1} step={0.01} color="#ff9900" onChange={setDrumProp} />
        <div style={{ margin: '12px 0' }}><StringInputRow label="Row Name" value={drumMixName} onChange={setDrumMixName} color="#ff9900" /></div>
        <button onClick={handleCreateDrumRow} style={{ ...buttonStyle('#ff9900'), width: '100%', marginBottom: '14px' }}>Inject Drum Mix Row</button>

        {customDrumRows.filter(r => r.trackId === activeTrackId).length > 0 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
            <div style={{ fontSize: '10px', color: '#aaa', fontWeight: 800, marginBottom: '8px' }}>CUSTOM DRUM MIXES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {customDrumRows.filter(r => r.trackId === activeTrackId).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: '9px', color: '#888' }}>A:{r.drumA} B:{r.drumB} @ {(r.proportion * 100).toFixed(0)}%</div>
                  </div>
                  <button onClick={() => handleRemoveDrumRow(r)} style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', padding: '4px' }}><IconTrash size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    )
  }

  // Synth Mixer
  return (
    <>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '6px' }}>
        <button onClick={() => setSynthMode('mix')} style={{ flex: 1, padding: '4px', fontSize: '10px', fontWeight: 700, borderRadius: '4px', border: 'none', cursor: 'pointer', background: synthMode === 'mix' ? 'rgba(32,201,151,0.2)' : 'transparent', color: synthMode === 'mix' ? '#20c997' : '#aaa' }}>Mix Pitches</button>
        <button onClick={() => setSynthMode('direct')} style={{ flex: 1, padding: '4px', fontSize: '10px', fontWeight: 700, borderRadius: '4px', border: 'none', cursor: 'pointer', background: synthMode === 'direct' ? 'rgba(32,201,151,0.2)' : 'transparent', color: synthMode === 'direct' ? '#20c997' : '#aaa' }}>Direct Hz</button>
      </div>

      {synthMode === 'mix' ? (
        <>
          <SliderRow label="Pitch A (MIDI)" value={mixP1} min={0} max={127} step={1} color="#20c997" onChange={setMixP1} />
          <SliderRow label="Pitch B (MIDI)" value={mixP2} min={0} max={127} step={1} color="#20c997" onChange={setMixP2} />
          <SliderRow label="Proportion" value={mixProp} min={0} max={1} step={0.01} color="#20c997" onChange={setMixProp} />
        </>
      ) : (
        <SliderRow label="Frequency (Hz)" value={directHz} min={20} max={20000} step={1} color="#20c997" onChange={setDirectHz} />
      )}

      <div style={{ margin: '12px 0' }}><StringInputRow label="Row Name" value={mixName} onChange={setMixName} color="#20c997" /></div>

      <button onClick={handleCreateSynthRow} style={{ ...buttonStyle('#20c997'), width: '100%', marginBottom: '14px' }}>Inject Custom Row</button>

      {customSynthRows.filter(r => r.trackId === activeTrackId).length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
          <div style={{ fontSize: '10px', color: '#aaa', fontWeight: 800, marginBottom: '8px' }}>CUSTOM SYNTH ROWS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {customSynthRows.filter(r => r.trackId === activeTrackId).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: '9px', color: '#888' }}>Pitch: {r.pitch.toFixed(3)}</div>
                </div>
                <button onClick={() => removeCustomSynthRow(r.id)} style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', padding: '4px' }}><IconTrash size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function GridRowReorderSection({ activeTrackId }: { activeTrackId: string | null }) {
  const activeTrack = useStore(s => s.tracks.find(t => t.id === activeTrackId))
  const updateTrack = useStore(s => s.updateTrack)

  if (!activeTrack) return null

  if (activeTrack.instrument === 'drum') {
    const drumRows = activeTrack.drumRows || []

    const moveRow = (idx: number, dir: -1 | 1) => {
      if (idx + dir < 0 || idx + dir >= drumRows.length) return
      const newRows = [...drumRows]
      const temp = newRows[idx]
      newRows[idx] = newRows[idx + dir]
      newRows[idx + dir] = temp
      updateTrack(activeTrack.id, { drumRows: newRows })
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px', fontWeight: 800 }}>DRUM ROW MAP</div>
        {drumRows.map((row, idx) => (
          <div key={row.pitch} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>{row.name} <span style={{ color: '#888', fontSize: '9px' }}>({row.pitch})</span></span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => moveRow(idx, -1)} disabled={idx === 0} style={{ background: 'transparent', border: 'none', color: idx === 0 ? '#444' : '#aaa', cursor: idx === 0 ? 'default' : 'pointer' }}>▲</button>
              <button onClick={() => moveRow(idx, 1)} disabled={idx === drumRows.length - 1} style={{ background: 'transparent', border: 'none', color: idx === drumRows.length - 1 ? '#444' : '#aaa', cursor: idx === drumRows.length - 1 ? 'default' : 'pointer' }}>▼</button>
            </div>
          </div>
        ))}
      </div>
    )
  } else {
    const isCustomMap = activeTrack.customRowOrder !== undefined

    const toggleCustomMap = () => {
      if (isCustomMap) {
        updateTrack(activeTrack.id, { customRowOrder: undefined })
      } else {
        // Initialize with C4 to B4 as a starting point, stored as stringified numbers
        const initialMap = Array.from({ length: 12 }).map((_, i) => String(60 + i))
        updateTrack(activeTrack.id, { customRowOrder: initialMap })
      }
    }

    const order = activeTrack.customRowOrder || []

    const moveRow = (idx: number, dir: -1 | 1) => {
      if (idx + dir < 0 || idx + dir >= order.length) return
      const newRows = [...order]
      const temp = newRows[idx]
      newRows[idx] = newRows[idx + dir]
      newRows[idx + dir] = temp
      updateTrack(activeTrack.id, { customRowOrder: newRows })
    }

    const addPitchToMap = () => {
      const pitchStr = window.prompt("Enter MIDI Pitch to add to map (e.g. 60 for C4):")
      if (pitchStr && !isNaN(Number(pitchStr))) {
        updateTrack(activeTrack.id, { customRowOrder: [...order, pitchStr] })
      }
    }

    const removePitch = (idx: number) => {
      const newRows = [...order]
      newRows.splice(idx, 1)
      updateTrack(activeTrack.id, { customRowOrder: newRows })
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Enable Custom Row Map</span>
          <ToggleSwitch checked={isCustomMap} onChange={toggleCustomMap} color="#4dabf7" />
        </div>

        {isCustomMap && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
            <div style={{ fontSize: '9px', color: '#4dabf7', fontWeight: 800, textTransform: 'uppercase', marginBottom: '8px', lineHeight: 1.4, background: 'rgba(77,171,247,0.1)', padding: '6px', borderRadius: '4px', border: '1px solid rgba(77,171,247,0.3)' }}>
              NOTE: Linear grid is disabled. Only rows defined below will be rendered. Free pitches map relative to these anchor points.
            </div>
            {order.map((pitchStr, idx) => (
              <div key={`${pitchStr}-${idx}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>Pitch {pitchStr}</span>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <button onClick={() => moveRow(idx, -1)} disabled={idx === 0} style={{ background: 'transparent', border: 'none', color: idx === 0 ? '#444' : '#aaa', cursor: idx === 0 ? 'default' : 'pointer' }}>▲</button>
                  <button onClick={() => moveRow(idx, 1)} disabled={idx === order.length - 1} style={{ background: 'transparent', border: 'none', color: idx === order.length - 1 ? '#444' : '#aaa', cursor: idx === order.length - 1 ? 'default' : 'pointer' }}>▼</button>
                  <button onClick={() => removePitch(idx)} style={{ background: 'transparent', border: 'none', color: '#ff3366', cursor: 'pointer', marginLeft: '4px' }}>×</button>
                </div>
              </div>
            ))}
            <button onClick={addPitchToMap} style={{ ...buttonStyle('#4dabf7'), width: '100%', marginTop: '8px' }}>
              Add Pitch Anchor
            </button>
          </div>
        )}
      </div>
    )
  }
} function FreePitchSection() {
  const pitchSnapEnabled = useStore(s => s.pitchSnapEnabled)
  const pitchDropSnap = useStore(s => s.pitchDropSnap)
  const pitchSnapSensitivity = useStore(s => s.pitchSnapSensitivity)
  const verticalMergeThreshold = useStore(s => s.verticalMergeThreshold)
  const verticalStretchMode = useStore(s => s.verticalStretchMode)
  const glideStyle = useStore(s => s.glideStyle) || 'smooth'
  const setPitchSnapEnabled = useStore(s => s.setPitchSnapEnabled)
  const setPitchDropSnap = useStore(s => s.setPitchDropSnap)
  const setPitchSnapSensitivity = useStore(s => s.setPitchSnapSensitivity)
  const setVerticalMergeThreshold = useStore(s => s.setVerticalMergeThreshold)
  const setVerticalStretchMode = useStore(s => s.setVerticalStretchMode)
  const setGlideStyle = useStore(s => s.setGlideStyle)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontSize: '12px', color: '#aaa', fontWeight: 600 }}>Unlock Vertical Grid</span>
        <ToggleSwitch checked={!pitchSnapEnabled} onChange={v => setPitchSnapEnabled(!v)} color="#fcc419" />
      </div>
      {!pitchSnapEnabled && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: '9px', color: '#ff3366', fontWeight: 800, textTransform: 'uppercase', marginBottom: '12px', lineHeight: 1.4, background: 'rgba(255,51,102,0.1)', padding: '6px', borderRadius: '4px', border: '1px solid rgba(255,51,102,0.3)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <IconAlertTriangle size={12} style={{ color: '#ff3366', flexShrink: 0 }} /> EXPERIMENTAL: Standard MIDI Export is disabled while Vertical Grid is unlocked.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Drop Snap (Vertical)</span>
            <ToggleSwitch checked={pitchDropSnap} onChange={setPitchDropSnap} color="#fcc419" />
          </div>
          <SliderRow label="Magnetic Snap" value={pitchSnapSensitivity} min={0} max={100} step={1} suffix="%" color="#fcc419" onChange={setPitchSnapSensitivity} />
          <SliderRow label="Merge Threshold" value={verticalMergeThreshold} min={0} max={1} step={0.01} color="#fcc419" onChange={setVerticalMergeThreshold} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Stretch Mode</span>
            <StopPropSelect
              value={verticalStretchMode}
              onChange={e => setVerticalStretchMode(e.target.value as 'glide' | 'cluster')}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '11px', outline: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}
            >
              <option value="glide" style={{ background: '#1a1a24' }}>Pitch Glide</option>
              <option value="cluster" style={{ background: '#1a1a24' }}>Cluster Chord</option>
            </StopPropSelect>
          </div>

          {verticalStretchMode === 'glide' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px' }}>
              <span style={{ fontSize: '12px', color: '#aaa' }}>Glide Style</span>
              <StopPropSelect
                value={glideStyle}
                onChange={e => setGlideStyle(e.target.value as 'smooth' | 'stepped')}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '11px', outline: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}
              >
                <option value="smooth" style={{ background: '#1a1a24' }}>Smooth Ramp</option>
                <option value="stepped" style={{ background: '#1a1a24' }}>Stepped Glissando</option>
              </StopPropSelect>
            </div>
          )}
        </div>
      )}
    </>
  )
}
import { selectAndReadFile } from '../utils/fileDialog'

const extractXmlFromMxl = async (data: ArrayBuffer | Uint8Array): Promise<string> => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  let rootFilePath: string | null = null;
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const containerText = await containerFile.async('string');
    const containerDoc = new DOMParser().parseFromString(containerText, 'text/xml');
    const rootfileEl = containerDoc.getElementsByTagName('rootfile')[0];
    if (rootfileEl) {
      rootFilePath = rootfileEl.getAttribute('full-path');
    }
  }
  if (!rootFilePath) {
    const xmlFile = Object.keys(zip.files).find(
      name => (name.endsWith('.xml') || name.endsWith('.musicxml')) && name !== 'META-INF/container.xml'
    );
    if (xmlFile) {
      rootFilePath = xmlFile;
    }
  }
  if (!rootFilePath) {
    throw new Error('No valid MusicXML file found inside the MXL archive.');
  }
  const targetFile = zip.file(rootFilePath);
  if (!targetFile) {
    throw new Error(`File ${rootFilePath} not found in the MXL archive.`);
  }
  return targetFile.async('string');
};

export default function LeftPane() {
  const tracks = useStore(s => s.tracks)
  const addTrack = useStore(s => s.addTrack)
  const removeTrack = useStore(s => s.removeTrack)
  const updateTrack = useStore(s => s.updateTrack)
  const reorderTrackFX = useStore(s => s.reorderTrackFX)
  const duplicateTrackFX = useStore(s => s.duplicateTrackFX)
  const removeTrackFXInstance = useStore(s => s.removeTrackFXInstance)
  const updateTrackFXSetting = useStore(s => s.updateTrackFXSetting)
  const updateTrackFXModulator = useStore(s => s.updateTrackFXModulator)
  const loopTrack = useStore(s => s.loopTrack)

  const customFxConfigs = useStore(s => s.customFxConfigs)
  const addCustomFxConfig = useStore(s => s.addCustomFxConfig)
  const updateCustomFxConfig = useStore(s => s.updateCustomFxConfig)
  const deleteCustomFxConfig = useStore(s => s.deleteCustomFxConfig)
  const addCustomFxToTracks = useStore(s => s.addCustomFxToTracks)
  const addCustomFxToTrack = useStore(s => s.addCustomFxToTrack)

  const vst3Plugins = useStore(s => s.vst3Plugins || [])
  const vst3ActivePluginIds = useStore(s => s.vst3ActivePluginIds || [])
  const vst3DrumTags = useStore(s => s.vst3DrumTags || {})
  const toggleVst3DrumTag = useStore(s => s.toggleVst3DrumTag)
  const vst3Scanning = useStore(s => s.vst3Scanning)
  const vst3ScanStatus = useStore(s => s.vst3ScanStatus)
  const toggleVst3Active = useStore(s => s.toggleVst3Active)

  const [vst3Filter, setVst3Filter] = useState<'all' | 'instruments' | 'fx'>('all')
  const [vst3Search, setVst3Search] = useState('')

  const filteredVst3List = useMemo(() => {
    return (vst3Plugins || []).filter(p => {
      if (!p) return false
      if (vst3Filter === 'instruments' && !p.isInstrument) return false
      if (vst3Filter === 'fx' && p.isInstrument) return false
      if (vst3Search.trim()) {
        const q = vst3Search.toLowerCase()
        const nameMatch = (p.name || '').toLowerCase().includes(q)
        const mfgMatch = (p.manufacturerName || '').toLowerCase().includes(q)
        return nameMatch || mfgMatch
      }
      return true
    })
  }, [vst3Plugins, vst3Filter, vst3Search])

  const vst3ActiveDrumInstruments = useMemo(() => {
    const activeSet = new Set((vst3ActivePluginIds || []).map(String))
    return (vst3Plugins || []).filter(p => p && p.isInstrument && (activeSet.has(String(p.uniqueId)) || activeSet.has(String(p.fileOrIdentifier))) && isPluginDrum(p, vst3DrumTags))
  }, [vst3Plugins, vst3ActivePluginIds, vst3DrumTags])

  const vst3ActiveSynthInstruments = useMemo(() => {
    const activeSet = new Set((vst3ActivePluginIds || []).map(String))
    return (vst3Plugins || []).filter(p => p && p.isInstrument && (activeSet.has(String(p.uniqueId)) || activeSet.has(String(p.fileOrIdentifier))) && isPluginSynth(p, vst3DrumTags))
  }, [vst3Plugins, vst3ActivePluginIds, vst3DrumTags])

  const vst3ActiveFx = useMemo(() => {
    const activeSet = new Set((vst3ActivePluginIds || []).map(String))
    return (vst3Plugins || []).filter(p => p && !p.isInstrument && (activeSet.has(String(p.uniqueId)) || activeSet.has(String(p.fileOrIdentifier))))
  }, [vst3Plugins, vst3ActivePluginIds])

  const [activeCustomFxId, setActiveCustomFxId] = useState<string>(customFxConfigs[0]?.id || '')
  const [editorCode, setEditorCode] = useState<string>('')
  const [compileError, setCompileError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmClosing, setDeleteConfirmClosing] = useState(false)

  const projectId = useStore(state => state.projectId)
  const engineMode = useStore(state => state.engineMode)
  const setEngineMode = useStore(state => state.setEngineMode)

  // Local states
  const [isMidiLabInjecting, setIsMidiLabInjecting] = useState(false)
  const [activeLabTrack, setActiveLabTrack] = useState<any>(null)

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackId: string; mode: 'main' | 'sync' | 'make_subtrack' | 'merge_track' | 'loop' | 'background'; isMultiSelect?: boolean } | null>(null)
  const [prevProjectId, setPrevProjectId] = useState(projectId)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  useContextMenuDismissal(contextMenu !== null, setContextMenu, contextMenuRef)
  const [nTimesPromptTrackId, setNTimesPromptTrackId] = useState<{ id: string, multi: boolean } | null>(null)
  const [nTimesInput, setNTimesInput] = useState<string>('4')

  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId)
    setIsMidiLabInjecting(false)
    setActiveLabTrack(null)
    setContextMenu(null)
  }

  const closeDeleteConfirm = () => {
    setDeleteConfirmClosing(true)
    setTimeout(() => {
      setShowDeleteConfirm(false)
      setDeleteConfirmClosing(false)
    }, 200)
  }

  const [prevActiveId, setPrevActiveId] = useState(activeCustomFxId)
  const [prevConfigs, setPrevConfigs] = useState(customFxConfigs)

  if (activeCustomFxId !== prevActiveId || customFxConfigs !== prevConfigs) {
    setPrevActiveId(activeCustomFxId)
    setPrevConfigs(customFxConfigs)

    let currentActiveId = activeCustomFxId
    if (!currentActiveId && customFxConfigs.length > 0) {
      currentActiveId = customFxConfigs[0].id
      setActiveCustomFxId(currentActiveId)
    }

    const config = customFxConfigs.find(c => c.id === currentActiveId)
    if (config) {
      setEditorCode(config.code)
      try {
        new Function('input', 'output', 'params', 'state', 'sampleRate', 'duration', 'currentTime', 'context', config.code)
        setCompileError(null)
      } catch (err) {
        setCompileError((err as Error).message || String(err))
      }
    }
  }

  const removeNote = useStore(s => s.removeNote)
  const activeTrackId = useStore(s => s.activeTrackId)
  const selectedTrackIds = useStore(s => s.selectedTrackIds)
  const toggleTrackSelection = useStore(s => s.toggleTrackSelection)
  const activeTrack = tracks.find(t => t.id === activeTrackId)
  const setActiveTrackId = useStore(s => s.setActiveTrackId)
  const activeTool = useStore(s => s.activeTool)
  const setActiveTool = useStore(s => s.setActiveTool)
  const snapEnabled = useStore(s => s.snapEnabled)
  const setSnapEnabled = useStore(s => s.setSnapEnabled)
  const snapResolution = useStore(s => s.snapResolution)
  const setSnapResolution = useStore(s => s.setSnapResolution)
  const dropSnap = useStore(s => s.dropSnap)
  const setDropSnap = useStore(s => s.setDropSnap)
  const noteInspectorEnabled = useStore(s => s.noteInspectorEnabled)
  const setNoteInspectorEnabled = useStore(s => s.setNoteInspectorEnabled)
  const completeNotesOnPause = useStore(s => s.completeNotesOnPause)
  const setCompleteNotesOnPause = useStore(s => s.setCompleteNotesOnPause)
  const deduplicateEnabled = useStore(s => s.deduplicateEnabled)
  const setDeduplicateEnabled = useStore(s => s.setDeduplicateEnabled)
  const deduplicateProximityTolerance = useStore(s => s.deduplicateProximityTolerance)
  const setDeduplicateProximityTolerance = useStore(s => s.setDeduplicateProximityTolerance)
  const gridBlockTicks = useStore(s => s.gridBlockTicks)
  const setGridBlockTicks = useStore(s => s.setGridBlockTicks)
  const gridShadeEvery = useStore(s => s.gridShadeEvery)
  const setGridShadeEvery = useStore(s => s.setGridShadeEvery)
  const gridColumnCount = useStore(s => s.gridColumnCount)
  const setGridColumnCount = useStore(s => s.setGridColumnCount)
  const autoExtendGrid = useStore(s => s.autoExtendGrid)
  const setAutoExtendGrid = useStore(s => s.setAutoExtendGrid)
  const synthLowerOctave = useStore(s => s.synthLowerOctave)
  const setSynthLowerOctave = useStore(s => s.setSynthLowerOctave)
  const synthUpperOctave = useStore(s => s.synthUpperOctave)
  const setSynthUpperOctave = useStore(s => s.setSynthUpperOctave)
  const minNoteSize = useStore(s => s.minNoteSize)
  const setMinNoteSize = useStore(s => s.setMinNoteSize)
  const horizScrollLockEnabled = useStore(s => s.horizScrollLockEnabled)
  const setHorizScrollLockEnabled = useStore(s => s.setHorizScrollLockEnabled)
  const vertScrollLockEnabled = useStore(s => s.vertScrollLockEnabled)
  const setVertScrollLockEnabled = useStore(s => s.setVertScrollLockEnabled)
  const readOnlyMode = useStore(s => s.readOnlyMode)
  const setReadOnlyMode = useStore(s => s.setReadOnlyMode)
  const scrollBoth = useStore(s => s.scrollBoth)
  const setScrollBoth = useStore(s => s.setScrollBoth)
  const ghostNotesEnabled = useStore(s => s.ghostNotesEnabled)
  const setGhostNotesEnabled = useStore(s => s.setGhostNotesEnabled)
  const ghostNoteOpacity = useStore(s => s.ghostNoteOpacity)
  const setGhostNoteOpacity = useStore(s => s.setGhostNoteOpacity)
  const ghostCrossInstrument = useStore(s => s.ghostCrossInstrument)
  const setGhostCrossInstrument = useStore(s => s.setGhostCrossInstrument)
  const loopEnabled = useStore(s => s.loopEnabled)
  const setLoopEnabled = useStore(s => s.setLoopEnabled)
  const exportRegionMode = useStore(s => s.exportRegionMode)
  const setExportRegionMode = useStore(s => s.setExportRegionMode)
  const exportRegions = useStore(s => s.exportRegions)
  const removeExportRegion = useStore(s => s.removeExportRegion)
  const updateExportRegionGap = useStore(s => s.updateExportRegionGap)
  const scaleLock = useStore(s => s.scaleLock)
  const setScaleLock = useStore(s => s.setScaleLock)
  const scaleFoldEnabled = useStore(s => s.scaleFoldEnabled)
  const setScaleFoldEnabled = useStore(s => s.setScaleFoldEnabled)
  const activeChordStamp = useStore(s => s.activeChordStamp)
  const setActiveChordStamp = useStore(s => s.setActiveChordStamp)
  const isRecording = useStore(s => s.isRecording)
  const isStepRecording = useStore(s => s.isStepRecording)
  const stepRecordCursorTick = useStore(s => s.stepRecordCursorTick)
  const recallPlacementMode = useStore(s => s.recallPlacementMode)
  const setRecallPlacementMode = useStore(s => s.setRecallPlacementMode)
  const advanceStepRecordCursor = useStore(s => s.advanceStepRecordCursor)
  const retreatStepRecordCursor = useStore(s => s.retreatStepRecordCursor)
  const deleteStepRecordCurrentColumn = useStore(s => s.deleteStepRecordCurrentColumn)
  const stepRecordAdvanceMode = useStore(s => s.stepRecordAdvanceMode)
  const setStepRecordAdvanceMode = useStore(s => s.setStepRecordAdvanceMode)
  const stepRecordStepSize = useStore(s => s.stepRecordStepSize)
  const setStepRecordStepSize = useStore(s => s.setStepRecordStepSize)
  const stepRecordStepColumns = useStore(s => s.stepRecordStepColumns)
  const setStepRecordStepColumns = useStore(s => s.setStepRecordStepColumns)
  const stepRecordNoteDuration = useStore(s => s.stepRecordNoteDuration)
  const setStepRecordNoteDuration = useStore(s => s.setStepRecordNoteDuration)
  const stepRecordNoteColumns = useStore(s => s.stepRecordNoteColumns)
  const setStepRecordNoteColumns = useStore(s => s.setStepRecordNoteColumns)
  const stepRecordGatePercent = useStore(s => s.stepRecordGatePercent)
  const setStepRecordGatePercent = useStore(s => s.setStepRecordGatePercent)
  const stepRecordChordSensitivityMs = useStore(s => s.stepRecordChordSensitivityMs)
  const setStepRecordChordSensitivityMs = useStore(s => s.setStepRecordChordSensitivityMs)
  const midiOverdub = useStore(s => s.midiOverdub)
  const setMidiOverdub = useStore(s => s.setMidiOverdub)
  const recordTargetMode = useStore(s => s.recordTargetMode)
  const setRecordTargetMode = useStore(s => s.setRecordTargetMode)
  const recordTakeCounter = useStore(s => s.recordTakeCounter)
  const setRecordTakeCounter = useStore(s => s.setRecordTakeCounter)
  const recordCountIn = useStore(s => s.recordCountIn)
  const setRecordCountIn = useStore(s => s.setRecordCountIn)
  const countInRemaining = useStore(s => s.countInRemaining)
  const recordInputQuantize = useStore(s => s.recordInputQuantize)
  const setRecordInputQuantize = useStore(s => s.setRecordInputQuantize)
  const recordScaleConform = useStore(s => s.recordScaleConform)
  const setRecordScaleConform = useStore(s => s.setRecordScaleConform)
  const recordEdoMappingMode = useStore(s => s.recordEdoMappingMode)
  const setRecordEdoMappingMode = useStore(s => s.setRecordEdoMappingMode)
  const qwertyPianoEnabled = useStore(s => s.qwertyPianoEnabled)
  const setQwertyPianoEnabled = useStore(s => s.setQwertyPianoEnabled)
  const qwertyOctave = useStore(s => s.qwertyOctave)
  const setQwertyOctave = useStore(s => s.setQwertyOctave)
  const qwertyVelocity = useStore(s => s.qwertyVelocity)
  const setQwertyVelocity = useStore(s => s.setQwertyVelocity)
  const activeMidiDeviceNames = useStore(s => s.activeMidiDeviceNames)
  const midiActivityPulse = useStore(s => s.midiActivityPulse)
  const retrospectiveNoteCount = useStore(s => s.retrospectiveNoteCount)
  const swing = useStore(s => s.swing)
  const setSwing = useStore(s => s.setSwing)
  const metronomeEnabled = useStore(s => s.metronomeEnabled)
  const setMetronomeEnabled = useStore(s => s.setMetronomeEnabled)
  const metronomeVolume = useStore(s => s.metronomeVolume)
  const setMetronomeVolume = useStore(s => s.setMetronomeVolume)
  const grooveTemplates = useStore(s => s.grooveTemplates)
  const activeGrooveTemplateId = useStore(s => s.activeGrooveTemplateId)
  const setActiveGrooveTemplateId = useStore(s => s.setActiveGrooveTemplateId)
  const grooveTimingStrength = useStore(s => s.grooveTimingStrength)
  const setGrooveTimingStrength = useStore(s => s.setGrooveTimingStrength)
  const grooveVelocityStrength = useStore(s => s.grooveVelocityStrength)
  const setGrooveVelocityStrength = useStore(s => s.setGrooveVelocityStrength)
  const grooveExtractionTargetAll = useStore(s => s.grooveExtractionTargetAll)
  const setGrooveExtractionTargetAll = useStore(s => s.setGrooveExtractionTargetAll)
  const applyGroove = useStore(s => s.applyGroove)
  const extractGroove = useStore(s => s.extractGroove)
  const [extractGrooveName, setExtractGrooveName] = useState("My Custom Groove")
  const bakeProceduralAutomation = useStore(s => s.bakeProceduralAutomation)
  const generateClipNotes = useStore(s => s.generateClipNotes)
  const [autoFormula, setAutoFormula] = useState("Math.sin(t / (192 / Math.PI)) * 0.5 + 0.5")
  const [autoPreset, setAutoPreset] = useState("sine")
  const [autoDensity, setAutoDensity] = useState(48)
  const [genOverwrite, setGenOverwrite] = useState(false)
  const [genPitch, setGenPitch] = useState(60)
  const quantizeInputEnabled = useStore(s => s.quantizeInputEnabled)
  const setQuantizeInputEnabled = useStore(s => s.setQuantizeInputEnabled)
  const playheadBar = useStore(s => Math.floor(s.playheadPosition / (192 * 4)) * (192 * 4))
  const notes = useStore(s => s.notes)
  const selectedNoteIds = useStore(s => s.selectedNoteIds)
  const setSelectedNoteIds = useStore(s => s.setSelectedNoteIds)
  const addNote = useStore(s => s.addNote)
  const updateNote = useStore(s => s.updateNote)
  const commitHistory = useStore(s => s.commitHistory)
  const clips = useStore(s => s.clips)
  const addClip = useStore(s => s.addClip)
  const removeClip = useStore(s => s.removeClip)
  const updateClip = useStore(s => s.updateClip)
  const groups = useStore(s => s.groups)
  const addGroup = useStore(s => s.addGroup)
  const removeGroup = useStore(s => s.removeGroup)
  const updateGroup = useStore(s => s.updateGroup)
  const syncTrackSettings = useStore(s => s.syncTrackSettings)
  const automationCurves = useStore(s => s.automationCurves)
  const automationLanes = useStore(s => s.automationLanes)
  const updateAutomationLane = useStore(s => s.updateAutomationLane)

  const clearAutomationCurve = useStore(s => s.clearAutomationCurve)
  const getMaxTicks = useStore(s => s.getMaxTicks)
  const loopStart = useStore(s => s.loopStart)
  const setLoopStart = useStore(s => s.setLoopStart)
  const loopEnd = useStore(s => s.loopEnd)
  const setLoopEnd = useStore(s => s.setLoopEnd)
  const globalBpm = useStore(s => s.bpm)
  const timeSignature = useStore(s => s.timeSignature)
  const setTimeSignature = useStore(s => s.setTimeSignature)
  const gridSplitOrder = useStore(s => s.gridSplitOrder)
  const setGridSplitOrder = useStore(s => s.setGridSplitOrder)
  const gridPaneMode = useStore(s => s.gridPaneMode)
  const setGridPaneMode = useStore(s => s.setGridPaneMode)

  const showSynthVelocity = useStore(s => s.showSynthVelocity)
  const showDrumVelocity = useStore(s => s.showDrumVelocity)
  const setShowSynthVelocity = useStore(s => s.setShowSynthVelocity)
  const setShowDrumVelocity = useStore(s => s.setShowDrumVelocity)
  const vocalVelocityMin = useStore(s => s.vocalVelocityMin)
  const vocalVelocityMax = useStore(s => s.vocalVelocityMax)
  const vocalVelocityScale = useStore(s => s.vocalVelocityScale)
  const vocalVelocityEnabled = useStore(s => s.vocalVelocityEnabled)
  const setVocalVelocityMin = useStore(s => s.setVocalVelocityMin)
  const setVocalVelocityMax = useStore(s => s.setVocalVelocityMax)
  const setVocalVelocityScale = useStore(s => s.setVocalVelocityScale)
  const setVocalVelocityEnabled = useStore(s => s.setVocalVelocityEnabled)

  // Vocal Presets store selectors
  const voicePresets = useStore(s => s.voicePresets)
  const addVoicePreset = useStore(s => s.addVoicePreset)
  const deleteVoicePreset = useStore(s => s.deleteVoicePreset)

  const [selectedVoicePresetId, setSelectedVoicePresetId] = useState<string>('soprano')
  const voiceFileInputRef = useRef<HTMLInputElement>(null)

  const paneRef = useRef<HTMLDivElement>(null)
  const isDraggingPaneSplit = useRef(false)
  // contextMenu moved up
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const [chordFamily, setChordFamily] = useState('Triads')
  const [customChordFormula, setCustomChordFormula] = useState('0, 4, 7')
  const [chordRootNote, setChordRootNote] = useState<number>(0)
  const [chordOctave, setChordOctave] = useState<number>(3)
  const [progressionSpacing, setProgressionSpacing] = useState<number>(192)
  const [suggestionKind, setSuggestionKind] = useState<SuggestionKind>('chords')
  const [generationSourceMode, setGenerationSourceMode] = useState<'active' | 'all'>('active')
  const [generationDestinationMode, setGenerationDestinationMode] = useState<'new' | 'current'>('new')
  const [quantizeStrength, setQuantizeStrength] = useState(100)
  const leftPaneTopRatio = useStore(s => s.leftPaneTopRatio)
  const setLeftPaneTopRatio = useStore(s => s.setLeftPaneTopRatio)
  const isLeftPaneFlipped = useStore(s => s.isLeftPaneFlipped)
  const setIsLeftPaneFlipped = useStore(s => s.setIsLeftPaneFlipped)
  const [isAiLoading, setIsAiLoading] = useState(false)

  // AI Lab: Beat Morphing states
  const [morphTargetTrackId, setMorphTargetTrackId] = useState<string>('')
  const [morphSteps, setMorphSteps] = useState<number>(3)
  const [isMorphing, setIsMorphing] = useState(false)

  const renderGenerationSettings = () => (
    <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '8px', marginBottom: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '10px', color: '#999', fontWeight: 600 }}>Source Notes</span>
        <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px' }}>
          <button onClick={() => setGenerationSourceMode('active')} style={{ padding: '2px 8px', borderRadius: '4px', border: 'none', background: generationSourceMode === 'active' ? 'rgba(255,255,255,0.1)' : 'transparent', color: generationSourceMode === 'active' ? '#fff' : '#666', fontSize: '9px', cursor: 'pointer', transition: 'all 0.2s' }}>Active Track</button>
          <button onClick={() => setGenerationSourceMode('all')} style={{ padding: '2px 8px', borderRadius: '4px', border: 'none', background: generationSourceMode === 'all' ? 'rgba(255,255,255,0.1)' : 'transparent', color: generationSourceMode === 'all' ? '#fff' : '#666', fontSize: '9px', cursor: 'pointer', transition: 'all 0.2s' }}>All Tracks</button>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '10px', color: '#999', fontWeight: 600 }}>Destination</span>
        <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px' }}>
          <button onClick={() => setGenerationDestinationMode('new')} style={{ padding: '2px 8px', borderRadius: '4px', border: 'none', background: generationDestinationMode === 'new' ? 'rgba(255,255,255,0.1)' : 'transparent', color: generationDestinationMode === 'new' ? '#fff' : '#666', fontSize: '9px', cursor: 'pointer', transition: 'all 0.2s' }}>New Track</button>
          <button onClick={() => setGenerationDestinationMode('current')} style={{ padding: '2px 8px', borderRadius: '4px', border: 'none', background: generationDestinationMode === 'current' ? 'rgba(255,255,255,0.1)' : 'transparent', color: generationDestinationMode === 'current' ? '#fff' : '#666', fontSize: '9px', cursor: 'pointer', transition: 'all 0.2s' }}>Current Track</button>
        </div>
      </div>
    </div>
  )

  const utilitySourcePitch = useStore(s => s.utilitySourcePitch)
  const setUtilitySourcePitch = useStore(s => s.setUtilitySourcePitch)
  const utilityTargetPitch = useStore(s => s.utilityTargetPitch)
  const setUtilityTargetPitch = useStore(s => s.setUtilityTargetPitch)
  const utilitySourceCol = useStore(s => s.utilitySourceCol)
  const setUtilitySourceCol = useStore(s => s.setUtilitySourceCol)
  const utilityTargetCol = useStore(s => s.utilityTargetCol)
  const setUtilityTargetCol = useStore(s => s.setUtilityTargetCol)
  const utilityPicker = useStore(s => s.utilityPicker)
  const setUtilityPicker = useStore(s => s.setUtilityPicker)

  // Synth Lab states
  const [designerName, setDesignerName] = useState('Untitled Instrument 1')
  const [designerEngine, setDesignerEngine] = useState<'Synth' | 'FMSynth' | 'MonoSynth'>('Synth')
  const [designerOscillator, setDesignerOscillator] = useState<'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom'>('triangle')
  const [designerWaveformMode, setDesignerWaveformMode] = useState<'standard' | 'fourier'>('standard')
  const [designerFourierExpr, setDesignerFourierExpr] = useState('sin(t) + 0.5 * sin(3*t)')
  const [designerFourierCount, setDesignerFourierCount] = useState(16)
  const [designerAttack, setDesignerAttack] = useState(0.01)
  const [designerDecay, setDesignerDecay] = useState(0.12)
  const [designerSustain, setDesignerSustain] = useState(0.48)
  const [designerRelease, setDesignerRelease] = useState(0.35)
  // FM states
  const [designerHarmonicity, setDesignerHarmonicity] = useState(2.0)
  const [designerModulationIndex, setDesignerModulationIndex] = useState(5.0)
  const [designerModAttack, setDesignerModAttack] = useState(0.01)
  const [designerModDecay, setDesignerModDecay] = useState(0.1)
  const [designerModSustain, setDesignerModSustain] = useState(0.2)
  const [designerModRelease, setDesignerModRelease] = useState(0.3)
  // Mono states
  const [designerFilterFreq, setDesignerFilterFreq] = useState(2000)
  const [designerFilterQ, setDesignerFilterQ] = useState(1.0)
  const [designerFilterType, setDesignerFilterType] = useState<'lowpass' | 'highpass' | 'bandpass'>('lowpass')
  const [designerFilterRolloff, setDesignerFilterRolloff] = useState<-12 | -24 | -48>(-24)
  const [designerFilterEnvAttack, setDesignerFilterEnvAttack] = useState(0.01)
  const [designerFilterEnvDecay, setDesignerFilterEnvDecay] = useState(0.15)
  const [designerFilterEnvSustain, setDesignerFilterEnvSustain] = useState(0.3)
  const [designerFilterEnvRelease, setDesignerFilterEnvRelease] = useState(0.3)
  const [designerFilterEnvBaseFrequency, setDesignerFilterEnvBaseFrequency] = useState(100)
  const [designerFilterEnvOctaves, setDesignerFilterEnvOctaves] = useState(4)

  const [designerShowTrackSelector, setDesignerShowTrackSelector] = useState(false)
  const [pmShowTrackSelector, setPmShowTrackSelector] = useState(false)
  const [designerNameIndex, setDesignerNameIndex] = useState(1)

  // Drum Lab states
  const [designerTab, setDesignerTab] = useState<'synth' | 'drum'>('synth')
  const [designerDrumPiece, setDesignerDrumPiece] = useState<string>('0')
  const [designerDrumKitConfig, setDesignerDrumKitConfig] = useState<Record<string, any>>({
    kick: {
      octaves: 3,
      pitchDecay: 0.05,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.08 }
    },
    snare: {
      noise: { type: 'white' },
      envelope: { attack: 0.004, decay: 0.14, sustain: 0 }
    },
    hihatClosed: {
      envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000
    },
    hihatOpen: {
      envelope: { attack: 0.001, decay: 0.3, release: 0.1 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000
    },
    clap: {
      noise: { type: 'pink' },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0 }
    },
    tomLow: { octaves: 4, pitchDecay: 0.05, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 0.1 } },
    tomMid: { octaves: 4, pitchDecay: 0.05, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.1 } },
    tomHigh: { octaves: 4, pitchDecay: 0.05, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.1 } },
    crash: { envelope: { attack: 0.001, decay: 2.0, release: 0.5 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000 },
    ride: { envelope: { attack: 0.001, decay: 3.0, release: 0.5 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000 },
    cowbell: { envelope: { attack: 0.001, decay: 0.5, release: 0.1 }, harmonicity: 0.2, modulationIndex: 10, resonance: 800 },
    tambourine: { noise: { type: 'white' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0 } },
    congaLow: { octaves: 2, pitchDecay: 0.01, oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.1 } },
    congaHigh: { octaves: 2, pitchDecay: 0.01, oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.1 } },
    claves: { octaves: 1, pitchDecay: 0.01, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 } },
    rimshot: { noise: { type: 'brown' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }
  })

  const updatePieceParam = (piece: string, path: string[], value: any) => {
    setDesignerDrumKitConfig(prev => {
      const updated = { ...prev }
      let curr = updated[piece] = { ...updated[piece] }
      for (let i = 0; i < path.length - 1; i++) {
        curr[path[i]] = { ...curr[path[i]] }
        curr = curr[path[i]]
      }
      curr[path[path.length - 1]] = value
      return updated
    })
  }

  const [pruneTargetCount, setPruneTargetCount] = useState<number | null>(null)
  const [pruneSelectedPitches, setPruneSelectedPitches] = useState<Set<number>>(new Set())

  const handleRowRangeChange = (newCount: number) => {
    if (!activeTrack) return
    const rows = activeTrack.drumRows ?? DEFAULT_DRUM_ROWS
    const currentCount = rows.length
    if (newCount === currentCount) {
      setPruneTargetCount(null)
      return
    }
    if (newCount > currentCount) {
      const addedCount = newCount - currentCount
      const newRows = [...rows]
      for (let i = 0; i < addedCount; i++) {
        const nextPitch = Math.max(15, ...newRows.map(r => r.pitch)) + 1
        const index = nextPitch - 15
        const hue = (index * 73) % 360
        newRows.push({
          name: `Custom Channel ${index}`,
          pitch: nextPitch,
          color: `hsl(${hue}, 80%, 65%)`,
          defaultName: `Custom Channel ${index}`
        })
      }
      updateTrack(activeTrack.id, { drumRows: newRows })
      setPruneTargetCount(null)
    } else {
      setPruneTargetCount(newCount)
      const toPruneCount = currentCount - newCount
      const initialPrunes = new Set<number>()
      const sortedRows = [...rows].sort((a, b) => b.pitch - a.pitch)
      for (let i = 0; i < toPruneCount; i++) {
        if (sortedRows[i]) {
          initialPrunes.add(sortedRows[i].pitch)
        }
      }
      setPruneSelectedPitches(initialPrunes)
    }
  }

  const handleConfirmPrune = () => {
    if (!activeTrack || pruneTargetCount === null) return
    const rows = activeTrack.drumRows ?? DEFAULT_DRUM_ROWS
    const remainingRows = rows.filter(r => !pruneSelectedPitches.has(r.pitch))

    commitHistory()
    const allNotes = useStore.getState().notes
    const prunedNoteIds = allNotes.filter(n => n.trackId === activeTrack.id && pruneSelectedPitches.has(n.pitch)).map(n => n.id)
    prunedNoteIds.forEach(id => removeNote(id))

    updateTrack(activeTrack.id, { drumRows: remainingRows })
    setPruneTargetCount(null)
    setPruneSelectedPitches(new Set())
    useStore.getState().showToast(`Pruned ${pruneSelectedPitches.size} channels from grid!`, 'info')
  }

  const setPieceVoiceType = (key: string, type: 'membrane' | 'noise' | 'metal') => {
    setDesignerDrumKitConfig(prev => {
      const updated = { ...prev }
      if (type === 'membrane') {
        updated[key] = {
          octaves: 3,
          pitchDecay: 0.05,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 }
        }
      } else if (type === 'noise') {
        updated[key] = {
          noise: { type: 'white' },
          envelope: { attack: 0.004, decay: 0.14, sustain: 0 }
        }
      } else {
        updated[key] = {
          envelope: { attack: 0.001, decay: 0.5, release: 0.1 },
          harmonicity: 5.1,
          modulationIndex: 32,
          resonance: 4000
        }
      }
      return updated
    })
  }

  const swapNotes = (p1: number, p2: number) => {
    if (p1 === p2) return
    const trackId = activeTrackId
    if (!trackId) return
    commitHistory()
    const allNotes = useStore.getState().notes
    const updatedNotes = allNotes.map(n => {
      if (n.trackId === trackId) {
        if (n.pitch === p1) return { ...n, pitch: p2 }
        if (n.pitch === p2) return { ...n, pitch: p1 }
      }
      return n
    })
    useStore.setState({ notes: updatedNotes })
  }

  const mergeNotes = (src: number, target: number) => {
    if (src === target) return
    const trackId = activeTrackId
    if (!trackId) return
    commitHistory()
    const allNotes = useStore.getState().notes
    const updatedNotes = allNotes.map(n => {
      if (n.trackId === trackId && n.pitch === src) {
        return { ...n, pitch: target }
      }
      return n
    })
    useStore.setState({ notes: updatedNotes })
  }

  const swapColumns = (c1: number, c2: number) => {
    if (c1 === c2) return
    const trackId = activeTrackId
    if (!trackId) return
    commitHistory()
    const blockTicks = useStore.getState().gridBlockTicks
    const t1_start = c1 * blockTicks
    const t1_end = (c1 + 1) * blockTicks
    const t2_start = c2 * blockTicks
    const t2_end = (c2 + 1) * blockTicks
    const offset = (c2 - c1) * blockTicks

    const allNotes = useStore.getState().notes
    const updatedNotes = allNotes.map(n => {
      if (n.trackId === trackId) {
        if (n.time >= t1_start && n.time < t1_end) return { ...n, time: n.time + offset }
        if (n.time >= t2_start && n.time < t2_end) return { ...n, time: n.time - offset }
      }
      return n
    })
    useStore.setState({ notes: updatedNotes })
  }

  const mergeColumns = (src: number, target: number) => {
    if (src === target) return
    const trackId = activeTrackId
    if (!trackId) return
    commitHistory()
    const blockTicks = useStore.getState().gridBlockTicks
    const t_src_start = src * blockTicks
    const t_src_end = (src + 1) * blockTicks
    const offset = (target - src) * blockTicks

    const allNotes = useStore.getState().notes
    const updatedNotes = allNotes.map(n => {
      if (n.trackId === trackId && n.time >= t_src_start && n.time < t_src_end) {
        return { ...n, time: n.time + offset }
      }
      return n
    })
    useStore.setState({ notes: updatedNotes })
  }

  const pitchOptions = useMemo(() => {
    if (!activeTrack) return []
    if (activeTrack.instrument === 'drum') {
      return [
        { label: 'Kick', value: 0 },
        { label: 'Snare', value: 1 },
        { label: 'Closed Hat', value: 2 },
        { label: 'Open Hat', value: 3 },
        { label: 'Clap', value: 4 },
      ]
    } else {
      const opts = []
      for (let i = 0; i < 88; i++) {
        opts.push({ label: getNoteName(i), value: i })
      }
      return opts
    }
  }, [activeTrack])
  const [aiTemperature, setAiTemperature] = useState(1.0)
  const [aiLength, setAiLength] = useState(64)
  const [aiSeedBars, setAiSeedBars] = useState(2)
  const [aiDensity, setAiDensity] = useState(1.0)
  const [aiOctaveShift, setAiOctaveShift] = useState(0)
  const [aiSeedPitch, setAiSeedPitch] = useState<number | 'auto'>('auto')
  const projectExportData = useStore(s => s.projectExportData)
  const setProjectExportData = useStore(s => s.setProjectExportData)
  const midiRemapData = useStore(s => s.midiRemapData)
  const setMidiRemapData = useStore(s => s.setMidiRemapData)
  const [showResetSelection, setShowResetSelection] = useState(false)
  const [selectedPanesToReset, setSelectedPanesToReset] = useState({
    engine: true,
    metronome: true,
    playback: true,
    grid: true,
    tools: true,
    scale: true,
    layout: true,
    visuals: true,
    velocity: true,
    groove: true,
    deduplicate: true,
    presets: false
  })
  const [manualPitchInput, setManualPitchInput] = useState('')
  const [hoveredLabTrack, setHoveredLabTrack] = useState<number | null>(null)
  const [draftDrumMap, setDraftDrumMap] = useState<Record<number, number>>({})
  const [draftSynthMap, setDraftSynthMap] = useState<Record<number, number>>({})
  const [draftExclusions, setDraftExclusions] = useState<Set<number>>(new Set())
  const [draftDrumMutes, setDraftDrumMutes] = useState<Set<number>>(new Set())
  const [draftSynthMutes, setDraftSynthMutes] = useState<Set<number>>(new Set())
  const [prevMidiRemap, setPrevMidiRemap] = useState(midiRemapData.midi)

  if (midiRemapData.midi !== prevMidiRemap) {
    setPrevMidiRemap(midiRemapData.midi)
    if (midiRemapData.midi) {
      setDraftDrumMap(midiRemapData.drumMap || {})
      setDraftSynthMap(midiRemapData.synthMap || {})
      setDraftExclusions(new Set())
      setDraftDrumMutes(new Set())
      setDraftSynthMutes(new Set())
    }
  }
  const [midiImportData, setMidiImportData] = useState<{
    midi: Midi;
    trackId: string;
    octaveOffset: number;
    semitoneOffset: number;
    isDrum: boolean;
    smartMapping: boolean;
    drumMapOffset: number;
    inheritTempo: boolean;
  } | null>(null)

  const [sheetImportData, setSheetImportData] = useState<{
    xmlText: string;
    filename: string;
    trackId: string;
    octaveOffset: number;
    semitoneOffset: number;
    isDrum: boolean;
    smartMapping: boolean;
    importPitchSlides: boolean;
    importVelocity: boolean;
    defaultVelocity: number;
    snapToGrid: boolean;
    inheritTempo: boolean;
    parsedBpm?: number;
  } | null>(null)

  const [prevTracksLength, setPrevTracksLength] = useState(tracks.length)

  if (tracks.length !== prevTracksLength) {
    setPrevTracksLength(tracks.length)
    if (tracks.length === 0) {
      setMidiImportData(null)
      setSheetImportData(null)
      setUtilityPicker(null)
    }
  }

  const activeTrackNotes = notes.filter(note => note.trackId === activeTrackId)
  const activeCurve = activeTrackId ? automationCurves[activeTrackId] ?? [] : []
  const activeLane = activeTrackId ? automationLanes[activeTrackId] : undefined
  const editTargets = selectedNoteIds.length > 0
    ? notes.filter(note => selectedNoteIds.includes(note.id))
    : activeTrackNotes
  const editTargetLabel = selectedNoteIds.length > 0 ? `${selectedNoteIds.length} selected` : 'active track'

  const suggestions = useMemo(() => createProceduralSuggestions(suggestionKind, {
    notes,
    tracks,
    activeTrackId: generationSourceMode === 'all' ? null : activeTrackId,
    scaleLock: activeTrack?.scaleOverride || scaleLock,
    playheadPosition: playheadBar,
  }), [suggestionKind, notes, tracks, activeTrackId, scaleLock, activeTrack?.scaleOverride, playheadBar, generationSourceMode])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingPaneSplit.current || !paneRef.current) return
      const rect = paneRef.current.getBoundingClientRect()
      const nextRatio = (event.clientY - rect.top) / rect.height
      setLeftPaneTopRatio(clamp(nextRatio, 0.28, 0.78))
    }
    const handleMouseUp = () => {
      isDraggingPaneSplit.current = false
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

  const metronomeSettings = useStore(state => state.metronomeSettings)
  const updateMetronome = useStore(state => state.updateMetronome)
  const studioSettings = useStore(state => state.studioSettings)
  const updateStudio = useStore(state => state.updateStudio)
  const limiterEnabled = studioSettings.limiterEnabled ?? true
  const limiterThreshold = studioSettings.limiterThreshold ?? -1.5
  const persistenceEnabled = studioSettings.persistenceEnabled ?? true

  const handleResetSettings = () => {
    commitHistory()

    // 1. Reset studio engine settings
    updateStudio({
      renderFadeDuration: 2.0,
      normalizationTarget: -0.1,
      loopEndBuffer: 192,
      masterVolume: 1.0,
      limiterEnabled: true,
      limiterThreshold: -1.5,
      proceduralFxEnabled: false,
      proceduralFxRate: '16n',
      persistenceEnabled: true,
    })

    // 2. Reset click/metronome synthesizer settings
    updateMetronome({
      pitchDecay: 0.01,
      octaves: 2,
      attack: 0.001,
      decay: 0.1,
      sustain: 0,
      release: 0.1,
      volume: -6,
      downbeatPitch: 'C6',
      upbeatPitch: 'C5',
      downbeatVel: 1.0,
      upbeatVel: 0.65,
    })

    audioEngine.setBpm(120)

    // 3. Reset all workstation, grid, layout, velocity, scale, and tool properties to defaults
    useStore.setState({
      bpm: 120,
      timeSignature: '4/4',
      engineMode: 'tone',
      metronomeEnabled: false,
      metronomeVolume: 0.5,
      activeTool: 'draw',
      snapEnabled: true,
      snapResolution: 48,
      gridBlockTicks: 48,
      dropSnap: true,
      gridShadeEvery: 4,
      gridColumnCount: 200,
      drumSteps: 16,
      autoExtendGrid: true,
      minNoteSize: 24,
      gridResizable: false,
      swing: 0,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 768,
      scaleLock: { enabled: false, root: 0, mode: 'Major', accidental: 'sharp' },
      pitchSnapEnabled: true,
      pitchDropSnap: true,
      pitchSnapSensitivity: 50,
      verticalMergeThreshold: 0.5,
      verticalStretchMode: 'glide',
      glideStyle: 'smooth',
      synthLowerOctave: 2,
      synthUpperOctave: 6,
      grooveTimingStrength: 100,
      grooveVelocityStrength: 100,
      quantizeInputEnabled: true,
      quantizeStrength: 100,
      grooveTemplates: defaultGrooveTemplates,
      activeGrooveTemplateId: null,
      grooveExtractionTargetAll: true,
      gridSplitOrder: 'synth-first',
      gridPaneMode: 'split',
      splitRatio: 0.5,
      leftPaneTopRatio: 0.5,
      isLeftPaneFlipped: false,
      leftPaneWidth: 320,
      leftPaneCollapsed: false,
      scrollBoth: false,
      bothGridActive: false,
      readOnlyMode: false,
      horizScrollLockEnabled: false,
      vertScrollLockEnabled: false,
      completeNotesOnPause: true,
      midiOverdub: true,
      deduplicateEnabled: true,
      deduplicateProximityTolerance: 4.8,
      deduplicateOverlapThreshold: 0.5,
      noteInspectorEnabled: false,
      playheadFollowMode: 'playhead',
      zoomSynth: 1,
      zoomDrum: 1,
      syncZoom: true,
      ghostNotesEnabled: false,
      ghostNoteOpacity: 0.35,
      ghostCrossInstrument: false,
      showSynthVelocity: false,
      showDrumVelocity: false,
      vocalVelocityEnabled: false,
      vocalVelocityMin: 30,
      vocalVelocityMax: 120,
      vocalVelocityScale: 1,
      customSynthRows: [],
      customDrumRows: []
    })

    useStore.getState().showToast('All workstation settings reset to factory defaults!', 'success')
  }

  const handleCustomReset = () => {
    commitHistory()
    let resetCount = 0
    const updates: any = {}

    // 1. Engine
    if (selectedPanesToReset.engine) {
      updateStudio({
        renderFadeDuration: 2.0,
        normalizationTarget: -0.1,
        loopEndBuffer: 192,
        masterVolume: 1.0,
        limiterEnabled: true,
        limiterThreshold: -1.5,
        proceduralFxEnabled: false,
        proceduralFxRate: '16n'
      })
      updates.engineMode = 'tone'
      updates.completeNotesOnPause = true
      resetCount++
    }

    // 2. Click / Metronome
    if (selectedPanesToReset.metronome) {
      updateMetronome({
        pitchDecay: 0.01,
        octaves: 2,
        attack: 0.001,
        decay: 0.1,
        sustain: 0,
        release: 0.1,
        volume: -6,
        downbeatPitch: 'C6',
        upbeatPitch: 'C5',
        downbeatVel: 1.0,
        upbeatVel: 0.65,
      })
      updates.metronomeEnabled = false
      updates.metronomeVolume = 0.5
      resetCount++
    }

    // 3. Playback & Timing
    if (selectedPanesToReset.playback) {
      updates.bpm = 120
      audioEngine.setBpm(120)
      updates.timeSignature = '4/4'
      updates.loopEnabled = false
      updates.loopStart = 0
      updates.loopEnd = 768
      updates.swing = 0
      updates.playheadFollowMode = 'playhead'
      updates.midiOverdub = true
      resetCount++
    }

    // 4. Grid & Quantization
    if (selectedPanesToReset.grid) {
      updates.snapEnabled = true
      updates.snapResolution = 48
      updates.gridBlockTicks = 48
      updates.dropSnap = true
      updates.gridShadeEvery = 4
      updates.gridColumnCount = 200
      updates.drumSteps = 16
      updates.autoExtendGrid = true
      updates.minNoteSize = 24
      updates.gridResizable = false
      updates.quantizeInputEnabled = true
      updates.quantizeStrength = 100
      resetCount++
    }

    // 5. Tools & Inspector
    if (selectedPanesToReset.tools) {
      updates.activeTool = 'draw'
      updates.noteInspectorEnabled = false
      updates.readOnlyMode = false
      resetCount++
    }

    // 6. Scale Lock & Free Pitch
    if (selectedPanesToReset.scale) {
      updates.scaleLock = { enabled: false, root: 0, mode: 'Major', accidental: 'sharp' }
      updates.pitchSnapEnabled = true
      updates.pitchDropSnap = true
      updates.pitchSnapSensitivity = 50
      updates.verticalMergeThreshold = 0.5
      updates.verticalStretchMode = 'glide'
      updates.glideStyle = 'smooth'
      updates.synthLowerOctave = 2
      updates.synthUpperOctave = 6
      updates.customSynthRows = []
      updates.customDrumRows = []
      resetCount++
    }

    // 7. Workstation Layout & Splits
    if (selectedPanesToReset.layout) {
      updates.gridSplitOrder = 'synth-first'
      updates.gridPaneMode = 'split'
      updates.splitRatio = 0.5
      updates.leftPaneTopRatio = 0.5
      updates.isLeftPaneFlipped = false
      updates.leftPaneWidth = 320
      updates.leftPaneCollapsed = false
      updates.scrollBoth = false
      updates.bothGridActive = false
      updates.horizScrollLockEnabled = false
      updates.vertScrollLockEnabled = false
      resetCount++
    }

    // 8. Visuals, Zoom & Ghost Notes
    if (selectedPanesToReset.visuals) {
      updates.zoomSynth = 1
      updates.zoomDrum = 1
      updates.syncZoom = true
      updates.ghostNotesEnabled = false
      updates.ghostNoteOpacity = 0.35
      updates.ghostCrossInstrument = false
      resetCount++
    }

    // 9. Velocity Lanes
    if (selectedPanesToReset.velocity) {
      updates.showSynthVelocity = false
      updates.showDrumVelocity = false
      updates.vocalVelocityEnabled = false
      updates.vocalVelocityMin = 30
      updates.vocalVelocityMax = 120
      updates.vocalVelocityScale = 1
      resetCount++
    }

    // 10. Groove Pool
    if (selectedPanesToReset.groove) {
      updates.grooveTemplates = defaultGrooveTemplates
      updates.activeGrooveTemplateId = null
      updates.grooveTimingStrength = 100
      updates.grooveVelocityStrength = 100
      updates.grooveExtractionTargetAll = true
      resetCount++
    }

    // 11. Deduplication Engine
    if (selectedPanesToReset.deduplicate) {
      updates.deduplicateEnabled = true
      updates.deduplicateProximityTolerance = 4.8
      updates.deduplicateOverlapThreshold = 0.5
      resetCount++
    }

    // 12. Custom Presets (FX & Voices)
    if (selectedPanesToReset.presets) {
      updates.voicePresets = DEFAULT_VOICE_PRESETS
      localStorage.setItem('musegrid_voice_presets', JSON.stringify(DEFAULT_VOICE_PRESETS))
      resetCount++
    }

    if (resetCount > 0) {
      if (Object.keys(updates).length > 0) {
        useStore.setState(updates)
      }
      useStore.getState().showToast(`Reset ${resetCount} selected areas to defaults!`, 'success')
      setShowResetSelection(false)
    } else {
      useStore.getState().showToast('No settings selected for reset', 'info')
    }
  }

  const handleExportSettings = async () => {
    try {
      const state = useStore.getState()
      const settingsData = {
        type: 'musegrid_settings',
        version: '1.2.0',
        timestamp: new Date().toISOString(),
        // 1. Studio & Engine
        studioSettings,
        engineMode: state.engineMode,
        // 2. Metronome & Click
        metronomeSettings,
        metronomeEnabled: state.metronomeEnabled,
        metronomeVolume: state.metronomeVolume,
        // 3. Playback & Transport
        bpm: state.bpm,
        timeSignature: state.timeSignature,
        swing: state.swing,
        loopEnabled: state.loopEnabled,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        playheadFollowMode: state.playheadFollowMode,
        completeNotesOnPause: state.completeNotesOnPause,
        midiOverdub: state.midiOverdub,
        // 4. Tools & Interaction
        activeTool: state.activeTool,
        noteInspectorEnabled: state.noteInspectorEnabled,
        readOnlyMode: state.readOnlyMode,
        // 5. Grid, Snapping & Quantization
        snapEnabled: state.snapEnabled,
        snapResolution: state.snapResolution,
        gridBlockTicks: state.gridBlockTicks,
        dropSnap: state.dropSnap,
        gridShadeEvery: state.gridShadeEvery,
        gridColumnCount: state.gridColumnCount,
        drumSteps: state.drumSteps,
        autoExtendGrid: state.autoExtendGrid,
        minNoteSize: state.minNoteSize,
        gridResizable: state.gridResizable,
        quantizeInputEnabled: state.quantizeInputEnabled,
        quantizeStrength: state.quantizeStrength,
        // 6. Pitch, Scale & Free Pitch
        scaleLock: state.scaleLock,
        pitchSnapEnabled: state.pitchSnapEnabled,
        pitchDropSnap: state.pitchDropSnap,
        pitchSnapSensitivity: state.pitchSnapSensitivity,
        verticalMergeThreshold: state.verticalMergeThreshold,
        verticalStretchMode: state.verticalStretchMode,
        glideStyle: state.glideStyle,
        synthLowerOctave: state.synthLowerOctave,
        synthUpperOctave: state.synthUpperOctave,
        customSynthRows: state.customSynthRows,
        customDrumRows: state.customDrumRows,
        // 7. Workstation Layout & Splits
        gridSplitOrder: state.gridSplitOrder,
        gridPaneMode: state.gridPaneMode,
        splitRatio: state.splitRatio,
        leftPaneTopRatio: state.leftPaneTopRatio,
        isLeftPaneFlipped: state.isLeftPaneFlipped,
        leftPaneWidth: state.leftPaneWidth,
        leftPaneCollapsed: state.leftPaneCollapsed,
        scrollBoth: state.scrollBoth,
        bothGridActive: state.bothGridActive,
        horizScrollLockEnabled: state.horizScrollLockEnabled,
        vertScrollLockEnabled: state.vertScrollLockEnabled,
        // 8. Visuals, Zoom & Ghost Notes
        zoomSynth: state.zoomSynth,
        zoomDrum: state.zoomDrum,
        syncZoom: state.syncZoom,
        ghostNotesEnabled: state.ghostNotesEnabled,
        ghostNoteOpacity: state.ghostNoteOpacity,
        ghostCrossInstrument: state.ghostCrossInstrument,
        // 9. Velocity Lanes & Automation
        showSynthVelocity: state.showSynthVelocity,
        showDrumVelocity: state.showDrumVelocity,
        vocalVelocityEnabled: state.vocalVelocityEnabled,
        vocalVelocityMin: state.vocalVelocityMin,
        vocalVelocityMax: state.vocalVelocityMax,
        vocalVelocityScale: state.vocalVelocityScale,
        // 10. Deduplication Engine
        deduplicateEnabled: state.deduplicateEnabled,
        deduplicateProximityTolerance: state.deduplicateProximityTolerance,
        deduplicateOverlapThreshold: state.deduplicateOverlapThreshold,
        // 11. Groove Pool & Humanize
        grooveTemplates: state.grooveTemplates,
        activeGrooveTemplateId: state.activeGrooveTemplateId,
        grooveTimingStrength: state.grooveTimingStrength,
        grooveVelocityStrength: state.grooveVelocityStrength,
        grooveExtractionTargetAll: state.grooveExtractionTargetAll,
        // 12. Presets & Remap
        customFxConfigs: state.customFxConfigs,
        voicePresets: state.voicePresets,
        midiRemapData: state.midiRemapData,
      }

      const blob = new Blob([JSON.stringify(settingsData, null, 2)], { type: 'application/json' })
      const saved = await saveFileWithDialog(blob, {
        filename: 'musegrid_preferences.muzset',
        title: 'Save Preferences Preset',
        filters: [{ name: 'MuseGrid Preferences', extensions: ['muzset'] }]
      })
      if (saved) {
        state.showToast('All workstation settings exported as musegrid_preferences.muzset!', 'success')
      }
    } catch (err) {
      console.error('Failed to export settings:', err)
      useStore.getState().showToast('Failed to export settings', 'error')
    }
  }

  const handleSaveDefaultPreferences = () => {
    try {
      const state = useStore.getState()
      const settingsData = {
        type: 'musegrid_settings',
        version: '1.2.0',
        timestamp: new Date().toISOString(),
        studioSettings,
        engineMode: state.engineMode,
        metronomeSettings,
        metronomeEnabled: state.metronomeEnabled,
        metronomeVolume: state.metronomeVolume,
        bpm: state.bpm,
        timeSignature: state.timeSignature,
        swing: state.swing,
        loopEnabled: state.loopEnabled,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        playheadFollowMode: state.playheadFollowMode,
        completeNotesOnPause: state.completeNotesOnPause,
        midiOverdub: state.midiOverdub,
        activeTool: state.activeTool,
        noteInspectorEnabled: state.noteInspectorEnabled,
        readOnlyMode: state.readOnlyMode,
        snapEnabled: state.snapEnabled,
        snapResolution: state.snapResolution,
        gridBlockTicks: state.gridBlockTicks,
        dropSnap: state.dropSnap,
        gridShadeEvery: state.gridShadeEvery,
        gridColumnCount: state.gridColumnCount,
        drumSteps: state.drumSteps,
        autoExtendGrid: state.autoExtendGrid,
        minNoteSize: state.minNoteSize,
        gridResizable: state.gridResizable,
        quantizeInputEnabled: state.quantizeInputEnabled,
        quantizeStrength: state.quantizeStrength,
        scaleLock: state.scaleLock,
        pitchSnapEnabled: state.pitchSnapEnabled,
        pitchDropSnap: state.pitchDropSnap,
        pitchSnapSensitivity: state.pitchSnapSensitivity,
        verticalMergeThreshold: state.verticalMergeThreshold,
        verticalStretchMode: state.verticalStretchMode,
        glideStyle: state.glideStyle,
        synthLowerOctave: state.synthLowerOctave,
        synthUpperOctave: state.synthUpperOctave,
        customSynthRows: state.customSynthRows,
        customDrumRows: state.customDrumRows,
        gridSplitOrder: state.gridSplitOrder,
        gridPaneMode: state.gridPaneMode,
        splitRatio: state.splitRatio,
        leftPaneTopRatio: state.leftPaneTopRatio,
        isLeftPaneFlipped: state.isLeftPaneFlipped,
        leftPaneWidth: state.leftPaneWidth,
        leftPaneCollapsed: state.leftPaneCollapsed,
        scrollBoth: state.scrollBoth,
        bothGridActive: state.bothGridActive,
        horizScrollLockEnabled: state.horizScrollLockEnabled,
        vertScrollLockEnabled: state.vertScrollLockEnabled,
        zoomSynth: state.zoomSynth,
        zoomDrum: state.zoomDrum,
        syncZoom: state.syncZoom,
        ghostNotesEnabled: state.ghostNotesEnabled,
        ghostNoteOpacity: state.ghostNoteOpacity,
        ghostCrossInstrument: state.ghostCrossInstrument,
        showSynthVelocity: state.showSynthVelocity,
        showDrumVelocity: state.showDrumVelocity,
        vocalVelocityEnabled: state.vocalVelocityEnabled,
        vocalVelocityMin: state.vocalVelocityMin,
        vocalVelocityMax: state.vocalVelocityMax,
        vocalVelocityScale: state.vocalVelocityScale,
        deduplicateEnabled: state.deduplicateEnabled,
        deduplicateProximityTolerance: state.deduplicateProximityTolerance,
        deduplicateOverlapThreshold: state.deduplicateOverlapThreshold,
        grooveTemplates: state.grooveTemplates,
        activeGrooveTemplateId: state.activeGrooveTemplateId,
        grooveTimingStrength: state.grooveTimingStrength,
        grooveVelocityStrength: state.grooveVelocityStrength,
        grooveExtractionTargetAll: state.grooveExtractionTargetAll,
        customFxConfigs: state.customFxConfigs,
        voicePresets: state.voicePresets,
        midiRemapData: state.midiRemapData,
      }
      localStorage.setItem('musegrid_default_preferences', JSON.stringify(settingsData))
      state.showToast('All settings saved as default startup configuration!', 'success')
    } catch (err) {
      console.error('Failed to save default settings:', err)
      useStore.getState().showToast('Failed to save default settings', 'error')
    }
  }

  const handleImportSettings = async () => {
    try {
      const file = await selectAndReadFile({
        title: 'Import Settings',
        accept: '.muzset',
        extensions: ['muzset'],
        fileTypeName: 'MuseGrid Settings'
      })
      if (!file) return

      const text = new TextDecoder('utf-8').decode(file.data)
      const parsed = JSON.parse(text)
      if (parsed.type !== 'musegrid_settings') {
        useStore.getState().showToast('Invalid settings file format', 'error')
        return
      }

      commitHistory() // Support Undo of settings import!

      // Safely merge and apply
      if (parsed.studioSettings) updateStudio(parsed.studioSettings)
      if (parsed.metronomeSettings) updateMetronome(parsed.metronomeSettings)

      if (parsed.bpm !== undefined && !isNaN(parsed.bpm) && parsed.bpm > 0) {
        audioEngine.setBpm(parsed.bpm)
      }
      if (parsed.customFxConfigs !== undefined) {
        localStorage.setItem('musegrid_custom_fx_configs', JSON.stringify(parsed.customFxConfigs))
      }
      if (parsed.voicePresets !== undefined) {
        localStorage.setItem('musegrid_voice_presets', JSON.stringify(parsed.voicePresets))
      }

      // Apply top level workstation settings
      const topLevelUpdates: any = {}
      const keys = [
        'engineMode', 'metronomeEnabled', 'metronomeVolume',
        'bpm', 'timeSignature', 'swing', 'loopEnabled', 'loopStart', 'loopEnd',
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
        'customFxConfigs', 'voicePresets', 'midiRemapData'
      ]
      keys.forEach(k => {
        if (parsed[k] !== undefined) {
          topLevelUpdates[k] = parsed[k]
        }
      })

      useStore.setState(topLevelUpdates)
      useStore.getState().showToast('All workstation settings successfully loaded!', 'success')
    } catch (err) {
      console.error('Failed to import settings:', err)
      useStore.getState().showToast('Invalid or corrupted .muzset file', 'error')
    }
  }

  const handleAddTrack = (instrument: 'synth' | 'drum', parentId?: string, e?: React.MouseEvent) => {
    if (e && (e.ctrlKey || e.metaKey)) {
      const targetTracks = tracks.filter(t => t.instrument === instrument).map(t => t.id)
      useStore.getState().setSelectedTrackIds(targetTracks)
      if (parentId) setContextMenu(null)
      return
    }
    const id = `track_${newId()}`
    const parentTrack = parentId ? tracks.find(t => t.id === parentId) : null

    addTrack({
      id,
      name: parentTrack
        ? `${parentTrack.name} ${instrument === 'synth' ? 'Layer' : 'Kit'}`
        : (instrument === 'synth' ? 'New Synth' : 'New Drum'),
      instrument,
      volume: parentTrack ? 0.8 : 1,
      pan: 0,
      muted: false,
      soloed: false,
      color: parentTrack ? parentTrack.color : TRACK_COLORS[(tracks.length) % TRACK_COLORS.length],
      collapsed: true,
      parentId,
      synthPreset: instrument === 'synth' ? DEFAULT_SYNTH_PRESET : undefined,
      drumKit: instrument === 'drum' ? DEFAULT_DRUM_KIT : undefined,
      drumRows: instrument === 'drum' ? DEFAULT_DRUM_ROWS : undefined,
      delayTime: 0.25,
      delayFeedback: 0.25,
    })
    audioEngine.createInstrument(id, instrument)
    if (parentId) setContextMenu(null)
  }

  const insertChord = (intervals: number[], rootOffset = 0, specificTime?: number, specificDuration = 48) => {
    if (!activeTrack || activeTrack.instrument !== 'synth') return
    const time = specificTime !== undefined ? specificTime : Math.round(useStore.getState().playheadPosition)
    const basePitch = (chordOctave + 1) * 12 + chordRootNote + rootOffset
    commitHistory()
    const newNotes: Note[] = []
    intervals.forEach(semitone => {
      const pitch = basePitch + semitone
      if (pitch >= 0 && pitch < 128) {
        newNotes.push({ id: newId(), trackId: activeTrack.id, time, duration: specificDuration, pitch, velocity: 100 })
      }
    })
    if (newNotes.length > 0) {
      useStore.setState({
        notes: [...useStore.getState().notes, ...newNotes],
        selectedNoteIds: newNotes.map(n => n.id)
      })
    }
  }

  const insertGenreProgression = (prog: GenreProgression) => {
    if (!activeTrack || activeTrack.instrument !== 'synth') return
    commitHistory()
    const startTime = Math.round(useStore.getState().playheadPosition)
    const newNotes: Note[] = []

    prog.steps.forEach((step, idx) => {
      const stepTime = startTime + idx * progressionSpacing
      const basePitch = (chordOctave + 1) * 12 + chordRootNote + step.rootOffset
      step.intervals.forEach(semi => {
        const pitch = basePitch + semi
        if (pitch >= 0 && pitch < 128) {
          newNotes.push({
            id: newId(),
            trackId: activeTrack.id,
            time: stepTime,
            duration: Math.max(24, progressionSpacing - 12),
            pitch,
            velocity: 95
          })
        }
      })
    })

    if (newNotes.length > 0) {
      useStore.setState({
        notes: [...useStore.getState().notes, ...newNotes],
        selectedNoteIds: newNotes.map(n => n.id)
      })
      useStore.getState().showToast(`Inserted ${prog.name} (${prog.steps.length} chords)`, 'success')
    }
  }

  const generateDiatonicHarmony = (type: 'chord' | 'bass') => {
    if (!activeTrack || activeTrack.instrument !== 'synth') return
    const targetNotes = generationSourceMode === 'all' ? notes : notes.filter(n => n.trackId === activeTrack.id)
    const sourceNotes = editTargets.length > 0 ? editTargets.filter(n => generationSourceMode === 'all' || n.trackId === activeTrack.id) : targetNotes
    if (sourceNotes.length === 0) return

    sourceNotes.sort((a: Note, b: Note) => a.time - b.time)
    commitHistory()

    let targetTrackId = ''
    if (generationDestinationMode === 'current') {
      targetTrackId = activeTrack.id
    } else {
      targetTrackId = newId()
      addTrack({
        id: targetTrackId,
        name: type === 'chord' ? 'Diatonic Chords' : 'Diatonic Bass',
        instrument: 'synth',
        color: type === 'chord' ? '#ffcc00' : '#4dabf7',
        synthPreset: DEFAULT_SYNTH_PRESET,
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
      })
      audioEngine.createInstrument(targetTrackId, 'synth')
    }

    // Find prominent notes per beat (take the lowest note at each exact time to represent root)
    const timeMap = new Map<number, Note>()
    sourceNotes.forEach((n: Note) => {
      if (!timeMap.has(n.time) || n.pitch < timeMap.get(n.time)!.pitch) {
        timeMap.set(n.time, n)
      }
    })

    const newNotes: Note[] = []
    timeMap.forEach((n: Note) => {
      if (type === 'chord') {
        const chordType = chordFamily === 'Sevenths' ? 'Seventh' : 'Triad'
        const chordPitches = getDiatonicChord(n.pitch, scaleLock.root, scaleLock.mode, chordType)
        chordPitches.forEach(p => {
          newNotes.push({ id: newId(), trackId: targetTrackId, time: n.time, duration: n.duration, pitch: p, velocity: 80 })
        })
      } else {
        const chordPitches = getDiatonicChord(n.pitch, scaleLock.root, scaleLock.mode, 'Triad')
        const rootPitch = chordPitches[0]
        const bassPitch = Math.max(12, rootPitch - 12)
        newNotes.push({ id: newId(), trackId: targetTrackId, time: n.time, duration: n.duration, pitch: bassPitch, velocity: 100 })
      }
    })

    newNotes.forEach(addNote)
    setActiveTrackId(targetTrackId)
  }



  const applyQuantize = () => {
    if (editTargets.length === 0) return
    commitHistory()
    const amount = quantizeStrength / 100
    editTargets.forEach(note => {
      const snappedTime = snapTick(note.time, snapResolution)
      const snappedDuration = Math.max(12, snapTick(note.duration, snapResolution))
      updateNote(note.id, {
        time: Math.round(note.time + (snappedTime - note.time) * amount),
        duration: Math.round(note.duration + (snappedDuration - note.duration) * amount),
      })
    })
  }

  const insertSuggestion = (suggestion: ProceduralSuggestion) => {
    let targetTrackId = ''
    if (generationDestinationMode === 'current' && activeTrack?.instrument === suggestion.targetInstrument) {
      targetTrackId = activeTrack.id
    } else {
      targetTrackId = newId()
      addTrack({
        id: targetTrackId,
        name: `Suggested ${suggestion.targetInstrument === 'synth' ? 'Melody' : 'Drums'}`,
        instrument: suggestion.targetInstrument,
        color: suggestion.targetInstrument === 'synth' ? '#ffcc00' : '#ff9900',
        synthPreset: DEFAULT_SYNTH_PRESET,
        volume: 1, pan: 0, muted: false, soloed: false,
      })
      audioEngine.createInstrument(targetTrackId, suggestion.targetInstrument)
    }

    commitHistory()
    suggestion.notes.forEach(note => {
      addNote({ ...note, id: newId(), trackId: targetTrackId })
    })
    setActiveTrackId(targetTrackId)
  }

  const makeClipFromActiveTrack = () => {
    if (!activeTrack || activeTrackNotes.length === 0) {
      useStore.getState().showToast('Add notes on the active track first', 'error')
      return
    }
    const start = Math.min(...activeTrackNotes.map(n => n.time))
    const end = Math.max(...activeTrackNotes.map(n => n.time + n.duration))
    addClip({ id: newId(), trackId: activeTrack.id, name: `Clip ${clips.length + 1}`, startTick: start, endTick: end, color: activeTrack.color })
  }


  const exportTrack = (trackId: string, format: 'wav' | 'mp3' | 'midi') => {
    const state = useStore.getState()
    // Calculate absolute end across all tracks
    const lastNoteTick = state.notes.length > 0 ? Math.max(...state.notes.map(n => n.time + n.duration)) : 768

    setProjectExportData({
      type: format,
      trackId,
      octaveOffset: 0,
      semitoneOffset: 0,
      normalize: true,
      includeMetronome: false,
      autoFade: true,
      isRendering: false,
      progress: 0,
      renderElapsedSeconds: 0,
      renderTotalSeconds: 0,
      startTick: state.loopEnabled ? state.loopStart : 0,
      endTick: state.loopEnabled ? state.loopEnd : lastNoteTick,
      includeProceduralFx: format === 'midi' ? false : state.studioSettings.proceduralFxEnabled,
      mp3Kbps: 320,
      bounceMode: 'offline',
      realtimeTailSeconds: 2
    })
    setContextMenu(null)
  }

  const cancelProjectExport = () => {
    const currentExport = useStore.getState().projectExportData
    if (currentExport?.isRendering && currentExport.bounceMode === 'realtime') {
      audioEngine.cancelRealtimeBounce()
    }
    setProjectExportData(null)
  }

  const executeAudioExport = async () => {
    if (!projectExportData) return
    const { type, trackId, trackIds, octaveOffset, semitoneOffset, normalize, includeMetronome, autoFade, startTick, endTick, includeProceduralFx } = projectExportData
    const bounceMode = projectExportData.bounceMode ?? 'offline'
    const tailSeconds = Math.max(0, projectExportData.realtimeTailSeconds ?? 2)

    setProjectExportData({
      ...projectExportData,
      isRendering: true,
      progress: 0,
      renderElapsedSeconds: 0,
      renderTotalSeconds: 0,
    })

    try {
      const state = useStore.getState()
      let renderState = { ...state }
      const exportNotes = trackIds && trackIds.length > 0
        ? state.notes.filter(n => trackIds.includes(n.trackId))
        : trackId
          ? state.notes.filter(n => n.trackId === trackId)
          : state.notes
      const lastExportTick = exportNotes.length > 0
        ? Math.max(...exportNotes.map(n => n.time + n.duration))
        : Math.max(768, state.getMaxTicks())
      const resolvedStartTick = startTick ?? 0
      const resolvedEndTick = Math.max(resolvedStartTick + 1, endTick ?? lastExportTick)
      const exportFilename = trackIds && trackIds.length > 0
        ? `selected-mix.${type}`
        : trackId
          ? `${tracks.find(t => t.id === trackId)?.name.replace(/\s+/g, '-').toLowerCase()}.${type}`
          : `project-mix.${type}`

      if (trackIds && trackIds.length > 0) {
        const selectedRenderTracks = tracks.filter(t => trackIds.includes(t.id)).map(t => ({ ...t, muted: false, soloed: false }))
        const selectedRenderNotes = notes.filter(n => trackIds.includes(n.trackId))
        const selectedRenderAutomationCurves: Record<string, any> = {}
        trackIds.forEach(id => {
          selectedRenderAutomationCurves[id] = state.automationCurves[id] ?? []
        })
        renderState = {
          ...state,
          tracks: selectedRenderTracks,
          notes: selectedRenderNotes,
          automationCurves: selectedRenderAutomationCurves,
        }
      } else if (trackId) {
        const track = tracks.find(t => t.id === trackId)
        if (!track) throw new Error('Track not found')
        const trackNotes = notes.filter(n => n.trackId === trackId)
        renderState = {
          ...state,
          tracks: [{ ...track, muted: false, soloed: false }],
          notes: trackNotes,
          automationCurves: { [trackId]: state.automationCurves[trackId] ?? [] },
        }
      }

      let nativeBuffer: AudioBuffer | null = null

      if (bounceMode === 'realtime') {
        const ticksPerSecond = (state.bpm / 60) * 192
        const updateRealtimeProgress = (elapsed: number, total: number) => {
          const current = useStore.getState().projectExportData
          if (!current) {
            audioEngine.cancelRealtimeBounce()
            return
          }
          useStore.getState().setProjectExportData({
            ...current,
            progress: total > 0 ? clamp((elapsed / total) * 100, 0, 100) : 0,
            renderElapsedSeconds: elapsed,
            renderTotalSeconds: total,
          })
        }

        if (exportRegionMode && exportRegions.length > 0) {
          const sortedRegions = [...exportRegions].sort((a, b) => a.startTick - b.startTick)
          const totalRecordSeconds = sortedRegions.reduce((sum, region) => {
            const regionSeconds = Math.max(0.05, (region.endTick - region.startTick) / ticksPerSecond)
            return sum + regionSeconds + tailSeconds + Math.max(0, region.gap)
          }, 0)
          let completedSeconds = 0
          const buffers: AudioBuffer[] = []
          const gaps: number[] = []

          for (const region of sortedRegions) {
            if (!useStore.getState().projectExportData) return
            let regionBuffer = await audioEngine.startRealtimeBounce({
              trackId,
              trackIds,
              tailSeconds,
              startTick: region.startTick,
              endTick: region.endTick,
              includeMetronome,
              includeProceduralFx,
              onProgress: (elapsed) => updateRealtimeProgress(completedSeconds + elapsed, totalRecordSeconds),
            })

            const isSilent = !regionBuffer || (() => {
              for (let c = 0; c < regionBuffer.numberOfChannels; c++) {
                const data = regionBuffer.getChannelData(c)
                const step = Math.max(1, Math.floor(data.length / 1000))
                for (let i = 0; i < data.length; i += step) {
                  if (Math.abs(data[i]) > 0.0001) return false
                }
              }
              return true
            })()

            if (isSilent) {
              if (!useStore.getState().projectExportData) return
              regionBuffer = await renderProjectAudio(renderState, {
                trackId, trackIds, octaveOffset, semitoneOffset, normalize: false, includeMetronome, autoFade: false,
                startTick: region.startTick, endTick: region.endTick, includeProceduralFx,
                exportRegionMode: false
              })
            }

            if (!regionBuffer) {
              if (!useStore.getState().projectExportData) return
              throw new Error('Real-time bounce did not produce audio for region')
            }

            buffers.push(regionBuffer)
            gaps.push(Math.max(0, region.gap))
            completedSeconds += Math.max(0.05, (region.endTick - region.startTick) / ticksPerSecond) + tailSeconds + Math.max(0, region.gap)
            updateRealtimeProgress(completedSeconds, totalRecordSeconds)
          }

          nativeBuffer = stitchAudioBuffers(buffers, gaps)
        } else {
          nativeBuffer = await audioEngine.startRealtimeBounce({
            trackId,
            trackIds,
            tailSeconds,
            startTick: resolvedStartTick,
            endTick: resolvedEndTick,
            includeMetronome,
            includeProceduralFx,
            onProgress: updateRealtimeProgress,
          })

          const isSilent = !nativeBuffer || (() => {
            for (let c = 0; c < nativeBuffer.numberOfChannels; c++) {
              const data = nativeBuffer.getChannelData(c)
              const step = Math.max(1, Math.floor(data.length / 1000))
              for (let i = 0; i < data.length; i += step) {
                if (Math.abs(data[i]) > 0.0001) return false
              }
            }
            return true
          })()

          if (isSilent) {
            if (!useStore.getState().projectExportData) return
            nativeBuffer = await renderProjectAudio(renderState, {
              trackId, trackIds, octaveOffset, semitoneOffset, normalize, includeMetronome, autoFade,
              startTick: resolvedStartTick, endTick: resolvedEndTick, includeProceduralFx,
              exportRegionMode,
              exportRegions
            })
          }
        }

        if (!nativeBuffer) {
          if (!useStore.getState().projectExportData) return
          throw new Error('Real-time bounce did not produce audio')
        }

        if (autoFade) {
          applyAudioBufferFadeOut(nativeBuffer, state.studioSettings.renderFadeDuration)
        }
        if (normalize) {
          normalizeAudioBuffer(nativeBuffer, state.studioSettings.normalizationTarget)
        }
      } else {
        const bitDepth = projectExportData.bitDepth ?? 24
        const canNative = canUseNativeBounce()

        // A straight WAV can stream from JUCE to the user's file without passing samples
        // through the web layer.
        if (canNative && type === 'wav' && !exportRegionMode) {
          const payload = buildNativeBouncePayload(state, {
            trackId, trackIds, octaveOffset, semitoneOffset, normalize, autoFade, includeMetronome,
            includeProceduralFx,
            startTick: resolvedStartTick, endTick: resolvedEndTick, exportRegionMode,
            filename: exportFilename
          }, bitDepth)

          if (payload) {
            const outcome = await renderNativeBounce(payload)
            if (!outcome) return          // host save dialog cancelled
            if (!outcome.success) throw new Error(outcome.message || 'Native bounce failed')
            if (useStore.getState().projectExportData) {
              useStore.getState().showToast(`Exported ${exportFilename} (${bitDepth}-bit, JUCE engine)!`, 'success')
            }
            return
          }
        }

        // MP3 and multi-region exports need the samples in JS (encoder / splice), so the
        // native render goes to a temp WAV that is fetched and decoded here.
        if (canNative) {
          try {
            const engineBuffer = await renderNativeAudioBuffer(state, {
              trackId, trackIds, octaveOffset, semitoneOffset, normalize, autoFade, includeMetronome,
              includeProceduralFx,
              startTick: resolvedStartTick, endTick: resolvedEndTick, exportRegionMode,
              exportRegions,
              filename: exportFilename
            }, type === 'mp3' ? 16 : bitDepth)

            if (engineBuffer) nativeBuffer = engineBuffer
          } catch (nativeError) {
            // Host failure should not block the export; the Tone renderer below still works.
            console.warn('[Export] Native render failed, falling back to Tone:', nativeError)
          }
        }

        if (!nativeBuffer) {
          nativeBuffer = await renderProjectAudio(renderState, {
            trackId, trackIds, octaveOffset, semitoneOffset, normalize, includeMetronome, autoFade, startTick: resolvedStartTick, endTick: resolvedEndTick, includeProceduralFx,
            exportRegionMode,
            exportRegions
          })
        }
      }

      // Check if cancelled
      if (!useStore.getState().projectExportData) {
        return
      }

      if (!nativeBuffer) throw new Error('Offline bounce produced no audio')

      const blob = type === 'wav'
        ? audioBufferToWav(nativeBuffer, projectExportData.bitDepth ?? 24)
        : audioBufferToMp3(nativeBuffer, projectExportData.mp3Kbps)
      const saved = await saveFileWithDialog(blob, {
        filename: exportFilename,
        title: 'Save Audio Export',
        filters: type === 'mp3' ? [{ name: 'MP3 Audio', extensions: ['mp3'] }] : [{ name: 'WAV Audio', extensions: ['wav'] }]
      })
      if (saved) {
        useStore.getState().showToast(`Exported ${exportFilename}!`, 'success')
      }
    } catch (e: any) {
      if (useStore.getState().projectExportData) {
        const errDetails = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : (typeof e === 'object' ? JSON.stringify(e) : String(e))
        console.error('Audio export error: ' + errDetails)
        const errMsg = (e && typeof e === 'object' && e.message)
          ? `Export failed: ${e.message}`
          : (typeof e === 'string' && e ? `Export failed: ${e}` : `Export failed: ${String(e)}`)
        useStore.getState().showToast(errMsg, 'error')
      }
    } finally {
      if (useStore.getState().projectExportData) {
        setProjectExportData(null)
      }
    }
  }

  const executeMidiExport = async () => {
    if (!projectExportData) return
    const { trackId, octaveOffset, semitoneOffset, startTick, endTick } = projectExportData
    try {
      const state = useStore.getState()
      const targetTrack = trackId ? tracks.find(t => t.id === trackId) : null
      const exportBpm = targetTrack?.targetTempo || state.bpm
      const PPQ = 192

      const exportTracks = projectExportData.trackIds && projectExportData.trackIds.length > 0
        ? tracks.filter(t => projectExportData.trackIds!.includes(t.id))
        : trackId ? tracks.filter(t => t.id === trackId) : tracks

      const hasMicrotonal = exportTracks.some(t => t.instrument === 'synth' && t.edoDivision && t.edoDivision !== 12)
      const exportScala = projectExportData.exportScalaWithMidi ?? (hasMicrotonal || true)

      // Only block if unlocked free non-scale grid without Scala companion
      if ((!state.pitchSnapEnabled || state.customSynthRows.length > 0) && !hasMicrotonal && !exportScala) {
        useStore.getState().showToast('MIDI requires 12-TET grid or Scala (.scl) Companion export!', 'error')
        setProjectExportData(null)
        return
      }

      let exportNotes = projectExportData.trackIds && projectExportData.trackIds.length > 0
        ? notes.filter(n => projectExportData.trackIds!.includes(n.trackId))
        : trackId ? notes.filter(n => n.trackId === trackId) : [...notes]

      if (exportRegionMode && exportRegions && exportRegions.length > 0) {
        const sortedRegions = [...exportRegions].sort((a, b) => a.startTick - b.startTick)
        const stitchedNotes: typeof exportNotes = []
        let currentTickOffset = 0
        const globalTPS = (exportBpm / 60) * PPQ

        sortedRegions.forEach(region => {
          const sTick = region.startTick
          const eTick = region.endTick

          const regionNotes = exportNotes
            .filter(n => (n.time + n.duration) > sTick && n.time < eTick)
            .map(n => ({
              ...n,
              time: (n.time - sTick) + currentTickOffset
            }))

          stitchedNotes.push(...regionNotes)
          currentTickOffset += (eTick - sTick) + (region.gap * globalTPS)
        })
        exportNotes = stitchedNotes
      } else {
        const sTick = startTick ?? 0
        const eTick = endTick ?? Infinity

        // Range Filtering & Shifting
        exportNotes = exportNotes
          .filter(n => (n.time + n.duration) > sTick && n.time < eTick)
          .map(n => ({ ...n, time: Math.max(0, n.time - sTick) }))
      }

      const totalTranspose = (octaveOffset * 12) + semitoneOffset
      if (totalTranspose !== 0) {
        exportNotes = exportNotes.map(n => ({ ...n, pitch: n.pitch + totalTranspose }))
      }

      const midiData = createMidiData(exportNotes, exportBpm, exportTracks, { mapToEdoDegrees: exportScala && hasMicrotonal })
      const blob = new Blob([midiData as unknown as BlobPart], { type: 'audio/midi' })
      let filename = 'project.mid'
      if (trackId && targetTrack) {
        filename = `${targetTrack.name.replace(/\s+/g, '-').toLowerCase()}.mid`
      } else if (projectExportData.trackIds && projectExportData.trackIds.length > 0) {
        filename = 'multi-track-export.mid'
      }

      const saved = await saveFileWithDialog(blob, {
        filename,
        title: 'Save MIDI File',
        filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }]
      })
      if (!saved) return

      if (exportScala) {
        const microTracks = exportTracks.filter(t => t.instrument === 'synth' && t.edoDivision && t.edoDivision !== 12)
        if (microTracks.length > 0) {
          microTracks.forEach(t => {
            exportTrackScala(t, t.name ? t.name.replace(/\s+/g, '-').toLowerCase() : 'track')
          })
          useStore.getState().showToast('Exported MIDI + Scala (.scl) tuning companion!', 'success')
        } else {
          exportTrackScala(targetTrack || exportTracks[0], filename.replace(/\.mid$/, ''))
          useStore.getState().showToast('Exported MIDI + Scala (.scl) tuning companion!', 'success')
        }
      } else {
        useStore.getState().showToast('Exported MIDI file successfully!', 'success')
      }
    } catch (e) {
      console.error(e)
      useStore.getState().showToast('MIDI export failed', 'error')
    } finally {
      setProjectExportData(null)
    }
  }

  const executeScalaExport = () => {
    if (!projectExportData) return
    const { trackId } = projectExportData
    try {
      const targetTrack = trackId ? tracks.find(t => t.id === trackId) : (tracks.find(t => t.instrument === 'synth' && t.edoDivision && t.edoDivision !== 12) || tracks[0])
      const filename = exportTrackScala(targetTrack)
      useStore.getState().showToast(`Exported ${filename} Scala tuning file successfully!`, 'success')
    } catch (e) {
      console.error(e)
      useStore.getState().showToast('Scala export failed', 'error')
    } finally {
      setProjectExportData(null)
    }
  }

  const executeScoreExport = () => {
    if (!projectExportData) return
    const { trackId, octaveOffset, semitoneOffset, startTick, endTick } = projectExportData
    try {
      const state = useStore.getState()
      const targetTrack = trackId ? tracks.find(t => t.id === trackId) : null
      const exportBpm = targetTrack?.targetTempo || state.bpm

      let exportNotes = projectExportData.trackIds && projectExportData.trackIds.length > 0
        ? notes.filter(n => projectExportData.trackIds!.includes(n.trackId))
        : trackId ? notes.filter(n => n.trackId === trackId) : [...notes]

      const sTick = startTick ?? 0
      const eTick = endTick ?? Infinity
      exportNotes = exportNotes
        .filter(n => (n.time + n.duration) > sTick && n.time < eTick)
        .map(n => ({ ...n, time: Math.max(0, n.time - sTick) }))

      const totalTranspose = (octaveOffset * 12) + semitoneOffset
      if (totalTranspose !== 0) {
        exportNotes = exportNotes.map(n => ({ ...n, pitch: n.pitch + totalTranspose }))
      }

      const exportTracks = projectExportData.trackIds && projectExportData.trackIds.length > 0
        ? tracks.filter(t => projectExportData.trackIds!.includes(t.id))
        : trackId && targetTrack ? [targetTrack] : tracks

      const xml = generateMusicXML(exportTracks, exportNotes, exportBpm, state.timeSignature, true)
      const filename = trackId && targetTrack
        ? `${targetTrack.name.replace(/\s+/g, '-').toLowerCase()}.musicxml`
        : 'score-export.musicxml'
      downloadScore(xml, filename)
      useStore.getState().showToast('Exported MusicXML score successfully!', 'success')
    } catch (e) {
      console.error(e)
      useStore.getState().showToast('MusicXML export failed', 'error')
    } finally {
      setProjectExportData(null)
    }
  }

  const executeMuzTrackExport = () => {
    if (!projectExportData) return
    const { trackId, octaveOffset, semitoneOffset, startTick, endTick } = projectExportData
    try {
      const state = useStore.getState()
      const targetTrack = trackId ? tracks.find(t => t.id === trackId) : null
      const exportBpm = targetTrack?.targetTempo || state.bpm

      let exportNotes = projectExportData.trackIds && projectExportData.trackIds.length > 0
        ? notes.filter(n => projectExportData.trackIds!.includes(n.trackId))
        : trackId ? notes.filter(n => n.trackId === trackId) : [...notes]

      const sTick = startTick ?? 0
      const eTick = endTick ?? Infinity
      exportNotes = exportNotes
        .filter(n => (n.time + n.duration) > sTick && n.time < eTick)
        .map(n => ({ ...n, time: Math.max(0, n.time - sTick) }))

      const totalTranspose = (octaveOffset * 12) + semitoneOffset
      if (totalTranspose !== 0) {
        exportNotes = exportNotes.map(n => ({ ...n, pitch: n.pitch + totalTranspose }))
      }

      const exportTracks = projectExportData.trackIds && projectExportData.trackIds.length > 0
        ? tracks.filter(t => projectExportData.trackIds!.includes(t.id))
        : trackId && targetTrack ? [targetTrack] : tracks

      const json = generateMuzTrack(exportTracks, exportNotes, exportBpm, state.timeSignature)
      const filename = trackId && targetTrack
        ? `${targetTrack.name.replace(/\s+/g, '-').toLowerCase()}.muztrack`
        : 'project.muztrack'
      downloadMuzTrack(json, filename)
      useStore.getState().showToast('Exported .muztrack successfully!', 'success')
    } catch (e) {
      console.error(e)
      useStore.getState().showToast('.muztrack export failed', 'error')
    } finally {
      setProjectExportData(null)
    }
  }

  const handleAiGenerate = async () => {
    if (!activeTrackId || isAiLoading) return
    const track = tracks.find(t => t.id === activeTrackId)
    if (!track) return

    setIsAiLoading(true)
    try {
      const activeNotes = notes.filter(n => n.trackId === activeTrackId)
      const currentPlayhead = useStore.getState().playheadPosition
      // Dynamic Seed Length
      const seedNotes = activeNotes.filter(n => n.time >= currentPlayhead - (aiSeedBars * 192 * 4) && n.time < currentPlayhead)
      const trackScale = track.scaleOverride || scaleLock

      let newNotes: any[] = []
      if (track.instrument === 'synth') {
        newNotes = await generateAiMelody(seedNotes, aiLength, aiTemperature, aiDensity, aiOctaveShift, trackScale, currentPlayhead, aiSeedPitch)
      } else {
        newNotes = await generateAiDrums(seedNotes, aiLength, aiTemperature, aiDensity, midiRemapData.drumMap, currentPlayhead, aiSeedPitch)
      }

      if (newNotes.length > 0) {
        useStore.getState().commitHistory()
        newNotes.forEach(n => {
          addNote({
            ...n,
            id: newId(),
            trackId: activeTrackId,
            time: n.time
          })
        })
      }
    } catch (err) {
      console.error(err)
      useStore.getState().showToast('AI Generation failed. Ensure you are online to load the models.', 'error')
    } finally {
      setIsAiLoading(false)
    }
  }

  const handleBeatMorph = async () => {
    if (!activeTrackId || !morphTargetTrackId) return
    const sourceTrack = tracks.find(t => t.id === activeTrackId)
    const targetTrack = tracks.find(t => t.id === morphTargetTrackId)
    if (!sourceTrack || !targetTrack || sourceTrack.instrument !== 'drum' || targetTrack.instrument !== 'drum') {
      useStore.getState().showToast('Both tracks must be drum tracks for morphing.', 'info')
      return
    }

    const sourceNotes = notes.filter(n => n.trackId === sourceTrack.id)
    const targetNotes = notes.filter(n => n.trackId === targetTrack.id)

    setIsAiLoading(true)
    setIsMorphing(true)
    try {
      const morphPatterns = await generateBeatMorph(sourceNotes, targetNotes, morphSteps)

      let nextTime = Math.max(...sourceNotes.map(n => n.time + n.duration), 0)
      if (nextTime === 0) nextTime = 32 * 48 // fallback

      const newNotes: Note[] = []

      // We skip the first and last pattern because they are identical to source and target
      for (let i = 1; i < morphPatterns.length - 1; i++) {
        const pattern = morphPatterns[i]
        pattern.forEach(n => {
          newNotes.push({
            ...n,
            trackId: sourceTrack.id,
            time: nextTime + n.time
          })
        })
        nextTime += 32 * 48
      }

      useStore.getState().loadState({ notes: [...notes, ...newNotes] })
      useStore.getState().showToast(`Generated ${morphSteps - 2} intermediate morph patterns!`, 'success')

    } catch (err: any) {
      console.error(err)
      useStore.getState().showToast(err.message || 'Error generating beat morph. Check connection.', 'error')
    } finally {
      setIsAiLoading(false)
      setIsMorphing(false)
    }
  }

  const handleHumanizeGroove = async () => {
    if (!activeTrackId) return
    const track = tracks.find(t => t.id === activeTrackId)
    if (!track || track.instrument !== 'drum') return

    const trackNotes = notes.filter(n => n.trackId === activeTrackId)
    if (trackNotes.length === 0) {
      useStore.getState().showToast('No drum notes found to humanize.', 'info')
      return
    }

    setIsAiLoading(true)
    try {
      const currentPlayhead = useStore.getState().playheadPosition
      // We only humanize the pattern immediately before the playhead, or the whole track if playhead is 0
      let seedNotes = trackNotes
      if (currentPlayhead > 0) {
        seedNotes = trackNotes.filter(n => n.time >= currentPlayhead - (32 * 48) && n.time < currentPlayhead)
      }
      if (seedNotes.length === 0) seedNotes = trackNotes

      const bpm = useStore.getState().bpm
      const humanizedNotes = await generateHumanGroove(seedNotes, aiTemperature, bpm)

      if (humanizedNotes.length > 0) {
        useStore.getState().commitHistory()
        // Replace the seed notes with humanized notes
        const minTime = Math.min(...seedNotes.map(n => n.time))
        const maxTime = Math.max(...seedNotes.map(n => n.time + n.duration))
        const untouchedNotes = trackNotes.filter(n => n.time < minTime || n.time >= maxTime)
        const otherTracksNotes = notes.filter(n => n.trackId !== activeTrackId)

        // ensure humanized notes are on this track
        humanizedNotes.forEach(n => { n.trackId = activeTrackId; n.id = newId() })

        useStore.getState().loadState({ notes: [...otherTracksNotes, ...untouchedNotes, ...humanizedNotes] })
        useStore.getState().showToast('Groove Humanized!', 'success')
      }
    } catch (err: any) {
      console.error(err)
      useStore.getState().showToast(err.message || 'Error humanizing groove.', 'error')
    } finally {
      setIsAiLoading(false)
    }
  }

  const handleGenieNote = async (buttonIndex: number) => {
    if (!activeTrackId) return
    const track = tracks.find(t => t.id === activeTrackId)
    if (!track || track.instrument !== 'synth') return

    try {
      const pitch = await generatePianoGenieNote(buttonIndex, aiTemperature)
      const currentPlayhead = useStore.getState().playheadPosition

      const newNote: Note = {
        id: newId(),
        trackId: activeTrackId,
        time: currentPlayhead,
        duration: 48, // 1/16th note default for genie step
        pitch: pitch,
        // eslint-disable-next-line react-hooks/purity
        velocity: 80 + Math.random() * 20
      }

      useStore.getState().commitHistory()
      addNote(newNote)

      // Advance playhead by 1/16th note (48 ticks)
      useStore.getState().setPlayheadPosition(currentPlayhead + 48)

    } catch (err: any) {
      console.error(err)
      useStore.getState().showToast('Error generating Genie note.', 'error')
    }
  }

  const handleResetGenie = async () => {
    await resetPianoGenie()
    useStore.getState().showToast('Genie state reset.', 'info')
  }

  const handleGenerateAiHarmony = async (type: 'chord' | 'bass' | 'counterpoint') => {
    if (!activeTrackId) return
    const track = tracks.find(t => t.id === activeTrackId)
    if (!track || track.instrument !== 'synth') {
      useStore.getState().showToast('Please select a Synth track with a melody first.', 'error')
      return
    }

    setIsAiLoading(true)
    try {
      const activeNotes = generationSourceMode === 'all' ? notes : notes.filter(n => n.trackId === activeTrackId)
      const currentPlayhead = useStore.getState().playheadPosition
      // Dynamic Seed Length (using existing AI params)
      const seedNotes = activeNotes.filter(n => n.time >= currentPlayhead - (aiSeedBars * 192 * 4) && n.time < currentPlayhead)
      const trackScale = track.scaleOverride || scaleLock

      if (seedNotes.length === 0) {
        useStore.getState().showToast('No melody notes found before playhead to use as seed.', 'error')
        setIsAiLoading(false)
        return
      }

      // We use the basic RNN to predict a single-note line, shifted down for bass, or used as roots for chords
      if (type === 'counterpoint') {
        const { voice1, voice2, voice3 } = await generateAutoHarmony(seedNotes, aiTemperature)

        if (voice1.length || voice2.length || voice3.length) {
          useStore.getState().commitHistory()
          const newNotes: Note[] = []

          const createVoiceTrack = (name: string, color: string, vNotes: Note[]) => {
            if (!vNotes.length) return
            const newTrackId = newId()
            addTrack({
              id: newTrackId,
              name,
              instrument: 'synth',
              color,
              synthPreset: DEFAULT_SYNTH_PRESET,
              volume: 1,
              pan: 0,
              muted: false,
              soloed: false,
            })
            audioEngine.createInstrument(newTrackId, 'synth')
            vNotes.forEach(n => newNotes.push({ ...n, id: newId(), trackId: newTrackId }))
          }

          createVoiceTrack('AI Alto', '#ff9900', voice1)
          createVoiceTrack('AI Tenor', '#69db7c', voice2)
          createVoiceTrack('AI Bass (Chorale)', '#4dabf7', voice3)

          newNotes.forEach(addNote)
        }
      } else {
        const aiShift = type === 'bass' ? aiOctaveShift - 2 : aiOctaveShift
        const generatedRoots = await generateAiMelody(seedNotes, aiLength, aiTemperature, aiDensity, aiShift, trackScale)

        if (generatedRoots.length > 0) {
          useStore.getState().commitHistory()

          let targetTrackId = ''
          if (generationDestinationMode === 'current') {
            targetTrackId = activeTrackId
          } else {
            targetTrackId = newId()
            addTrack({
              id: targetTrackId,
              name: type === 'chord' ? 'AI Chords' : 'AI Bass',
              instrument: 'synth',
              color: type === 'chord' ? '#ff3366' : '#da77f2',
              synthPreset: DEFAULT_SYNTH_PRESET,
              volume: 1,
              pan: 0,
              muted: false,
              soloed: false,
            })
            audioEngine.createInstrument(targetTrackId, 'synth')
          }

          const newNotes: Note[] = []
          generatedRoots.forEach((n: any) => {
            if (type === 'chord') {
              const chordType = chordFamily === 'Sevenths' ? 'Seventh' : 'Triad'
              const chordPitches = getDiatonicChord(n.pitch, trackScale.root, trackScale.mode, chordType)
              chordPitches.forEach(p => {
                newNotes.push({
                  ...n,
                  id: newId(),
                  trackId: targetTrackId,
                  time: n.time,
                  pitch: p,
                  velocity: 80
                })
              })
            } else {
              newNotes.push({
                ...n,
                id: newId(),
                trackId: targetTrackId,
                time: n.time,
                pitch: n.pitch,
                velocity: 100
              })
            }
          })
          newNotes.forEach(addNote)
          setActiveTrackId(targetTrackId)
        }
      }
    } catch (err) {
      console.error(err)
      useStore.getState().showToast('AI Harmony Generation failed.', 'error')
    } finally {
      setIsAiLoading(false)
    }
  }

  const handleImportMidi = async (trackId: string) => {
    setContextMenu(null)
    const track = tracks.find(t => t.id === trackId)
    if (!track) return

    try {
      const file = await selectAndReadFile({
        title: 'Import MIDI File',
        accept: '.mid,.midi',
        extensions: ['mid', 'midi'],
        fileTypeName: 'MIDI Files'
      })
      if (!file) return

      const midi = new Midi(file.data)
      setMidiImportData({
        midi,
        trackId,
        octaveOffset: 0,
        semitoneOffset: 0,
        isDrum: track.instrument === 'drum',
        smartMapping: true,
        drumMapOffset: 0,
        inheritTempo: false
      })
    } catch (err) {
      console.error(err)
      useStore.getState().showToast('Failed to parse MIDI file', 'error')
    }
  }

  const handleImportSheet = async (trackId: string) => {
    setContextMenu(null)
    const track = tracks.find(t => t.id === trackId)
    if (!track) return

    try {
      const file = await selectAndReadFile({
        title: 'Import Sheet Music (MusicXML / MXL)',
        accept: '.musicxml,.xml,.mxl',
        extensions: ['musicxml', 'xml', 'mxl'],
        fileTypeName: 'MusicXML Sheets'
      })
      if (!file) return

      let text = ''
      if (file.name.endsWith('.mxl')) {
        text = await extractXmlFromMxl(file.data)
      } else {
        text = new TextDecoder('utf-8').decode(file.data)
      }

      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(text, 'text/xml')

      // Check for parse errors
      const parseError = xmlDoc.getElementsByTagName('parsererror')[0]
      if (parseError) {
        throw new Error(parseError.textContent || 'XML parsing failed')
      }

      // Try to find the BPM/Tempo
      let bpm = 120
      const soundEl = xmlDoc.getElementsByTagName('sound')[0]
      if (soundEl && soundEl.getAttribute('tempo')) {
        bpm = parseFloat(soundEl.getAttribute('tempo') || '120')
      } else {
        // Sometimes tempo is in metronome elements
        const metronomeEl = xmlDoc.getElementsByTagName('metronome')[0]
        if (metronomeEl) {
          const perMinuteEl = metronomeEl.getElementsByTagName('per-minute')[0]
          if (perMinuteEl && perMinuteEl.textContent) {
            bpm = parseFloat(perMinuteEl.textContent)
          }
        }
      }

      setSheetImportData({
        xmlText: text,
        filename: file.name,
        trackId,
        octaveOffset: 0,
        semitoneOffset: 0,
        isDrum: track.instrument === 'drum',
        smartMapping: true,
        importPitchSlides: true,
        importVelocity: true,
        defaultVelocity: 100,
        snapToGrid: false,
        inheritTempo: true,
        parsedBpm: bpm
      })
    } catch (err: any) {
      console.error(err)
      useStore.getState().showToast(`Failed to parse sheet file: ${err.message || err}`, 'error')
    }
  }

  const executeSheetImport = () => {
    if (!sheetImportData) return
    const { xmlText, trackId, octaveOffset, semitoneOffset, isDrum, smartMapping, importPitchSlides, importVelocity, defaultVelocity, snapToGrid, inheritTempo, parsedBpm } = sheetImportData

    const track = tracks.find(t => t.id === trackId)
    if (!track) return

    try {
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml')

      if (inheritTempo && parsedBpm) {
        useStore.getState().setBpm(Math.round(parsedBpm))
      }

      // Get divisions (ticks per quarter note)
      const divisionsEl = xmlDoc.getElementsByTagName('divisions')[0]
      const divisions = divisionsEl && divisionsEl.textContent ? parseInt(divisionsEl.textContent) : 4
      const ticksPerDivision = 192 / divisions // 192 ticks = 1 quarter beat in MuseGrid

      const noteElements = xmlDoc.getElementsByTagName('note')
      if (noteElements.length === 0) {
        useStore.getState().showToast('No notes found in this sheet XML file', 'info')
        setSheetImportData(null)
        return
      }

      const newNotes: any[] = []
      let currentTick = 0

      const stepMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

      // We'll also track active glissando starts to link them.
      const glissandoStarts: Record<string, { noteIndex: number, pitch: number }> = {}

      for (let i = 0; i < noteElements.length; i++) {
        const noteEl = noteElements[i]

        // Duration of the note/rest
        const durEl = noteEl.getElementsByTagName('duration')[0]
        const durationVal = durEl && durEl.textContent ? parseInt(durEl.textContent) : 1
        const tickDuration = Math.round(durationVal * ticksPerDivision)

        // Check if it is a rest
        const isRest = noteEl.getElementsByTagName('rest').length > 0

        // Check if chord (starts at the same time as previous note)
        const isChord = noteEl.getElementsByTagName('chord').length > 0

        if (isChord && newNotes.length > 0) {
          // Revert time to the start of the previous note
          const prevNote = newNotes[newNotes.length - 1]
          currentTick = prevNote.time
        }

        if (!isRest) {
          const pitchEl = noteEl.getElementsByTagName('pitch')[0]
          if (pitchEl) {
            const step = pitchEl.getElementsByTagName('step')[0]?.textContent || 'C'
            const alterText = pitchEl.getElementsByTagName('alter')[0]?.textContent
            const alter = alterText ? parseInt(alterText) : 0
            const octaveText = pitchEl.getElementsByTagName('octave')[0]?.textContent
            const octave = octaveText ? parseInt(octaveText) : 4

            const baseSemitone = stepMap[step.toUpperCase()] || 0
            const rawPitch = 12 * (octave + 1) + baseSemitone + alter

            // Apply octave & transpose offset
            let pitch = rawPitch + (octaveOffset * 12) + semitoneOffset

            if (isDrum) {
              pitch = pitch % 16
            } else {
              if (smartMapping) {
                const scaleLock = track.scaleOverride || useStore.getState().scaleLock
                if (scaleLock && scaleLock.enabled) {
                  pitch = snapToScale(pitch, scaleLock.root, scaleLock.mode, scaleLock.customIntervals)
                }
              }
              pitch = Math.max(0, Math.min(87, pitch))
            }

            // Parse velocity
            let velocity = defaultVelocity
            if (importVelocity) {
              const dynamicsEl = noteEl.getElementsByTagName('dynamics')[0]
              if (dynamicsEl) {
                const childEls = dynamicsEl.children
                if (childEls.length > 0) {
                  const tag = childEls[0].tagName.toLowerCase()
                  const dynMap: Record<string, number> = {
                    ppp: 20, pp: 40, p: 60, mp: 80, mf: 95, f: 110, ff: 120, fff: 127
                  }
                  if (dynMap[tag] !== undefined) {
                    velocity = dynMap[tag]
                  }
                }
              }
            }

            const snapResolution = useStore.getState().snapResolution
            let finalTime = currentTick
            let finalDuration = tickDuration

            if (snapToGrid) {
              finalTime = Math.round(currentTick / snapResolution) * snapResolution
              finalDuration = Math.max(snapResolution, Math.round(tickDuration / snapResolution) * snapResolution)
            }

            const noteId = newId()
            const noteObj: any = {
              id: noteId,
              trackId,
              pitch,
              time: finalTime,
              duration: finalDuration,
              velocity
            }

            // Glissando / slide handling
            if (importPitchSlides && !isDrum) {
              const glissEl = noteEl.getElementsByTagName('glissando')[0]
              const slideEl = noteEl.getElementsByTagName('slide')[0]
              const glissOrSlide = glissEl || slideEl

              if (glissOrSlide) {
                const type = glissOrSlide.getAttribute('type')
                const number = glissOrSlide.getAttribute('number') || '1'

                if (type === 'start') {
                  glissandoStarts[number] = { noteIndex: newNotes.length, pitch }
                } else if (type === 'stop') {
                  const startData = glissandoStarts[number]
                  if (startData) {
                    const startNote = newNotes[startData.noteIndex]
                    if (startNote) {
                      startNote.pitchSlide = pitch - startNote.pitch
                      startNote.pitchSlideTime = startNote.duration
                    }
                    delete glissandoStarts[number]
                  }
                }
              }
            }

            newNotes.push(noteObj)
          }
        }

        // Advance time cursor (unless it is a chord note)
        if (!isChord) {
          currentTick += tickDuration
        }
      }

      // Add all parsed notes to the store!
      commitHistory()
      newNotes.forEach(note => {
        useStore.getState().addNote(note)
      })

      useStore.getState().showToast(`Successfully imported ${newNotes.length} notes from sheet XML!`, 'success')
    } catch (err) {
      console.error(err)
      useStore.getState().showToast('Failed to parse sheet XML file. Make sure it is a valid MusicXML file.', 'error')
    }

    setSheetImportData(null)
  }

  const executeMidiImport = (midiTrack: any) => {
    if (!midiImportData) return
    const { trackId, octaveOffset, semitoneOffset, isDrum, midi, smartMapping, inheritTempo } = midiImportData

    // Apply Tempo if inherited
    if (inheritTempo && midi.header.tempos.length > 0) {
      const bpm = midi.header.tempos[0].bpm
      updateTrack(trackId, { targetTempo: Math.round(bpm) })
    }

    commitHistory()
    const otherNotes = notes.filter(n => n.trackId !== trackId)
    const ppqScale = 192 / midi.header.ppq
    const pitchOffset = (octaveOffset * 12) + semitoneOffset
    const currentScale = useStore.getState().scaleLock

    const newNotes = midiTrack.notes.map((note: any) => {
      let pitch = note.midi + pitchOffset
      if (isDrum) {
        switch (note.midi) {
          case 35: case 36: pitch = 0; break
          case 38: case 40: pitch = 1; break
          case 42: case 44: pitch = 2; break
          case 46: pitch = 3; break
          case 39: case 49: case 50: pitch = 4; break
          default: pitch = note.midi % 5;
        }
        // Apply Drum Map Rotation
        const { drumMapOffset } = midiImportData
        pitch = ((pitch + drumMapOffset) % 5 + 5) % 5
      } else {
        if (smartMapping && currentScale.enabled) {
          pitch = snapToScale(pitch, currentScale.root, currentScale.mode, currentScale.customIntervals)
        }
        pitch = Math.max(0, Math.min(87, pitch))
      }

      return {
        id: newId(),
        trackId: trackId,
        time: note.ticks * ppqScale,
        duration: Math.max(12, note.durationTicks * ppqScale),
        pitch,
        velocity: Math.round(note.velocity * 127)
      }
    })

    const maxTick = Math.max(...newNotes.map((n: any) => n.time + n.duration))
    const currentGridTicks = gridColumnCount * gridBlockTicks
    if (maxTick > currentGridTicks) {
      const neededCols = Math.ceil(maxTick / gridBlockTicks)
      useStore.setState({ gridColumnCount: neededCols })
    }

    useStore.setState({ notes: [...otherNotes, ...newNotes] })
    setMidiImportData(null)
  }

  const handleImportScala = async (trackId: string) => {
    setContextMenu(null)
    const track = tracks.find(t => t.id === trackId)
    if (!track) return

    try {
      const file = await selectAndReadFile({
        title: 'Import Scala (.scl) Tuning File',
        accept: '.scl',
        extensions: ['scl'],
        fileTypeName: 'Scala Tuning Files'
      })
      if (!file) return

      const text = new TextDecoder('utf-8').decode(file.data)
      const scale = parseScalaContent(text)

      commitHistory()
      updateTrack(trackId, {
        edoDivision: scale.detectedEdo || scale.count,
        edoPreset: scale.isEdo && [12, 19, 24, 31, 47, 53].includes(scale.detectedEdo!)
          ? (`${scale.detectedEdo}-edo` as any)
          : 'custom',
        edoRootNote: 60,
        scalaScaleName: scale.name,
        customScaleCents: scale.cents
      })

      useStore.getState().showToast(
        `Imported Scala tuning: "${scale.name}" (${scale.count} notes${scale.isEdo ? `, ${scale.detectedEdo}-EDO` : ''})!`,
        'success'
      )
    } catch (err: any) {
      console.error(err)
      useStore.getState().showToast(`Failed to parse Scala file: ${err.message || err}`, 'error')
    }
  }

  const handleImportMuzTrack = async () => {
    setContextMenu(null)
    try {
      const file = await selectAndReadFile({
        title: 'Import MuseGrid Track (.muztrack)',
        accept: '.muztrack,.json',
        extensions: ['muztrack', 'json'],
        fileTypeName: 'MuseGrid Track Files'
      })
      if (!file) return

      const text = new TextDecoder('utf-8').decode(file.data)
      const data = parseMuzTrack(text)

      commitHistory()
      const state = useStore.getState()

      const idMap = new Map<string, string>()
      const newTracks: any[] = []

      for (let i = 0; i < data.tracks.length; i++) {
        const srcTrack = data.tracks[i]
        const newId = `t_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`
        idMap.set(srcTrack.id, newId)

        const t: any = {
          id: newId,
          name: srcTrack.name || 'Imported Track',
          color: srcTrack.color || '#00e6ff',
          instrument: (srcTrack.instrument as any) || 'synth',
          synthPreset: (srcTrack.synthPreset as any) || 'pluck',
          drumKit: (srcTrack.drumKit as any) || 'electronic',
          volume: srcTrack.volume ?? 0.8,
          pan: srcTrack.pan ?? 0,
          muted: false,
          soloed: false,
          edoDivision: srcTrack.edoDivision || 12,
          edoPreset: (srcTrack.edoPreset as any) || (srcTrack.edoDivision && srcTrack.edoDivision !== 12 ? `${srcTrack.edoDivision}-edo` : '12-edo'),
          edoRootNote: srcTrack.edoRootNote ?? 60
        }
        newTracks.push(t)
        audioEngine.createInstrument(t.id, t.instrument)
      }

      const newNotes: Note[] = []
      for (const srcNote of data.notes) {
        const mappedTrackId = idMap.get(srcNote.trackId)
        if (!mappedTrackId) continue
        newNotes.push({
          id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          trackId: mappedTrackId,
          pitch: srcNote.pitch,
          time: srcNote.time,
          duration: srcNote.duration,
          velocity: srcNote.velocity ?? 0.8,
          lyric: srcNote.lyric
        })
      }

      const maxTick = newNotes.length > 0 ? Math.max(...newNotes.map(n => n.time + n.duration)) : 0
      const currentGridTicks = gridColumnCount * gridBlockTicks
      if (maxTick > currentGridTicks) {
        const neededCols = Math.ceil(maxTick / gridBlockTicks)
        useStore.setState({ gridColumnCount: neededCols })
      }

      useStore.setState({
        tracks: [...state.tracks, ...newTracks],
        notes: [...state.notes, ...newNotes],
        activeTrackId: newTracks[0]?.id || state.activeTrackId
      })

      useStore.getState().showToast(
        `Imported ${newTracks.length} track(s) and ${newNotes.length} notes from .muztrack!`,
        'success'
      )
    } catch (err: any) {
      console.error(err)
      useStore.getState().showToast(`Failed to import .muztrack: ${err.message || err}`, 'error')
    }
  }

  const handleOpenMidiLab = async () => {
    try {
      const file = await selectAndReadFile({
        title: 'Open MIDI Lab',
        accept: '.mid,.midi',
        extensions: ['mid', 'midi'],
        fileTypeName: 'MIDI Files'
      })
      if (!file) return

      const midi = new Midi(file.data)
      setMidiRemapData({
        midi,
        filename: file.name,
        drumMap: {
          35: 0, 36: 0, // Kicks
          38: 1, 40: 1, // Snares
          42: 2, 44: 2, // Hats
          46: 3,        // Open Hat
          49: 4, 51: 4  // Cymbals/Clap
        },
        synthMap: {},
        channelStates: {},
        octaveOffset: 0,
        semitoneOffset: 0,
        timeScale: 1.0,
        velocityScale: 1.0,
        velocityOffset: 0,
        humanizeTiming: 0,
        humanizeVelocity: 0,
        repeatCount: 1
      })
    } catch (err) {
      console.error(err)
      useStore.getState().showToast('Failed to parse MIDI Lab file', 'error')
    }
  }

  const handleMidiLabInject = (targetTrackId: string | 'new-synth' | 'new-drum') => {
    if (!midiRemapData.midi || !activeLabTrack) return
    const midi = midiRemapData.midi

    commitHistory()

    let finalTrackId = targetTrackId
    if (targetTrackId === 'new-synth' || targetTrackId === 'new-drum') {
      const isDrum = targetTrackId === 'new-drum'
      const id = `track_${newId()}`
      addTrack({
        id,
        name: `${midi.header.name || 'MIDI'} ${isDrum ? 'Drums' : 'Synth'}`,
        instrument: isDrum ? 'drum' : 'synth',
        volume: 0.8,
        pan: 0,
        muted: false,
        soloed: false,
        color: isDrum ? '#ff9900' : '#4dabf7'
      })
      finalTrackId = id
    }

    const targetTrack = (targetTrackId === 'new-synth' || targetTrackId === 'new-drum')
      ? useStore.getState().tracks[useStore.getState().tracks.length - 1] // The one we just added
      : tracks.find(t => t.id === finalTrackId)

    if (!targetTrack) return
    const isDrum = targetTrack.instrument === 'drum'
    const ppqScale = (192 / midi.header.ppq) * (midiRemapData.timeScale || 1.0)
    const basePitchOffset = (midiRemapData.octaveOffset * 12) + midiRemapData.semitoneOffset

    const trackNotes = activeLabTrack.notes
      .filter((n: any) => midiRemapData.channelStates[n.channel] !== false)
      .filter((n: any) => !draftExclusions.has(n.midi))
      .filter((n: any) => isDrum ? !draftDrumMutes.has(n.midi) : !draftSynthMutes.has(n.midi))

    const newNotes: any[] = []
    const trackDuration = Math.max(...trackNotes.map((n: any) => n.ticks + n.durationTicks)) * ppqScale

    for (let r = 0; r < (midiRemapData.repeatCount || 1); r++) {
      const timeOffset = r * trackDuration

      trackNotes.forEach((n: any) => {
        const rawPitch = n.midi + basePitchOffset
        let pitch = isDrum ? rawPitch - 36 : rawPitch

        if (isDrum) {
          if (draftDrumMap[rawPitch] === undefined) {
            if (rawPitch === 35 || rawPitch === 36) pitch = 0
            else if (rawPitch === 38 || rawPitch === 40) pitch = 1
            else if (rawPitch === 42 || rawPitch === 44) pitch = 2
            else if (rawPitch === 46) pitch = 3
            else if (rawPitch === 49 || rawPitch === 51) pitch = 4
            else pitch = rawPitch % 5
          } else {
            pitch = draftDrumMap[rawPitch]
          }
        } else {
          if (draftSynthMap[rawPitch] !== undefined) {
            pitch = draftSynthMap[rawPitch]
          }
        }

        // Apply Humanization
        const hTime = (midiRemapData.humanizeTiming || 0) > 0 ? (Math.random() * 2 - 1) * (midiRemapData.humanizeTiming / 100) * 48 : 0
        const hVel = (midiRemapData.humanizeVelocity || 0) > 0 ? (Math.random() * 2 - 1) * (midiRemapData.humanizeVelocity / 100) * 64 : 0

        const finalVelocity = Math.round(clamp(
          (n.velocity * 127 * (midiRemapData.velocityScale || 1.0)) + (midiRemapData.velocityOffset || 0) + hVel,
          1, 127
        ))

        newNotes.push({
          id: newId(),
          trackId: finalTrackId,
          time: n.ticks * ppqScale + timeOffset + hTime,
          duration: Math.max(12, n.durationTicks * ppqScale),
          pitch,
          velocity: finalVelocity
        })
      })
    }

    const maxTick = Math.max(...newNotes.map(n => n.time + n.duration))
    const currentGridTicks = gridColumnCount * gridBlockTicks
    if (maxTick > currentGridTicks) {
      const neededCols = Math.ceil(maxTick / gridBlockTicks)
      useStore.setState({ gridColumnCount: neededCols })
    }

    useStore.setState({ notes: [...notes, ...newNotes] })
    setIsMidiLabInjecting(false)
    setActiveLabTrack(null)
  }

  const buildMuzinsConfig = () => {
    if (designerTab === 'drum') {
      return designerDrumKitConfig
    }

    const envelope = {
      attack: designerAttack,
      decay: designerDecay,
      sustain: designerSustain,
      release: designerRelease
    }

    const oscConfig = designerWaveformMode === 'fourier'
      ? { type: 'custom' as const, partials: calculateFourierPartials(designerFourierExpr, designerFourierCount) }
      : { type: designerOscillator }

    if (designerEngine === 'Synth') {
      return {
        oscillator: oscConfig,
        envelope
      }
    }

    if (designerEngine === 'FMSynth') {
      return {
        harmonicity: designerHarmonicity,
        modulationIndex: designerModulationIndex,
        oscillator: oscConfig,
        envelope,
        modulationEnvelope: {
          attack: designerModAttack,
          decay: designerModDecay,
          sustain: designerModSustain,
          release: designerModRelease
        }
      }
    }

    // MonoSynth
    return {
      oscillator: oscConfig,
      filter: {
        Q: designerFilterQ,
        type: designerFilterType,
        rolloff: designerFilterRolloff
      },
      envelope,
      filterEnvelope: {
        attack: designerFilterEnvAttack,
        decay: designerFilterEnvDecay,
        sustain: designerFilterEnvSustain,
        release: designerFilterEnvRelease,
        baseFrequency: designerFilterEnvBaseFrequency,
        octaves: designerFilterEnvOctaves
      }
    }
  }

  const handlePreview = async () => {
    try {
      await Tone.start()
      if (designerTab === 'drum') {
        const piece = designerDrumPiece
        const pitchNum = parseInt(piece)
        const pieceKey = !isNaN(pitchNum) && pitchNum <= 15 ? (PITCH_TO_PIECE[pitchNum] || piece) : piece
        const config = designerDrumKitConfig[pieceKey]

        const isMembrane = ['kick', 'tomLow', 'tomMid', 'tomHigh', 'congaLow', 'congaHigh', 'claves'].includes(pieceKey) || (!isNaN(pitchNum) && pitchNum >= 16 && (config?.noise === undefined && config?.harmonicity === undefined))
        const isNoise = ['snare', 'clap', 'tambourine', 'rimshot'].includes(pieceKey) || (!isNaN(pitchNum) && pitchNum >= 16 && config?.noise !== undefined)

        let synth: any
        if (isMembrane) {
          synth = new Tone.MembraneSynth(config).toDestination()
        } else if (isNoise) {
          synth = new Tone.NoiseSynth(config).toDestination()
        } else {
          synth = new Tone.MetalSynth(config).toDestination()
          const freq = pieceKey === 'cowbell' ? 800 : pieceKey === 'crash' ? 300 : pieceKey === 'ride' ? 400 : undefined
          if (freq !== undefined) {
            synth.frequency.value = freq
          }
        }

        synth.volume.value = -4
        const now = Tone.now()

        if (isMembrane) {
          const pitchName = pieceKey === 'kick' ? 'C2' : pieceKey === 'claves' ? 'C5' : 'C3'
          synth.triggerAttackRelease(pitchName, '8n', now)
        } else {
          synth.triggerAttackRelease('8n', now)
        }

        setTimeout(() => {
          synth.dispose()
        }, 1000)
        return
      }

      const config = buildMuzinsConfig()
      let SynthClass: any = Tone.Synth
      if (designerEngine === 'FMSynth') SynthClass = Tone.FMSynth
      if (designerEngine === 'MonoSynth') SynthClass = Tone.MonoSynth

      const tempSynth = new Tone.PolySynth(SynthClass, config).toDestination()
      tempSynth.volume.value = -8

      const now = Tone.now()
      tempSynth.triggerAttackRelease('C4', '16n', now)
      tempSynth.triggerAttackRelease('E4', '16n', now + 0.15)
      tempSynth.triggerAttackRelease('G4', '16n', now + 0.30)
      tempSynth.triggerAttackRelease('C5', '8n', now + 0.45)

      setTimeout(() => {
        tempSynth.dispose()
      }, 1500)
    } catch (e) {
      console.error('Preview failed', e)
    }
  }

  const handlePreviewSequence = async () => {
    try {
      await Tone.start()
      const synths: Record<string, any> = {}
      const piecesToLoad = ['kick', 'hihatClosed', 'snare', 'clap']

      piecesToLoad.forEach(p => {
        const config = designerDrumKitConfig[p]
        const isMembrane = ['kick'].includes(p)
        const isNoise = ['snare', 'clap'].includes(p)

        let s: any
        if (isMembrane) {
          s = new Tone.MembraneSynth(config).toDestination()
        } else if (isNoise) {
          s = new Tone.NoiseSynth(config).toDestination()
        } else {
          s = new Tone.MetalSynth(config).toDestination()
        }
        s.volume.value = -8
        synths[p] = s
      })

      const now = Tone.now()
      synths.kick?.triggerAttackRelease('C2', '16n', now)
      synths.hihatClosed?.triggerAttackRelease('16n', now + 0.15)
      synths.snare?.triggerAttackRelease('16n', now + 0.30)
      synths.clap?.triggerAttackRelease('16n', now + 0.45)

      setTimeout(() => {
        Object.values(synths).forEach(s => s.dispose())
      }, 1500)
    } catch (e) {
      console.error('Sequence preview failed', e)
    }
  }

  const handleExportPatch = async () => {
    const data = {
      name: designerName,
      engineType: designerTab === 'synth' ? designerEngine : 'DrumKit',
      config: buildMuzinsConfig()
    }
    const jsonStr = JSON.stringify(data, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const saved = await saveFileWithDialog(blob, {
      filename: `${designerName.toLowerCase().replace(/\s+/g, '_')}.muzins`,
      title: 'Save Instrument Patch',
      filters: [{ name: 'MuseGrid Instrument Patch', extensions: ['muzins'] }]
    })
    if (saved) {
      useStore.getState().showToast(`Exported patch: ${designerName}.muzins`, 'success')
    }
  }

  const handleUseInstrumentOnTrack = (trackId: string) => {
    commitHistory()
    if (designerTab === 'synth') {
      updateTrack(trackId, {
        synthPreset: 'custom',
        customMuxins: {
          name: designerName,
          engineType: designerEngine,
          config: buildMuzinsConfig()
        }
      })
    } else {
      updateTrack(trackId, {
        drumKit: 'custom',
        customMuxins: {
          name: designerName,
          engineType: 'DrumKit',
          config: buildMuzinsConfig()
        }
      })
    }
    setDesignerShowTrackSelector(false)

    const nextVal = designerNameIndex + 1
    setDesignerNameIndex(nextVal)
    setDesignerName(`Untitled Instrument ${nextVal}`)

    useStore.getState().showToast(`Loaded "${designerName}" on track!`, 'success')
  }

  const settingsRatio = isLeftPaneFlipped ? 1 - leftPaneTopRatio : leftPaneTopRatio
  const tracksRatio = isLeftPaneFlipped ? leftPaneTopRatio : 1 - leftPaneTopRatio

  return (
    <div
      ref={paneRef}
      className="glass-panel"
      style={{ width: '100%', flexShrink: 0, height: '100%', borderRight: 'none', display: 'flex', flexDirection: isLeftPaneFlipped ? 'column-reverse' : 'column', zIndex: 10, overflow: 'hidden' }}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, trackId: '', mode: 'background' })
      }}
    >
      <div
        className="thin-scroll"
        style={{
          overflowY: settingsRatio === 0 ? 'hidden' : 'auto',
          flexShrink: 0,
          height: settingsRatio === 0 ? '0px' : settingsRatio === 1 ? '100%' : `calc(${settingsRatio * 100}% - 3px)`,
          opacity: settingsRatio === 0 ? 0 : 1,
          pointerEvents: settingsRatio === 0 ? 'none' : 'auto',
          transition: 'height 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1)',
          minHeight: 0
        }}
      >
        <Section title="Manage Settings" info="Preferences" defaultOpen={false}>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <button
              onClick={handleImportSettings}
              title="Import workstation preferences from a .muzset file"
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(77,171,247,0.15)',
                background: 'rgba(77,171,247,0.03)',
                color: '#4dabf7',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(77,171,247,0.08)'
                e.currentTarget.style.borderColor = 'rgba(77,171,247,0.3)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(77,171,247,0.03)'
                e.currentTarget.style.borderColor = 'rgba(77,171,247,0.15)'
              }}
            >
              <IconOpen size={12} />
              Load .muzset
            </button>

            <button
              onClick={handleExportSettings}
              title="Save current workstation preferences as a .muzset file"
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(105,219,124,0.15)',
                background: 'rgba(105,219,124,0.03)',
                color: '#69db7c',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(105,219,124,0.08)'
                e.currentTarget.style.borderColor = 'rgba(105,219,124,0.3)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(105,219,124,0.03)'
                e.currentTarget.style.borderColor = 'rgba(105,219,124,0.15)'
              }}
            >
              <IconDownload size={12} />
              Save .muzset
            </button>
          </div>

          <button
            onClick={handleSaveDefaultPreferences}
            title="Save all current workstation settings as your default startup configuration"
            style={{
              width: '100%',
              padding: '6px 8px',
              marginBottom: '6px',
              borderRadius: '6px',
              border: '1px solid rgba(255, 192, 72, 0.25)',
              background: 'rgba(255, 192, 72, 0.05)',
              color: '#ffc048',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 192, 72, 0.12)'
              e.currentTarget.style.borderColor = 'rgba(255, 192, 72, 0.45)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255, 192, 72, 0.05)'
              e.currentTarget.style.borderColor = 'rgba(255, 192, 72, 0.25)'
            }}
          >
            <IconSave size={12} />
            Save All as Default Preferences
          </button>

          {/* Custom Reset Button & Selection Checklist */}
          <button
            onClick={() => setShowResetSelection(!showResetSelection)}
            title="Choose specific panels and configurations to reset to defaults"
            style={{
              width: '100%',
              padding: '6px 12px',
              marginBottom: '6px',
              borderRadius: '6px',
              border: `1px solid ${showResetSelection ? 'rgba(77,171,247,0.3)' : 'rgba(255,255,255,0.06)'}`,
              background: showResetSelection ? 'rgba(77,171,247,0.08)' : 'rgba(255,255,255,0.02)',
              color: showResetSelection ? '#4dabf7' : 'rgba(255,255,255,0.6)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
            onMouseEnter={e => {
              if (!showResetSelection) {
                e.currentTarget.style.background = 'rgba(77,171,247,0.05)'
                e.currentTarget.style.borderColor = 'rgba(77,171,247,0.2)'
                e.currentTarget.style.color = '#4dabf7'
              }
            }}
            onMouseLeave={e => {
              if (!showResetSelection) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                e.currentTarget.style.color = 'rgba(255,255,255,0.6)'
              }
            }}
          >
            <IconSettings size={12} />
            {showResetSelection ? 'Close Custom Reset' : 'Reset Custom...'}
          </button>
          <div style={{
            maxHeight: showResetSelection ? '480px' : '0px',
            opacity: showResetSelection ? 1 : 0,
            overflow: 'hidden',
            transition: 'max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, margin-bottom 0.25s ease',
            marginBottom: showResetSelection ? '8px' : '0px'
          }}>
            <div style={{
              background: 'rgba(20,20,28,0.4)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              backdropFilter: 'blur(4px)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <span style={{ fontSize: '10px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>
                  Select areas to reset:
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setSelectedPanesToReset({
                      engine: true, metronome: true, playback: true, grid: true, tools: true, scale: true,
                      layout: true, visuals: true, velocity: true, groove: true, deduplicate: true, presets: true
                    })}
                    style={{ background: 'none', border: 'none', color: '#4dabf7', fontSize: '9.5px', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setSelectedPanesToReset({
                      engine: false, metronome: false, playback: false, grid: false, tools: false, scale: false,
                      layout: false, visuals: false, velocity: false, groove: false, deduplicate: false, presets: false
                    })}
                    style={{ background: 'none', border: 'none', color: '#888', fontSize: '9.5px', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    None
                  </button>
                </div>
              </div>

              {/* Checkbox Rows */}
              {[
                { key: 'engine', label: 'Engine (Master Vol, Limiter, Normalization)' },
                { key: 'metronome', label: 'Click & Metronome Synthesis' },
                { key: 'playback', label: 'Playback (BPM, Signature, Swing, Loops)' },
                { key: 'grid', label: 'Grid Snap, Shading & Stretch Zoom' },
                { key: 'tools', label: 'Active Cursor Tools & Inspector' },
                { key: 'scale', label: 'Scale Snapping & Free Pitch' },
                { key: 'layout', label: 'Layout Ratios, Splits & Scroll Locks' },
                { key: 'visuals', label: 'Visuals, Zoom & Ghost Notes' },
                { key: 'velocity', label: 'Velocity Lanes & Vocal Velocity Engine' },
                { key: 'groove', label: 'Groove Pool & Humanization' },
                { key: 'deduplicate', label: 'Note Deduplication Engine' },
                { key: 'presets', label: 'Custom FX & Voice Designer Presets' }
              ].map(item => {
                const isSelected = (selectedPanesToReset as any)[item.key]
                return (
                  <div
                    key={item.key}
                    onClick={() => setSelectedPanesToReset(prev => ({ ...prev, [item.key]: !isSelected }))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      background: 'rgba(255,255,255,0.01)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontSize: '11px',
                      color: isSelected ? 'white' : '#aaa',
                      transition: 'all 0.15s',
                      border: '1px solid rgba(255,255,255,0.02)'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.01)' }}
                  >
                    <span style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '3px',
                      border: `1px solid ${isSelected ? '#4dabf7' : 'rgba(255,255,255,0.2)'}`,
                      background: isSelected ? 'rgba(77,171,247,0.2)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isSelected && (
                        <span style={{ width: '6px', height: '6px', borderRadius: '1px', background: '#4dabf7' }} />
                      )}
                    </span>
                    {item.label}
                  </div>
                )
              })}

              <button
                onClick={handleCustomReset}
                title="Execute reset for only selected panels"
                style={{
                  width: '100%',
                  padding: '5px 10px',
                  marginTop: '4px',
                  borderRadius: '4px',
                  border: '1px solid rgba(77,171,247,0.25)',
                  background: 'rgba(77,171,247,0.1)',
                  color: '#4dabf7',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(77,171,247,0.2)'
                  e.currentTarget.style.borderColor = 'rgba(77,171,247,0.4)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(77,171,247,0.1)'
                  e.currentTarget.style.borderColor = 'rgba(77,171,247,0.25)'
                }}
              >
                Confirm Custom Reset
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }} title="Enable or disable auto-saving your work to local storage. Disabling it stops persistence completely.">Auto-Save Persistence</span>
            <ToggleSwitch checked={persistenceEnabled} onChange={checked => updateStudio({ persistenceEnabled: checked })} color="#4dabf7" />
          </div>

          <button
            onClick={handleResetSettings}
            title="Reset all workstation settings to defaults"
            style={{
              width: '100%',
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,80,80,0.1)'
              e.currentTarget.style.borderColor = 'rgba(255,80,80,0.2)'
              e.currentTarget.style.color = '#ff6b6b'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
              e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
            }}
          >
            <IconSync size={12} />
            Reset Workstation
          </button>
        </Section>

        <Section title="Engine" info={`${Math.round(studioSettings.masterVolume * 100)}% Vol`} defaultOpen={false}>
          <SliderRow label="Master Volume" value={studioSettings.masterVolume} min={0} max={1} step={0.01} color="#ff3366" onChange={v => updateStudio({ masterVolume: v })} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Play Full Note on Pause</span>
            <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', cursor: 'pointer', flexShrink: 0 }}>
              <input
                type="checkbox"
                checked={completeNotesOnPause}
                onChange={e => setCompleteNotesOnPause(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span style={{ position: 'absolute', inset: 0, borderRadius: '20px', background: completeNotesOnPause ? '#4dabf7' : '#333', transition: 'background 0.2s' }}>
                <span style={{ position: 'absolute', top: '3px', left: completeNotesOnPause ? '19px' : '3px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', marginTop: '12px', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '6px', fontWeight: 600 }}>Audio Engine Core</span>
            <select
              value={engineMode}
              onChange={e => {
                const mode = e.target.value as 'tone' | 'wasm'
                setEngineMode(mode)
                const label = mode === 'tone' ? 'JUCE Native (Tone.js Core)' : 'JUCE Native (WASM DSP Core)'
                useStore.getState().showToast(`Switched engine to ${label}`, 'success')
              }}
              style={{ width: '100%', background: '#1e1e2e', color: 'white', padding: '6px', borderRadius: '4px', border: '1px solid #333', fontSize: '11px', outline: 'none', cursor: 'pointer' }}
            >
              <option value="tone">JUCE Native (Tone.js Core)</option>
              <option value="wasm">JUCE Native (WASM DSP Core)</option>
            </select>
            <div style={{
              maxHeight: engineMode === 'wasm' ? '120px' : '0px',
              opacity: engineMode === 'wasm' ? 1 : 0,
              overflow: 'hidden',
              transition: 'max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, margin-top 0.25s ease',
              marginTop: engineMode === 'wasm' ? '6px' : '0px',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px',
                borderRadius: '6px',
                background: 'rgba(255, 193, 7, 0.08)',
                border: '1px solid rgba(255, 193, 7, 0.25)',
                color: '#ffe066',
                fontSize: '10px',
                lineHeight: '1.4'
              }}>
                <IconAlertTriangle size={13} style={{ color: '#ffe066', flexShrink: 0 }} />
                <span>WASM engine is currently experimental and may occasionally fall back to Tone.js if audio worklet channels underflow or experience high jitter.</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <button
              onClick={() => useStore.getState().setIsScriptingModalVisible(true)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(218, 119, 242, 0.15)',
                color: '#da77f2',
                border: '1px solid rgba(218, 119, 242, 0.3)',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <IconPlay size={12} />
              Open Scripting API
            </button>

            <span style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '4px', fontWeight: 600 }}>Audio Sample Rate</span>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <select
                value={[44100, 48000, 88200, 96000].includes(studioSettings.sampleRate || 44100) ? (studioSettings.sampleRate || 44100) : 'custom'}
                onChange={e => {
                  if (e.target.value === 'custom') {
                    updateStudio({ sampleRate: 192000 })
                    useStore.getState().showToast('Sample rate updated. Please reload the page for changes to take effect.', 'info')
                  } else {
                    const newRate = parseInt(e.target.value, 10)
                    updateStudio({ sampleRate: newRate })
                    useStore.getState().showToast('Sample rate updated. Please reload the page for changes to take effect.', 'info')
                  }
                }}
                style={{ flex: 1, background: '#1e1e2e', color: 'white', padding: '4px', borderRadius: '4px', border: '1px solid #333', fontSize: '11px', outline: 'none' }}
              >
                <option value={44100}>44100 Hz</option>
                <option value={48000}>48000 Hz</option>
                <option value={88200}>88200 Hz</option>
                <option value={96000}>96000 Hz</option>
                <option value="custom">Custom...</option>
              </select>
              {![44100, 48000, 88200, 96000].includes(studioSettings.sampleRate || 44100) && (
                <input
                  type="number"
                  value={studioSettings.sampleRate || 192000}
                  onChange={e => {
                    const newRate = parseInt(e.target.value, 10)
                    if (!isNaN(newRate)) updateStudio({ sampleRate: newRate })
                  }}
                  onBlur={() => useStore.getState().showToast('Sample rate updated. Please reload the page for changes to take effect.', 'info')}
                  style={{ width: '80px', background: '#1e1e2e', color: '#4dabf7', padding: '4px', borderRadius: '4px', border: '1px solid #333', fontSize: '11px', outline: 'none', textAlign: 'center' }}
                  title="Custom Sample Rate (Hz)"
                />
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Master Limiter</span>
              <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', cursor: 'pointer', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={limiterEnabled}
                  onChange={e => {
                    try {
                      updateStudio({ limiterEnabled: e.target.checked })
                    } catch (err) {
                      console.error("Failed to toggle limiter:", err)
                    }
                  }}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{ position: 'absolute', inset: 0, borderRadius: '20px', background: limiterEnabled ? '#4dabf7' : '#333', transition: 'background 0.2s' }}>
                  <span style={{ position: 'absolute', top: '3px', left: limiterEnabled ? '19px' : '3px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                </span>
              </label>
            </div>
            {limiterEnabled && (
              <SliderRow
                label="Threshold"
                value={limiterThreshold}
                min={-10.0}
                max={0.0}
                step={0.1}
                suffix=" dB"
                color="#4dabf7"
                onChange={v => {
                  try {
                    updateStudio({ limiterThreshold: parseFloat(v.toFixed(1)) })
                  } catch (err) {
                    console.error("Failed to update limiter threshold:", err)
                  }
                }}
              />
            )}
          </div>

          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <TextInputRow label="Render Fade (s)" value={studioSettings.renderFadeDuration} onChange={v => updateStudio({ renderFadeDuration: v })} color="#4dabf7" />
            <TextInputRow label="Norm. Target (dB)" value={studioSettings.normalizationTarget} onChange={v => updateStudio({ normalizationTarget: v })} color="#4dabf7" />
            <TextInputRow label="Loop Buffer (t)" value={studioSettings.loopEndBuffer} onChange={v => updateStudio({ loopEndBuffer: v })} color="#4dabf7" />
            <div style={{ marginTop: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Global Velocity Math Curve (v = 0 to 1)</span>
              <MathInput
                value={studioSettings.velocityCurveFormula || 'v'}
                onChange={v => updateStudio({ velocityCurveFormula: v })}
                placeholder="e.g. Math.pow(v, 2)"
                className="modulator-input"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', padding: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Procedural FX Engine</span>
              <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', cursor: 'pointer', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={studioSettings.proceduralFxEnabled}
                  onChange={e => updateStudio({ proceduralFxEnabled: e.target.checked })}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: studioSettings.proceduralFxEnabled ? '#4dabf7' : '#2c2e3e',
                  transition: '.4s', borderRadius: '34px'
                }}></span>
                <span style={{
                  position: 'absolute', content: '""', height: '14px', width: '14px',
                  left: studioSettings.proceduralFxEnabled ? '19px' : '3px', bottom: '3px',
                  backgroundColor: 'white', transition: '.4s', borderRadius: '50%'
                }}></span>
              </label>
            </div>
            {studioSettings.proceduralFxEnabled && (
              <div style={{ padding: '0 8px 8px 8px' }}>
                <span style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '4px' }}>Evaluation Rate</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    value={['16n', '32n', '64n', '128n'].includes(studioSettings.proceduralFxRate) ? studioSettings.proceduralFxRate : 'custom'}
                    onChange={e => {
                      if (e.target.value === 'custom') {
                        updateStudio({ proceduralFxRate: '8n' })
                      } else {
                        updateStudio({ proceduralFxRate: e.target.value as any })
                      }
                    }}
                    style={{ flex: 1, background: '#1e1e2e', color: 'white', padding: '4px', borderRadius: '4px', border: '1px solid #333', fontSize: '11px', outline: 'none' }}
                  >
                    <option value="16n">16th Note</option>
                    <option value="32n">32nd Note</option>
                    <option value="64n">64th Note</option>
                    <option value="128n">128th Note</option>
                    <option value="custom">Custom...</option>
                  </select>
                  {!['16n', '32n', '64n', '128n'].includes(studioSettings.proceduralFxRate) && (
                    <input
                      type="text"
                      value={studioSettings.proceduralFxRate}
                      onChange={e => updateStudio({ proceduralFxRate: e.target.value as any })}
                      style={{ width: '60px', background: '#1e1e2e', color: '#4dabf7', padding: '4px', borderRadius: '4px', border: '1px solid #333', fontSize: '11px', outline: 'none', textAlign: 'center' }}
                      title="Custom Rate (e.g. 8n, 4t, 2m, or seconds)"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </Section>

        <Section title="Tools" info={activeTool.toUpperCase()} defaultOpen={false}>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
            <ToolBtn label={<><IconPencil size={13} /> Draw</>} active={activeTool === 'draw'} color="#4dabf7" onClick={() => setActiveTool('draw')} title="Draw notes (D)" />
            <ToolBtn label={<><IconEraser size={13} /> Erase</>} active={activeTool === 'erase'} color="#ff3366" onClick={() => setActiveTool('erase')} title="Erase notes (E)" />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <ToolBtn label={<><IconCursor size={13} /> Select</>} active={activeTool === 'select'} color="#aaaaaa" onClick={() => setActiveTool('select')} title="Box select (S)" />
            <ToolBtn label={<><IconScissors size={13} /> Slice</>} active={activeTool === 'slice'} color="#ffcc00" onClick={() => setActiveTool('slice')} title="Slice note (X)" />
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <ToolBtn label={<><IconStretch size={13} /> Stretch</>} active={activeTool === 'stretch'} color="#b197fc" onClick={() => setActiveTool('stretch')} title="Stretch selected notes" />
          </div>
        </Section>

        <Section title="Edit" info={selectedNoteIds.length > 0 ? `${selectedNoteIds.length} Sel` : (activeTrack ? activeTrack.name : 'Track')} defaultOpen={false}>
          <MidiEditSection activeTrack={activeTrack} />
        </Section>

        <Section title="Playback" defaultOpen={false}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#aaa' }}><IconLoop size={13} /> Loop</span>
            <ToggleSwitch checked={loopEnabled} onChange={setLoopEnabled} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Metronome</span>
            <ToggleSwitch checked={metronomeEnabled} onChange={setMetronomeEnabled} color="#ffcc00" />
          </div>
          <SliderRow label="Click" value={metronomeVolume} min={0} max={1} step={0.01} suffix="" color="#ffcc00" onChange={setMetronomeVolume} />
          <SliderRow label="Swing" value={swing} min={0} max={100} suffix="%" onChange={setSwing} />
          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <SliderRow label="Loop Start" value={loopStart} min={0} max={Math.max(loopEnd - 48, 768)} step={0.1} suffix="t" color="#4dabf7" onChange={setLoopStart} />
            <SliderRow label="Loop End" value={loopEnd} min={loopStart + 48} max={Math.max(getMaxTicks() + 768, 3072)} step={0.1} suffix="t" color="#4dabf7" onChange={setLoopEnd} />
          </div>
        </Section>

        <Section title="Click" info={`${metronomeSettings.volume} dB`} defaultOpen={false}>
          <TextInputRow label="Pitch Decay" value={metronomeSettings.pitchDecay} onChange={v => updateMetronome({ pitchDecay: v })} color="#ffcc00" />
          <TextInputRow label="Octaves" value={metronomeSettings.octaves} onChange={v => updateMetronome({ octaves: v })} color="#ffcc00" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px', marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
            <TextInputRow label="Attack" value={metronomeSettings.attack} onChange={v => updateMetronome({ attack: v })} color="#69db7c" />
            <TextInputRow label="Decay" value={metronomeSettings.decay} onChange={v => updateMetronome({ decay: v })} color="#69db7c" />
            <TextInputRow label="Sustain" value={metronomeSettings.sustain} onChange={v => updateMetronome({ sustain: v })} color="#69db7c" />
            <TextInputRow label="Release" value={metronomeSettings.release} onChange={v => updateMetronome({ release: v })} color="#69db7c" />
          </div>
          <div style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
            <TextInputRow label="Gain (dB)" value={metronomeSettings.volume} onChange={v => updateMetronome({ volume: v })} color="#ff3366" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px', marginTop: '10px' }}>
              <StringInputRow label="Down-Pitch" value={metronomeSettings.downbeatPitch} onChange={v => updateMetronome({ downbeatPitch: v })} color="#ffcc00" />
              <StringInputRow label="Up-Pitch" value={metronomeSettings.upbeatPitch} onChange={v => updateMetronome({ upbeatPitch: v })} color="#ffcc00" />
              <TextInputRow label="Down-Vel" value={metronomeSettings.downbeatVel} onChange={v => updateMetronome({ downbeatVel: v })} color="#aaaaaa" />
              <TextInputRow label="Up-Vel" value={metronomeSettings.upbeatVel} onChange={v => updateMetronome({ upbeatVel: v })} color="#aaaaaa" />
            </div>
          </div>
        </Section>

        <Section
          title="Recording & Capture Hub"
          info={isStepRecording ? "STEP ACTIVE" : (isRecording ? "REC LIVE" : (countInRemaining !== null ? `COUNT ${countInRemaining}` : (activeMidiDeviceNames.length > 0 ? `${activeMidiDeviceNames.length} MIDI` : undefined)))}
          defaultOpen={false}
        >
          {/* Main Action Bar: Live Record + Step Record + Active Recall */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px', marginBottom: '10px' }}>
            {/* Live Record Toggle Button */}
            <button
              onClick={() => recordingEngine.toggleRecording()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '8px 6px',
                borderRadius: '6px',
                fontSize: '10.5px',
                fontWeight: 800,
                cursor: 'pointer',
                border: `1px solid ${countInRemaining !== null ? 'rgba(255,204,0,0.6)' : (isRecording ? '#ff2d55' : 'rgba(255,45,85,0.3)')}`,
                background: countInRemaining !== null
                  ? 'rgba(255,204,0,0.2)'
                  : (isRecording ? 'rgba(255,45,85,0.28)' : 'rgba(255,45,85,0.08)'),
                color: countInRemaining !== null ? '#ffcc00' : (isRecording ? '#ff4d6d' : '#ff8599'),
                boxShadow: isRecording ? '0 0 12px rgba(255,45,85,0.4)' : 'none',
                transition: 'all 0.15s ease'
              }}
              title="Realtime continuous performance recording"
            >
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: countInRemaining !== null ? '#ffcc00' : (isRecording ? '#ff2d55' : '#778'),
                boxShadow: (isRecording || countInRemaining !== null) ? '0 0 8px currentColor' : 'none',
              }} />
              {countInRemaining !== null ? `COUNT: ${countInRemaining}` : (isRecording ? 'STOP' : 'LIVE REC')}
            </button>

            {/* Step Record Toggle Button */}
            <button
              onClick={() => recordingEngine.toggleStepRecording()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '8px 6px',
                borderRadius: '6px',
                fontSize: '10.5px',
                fontWeight: 800,
                cursor: 'pointer',
                border: `1px solid ${isStepRecording ? '#00e6ff' : 'rgba(0,230,255,0.3)'}`,
                background: isStepRecording ? 'rgba(0,230,255,0.24)' : 'rgba(0,230,255,0.06)',
                color: isStepRecording ? '#00e6ff' : '#6fe7f7',
                boxShadow: isStepRecording ? '0 0 12px rgba(0,230,255,0.4)' : 'none',
                transition: 'all 0.15s ease'
              }}
              title="Step-by-step column-by-column and bar-by-bar entry"
            >
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '2px',
                background: isStepRecording ? '#00e6ff' : '#778',
                boxShadow: isStepRecording ? '0 0 8px #00e6ff' : 'none',
              }} />
              {isStepRecording ? 'STEP ACTIVE' : 'STEP REC'}
            </button>

            {/* Active Recall / Capture MIDI Button */}
            <button
              onClick={() => recordingEngine.captureActiveRecall()}
              title="Dump recently jammed notes directly into track without having pressed Record"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '8px 6px',
                borderRadius: '6px',
                fontSize: '10.5px',
                fontWeight: 700,
                cursor: 'pointer',
                border: '1px solid rgba(255,204,0,0.3)',
                background: retrospectiveNoteCount > 0 ? 'rgba(255,204,0,0.12)' : 'rgba(255,255,255,0.03)',
                color: retrospectiveNoteCount > 0 ? '#ffcc00' : '#888',
                transition: 'all 0.15s ease'
              }}
            >
              <IconZap size={11} color={retrospectiveNoteCount > 0 ? '#ffcc00' : '#888'} />
              <span>RECALL</span>
              {retrospectiveNoteCount > 0 && (
                <span style={{
                  fontSize: '8.5px',
                  background: '#ffcc00',
                  color: '#1a1a24',
                  padding: '0 3px',
                  borderRadius: '10px',
                  fontWeight: 800
                }}>
                  {retrospectiveNoteCount}
                </span>
              )}
            </button>
          </div>

          {/* Active Recall Placement Options Card */}
          <div style={{
            marginBottom: '10px',
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid rgba(255,204,0,0.2)',
            background: 'rgba(255,204,0,0.03)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <IconZap size={11} color="#ffcc00" />
                <span style={{ fontSize: '10px', color: '#ffcc00', fontWeight: 800, letterSpacing: '0.4px' }}>
                  ACTIVE RECALL PLACEMENT
                </span>
              </div>
              {retrospectiveNoteCount > 0 && (
                <button
                  onClick={() => recordingEngine.clearRetrospectiveBuffer()}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#778',
                    fontSize: '9px',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                  title="Clear remembered jam notes from buffer"
                >
                  Clear ({retrospectiveNoteCount})
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px', marginBottom: '4px' }}>
              {[
                { id: 'time_snap' as const, label: 'Time + Snap', tip: 'Preserves timing and snaps to grid (Default)' },
                { id: 'time_free' as const, label: 'Real Time', tip: 'Preserves exact unquantized human timing' },
                { id: 'sequence_columns' as const, label: 'Columns', tip: 'Places chords/notes into sequential columns' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setRecallPlacementMode(opt.id)}
                  title={opt.tip}
                  style={{
                    padding: '4px 2px',
                    borderRadius: '4px',
                    fontSize: '9.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: recallPlacementMode === opt.id ? '#ffcc00' : 'rgba(255,255,255,0.06)',
                    background: recallPlacementMode === opt.id ? 'rgba(255,204,0,0.18)' : 'rgba(255,255,255,0.02)',
                    color: recallPlacementMode === opt.id ? '#ffcc00' : '#888',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ fontSize: '8.5px', color: '#889', lineHeight: 1.3 }}>
              {recallPlacementMode === 'time_snap' && 'Places notes based on relative jam time snapped to current grid resolution.'}
              {recallPlacementMode === 'time_free' && 'Places notes with exact micro-timing as played without snapping.'}
              {recallPlacementMode === 'sequence_columns' && 'Places each chord / note into sequential columns step-by-step.'}
            </div>
          </div>

          {/* STEP RECORDING DEDICATED CONTROL PANEL */}
          <div style={{
            marginBottom: '10px',
            padding: '10px',
            borderRadius: '8px',
            border: `1px solid ${isStepRecording ? 'rgba(0,230,255,0.35)' : 'rgba(255,255,255,0.06)'}`,
            background: isStepRecording ? 'rgba(0,230,255,0.04)' : 'rgba(255,255,255,0.02)',
            boxShadow: isStepRecording ? '0 0 16px rgba(0,230,255,0.06)' : 'none',
            transition: 'all 0.2s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: isStepRecording ? '#00e6ff' : '#aaa', fontWeight: 800, letterSpacing: '0.5px' }}>
                  STEP-BY-STEP (BAR & COLUMN)
                </span>
              </div>
              <span style={{
                fontSize: '9px',
                padding: '1px 5px',
                borderRadius: '4px',
                fontWeight: 700,
                background: isStepRecording ? 'rgba(0,230,255,0.2)' : 'rgba(255,255,255,0.05)',
                color: isStepRecording ? '#00e6ff' : '#777'
              }}>
                {isStepRecording ? 'ARMED' : 'STANDBY'}
              </span>
            </div>

            {/* Position Display & Quick Navigation */}
            <div style={{
              background: 'rgba(0,0,0,0.35)',
              padding: '6px 8px',
              borderRadius: '6px',
              marginBottom: '8px',
              border: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '10.5px', color: '#fff', fontWeight: 700, fontFamily: 'monospace' }}>
                  Col #{Math.floor(stepRecordCursorTick / Math.max(1, (stepRecordStepSize > 0 ? stepRecordStepSize : snapResolution) * (stepRecordStepColumns || 1))) + 1}
                  <span style={{ color: '#00e6ff', marginLeft: '6px' }}>
                    [Bar {Math.floor(stepRecordCursorTick / 768) + 1}.{Math.floor((stepRecordCursorTick % 768) / 192) + 1}]
                  </span>
                </div>
                <div style={{ fontSize: '9px', color: '#778', marginTop: '1px' }}>
                  Tick {stepRecordCursorTick} • Step width: {Math.round((stepRecordStepSize > 0 ? stepRecordStepSize : snapResolution) * (stepRecordStepColumns || 1))} ticks
                </div>
              </div>

              {/* Step Navigation Buttons */}
              <div style={{ display: 'flex', gap: '3px' }}>
                <button
                  onClick={() => retreatStepRecordCursor()}
                  title="Move back 1 step [Left Arrow]"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#ddd',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    fontWeight: 700
                  }}
                >
                  ◀
                </button>
                <button
                  onClick={() => advanceStepRecordCursor()}
                  title="Skip column / Insert Rest [Right Arrow]"
                  style={{
                    background: 'rgba(0,230,255,0.12)',
                    border: '1px solid rgba(0,230,255,0.3)',
                    color: '#00e6ff',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    fontWeight: 700
                  }}
                >
                  Rest ▶
                </button>
                <button
                  onClick={() => deleteStepRecordCurrentColumn()}
                  title="Delete notes in this step and step back [Backspace]"
                  style={{
                    background: 'rgba(255,45,85,0.12)',
                    border: '1px solid rgba(255,45,85,0.3)',
                    color: '#ff4d6d',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    fontWeight: 700
                  }}
                >
                  ⌫
                </button>
              </div>
            </div>

            {/* Advance Trigger Mode */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                <span style={{ fontSize: '10px', color: '#ccc', fontWeight: 600 }}>Step Advance Trigger</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px' }}>
                {[
                  { id: 'release' as const, label: 'On Release' },
                  { id: 'timer' as const, label: 'On Timer' },
                  { id: 'manual' as const, label: 'Manual Key' },
                ].map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => setStepRecordAdvanceMode(mode.id)}
                    style={{
                      padding: '4px 2px',
                      borderRadius: '4px',
                      fontSize: '9.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: stepRecordAdvanceMode === mode.id ? '#00e6ff' : 'rgba(255,255,255,0.06)',
                      background: stepRecordAdvanceMode === mode.id ? 'rgba(0,230,255,0.18)' : 'rgba(255,255,255,0.02)',
                      color: stepRecordAdvanceMode === mode.id ? '#00e6ff' : '#888'
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '8.5px', color: '#667', marginTop: '2px' }}>
                {stepRecordAdvanceMode === 'release' && 'Advances as soon as all fingers are lifted off chord keys'}
                {stepRecordAdvanceMode === 'timer' && 'Advances after the chord sensitivity window times out'}
                {stepRecordAdvanceMode === 'manual' && 'Plays chord, press [Enter] or [Space] or [▶] to advance'}
              </div>
            </div>

            {/* Chord Latch Delay Sensitivity Slider */}
            <div style={{ marginBottom: '8px', padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
              <SliderRow
                label="Chord Latch Delay"
                value={stepRecordChordSensitivityMs}
                min={20}
                max={500}
                step={5}
                suffix="ms"
                color="#ffcc00"
                onChange={v => setStepRecordChordSensitivityMs(Math.round(v))}
              />
              <div style={{ fontSize: '8.5px', color: '#778', marginTop: '-4px' }}>
                Tolerance window for non-synchronized finger presses when hitting chords
              </div>
            </div>

            {/* Step Advance Distance (Column Spacing) */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                <span style={{ fontSize: '10px', color: '#ccc', fontWeight: 600 }}>Step Advance Spacing</span>
                <span style={{ fontSize: '9px', color: '#00e6ff', fontWeight: 700 }}>
                  {stepRecordStepColumns} col {stepRecordStepSize > 0 ? `(${stepRecordStepSize}t)` : '(Grid Snap)'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '4px', marginBottom: '6px' }}>
                {[
                  { label: 'Grid', val: -1 },
                  { label: '1/16', val: 48 },
                  { label: '1/8', val: 96 },
                  { label: '1/4', val: 192 },
                  { label: '1/2', val: 384 },
                  { label: '1 Bar', val: 768 },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => setStepRecordStepSize(item.val)}
                    style={{
                      flex: 1,
                      padding: '3px 2px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: stepRecordStepSize === item.val ? '#00e6ff' : 'transparent',
                      color: stepRecordStepSize === item.val ? '#1a1a24' : '#888',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {/* Step Column Multiplier slider (allows e.g. 1.5 columns spacing) */}
              <SliderRow
                label="Advance Multiplier"
                value={stepRecordStepColumns}
                min={0.25}
                max={4.0}
                step={0.25}
                suffix="x"
                color="#00e6ff"
                onChange={v => setStepRecordStepColumns(Number(v.toFixed(2)))}
              />
            </div>

            {/* Note Duration (Length & Gate) */}
            <div style={{ marginBottom: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                <span style={{ fontSize: '10px', color: '#ccc', fontWeight: 600 }}>Note Length (Duration)</span>
                <span style={{ fontSize: '9px', color: '#ff4d6d', fontWeight: 700 }}>
                  {stepRecordNoteDuration === -1 ? `${stepRecordNoteColumns}x step` : `${stepRecordNoteColumns} col (${stepRecordNoteDuration}t)`}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '4px', marginBottom: '6px' }}>
                {[
                  { label: 'Auto', val: -1 },
                  { label: '1/32', val: 24 },
                  { label: '1/16', val: 48 },
                  { label: '1/8', val: 96 },
                  { label: '1/4', val: 192 },
                  { label: '1 Bar', val: 768 },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => setStepRecordNoteDuration(item.val)}
                    style={{
                      flex: 1,
                      padding: '3px 2px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: stepRecordNoteDuration === item.val ? '#ff4d6d' : 'transparent',
                      color: stepRecordNoteDuration === item.val ? '#fff' : '#888',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {/* Note width multiplier slider */}
              <SliderRow
                label="Length Multiplier"
                value={stepRecordNoteColumns}
                min={0.25}
                max={4.0}
                step={0.25}
                suffix="x"
                color="#ff4d6d"
                onChange={v => setStepRecordNoteColumns(Number(v.toFixed(2)))}
              />
              {/* Gate percentage */}
              <SliderRow
                label="Gate (Articulation)"
                value={stepRecordGatePercent}
                min={20}
                max={200}
                step={5}
                suffix="%"
                color="#ff8599"
                onChange={v => setStepRecordGatePercent(Math.round(v))}
              />
            </div>
          </div>

          {/* Target Track & Take Management */}
          <div style={{ marginBottom: '10px', padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: '#ff8599', fontWeight: 700, letterSpacing: '0.4px' }}>RECORD TARGET & TAKE MODE</span>
              <span style={{ fontSize: '9px', color: '#888' }}>
                {recordTargetMode === 'new_track' ? `Next: Recording ${recordTakeCounter}` : (activeTrack ? activeTrack.name : 'Current Track')}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '6px' }}>
              <button
                onClick={() => setRecordTargetMode('current')}
                style={{
                  padding: '5px 4px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: recordTargetMode === 'current' ? '#ff4d6d' : 'rgba(255,255,255,0.08)',
                  background: recordTargetMode === 'current' ? 'rgba(255,77,109,0.18)' : 'rgba(255,255,255,0.03)',
                  color: recordTargetMode === 'current' ? '#ff8599' : '#888',
                }}
              >
                Current Track
              </button>
              <button
                onClick={() => setRecordTargetMode('new_track')}
                style={{
                  padding: '5px 4px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: recordTargetMode === 'new_track' ? '#00e6ff' : 'rgba(255,255,255,0.08)',
                  background: recordTargetMode === 'new_track' ? 'rgba(0,230,255,0.18)' : 'rgba(255,255,255,0.03)',
                  color: recordTargetMode === 'new_track' ? '#00e6ff' : '#888',
                }}
              >
                New Track per Take
              </button>
            </div>
            {recordTargetMode === 'new_track' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: '#aaa', marginTop: '4px' }}>
                <span>Take Counter: #{recordTakeCounter}</span>
                <button
                  onClick={() => setRecordTakeCounter(1)}
                  style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '9px', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Reset Counter
                </button>
              </div>
            )}
          </div>

          {/* Recording Behavior (Overdub vs Replace & Count-In) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
            {/* Take Overdub vs Replace */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#ccc', fontWeight: 600, display: 'block' }}>Layer Mode (Overdub)</span>
                <span style={{ fontSize: '9px', color: '#777' }}>{midiOverdub ? 'Layer over existing notes' : 'Replace / punch-in overwrite'}</span>
              </div>
              <ToggleSwitch checked={midiOverdub} onChange={setMidiOverdub} color="#00e6ff" />
            </div>

            {/* Count-In Pre-Roll */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#ccc', fontWeight: 600, display: 'block' }}>Count-In Pre-Roll</span>
                <span style={{ fontSize: '9px', color: '#777' }}>Metronome click before live punch-in</span>
              </div>
              <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '4px' }}>
                {[
                  { label: 'Off', val: 0 },
                  { label: '1 Bar', val: 1 },
                  { label: '2 Bars', val: 2 },
                ].map(item => (
                  <button
                    key={item.val}
                    onClick={() => setRecordCountIn(item.val as 0 | 1 | 2)}
                    style={{
                      padding: '3px 7px',
                      borderRadius: '3px',
                      fontSize: '9.5px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: recordCountIn === item.val ? '#ffcc00' : 'transparent',
                      color: recordCountIn === item.val ? '#1a1a24' : '#888',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Record Input Quantize */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: '#ccc', fontWeight: 600 }}>Record Snap</span>
              <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '4px' }}>
                {[
                  { label: 'Off', val: 0 },
                  { label: '1/16', val: 48 },
                  { label: '1/8', val: 96 },
                  { label: 'Grid', val: -1 },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => setRecordInputQuantize(item.val)}
                    style={{
                      padding: '3px 6px',
                      borderRadius: '3px',
                      fontSize: '9.5px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: recordInputQuantize === item.val ? '#4dabf7' : 'transparent',
                      color: recordInputQuantize === item.val ? '#1a1a24' : '#888',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto Scale Conform */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#ccc', fontWeight: 600, display: 'block' }}>Scale Conform</span>
                <span style={{ fontSize: '9px', color: '#777' }}>Force incoming notes into active scale</span>
              </div>
              <ToggleSwitch checked={recordScaleConform} onChange={setRecordScaleConform} color="#4dabf7" />
            </div>

            {/* Microtonal EDO Keyboard Remap */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(0,230,255,0.04)', border: '1px solid rgba(0,230,255,0.15)', borderRadius: '6px', padding: '6px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', color: '#00e6ff', fontWeight: 700, letterSpacing: '0.4px' }}>MIDI / QWERTY EDO REMAP</span>
                <span style={{ fontSize: '9px', color: '#aaa', fontWeight: 600 }}>
                  {activeTrack?.instrument === 'synth' && activeTrack?.edoDivision && activeTrack.edoDivision !== 12
                    ? `${activeTrack.edoDivision}-EDO (${(1200 / activeTrack.edoDivision).toFixed(1)}¢)`
                    : '12-TET'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '4px' }}>
                {[
                  { label: 'Off', val: 'off' },
                  { label: 'Linear EDO', val: 'linear' },
                  { label: 'Harmonic', val: 'harmonic' },
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => setRecordEdoMappingMode(opt.val as any)}
                    style={{
                      padding: '3px 4px',
                      borderRadius: '3px',
                      fontSize: '9.5px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: recordEdoMappingMode === opt.val ? '#00e6ff' : 'transparent',
                      color: recordEdoMappingMode === opt.val ? '#12121a' : '#888',
                      transition: 'all 0.15s ease'
                    }}
                    title={
                      opt.val === 'off' ? 'Standard 12-TET keys without remapping' :
                        opt.val === 'linear' ? 'Each consecutive MIDI key plays 1 EDO step' :
                          'Keys snapped to nearest EDO degree'
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* QWERTY Typing Keyboard as MIDI Piano */}
          <div style={{ marginBottom: '10px', padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div>
                <span style={{ fontSize: '10px', color: '#69db7c', fontWeight: 700, letterSpacing: '0.4px', display: 'block' }}>QWERTY TYPING PIANO</span>
                <span style={{ fontSize: '9px', color: '#888' }}>Play notes with A-K keys (no MIDI hardware needed)</span>
              </div>
              <ToggleSwitch checked={qwertyPianoEnabled} onChange={setQwertyPianoEnabled} color="#69db7c" />
            </div>
            {qwertyPianoEnabled && (
              <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', color: '#aaa' }}>Keyboard Octave:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      onClick={() => setQwertyOctave(Math.max(1, qwertyOctave - 1))}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '2px 7px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer' }}
                      title="Shift Octave Down (Z)"
                    >
                      -1 (Z)
                    </button>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#69db7c', minWidth: '32px', textAlign: 'center' }}>
                      C{qwertyOctave}
                    </span>
                    <button
                      onClick={() => setQwertyOctave(Math.min(7, qwertyOctave + 1))}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '2px 7px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer' }}
                      title="Shift Octave Up (X)"
                    >
                      +1 (X)
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', color: '#aaa' }}>Key Velocity:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      onClick={() => setQwertyVelocity(Math.max(10, qwertyVelocity - 10))}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '2px 7px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer' }}
                      title="Decrease Velocity (C)"
                    >
                      -10 (C)
                    </button>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#69db7c', minWidth: '32px', textAlign: 'center' }}>
                      {qwertyVelocity}
                    </span>
                    <button
                      onClick={() => setQwertyVelocity(Math.min(127, qwertyVelocity + 10))}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '2px 7px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer' }}
                      title="Increase Velocity (V)"
                    >
                      +10 (V)
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '8.5px', color: '#777', background: 'rgba(0,0,0,0.25)', padding: '4px 6px', borderRadius: '4px', lineHeight: '1.4' }}>
                  White keys: <b>A S D F G H J K L</b><br />
                  Black keys: <b>W E T Y U O P</b> • Velocity: <b>C / V</b> ({qwertyVelocity})
                </div>
              </div>
            )}
          </div>

          {/* Connected MIDI Hardware Monitor */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: midiActivityPulse ? '#69db7c' : (activeMidiDeviceNames.length > 0 ? '#4dabf7' : '#555'),
                boxShadow: midiActivityPulse ? '0 0 8px #69db7c' : 'none',
                transition: 'all 0.1s ease'
              }} />
              <span style={{ fontSize: '10px', color: activeMidiDeviceNames.length > 0 ? '#ddd' : '#777' }}>
                {activeMidiDeviceNames.length > 0
                  ? activeMidiDeviceNames.join(', ')
                  : 'No MIDI controller detected'}
              </span>
            </div>
            {activeMidiDeviceNames.length > 0 && (
              <span style={{ fontSize: '9px', color: '#69db7c', fontWeight: 700 }}>LIVE</span>
            )}
          </div>
        </Section>

        <Section title="Grid" defaultOpen={false}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Time Signature</span>
            <StopPropSelect
              value={timeSignature}
              onChange={(e) => setTimeSignature(e.target.value)}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontWeight: 'bold', fontSize: '12px', outline: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}
            >
              <option value="4/4" style={{ background: '#1a1a24' }}>4/4</option>
              <option value="3/4" style={{ background: '#1a1a24' }}>3/4</option>
              <option value="2/4" style={{ background: '#1a1a24' }}>2/4</option>
              <option value="5/4" style={{ background: '#1a1a24' }}>5/4</option>
              <option value="6/4" style={{ background: '#1a1a24' }}>6/4</option>
              <option value="7/4" style={{ background: '#1a1a24' }}>7/4</option>
            </StopPropSelect>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Snap</span>
            <ToggleSwitch checked={snapEnabled} onChange={setSnapEnabled} color="#4dabf7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Drop Snap</span>
            <ToggleSwitch checked={dropSnap} onChange={setDropSnap} color="#4dabf7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Horizontal Scroll Lock</span>
            <ToggleSwitch checked={horizScrollLockEnabled} onChange={setHorizScrollLockEnabled} color="#4dabf7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Vert Scroll Lock</span>
            <ToggleSwitch checked={vertScrollLockEnabled} onChange={setVertScrollLockEnabled} color="#4dabf7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Read Only</span>
            <ToggleSwitch checked={readOnlyMode} onChange={setReadOnlyMode} color="#4dabf7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Scroll Both</span>
            <ToggleSwitch checked={scrollBoth} onChange={setScrollBoth} color="#4dabf7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Ghost Notes</span>
            <ToggleSwitch checked={ghostNotesEnabled} onChange={setGhostNotesEnabled} color="#4dabf7" />
          </div>
          {ghostNotesEnabled && (
            <div style={{ marginBottom: '10px' }}>
              <SliderRow
                label="Ghost Opacity"
                value={Math.round(ghostNoteOpacity * 100)}
                min={10}
                max={85}
                step={1}
                color="#4dabf7"
                suffix="%"
                onChange={v => setGhostNoteOpacity(v / 100)}
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div>
              <span style={{ fontSize: '12px', color: '#aaa', display: 'block' }}>Cross-Grid Ghosting</span>
              <span style={{ fontSize: '9px', color: '#666' }}>Preview drums on synth / synths on drums</span>
            </div>
            <ToggleSwitch checked={ghostCrossInstrument} onChange={setGhostCrossInstrument} color="#4dabf7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Enable Note Inspector</span>
            <ToggleSwitch checked={noteInspectorEnabled} onChange={setNoteInspectorEnabled} color="#4dabf7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Merge Adjacent Notes</span>
            <ToggleSwitch checked={deduplicateEnabled} onChange={setDeduplicateEnabled} color="#4dabf7" />
          </div>
          {deduplicateEnabled && (
            <div style={{ marginBottom: '14px' }}>
              <SliderRow
                label="Merge Tolerance"
                value={deduplicateProximityTolerance}
                min={0}
                max={96}
                step={0.1}
                color="#4dabf7"
                suffix="ticks"
                onChange={val => setDeduplicateProximityTolerance(val)}
              />
            </div>
          )}
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Quantize</span>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
              {SNAP_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setSnapResolution(o.value)} style={{ flex: 1, padding: '5px 2px', borderRadius: '4px', border: `1px solid ${snapResolution === o.value ? '#4dabf7' : 'rgba(255,255,255,0.06)'}`, background: snapResolution === o.value ? 'rgba(77,171,247,0.15)' : 'rgba(255,255,255,0.02)', color: snapResolution === o.value ? '#4dabf7' : '#555', cursor: 'pointer', fontSize: '10px', fontWeight: 800, transition: 'all 0.15s' }}>
                  {o.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: '8px' }}>
              <input
                type="number"
                step="any"
                value={snapResolution}
                onMouseDown={e => e.stopPropagation()}
                onMouseUp={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => setSnapResolution(Math.max(0.001, parseFloat(e.target.value) || 1))}
                style={{ width: '38px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(77,171,247,0.2)', borderRadius: '4px', color: '#4dabf7', fontSize: '10px', fontWeight: 900, padding: '3px 4px', outline: 'none', textAlign: 'center' }}
                title="Custom ticks for global grid quantization"
              />
            </div>
          </div>
          <div style={{ marginTop: '8px' }}>
            <button
              onClick={() => {
                useStore.getState().commitHistory()
                useStore.getState().quantizeSelectedNotes()
              }}
              style={{ width: '100%', padding: '6px', background: 'rgba(77,171,247,0.1)', border: '1px solid rgba(77,171,247,0.3)', borderRadius: '4px', color: '#4dabf7', fontSize: '11px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(77,171,247,0.2)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(77,171,247,0.1)'}
            >
              Quantize Selected Notes
            </button>
          </div>
          <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <SliderRow label="Block Time" value={gridBlockTicks} min={12} max={384} step={0.1} suffix="t" color="#00e6ff" onChange={setGridBlockTicks} />
            <SliderRow label="Shade Width" value={gridShadeEvery} min={1} max={16} step={1} suffix=" cols" color="#b197fc" onChange={setGridShadeEvery} />
            <SliderRow label="Timeline" value={gridColumnCount} min={32} max={1024} step={16} suffix=" cols" color="#ff9900" onChange={setGridColumnCount} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', marginTop: '4px' }}>
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Auto Extend</span>
              <ToggleSwitch checked={autoExtendGrid} onChange={setAutoExtendGrid} color="#ff9900" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Both Grid Active</span>
              <ToggleSwitch checked={useStore(s => s.bothGridActive)} onChange={useStore(s => s.setBothGridActive)} color="#ff9900" />
            </div>
            <SliderRow label="Min Note Size" value={minNoteSize} min={0} max={192} step={0.1} suffix="t" color="#fcc419" onChange={setMinNoteSize} />

            {activeTrack?.instrument !== 'drum' && (
              <>
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px', fontWeight: 800 }}>PIANO ROLL BOUNDS</div>
                  <SliderRow label="Lowest Octave" value={synthLowerOctave} min={-5} max={synthUpperOctave - 1} step={1} color="#4dabf7" onChange={setSynthLowerOctave} />
                  <SliderRow label="Highest Octave" value={synthUpperOctave} min={synthLowerOctave + 1} max={10} step={1} color="#4dabf7" onChange={setSynthUpperOctave} />
                  {(synthLowerOctave < -2 || synthUpperOctave > 8) && (
                    <div style={{ marginTop: '8px', padding: '6px', background: 'rgba(255,51,102,0.1)', border: '1px solid rgba(255,51,102,0.3)', borderRadius: '4px', fontSize: '9px', color: '#ff3366', fontWeight: 700, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <IconAlertTriangle size={11} style={{ color: '#ff3366', flexShrink: 0 }} /> WARNING: Frequencies outside octaves -2 to 8 may be completely inaudible or cause engine silence.
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTrack?.instrument === 'drum' && (
              <>
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px', fontWeight: 800 }}>DRUM GRID CHANNELS</div>

                  <div style={{ marginBottom: '10px' }}>
                    <SliderRow
                      label="Row Count"
                      value={pruneTargetCount !== null ? pruneTargetCount : (activeTrack.drumRows ?? DEFAULT_DRUM_ROWS).length}
                      min={1}
                      max={64}
                      step={1}
                      color="#ff9900"
                      onChange={v => handleRowRangeChange(Math.max(1, v))}
                    />
                  </div>

                  {pruneTargetCount !== null && (
                    <div style={{ background: 'rgba(255,80,80,0.07)', border: '1px solid rgba(255,80,80,0.2)', borderRadius: '6px', padding: '10px', marginBottom: '12px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 800, color: '#ff6b6b', marginBottom: '6px' }}>PRUNE CHANNELS</div>
                      <p style={{ fontSize: '9px', color: '#888', margin: '0 0 8px 0', lineHeight: 1.3 }}>
                        Reducing rows from {(activeTrack.drumRows ?? DEFAULT_DRUM_ROWS).length} to {pruneTargetCount}. Select channels to delete (will prune all their notes!):
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto', marginBottom: '8px' }} className="thin-scroll">
                        {(activeTrack.drumRows ?? DEFAULT_DRUM_ROWS).map(row => {
                          const isSelected = pruneSelectedPitches.has(row.pitch)
                          return (
                            <label key={row.pitch} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  const updated = new Set(pruneSelectedPitches)
                                  if (isSelected) updated.delete(row.pitch)
                                  else updated.add(row.pitch)
                                  setPruneSelectedPitches(updated)
                                }}
                                style={{ accentColor: '#ff6b6b' }}
                              />
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: row.color }} />
                              <span style={{ fontSize: '10px', color: isSelected ? '#ff6b6b' : '#aaa', fontWeight: isSelected ? 700 : 500 }}>
                                {row.name}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={handleConfirmPrune}
                          style={{ flex: 1, padding: '4px 0', background: '#ff5050', color: 'white', border: 'none', borderRadius: '4px', fontSize: '9px', fontWeight: 800, cursor: 'pointer' }}
                        >
                          Confirm Delete ({pruneSelectedPitches.size})
                        </button>
                        <button
                          onClick={() => setPruneTargetCount(null)}
                          style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.05)', color: '#aaa', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '9px', fontWeight: 800, cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <details style={{ marginTop: '8px' }}>
                    <summary style={{ fontSize: '9px', color: '#888', fontWeight: 700, cursor: 'pointer', outline: 'none', userSelect: 'none' }}>
                      ▶ RENAME CHANNELS ({(activeTrack.drumRows ?? DEFAULT_DRUM_ROWS).length})
                    </summary>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }} className="thin-scroll">
                      {[...(activeTrack.drumRows ?? DEFAULT_DRUM_ROWS)].sort((a, b) => b.pitch - a.pitch).map(row => (
                        <div key={row.pitch} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                          <input
                            type="number"
                            value={row.pitch}
                            min={0}
                            max={127}
                            title="MIDI Pitch Assignment (change to reorder or re-pitch)"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => e.stopPropagation()}
                            onChange={e => {
                              const newPitch = Math.max(0, Math.min(127, parseInt(e.target.value) || 0))
                              const oldPitch = row.pitch
                              if (newPitch === oldPitch) return

                              commitHistory()

                              // Update row pitch
                              const rows = activeTrack.drumRows ?? DEFAULT_DRUM_ROWS
                              const updatedRows = rows.map(r => r.pitch === oldPitch ? { ...r, pitch: newPitch } : r)
                              updateTrack(activeTrack.id, { drumRows: updatedRows })

                              // Update all notes on this track with the old pitch to the new pitch
                              const allNotes = useStore.getState().notes
                              const updatedNotes = allNotes.map(n =>
                                (n.trackId === activeTrack.id && n.pitch === oldPitch)
                                  ? { ...n, pitch: newPitch }
                                  : n
                              )
                              useStore.setState({ notes: updatedNotes })
                            }}
                            style={{ width: '42px', background: '#12121a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px', padding: '2px 4px', fontSize: '10px', color: '#4dabf7', textAlign: 'center', outline: 'none', fontFamily: 'monospace' }}
                          />
                          <input
                            type="text"
                            value={row.name}
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => e.stopPropagation()}
                            onChange={e => {
                              const rows = activeTrack.drumRows ?? DEFAULT_DRUM_ROWS
                              const updatedRows = rows.map(r => r.pitch === row.pitch ? { ...r, name: e.target.value } : r)
                              updateTrack(activeTrack.id, { drumRows: updatedRows })
                            }}
                            style={{ flex: 1, background: '#12121a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', color: 'white', outline: 'none' }}
                          />
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </>
            )}

            {/* WORKSTATION LAYOUT */}
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Workstation Layout</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#aaa' }}>Display Mode</span>
                  <div style={{ display: 'flex', gap: '3px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                    {(['split', 'synth-only', 'drum-only', 'active'] as const).map(mode => {
                      const isActive = gridPaneMode === mode
                      const label = mode === 'split' ? 'Split' : mode === 'synth-only' ? 'Synth' : mode === 'drum-only' ? 'Drums' : 'Active'
                      return (
                        <button
                          key={mode}
                          onClick={() => setGridPaneMode(mode)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            border: 'none',
                            background: isActive ? 'rgba(77,171,247,0.15)' : 'transparent',
                            color: isActive ? '#4dabf7' : '#666',
                            cursor: 'pointer',
                            fontSize: '10px',
                            fontWeight: 800,
                            transition: 'all 0.15s'
                          }}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {gridPaneMode === 'split' && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: '#aaa' }}>Split Order</span>
                    <div style={{ display: 'flex', gap: '3px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      {(['synth-first', 'drum-first'] as const).map(order => {
                        const isActive = gridSplitOrder === order
                        const label = order === 'synth-first' ? 'Synth Top' : 'Drum Top'
                        return (
                          <button
                            key={order}
                            onClick={() => setGridSplitOrder(order)}
                            style={{
                              padding: '3px 8px',
                              borderRadius: '4px',
                              border: 'none',
                              background: isActive ? 'rgba(255,153,0,0.15)' : 'transparent',
                              color: isActive ? '#ff9900' : '#666',
                              cursor: 'pointer',
                              fontSize: '10px',
                              fontWeight: 800,
                              transition: 'all 0.15s'
                            }}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* GRID VELOCITY PANES TOGGLES */}
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grid Velocity Lanes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#aaa' }}>Synth Velocity Lane</span>
                  <ToggleSwitch checked={showSynthVelocity} onChange={setShowSynthVelocity} color="#4dabf7" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#aaa' }}>Drum Velocity Lane</span>
                  <ToggleSwitch checked={showDrumVelocity} onChange={setShowDrumVelocity} color="#ff9900" />
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Free Pitch" defaultOpen={false}>
          <FreePitchSection />
        </Section>

        <Section title="Note Mixer" defaultOpen={false}>
          <NoteMixerSection activeTrackId={activeTrackId} />
        </Section>

        <Section title="Grid Rows" defaultOpen={false}>
          <GridRowReorderSection activeTrackId={activeTrackId} />
        </Section>

        <Section title="Groove Pool" defaultOpen={false}>
          <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px' }}>{editTargetLabel}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Active Groove Template</span>
              <StopPropSelect
                value={activeGrooveTemplateId || ''}
                onChange={e => setActiveGrooveTemplateId(e.target.value)}
                style={{ background: '#1e1e2e', color: '#69db7c', border: '1px solid rgba(105, 219, 124, 0.2)', borderRadius: '4px', padding: '4px 6px', fontSize: '11px', outline: 'none' }}
              >
                {grooveTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </StopPropSelect>
            </div>

            <SliderRow label="Timing Strength" value={grooveTimingStrength} min={0} max={100} suffix="%" color="#69db7c" onChange={setGrooveTimingStrength} />
            <SliderRow label="Velocity Strength" value={grooveVelocityStrength} min={0} max={100} suffix="%" color="#69db7c" onChange={setGrooveVelocityStrength} />
            <button
              onClick={() => {
                commitHistory()
                applyGroove(editTargets.map(t => t.id))
                useStore.getState().showToast('Groove applied!', 'success')
              }}
              style={{ ...buttonStyle('#69db7c'), width: '100%' }}
            >
              Apply Groove to Selection
            </button>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: '#ff9900', fontWeight: 600 }}>Extract Groove from MIDI</span>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '10px', color: '#aaa' }}>Target</span>
              <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <button
                  onClick={() => setGrooveExtractionTargetAll(false)}
                  style={{ flex: 1, padding: '2px 5px', borderRadius: '3px', border: 'none', background: !grooveExtractionTargetAll ? 'rgba(255,153,0,0.15)' : 'transparent', color: !grooveExtractionTargetAll ? '#ff9900' : '#666', cursor: 'pointer', fontSize: '9px', fontWeight: 800 }}
                >
                  Active Track
                </button>
                <button
                  onClick={() => setGrooveExtractionTargetAll(true)}
                  style={{ flex: 1, padding: '2px 5px', borderRadius: '3px', border: 'none', background: grooveExtractionTargetAll ? 'rgba(255,153,0,0.15)' : 'transparent', color: grooveExtractionTargetAll ? '#ff9900' : '#666', cursor: 'pointer', fontSize: '9px', fontWeight: 800 }}
                >
                  All Tracks
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', color: '#aaa' }}>Save As</span>
              <input
                value={extractGrooveName}
                onChange={(e) => setExtractGrooveName(e.target.value)}
                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,153,0,0.3)', color: '#ff9900', padding: '4px', borderRadius: '4px', fontSize: '11px', outline: 'none' }}
              />
            </div>

            <button
              onClick={() => {
                const targetIds = grooveExtractionTargetAll
                  ? notes.map(n => n.id)
                  : notes.filter(n => n.trackId === activeTrackId).map(n => n.id)

                if (targetIds.length === 0) {
                  useStore.getState().showToast('No notes to extract from!', 'error')
                  return
                }
                extractGroove(targetIds, extractGrooveName)
                useStore.getState().showToast(`Extracted "${extractGrooveName}"`, 'success')
              }}
              style={{ ...buttonStyle('#ff9900'), width: '100%' }}
            >
              Extract & Save Groove
            </button>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
            <SliderRow label="Quantize Str." value={quantizeStrength} min={1} max={100} suffix="%" onChange={setQuantizeStrength} />
            <button onClick={applyQuantize} style={{ ...buttonStyle('#4dabf7'), width: '100%', marginBottom: '10px' }}>Quantize Selection</button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: '#aaa' }}>Auto-Quantize Input</span>
              <ToggleSwitch checked={quantizeInputEnabled} onChange={setQuantizeInputEnabled} color="#69db7c" />
            </div>
          </div>
        </Section>

        <Section title="Vocal Velocity Engine" info={vocalVelocityEnabled ? "ON" : "OFF"} defaultOpen={false}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '11px', color: '#eee', fontWeight: 600 }}>Vocal Dynamics to Velocity</span>
            <ToggleSwitch checked={vocalVelocityEnabled} onChange={setVocalVelocityEnabled} color="#da77f2" />
          </div>

          {vocalVelocityEnabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <SliderRow
                label="Velocity Floor (Min)"
                value={vocalVelocityMin}
                min={1}
                max={vocalVelocityMax - 1}
                step={1}
                color="#da77f2"
                onChange={setVocalVelocityMin}
              />
              <SliderRow
                label="Velocity Ceiling (Max)"
                value={vocalVelocityMax}
                min={vocalVelocityMin + 1}
                max={127}
                step={1}
                color="#da77f2"
                onChange={setVocalVelocityMax}
              />
              <SliderRow
                label="Amplification Scale"
                value={vocalVelocityScale}
                min={50}
                max={2000}
                step={10}
                color="#da77f2"
                onChange={setVocalVelocityScale}
              />
              <div style={{ padding: '8px 10px', background: 'rgba(218,119,242,0.06)', border: '1px solid rgba(218,119,242,0.15)', borderRadius: '6px', fontSize: '10px', color: '#da77f2', lineHeight: 1.45, marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <IconMic size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>
                  Formula: <code>Velocity = Clamp(Loudness * Scale, min, max)</code>. Dynamically maps hum/sing levels to expressiveness.
                </span>
              </div>
            </div>
          )}
        </Section>

        <Section title="Suggestions" defaultOpen={false}>
          {renderGenerationSettings()}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            {(['chords', 'bassline', 'rhythm'] as SuggestionKind[]).map(kind => (
              <button key={kind} onClick={() => setSuggestionKind(kind)} style={buttonStyle(kind === 'rhythm' ? '#ff9900' : '#00e6ff', suggestionKind === kind)}>
                {kind === 'bassline' ? 'Bass' : kind[0].toUpperCase() + kind.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {suggestions.map(suggestion => (
              <div key={suggestion.id} style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)', borderRadius: '6px', padding: '7px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <IconChord size={13} style={{ color: suggestion.targetInstrument === 'drum' ? '#ff9900' : '#00e6ff' }} />
                  <span style={{ flex: 1, fontSize: '11px', fontWeight: 700, color: '#ddd' }}>{suggestion.title}</span>
                </div>
                <div style={{ fontSize: '10px', color: '#777', lineHeight: 1.35, marginBottom: '6px' }}>{suggestion.subtitle}</div>
                <button onClick={() => insertSuggestion(suggestion)} style={{ ...buttonStyle(suggestion.targetInstrument === 'drum' ? '#ff9900' : '#00e6ff'), width: '100%' }}>
                  Insert
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Audio Stem Splitter" defaultOpen={false}>
          <StemSplitterPane key={projectId} />
        </Section>

        <Section title="AI Lab" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isAiLoading ? '#da77f2' : '#555', boxShadow: isAiLoading ? '0 0 10px #da77f2' : 'none', transition: 'all 0.3s' }} />
                <span style={{ fontSize: '11px', fontWeight: 700, color: isAiLoading ? '#da77f2' : '#888' }}>
                  {isAiLoading ? 'Neural Brain Composing...' : 'AI Engine Ready'}
                </span>
              </div>

              <SliderRow
                label="Creativity"
                value={aiTemperature}
                min={0.1}
                max={2.0}
                step={0.1}
                color="#da77f2"
                onChange={v => setAiTemperature(v)}
              />
              <SliderRow
                label="Gen Length"
                value={aiLength}
                min={16}
                max={256}
                step={16}
                suffix=" steps"
                color="#be4bdb"
                onChange={v => setAiLength(v)}
              />
              <SliderRow
                label="Seed Memory"
                value={aiSeedBars}
                min={0}
                max={8}
                step={1}
                suffix=" bars"
                color="#9c36b5"
                onChange={v => setAiSeedBars(v)}
              />
              <SliderRow
                label="Density"
                value={aiDensity}
                min={0.1}
                max={1.0}
                step={0.05}
                color="#e599f7"
                onChange={v => setAiDensity(v)}
              />
              {activeTrack?.instrument === 'synth' && (
                <SliderRow
                  label="Octave Shift"
                  value={aiOctaveShift}
                  min={-2}
                  max={2}
                  step={1}
                  suffix=" oct"
                  color="#cc5de8"
                  onChange={v => setAiOctaveShift(v)}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: '#aaa' }}>Seed / Dummy Note</span>
                <StopPropSelect
                  value={aiSeedPitch}
                  onChange={e => setAiSeedPitch(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '11px', outline: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', width: '80px' }}
                >
                  <option value="auto">Auto</option>
                  {pitchOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </StopPropSelect>
              </div>

              <div style={{ fontSize: '9px', color: '#555', marginTop: '6px', fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '6px' }}>
                Will hallucinate <b>{Math.round(aiLength / 16)} bars</b> of new music by studying <b>{aiSeedBars} bars</b> of your work.
              </div>
            </div>

            <button
              onClick={handleAiGenerate}
              disabled={isAiLoading || !activeTrackId}
              style={{
                background: 'transparent',
                border: `1px solid ${isAiLoading ? 'rgba(255,255,255,0.05)' : '#da77f2'}`,
                borderRadius: '8px',
                padding: '8px',
                color: isAiLoading ? '#444' : '#da77f2',
                fontSize: '10px',
                fontWeight: 800,
                letterSpacing: '0.08em',
                cursor: isAiLoading ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={e => !isAiLoading && (e.currentTarget.style.background = 'rgba(218, 119, 242, 0.05)')}
              onMouseLeave={e => !isAiLoading && (e.currentTarget.style.background = 'transparent')}
            >
              {isAiLoading ? 'THINKING...' : (activeTrack?.instrument === 'synth' ? 'HALLUCINATE MELODY' : 'GENERATE NEURAL GROOVE')}
            </button>

            {activeTrack?.instrument === 'synth' && (
              <>
                {renderGenerationSettings()}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                  <button
                    onClick={() => handleGenerateAiHarmony('chord')}
                    disabled={isAiLoading || !activeTrackId}
                    style={{
                      background: 'rgba(255,51,102,0.1)',
                      border: '1px solid rgba(255,51,102,0.3)',
                      borderRadius: '4px',
                      padding: '6px',
                      color: '#ff3366',
                      fontSize: '9px',
                      fontWeight: 600,
                      cursor: isAiLoading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    GENERATE CHORDS
                  </button>
                  <button
                    onClick={() => handleGenerateAiHarmony('counterpoint')}
                    disabled={isAiLoading || !activeTrackId}
                    style={{
                      background: 'rgba(105, 219, 124, 0.1)',
                      border: '1px solid rgba(105, 219, 124, 0.3)',
                      borderRadius: '4px',
                      padding: '6px',
                      color: '#69db7c',
                      fontSize: '9px',
                      fontWeight: 600,
                      cursor: isAiLoading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    AUTO-HARMONIZE (BACH)
                  </button>
                  <button
                    onClick={() => handleGenerateAiHarmony('bass')}
                    disabled={isAiLoading || !activeTrackId}
                    style={{
                      background: 'rgba(51, 154, 240, 0.1)',
                      border: '1px solid rgba(51, 154, 240, 0.3)',
                      borderRadius: '4px',
                      padding: '6px',
                      color: '#339af0',
                      fontSize: '9px',
                      fontWeight: 600,
                      gridColumn: 'span 2',
                      cursor: isAiLoading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    GENERATE AI BASS
                  </button>
                </div>

                <div style={{ marginTop: '10px', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '10px', color: '#ccc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <IconWand size={12} color="#da77f2" /> Genie Composer (Step Mode)
                    </span>
                    <button onClick={handleResetGenie} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '9px', cursor: 'pointer' }}>Reset State</button>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'space-between' }}>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map(num => (
                      <button
                        key={num}
                        onClick={() => handleGenieNote(num)}
                        disabled={!activeTrackId}
                        style={{
                          flex: 1,
                          padding: '10px 0',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 800,
                          cursor: activeTrackId ? 'pointer' : 'not-allowed',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                          transition: 'all 0.1s'
                        }}
                        onMouseDown={e => {
                          e.currentTarget.style.transform = 'translateY(2px)'
                          e.currentTarget.style.boxShadow = 'none'
                        }}
                        onMouseUp={e => {
                          e.currentTarget.style.transform = 'none'
                          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)'
                        }}
                      >
                        {num + 1}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: '9px', color: '#666', marginTop: '6px', textAlign: 'center' }}>
                    Press 1-8 to compose. Playhead advances automatically.
                  </div>
                </div>
              </>
            )}

            {activeTrack?.instrument === 'drum' && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '10px', color: '#888', marginBottom: '6px', fontWeight: 600 }}>Drum DNA Manipulation</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

                  {/* Beat Morph */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '10px', color: '#ccc' }}>Morph Target Track</span>
                      <select
                        value={morphTargetTrackId}
                        onChange={e => setMorphTargetTrackId(e.target.value)}
                        style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid #333', color: '#fff', fontSize: '9px', padding: '4px', borderRadius: '4px', width: '120px' }}
                      >
                        <option value="">Select track...</option>
                        {tracks.filter(t => t.instrument === 'drum' && t.id !== activeTrackId).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>

                    <SliderRow
                      label="Morph Steps"
                      value={morphSteps}
                      min={3}
                      max={8}
                      step={1}
                      suffix=" patterns"
                      color="#20c997"
                      onChange={v => setMorphSteps(v)}
                    />

                    <button
                      onClick={handleBeatMorph}
                      disabled={isMorphing || !activeTrackId || !morphTargetTrackId}
                      style={{
                        background: 'rgba(32, 201, 151, 0.1)',
                        border: '1px solid rgba(32, 201, 151, 0.3)',
                        borderRadius: '4px',
                        padding: '6px',
                        color: '#20c997',
                        fontSize: '9px',
                        fontWeight: 600,
                        cursor: (isMorphing || !morphTargetTrackId) ? 'not-allowed' : 'pointer',
                        width: '100%',
                        marginTop: '8px'
                      }}
                    >
                      {isMorphing ? 'MORPHING DNA...' : 'GENERATE MORPH TRANSITION'}
                    </button>
                  </div>

                  {/* Humanize Groove */}
                  <button
                    onClick={handleHumanizeGroove}
                    disabled={isAiLoading || !activeTrackId}
                    style={{
                      background: 'rgba(255, 153, 0, 0.1)',
                      border: `1px solid ${isAiLoading ? 'rgba(255,255,255,0.05)' : '#ff9900'}`,
                      borderRadius: '6px',
                      padding: '8px',
                      color: isAiLoading ? '#444' : '#ff9900',
                      fontSize: '10px',
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      cursor: isAiLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => !isAiLoading && (e.currentTarget.style.background = 'rgba(255, 153, 0, 0.05)')}
                    onMouseLeave={e => !isAiLoading && (e.currentTarget.style.background = 'rgba(255, 153, 0, 0.1)')}
                  >
                    <IconDrum size={12} style={{ marginRight: '4px' }} /> HUMANIZE GROOVE (Micro-Timing)
                  </button>
                </div>
              </div>
            )}

            <div style={{ fontSize: '10px', color: '#555', textAlign: 'center', padding: '0 10px', fontStyle: 'italic' }}>
              AI analyzes the active track and generates a continuation or harmony.
            </div>
          </div>
        </Section>

        <Section title="Instrument Lab" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Header Switch Tabs */}
            <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.3)', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
              {(['synth', 'drum'] as const).map(tab => {
                const isActive = designerTab === tab
                const label = tab === 'synth' ? 'Synth Designer' : 'Drum Designer'
                return (
                  <button
                    key={tab}
                    onClick={() => setDesignerTab(tab)}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: '6px',
                      border: 'none',
                      background: isActive ? 'rgba(77,171,247,0.15)' : 'transparent',
                      color: isActive ? '#4dabf7' : '#888',
                      cursor: 'pointer',
                      fontSize: '10px',
                      fontWeight: 800,
                      transition: 'all 0.2s',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Instrument Name */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <label style={{ fontSize: '10px', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Instrument Name</label>
              <input
                type="text"
                value={designerName}
                onMouseDown={e => e.stopPropagation()}
                onMouseUp={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => setDesignerName(e.target.value)}
                style={{ width: '100%', background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '6px 8px', fontSize: '11px', color: 'white', outline: 'none' }}
              />
            </div>

            {/* Conditionally Render Synth Designer */}
            {designerTab === 'synth' && (
              <div className="fade-in-content" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '10px', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Synthesis Engine</label>
                  <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                    {(['Synth', 'FMSynth', 'MonoSynth'] as const).map(engine => {
                      const isActive = designerEngine === engine
                      const label = engine === 'Synth' ? 'Subtractive' : engine === 'FMSynth' ? 'FM Synth' : 'Mono Sweep'
                      return (
                        <button
                          key={engine}
                          onClick={() => setDesignerEngine(engine)}
                          style={{
                            flex: 1,
                            padding: '4px 6px',
                            borderRadius: '4px',
                            border: 'none',
                            background: isActive ? 'rgba(77,171,247,0.15)' : 'transparent',
                            color: isActive ? '#4dabf7' : '#666',
                            cursor: 'pointer',
                            fontSize: '10px',
                            fontWeight: 800,
                            transition: 'all 0.15s'
                          }}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Waveform Source</span>
                  <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.04)' }}>
                    {(['standard', 'fourier'] as const).map(mode => {
                      const isActive = designerWaveformMode === mode
                      const label = mode === 'standard' ? 'Standard Shapes' : 'Fourier Formula'
                      return (
                        <button
                          key={mode}
                          onClick={() => setDesignerWaveformMode(mode)}
                          style={{
                            flex: 1,
                            padding: '3px 5px',
                            borderRadius: '3px',
                            border: 'none',
                            background: isActive ? 'rgba(77,171,247,0.15)' : 'transparent',
                            color: isActive ? '#4dabf7' : '#666',
                            cursor: 'pointer',
                            fontSize: '10px',
                            fontWeight: 800,
                            transition: 'all 0.15s'
                          }}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {designerWaveformMode === 'standard' ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#aaa' }}>Waveform Shape</span>
                    <StopPropSelect
                      value={designerOscillator}
                      onChange={e => setDesignerOscillator(e.target.value as any)}
                      style={{ background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '3px 6px', fontSize: '11px', width: '90px' }}
                    >
                      <option value="sine">Sine</option>
                      <option value="square">Square</option>
                      <option value="sawtooth">Sawtooth</option>
                      <option value="triangle">Triangle</option>
                    </StopPropSelect>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(0,0,0,0.15)', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)', marginTop: '4px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: '#aaa' }}>Formula f(t)</span>
                        <span style={{ fontSize: '9px', color: '#666' }}>t from 0 to 2*PI</span>
                      </div>
                      <input
                        type="text"
                        value={designerFourierExpr}
                        onMouseDown={e => e.stopPropagation()}
                        onMouseUp={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                        onChange={e => setDesignerFourierExpr(e.target.value)}
                        placeholder="e.g. sin(t) + 0.5 * sin(3*t)"
                        style={{ background: '#12121a', color: '#4dabf7', border: '1px solid rgba(77,171,247,0.2)', borderRadius: '4px', padding: '4px 6px', fontSize: '11px', fontFamily: 'monospace' }}
                      />
                    </div>
                    <SliderRow
                      label="Harmonics Count"
                      value={designerFourierCount}
                      min={1}
                      max={64}
                      step={1}
                      color="#4dabf7"
                      onChange={setDesignerFourierCount}
                    />
                  </div>
                )}

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px', marginTop: '6px' }}>
                  <div style={{ fontSize: '9px', color: '#555', fontWeight: 800, marginBottom: '6px', textTransform: 'uppercase' }}>Volume Envelope (ADSR)</div>
                  <SliderRow label="Attack" value={designerAttack} min={0.001} max={2.0} step={0.01} color="#4dabf7" suffix="s" onChange={setDesignerAttack} />
                  <SliderRow label="Decay" value={designerDecay} min={0.01} max={2.0} step={0.01} color="#4dabf7" suffix="s" onChange={setDesignerDecay} />
                  <SliderRow label="Sustain" value={designerSustain} min={0} max={1.0} step={0.01} color="#4dabf7" onChange={setDesignerSustain} />
                  <SliderRow label="Release" value={designerRelease} min={0.01} max={5.0} step={0.01} color="#4dabf7" suffix="s" onChange={setDesignerRelease} />
                </div>

                {designerEngine === 'FMSynth' && (
                  <div className="fade-in-content" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px', marginTop: '6px' }}>
                    <div style={{ fontSize: '9px', color: '#ff9900', fontWeight: 800, marginBottom: '6px', textTransform: 'uppercase' }}>FM Modulator settings</div>
                    <SliderRow label="Harmonicity" value={designerHarmonicity} min={0.1} max={10.0} step={0.1} color="#ff9900" onChange={setDesignerHarmonicity} />
                    <SliderRow label="Mod Index" value={designerModulationIndex} min={0.1} max={50.0} step={0.1} color="#ff9900" onChange={setDesignerModulationIndex} />

                    <div style={{ fontSize: '9px', color: '#ffbb00', fontWeight: 800, margin: '8px 0 6px 0', textTransform: 'uppercase' }}>Modulation Envelope</div>
                    <SliderRow label="Mod Attack" value={designerModAttack} min={0.001} max={2.0} step={0.01} color="#ffbb00" suffix="s" onChange={setDesignerModAttack} />
                    <SliderRow label="Mod Decay" value={designerModDecay} min={0.01} max={2.0} step={0.01} color="#ffbb00" suffix="s" onChange={setDesignerModDecay} />
                    <SliderRow label="Mod Sustain" value={designerModSustain} min={0} max={1.0} step={0.01} color="#ffbb00" onChange={setDesignerModSustain} />
                    <SliderRow label="Mod Release" value={designerModRelease} min={0.01} max={5.0} step={0.01} color="#ffbb00" suffix="s" onChange={setDesignerModRelease} />
                  </div>
                )}

                {designerEngine === 'MonoSynth' && (
                  <div className="fade-in-content" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px', marginTop: '6px' }}>
                    <div style={{ fontSize: '9px', color: '#ff3366', fontWeight: 800, marginBottom: '6px', textTransform: 'uppercase' }}>Resonant Filter settings</div>
                    <SliderRow label="Filter Cut" value={designerFilterFreq} min={20} max={15000} step={10} color="#ff3366" suffix="Hz" onChange={setDesignerFilterFreq} />
                    <SliderRow label="Filter Q" value={designerFilterQ} min={0.1} max={20} step={0.1} color="#ff3366" onChange={setDesignerFilterQ} />

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0' }}>
                      <span style={{ fontSize: '11px', color: '#aaa' }}>Filter Type</span>
                      <StopPropSelect
                        value={designerFilterType}
                        onChange={e => setDesignerFilterType(e.target.value as any)}
                        style={{ background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px 4px', fontSize: '11px', width: '90px' }}
                      >
                        <option value="lowpass">Lowpass</option>
                        <option value="highpass">Highpass</option>
                        <option value="bandpass">Bandpass</option>
                      </StopPropSelect>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0' }}>
                      <span style={{ fontSize: '11px', color: '#aaa' }}>Filter Rolloff</span>
                      <StopPropSelect
                        value={designerFilterRolloff}
                        onChange={e => setDesignerFilterRolloff(parseInt(e.target.value) as any)}
                        style={{ background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px 4px', fontSize: '11px', width: '90px' }}
                      >
                        <option value="-12">-12 dB/oct</option>
                        <option value="-24">-24 dB/oct</option>
                        <option value="-48">-48 dB/oct</option>
                      </StopPropSelect>
                    </div>

                    <div style={{ fontSize: '9px', color: '#ff3366', fontWeight: 800, margin: '8px 0 6px 0', textTransform: 'uppercase' }}>Filter Sweep Envelope</div>
                    <SliderRow label="Base Freq" value={designerFilterEnvBaseFrequency} min={20} max={1000} step={5} color="#ff5c8a" suffix="Hz" onChange={setDesignerFilterEnvBaseFrequency} />
                    <SliderRow label="Octaves" value={designerFilterEnvOctaves} min={1} max={8} step={1} color="#ff5c8a" onChange={setDesignerFilterEnvOctaves} />
                    <SliderRow label="F-Attack" value={designerFilterEnvAttack} min={0.001} max={2.0} step={0.01} color="#ff5c8a" suffix="s" onChange={setDesignerFilterEnvAttack} />
                    <SliderRow label="F-Decay" value={designerFilterEnvDecay} min={0.01} max={2.0} step={0.01} color="#ff5c8a" suffix="s" onChange={setDesignerFilterEnvDecay} />
                    <SliderRow label="F-Sustain" value={designerFilterEnvSustain} min={0} max={1.0} step={0.01} color="#ff5c8a" onChange={setDesignerFilterEnvSustain} />
                    <SliderRow label="F-Release" value={designerFilterEnvRelease} min={0.01} max={5.0} step={0.01} color="#ff5c8a" suffix="s" onChange={setDesignerFilterEnvRelease} />
                  </div>
                )}
              </div>
            )}

            {/* Conditionally Render Drum Designer */}
            {designerTab === 'drum' && (
              <div className="fade-in-content" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Baseline Kit Preset</span>
                  <StopPropSelect
                    defaultValue=""
                    onChange={e => {
                      const kitVal = e.target.value
                      if (kitVal) {
                        setDesignerDrumKitConfig(getBaselineDrumKitParams(kitVal as any))
                        useStore.getState().showToast(`Loaded "${kitVal}" kit as baseline!`, 'info')
                      }
                    }}
                    style={{ background: '#1e1e2e', color: '#4dabf7', border: '1px solid rgba(77,171,247,0.2)', borderRadius: '4px', padding: '2px 4px', fontSize: '11px', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="" disabled>Select Baseline...</option>
                    <option value="default">Default Baseline</option>
                    <option value="tight">Tight Baseline</option>
                    <option value="electro">Electro Baseline</option>
                    <option value="eightOhEight">808 Baseline</option>
                    <option value="tabla">Tabla Baseline</option>
                  </StopPropSelect>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Drum Piece / Channel</span>
                  <StopPropSelect
                    value={designerDrumPiece}
                    onChange={e => setDesignerDrumPiece(e.target.value)}
                    style={{
                      background: '#1e1e2e',
                      color: '#4dabf7',
                      border: '1px solid rgba(77,171,247,0.2)',
                      borderRadius: '4px',
                      padding: '2px 4px',
                      fontSize: '11px',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {(activeTrack?.drumRows ?? DEFAULT_DRUM_ROWS).map(row => (
                      <option key={row.pitch} value={row.pitch.toString()}>
                        {row.name} (P{row.pitch})
                      </option>
                    ))}
                  </StopPropSelect>
                </div>

                {/* Recover Deleted Sounds Panel */}
                {(() => {
                  const activePitches = new Set((activeTrack?.drumRows ?? DEFAULT_DRUM_ROWS).map(r => r.pitch))
                  const deletedStandardRows = DEFAULT_DRUM_ROWS.filter(r => !activePitches.has(r.pitch))
                  if (deletedStandardRows.length === 0) return null
                  return (
                    <details style={{ marginTop: '2px', background: 'rgba(77,171,247,0.05)', border: '1px solid rgba(77,171,247,0.15)', borderRadius: '6px', padding: '6px 8px' }}>
                      <summary style={{ fontSize: '10px', color: '#4dabf7', fontWeight: 700, cursor: 'pointer', outline: 'none', userSelect: 'none' }}>
                        ▶ RECOVER DELETED CHANNELS ({deletedStandardRows.length})
                      </summary>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                        {deletedStandardRows.map(row => (
                          <button
                            key={row.pitch}
                            onClick={() => {
                              if (!activeTrack) return
                              const currentRows = activeTrack.drumRows ?? DEFAULT_DRUM_ROWS
                              const restoredRows = [...currentRows, row].sort((a, b) => b.pitch - a.pitch)
                              updateTrack(activeTrack.id, { drumRows: restoredRows })
                              useStore.getState().showToast(`Recovered "${row.name}" channel!`, 'success')
                            }}
                            style={{
                              padding: '3px 6px',
                              background: 'rgba(77,171,247,0.1)',
                              border: '1px solid rgba(77,171,247,0.3)',
                              borderRadius: '4px',
                              color: '#4dabf7',
                              fontSize: '9px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            title={`Click to recover standard ${row.name}`}
                          >
                            + {row.name}
                          </button>
                        ))}
                      </div>
                    </details>
                  )
                })()}

                {/* Contextual Synthesis Controls */}
                {(() => {
                  const rows = activeTrack?.drumRows ?? DEFAULT_DRUM_ROWS
                  const activeRow = rows.find(r => r.pitch.toString() === designerDrumPiece) ?? rows[rows.length - 1]
                  const pitchNum = activeRow ? activeRow.pitch : 0
                  const pieceKey = pitchNum <= 15 ? (PITCH_TO_PIECE[pitchNum] || 'kick') : designerDrumPiece

                  const isMembrane = ['kick', 'tomLow', 'tomMid', 'tomHigh', 'congaLow', 'congaHigh', 'claves'].includes(pieceKey) || (pitchNum >= 16 && (designerDrumKitConfig[pieceKey]?.noise === undefined && designerDrumKitConfig[pieceKey]?.harmonicity === undefined))
                  const isNoise = ['snare', 'clap', 'tambourine', 'rimshot'].includes(pieceKey) || (pitchNum >= 16 && designerDrumKitConfig[pieceKey]?.noise !== undefined)
                  const isMetal = ['hihatClosed', 'hihatOpen', 'crash', 'ride', 'cowbell'].includes(pieceKey) || (pitchNum >= 16 && designerDrumKitConfig[pieceKey]?.harmonicity !== undefined)

                  const voiceType = isMembrane ? 'membrane' : isNoise ? 'noise' : 'metal'

                  return (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                        <span style={{ fontSize: '9px', color: '#ff9900', fontWeight: 800, textTransform: 'uppercase' }}>
                          Piece: {activeRow?.name ?? designerDrumPiece} ({voiceType.toUpperCase()})
                        </span>
                      </div>

                      {/* Custom pieces allow changing the voice type dynamically */}
                      {pitchNum >= 16 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '10px', color: '#888', fontWeight: 700 }}>Voice Synthesizer Mode</span>
                          <div style={{ display: 'flex', gap: '3px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.04)' }}>
                            {(['membrane', 'noise', 'metal'] as const).map(type => {
                              const isActive = voiceType === type
                              return (
                                <button
                                  key={type}
                                  onClick={() => setPieceVoiceType(pieceKey, type)}
                                  style={{
                                    flex: 1,
                                    padding: '3px 5px',
                                    borderRadius: '3px',
                                    border: 'none',
                                    background: isActive ? 'rgba(77,171,247,0.15)' : 'transparent',
                                    color: isActive ? '#4dabf7' : '#666',
                                    cursor: 'pointer',
                                    fontSize: '10px',
                                    fontWeight: 800,
                                    textTransform: 'capitalize'
                                  }}
                                >
                                  {type}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Membrane Controls */}
                      {isMembrane && (
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px', marginBottom: '8px' }}>
                            <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Waveform Source</span>
                            <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.04)' }}>
                              {(['standard', 'fourier'] as const).map(mode => {
                                const isFourier = designerDrumKitConfig[pieceKey]?.oscillator?.type === 'custom'
                                const isActive = (mode === 'fourier' && isFourier) || (mode === 'standard' && !isFourier)
                                const label = mode === 'standard' ? 'Standard Shapes' : 'Fourier Formula (Math)'
                                return (
                                  <button
                                    key={mode}
                                    onClick={() => {
                                      if (mode === 'fourier') {
                                        const currentExpr = designerDrumKitConfig[pieceKey]?.oscillator?.expr || 'sin(t) + 0.5 * sin(2*t)'
                                        const currentCount = designerDrumKitConfig[pieceKey]?.oscillator?.partialsCount || 16
                                        updatePieceParam(pieceKey, ['oscillator'], {
                                          type: 'custom',
                                          partials: calculateFourierPartials(currentExpr, currentCount),
                                          expr: currentExpr,
                                          partialsCount: currentCount
                                        })
                                      } else {
                                        updatePieceParam(pieceKey, ['oscillator'], {
                                          type: 'sine'
                                        })
                                      }
                                    }}
                                    style={{
                                      flex: 1,
                                      padding: '3px 5px',
                                      borderRadius: '3px',
                                      border: 'none',
                                      background: isActive ? 'rgba(77,171,247,0.15)' : 'transparent',
                                      color: isActive ? '#4dabf7' : '#666',
                                      cursor: 'pointer',
                                      fontSize: '10px',
                                      fontWeight: 800,
                                      transition: 'all 0.15s'
                                    }}
                                  >
                                    {label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {designerDrumKitConfig[pieceKey]?.oscillator?.type !== 'custom' ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <span style={{ fontSize: '11px', color: '#aaa' }}>Waveform Shape</span>
                              <StopPropSelect
                                value={designerDrumKitConfig[pieceKey]?.oscillator?.type || 'sine'}
                                onChange={e => updatePieceParam(pieceKey, ['oscillator', 'type'], e.target.value)}
                                style={{ background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', width: '90px' }}
                              >
                                <option value="sine">Sine</option>
                                <option value="square">Square</option>
                                <option value="sawtooth">Sawtooth</option>
                                <option value="triangle">Triangle</option>
                              </StopPropSelect>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(0,0,0,0.15)', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '10px', color: '#aaa' }}>Formula f(t)</span>
                                  <span style={{ fontSize: '9px', color: '#666' }}>t from 0 to 2*PI</span>
                                </div>
                                <input
                                  type="text"
                                  value={designerDrumKitConfig[pieceKey]?.oscillator?.expr || 'sin(t) + 0.5 * sin(2*t)'}
                                  onMouseDown={e => e.stopPropagation()}
                                  onMouseUp={e => e.stopPropagation()}
                                  onClick={e => e.stopPropagation()}
                                  onKeyDown={e => e.stopPropagation()}
                                  onChange={e => {
                                    const expr = e.target.value
                                    const count = designerDrumKitConfig[pieceKey]?.oscillator?.partialsCount || 16
                                    updatePieceParam(pieceKey, ['oscillator'], {
                                      type: 'custom',
                                      partials: calculateFourierPartials(expr, count),
                                      expr: expr,
                                      partialsCount: count
                                    })
                                  }}
                                  placeholder="e.g. sin(t) + 0.5 * sin(2*t)"
                                  style={{ background: '#12121a', color: '#4dabf7', border: '1px solid rgba(77,171,247,0.2)', borderRadius: '4px', padding: '4px 6px', fontSize: '11px', fontFamily: 'monospace' }}
                                />
                              </div>
                              <SliderRow
                                label="Harmonics Count"
                                value={designerDrumKitConfig[pieceKey]?.oscillator?.partialsCount || 16}
                                min={1}
                                max={64}
                                step={1}
                                color="#4dabf7"
                                onChange={v => {
                                  const expr = designerDrumKitConfig[pieceKey]?.oscillator?.expr || 'sin(t) + 0.5 * sin(2*t)'
                                  updatePieceParam(pieceKey, ['oscillator'], {
                                    type: 'custom',
                                    partials: calculateFourierPartials(expr, v),
                                    expr: expr,
                                    partialsCount: v
                                  })
                                }}
                              />
                            </div>
                          )}

                          <SliderRow
                            label="Sweep Octaves"
                            value={designerDrumKitConfig[pieceKey]?.octaves || 3}
                            min={0.5} max={8.0} step={0.5} color="#4dabf7"
                            onChange={v => updatePieceParam(pieceKey, ['octaves'], v)}
                          />
                          <SliderRow
                            label="Pitch Decay"
                            value={designerDrumKitConfig[pieceKey]?.pitchDecay || 0.05}
                            min={0.001} max={0.5} step={0.005} color="#4dabf7" suffix="s"
                            onChange={v => updatePieceParam(pieceKey, ['pitchDecay'], v)}
                          />
                        </>
                      )}

                      {/* Noise Controls */}
                      {isNoise && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <span style={{ fontSize: '11px', color: '#aaa' }}>Noise Source</span>
                          <StopPropSelect
                            value={designerDrumKitConfig[pieceKey]?.noise?.type || 'white'}
                            onChange={e => updatePieceParam(pieceKey, ['noise', 'type'], e.target.value)}
                            style={{ background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', width: '90px' }}
                          >
                            <option value="white">White Noise</option>
                            <option value="pink">Pink Noise</option>
                            <option value="brown">Brown Noise</option>
                          </StopPropSelect>
                        </div>
                      )}

                      {/* Metal Controls */}
                      {isMetal && (
                        <>
                          <SliderRow
                            label="Harmonicity"
                            value={designerDrumKitConfig[pieceKey]?.harmonicity || 5.1}
                            min={0.1} max={15.0} step={0.1} color="#ff9900"
                            onChange={v => updatePieceParam(pieceKey, ['harmonicity'], v)}
                          />
                          <SliderRow
                            label="Mod Index"
                            value={designerDrumKitConfig[pieceKey]?.modulationIndex || 32}
                            min={0.1} max={100.0} step={1.0} color="#ff9900"
                            onChange={v => updatePieceParam(pieceKey, ['modulationIndex'], v)}
                          />
                          <SliderRow
                            label="Resonance"
                            value={designerDrumKitConfig[pieceKey]?.resonance || 4000}
                            min={100} max={12000} step={100} color="#ff3366" suffix="Hz"
                            onChange={v => updatePieceParam(pieceKey, ['resonance'], v)}
                          />
                        </>
                      )}

                      {/* Envelopes (Common to all pieces) */}
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '6px', marginTop: '4px' }}>
                        <div style={{ fontSize: '9px', color: '#888', fontWeight: 800, marginBottom: '6px', textTransform: 'uppercase' }}>Envelope (ADSR)</div>
                        <SliderRow
                          label="Attack"
                          value={designerDrumKitConfig[pieceKey]?.envelope?.attack ?? 0.001}
                          min={0.001} max={1.0} step={0.005} color="#69db7c" suffix="s"
                          onChange={v => updatePieceParam(pieceKey, ['envelope', 'attack'], v)}
                        />
                        <SliderRow
                          label="Decay"
                          value={designerDrumKitConfig[pieceKey]?.envelope?.decay ?? 0.2}
                          min={0.01} max={4.0} step={0.01} color="#69db7c" suffix="s"
                          onChange={v => updatePieceParam(pieceKey, ['envelope', 'decay'], v)}
                        />
                        <SliderRow
                          label="Sustain"
                          value={designerDrumKitConfig[pieceKey]?.envelope?.sustain ?? 0}
                          min={0} max={1.0} step={0.01} color="#69db7c"
                          onChange={v => updatePieceParam(pieceKey, ['envelope', 'sustain'], v)}
                        />
                        <SliderRow
                          label="Release"
                          value={designerDrumKitConfig[pieceKey]?.envelope?.release ?? 0.1}
                          min={0.01} max={5.0} step={0.01} color="#69db7c" suffix="s"
                          onChange={v => updatePieceParam(pieceKey, ['envelope', 'release'], v)}
                        />
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Standard Preview and Route Controls */}
            <div style={{ display: 'grid', gridTemplateColumns: designerTab === 'drum' ? '1fr 1fr 1fr' : '1fr 1fr', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px', marginTop: '10px' }}>
              <button
                onClick={handlePreview}
                style={{ ...buttonStyle('#4dabf7'), padding: '6px', fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              >
                <IconSpeaker size={12} /> Preview
              </button>

              {designerTab === 'drum' && (
                <button
                  onClick={handlePreviewSequence}
                  style={{ ...buttonStyle('#ff9900'), padding: '6px', fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                >
                  <IconTimeline size={12} /> Sequence
                </button>
              )}

              <button
                onClick={() => setDesignerShowTrackSelector(prev => !prev)}
                style={{ ...buttonStyle('#69db7c'), padding: '6px', fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              >
                <IconTarget size={12} /> Use On Track
              </button>
            </div>

            {designerShowTrackSelector && (
              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '8px', background: 'rgba(0,0,0,0.2)', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span style={{ fontSize: '10px', color: '#888', fontWeight: 800 }}>LOAD INSTRUMENT ONTO:</span>
                  <button onClick={() => setDesignerShowTrackSelector(false)} style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', fontSize: '12px', fontWeight: 900 }}>&times;</button>
                </div>
                {tracks.filter(t => designerTab === 'synth' ? (t.instrument === 'synth' && t.synthPreset !== 'physical') : t.instrument === 'drum').length === 0 ? (
                  <div style={{ fontSize: '10px', color: '#666', fontStyle: 'italic', textAlign: 'center', padding: '4px' }}>
                    No {designerTab === 'synth' ? 'Synthesizer' : 'Drum Machine'} tracks found.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {tracks.filter(t => designerTab === 'synth' ? (t.instrument === 'synth' && t.synthPreset !== 'physical') : t.instrument === 'drum').map(t => (
                      <button
                        key={t.id}
                        onClick={() => handleUseInstrumentOnTrack(t.id)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(255,255,255,0.04)',
                          background: 'rgba(255,255,255,0.02)',
                          color: 'white',
                          fontSize: '10px',
                          fontWeight: 700,
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      >
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.color || '#4dabf7' }}></span>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleExportPatch}
              style={{ ...buttonStyle('#da77f2'), width: '100%', padding: '6px', fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
            >
              <IconDownload size={12} /> EXPORT INSTRUMENT (.MUZINS)
            </button>
          </div>
        </Section>

        <Section title="Physical Modeling" defaultOpen={false}>
          {!activeTrack || activeTrack.instrument !== 'synth' ? (
            <div style={{ padding: '8px', textAlign: 'center', fontSize: '11px', color: '#888', fontStyle: 'italic' }}>
              Select a Synthesizer track in the tracks list to enable physical modeling.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Enable / Disable State Button */}
              {activeTrack.synthPreset !== 'physical' ? (
                <button
                  onClick={() => {
                    commitHistory()
                    updateTrack(activeTrack.id, {
                      synthPreset: 'physical',
                      pmModelType: 'string',
                      pmStringStiffness: 0.5,
                      pmStringDecay: 0.7,
                      pmPluckHardness: 0.6,
                      pmBridgeTransmission: 0.3,
                      pmWindJetDelay: 0.5,
                      pmWindBlowPressure: 0.6,
                      pmWindDamping: 0.4,
                      pmPercResonance: 0.5,
                      pmPercStrikerSpeed: 0.6,
                      pmPercClarity: 0.5
                    })
                    audioEngine.createInstrument(activeTrack.id, 'synth')
                  }}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px dashed #4dabf7',
                    background: 'rgba(77,171,247,0.06)',
                    color: '#4dabf7',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(77,171,247,0.12)'
                    e.currentTarget.style.borderColor = '#00e6ff'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(77,171,247,0.06)'
                    e.currentTarget.style.borderColor = '#4dabf7'
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  ENABLE PHYSICAL MODEL ENGINE
                </button>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: '#69db7c', fontWeight: 800 }}>PHYSICS ENGINE: ACTIVE</span>
                    <button
                      onClick={() => {
                        commitHistory()
                        updateTrack(activeTrack.id, { synthPreset: 'warm' })
                        audioEngine.createInstrument(activeTrack.id, 'synth')
                      }}
                      style={{
                        padding: '2px 6px',
                        fontSize: '9px',
                        color: '#ff3366',
                        background: 'rgba(255,51,102,0.1)',
                        border: '1px solid rgba(255,51,102,0.2)',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Bypass
                    </button>
                  </div>

                  {/* Model Selector Tabs */}
                  <div style={{ display: 'flex', gap: '3px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                    {(['string', 'wind', 'percussion', 'custom'] as const).map(model => {
                      const isActive = (activeTrack.pmModelType || 'string') === model
                      return (
                        <button
                          key={model}
                          onClick={() => {
                            commitHistory()
                            updateTrack(activeTrack.id, { pmModelType: model })
                            audioEngine.createInstrument(activeTrack.id, 'synth')
                          }}
                          style={{
                            flex: 1,
                            padding: '4px 6px',
                            borderRadius: '4px',
                            border: 'none',
                            background: isActive ? 'rgba(77,171,247,0.15)' : 'transparent',
                            color: isActive ? '#4dabf7' : '#777',
                            cursor: 'pointer',
                            fontSize: '9px',
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            transition: 'all 0.15s'
                          }}
                        >
                          {model === 'string' && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M3 6c6-3 12 3 18 0" stroke={isActive ? '#4dabf7' : '#777'} />
                              <path d="M3 12c5 3 10-3 18 0" stroke={isActive ? '#4dabf7' : '#777'} opacity="0.7" />
                              <path d="M3 18c6-3 12 3 18 0" stroke={isActive ? '#4dabf7' : '#777'} opacity="0.4" />
                            </svg>
                          )}
                          {model === 'wind' && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M2 8h15a3 3 0 1 0-3-3" />
                              <path d="M2 12h19a3 3 0 0 1-3 3" />
                              <path d="M2 16h10a3 3 0 1 0-3-3" />
                            </svg>
                          )}
                          {model === 'percussion' && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="14" width="18" height="6" rx="1" />
                              <circle cx="9" cy="6" r="3" fill="currentColor" />
                              <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                          )}
                          {model === 'string' ? 'String' : model === 'wind' ? 'Blow' : model === 'percussion' ? 'Perc' : 'Custom'}
                        </button>
                      )
                    })}
                  </div>

                  {/* Parameters list based on model */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' }}>
                    {(activeTrack.pmModelType || 'string') === 'string' && (
                      <>
                        <SliderRow
                          label="Stiffness (Wood)"
                          value={activeTrack.pmStringStiffness !== undefined ? activeTrack.pmStringStiffness : 0.5}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#4dabf7"
                          onChange={v => updateTrack(activeTrack.id, { pmStringStiffness: v })}
                        />
                        <SliderRow
                          label="Decay / Sustain"
                          value={activeTrack.pmStringDecay !== undefined ? activeTrack.pmStringDecay : 0.7}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#da77f2"
                          onChange={v => updateTrack(activeTrack.id, { pmStringDecay: v })}
                        />
                        <SliderRow
                          label="Pluck Hardness"
                          value={activeTrack.pmPluckHardness !== undefined ? activeTrack.pmPluckHardness : 0.6}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#ffd43b"
                          onChange={v => updateTrack(activeTrack.id, { pmPluckHardness: v })}
                        />
                        <SliderRow
                          label="Cabinet Resonance"
                          value={activeTrack.pmBridgeTransmission !== undefined ? activeTrack.pmBridgeTransmission : 0.3}
                          min={0}
                          max={1}
                          step={0.01}
                          color="#ff9900"
                          onChange={v => updateTrack(activeTrack.id, { pmBridgeTransmission: v })}
                        />
                      </>
                    )}

                    {(activeTrack.pmModelType || 'string') === 'wind' && (
                      <>
                        <SliderRow
                          label="Jet Delay Time"
                          value={activeTrack.pmWindJetDelay !== undefined ? activeTrack.pmWindJetDelay : 0.5}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#00e6ff"
                          onChange={v => updateTrack(activeTrack.id, { pmWindJetDelay: v })}
                        />
                        <SliderRow
                          label="Blow Pressure"
                          value={activeTrack.pmWindBlowPressure !== undefined ? activeTrack.pmWindBlowPressure : 0.6}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#69db7c"
                          onChange={v => updateTrack(activeTrack.id, { pmWindBlowPressure: v })}
                        />
                        <SliderRow
                          label="Tube Damping"
                          value={activeTrack.pmWindDamping !== undefined ? activeTrack.pmWindDamping : 0.4}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#ff6b6b"
                          onChange={v => updateTrack(activeTrack.id, { pmWindDamping: v })}
                        />
                      </>
                    )}

                    {(activeTrack.pmModelType || 'string') === 'percussion' && (
                      <>
                        <SliderRow
                          label="Striker Speed"
                          value={activeTrack.pmPercStrikerSpeed !== undefined ? activeTrack.pmPercStrikerSpeed : 0.6}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#ffd43b"
                          onChange={v => updateTrack(activeTrack.id, { pmPercStrikerSpeed: v })}
                        />
                        <SliderRow
                          label="Bar Resonance"
                          value={activeTrack.pmPercResonance !== undefined ? activeTrack.pmPercResonance : 0.5}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#da77f2"
                          onChange={v => updateTrack(activeTrack.id, { pmPercResonance: v })}
                        />
                        <SliderRow
                          label="High Clarity"
                          value={activeTrack.pmPercClarity !== undefined ? activeTrack.pmPercClarity : 0.5}
                          min={0.01}
                          max={1}
                          step={0.01}
                          color="#00e6ff"
                          onChange={v => updateTrack(activeTrack.id, { pmPercClarity: v })}
                        />
                      </>
                    )}

                    {(activeTrack.pmModelType || 'string') === 'custom' && (
                      <div style={{ marginTop: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Custom Exciter Math Formula (JS)</span>
                        <MathInput
                          value={activeTrack.pmExciterFormula || ''}
                          onChange={v => updateTrack(activeTrack.id, { pmExciterFormula: v })}
                          placeholder="e.g. Math.exp(-t * 5) * Math.random()"
                          multiline
                          className="modulator-input-multiline"
                        />
                      </div>
                    )}
                  </div>

                  {/* Buttons Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <button
                      onClick={() => {
                        audioEngine.triggerLiveNote(activeTrack.id, 60, 100)
                      }}
                      style={{
                        padding: '6px',
                        borderRadius: '5px',
                        border: '1px solid rgba(255,255,255,0.06)',
                        background: 'rgba(255,255,255,0.04)',
                        color: 'white',
                        fontSize: '10px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                      Preview C
                    </button>

                    <button
                      onClick={() => setPmShowTrackSelector(prev => !prev)}
                      style={{
                        padding: '6px',
                        borderRadius: '5px',
                        border: '1px solid rgba(105,219,124,0.3)',
                        background: pmShowTrackSelector ? 'rgba(105,219,124,0.15)' : 'rgba(105,219,124,0.06)',
                        color: '#69db7c',
                        fontSize: '10px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(105,219,124,0.12)'}
                      onMouseLeave={e => e.currentTarget.style.background = pmShowTrackSelector ? 'rgba(105,219,124,0.15)' : 'rgba(105,219,124,0.06)'}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <circle cx="12" cy="12" r="6" />
                        <circle cx="12" cy="12" r="2" />
                      </svg>
                      Use on More
                    </button>
                  </div>

                  {/* Physical Modeling Track matrix */}
                  {pmShowTrackSelector && (
                    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '8px', background: 'rgba(0,0,0,0.2)', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                        <span style={{ fontSize: '10px', color: '#888', fontWeight: 800 }}>PHYSICS TRACK MATRIX:</span>
                        <button onClick={() => setPmShowTrackSelector(false)} style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', fontSize: '12px', fontWeight: 900 }}>&times;</button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {tracks.filter(t => t.instrument === 'synth').map(t => {
                          const isActive = t.id === activeTrack.id
                          const isPhysical = t.synthPreset === 'physical'

                          return (
                            <button
                              key={t.id}
                              disabled={isActive}
                              onClick={() => {
                                commitHistory()
                                if (isPhysical) {
                                  updateTrack(t.id, { synthPreset: 'warm' })
                                  audioEngine.createInstrument(t.id, 'synth')
                                  useStore.getState().showToast(`Disabled Physical Modeling on "${t.name}"`, 'success')
                                } else {
                                  updateTrack(t.id, {
                                    synthPreset: 'physical',
                                    pmModelType: activeTrack.pmModelType || 'string',
                                    pmStringStiffness: activeTrack.pmStringStiffness ?? 0.5,
                                    pmStringDecay: activeTrack.pmStringDecay ?? 0.7,
                                    pmPluckHardness: activeTrack.pmPluckHardness ?? 0.6,
                                    pmBridgeTransmission: activeTrack.pmBridgeTransmission ?? 0.3,
                                    pmWindJetDelay: activeTrack.pmWindJetDelay ?? 0.5,
                                    pmWindBlowPressure: activeTrack.pmWindBlowPressure ?? 0.6,
                                    pmWindDamping: activeTrack.pmWindDamping ?? 0.4,
                                    pmPercResonance: activeTrack.pmPercResonance ?? 0.5,
                                    pmPercStrikerSpeed: activeTrack.pmPercStrikerSpeed ?? 0.6,
                                    pmPercClarity: activeTrack.pmPercClarity ?? 0.5
                                  })
                                  audioEngine.createInstrument(t.id, 'synth')
                                  useStore.getState().showToast(`Enabled Physical Modeling on "${t.name}"`, 'success')
                                }
                              }}
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                borderRadius: '4px',
                                border: '1px solid rgba(255,255,255,0.04)',
                                background: isActive
                                  ? 'rgba(77,171,247,0.12)'
                                  : isPhysical
                                    ? 'rgba(105,219,124,0.08)'
                                    : 'rgba(255,255,255,0.02)',
                                color: isActive ? '#4dabf7' : isPhysical ? '#69db7c' : '#aaa',
                                fontSize: '10px',
                                fontWeight: 700,
                                textAlign: 'left',
                                cursor: isActive ? 'default' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                transition: 'all 0.15s',
                                opacity: isActive ? 0.75 : 1
                              }}
                              onMouseEnter={e => {
                                if (!isActive) e.currentTarget.style.background = isPhysical ? 'rgba(105,219,124,0.15)' : 'rgba(255,255,255,0.08)'
                              }}
                              onMouseLeave={e => {
                                if (!isActive) e.currentTarget.style.background = isPhysical ? 'rgba(105,219,124,0.08)' : 'rgba(255,255,255,0.02)'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.color || '#4dabf7' }}></span>
                                <span>{t.name} {isActive && '(Active Track)'}</span>
                              </div>
                              <div>
                                {isActive ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20 6 9 17l-5-5" />
                                  </svg>
                                ) : isPhysical ? (
                                  <span style={{ fontSize: '9px', color: '#69db7c' }}>Active</span>
                                ) : (
                                  <span style={{ fontSize: '9px', color: '#555' }}>Off</span>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      const data = {
                        name: `${activeTrack.name} Physics`,
                        engineType: 'physical',
                        config: {
                          pmModelType: activeTrack.pmModelType || 'string',
                          pmStringStiffness: activeTrack.pmStringStiffness ?? 0.5,
                          pmStringDecay: activeTrack.pmStringDecay ?? 0.7,
                          pmPluckHardness: activeTrack.pmPluckHardness ?? 0.6,
                          pmBridgeTransmission: activeTrack.pmBridgeTransmission ?? 0.3,
                          pmWindJetDelay: activeTrack.pmWindJetDelay ?? 0.5,
                          pmWindBlowPressure: activeTrack.pmWindBlowPressure ?? 0.6,
                          pmWindDamping: activeTrack.pmWindDamping ?? 0.4,
                          pmPercResonance: activeTrack.pmPercResonance ?? 0.5,
                          pmPercStrikerSpeed: activeTrack.pmPercStrikerSpeed ?? 0.6,
                          pmPercClarity: activeTrack.pmPercClarity ?? 0.5
                        }
                      }
                      const jsonStr = JSON.stringify(data, null, 2)
                      const blob = new Blob([jsonStr], { type: 'application/json' })
                      const safeName = activeTrack.name.toLowerCase().replace(/\s+/g, '_')
                      saveFileWithDialog(blob, {
                        filename: `${safeName}_physics.muzins`,
                        title: 'Save Physics Patch',
                        filters: [{ name: 'MuseGrid Instrument Patch', extensions: ['muzins'] }]
                      }).then((saved) => {
                        if (saved) useStore.getState().showToast(`Exported physics patch: ${activeTrack.name} Physics`, 'success')
                      })
                    }}
                    style={{
                      width: '100%',
                      padding: '6px',
                      borderRadius: '5px',
                      border: '1px solid rgba(218,119,242,0.3)',
                      background: 'rgba(218,119,242,0.06)',
                      color: '#da77f2',
                      fontSize: '10px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      transition: 'all 0.15s',
                      marginTop: '4px'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(218,119,242,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(218,119,242,0.06)'}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    EXPORT INSTRUMENT (.MUZINS)
                  </button>
                </>
              )}
            </div>
          )}
        </Section>

        <Section title="Voice Designer" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Set Active Track to Vocal Synth / Deactivate */}
            {activeTrack && activeTrack.instrument === 'synth' ? (
              <div style={{ padding: '8px', background: activeTrack.synthPreset === 'vocal' ? 'rgba(105,219,124,0.08)' : 'rgba(77,171,247,0.06)', borderRadius: '6px', border: activeTrack.synthPreset === 'vocal' ? '1px solid rgba(105,219,124,0.3)' : '1px dashed rgba(77,171,247,0.3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '10px', color: activeTrack.synthPreset === 'vocal' ? '#69db7c' : '#aaa', fontWeight: 800 }}>
                    {activeTrack.synthPreset === 'vocal' ? '● VOCAL SYNTH ACTIVE' : '○ STANDARD SYNTH'}
                  </div>
                  <span style={{ fontSize: '10px', color: '#666', fontWeight: 600 }}>{activeTrack.name}</span>
                </div>

                {activeTrack.synthPreset === 'vocal' ? (
                  <button
                    onClick={() => {
                      commitHistory()
                      updateTrack(activeTrack.id, { synthPreset: 'piano' })
                      audioEngine.createInstrument(activeTrack.id, 'synth')
                      useStore.getState().showToast(`Deactivated vocal synth on "${activeTrack.name}" (switched to Piano)`, 'info')
                    }}
                    style={{ ...buttonStyle('#ff6b6b'), width: '100%', padding: '5px', fontSize: '10px', fontWeight: 800, background: 'rgba(255, 107, 107, 0.12)' }}
                    title="Switch track back to standard synthesizer"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <IconX size={12} /> DEACTIVATE VOCAL SYNTH
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      commitHistory()
                      updateTrack(activeTrack.id, { synthPreset: 'vocal' })
                      audioEngine.createInstrument(activeTrack.id, 'synth')
                      useStore.getState().showToast(`Activated vocal synth on "${activeTrack.name}"`, 'success')
                    }}
                    style={{ ...buttonStyle('#69db7c'), width: '100%', padding: '5px', fontSize: '10px', fontWeight: 800, background: 'rgba(105, 219, 124, 0.12)' }}
                    title="Convert current track to vocal singing synthesizer"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <IconZap size={11} /> ACTIVATE VOCAL SYNTH ON TRACK
                    </span>
                  </button>
                )}
              </div>
            ) : activeTrack && activeTrack.instrument === 'drum' ? (
              <div style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px dashed rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '10px', color: '#888', fontWeight: 600, textAlign: 'center' }}>
                  Current track is a Drum Kit ({activeTrack.name})
                </div>
                <button
                  onClick={() => {
                    commitHistory()
                    updateTrack(activeTrack.id, { instrument: 'synth', synthPreset: 'vocal' })
                    audioEngine.createInstrument(activeTrack.id, 'synth')
                    useStore.getState().showToast(`Converted "${activeTrack.name}" to vocal synth track`, 'success')
                  }}
                  style={{ ...buttonStyle('#69db7c'), width: '100%', padding: '4px', fontSize: '9px', fontWeight: 800 }}
                >
                  CONVERT TO VOCAL SYNTH TRACK
                </button>
              </div>
            ) : null}

            {/* Selector and Actions */}
            <div style={{ display: 'flex', gap: '4px' }}>
              <select
                value={selectedVoicePresetId}
                onMouseDown={e => e.stopPropagation()}
                onChange={e => setSelectedVoicePresetId(e.target.value)}
                style={{ flex: 1, background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '5px', fontSize: '11px', color: 'white', outline: 'none' }}
              >
                {voicePresets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <button
                onClick={() => {
                  const newPreset = {
                    id: `voice-${Date.now()}`,
                    name: `Custom Voice ${voicePresets.length + 1}`,
                    vocalTractLength: 1.0,
                    breathiness: 0.1,
                    glottalTension: 0.8,
                    vibratoDepth: 30,
                    vibratoRate: 6.0,
                    jitter: 0.1,
                    shimmer: 0.1,
                    formantShiftF1: 0,
                    formantShiftF2: 0,
                    formantShiftF3: 0,
                    consonantVolume: 1.0,
                    consonantLength: 1.0,
                    articulationSpeed: 1.0
                  }
                  addVoicePreset(newPreset)
                  setSelectedVoicePresetId(newPreset.id)
                }}
                style={{ ...buttonStyle('#4dabf7'), padding: '5px 8px', fontSize: '10px' }}
                title="Create New Voice"
              >
                <IconPlus size={12} />
              </button>

              {!['soprano', 'tenor', 'child', 'robot'].includes(selectedVoicePresetId) && (
                <button
                  onClick={() => {
                    deleteVoicePreset(selectedVoicePresetId)
                    const remaining = voicePresets.filter(p => p.id !== selectedVoicePresetId)
                    setSelectedVoicePresetId(remaining[0]?.id || 'soprano')
                  }}
                  style={{ ...buttonStyle('#ff6b6b'), padding: '5px 8px', fontSize: '10px' }}
                  title="Delete Voice"
                >
                  <IconTrash size={12} />
                </button>
              )}
            </div>

            {/* Voice Preset Form */}
            {(() => {
              const preset = voicePresets.find(p => p.id === selectedVoicePresetId)
              if (!preset) return null

              const updateParam = (key: keyof typeof preset, val: any) => {
                // The tongue/lip knobs describe a neutral tract; applied at their shipped defaults they
                // overwrote every vowel's own constriction. Only shape the tract once the user moves one.
                const shaping = key === 'tongueIndex' || key === 'tongueDiameter' || key === 'lipDiameter'
                addVoicePreset({ ...preset, [key]: val, ...(shaping ? { tongueShaping: true } : {}) })
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {/* Name Input */}
                  <div style={{ marginBottom: '8px' }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', color: '#aaa' }}>Voice Name</span>
                    </div>
                    <input
                      type="text"
                      value={preset.name}
                      onMouseDown={e => e.stopPropagation()}
                      onMouseUp={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => e.stopPropagation()}
                      onChange={e => updateParam('name', e.target.value)}
                      disabled={['soprano', 'tenor', 'child', 'robot'].includes(preset.id)}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', color: 'white', outline: 'none' }}
                    />
                  </div>

                  {/* Vocal Engine Selection Header */}
                  <div style={{ marginBottom: '8px', padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '4px' }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '10px', color: '#ff79c6', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vocal Engine</span>
                      <span style={{ fontSize: '9px', color: '#888', fontStyle: 'italic' }}>
                        {preset.synthesisMode === 'fof' ? 'CHANT Formant Wave Packets' : preset.synthesisMode === 'formant' ? 'Classic Subtractive Filters' : 'Digital Waveguide Mesh'}
                      </span>
                    </div>
                    <select
                      value={preset.synthesisMode ?? 'waveguide'}
                      onChange={e => updateParam('synthesisMode', e.target.value)}
                      style={{ background: '#161622', border: '1px solid rgba(255, 121, 198, 0.4)', borderRadius: '4px', padding: '5px 8px', fontSize: '11px', fontWeight: 700, color: '#fff', outline: 'none', cursor: 'pointer' }}
                    >
                      <option value="waveguide">Pink Trombone (Digital Waveguide Physical Model)</option>
                      <option value="fof">FOF — Forme d'Onde Formantique (IRCAM CHANT)</option>
                      <option value="formant">Classic Formant Resonators (Subtractive)</option>
                    </select>
                  </div>

                  {/* ========================================================================= */}
                  {/* === PINK TROMBONE PHYSICAL MODEL SUBPANE CONTROLS === */}
                  {/* ========================================================================= */}
                  {preset.synthesisMode === 'waveguide' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* 1. Tract Anatomy & Geometry */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(32, 201, 151, 0.05)', border: '1px solid rgba(32, 201, 151, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#20c997', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          TRACT ANATOMY & GEOMETRY
                        </div>
                        <SliderRow label="Tract Length Scale" value={preset.vocalTractLength ?? 1.0} min={0.70} max={1.50} step={0.01} suffix="x" color="#20c997" onChange={v => updateParam('vocalTractLength', v)} />
                        <SliderRow label="Tongue Position" value={preset.tongueIndex ?? 28} min={12} max={40} step={1} color="#20c997" onChange={v => updateParam('tongueIndex', v)} />
                        <SliderRow label="Tongue Aperture" value={preset.tongueDiameter ?? 2.2} min={0.5} max={4.5} step={0.1} suffix=" cm" color="#20c997" onChange={v => updateParam('tongueDiameter', v)} />
                        <SliderRow label="Lip Aperture" value={preset.lipDiameter ?? 1.8} min={0.2} max={4.0} step={0.1} suffix=" cm" color="#20c997" onChange={v => updateParam('lipDiameter', v)} />
                        <SliderRow label="Nasal Port (Velum)" value={preset.velumOpening ?? 0.0} min={0.0} max={1.0} step={0.02} color="#20c997" onChange={v => updateParam('velumOpening', v)} />
                        <SliderRow label="Tube Sections" value={preset.tubeSections ?? 22} min={16} max={44} step={1} color="#20c997" onChange={v => updateParam('tubeSections', v)} />
                        <SliderRow label="Wall Tissue Damping" value={preset.waveguideDamping ?? 0.99} min={0.85} max={1.00} step={0.005} color="#20c997" onChange={v => updateParam('waveguideDamping', v)} />
                        <SliderRow label="Lip Radiation Reflect" value={preset.lipReflection ?? -0.85} min={-0.98} max={-0.50} step={0.01} color="#20c997" onChange={v => updateParam('lipReflection', v)} />
                        <SliderRow label="Glottal Fold Reflect" value={preset.glottalReflection ?? 0.82} min={0.40} max={0.98} step={0.01} color="#20c997" onChange={v => updateParam('glottalReflection', v)} />
                      </div>

                      {/* 2. Constriction Aerodynamics & Turbulence */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(253, 126, 20, 0.05)', border: '1px solid rgba(253, 126, 20, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#fd7e14', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          AERODYNAMICS & CONSTRICTION
                        </div>
                        <SliderRow label="Constriction Turb Noise" value={preset.constrictionTurbulence ?? 1.0} min={0.0} max={2.5} step={0.05} suffix="x" color="#fd7e14" onChange={v => updateParam('constrictionTurbulence', v)} />
                        <SliderRow label="Plosive Release Pop" value={preset.plosiveBurstGain ?? 1.0} min={0.0} max={2.0} step={0.05} suffix="x" color="#fd7e14" onChange={v => updateParam('plosiveBurstGain', v)} />
                        <SliderRow label="Glottal Breathiness" value={preset.breathiness ?? 0.1} min={0.0} max={1.0} step={0.01} color="#fd7e14" onChange={v => updateParam('breathiness', v)} />
                      </div>

                      {/* 3. Glottal Source & Vocal Folds */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(77, 171, 247, 0.05)', border: '1px solid rgba(77, 171, 247, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#4dabf7', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          GLOTTAL SOURCE & VOCAL FOLDS
                        </div>
                        <SliderRow label="Glottal Tension" value={preset.glottalTension ?? 0.85} min={0.0} max={1.0} step={0.01} color="#4dabf7" onChange={v => updateParam('glottalTension', v)} />
                        <SliderRow label="Vibrato Depth" value={preset.vibratoDepth ?? 35} min={0} max={120} step={1} suffix=" ct" color="#4dabf7" onChange={v => updateParam('vibratoDepth', v)} />
                        <SliderRow label="Vibrato Rate" value={preset.vibratoRate ?? 6.0} min={1.0} max={10.0} step={0.1} suffix=" Hz" color="#4dabf7" onChange={v => updateParam('vibratoRate', v)} />
                        <SliderRow label="Vibrato Onset Delay" value={preset.vibratoDelay ?? 80} min={0} max={400} step={10} suffix=" ms" color="#4dabf7" onChange={v => updateParam('vibratoDelay', v)} />
                        <SliderRow label="Pitch Jitter" value={preset.jitter ?? 0.1} min={0.0} max={1.0} step={0.01} color="#4dabf7" onChange={v => updateParam('jitter', v)} />
                        <SliderRow label="Amplitude Shimmer" value={preset.shimmer ?? 0.1} min={0.0} max={1.0} step={0.01} color="#4dabf7" onChange={v => updateParam('shimmer', v)} />
                      </div>

                      {/* 4. Articulation & Consonants */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(250, 176, 5, 0.05)', border: '1px solid rgba(250, 176, 5, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#fab005', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          CONSONANTS & ARTICULATION
                        </div>
                        <SliderRow label="Consonant Burst Vol" value={preset.consonantVolume ?? 1.0} min={0.0} max={3.0} step={0.05} suffix="x" color="#fab005" onChange={v => updateParam('consonantVolume', v)} />
                        <SliderRow label="Consonant Duration" value={preset.consonantLength ?? 1.0} min={0.2} max={3.0} step={0.05} suffix="x" color="#fab005" onChange={v => updateParam('consonantLength', v)} />
                        <SliderRow label="Articulation Speed" value={preset.articulationSpeed ?? 1.0} min={0.2} max={3.0} step={0.05} suffix="x" color="#fab005" onChange={v => updateParam('articulationSpeed', v)} />
                      </div>

                      {/* 5. Buffer Envelopes & Anti-Click */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', background: 'rgba(169, 227, 75, 0.05)', border: '1px solid rgba(169, 227, 75, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#a9e34b', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          ENVELOPE & HEADROOM
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#ccc', cursor: 'pointer', padding: '2px 0' }} onClick={e => e.stopPropagation()}>
                          <span>Anti-Click Micro-Fade</span>
                          <input type="checkbox" checked={preset.antiClickFade !== false} onChange={e => updateParam('antiClickFade', e.target.checked)} style={{ accentColor: '#a9e34b', cursor: 'pointer' }} />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#ccc', cursor: 'pointer', padding: '2px 0' }} onClick={e => e.stopPropagation()}>
                          <span>Direct Buffer Envelope</span>
                          <input type="checkbox" checked={!!preset.bufferEnvelopeEnabled} onChange={e => updateParam('bufferEnvelopeEnabled', e.target.checked)} style={{ accentColor: '#a9e34b', cursor: 'pointer' }} />
                        </label>
                        {preset.bufferEnvelopeEnabled && (
                          <>
                            <SliderRow label="Buffer Attack" value={preset.bufferAttackMs ?? 15} min={0} max={100} step={1} suffix=" ms" color="#a9e34b" onChange={v => updateParam('bufferAttackMs', v)} />
                            <SliderRow label="Buffer Release" value={preset.bufferReleaseMs ?? 25} min={0} max={100} step={1} suffix=" ms" color="#a9e34b" onChange={v => updateParam('bufferReleaseMs', v)} />
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ========================================================================= */}
                  {/* === FOF (IRCAM CHANT) FORMANT WAVE PACKET SUBPANE CONTROLS === */}
                  {/* ========================================================================= */}
                  {preset.synthesisMode === 'fof' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* 1. Formant Wave Packets F1 to F5 */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(218, 119, 242, 0.05)', border: '1px solid rgba(218, 119, 242, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#da77f2', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          FORMANT WAVE PACKETS (F1 – F5)
                        </div>
                        <SliderRow label="F1 Shift" value={preset.formantShiftF1 ?? 0} min={-600} max={600} step={10} suffix=" Hz" color="#da77f2" onChange={v => updateParam('formantShiftF1', v)} />
                        <SliderRow label="F2 Shift" value={preset.formantShiftF2 ?? 0} min={-600} max={600} step={10} suffix=" Hz" color="#da77f2" onChange={v => updateParam('formantShiftF2', v)} />
                        <SliderRow label="F3 Shift" value={preset.formantShiftF3 ?? 0} min={-600} max={600} step={10} suffix=" Hz" color="#da77f2" onChange={v => updateParam('formantShiftF3', v)} />
                        <SliderRow label="F4 Shift" value={preset.formantShiftF4 ?? 0} min={-600} max={600} step={10} suffix=" Hz" color="#da77f2" onChange={v => updateParam('formantShiftF4', v)} />
                        <SliderRow label="F5 Shift" value={preset.formantShiftF5 ?? 0} min={-600} max={600} step={10} suffix=" Hz" color="#da77f2" onChange={v => updateParam('formantShiftF5', v)} />
                        <SliderRow label="F1 Bandwidth" value={preset.fofBw1 ?? 75} min={20} max={400} step={5} suffix=" Hz" color="#da77f2" onChange={v => updateParam('fofBw1', v)} />
                        <SliderRow label="F2 Bandwidth" value={preset.fofBw2 ?? 90} min={30} max={500} step={5} suffix=" Hz" color="#da77f2" onChange={v => updateParam('fofBw2', v)} />
                        <SliderRow label="F3 Bandwidth" value={preset.fofBw3 ?? 120} min={40} max={600} step={5} suffix=" Hz" color="#da77f2" onChange={v => updateParam('fofBw3', v)} />
                        <SliderRow label="F4 Bandwidth" value={preset.fofBw4 ?? 140} min={50} max={700} step={5} suffix=" Hz" color="#da77f2" onChange={v => updateParam('fofBw4', v)} />
                        <SliderRow label="F5 Bandwidth" value={preset.fofBw5 ?? 160} min={60} max={800} step={5} suffix=" Hz" color="#da77f2" onChange={v => updateParam('fofBw5', v)} />
                      </div>

                      {/* 2. FOF Waveform Skirt & Morphing */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(255, 121, 198, 0.05)', border: '1px solid rgba(255, 121, 198, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#ff79c6', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          FOF PACKET ENVELOPE & MORPHING
                        </div>
                        <SliderRow label="Attack Skirt (Tex)" value={preset.fofAttackMs ?? 2.2} min={0.5} max={8.0} step={0.1} suffix=" ms" color="#ff79c6" onChange={v => updateParam('fofAttackMs', v)} />
                        <SliderRow label="Skirt Damping" value={preset.fofSkirtDamping ?? 1.0} min={0.5} max={2.0} step={0.05} suffix="x" color="#ff79c6" onChange={v => updateParam('fofSkirtDamping', v)} />
                        <SliderRow label="Diphthong Morph" value={preset.fofDiphthongMorph ?? 1.0} min={0.2} max={3.0} step={0.05} suffix="x" color="#ff79c6" onChange={v => updateParam('fofDiphthongMorph', v)} />
                        <SliderRow label="Global VTL Scale" value={preset.vocalTractLength ?? 1.0} min={0.70} max={1.50} step={0.01} suffix="x" color="#ff79c6" onChange={v => updateParam('vocalTractLength', v)} />
                      </div>

                      {/* 3. Glottal Excitation & Vibrato */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(77, 171, 247, 0.05)', border: '1px solid rgba(77, 171, 247, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#4dabf7', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          GLOTTAL EXCITATION & VIBRATO
                        </div>
                        <SliderRow label="Glottal Tension" value={preset.glottalTension ?? 0.88} min={0.0} max={1.0} step={0.01} color="#4dabf7" onChange={v => updateParam('glottalTension', v)} />
                        <SliderRow label="Glottal Aspiration" value={preset.breathiness ?? 0.08} min={0.0} max={1.0} step={0.01} color="#4dabf7" onChange={v => updateParam('breathiness', v)} />
                        <SliderRow label="Vibrato Depth" value={preset.vibratoDepth ?? 45} min={0} max={120} step={1} suffix=" ct" color="#4dabf7" onChange={v => updateParam('vibratoDepth', v)} />
                        <SliderRow label="Vibrato Rate" value={preset.vibratoRate ?? 5.6} min={1.0} max={10.0} step={0.1} suffix=" Hz" color="#4dabf7" onChange={v => updateParam('vibratoRate', v)} />
                        <SliderRow label="Vibrato Onset Delay" value={preset.vibratoDelay ?? 100} min={0} max={400} step={10} suffix=" ms" color="#4dabf7" onChange={v => updateParam('vibratoDelay', v)} />
                        <SliderRow label="Pitch Jitter" value={preset.jitter ?? 0.08} min={0.0} max={1.0} step={0.01} color="#4dabf7" onChange={v => updateParam('jitter', v)} />
                        <SliderRow label="Amplitude Shimmer" value={preset.shimmer ?? 0.08} min={0.0} max={1.0} step={0.01} color="#4dabf7" onChange={v => updateParam('shimmer', v)} />
                      </div>

                      {/* 4. Consonants & Articulation */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(250, 176, 5, 0.05)', border: '1px solid rgba(250, 176, 5, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#fab005', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          CONSONANTS & ARTICULATION
                        </div>
                        <SliderRow label="Consonant Burst Vol" value={preset.consonantVolume ?? 1.1} min={0.0} max={3.0} step={0.05} suffix="x" color="#fab005" onChange={v => updateParam('consonantVolume', v)} />
                        <SliderRow label="Consonant Duration" value={preset.consonantLength ?? 1.0} min={0.2} max={3.0} step={0.05} suffix="x" color="#fab005" onChange={v => updateParam('consonantLength', v)} />
                        <SliderRow label="Articulation Speed" value={preset.articulationSpeed ?? 1.1} min={0.2} max={3.0} step={0.05} suffix="x" color="#fab005" onChange={v => updateParam('articulationSpeed', v)} />
                      </div>

                      {/* 5. Buffer Envelopes & Anti-Click */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', background: 'rgba(169, 227, 75, 0.05)', border: '1px solid rgba(169, 227, 75, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#a9e34b', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          ENVELOPE & HEADROOM
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#ccc', cursor: 'pointer', padding: '2px 0' }} onClick={e => e.stopPropagation()}>
                          <span>Anti-Click Micro-Fade</span>
                          <input type="checkbox" checked={preset.antiClickFade !== false} onChange={e => updateParam('antiClickFade', e.target.checked)} style={{ accentColor: '#a9e34b', cursor: 'pointer' }} />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#ccc', cursor: 'pointer', padding: '2px 0' }} onClick={e => e.stopPropagation()}>
                          <span>Direct Buffer Envelope</span>
                          <input type="checkbox" checked={!!preset.bufferEnvelopeEnabled} onChange={e => updateParam('bufferEnvelopeEnabled', e.target.checked)} style={{ accentColor: '#a9e34b', cursor: 'pointer' }} />
                        </label>
                        {preset.bufferEnvelopeEnabled && (
                          <>
                            <SliderRow label="Buffer Attack" value={preset.bufferAttackMs ?? 15} min={0} max={100} step={1} suffix=" ms" color="#a9e34b" onChange={v => updateParam('bufferAttackMs', v)} />
                            <SliderRow label="Buffer Release" value={preset.bufferReleaseMs ?? 25} min={0} max={100} step={1} suffix=" ms" color="#a9e34b" onChange={v => updateParam('bufferReleaseMs', v)} />
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ========================================================================= */}
                  {/* === CLASSIC FORMANT RESONATORS SUBPANE CONTROLS === */}
                  {/* ========================================================================= */}
                  {preset.synthesisMode === 'formant' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', background: 'rgba(105, 219, 124, 0.05)', border: '1px solid rgba(105, 219, 124, 0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#69db7c', letterSpacing: '0.5px', marginBottom: '2px' }}>
                          SUBTRACTIVE FORMANT FILTERS
                        </div>
                        <SliderRow label="F1 Shift" value={preset.formantShiftF1 ?? 0} min={-500} max={500} step={10} suffix=" Hz" color="#69db7c" onChange={v => updateParam('formantShiftF1', v)} />
                        <SliderRow label="F2 Shift" value={preset.formantShiftF2 ?? 0} min={-500} max={500} step={10} suffix=" Hz" color="#69db7c" onChange={v => updateParam('formantShiftF2', v)} />
                        <SliderRow label="F3 Shift" value={preset.formantShiftF3 ?? 0} min={-500} max={500} step={10} suffix=" Hz" color="#69db7c" onChange={v => updateParam('formantShiftF3', v)} />
                        <SliderRow label="Tract Scale" value={preset.vocalTractLength ?? 1.0} min={0.8} max={1.4} step={0.01} suffix="x" color="#4dabf7" onChange={v => updateParam('vocalTractLength', v)} />
                        <SliderRow label="Breathiness" value={preset.breathiness ?? 0.1} min={0} max={1} step={0.01} color="#4dabf7" onChange={v => updateParam('breathiness', v)} />
                        <SliderRow label="Glottal Tension" value={preset.glottalTension ?? 0.8} min={0} max={1} step={0.01} color="#4dabf7" onChange={v => updateParam('glottalTension', v)} />
                        <SliderRow label="Consonant Vol" value={preset.consonantVolume ?? 1.0} min={0} max={3.0} step={0.05} suffix="x" color="#fd7e14" onChange={v => updateParam('consonantVolume', v)} />
                        <SliderRow label="Consonant Len" value={preset.consonantLength ?? 1.0} min={0.2} max={3.0} step={0.05} suffix="x" color="#fd7e14" onChange={v => updateParam('consonantLength', v)} />
                        <SliderRow label="Articulation Speed" value={preset.articulationSpeed ?? 1.0} min={0.2} max={3.0} step={0.05} suffix="x" color="#fab005" onChange={v => updateParam('articulationSpeed', v)} />
                        <SliderRow label="Vibrato Depth" value={preset.vibratoDepth ?? 30} min={0} max={100} step={1} suffix=" ct" color="#da77f2" onChange={v => updateParam('vibratoDepth', v)} />
                        <SliderRow label="Vibrato Rate" value={preset.vibratoRate ?? 6.0} min={1} max={10} step={0.1} suffix=" Hz" color="#da77f2" onChange={v => updateParam('vibratoRate', v)} />
                        <SliderRow label="Jitter" value={preset.jitter ?? 0.1} min={0} max={1} step={0.01} color="#ff9900" onChange={v => updateParam('jitter', v)} />
                        <SliderRow label="Shimmer" value={preset.shimmer ?? 0.1} min={0} max={1} step={0.01} color="#ff9900" onChange={v => updateParam('shimmer', v)} />
                      </div>
                    </div>
                  )}

                  {/* Preview Voice Button */}
                  <button
                    onClick={() => audioEngine.previewVoicePreset(preset)}
                    style={{
                      ...buttonStyle('#69db7c'),
                      width: '100%',
                      padding: '7px',
                      fontSize: '10px',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      marginTop: '4px'
                    }}
                  >
                    <IconPlay size={12} /> PREVIEW VOICE — DAISY BELL
                  </button>

                  {/* Import / Export Preset Buttons */}
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <button
                      onClick={() => {
                        const jsonStr = JSON.stringify(preset, null, 2)
                        const blob = new Blob([jsonStr], { type: 'application/json' })
                        const safeName = preset.name.toLowerCase().replace(/\s+/g, '_')
                        saveFileWithDialog(blob, {
                          filename: `${safeName}.muzice`,
                          title: 'Save Voice Preset',
                          filters: [{ name: 'MuseGrid Voice Preset', extensions: ['muzice'] }]
                        }).then((saved) => {
                          if (saved) useStore.getState().showToast(`Exported voice preset: ${preset.name}`, 'success')
                        })
                      }}
                      style={{ ...buttonStyle('#da77f2'), flex: 1, padding: '5px', fontSize: '9px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                    >
                      <IconDownload size={12} /> EXPORT (.MUZICE)
                    </button>

                    <button
                      onClick={() => voiceFileInputRef.current?.click()}
                      style={{ ...buttonStyle('#4dabf7'), flex: 1, padding: '5px', fontSize: '9px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                    >
                      <IconOpen size={12} /> IMPORT (.MUZICE)
                    </button>
                    <input
                      ref={voiceFileInputRef}
                      type="file"
                      accept=".muzice"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = (event) => {
                          try {
                            const parsed = JSON.parse(event.target?.result as string) as VoicePreset
                            if (parsed && parsed.id && parsed.name && typeof parsed.vocalTractLength === 'number') {
                              addVoicePreset(parsed)
                              setSelectedVoicePresetId(parsed.id)
                              useStore.getState().showToast(`Imported voice preset: ${parsed.name}`, 'success')
                            } else {
                              useStore.getState().showToast('Invalid voice preset file', 'error')
                            }
                          } catch (err) {
                            useStore.getState().showToast('Failed to parse voice preset file', 'error')
                          }
                        }
                        reader.readAsText(file)
                        e.target.value = ''
                      }}
                    />
                  </div>
                </div>
              )
            })()}
          </div>
        </Section>

        <Section title="Track Utilities" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>Source Row</span>
                  <button
                    onClick={() => setUtilityPicker(utilityPicker?.slot === 'source' && utilityPicker.type === 'row' ? null : { type: 'row', slot: 'source' })}
                    style={{ background: 'none', border: 'none', color: (utilityPicker?.slot === 'source' && utilityPicker.type === 'row') ? '#4dabf7' : '#555', cursor: 'pointer', padding: 0, display: 'flex' }}
                    title="Click here, then click a row on the grid"
                  >
                    <IconTarget size={12} />
                  </button>
                </div>
                <StopPropSelect
                  value={utilitySourcePitch}
                  onChange={e => setUtilitySourcePitch(parseInt(e.target.value))}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${utilityPicker?.slot === 'source' && utilityPicker.type === 'row' ? '#4dabf7' : 'rgba(255,255,255,0.1)'}`, color: '#fff', fontSize: '11px', fontWeight: 600, padding: '6px', borderRadius: '6px', outline: 'none' }}
                >
                  {pitchOptions.map(o => <option key={o.value} value={o.value} style={{ background: '#1a1a24' }}>{o.label}</option>)}
                </StopPropSelect>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>Target Row</span>
                  <button
                    onClick={() => setUtilityPicker(utilityPicker?.slot === 'target' && utilityPicker.type === 'row' ? null : { type: 'row', slot: 'target' })}
                    style={{ background: 'none', border: 'none', color: (utilityPicker?.slot === 'target' && utilityPicker.type === 'row') ? '#4dabf7' : '#555', cursor: 'pointer', padding: 0, display: 'flex' }}
                    title="Click here, then click a row on the grid"
                  >
                    <IconTarget size={12} />
                  </button>
                </div>
                <StopPropSelect
                  value={utilityTargetPitch}
                  onChange={e => setUtilityTargetPitch(parseInt(e.target.value))}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${utilityPicker?.slot === 'target' && utilityPicker.type === 'row' ? '#4dabf7' : 'rgba(255,255,255,0.1)'}`, color: '#fff', fontSize: '11px', fontWeight: 600, padding: '6px', borderRadius: '6px', outline: 'none' }}
                >
                  {pitchOptions.map(o => <option key={o.value} value={o.value} style={{ background: '#1a1a24' }}>{o.label}</option>)}
                </StopPropSelect>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={() => swapNotes(utilitySourcePitch, utilityTargetPitch)}
                style={{ ...buttonStyle(activeTrack?.color || '#4dabf7'), padding: '8px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Swap
              </button>
              <button
                onClick={() => mergeNotes(utilitySourcePitch, utilityTargetPitch)}
                style={{ ...buttonStyle(activeTrack?.color || '#4dabf7'), padding: '8px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Merge
              </button>
            </div>

            <div style={{ fontSize: '10px', color: '#555', fontStyle: 'italic', marginTop: '4px' }}>
              * Affects all notes on current track. Use Undo to revert.
            </div>

            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>Source Col</span>
                    <button
                      onClick={() => setUtilityPicker(utilityPicker?.slot === 'source' && utilityPicker.type === 'col' ? null : { type: 'col', slot: 'source' })}
                      style={{ background: 'none', border: 'none', color: (utilityPicker?.slot === 'source' && utilityPicker.type === 'col') ? '#00e6ff' : '#555', cursor: 'pointer', padding: 0, display: 'flex' }}
                      title="Click here, then click a column on the grid"
                    >
                      <IconTarget size={12} />
                    </button>
                  </div>
                  <input
                    type="number"
                    value={utilitySourceCol === 0 && !Number.isInteger(utilitySourceCol) ? '' : utilitySourceCol + 1}
                    onMouseDown={e => e.stopPropagation()}
                    onMouseUp={e => e.stopPropagation()}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => setUtilitySourceCol(Math.max(0, (parseInt(e.target.value) || 1) - 1))}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${utilityPicker?.slot === 'source' && utilityPicker.type === 'col' ? '#00e6ff' : 'rgba(255,255,255,0.1)'}`, color: '#fff', fontSize: '11px', fontWeight: 600, padding: '6px', borderRadius: '6px', outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>Target Col</span>
                    <button
                      onClick={() => setUtilityPicker(utilityPicker?.slot === 'target' && utilityPicker.type === 'col' ? null : { type: 'col', slot: 'target' })}
                      style={{ background: 'none', border: 'none', color: (utilityPicker?.slot === 'target' && utilityPicker.type === 'col') ? '#00e6ff' : '#555', cursor: 'pointer', padding: 0, display: 'flex' }}
                      title="Click here, then click a column on the grid"
                    >
                      <IconTarget size={12} />
                    </button>
                  </div>
                  <input
                    type="number"
                    value={utilityTargetCol === 0 && !Number.isInteger(utilityTargetCol) ? '' : utilityTargetCol + 1}
                    onMouseDown={e => e.stopPropagation()}
                    onMouseUp={e => e.stopPropagation()}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => setUtilityTargetCol(Math.max(0, (parseInt(e.target.value) || 1) - 1))}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${utilityPicker?.slot === 'target' && utilityPicker.type === 'col' ? '#00e6ff' : 'rgba(255,255,255,0.1)'}`, color: '#fff', fontSize: '11px', fontWeight: 600, padding: '6px', borderRadius: '6px', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                <button
                  onClick={() => swapColumns(utilitySourceCol, utilityTargetCol)}
                  style={{ ...buttonStyle(activeTrack?.color || '#00e6ff'), padding: '8px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  Swap Cols
                </button>
                <button
                  onClick={() => mergeColumns(utilitySourceCol, utilityTargetCol)}
                  style={{ ...buttonStyle(activeTrack?.color || '#00e6ff'), padding: '8px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  Merge Cols
                </button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="MIDI Remap" info={midiRemapData.filename || 'No Data'} defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              onClick={handleOpenMidiLab}
              style={{ ...buttonStyle('#4dabf7'), width: '100%', padding: '10px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.08em' }}
            >
              <IconDownload size={14} style={{ marginRight: '6px' }} />
              LOAD MIDI
            </button>

            {midiRemapData.midi && (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px' }}>
                <div style={{ marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 900, color: '#fff' }}>{midiRemapData.filename || 'MIDI Laboratory'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#555', marginTop: '4px' }}>
                      <span style={{ fontSize: '9px', color: '#666', fontWeight: 700 }}>MIDI TEMPO:</span>
                      <input
                        type="number"
                        value={midiRemapData.midi ? Math.round(midiRemapData.midi.header.tempos[0]?.bpm || 120) : 120}
                        onChange={(e) => {
                          const val = Number(e.target.value)
                          if (!val || val <= 0) return
                          if (!midiRemapData.midi) return
                          const newMidi = new Midi(midiRemapData.midi.toArray())
                          if (!newMidi.header.tempos) newMidi.header.tempos = []
                          if (newMidi.header.tempos.length === 0) {
                            newMidi.header.tempos.push({ bpm: val, ticks: 0 })
                          } else {
                            newMidi.header.tempos[0].bpm = val
                          }
                          setMidiRemapData({ midi: newMidi })
                        }}
                        style={{
                          width: '45px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          color: '#fff',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          padding: '2px 4px',
                          outline: 'none',
                          textAlign: 'center'
                        }}
                      />
                      <span>BPM</span>
                      <button
                        onClick={() => {
                          const bpmVal = Math.round(midiRemapData.midi?.header.tempos[0]?.bpm || 120)
                          useStore.setState({ bpm: bpmVal })
                          audioEngine.setBpm(bpmVal)
                          useStore.getState().showToast(`Project BPM set to ${bpmVal}`, 'success')
                        }}
                        style={{
                          background: 'rgba(77,171,247,0.1)',
                          border: 'none',
                          color: '#4dabf7',
                          fontSize: '9px',
                          fontWeight: 800,
                          borderRadius: '4px',
                          padding: '2px 6px',
                          cursor: 'pointer',
                          transition: 'all 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(77,171,247,0.2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(77,171,247,0.1)'}
                        title="Apply this BPM to the project"
                      >
                        APPLY
                      </button>
                      <span style={{ color: '#444' }}>•</span>
                      <span>{midiRemapData.midi.tracks.length} Tracks</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setMidiRemapData({
                      midi: null,
                      filename: '',
                      drumMap: {
                        35: 0, 36: 0, 38: 1, 40: 1, 42: 2, 44: 2, 46: 3, 49: 4, 51: 4
                      },
                      synthMap: {},
                      channelStates: {},
                      octaveOffset: 0,
                      semitoneOffset: 0,
                      timeScale: 1.0,
                      velocityScale: 1.0,
                      velocityOffset: 0,
                      humanizeTiming: 0,
                      humanizeVelocity: 0,
                      repeatCount: 1
                    })}
                    style={{ background: 'rgba(255,51,102,0.1)', border: 'none', color: '#ff3366', fontSize: '10px', fontWeight: 900, borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                  >
                    CLOSE
                  </button>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#4dabf7', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Channel Audit</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '100px', overflowY: 'auto' }} className="thin-scroll">
                    {Array.from({ length: 16 }, (_, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                        <span style={{ fontSize: '9px', color: '#666', fontWeight: 700 }}>CH {i + 1}</span>
                        <ToggleSwitch
                          checked={midiRemapData.channelStates[i] !== false}
                          onChange={(checked) => setMidiRemapData({ channelStates: { ...midiRemapData.channelStates, [i]: checked } })}
                          color="#69db7c"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#4dabf7', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Laboratory Tracks</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '150px', overflowY: 'auto' }} className="thin-scroll">
                    {midiRemapData.midi.tracks.filter((t: any) => t.notes.length > 0).map((t: any, i: number) => (
                      <div
                        key={i}
                        onMouseEnter={() => setHoveredLabTrack(i)}
                        onMouseLeave={() => setHoveredLabTrack(null)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: hoveredLabTrack === i ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', transition: 'all 0.2s' }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#eee' }}>{t.name || `Track ${i + 1}`}</span>
                          <span style={{ fontSize: '9px', color: '#555' }}>{t.notes.length} notes</span>
                        </div>
                        <button
                          onClick={() => { setActiveLabTrack(t); setIsMidiLabInjecting(true) }}
                          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#eee', fontSize: '9px', fontWeight: 800, padding: '4px 10px', cursor: 'pointer' }}
                        >
                          COMMIT
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#4dabf7', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Injection Controls</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <TextInputRow label="Oct Shift" value={midiRemapData.octaveOffset} onChange={v => setMidiRemapData({ octaveOffset: v })} color="#4dabf7" />
                    <TextInputRow label="Semi Shift" value={midiRemapData.semitoneOffset} onChange={v => setMidiRemapData({ semitoneOffset: v })} color="#4dabf7" />
                    <TextInputRow label="Time Scale" value={midiRemapData.timeScale} onChange={v => setMidiRemapData({ timeScale: v })} color="#69db7c" />
                    <TextInputRow label="Repeats" value={midiRemapData.repeatCount} onChange={v => setMidiRemapData({ repeatCount: v })} color="#69db7c" />
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <SliderRow label="Vel Scale" value={midiRemapData.velocityScale} min={0.1} max={2.0} step={0.1} suffix="x" color="#da77f2" onChange={v => setMidiRemapData({ velocityScale: v })} />
                    <SliderRow label="Vel Offset" value={midiRemapData.velocityOffset} min={-64} max={64} step={1} color="#da77f2" onChange={v => setMidiRemapData({ velocityOffset: v })} />
                    <SliderRow label="Pitch Sens." value={midiRemapData.pitchSensitivity} min={0.1} max={2.0} step={0.1} color="#da77f2" onChange={v => setMidiRemapData({ pitchSensitivity: v })} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                      <TextInputRow label="Hum. Time" value={midiRemapData.humanizeTiming} onChange={v => setMidiRemapData({ humanizeTiming: v })} color="#ffd43b" />
                      <TextInputRow label="Hum. Vel" value={midiRemapData.humanizeVelocity} onChange={v => setMidiRemapData({ humanizeVelocity: v })} color="#ffd43b" />
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: '4px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#ff9900', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Universal Remapping</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }} className="thin-scroll">
                    {(() => {
                      const filePitches = midiRemapData.midi.tracks.flatMap((t: any) => t.notes.map((n: any) => n.midi))
                      const dMap = midiRemapData.drumMap || {}
                      const sMap = midiRemapData.synthMap || {}
                      const manualPitches = [
                        ...Object.keys(dMap).map(Number),
                        ...Object.keys(sMap).map(Number)
                      ]
                      const allPitches = Array.from(new Set([...filePitches, ...manualPitches]))
                        .filter(p => !draftExclusions.has(p))
                        .sort((a: any, b: any) => a - b) as number[]

                      return allPitches.map(p => {
                        const usage = midiRemapData.midi.tracks.filter((t: any) => t.notes.some((n: any) => n.midi === p))
                        const isUsedByHovered = hoveredLabTrack !== null && midiRemapData.midi.tracks[hoveredLabTrack].notes.some((n: any) => n.midi === p)
                        // Multi-vector detection: Check channels AND track names
                        const hasDrumUsage = usage.some((t: any) =>
                          t.channel === 9 ||
                          t.notes.some((n: any) => n.channel === 9) ||
                          (t.name && /drum|perc|kick|snare|hat/i.test(t.name))
                        )
                        const hasSynthUsage = usage.some((t: any) =>
                          (t.channel !== 9 && !(t.name && /drum|perc|kick|snare|hat/i.test(t.name))) ||
                          t.notes.some((n: any) => n.channel !== 9)
                        )

                        return (
                          <div key={p} style={{
                            display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px',
                            background: isUsedByHovered ? 'rgba(77,171,247,0.08)' : 'rgba(255,255,255,0.01)',
                            borderRadius: '8px', border: `1px solid ${isUsedByHovered ? 'rgba(77,171,247,0.3)' : 'rgba(255,255,255,0.03)'}`,
                            transition: 'all 0.2s'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                  onClick={() => {
                                    const newE = new Set(draftExclusions); newE.add(p)
                                    setDraftExclusions(newE)
                                  }}
                                  style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', padding: 0, opacity: 0.5, display: 'flex', alignItems: 'center' }}
                                  title="Exclude Pitch"
                                >
                                  <IconX size={12} />
                                </button>
                                <span style={{ fontSize: '10px', color: isUsedByHovered ? '#fff' : '#888', fontWeight: 800 }}>MIDI {p}</span>
                                <div style={{ display: 'flex', gap: '2px', opacity: 0.6 }}>
                                  {hasDrumUsage && <IconDrum size={10} title="Used in Drum Channel" />}
                                  {hasSynthUsage && <IconMusic size={10} title="Used in Synth Channel" />}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', opacity: draftDrumMutes.has(p) ? 0.3 : 1 }}>
                                  <button
                                    onClick={() => {
                                      const newM = new Set(draftDrumMutes);
                                      if (newM.has(p)) newM.delete(p); else newM.add(p)
                                      setDraftDrumMutes(newM)
                                    }}
                                    style={{ background: 'none', border: 'none', color: '#ff9900', cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center' }}
                                    title={draftDrumMutes.has(p) ? "Unmute Drum Duty" : "Mute Drum Duty"}
                                  >
                                    {draftDrumMutes.has(p) ? <IconVolumeX size={12} /> : <IconVolume size={12} />}
                                  </button>
                                  <StopPropSelect
                                    disabled={draftDrumMutes.has(p)}
                                    value={draftDrumMap[p] ?? (
                                      (p === 35 || p === 36) ? 0 :
                                        (p === 38 || p === 40) ? 1 :
                                          (p === 42 || p === 44) ? 2 :
                                            (p === 46) ? 3 :
                                              (p === 49 || p === 51) ? 4 :
                                                (p % 5)
                                    )}
                                    onChange={(e) => setDraftDrumMap({ ...draftDrumMap, [p]: +e.target.value })}
                                    style={{ background: '#000', border: 'none', color: '#ff9900', fontSize: '9px', fontWeight: 700, padding: '2px 4px', borderRadius: '4px', width: '60px', opacity: draftDrumMutes.has(p) ? 0.5 : 1 }}
                                  >
                                    <option value={0}>Kick</option>
                                    <option value={1}>Snare</option>
                                    <option value={2}>Hat Cl</option>
                                    <option value={3}>Hat Op</option>
                                    <option value={4}>Clap</option>
                                  </StopPropSelect>
                                </div>

                                <div style={{ width: '1px', background: 'rgba(255,255,255,0.05)', height: '12px' }} />

                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', opacity: draftSynthMutes.has(p) ? 0.3 : 1 }}>
                                  <button
                                    onClick={() => {
                                      const newM = new Set(draftSynthMutes);
                                      if (newM.has(p)) newM.delete(p); else newM.add(p)
                                      setDraftSynthMutes(newM)
                                    }}
                                    style={{ background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center' }}
                                    title={draftSynthMutes.has(p) ? "Unmute Synth Duty" : "Mute Synth Duty"}
                                  >
                                    {draftSynthMutes.has(p) ? <IconVolumeX size={12} /> : <IconVolume size={12} />}
                                  </button>
                                  <StopPropSelect
                                    disabled={draftSynthMutes.has(p)}
                                    value={draftSynthMap[p] ?? p}
                                    onChange={(e) => setDraftSynthMap({ ...draftSynthMap, [p]: +e.target.value })}
                                    style={{ background: '#000', border: 'none', color: '#4dabf7', fontSize: '9px', fontWeight: 700, padding: '2px 4px', borderRadius: '4px', width: '50px', opacity: draftSynthMutes.has(p) ? 0.5 : 1 }}
                                  >
                                    {Array.from({ length: 128 }, (_, i) => (
                                      <option key={i} value={i}>{getNoteName(i)}</option>
                                    ))}
                                  </StopPropSelect>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>

                  <div style={{ display: 'flex', gap: '4px', marginTop: '8px', pointerEvents: 'auto' }}>
                    <input
                      type="number"
                      placeholder="MIDI Pitch"
                      value={manualPitchInput}
                      onMouseDown={e => e.stopPropagation()}
                      onMouseUp={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => e.stopPropagation()}
                      onChange={e => setManualPitchInput(e.target.value)}
                      style={{ flex: 1, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px', color: '#eee', fontSize: '9px', padding: '4px 8px' }}
                    />
                    <button
                      onClick={() => {
                        const pitch = parseInt(manualPitchInput)
                        if (!isNaN(pitch) && pitch >= 0 && pitch <= 127) {
                          const newE = new Set(draftExclusions); newE.delete(pitch)
                          setDraftExclusions(newE)
                          setDraftDrumMap({ ...draftDrumMap, [pitch]: 0 })
                          setDraftSynthMap({ ...draftSynthMap, [pitch]: pitch })
                          setManualPitchInput('')
                        }
                      }}
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#aaa', fontSize: '9px', fontWeight: 800, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      Add
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' }}>
                    <button
                      onClick={() => setMidiRemapData({ drumMap: draftDrumMap, synthMap: draftSynthMap })}
                      style={{ ...buttonStyle('#69db7c'), padding: '8px', fontSize: '10px', fontWeight: 900 }}
                    >
                      SAVE MAPPING
                    </button>
                    <button
                      onClick={async () => {
                        if (!midiRemapData.midi) return
                        try {
                          const newMidi = new Midi(midiRemapData.midi.toArray())
                          newMidi.tracks.forEach(track => {
                            track.notes = track.notes.filter(note => !draftExclusions.has(note.midi))
                            track.notes.forEach(note => {
                              if (draftSynthMap[note.midi] !== undefined) {
                                note.midi = draftSynthMap[note.midi]
                              }
                            })
                          })

                          const midiArray = newMidi.toArray()
                          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                          // @ts-ignore
                          const success = await window.ipcRenderer.invoke('save-midi', midiArray, `Processed_${midiRemapData.filename || 'Lab.mid'}`)
                          if (success) {
                            console.log('MIDI Saved successfully via native dialog')
                          }
                        } catch (err) {
                          console.error('Failed to save MIDI:', err)
                        }
                      }}
                      style={{ ...buttonStyle('#4dabf7'), padding: '8px', fontSize: '10px', fontWeight: 900 }}
                    >
                      SAVE AS...
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Section>

        <Section title="Automation (Procedural)" defaultOpen={false}>
          <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px' }}>Points: {activeCurve.length}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Generator Type</span>
              <StopPropSelect
                value={autoPreset}
                onChange={e => setAutoPreset(e.target.value)}
                style={{ background: '#1e1e2e', color: '#b197fc', border: '1px solid rgba(177, 151, 252, 0.2)', borderRadius: '4px', padding: '4px 6px', fontSize: '11px', outline: 'none' }}
              >
                <option value="sine">LFO: Sine Wave</option>
                <option value="square">LFO: Square Wave</option>
                <option value="noise">Chaos: Perlin/Random</option>
                <option value="sidechain">Audio: Duck on Downbeat</option>
                <option value="custom">Math: Custom Equation</option>
              </StopPropSelect>
            </div>

            {autoPreset === 'custom' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', color: '#aaa' }}>Formula (t = ticks)</span>
                <input
                  value={autoFormula}
                  onChange={(e) => setAutoFormula(e.target.value)}
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(177,151,252,0.3)', color: '#b197fc', padding: '4px', borderRadius: '4px', fontSize: '11px', outline: 'none', fontFamily: 'monospace' }}
                />
              </div>
            )}

            <SliderRow label="Density (Ticks)" value={autoDensity} min={12} max={192} step={12} color="#b197fc" onChange={setAutoDensity} />

            <button
              onClick={() => {
                if (activeTrack) {
                  bakeProceduralAutomation(activeTrack.id, autoFormula, autoPreset, autoDensity)
                  useStore.getState().showToast('Procedural Automation Baked!', 'success')
                } else {
                  useStore.getState().showToast('Select a track first!', 'error')
                }
              }}
              style={{ ...buttonStyle('#b197fc'), width: '100%' }}
            >
              Bake Procedural Curve
            </button>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '4px', paddingTop: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#4dabf7', fontWeight: 700, display: 'block' }}>Live Equation Lane</span>
                <span style={{ fontSize: '9px', color: '#888' }}>Reads every frame, nothing is baked into the points</span>
              </div>
              <ToggleSwitch
                checked={activeLane?.source === 'formula'}
                onChange={checked => activeTrack && updateAutomationLane(activeTrack.id, { source: checked ? 'formula' : 'drawn' })}
                color="#4dabf7"
              />
            </div>

            {activeLane?.source === 'formula' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '10px', color: '#aaa' }}>Equation — t (s), b (beats), m (bars), ticks, v (base)</span>
                  <MathInput
                    value={activeLane.equation}
                    onChange={value => activeTrack && updateAutomationLane(activeTrack.id, { equation: value })}
                    placeholder="64 + 60 * Math.sin(t * 2)"
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Combine</span>
                  <StopPropSelect
                    value={activeLane.mode}
                    onChange={e => activeTrack && updateAutomationLane(activeTrack.id, { mode: e.target.value as any })}
                    style={{ background: '#1e1e2e', color: '#b197fc', border: '1px solid rgba(177, 151, 252, 0.2)', borderRadius: '4px', padding: '4px 6px', fontSize: '11px', outline: 'none' }}
                  >
                    <option value="override">Override — equation only</option>
                    <option value="add">Add — on top of the drawn lane</option>
                    <option value="multiply">Multiply — scale the drawn lane</option>
                  </StopPropSelect>
                </div>
              </div>
            )}
          </div>

          <button onClick={() => activeTrack && clearAutomationCurve(activeTrack.id)} style={{ ...buttonStyle('#ff3366'), width: '100%' }}>Clear Curve</button>
        </Section>

        <Section title="Scale Lock & Chord Stamper" defaultOpen={false}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>Scale Lock</span>
            <ToggleSwitch checked={scaleLock.enabled} onChange={checked => setScaleLock({ ...scaleLock, enabled: checked })} color="#00e6ff" />
          </div>

          {/* Ableton / FL Fold Grid to Scale Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', padding: '6px 8px', background: 'rgba(77,171,247,0.06)', borderRadius: '6px', border: '1px solid rgba(77,171,247,0.15)' }}>
            <div>
              <span style={{ fontSize: '11px', color: '#4dabf7', fontWeight: 700, display: 'block' }}>Fold Grid to Scale</span>
              <span style={{ fontSize: '9px', color: '#888' }}>Ableton/FL style: show only scale rows</span>
            </div>
            <ToggleSwitch
              checked={scaleFoldEnabled}
              onChange={checked => {
                setScaleFoldEnabled(checked)
                if (checked && !scaleLock.enabled) {
                  setScaleLock({ ...scaleLock, enabled: true })
                }
              }}
              color="#4dabf7"
            />
          </div>

          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Root</span>
              <StopPropSelect value={scaleLock.root} onChange={e => setScaleLock({ ...scaleLock, root: +e.target.value })} style={{ width: '100%', background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '4px', fontSize: '12px' }}>
                {(scaleLock.accidental === 'sharp' ? NOTE_NAMES_SHARP : NOTE_NAMES_FLAT).map((n, i) => <option key={i} value={i}>{n}</option>)}
              </StopPropSelect>
            </div>
            <div style={{ flex: 2 }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Mode</span>
              <StopPropSelect value={scaleLock.mode} onChange={e => setScaleLock({ ...scaleLock, mode: e.target.value })} style={{ width: '100%', background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '4px', fontSize: '11px' }}>
                {SCALE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="Custom">Custom Formula</option>
              </StopPropSelect>
            </div>
          </div>
          {scaleLock.mode === 'Custom' && (
            <div style={{ marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Custom Interval Array</span>
              <input
                type="text"
                value={scaleLock.customIntervals ? scaleLock.customIntervals.join(', ') : ''}
                onChange={e => {
                  const arr = e.target.value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
                  setScaleLock({ ...scaleLock, customIntervals: arr })
                }}
                placeholder="e.g. 0, 2, 4, 5, 7, 9, 11"
                style={{ width: '100%', background: '#1e1e2e', color: 'white', border: '1px solid rgba(0,230,255,0.3)', padding: '6px', fontSize: '11px', outline: 'none', borderRadius: '4px' }}
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Accidentals</span>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
              <button
                onClick={() => setScaleLock({ ...scaleLock, accidental: 'sharp' })}
                style={{ background: scaleLock.accidental === 'sharp' ? '#4dabf7' : 'transparent', border: 'none', borderRight: '1px solid rgba(255,255,255,0.1)', color: scaleLock.accidental === 'sharp' ? 'white' : '#aaa', padding: '2px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
              >#</button>
              <button
                onClick={() => setScaleLock({ ...scaleLock, accidental: 'flat' })}
                style={{ background: scaleLock.accidental === 'flat' ? '#4dabf7' : 'transparent', border: 'none', color: scaleLock.accidental === 'flat' ? 'white' : '#aaa', padding: '2px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
              >b</button>
            </div>
          </div>

          {/* 1-Click Chord Stamper Palette */}
          <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', color: '#ffcc00', fontWeight: 700, letterSpacing: '0.4px' }}>CHORD STAMPER (1-CLICK)</span>
              {activeChordStamp && (
                <button
                  onClick={() => setActiveChordStamp(null)}
                  style={{ background: 'rgba(255,107,107,0.15)', border: '1px solid rgba(255,107,107,0.3)', color: '#ff6b6b', fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Clear Stamp
                </button>
              )}
            </div>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px', lineHeight: '1.3' }}>
              {activeChordStamp
                ? `Active: ${CHORD_STAMPS.find(s => s.id === activeChordStamp)?.label ?? activeChordStamp} • Click any cell to drop voiced chord`
                : 'Click any chord below to stamp complete voiced chords with 1 click:'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              <button
                onClick={() => setActiveChordStamp(null)}
                style={{
                  padding: '5px 4px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: !activeChordStamp ? '#4dabf7' : 'rgba(255,255,255,0.08)',
                  background: !activeChordStamp ? 'rgba(77,171,247,0.2)' : 'rgba(255,255,255,0.03)',
                  color: !activeChordStamp ? '#4dabf7' : '#888',
                }}
              >
                Single Note
              </button>
              {CHORD_STAMPS.map(stamp => {
                const isSelected = activeChordStamp === stamp.id
                return (
                  <button
                    key={stamp.id}
                    onClick={() => setActiveChordStamp(isSelected ? null : stamp.id)}
                    title={`${stamp.label}: ${stamp.description}`}
                    style={{
                      padding: '5px 4px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: isSelected ? '#ffcc00' : 'rgba(255,255,255,0.08)',
                      background: isSelected ? 'rgba(255,204,0,0.2)' : 'rgba(255,255,255,0.03)',
                      color: isSelected ? '#ffcc00' : '#ddd',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {stamp.shortName}
                  </button>
                )
              })}
            </div>
          </div>
        </Section>

        {activeTrack?.instrument === 'synth' && (
          <Section title="Chord Assist & Progression Lab" defaultOpen={false}>
            {/* Root & Octave Selector */}
            <div style={{ marginBottom: '8px', padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: '#ffcc00', fontWeight: 700 }}>CHORD BASE REGISTER</span>
                <span style={{ fontSize: '9px', color: '#888' }}>
                  Base: {NOTE_NAMES_SHARP[chordRootNote]}{chordOctave} (MIDI {(chordOctave + 1) * 12 + chordRootNote})
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <div>
                  <span style={{ fontSize: '10px', color: '#aaa', display: 'block', marginBottom: '2px' }}>Root Note</span>
                  <StopPropSelect
                    value={chordRootNote}
                    onChange={e => setChordRootNote(+e.target.value)}
                    style={{ width: '100%', background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,204,0,0.3)', borderRadius: '4px', padding: '3px 6px', fontSize: '11px' }}
                  >
                    {NOTE_NAMES_SHARP.map((name, i) => (
                      <option key={i} value={i}>{name}</option>
                    ))}
                  </StopPropSelect>
                </div>
                <div>
                  <span style={{ fontSize: '10px', color: '#aaa', display: 'block', marginBottom: '2px' }}>Octave</span>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    {[1, 2, 3, 4, 5, 6, 7].map(oct => (
                      <button
                        key={oct}
                        onClick={() => setChordOctave(oct)}
                        style={{
                          flex: 1,
                          padding: '3px 0',
                          fontSize: '10px',
                          fontWeight: 700,
                          borderRadius: '3px',
                          border: chordOctave === oct ? '1px solid #ffcc00' : '1px solid rgba(255,255,255,0.08)',
                          background: chordOctave === oct ? 'rgba(255,204,0,0.2)' : 'rgba(255,255,255,0.02)',
                          color: chordOctave === oct ? '#ffcc00' : '#888',
                          cursor: 'pointer',
                        }}
                      >
                        {oct}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Chord Voicings Families */}
            <div style={{ marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Voicing Family</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {Object.keys(CHORD_VOICINGS).map(f => (
                  <button key={f} onClick={() => setChordFamily(f)} style={buttonStyle('#ffcc00', chordFamily === f)}>
                    {f}
                  </button>
                ))}
                <button onClick={() => setChordFamily('Custom')} style={buttonStyle('#ffcc00', chordFamily === 'Custom')}>
                  Custom Array
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {chordFamily === 'Custom' ? (
                <div style={{ width: '100%', display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    value={customChordFormula}
                    onChange={e => setCustomChordFormula(e.target.value)}
                    placeholder="e.g. 0, 3, 7, 10, 14"
                    style={{ flex: 1, background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,204,0,0.3)', padding: '6px', fontSize: '11px', outline: 'none' }}
                  />
                  <button onClick={() => {
                    try {
                      const arr = customChordFormula.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
                      if (arr.length > 0) insertChord(arr)
                    } catch (e) { }
                  }} style={{ ...buttonStyle('#ffcc00'), padding: '6px 12px' }}>
                    Inject Math Chord
                  </button>
                </div>
              ) : (
                (CHORD_VOICINGS[chordFamily] || []).map(chord => (
                  <button key={chord.name} onClick={() => insertChord(chord.intervals)} style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid rgba(255,204,0,0.25)', background: 'rgba(255,204,0,0.08)', color: '#ffcc00', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
                    {chord.name}
                  </button>
                ))
              )}
            </div>

            {/* 6 Genre-Defining Progression Generators */}
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', color: '#ff9900', fontWeight: 700 }}>GENRE PROGRESSION GENERATORS</span>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {[
                    { label: '1 Bar', ticks: 192 },
                    { label: '2 Beats', ticks: 96 },
                    { label: '1 Beat', ticks: 48 },
                  ].map(s => (
                    <button
                      key={s.label}
                      onClick={() => setProgressionSpacing(s.ticks)}
                      style={{
                        padding: '2px 5px',
                        fontSize: '9px',
                        fontWeight: 700,
                        borderRadius: '3px',
                        border: progressionSpacing === s.ticks ? '1px solid #ff9900' : '1px solid rgba(255,255,255,0.08)',
                        background: progressionSpacing === s.ticks ? 'rgba(255,153,0,0.2)' : 'transparent',
                        color: progressionSpacing === s.ticks ? '#ff9900' : '#888',
                        cursor: 'pointer',
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {GENRE_PROGRESSIONS.map(prog => (
                  <div
                    key={prog.id}
                    onClick={() => insertGenreProgression(prog)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      border: '1px solid rgba(255,153,0,0.2)',
                      background: 'rgba(255,153,0,0.04)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,153,0,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,153,0,0.04)'}
                  >
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#ffcc00' }}>{prog.name}</div>
                      <div style={{ fontSize: '9px', color: '#888', marginTop: '1px' }}>{prog.description}</div>
                    </div>
                    <span style={{ fontSize: '9px', color: '#ff9900', fontWeight: 700, padding: '2px 6px', borderRadius: '3px', background: 'rgba(255,153,0,0.15)' }}>
                      + Insert
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Algorithmic Diatonic Harmony */}
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Algorithmic Harmony</span>
              {renderGenerationSettings()}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                <button onClick={() => generateDiatonicHarmony('chord')} style={{ ...buttonStyle('#ffcc00'), fontSize: '10px', padding: '6px' }}>
                  Auto-Chords
                </button>
                <button onClick={() => generateDiatonicHarmony('bass')} style={{ ...buttonStyle('#4dabf7'), fontSize: '10px', padding: '6px' }}>
                  Auto-Bass
                </button>
              </div>
              <span style={{ fontSize: '9px', color: '#666', marginTop: '6px', display: 'block', lineHeight: 1.3 }}>
                Select melody notes (or the whole track) and click to generate a perfectly diatonic harmony track.
              </span>
            </div>
          </Section>
        )}

        <Section title="Pattern Clips (Generative)" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '10px' }}>
            {clips.length === 0 && <div style={{ fontSize: '11px', color: '#444' }}>No clips yet.</div>}
            {clips.map(clip => (
              <div key={clip.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '5px 8px', borderRadius: '5px', border: `1px solid ${clip.color}44`, background: `${clip.color}11` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: clip.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '11px', color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.name}</span>
                  <span style={{ fontSize: '10px', color: '#555' }}>{Math.round(clip.startTick / 48)}-{Math.round(clip.endTick / 48)}</span>
                  <button onClick={() => removeClip(clip.id)} style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}>x</button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', borderTop: `1px solid ${clip.color}22`, paddingTop: '4px' }}>
                  <StopPropSelect
                    value={clip.generativeType || 'static'}
                    onChange={e => updateClip(clip.id, { generativeType: e.target.value as any })}
                    style={{ background: '#1e1e2e', color: clip.color, border: `1px solid ${clip.color}44`, borderRadius: '3px', padding: '2px 4px', fontSize: '9px', outline: 'none', flex: 1 }}
                  >
                    <option value="static">Static Block</option>
                    <option value="euclidean">Euclidean Rhythm</option>
                    <option value="random">Chaos / Random</option>
                  </StopPropSelect>

                  {clip.generativeType && clip.generativeType !== 'static' && (
                    <button
                      onClick={() => {
                        generateClipNotes(clip.id, genOverwrite, genPitch, 100, 24)
                        useStore.getState().showToast(`Baked ${clip.generativeType} pattern!`, 'success')
                      }}
                      style={{ background: clip.color, color: '#000', border: 'none', borderRadius: '3px', padding: '2px 6px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      Bake
                    </button>
                  )}
                </div>

                {clip.generativeType && clip.generativeType !== 'static' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                    <SliderRow label="Steps" value={clip.euclideanSteps || 16} min={4} max={64} color={clip.color} onChange={v => updateClip(clip.id, { euclideanSteps: v })} />
                    <SliderRow label="Pulses" value={clip.euclideanPulses || 4} min={1} max={clip.euclideanSteps || 16} color={clip.color} onChange={v => updateClip(clip.id, { euclideanPulses: v })} />
                    <SliderRow label="Rotation" value={clip.euclideanOffset || 0} min={0} max={(clip.euclideanSteps || 16) - 1} color={clip.color} onChange={v => updateClip(clip.id, { euclideanOffset: v })} />
                  </div>
                )}
              </div>
            ))}
            <button onClick={makeClipFromActiveTrack} style={{ marginTop: '4px', padding: '5px', borderRadius: '5px', border: '1px solid rgba(77,171,247,0.3)', background: 'rgba(77,171,247,0.08)', color: '#4dabf7', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
              + Clip from Selection
            </button>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: '#ff9900', fontWeight: 'bold' }}>Generator Settings</span>
            <SliderRow label="Pitch" value={genPitch} min={0} max={127} color="#ff9900" onChange={setGenPitch} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: '#aaa' }}>Overwrite Manual Notes</span>
              <ToggleSwitch checked={genOverwrite} onChange={setGenOverwrite} color="#ff9900" />
            </div>
          </div>
        </Section>

        <Section title="Custom FX Builder" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* Dropdown Selector + New & Delete buttons */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <StopPropSelect
                value={activeCustomFxId}
                onChange={e => setActiveCustomFxId(e.target.value)}
                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '11px', fontWeight: 600, padding: '6px', borderRadius: '6px', outline: 'none' }}
              >
                {customFxConfigs.map(c => (
                  <option key={c.id} value={c.id} style={{ background: '#1a1a24' }}>
                    {c.name}
                  </option>
                ))}
              </StopPropSelect>

              {customFxConfigs.length > 0 && (
                <button
                  onClick={() => {
                    setShowDeleteConfirm(true)
                  }}
                  style={{ ...buttonStyle('#ff3366'), padding: '6px 10px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Delete Custom FX"
                >
                  <IconX size={11} />
                </button>
              )}
            </div>

            {/* Action Buttons in a 2x2 Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>

              <button
                onClick={() => {
                  const newId = `custom-fx-${Date.now()}`
                  const defaultCode = `// --- Custom DSP Effect Template ---
// Available global variables:
// input: Float32Array[] (Incoming audio channels, usually 2 for stereo)
// output: Float32Array[] (Outgoing audio channels)
// params: { [key: string]: number } (Your custom UI slider values)
// state: { [key: string]: any } (Persistent memory across processing blocks)
// sampleRate: number (e.g., 44100 or 48000)
// currentTime: number (AudioWorklet time in seconds)
// context: { trackId, trackName, fxInstanceId, fxType, bpm, blockSize, channelCount }

// 1. Read parameters (with fallbacks)
const wet = params.wet ?? 1.0;

// 2. Initialize persistent state variables (runs once)
if (state.initialized === undefined) {
  state.initialized = true;
  // e.g. state.delayBuffer = new Float32Array(sampleRate);
}

// 3. Process the audio buffer
for (let channel = 0; channel < input.length; channel++) {
  const inData = input[channel];
  const outData = output[channel];
  
  for (let i = 0; i < inData.length; i++) {
    const drySample = inData[i];
    
    // --- YOUR DSP CODE HERE ---
    // Example: simple gain or wave shaping
    let wetSample = drySample;
    
    // 4. Mix dry and wet signals
    outData[i] = drySample * (1 - wet) + wetSample * wet;
  }
}`
                  addCustomFxConfig({
                    id: newId,
                    name: 'New Custom FX',
                    code: defaultCode,
                    params: [
                      { name: 'wet', min: 0, max: 1, defaultVal: 1 }
                    ]
                  })
                  setActiveCustomFxId(newId)
                }}
                style={{ ...buttonStyle('#4dabf7'), padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Create New Custom FX"
              >
                <IconPlus size={11} style={{ marginRight: '4px' }} /> New
              </button>

              <button
                onClick={() => {
                  const newId = `offline-fx-${Date.now()}`
                  const defaultCode = `// --- Offline Buffer FX Template ---\n// Runs during WAV/MP3 export with the full rendered track buffer.\n// This can make non-causal effects because it can read future samples.\n// input/output: Float32Array[] for full channels\n// params: custom slider values\n// state: scratch object for this render\n// sampleRate, duration, currentTime\n// context: { track, notes, project, fx, length, channelCount, clamp }\n\nconst wet = params.wet ?? 0.35;\nconst preDelaySeconds = params.preDelay ?? 0.25;\nconst feedback = params.feedback ?? 0.35;\nconst offset = Math.max(1, Math.floor(preDelaySeconds * sampleRate));\n\nfor (let channel = 0; channel < input.length; channel++) {\n  const inData = input[channel];\n  const outData = output[channel];\n\n  for (let i = 0; i < inData.length; i++) {\n    const future = i + offset < inData.length ? inData[i + offset] : 0;\n    const fartherFuture = i + offset * 2 < inData.length ? inData[i + offset * 2] : 0;\n    const preEcho = future + fartherFuture * feedback;\n    outData[i] = inData[i] + preEcho * wet;\n  }\n}`
                  addCustomFxConfig({
                    id: newId,
                    name: 'New Offline FX',
                    mode: 'offline',
                    code: defaultCode,
                    params: [
                      { name: 'wet', label: 'Wet', min: 0, max: 1, defaultVal: 0.35 },
                      { name: 'preDelay', label: 'Pre Echo', min: 0.01, max: 2, defaultVal: 0.25 },
                      { name: 'feedback', label: 'Feedback', min: 0, max: 0.95, defaultVal: 0.35 }
                    ]
                  })
                  setActiveCustomFxId(newId)
                }}
                style={{ ...buttonStyle('#22d3ee'), padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Create New Offline Buffer FX"
              >
                <IconPlus size={11} style={{ marginRight: '4px' }} /> Offline
              </button>

              <button
                onClick={() => {
                  const ipc = (window as any).ipcRenderer
                  if (ipc) {
                    ipc.invoke('show-open-dialog', {
                      title: 'Import Custom FX File',
                      filters: [
                        { name: 'MuseGrid Custom FX', extensions: ['muzfects', 'json'] },
                        { name: 'All Files', extensions: ['*'] }
                      ]
                    }).then((res: any) => {
                      if (!res) return
                      try {
                        const text = new TextDecoder('utf-8').decode(res.data)
                        const config = JSON.parse(text) as CustomFxConfig
                        if (!config.id || !config.name || !config.code) {
                          throw new Error('Invalid FX Configuration format')
                        }
                        const exists = useStore.getState().customFxConfigs.some(c => c.id === config.id)
                        if (exists) {
                          updateCustomFxConfig(config.id, config)
                        } else {
                          addCustomFxConfig(config)
                        }
                        setActiveCustomFxId(config.id)
                        useStore.getState().showToast(`Imported FX: ${config.name}`, 'success')
                      } catch (err: any) {
                        console.error(err)
                        useStore.getState().showToast(`Failed to import FX: ${err.message || err}`, 'error')
                      }
                    })
                  } else {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = '.muzfects,.json'
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0]
                      if (!file) return
                      try {
                        const text = await file.text()
                        const config = JSON.parse(text) as CustomFxConfig
                        if (!config.id || !config.name || !config.code) {
                          throw new Error('Invalid FX Configuration format')
                        }
                        const exists = useStore.getState().customFxConfigs.some(c => c.id === config.id)
                        if (exists) {
                          updateCustomFxConfig(config.id, config)
                        } else {
                          addCustomFxConfig(config)
                        }
                        setActiveCustomFxId(config.id)
                        useStore.getState().showToast(`Imported FX: ${config.name}`, 'success')
                      } catch (err: any) {
                        console.error(err)
                        useStore.getState().showToast(`Failed to import FX: ${err.message || err}`, 'error')
                      }
                    }
                    input.click()
                  }
                }}
                style={{ ...buttonStyle('#69db7c'), padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Import Custom FX File (.muzfects)"
              >
                <IconOpen size={11} style={{ marginRight: '4px' }} /> Load
              </button>

              {customFxConfigs.length > 0 && (

                <button
                  onClick={() => {
                    const config = customFxConfigs.find(c => c.id === activeCustomFxId)
                    if (!config) return
                    try {
                      const jsonStr = JSON.stringify(config, null, 2)
                      const blob = new Blob([jsonStr], { type: 'application/json' })
                      const safeName = config.name.toLowerCase().replace(/\s+/g, '_') || 'custom_effect'
                      saveFileWithDialog(blob, {
                        filename: `${safeName}.muzfects`,
                        title: 'Save Custom FX Preset',
                        filters: [{ name: 'MuseGrid FX Preset', extensions: ['muzfects'] }]
                      }).then((saved) => {
                        if (saved) useStore.getState().showToast(`Exported FX: ${config.name}`, 'success')
                      })
                    } catch (err) {
                      console.error(err)
                      useStore.getState().showToast('Failed to export FX', 'error')
                    }
                  }}
                  style={{ ...buttonStyle('#ff9900'), padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Export FX File (.muzfects)"
                >
                  <IconSave size={11} style={{ marginRight: '4px' }} /> Save
                </button>

              )}
            </div>

            {/* Config metadata fields */}
            {(() => {
              const config = customFxConfigs.find(c => c.id === activeCustomFxId)
              if (!config) return <div style={{ fontSize: '11px', color: '#555' }}>No active configuration.</div>

              return (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>FX Name</span>
                    <input
                      type="text"
                      value={config.name}
                      onMouseDown={e => e.stopPropagation()}
                      onMouseUp={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => e.stopPropagation()}
                      onChange={e => updateCustomFxConfig(config.id, { name: e.target.value })}
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#eee', fontSize: '11px', padding: '6px 10px', outline: 'none' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>Processing Mode</span>
                    <StopPropSelect
                      value={config.mode ?? 'realtime'}
                      onChange={e => updateCustomFxConfig(config.id, { mode: e.target.value as 'realtime' | 'offline' })}
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#eee', fontSize: '11px', padding: '6px 10px', outline: 'none' }}
                    >
                      <option value="realtime" style={{ background: '#1a1a24' }}>Realtime DSP</option>
                      <option value="offline" style={{ background: '#1a1a24' }}>Offline Buffer FX</option>
                    </StopPropSelect>
                    <span style={{ fontSize: '8px', color: config.mode === 'offline' ? '#22d3ee' : '#666', lineHeight: 1.4 }}>
                      {config.mode === 'offline'
                        ? 'Runs only during WAV/MP3 export and can read future samples.'
                        : 'Runs live as a forward-only AudioWorklet processor.'}
                    </span>
                  </div>

                  {/* Monospace code area */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>
                      {config.mode === 'offline' ? 'Offline Buffer Script' : 'DSP Script'}
                    </span>
                    <textarea
                      value={editorCode}
                      onMouseDown={e => e.stopPropagation()}
                      onMouseUp={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => e.stopPropagation()}
                      spellCheck={false}
                      onChange={e => {
                        const newCode = e.target.value
                        setEditorCode(newCode)
                        try {
                          new Function('input', 'output', 'params', 'state', 'sampleRate', 'duration', 'currentTime', 'context', newCode)
                          setCompileError(null)

                          // Automatically extract parameter names from code (e.g. params.mix or params['mix'])
                          const paramNames: string[] = []
                          const dotRegex = /params\s*\.\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g
                          let match
                          while ((match = dotRegex.exec(newCode)) !== null) {
                            if (!paramNames.includes(match[1])) {
                              paramNames.push(match[1])
                            }
                          }
                          const bracketRegex = /params\s*\[\s*['"`]([a-zA-Z_$][a-zA-Z0-9_$]*)['"`]\s*\]/g
                          while ((match = bracketRegex.exec(newCode)) !== null) {
                            if (!paramNames.includes(match[1])) {
                              paramNames.push(match[1])
                            }
                          }

                          const existingParams = config.params || []
                          const updatedParams = [...existingParams]
                          let changed = false
                          paramNames.forEach(name => {
                            if (!updatedParams.some(p => p.name === name)) {
                              updatedParams.push({ name, label: name, min: 0, max: 1, defaultVal: 0.5 })
                              changed = true
                            }
                          })

                          if (changed) {
                            updateCustomFxConfig(config.id, { code: newCode, params: updatedParams })
                          } else {
                            updateCustomFxConfig(config.id, { code: newCode })
                          }
                        } catch (err: any) {
                          setCompileError(err.message || String(err))
                        }
                      }}
                      style={{
                        background: '#0d0d15',
                        border: `1px solid ${compileError ? '#ff3366' : 'rgba(105,219,124,0.3)'}`,
                        borderRadius: '8px',
                        color: compileError ? '#ff8787' : '#69db7c',
                        fontFamily: 'Consolas, Monaco, monospace',
                        fontSize: '10.5px',
                        padding: '10px',
                        minHeight: '180px',
                        outline: 'none',
                        resize: 'vertical',
                        lineHeight: '1.4'
                      }}
                    />
                  </div>

                  {/* Compile logs console */}
                  <div style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontSize: '9.5px',
                    fontFamily: 'monospace',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    {compileError ? (
                      <>
                        <span style={{ color: '#ff3366', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <IconX size={12} color="#ff3366" /> ERROR:
                        </span>
                        <span style={{ color: '#ff8787', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{compileError}</span>
                      </>
                    ) : (
                      <>
                        <span style={{ color: '#69db7c', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <IconCheck size={12} color="#69db7c" /> SUCCESS:
                        </span>
                        <span style={{ color: config.mode === 'offline' ? '#67e8f9' : '#a6e22e' }}>
                          {config.mode === 'offline' ? 'Offline buffer script syntax valid' : 'JIT DSP processor compiled'}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Parameters editor section */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>Parameters</span>
                      <button
                        onClick={() => {
                          const existingNames = config.params.map(p => p.name)
                          let paramName = 'param1'
                          let counter = 1
                          while (existingNames.includes(paramName)) {
                            counter++
                            paramName = `param${counter}`
                          }
                          const updatedParams = [...config.params, { name: paramName, label: paramName, min: 0, max: 1, defaultVal: 0.5 }]
                          updateCustomFxConfig(config.id, { params: updatedParams })
                        }}
                        style={{ ...buttonStyle('#4dabf7'), padding: '2px 8px', flex: 'none', fontSize: '9px' }}
                      >
                        ＋ Add Parameter
                      </button>
                    </div>
                    <div style={{ fontSize: '8px', color: '#555', marginBottom: '8px', fontStyle: 'italic' }}>
                      Note: The 1st input sets the Slider Label, and the 2nd sets the Variable name in code.
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }} className="thin-scroll">
                      {config.params.map((p, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', padding: '6px 8px', borderRadius: '6px' }}>
                          <input
                            type="text"
                            value={p.label || ''}
                            placeholder="Label"
                            title="Slider Label (Visible Name)"
                            onMouseDown={e => e.stopPropagation()}
                            onMouseUp={e => e.stopPropagation()}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => e.stopPropagation()}
                            onChange={e => {
                              const updatedParams = [...config.params]
                              updatedParams[idx] = { ...p, label: e.target.value }
                              updateCustomFxConfig(config.id, { params: updatedParams })
                            }}
                            style={{ width: '56px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', color: '#eee', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', outline: 'none' }}
                          />
                          <input
                            type="text"
                            value={p.name}
                            placeholder="Variable"
                            title="Variable Name (Used in Code)"
                            onMouseDown={e => e.stopPropagation()}
                            onMouseUp={e => e.stopPropagation()}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => e.stopPropagation()}
                            onChange={e => {
                              const updatedParams = [...config.params]
                              updatedParams[idx] = { ...p, name: e.target.value.replace(/\s+/g, '') }
                              updateCustomFxConfig(config.id, { params: updatedParams })
                            }}
                            style={{ width: '50px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', color: '#bbb', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', outline: 'none' }}
                          />
                          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                            <span style={{ fontSize: '9px', color: '#444' }}>Min</span>
                            <input
                              type="number"
                              value={p.min}
                              step="any"
                              onMouseDown={e => e.stopPropagation()}
                              onMouseUp={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                              onChange={e => {
                                const updatedParams = [...config.params]
                                updatedParams[idx] = { ...p, min: parseFloat(e.target.value) || 0 }
                                updateCustomFxConfig(config.id, { params: updatedParams })
                              }}
                              style={{ width: '38px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', color: '#eee', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', outline: 'none' }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                            <span style={{ fontSize: '9px', color: '#444' }}>Max</span>
                            <input
                              type="number"
                              value={p.max}
                              step="any"
                              onMouseDown={e => e.stopPropagation()}
                              onMouseUp={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                              onChange={e => {
                                const updatedParams = [...config.params]
                                updatedParams[idx] = { ...p, max: parseFloat(e.target.value) || 0 }
                                updateCustomFxConfig(config.id, { params: updatedParams })
                              }}
                              style={{ width: '38px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', color: '#eee', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', outline: 'none' }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                            <span style={{ fontSize: '9px', color: '#444' }}>Def</span>
                            <input
                              type="number"
                              value={p.defaultVal}
                              step="any"
                              onMouseDown={e => e.stopPropagation()}
                              onMouseUp={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                              onChange={e => {
                                const updatedParams = [...config.params]
                                updatedParams[idx] = { ...p, defaultVal: parseFloat(e.target.value) || 0 }
                                updateCustomFxConfig(config.id, { params: updatedParams })
                              }}
                              style={{ width: '46px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', color: '#eee', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', outline: 'none' }}
                            />
                          </div>
                          <button
                            onClick={() => {
                              const updatedParams = config.params.filter((_, i) => i !== idx)
                              updateCustomFxConfig(config.id, { params: updatedParams })
                            }}
                            style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', padding: '2px 4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                            title="Remove Parameter"
                          >
                            <IconX size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Add to Tracks Action button */}
                  <button
                    onClick={() => {
                      addCustomFxToTracks(config.id)
                    }}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '6px',
                      background: 'rgba(77,171,247,0.12)',
                      color: '#4dabf7',
                      border: '1px solid rgba(77,171,247,0.3)',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      marginTop: '6px',
                      textAlign: 'center'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(77,171,247,0.2)'
                      e.currentTarget.style.borderColor = '#4dabf7'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(77,171,247,0.12)'
                      e.currentTarget.style.borderColor = 'rgba(77,171,247,0.3)'
                    }}
                  >
                    Add To Tracks
                  </button>
                </>
              )
            })()}

          </div>
        </Section>

        <Section
          title="VST3 Plugins"
          info={vst3Plugins.length > 0 ? `${vst3Plugins.length} Detected` : "Host"}
          defaultOpen={false}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Header Action Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                disabled={vst3Scanning}
                onClick={() => audioEngine.scanVst3Plugins()}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: vst3Scanning ? 'rgba(0, 230, 255, 0.08)' : '#141724',
                  border: '1px solid rgba(0, 230, 255, 0.35)',
                  borderRadius: '6px',
                  color: '#00e6ff',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  cursor: vst3Scanning ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.15s ease'
                }}
              >
                <IconZap size={13} color="#00e6ff" />
                {vst3Scanning ? 'SCANNING SYSTEM VST3...' : 'SCAN SYSTEM VST3 PLUGINS'}
              </button>

              {vst3ScanStatus && (
                <div style={{ fontSize: '10px', color: '#00e6ff', opacity: 0.8, textAlign: 'center', fontStyle: 'italic' }}>
                  {vst3ScanStatus}
                </div>
              )}

              {/* Search & Filter Tabs */}
              {vst3Plugins.length > 0 && (
                <>
                  <input
                    type="text"
                    placeholder="Search VST3 plugins..."
                    value={vst3Search}
                    onChange={e => setVst3Search(e.target.value)}
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '5px',
                      padding: '6px 10px',
                      color: 'white',
                      fontSize: '11px',
                      outline: 'none'
                    }}
                  />

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                    {(['all', 'instruments', 'fx'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setVst3Filter(tab)}
                        style={{
                          background: vst3Filter === tab ? 'rgba(0, 230, 255, 0.15)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${vst3Filter === tab ? '#00e6ff' : 'rgba(255,255,255,0.06)'}`,
                          color: vst3Filter === tab ? '#00e6ff' : '#888',
                          borderRadius: '4px',
                          padding: '4px',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          textTransform: 'uppercase'
                        }}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Plugin Cards List */}
            {vst3Plugins.length === 0 ? (
              <div style={{
                padding: '16px 12px',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed rgba(255,255,255,0.08)',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                alignItems: 'center'
              }}>
                <IconSliders size={20} color="rgba(255,255,255,0.2)" />
                <div style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>No VST3 plugins cached yet</div>
                <div style={{ fontSize: '10px', color: '#666', lineHeight: 1.4 }}>
                  Click Scan System VST3 to detect all 64-bit instruments (Vital, Serum, etc.) and FX in C:\Program Files\Common Files\VST3.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '340px', overflowY: 'auto' }}>
                {filteredVst3List.map(plugin => {
                  const isActive = (vst3ActivePluginIds || []).some(id => String(id) === String(plugin.uniqueId));
                  const isInst = plugin.isInstrument;
                  const instType = isInst ? getPluginInstrumentType(plugin, vst3DrumTags) : 'synth';
                  const neonColor = !isInst ? '#00ff88' : (instType === 'both' ? '#da77f2' : (instType === 'drum' ? '#ff6b6b' : '#00e6ff'));

                  return (
                    <div
                      key={plugin.uniqueId}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: isActive ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)',
                        border: `1px solid ${isActive ? neonColor + '44' : 'rgba(255,255,255,0.05)'}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                          <span style={{
                            fontSize: '8px',
                            fontWeight: 800,
                            padding: '2px 5px',
                            borderRadius: '3px',
                            background: !isInst ? 'rgba(0, 255, 136, 0.15)' : (instType === 'both' ? 'rgba(218, 119, 242, 0.15)' : (instType === 'drum' ? 'rgba(255, 107, 107, 0.15)' : 'rgba(0, 230, 255, 0.15)')),
                            color: neonColor,
                            letterSpacing: '0.04em'
                          }}>
                            {!isInst ? 'FX' : 'INST'}
                          </span>
                          {isInst && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleVst3DrumTag(plugin.uniqueId);
                              }}
                              style={{
                                fontSize: '8px',
                                fontWeight: 800,
                                padding: '2px 6px',
                                borderRadius: '3px',
                                border: `1px solid ${instType === 'both' ? 'rgba(218, 119, 242, 0.45)' :
                                    instType === 'drum' ? 'rgba(255, 107, 107, 0.45)' :
                                      'rgba(0, 230, 255, 0.45)'
                                  }`,
                                background:
                                  instType === 'both' ? 'rgba(218, 119, 242, 0.18)' :
                                    instType === 'drum' ? 'rgba(255, 107, 107, 0.18)' :
                                      'rgba(0, 230, 255, 0.18)',
                                color:
                                  instType === 'both' ? '#da77f2' :
                                    instType === 'drum' ? '#ff6b6b' :
                                      '#00e6ff',
                                cursor: 'pointer',
                                letterSpacing: '0.04em',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                transition: 'all 0.15s ease'
                              }}
                              title={`Click to cycle instrument category: SYNTH -> DRUM -> BOTH (Current: ${instType.toUpperCase()})`}
                            >
                              {instType === 'both' ? (
                                <>
                                  <IconLayers size={10} color="#da77f2" />
                                  <span>BOTH</span>
                                </>
                              ) : instType === 'drum' ? (
                                <>
                                  <IconDrum size={10} color="#ff6b6b" />
                                  <span>DRUM</span>
                                </>
                              ) : (
                                <>
                                  <IconPiano size={10} color="#00e6ff" />
                                  <span>SYNTH</span>
                                </>
                              )}
                            </button>
                          )}
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {plugin.name}
                          </span>
                        </div>

                        {/* Active toggle */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={() => toggleVst3Active(plugin.uniqueId)}
                            style={{ accentColor: neonColor, cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '9px', fontWeight: 700, color: isActive ? neonColor : '#555' }}>
                            {isActive ? 'ACTIVE' : 'OFF'}
                          </span>
                        </label>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '9px', color: '#666' }}>
                        <span>{plugin.manufacturerName || 'Vendor'} • {plugin.category || (!isInst ? 'Fx' : (instType === 'both' ? 'Hybrid (Both)' : (instType === 'drum' ? 'Drum' : 'Synth')))}</span>
                        <button
                          onClick={() => audioEngine.openStandaloneVst3Editor(plugin.fileOrIdentifier || plugin.uniqueId)}
                          style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: `1px solid ${neonColor}33`,
                            color: neonColor,
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = neonColor + '22'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                          title="Open native plugin editor window directly"
                        >
                          <IconOpen size={9} /> OPEN GUI
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Section>

        <Section title="Groups" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {groups.length === 0 && <div style={{ fontSize: '11px', color: '#444' }}>No groups yet.</div>}
            {groups.map(group => {
              const members = group.trackIds.map(tid => tracks.find(t => t.id === tid)).filter((t): t is NonNullable<typeof t> => Boolean(t))
              const available = tracks.filter(t => !group.trackIds.includes(t.id))
              const groupVolume = group.volume ?? 1
              const isRenaming = editingGroupId === group.id
              return (
                <div key={group.id} style={{ borderRadius: '6px', border: `1px solid ${group.color}33`, background: `${group.color}0a`, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 6px' }}>
                    <button onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })} style={{ background: 'none', border: 'none', color: group.color, cursor: 'pointer', fontSize: '12px', lineHeight: 1, padding: 0, width: '12px' }}>{group.collapsed ? '>' : 'v'}</button>
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={groupNameDraft}
                        onChange={e => setGroupNameDraft(e.target.value)}
                        onBlur={() => {
                          const name = groupNameDraft.trim()
                          if (name) updateGroup(group.id, { name })
                          setEditingGroupId(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') { setEditingGroupId(null); setGroupNameDraft('') }
                        }}
                        style={{ flex: 1, minWidth: 0, background: '#0f1118', border: `1px solid ${group.color}66`, borderRadius: '3px', color: '#eee', fontSize: '11px', fontWeight: 700, padding: '1px 4px', outline: 'none' }}
                      />
                    ) : (
                      <span
                        onDoubleClick={() => { setEditingGroupId(group.id); setGroupNameDraft(group.name) }}
                        title="Double-click to rename"
                        style={{ flex: 1, minWidth: 0, fontSize: '11px', fontWeight: 700, color: group.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'text', textDecoration: group.muted ? 'line-through' : 'none' }}
                      >
                        {group.name}
                      </span>
                    )}
                    <span title={`${group.trackIds.length} track${group.trackIds.length === 1 ? '' : 's'}`} style={{ fontSize: '9px', fontWeight: 700, color: '#555', minWidth: '10px', textAlign: 'right' }}>{group.trackIds.length}</span>
                    <button
                      onClick={() => updateGroup(group.id, { muted: !group.muted })}
                      title={group.muted ? 'Unmute group' : 'Mute group'}
                      style={{ width: '18px', height: '18px', borderRadius: '3px', border: 'none', background: group.muted ? '#ff3366' : '#333', color: 'white', cursor: 'pointer', fontSize: '8px', fontWeight: 700, padding: 0 }}
                    >M</button>
                    <button
                      onClick={() => updateGroup(group.id, { soloed: !group.soloed })}
                      title={group.soloed ? 'Unsolo group' : 'Solo group'}
                      style={{ width: '18px', height: '18px', borderRadius: '3px', border: 'none', background: group.soloed ? '#00e6ff' : '#333', color: 'white', cursor: 'pointer', fontSize: '8px', fontWeight: 700, padding: 0 }}
                    >S</button>
                    <button onClick={() => removeGroup(group.id)} title="Delete group" style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', fontSize: '12px', lineHeight: 1, padding: 0 }}>x</button>
                  </div>
                  {!group.collapsed && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 8px 6px' }}>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#666', width: '22px' }}>VOL</span>
                        <AppSlider value={groupVolume} min={0} max={1} step={0.01} color={group.color} compact onChange={v => updateGroup(group.id, { volume: v })} />
                        <span style={{ fontSize: '9px', color: '#888', width: '28px', textAlign: 'right' }}>{Math.round(groupVolume * 100)}%</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px 6px' }}>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#666', width: '22px' }}>CLR</span>
                        {TRACK_COLORS.map(color => (
                          <button
                            key={color}
                            onClick={() => updateGroup(group.id, { color })}
                            title="Set group color"
                            style={{ width: '12px', height: '12px', borderRadius: '3px', background: color, border: group.color === color ? '1px solid #fff' : '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', padding: 0 }}
                          />
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px 6px' }}>
                        <select
                          value=""
                          onChange={e => {
                            const tid = e.target.value
                            if (tid) updateGroup(group.id, { trackIds: [...group.trackIds, tid] })
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          disabled={available.length === 0}
                          style={{ flex: 1, minWidth: 0, background: '#12141c', border: '1px solid rgba(255,255,255,0.08)', color: available.length ? '#8b92a5' : '#444', fontSize: '10px', padding: '3px 5px', borderRadius: '4px', outline: 'none', colorScheme: 'dark', cursor: available.length ? 'pointer' : 'default' }}
                        >
                          <option value="">{available.length ? '+ Add track to group…' : 'All tracks in group'}</option>
                          {available.map(t => (
                            <option key={t.id} value={t.id} style={{ background: '#12141c', color: '#ccc' }}>{t.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => { if (activeTrackId && !group.trackIds.includes(activeTrackId)) updateGroup(group.id, { trackIds: [...group.trackIds, activeTrackId] }) }}
                          disabled={!activeTrackId || group.trackIds.includes(activeTrackId)}
                          title="Add the active track"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: activeTrackId && !group.trackIds.includes(activeTrackId) ? '#aaa' : '#444', cursor: activeTrackId && !group.trackIds.includes(activeTrackId) ? 'pointer' : 'default', fontSize: '9px', fontWeight: 700, padding: '3px 6px', whiteSpace: 'nowrap' }}
                        >+ ACTIVE</button>
                      </div>
                      {members.map(t => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px 3px 16px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color }} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: '11px', color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                          <button onClick={() => updateGroup(group.id, { trackIds: group.trackIds.filter(id => id !== t.id) })} title="Remove from group" style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '11px', padding: 0 }}>x</button>
                        </div>
                      ))}
                      {members.length === 0 && (
                        <div style={{ padding: '3px 8px 6px 16px', fontSize: '10px', color: '#444' }}>No tracks assigned.</div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
            <button
              onClick={() => {
                const seed = selectedTrackIds.length > 0 ? selectedTrackIds : activeTrackId ? [activeTrackId] : []
                addGroup({ id: newId(), name: `Group ${groups.length + 1}`, color: '#b197fc', trackIds: [...new Set(seed)], collapsed: false })
              }}
              title="New group from selected tracks"
              style={{ marginTop: '4px', padding: '5px', borderRadius: '5px', border: '1px solid rgba(177,151,252,0.3)', background: 'rgba(177,151,252,0.08)', color: '#b197fc', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
            >
              + New Group
            </button>
          </div>
        </Section>
      </div>

      <div
        onMouseDown={() => {
          isDraggingPaneSplit.current = true
          document.body.style.cursor = 'row-resize'
        }}
        title="Resize controls and tracks"
        style={{
          height: (leftPaneTopRatio === 0 || leftPaneTopRatio === 1) ? '0px' : '6px',
          flexShrink: 0,
          cursor: 'row-resize',
          background: 'rgba(255,255,255,0.05)',
          borderTop: (leftPaneTopRatio === 0 || leftPaneTopRatio === 1) ? 'none' : '1px solid rgba(255,255,255,0.05)',
          borderBottom: (leftPaneTopRatio === 0 || leftPaneTopRatio === 1) ? 'none' : '1px solid rgba(0,0,0,0.3)',
          opacity: (leftPaneTopRatio === 0 || leftPaneTopRatio === 1) ? 0 : 1,
          pointerEvents: (leftPaneTopRatio === 0 || leftPaneTopRatio === 1) ? 'none' : 'auto',
          transition: 'height 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1), background 0.2s',
          overflow: 'hidden'
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(77,171,247,0.3)'}
        onMouseLeave={e => !isDraggingPaneSplit.current && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
      />

      <div
        style={{
          flexShrink: 0,
          height: tracksRatio === 0 ? '0px' : tracksRatio === 1 ? '100%' : `calc(${tracksRatio * 100}% - 3px)`,
          opacity: tracksRatio === 0 ? 0 : 1,
          pointerEvents: tracksRatio === 0 ? 'none' : 'auto',
          transition: 'height 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        <div style={{ padding: '10px 20px 6px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' }}>Tracks</span>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', marginTop: '1px' }}>Ctrl + Add to select all tracks</span>
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              <button onClick={(e) => handleAddTrack('synth', undefined, e)} title="Add Synth (Ctrl+Click to select all)" style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', cursor: 'pointer', padding: '3px 8px', fontSize: '11px' }}><IconMusic size={12} /> +</button>
              <button onClick={(e) => handleAddTrack('drum', undefined, e)} title="Add Drum (Ctrl+Click to select all)" style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', cursor: 'pointer', padding: '3px 8px', fontSize: '11px' }}><IconDrum size={12} /> +</button>
              <button onClick={() => handleImportMuzTrack()} title="Import .muztrack (Load track with EDO grid & notes)" style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#69db7c', borderRadius: '4px', cursor: 'pointer', padding: '3px 8px', fontSize: '11px' }}><IconDownload size={12} /> .muz</button>
            </div>
          </div>
        </div>
        {/* Track rendering helper */}
        {(() => {
          const handleDragStart = (e: React.DragEvent, trackId: string, index: number) => {
            const target = e.target as HTMLElement
            if (
              target.tagName === 'SELECT' ||
              target.tagName === 'INPUT' ||
              target.tagName === 'BUTTON' ||
              target.tagName === 'OPTION' ||
              target.closest('select') ||
              target.closest('input') ||
              target.closest('button')
            ) {
              e.preventDefault()
              return
            }
            e.dataTransfer.setData('trackId', trackId)
            e.dataTransfer.setData('index', index.toString())
              ; (e.currentTarget as HTMLElement).style.opacity = '0.4'
          }

          const handleDragEnd = (e: React.DragEvent) => {
            ; (e.currentTarget as HTMLElement).style.opacity = '1'
          }

          const handleDragOver = (e: React.DragEvent) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }

          const handleDrop = (e: React.DragEvent, targetIndex: number, newParentId?: string) => {
            e.preventDefault()
            const sourceIndex = parseInt(e.dataTransfer.getData('index'))

            if (sourceIndex !== targetIndex) {
              const reorderTracks = useStore.getState().reorderTracks
              reorderTracks(sourceIndex, targetIndex, newParentId)
            }
          }

          const renderTrack = (track: any, index: number, isSubtrack = false) => {
            const isActive = activeTrackId === track.id
            const isSelected = selectedTrackIds.includes(track.id)
            const isHighlighted = isActive || isSelected

            const getFXSetting = (inst: any, key: string, fallback: number) => {
              if (track.fxSettings?.[inst.id]?.[key] !== undefined) {
                return track.fxSettings[inst.id][key]
              }
              if (inst.id.endsWith('-default')) {
                let flatKey = inst.type + key.charAt(0).toUpperCase() + key.slice(1)
                if (inst.type === 'eq' && key === 'lowGain') flatKey = 'eqLowGain'
                if (inst.type === 'eq' && key === 'midGain') flatKey = 'eqMidGain'
                if (inst.type === 'eq' && key === 'highGain') flatKey = 'eqHighGain'
                if (inst.type === 'phaser' && key === 'baseFreq') flatKey = 'phaserBaseFreq'

                if (track[flatKey] !== undefined) {
                  return track[flatKey]
                }
              }
              return fallback
            }

            const renderEffectControls = (inst: { id: string, type: string }) => {
              const id = inst.id
              const updateVal = (key: string, value: number) => {
                updateTrackFXSetting(track.id, id, key, value)
              }
              const updateMod = (key: string, mod: FxModulator | null) => {
                updateTrackFXModulator(track.id, id, key, mod)
              }
              const getMod = (key: string) => track.fxModulators?.[id]?.[key]

              switch (inst.type) {
                case 'eq':
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      <SliderRow label="Low EQ" value={getFXSetting(inst, 'lowGain', 0)} min={-12} max={12} step={0.5} suffix="dB" color="#69db7c" onChange={value => updateVal('lowGain', value)} fxModulator={getMod('lowGain')} onFxModulatorChange={m => updateMod('lowGain', m)} />
                      <SliderRow label="Mid EQ" value={getFXSetting(inst, 'midGain', 0)} min={-12} max={12} step={0.5} suffix="dB" color="#ffd43b" onChange={value => updateVal('midGain', value)} fxModulator={getMod('midGain')} onFxModulatorChange={m => updateMod('midGain', m)} />
                      <SliderRow label="High EQ" value={getFXSetting(inst, 'highGain', 0)} min={-12} max={12} step={0.5} suffix="dB" color="#ff8787" onChange={value => updateVal('highGain', value)} fxModulator={getMod('highGain')} onFxModulatorChange={m => updateMod('highGain', m)} />
                    </div>
                  )
                case 'distortion':
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      <SliderRow label="Drive" value={getFXSetting(inst, 'wet', 0)} min={0} max={1} step={0.01} color="#ff6b6b" onChange={value => updateVal('wet', value)} fxModulator={getMod('wet')} onFxModulatorChange={m => updateMod('wet', m)} />
                      <SliderRow label="Grit" value={getFXSetting(inst, 'amount', 0.4)} min={0} max={1} step={0.01} color="#ff6b6b" onChange={value => updateVal('amount', value)} fxModulator={getMod('amount')} onFxModulatorChange={m => updateMod('amount', m)} />
                    </div>
                  )
                case 'chorus':
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      <SliderRow label="Chorus" value={getFXSetting(inst, 'wet', 0)} min={0} max={1} step={0.01} color="#da77f2" onChange={value => updateVal('wet', value)} fxModulator={getMod('wet')} onFxModulatorChange={m => updateMod('wet', m)} />
                      <SliderRow label="C-Rate" value={getFXSetting(inst, 'frequency', 1.5)} min={0.1} max={10} step={0.1} suffix="Hz" color="#da77f2" onChange={value => updateVal('frequency', value)} fxModulator={getMod('frequency')} onFxModulatorChange={m => updateMod('frequency', m)} />
                      <SliderRow label="C-Depth" value={getFXSetting(inst, 'depth', 0.7)} min={0} max={1} step={0.01} color="#da77f2" onChange={value => updateVal('depth', value)} fxModulator={getMod('depth')} onFxModulatorChange={m => updateMod('depth', m)} />
                      <TextInputRow label="C-Delay" value={getFXSetting(inst, 'delayTime', 3.5)} onChange={v => updateVal('delayTime', v)} color="#da77f2" />
                    </div>
                  )
                case 'phaser':
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      <SliderRow label="Phaser" value={getFXSetting(inst, 'wet', 0)} min={0} max={1} step={0.01} color="#00e6ff" onChange={value => updateVal('wet', value)} fxModulator={getMod('wet')} onFxModulatorChange={m => updateMod('wet', m)} />
                      <SliderRow label="P-Rate" value={getFXSetting(inst, 'frequency', 0.5)} min={0.1} max={10} step={0.1} suffix="Hz" color="#00e6ff" onChange={value => updateVal('frequency', value)} fxModulator={getMod('frequency')} onFxModulatorChange={m => updateMod('frequency', m)} />
                      <SliderRow label="P-Oct" value={getFXSetting(inst, 'octaves', 3)} min={1} max={8} step={1} color="#00e6ff" onChange={value => updateVal('octaves', value)} fxModulator={getMod('octaves')} onFxModulatorChange={m => updateMod('octaves', m)} />
                      <TextInputRow label="P-BaseFreq" value={getFXSetting(inst, 'baseFreq', 350)} onChange={v => updateVal('baseFreq', v)} color="#00e6ff" />
                    </div>
                  )
                case 'delay':
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      <SliderRow label="Delay" value={getFXSetting(inst, 'wet', 0)} min={0} max={1} step={0.01} color="#74c0fc" onChange={value => updateVal('wet', value)} fxModulator={getMod('wet')} onFxModulatorChange={m => updateMod('wet', m)} />
                      <SliderRow label="D-Time" value={getFXSetting(inst, 'time', 0.25)} min={0.01} max={2} step={0.01} suffix="s" color="#74c0fc" onChange={value => updateVal('time', value)} fxModulator={getMod('time')} onFxModulatorChange={m => updateMod('time', m)} />
                      <SliderRow label="Feedback" value={getFXSetting(inst, 'feedback', 0.25)} min={0} max={0.9} step={0.01} color="#74c0fc" onChange={value => updateVal('feedback', value)} fxModulator={getMod('feedback')} onFxModulatorChange={m => updateMod('feedback', m)} />
                    </div>
                  )
                case 'dpreverb':
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      <SliderRow label="DPreverb" value={getFXSetting(inst, 'wet', 0)} min={0} max={1} step={0.01} color="#22d3ee" onChange={value => updateVal('wet', value)} />
                      <TextInputRow label="Tail (s)" value={getFXSetting(inst, 'tail', 2)} onChange={v => updateVal('tail', Math.max(0, v))} color="#22d3ee" />
                      <SliderRow label="Shape" value={getFXSetting(inst, 'decay', 0.65)} min={0.05} max={1} step={0.01} color="#5eead4" onChange={value => updateVal('decay', value)} />
                      <SliderRow label="Tone" value={getFXSetting(inst, 'tone', 0.55)} min={0} max={1} step={0.01} color="#67e8f9" onChange={value => updateVal('tone', value)} />
                    </div>
                  )
                case 'reverb':
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      <SliderRow label="Reverb" value={getFXSetting(inst, 'wet', 0)} min={0} max={1} step={0.01} color="#b197fc" onChange={value => updateVal('wet', value)} fxModulator={getMod('wet')} onFxModulatorChange={m => updateMod('wet', m)} />
                      <SliderRow label="R-Decay" value={getFXSetting(inst, 'decay', 2.5)} min={0.1} max={10} step={0.1} suffix="s" color="#b197fc" onChange={value => updateVal('decay', value)} fxModulator={getMod('decay')} onFxModulatorChange={m => updateMod('decay', m)} />
                      <TextInputRow label="R-PreDelay" value={getFXSetting(inst, 'preDelay', 0.01)} onChange={v => updateVal('preDelay', v)} color="#b197fc" />
                      <SliderRow label="R-Damping" value={getFXSetting(inst, 'damping', 0.5)} min={0} max={1} step={0.01} color="#b197fc" onChange={value => updateVal('damping', value)} fxModulator={getMod('damping')} onFxModulatorChange={m => updateMod('damping', m)} />
                    </div>
                  )
                case 'freeverb':
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      <SliderRow label="Freeverb" value={getFXSetting(inst, 'wet', 0)} min={0} max={1} step={0.01} color="#e599f7" onChange={value => updateVal('wet', value)} fxModulator={getMod('wet')} onFxModulatorChange={m => updateMod('wet', m)} />
                      <SliderRow label="F-Room" value={getFXSetting(inst, 'roomSize', 0.7)} min={0} max={1} step={0.01} color="#e599f7" onChange={value => updateVal('roomSize', value)} fxModulator={getMod('roomSize')} onFxModulatorChange={m => updateMod('roomSize', m)} />
                      <SliderRow label="F-Damp" value={getFXSetting(inst, 'dampening', 4000)} min={0} max={20000} step={100} suffix="Hz" color="#e599f7" onChange={value => updateVal('dampening', value)} fxModulator={getMod('dampening')} onFxModulatorChange={m => updateMod('dampening', m)} />
                    </div>
                  )
                case 'vst3': {
                  const isBypassed = track.fxSettings?.[id]?.['bypassed'] === 1;
                  const wet = getFXSetting(inst, 'wet', 0.4);
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' }} onMouseDown={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <button
                          onClick={() => {
                            const newBypassed = !isBypassed;
                            updateVal('bypassed', newBypassed ? 1 : 0);
                            audioEngine.setTrackVst3FxBypass(track.id, id, newBypassed);
                          }}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: `1px solid ${isBypassed ? '#ff3366' : '#00ff88'}`,
                            background: isBypassed ? 'rgba(255, 51, 102, 0.15)' : 'rgba(0, 255, 136, 0.15)',
                            color: isBypassed ? '#ff3366' : '#00ff88',
                            fontSize: '9px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Toggle FX Bypass"
                        >
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isBypassed ? '#ff3366' : '#00ff88' }} />
                          {isBypassed ? 'BYPASSED' : 'PWR ON'}
                        </button>

                        <button
                          onClick={() => audioEngine.openVst3FxEditor(track.id, id)}
                          style={{
                            flex: 1,
                            padding: '6px 12px',
                            background: '#12141c',
                            border: '1px solid rgba(0, 255, 136, 0.4)',
                            borderRadius: '5px',
                            color: '#00ff88',
                            fontSize: '10px',
                            fontWeight: 800,
                            letterSpacing: '0.06em',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(0, 255, 136, 0.12)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = '#12141c'
                          }}
                          title="Open Genuine Native VST3 Editor Window"
                        >
                          <IconOpen size={11} color="#00ff88" />
                          OPEN VST3 GUI
                        </button>
                      </div>

                      <SliderRow
                        label="Mix (Wet)"
                        value={wet}
                        min={0}
                        max={1}
                        step={0.01}
                        color="#00ff88"
                        onChange={value => {
                          updateVal('wet', value);
                          audioEngine.setTrackVst3FxWet(track.id, id, value);
                        }}
                      />
                    </div>
                  );
                }
                default: {
                  const config = customFxConfigs.find(c => c.id === inst.type)
                  if (!config) return null
                  const customColor = config.mode === 'offline' ? '#22d3ee' : '#74c0fc'
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} onMouseDown={e => e.stopPropagation()}>
                      {config.params.map(p => (
                        <SliderRow
                          key={p.name}
                          label={p.label || p.name}
                          value={getFXSetting(inst, p.name, p.defaultVal)}
                          min={p.min}
                          max={p.max}
                          step={p.max - p.min <= 2 ? 0.01 : 0.1}
                          color={customColor}
                          onChange={value => updateVal(p.name, value)}
                          fxModulator={getMod(p.name)}
                          onFxModulatorChange={m => updateMod(p.name, m)}
                        />
                      ))}
                    </div>
                  )
                }
              }
            }

            return (
              <div
                key={track.id}
                draggable={editingTrackId !== track.id}
                onDragStart={(e) => handleDragStart(e, track.id, index)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index, track.parentId)}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    toggleTrackSelection(track.id, true)
                  } else {
                    setActiveTrackId(track.id)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (selectedTrackIds.includes(track.id) && selectedTrackIds.length > 1) {
                    setContextMenu({ x: e.clientX, y: e.clientY, trackId: track.id, mode: 'main', isMultiSelect: true });
                  } else {
                    // Right clicking unselected track switches selection to just it, or just sets it as active context
                    if (!selectedTrackIds.includes(track.id)) {
                      setActiveTrackId(track.id);
                    }
                    setContextMenu({ x: e.clientX, y: e.clientY, trackId: track.id, mode: 'main' });
                  }
                }}
                style={{
                  background: isHighlighted ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: `1px solid ${isHighlighted ? track.color + (isActive ? '88' : '55') : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '8px',
                  padding: isSubtrack ? '8px 10px' : '10px',
                  marginBottom: isSubtrack ? '6px' : '8px',
                  cursor: 'grab',
                  width: isSubtrack ? 'calc(100% - 2px)' : '100%',
                  transition: 'opacity 0.2s, filter 0.2s',
                  filter: track.hidden ? 'grayscale(100%) opacity(50%)' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: (track.collapsed) ? '0' : '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); updateTrack(track.id, { collapsed: !track.collapsed }) }}
                      style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                    >
                      {track.collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: track.color }}>
                      {track.instrument === 'synth' ? <IconMusic size={12} /> : <IconDrum size={12} />}
                      <span style={{ fontWeight: 600, fontSize: isSubtrack ? '12px' : '13px', flex: 1 }}>
                        {editingTrackId === track.id ? (
                          <input
                            autoFocus
                            defaultValue={track.name}
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                            onMouseUp={e => e.stopPropagation()}
                            onBlur={e => { updateTrack(track.id, { name: e.target.value || track.name }); setEditingTrackId(null) }}
                            onKeyDown={e => {
                              e.stopPropagation()
                              if (e.key === 'Enter') { updateTrack(track.id, { name: e.currentTarget.value || track.name }); setEditingTrackId(null) }
                              if (e.key === 'Escape') setEditingTrackId(null)
                            }}
                            style={{ background: 'transparent', border: 'none', color: track.color, fontWeight: 600, fontSize: isSubtrack ? '12px' : '13px', width: '100%', outline: 'none' }}
                          />
                        ) : (
                          <span onDoubleClick={e => { e.stopPropagation(); setEditingTrackId(track.id) }}>{track.name}</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={e => { e.stopPropagation(); updateTrack(track.id, { muted: !track.muted }) }} style={{ width: '22px', height: '22px', borderRadius: '4px', border: 'none', background: track.muted ? '#ff3366' : '#333', color: 'white', cursor: 'pointer', fontSize: '9px', fontWeight: 700 }}>M</button>
                    <button onClick={e => { e.stopPropagation(); updateTrack(track.id, { soloed: !track.soloed }) }} style={{ width: '22px', height: '22px', borderRadius: '4px', border: 'none', background: track.soloed ? '#00e6ff' : '#333', color: 'white', cursor: 'pointer', fontSize: '9px', fontWeight: 700 }}>S</button>
                    <div style={{ position: 'relative', width: '22px', height: '22px' }}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setContextMenu({ x: rect.left, y: rect.bottom + 4, trackId: track.id, mode: 'loop' });
                        }}
                        style={{ position: 'absolute', inset: 0, background: '#333', color: 'white', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                      >
                        <IconLoop size={12} color="white" />
                      </button>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        audioEngine.allNotesOff(track.id);
                        useStore.getState().showToast(`Sent Note-Off to ${track.name}`, 'info');
                      }}
                      style={{
                        width: '26px',
                        height: '22px',
                        borderRadius: '4px',
                        border: '1px solid rgba(255, 77, 77, 0.4)',
                        background: 'rgba(255, 77, 77, 0.14)',
                        color: '#ff6b6b',
                        cursor: 'pointer',
                        fontSize: '8px',
                        fontWeight: 800,
                        letterSpacing: '0.02em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255, 77, 77, 0.3)';
                        e.currentTarget.style.borderColor = '#ff4d4d';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255, 77, 77, 0.14)';
                        e.currentTarget.style.borderColor = 'rgba(255, 77, 77, 0.4)';
                      }}
                      title="Kill / Note-Off: Stop all sounding or hanging notes on this track"
                    >
                      OFF
                    </button>
                  </div>
                </div>
                {!track.collapsed && (
                  <>
                    <SliderRow label="Vol" value={track.volume} min={0} max={1} step={0.01} color={track.color} onChange={value => updateTrack(track.id, { volume: value })} />
                    {isActive && (
                      <div onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => e.stopPropagation()}
                          onDragStart={e => e.stopPropagation()}
                          style={{ marginBottom: '8px' }}
                        >
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{track.instrument === 'drum' ? 'Kit' : 'Sound'}</span>
                          {track.instrument !== 'drum' ? (
                            <>
                              <StopPropSelect
                                value={track.vst3InstrumentId ? `vst3:${track.vst3InstrumentId}` : (track.synthPreset ?? DEFAULT_SYNTH_PRESET)}
                                onChange={e => {
                                  const val = e.target.value
                                  if (val.startsWith('vst3:')) {
                                    const pluginId = val.slice(5)
                                    const plugin = vst3Plugins.find(p => p.uniqueId === pluginId || p.fileOrIdentifier === pluginId || p.name === pluginId)
                                    const targetPluginIdentifier = plugin?.fileOrIdentifier || plugin?.uniqueId || pluginId
                                    commitHistory()
                                    updateTrack(track.id, {
                                      instrument: 'synth',
                                      vst3InstrumentId: targetPluginIdentifier,
                                      vst3InstrumentName: plugin?.name || 'VST3 Instrument',
                                      synthPreset: 'custom'
                                    })
                                    audioEngine.setTrackVst3Instrument(track.id, targetPluginIdentifier)
                                    useStore.getState().showToast(`Loaded VST3: ${plugin?.name || targetPluginIdentifier}`, 'success')
                                    return
                                  }
                                  if (track.vst3InstrumentId || track.instrument === 'vst3') {
                                    updateTrack(track.id, {
                                      instrument: 'synth',
                                      vst3InstrumentId: undefined,
                                      vst3InstrumentName: undefined
                                    })
                                    audioEngine.removeTrackVst3Instrument(track.id)
                                  }
                                  if (val === 'import-muzins') {
                                    const input = document.createElement('input')
                                    input.type = 'file'
                                    input.accept = '.muzins'
                                    input.onchange = (evt: any) => {
                                      const file = evt.target.files?.[0]
                                      if (file) {
                                        const reader = new FileReader()
                                        reader.onload = (re: any) => {
                                          try {
                                            const parsed = JSON.parse(re.target.result)
                                            if (parsed && parsed.name && parsed.engineType && parsed.config) {
                                              if (track.synthPreset === 'physical' && parsed.engineType !== 'physical') {
                                                useStore.getState().showToast('This instrument is not physically modeled. Turn off the Physical Modeling engine to import it.', 'error')
                                                return
                                              }
                                              commitHistory()
                                              if (parsed.engineType === 'physical') {
                                                updateTrack(track.id, {
                                                  synthPreset: 'physical',
                                                  ...parsed.config
                                                })
                                                setTimeout(() => {
                                                  audioEngine.createInstrument(track.id, 'synth')
                                                }, 50)
                                              } else {
                                                updateTrack(track.id, {
                                                  synthPreset: 'custom',
                                                  customMuxins: parsed
                                                })
                                              }
                                              useStore.getState().showToast(`Loaded Custom Instrument: ${parsed.name}`, 'success')
                                            } else {
                                              useStore.getState().showToast('Invalid .muzins file format', 'error')
                                            }
                                          } catch {
                                            useStore.getState().showToast('Failed to parse .muzins file', 'error')
                                          }
                                        }
                                        reader.readAsText(file)
                                      }
                                    }
                                    input.click()
                                  } else {
                                    updateTrack(track.id, { synthPreset: val as SynthPreset })
                                  }
                                }}
                                style={{ width: '100%', background: '#12141c', color: '#00e6ff', border: '1px solid rgba(0, 230, 255, 0.25)', borderRadius: '4px', padding: '5px', fontSize: '11px', outline: 'none' }}
                              >
                                {vst3ActiveSynthInstruments.length > 0 && (
                                  <optgroup label="── VST3 SYNTH INSTRUMENTS ──" style={{ background: '#0a0b10', color: '#00e6ff', fontWeight: 800 }}>
                                    {vst3ActiveSynthInstruments.map(plugin => (
                                      <option key={plugin.uniqueId} value={`vst3:${plugin.fileOrIdentifier || plugin.uniqueId}`} style={{ background: '#12141c', color: '#00e6ff' }}>
                                        {plugin.name} {getPluginInstrumentType(plugin, vst3DrumTags) === 'both' ? '(Hybrid)' : '(VST3)'}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {track.vst3InstrumentId && !vst3ActiveSynthInstruments.some(p => String(p.fileOrIdentifier || p.uniqueId) === String(track.vst3InstrumentId) || String(p.uniqueId) === String(track.vst3InstrumentId)) && (
                                  <optgroup label="── CURRENT VST3 SYNTH ──" style={{ background: '#0a0b10', color: '#00e6ff', fontWeight: 800 }}>
                                    <option value={`vst3:${track.vst3InstrumentId}`} style={{ background: '#12141c', color: '#00e6ff' }}>
                                      {track.vst3InstrumentName || 'Active VST3 Synth'} (Active)
                                    </option>
                                  </optgroup>
                                )}
                                <optgroup label="── DEFAULT SOUNDS ──" style={{ background: '#0a0b10', color: '#888', fontWeight: 800 }}>
                                  {track.synthPreset === 'physical' ? (
                                    <>
                                      <option value="physical" style={{ background: '#12141c', color: '#e0e0e0' }}>Physically Modeled</option>
                                      <option value="import-muzins" style={{ background: '#12141c', color: '#e0e0e0' }}>Load from Device (.muzins)...</option>
                                    </>
                                  ) : (
                                    <>
                                      {SYNTH_PRESETS.filter(preset => preset.value !== 'physical').map(preset => (
                                        <option key={preset.value} value={preset.value} style={{ background: '#12141c', color: '#e0e0e0' }}>{preset.label}</option>
                                      ))}
                                      {track.customMuxins && (
                                        <option value="custom" style={{ background: '#12141c', color: '#e0e0e0' }}>Custom: {track.customMuxins.name}</option>
                                      )}
                                      <option value="import-muzins" style={{ background: '#12141c', color: '#e0e0e0' }}>Load from Device (.muzins)...</option>
                                    </>
                                  )}
                                </optgroup>
                              </StopPropSelect>
                              {track.vst3InstrumentId && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    audioEngine.openVst3InstrumentEditor(track.id)
                                  }}
                                  style={{
                                    width: '100%',
                                    marginTop: '6px',
                                    padding: '7px 10px',
                                    background: '#12141c',
                                    color: '#00e6ff',
                                    border: '1px solid rgba(0, 230, 255, 0.4)',
                                    borderRadius: '6px',
                                    fontSize: '10px',
                                    fontWeight: 800,
                                    letterSpacing: '0.05em',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(0, 230, 255, 0.12)'
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#12141c'
                                  }}
                                  title="Open genuine native VST3 plugin interface"
                                >
                                  <IconOpen size={12} color="#00e6ff" />
                                  OPEN VST3 GUI [{track.vst3InstrumentName || 'PLUGIN'}]
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  useStore.getState().setActiveTrackId(track.id)
                                  useStore.getState().setIsSynthStudioModalVisible(true)
                                }}
                                style={{
                                  width: '100%',
                                  marginTop: '6px',
                                  padding: '7px 8px',
                                  background: '#12141c',
                                  color: '#4dabf7',
                                  border: '1px solid rgba(77, 171, 247, 0.35)',
                                  borderRadius: '6px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  letterSpacing: '0.04em',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(77, 171, 247, 0.12)'
                                  e.currentTarget.style.borderColor = '#4dabf7'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = '#12141c'
                                  e.currentTarget.style.borderColor = 'rgba(77, 171, 247, 0.35)'
                                }}
                                title="Open Synthesizer Studio"
                              >
                                <IconSliders size={12} color="#4dabf7" />
                                OPEN SYNTH STUDIO
                              </button>
                            </>
                          ) : (
                            <>
                              <StopPropSelect
                                value={track.vst3InstrumentId ? `vst3:${track.vst3InstrumentId}` : (track.drumKit ?? DEFAULT_DRUM_KIT)}
                                onChange={e => {
                                  const val = e.target.value
                                  if (val.startsWith('vst3:')) {
                                    const pluginId = val.slice(5)
                                    const plugin = vst3Plugins.find(p => p.uniqueId === pluginId || p.fileOrIdentifier === pluginId || p.name === pluginId)
                                    const targetPluginIdentifier = plugin?.fileOrIdentifier || plugin?.uniqueId || pluginId
                                    commitHistory()
                                    updateTrack(track.id, {
                                      instrument: 'drum',
                                      vst3InstrumentId: targetPluginIdentifier,
                                      vst3InstrumentName: plugin?.name || 'VST3 Drum Instrument'
                                    })
                                    audioEngine.setTrackVst3Instrument(track.id, targetPluginIdentifier)
                                    useStore.getState().showToast(`Loaded Drum VST3: ${plugin?.name || targetPluginIdentifier}`, 'success')
                                    return
                                  }
                                  if (track.vst3InstrumentId) {
                                    updateTrack(track.id, {
                                      instrument: 'drum',
                                      vst3InstrumentId: undefined,
                                      vst3InstrumentName: undefined
                                    })
                                    audioEngine.removeTrackVst3Instrument(track.id)
                                  }
                                  if (val === 'import-muzins') {
                                    const input = document.createElement('input')
                                    input.type = 'file'
                                    input.accept = '.muzins'
                                    input.onchange = (evt: any) => {
                                      const file = evt.target.files?.[0]
                                      if (file) {
                                        const reader = new FileReader()
                                        reader.onload = (re: any) => {
                                          try {
                                            const parsed = JSON.parse(re.target.result)
                                            if (parsed && parsed.name && parsed.engineType === 'DrumKit' && parsed.config) {
                                              commitHistory()
                                              const cfg = parsed.config
                                              updateTrack(track.id, {
                                                drumKit: 'custom',
                                                customMuxins: parsed,
                                                drumDecays: cfg.decays || track.drumDecays,
                                                drumPadModes: cfg.padModes || track.drumPadModes,
                                                drumPadSamples: cfg.padSamples || track.drumPadSamples
                                              })
                                              if (cfg.padModes) {
                                                Object.entries(cfg.padModes).forEach(([pStr, mode]) => {
                                                  audioEngine.setDrumPadMode(track.id, parseInt(pStr), mode as any)
                                                })
                                              }
                                              if (cfg.padSamples) {
                                                Object.entries(cfg.padSamples).forEach(([pStr, s]) => {
                                                  audioEngine.setDrumPadSample(track.id, parseInt(pStr), s as any)
                                                })
                                              }
                                              useStore.getState().showToast(`Loaded Custom Drum Kit: ${parsed.name}`, 'success')
                                            } else {
                                              useStore.getState().showToast('Invalid .muzins Drum Kit format', 'error')
                                            }
                                          } catch {
                                            useStore.getState().showToast('Failed to parse .muzins Drum Kit file', 'error')
                                          }
                                        }
                                        reader.readAsText(file)
                                      }
                                    }
                                    input.click()
                                  } else {
                                    updateTrack(track.id, { drumKit: val as DrumKit })
                                  }
                                }}
                                style={{ width: '100%', background: '#12141c', color: '#ff6b6b', border: '1px solid rgba(255, 107, 107, 0.25)', borderRadius: '4px', padding: '5px', fontSize: '11px', outline: 'none' }}
                              >
                                {vst3ActiveDrumInstruments.length > 0 && (
                                  <optgroup label="── VST3 DRUM INSTRUMENTS ──" style={{ background: '#0a0b10', color: '#ff6b6b', fontWeight: 800 }}>
                                    {vst3ActiveDrumInstruments.map(plugin => (
                                      <option key={plugin.uniqueId} value={`vst3:${plugin.fileOrIdentifier || plugin.uniqueId}`} style={{ background: '#12141c', color: '#ff6b6b' }}>
                                        {plugin.name} {getPluginInstrumentType(plugin, vst3DrumTags) === 'both' ? '(Hybrid)' : '(VST3 Drum)'}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {track.vst3InstrumentId && !vst3ActiveDrumInstruments.some(p => String(p.fileOrIdentifier || p.uniqueId) === String(track.vst3InstrumentId) || String(p.uniqueId) === String(track.vst3InstrumentId)) && (
                                  <optgroup label="── CURRENT VST3 DRUM ──" style={{ background: '#0a0b10', color: '#ff6b6b', fontWeight: 800 }}>
                                    <option value={`vst3:${track.vst3InstrumentId}`} style={{ background: '#12141c', color: '#ff6b6b' }}>
                                      {track.vst3InstrumentName || 'Active VST3 Drum'} (Active)
                                    </option>
                                  </optgroup>
                                )}
                                <optgroup label="── BUILT-IN DRUM KITS ──" style={{ background: '#0a0b10', color: '#888', fontWeight: 800 }}>
                                  {DRUM_KITS.map(kit => <option key={kit.value} value={kit.value} style={{ background: '#12141c', color: '#e0e0e0' }}>{kit.label}</option>)}
                                  {track.customMuxins && (
                                    <option value="custom" style={{ background: '#12141c', color: '#e0e0e0' }}>Custom: {track.customMuxins.name}</option>
                                  )}
                                  <option value="import-muzins" style={{ background: '#12141c', color: '#e0e0e0' }}>Load from Device (.muzins)...</option>
                                </optgroup>
                              </StopPropSelect>
                              {track.vst3InstrumentId && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    audioEngine.openVst3InstrumentEditor(track.id)
                                  }}
                                  style={{
                                    width: '100%',
                                    marginTop: '6px',
                                    padding: '7px 10px',
                                    background: '#12141c',
                                    color: '#ff6b6b',
                                    border: '1px solid rgba(255, 107, 107, 0.4)',
                                    borderRadius: '6px',
                                    fontSize: '10px',
                                    fontWeight: 800,
                                    letterSpacing: '0.05em',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 107, 107, 0.12)'
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#12141c'
                                  }}
                                  title="Open genuine native VST3 drum plugin interface"
                                >
                                  <IconOpen size={12} color="#ff6b6b" />
                                  OPEN VST3 GUI [{track.vst3InstrumentName || 'DRUM PLUGIN'}]
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  useStore.getState().setActiveTrackId(track.id)
                                  useStore.getState().setIsDrumDesignerModalVisible(true)
                                }}
                                style={{
                                  width: '100%',
                                  marginTop: '6px',
                                  padding: '7px 8px',
                                  background: '#12141c',
                                  color: '#ff6b6b',
                                  border: '1px solid rgba(255, 77, 77, 0.35)',
                                  borderRadius: '6px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  letterSpacing: '0.04em',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(255, 77, 77, 0.12)'
                                  e.currentTarget.style.borderColor = '#ff6b6b'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = '#12141c'
                                  e.currentTarget.style.borderColor = 'rgba(255, 77, 77, 0.35)'
                                }}
                                title="Open Drum Studio"
                              >
                                <IconDrum size={12} color="#ff6b6b" />
                                OPEN 16-PAD DRUM DESIGNER
                              </button>
                            </>
                          )}
                        </div>

                        {!isSubtrack && (
                          <>
                            <div style={{ marginBottom: '8px' }}>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>Color</span>
                              <div
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                                onDragStart={e => e.stopPropagation()}
                                style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '4px' }}
                              >
                                {TRACK_COLORS.map(color => (
                                  <button
                                    key={color}
                                    onClick={() => updateTrack(track.id, { color })}
                                    title={color}
                                    style={{ height: '18px', borderRadius: '4px', border: `1px solid ${track.color === color ? '#fff' : 'rgba(255,255,255,0.18)'}`, background: color, cursor: 'pointer' }}
                                  />
                                ))}
                                <div style={{ position: 'relative', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', border: `1px solid ${!TRACK_COLORS.includes(track.color) ? '#fff' : 'rgba(255,255,255,0.08)'}`, cursor: 'pointer' }} title="Custom Color">
                                  <input
                                    type="color"
                                    value={TRACK_COLORS.includes(track.color) ? '#ffffff' : track.color}
                                    onChange={e => updateTrack(track.id, { color: e.target.value })}
                                    style={{ position: 'absolute', opacity: 0, inset: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 1 }}
                                  />
                                  <IconPalette size={11} style={{ color: !TRACK_COLORS.includes(track.color) ? track.color : '#555' }} />
                                </div>
                              </div>
                            </div>
                            <SliderRow label="Pan" value={track.pan} min={-1} max={1} step={0.01} color={track.color} onChange={value => updateTrack(track.id, { pan: value })} />
                            {track.instrument === 'synth' && (
                              <SliderRow label="Transpose" value={track.transpose ?? 0} min={-24} max={24} step={1} suffix="st" color="#ffcc00" onChange={value => updateTrack(track.id, { transpose: value })} />
                            )}
                            {track.instrument === 'drum' && (
                              <>
                                <SliderRow label="Kit Transpose" value={track.transpose ?? 0} min={-24} max={24} step={1} suffix="st" color="#ffcc00" onChange={value => updateTrack(track.id, { transpose: value })} />
                                <SliderRow label="Map Cycle" value={track.drumMapShift ?? 0} min={0} max={4} step={1} color="#ff9900" onChange={value => updateTrack(track.id, { drumMapShift: value })} />
                              </>
                            )}
                            <details style={{ marginTop: '8px', marginBottom: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <summary style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none', outline: 'none' }}>
                                ▶ Effects Signal Chain
                              </summary>
                              <div style={{ marginTop: '8px' }}>
                                {Boolean((window as any).__isJuceNative__) && getTrackFxInstances(track.fxInstances).some(inst => inst.type !== 'custom-bitcrusher' && customFxConfigs.some(c => c.id === inst.type)) && (
                                  <div style={{ fontSize: '9px', color: '#ffcc00', lineHeight: 1.4, marginBottom: '6px' }}>
                                    Custom JS effects only run in the browser engine. The native engine skips those steps; built-in and VST3 steps still apply in order.
                                  </div>
                                )}
                                {(() => {
                                  const currentFxInstances = getTrackFxInstances(track.fxInstances)
                                  const displayInstances = [...currentFxInstances].reverse()

                                  return (
                                    <div style={{ display: 'flex', position: 'relative', marginTop: '4px' }} onDragOver={e => e.preventDefault()}>
                                      {/* Signal flow visual indicator */}
                                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '20px', marginRight: '8px', position: 'relative', userSelect: 'none' }}>
                                        <div style={{ position: 'absolute', top: '10px', bottom: '10px', width: '0', borderLeft: '1px dotted rgba(255, 255, 255, 0.15)' }} />
                                        <div style={{ color: 'rgba(255, 255, 255, 0.25)', fontSize: '7.5px', zIndex: 1, background: '#1a1a24', padding: '4px 0', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 800, letterSpacing: '0.12em', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                          SIGNAL FLOW ▲
                                        </div>
                                      </div>

                                      {/* Dynamic FX panels */}
                                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {displayInstances.map((inst, displayIdx) => {
                                          const isDragging = draggingIndex === displayIdx


                                          const fxInfoMap: Record<string, { label: string; color: string }> = {
                                            eq: { label: 'EQ (Equalizer)', color: '#69db7c' },
                                            distortion: { label: 'Distortion (Drive)', color: '#ff6b6b' },
                                            chorus: { label: 'Chorus', color: '#da77f2' },
                                            phaser: { label: 'Phaser', color: '#00e6ff' },
                                            delay: { label: 'Delay (Echo)', color: '#74c0fc' },
                                            dpreverb: { label: 'DPreverb (Pre-Wash)', color: '#22d3ee' },
                                            reverb: { label: 'Reverb (Space)', color: '#b197fc' },
                                            freeverb: { label: 'Freeverb (Live Space)', color: '#e599f7' }
                                          }
                                          const customConfig = customFxConfigs.find(c => c.id === inst.type)
                                          let fxInfo = fxInfoMap[inst.type] || {
                                            label: customConfig ? customConfig.name : inst.type,
                                            color: customConfig?.mode === 'offline' ? '#22d3ee' : '#74c0fc'
                                          }
                                          if (inst.type === 'vst3') {
                                            fxInfo = {
                                              label: (inst as any).pluginName ? `${(inst as any).pluginName} (VST3)` : 'VST3 Effect',
                                              color: '#00ff88'
                                            }
                                          }
                                          const isOver = dragOverIndex === displayIdx
                                          const isCardBypassed = track.fxSettings?.[inst.id]?.["bypassed"] === 1 || (track as any)[`${inst.type}Bypassed`] === 1



                                          return (
                                            <div
                                              key={inst.id}
                                              draggable
                                              onDragStart={(e) => {
                                                setDraggingIndex(displayIdx)
                                                e.dataTransfer.effectAllowed = 'move'
                                                e.stopPropagation()
                                              }}
                                              onDragOver={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                if (dragOverIndex !== displayIdx) {
                                                  setDragOverIndex(displayIdx)
                                                }
                                              }}
                                              onDragLeave={(e) => {
                                                e.stopPropagation()
                                                if (dragOverIndex === displayIdx) {
                                                  setDragOverIndex(null)
                                                }
                                              }}
                                              onDrop={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                if (draggingIndex !== null && draggingIndex !== displayIdx) {
                                                  const srcIdx = (currentFxInstances.length - 1) - draggingIndex
                                                  const destIdx = (currentFxInstances.length - 1) - displayIdx
                                                  reorderTrackFX(track.id, srcIdx, destIdx)
                                                }
                                                setDraggingIndex(null)
                                                setDragOverIndex(null)
                                              }}
                                              onDragEnd={(e) => {
                                                e.stopPropagation()
                                                setDraggingIndex(null)
                                                setDragOverIndex(null)
                                              }}
                                              style={{
                                                background: isOver
                                                  ? 'rgba(77, 171, 247, 0.12)'
                                                  : isDragging
                                                    ? 'rgba(255, 255, 255, 0.01)'
                                                    : isCardBypassed
                                                      ? 'rgba(15, 17, 24, 0.45)'
                                                      : 'rgba(255, 255, 255, 0.02)',
                                                border: `1px solid ${isOver ? '#4dabf7' : isCardBypassed ? 'rgba(255, 51, 102, 0.25)' : 'rgba(255, 255, 255, 0.05)'}`,
                                                borderRadius: '6px',
                                                padding: '8px 10px 10px',
                                                opacity: isDragging ? 0.4 : isCardBypassed ? 0.6 : 1,
                                                transition: 'all 0.15s ease',
                                                cursor: 'grab'
                                              }}
                                            >
                                              {/* Header block with drag handle and action buttons */}
                                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', userSelect: 'none' }} onMouseDown={e => e.stopPropagation()}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                  <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '10px', fontWeight: 'bold', cursor: 'grab' }}>⋮⋮</span>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const nextBypassed = !isCardBypassed;
                                                      updateTrackFXSetting(track.id, inst.id, 'bypassed', nextBypassed ? 1 : 0);
                                                      if (inst.type === 'vst3') {
                                                        audioEngine.setTrackVst3FxBypass(track.id, inst.id, nextBypassed);
                                                      }
                                                    }}
                                                    title={isCardBypassed ? `Turn ${fxInfo.label} ON` : `Bypass ${fxInfo.label} (Turn OFF)`}
                                                    style={{
                                                      padding: '2px 6px',
                                                      borderRadius: '3px',
                                                      border: `1px solid ${isCardBypassed ? '#ff3366' : '#00ff88'}`,
                                                      background: isCardBypassed ? 'rgba(255, 51, 102, 0.15)' : 'rgba(0, 255, 136, 0.15)',
                                                      color: isCardBypassed ? '#ff3366' : '#00ff88',
                                                      fontSize: '8px',
                                                      fontWeight: 800,
                                                      cursor: 'pointer',
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '3px',
                                                      lineHeight: '1',
                                                      transition: 'all 0.15s ease',
                                                      boxShadow: isCardBypassed ? 'none' : '0 0 6px rgba(0, 255, 136, 0.2)'
                                                    }}
                                                  >
                                                    <span style={{
                                                      width: '5px',
                                                      height: '5px',
                                                      borderRadius: '50%',
                                                      background: isCardBypassed ? '#ff3366' : '#00ff88',
                                                      boxShadow: `0 0 5px ${isCardBypassed ? '#ff3366' : '#00ff88'}`
                                                    }} />
                                                    {isCardBypassed ? 'OFF' : 'ON'}
                                                  </button>
                                                  <span style={{
                                                    fontSize: '9px',
                                                    fontWeight: 800,
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.05em',
                                                    color: isCardBypassed ? '#777' : fxInfo.color,
                                                    textDecoration: isCardBypassed ? 'line-through' : 'none',
                                                    opacity: isCardBypassed ? 0.65 : 1
                                                  }}>
                                                    {fxInfo.label}
                                                  </span>
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                  <button
                                                    onClick={() => duplicateTrackFX(track.id, inst.id)}
                                                    title="Duplicate Effect"
                                                    style={{
                                                      background: 'rgba(255,255,255,0.05)',
                                                      border: 'none',
                                                      color: '#aaa',
                                                      fontSize: '10px',
                                                      padding: '2px 5px',
                                                      borderRadius: '3px',
                                                      cursor: 'pointer',
                                                      transition: 'all 0.1s ease',
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      fontWeight: 'bold'
                                                    }}
                                                    onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#fff' }}
                                                    onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#aaa' }}
                                                  >
                                                    <IconPlus size={10} />
                                                  </button>

                                                  <button
                                                    onClick={() => {
                                                      if (inst.type === 'vst3') {
                                                        audioEngine.removeTrackVst3Fx(track.id, inst.id);
                                                      }
                                                      removeTrackFXInstance(track.id, inst.id);
                                                    }}
                                                    title="Delete Effect"
                                                    style={{
                                                      background: 'rgba(255,68,68,0.1)',
                                                      border: 'none',
                                                      color: '#ff4444',
                                                      fontSize: '10px',
                                                      padding: '2px 5px',
                                                      borderRadius: '3px',
                                                      cursor: 'pointer',
                                                      transition: 'all 0.1s ease',
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      fontWeight: 'bold'
                                                    }}
                                                    onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.25)'; e.currentTarget.style.color = '#ff6b6b' }}
                                                    onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.1)'; e.currentTarget.style.color = '#ff4444' }}
                                                  >
                                                    <IconX size={10} />
                                                  </button>

                                                  <span style={{ fontSize: '7.5px', color: 'rgba(255,255,255,0.2)', fontWeight: 700, marginLeft: '4px' }}>
                                                    {displayIdx === 0 ? 'OUTPUT' : displayIdx === displayInstances.length - 1 ? 'INPUT' : `STEP ${displayInstances.length - displayIdx}`}
                                                  </span>
                                                </div>
                                              </div>

                                              {/* Controls body */}
                                              <div style={{ cursor: 'default' }}>
                                                {renderEffectControls(inst)}
                                              </div>
                                            </div>
                                          )
                                        })}

                                        {/* Custom FX Addition controls */}
                                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }} onMouseDown={e => e.stopPropagation()}>
                                          <StopPropSelect
                                            value=""
                                            onChange={e => {
                                              const val = e.target.value
                                              if (!val) return
                                              if (val.startsWith('vst3:')) {
                                                const pluginId = val.slice(5)
                                                const plugin = vst3Plugins.find(p => p.uniqueId === pluginId || p.fileOrIdentifier === pluginId)
                                                const targetPluginIdentifier = plugin?.fileOrIdentifier || pluginId
                                                const newInstId = `vst3_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
                                                const newInst = {
                                                  id: newInstId,
                                                  type: 'vst3' as const,
                                                  pluginId: targetPluginIdentifier,
                                                  pluginName: plugin?.name || 'VST3 Effect'
                                                }
                                                const currentInstances = getTrackFxInstances(track.fxInstances)
                                                const updatedFxSettings = { ...(track.fxSettings || {}) }
                                                updatedFxSettings[newInstId] = { wet: 0.4, bypassed: 0 }
                                                updateTrack(track.id, {
                                                  fxInstances: [...currentInstances, newInst],
                                                  fxSettings: updatedFxSettings
                                                })
                                                audioEngine.addTrackVst3Fx(track.id, newInstId, targetPluginIdentifier)
                                                audioEngine.setTrackVst3FxWet(track.id, newInstId, 0.4)
                                                useStore.getState().showToast(`Added VST3 FX: ${plugin?.name || targetPluginIdentifier}`, 'success')
                                                return
                                              }
                                              addCustomFxToTrack(track.id, val)
                                              useStore.getState().showToast('Added Custom FX to track', 'success')
                                            }}
                                            style={{
                                              flex: 1,
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
                                            <option value="" style={{ background: '#12141c', color: '#8b92a5' }}>+ Add Effect (VST3 / Custom)...</option>
                                            {vst3ActiveFx.length > 0 && (
                                              <optgroup label="── VST3 EFFECTS ──" style={{ background: '#0a0b10', color: '#00ff88', fontWeight: 800 }}>
                                                {vst3ActiveFx.map(plugin => (
                                                  <option key={plugin.uniqueId} value={`vst3:${plugin.fileOrIdentifier || plugin.uniqueId}`} style={{ background: '#12141c', color: '#00ff88' }}>
                                                    {plugin.name} {plugin.category ? `(${plugin.category})` : ''}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            )}
                                            {customFxConfigs.length > 0 && (
                                              <optgroup label="── CUSTOM JS FX ──" style={{ background: '#0a0b10', color: '#bf5af2', fontWeight: 800 }}>
                                                {customFxConfigs.map(c => (
                                                  <option key={c.id} value={c.id} style={{ background: '#12141c', color: '#bf5af2' }}>
                                                    {c.name}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            )}
                                          </StopPropSelect>

                                          <button
                                            onClick={() => {
                                              const ipc = (window as any).ipcRenderer
                                              if (ipc) {
                                                ipc.invoke('show-open-dialog', {
                                                  title: 'Import Custom FX File',
                                                  filters: [
                                                    { name: 'MuseGrid Custom FX', extensions: ['muzfects', 'json'] },
                                                    { name: 'All Files', extensions: ['*'] }
                                                  ]
                                                }).then((res: any) => {
                                                  if (!res) return
                                                  try {
                                                    const text = new TextDecoder('utf-8').decode(res.data)
                                                    const config = JSON.parse(text) as CustomFxConfig
                                                    if (!config.id || !config.name || !config.code) {
                                                      throw new Error('Invalid FX Configuration format')
                                                    }
                                                    // Register in global config if not exist
                                                    const exists = useStore.getState().customFxConfigs.some(c => c.id === config.id)
                                                    if (!exists) {
                                                      addCustomFxConfig(config)
                                                    }
                                                    // Instantiate on this track
                                                    addCustomFxToTrack(track.id, config.id)
                                                    useStore.getState().showToast(`Loaded & Added FX: ${config.name}`, 'success')
                                                  } catch (err: any) {
                                                    console.error(err)
                                                    useStore.getState().showToast(`Failed to load FX: ${err.message || err}`, 'error')
                                                  }
                                                })
                                              } else {
                                                const input = document.createElement('input')
                                                input.type = 'file'
                                                input.accept = '.muzfects,.json'
                                                input.onchange = async (e) => {
                                                  const file = (e.target as HTMLInputElement).files?.[0]
                                                  if (!file) return
                                                  try {
                                                    const text = await file.text()
                                                    const config = JSON.parse(text) as CustomFxConfig
                                                    if (!config.id || !config.name || !config.code) {
                                                      throw new Error('Invalid FX Configuration format')
                                                    }
                                                    // Register in global config if not exist
                                                    const exists = useStore.getState().customFxConfigs.some(c => c.id === config.id)
                                                    if (!exists) {
                                                      addCustomFxConfig(config)
                                                    }
                                                    // Instantiate on this track
                                                    addCustomFxToTrack(track.id, config.id)
                                                    useStore.getState().showToast(`Loaded & Added FX: ${config.name}`, 'success')
                                                  } catch (err: any) {
                                                    console.error(err)
                                                    useStore.getState().showToast(`Failed to load FX: ${err.message || err}`, 'error')
                                                  }
                                                }
                                                input.click()
                                              }
                                            }}
                                            style={{
                                              background: 'rgba(77,171,247,0.1)',
                                              border: '1px solid rgba(77,171,247,0.2)',
                                              color: '#4dabf7',
                                              fontSize: '10px',
                                              fontWeight: 'bold',
                                              borderRadius: '6px',
                                              padding: '5px 10px',
                                              cursor: 'pointer',
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              transition: 'all 0.1s'
                                            }}
                                            onMouseEnter={e => {
                                              e.currentTarget.style.background = 'rgba(77,171,247,0.2)'
                                              e.currentTarget.style.borderColor = '#4dabf7'
                                            }}
                                            onMouseLeave={e => {
                                              e.currentTarget.style.background = 'rgba(77,171,247,0.1)'
                                              e.currentTarget.style.borderColor = 'rgba(77,171,247,0.2)'
                                            }}
                                            title="Import and load a .muzfects file directly into this track"
                                          >
                                            <IconOpen size={11} style={{ marginRight: '2px' }} /> Load File
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })()}
                              </div>
                            </details>
                          </>
                        )}

                        {track.instrument === 'drum' && (
                          <details style={{ marginTop: '8px', marginBottom: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <summary style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none', outline: 'none' }}>
                              ▶ Drum Synth Engine
                            </summary>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px', borderLeft: '1px solid rgba(255,255,255,0.05)', marginTop: '8px' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  useStore.getState().setActiveTrackId(track.id)
                                  useStore.getState().setIsDrumDesignerModalVisible(true)
                                }}
                                style={{
                                  background: '#12141c',
                                  border: '1px solid rgba(255, 77, 77, 0.35)',
                                  color: '#ff6b6b',
                                  borderRadius: '6px',
                                  padding: '6px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  marginBottom: '6px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px'
                                }}
                              >
                                <IconDrum size={12} /> Launch 16-Pad Studio Designer
                              </button>
                              {(track.drumRows ?? DEFAULT_DRUM_ROWS).map((row: DrumRowConfig) => {
                                const val = track.drumDecays?.[row.pitch] ?? getDecayDefaultByPitch(row.pitch)
                                return (
                                  <SliderRow
                                    key={row.pitch}
                                    label={`${row.name} Decay`}
                                    value={val}
                                    min={0.01}
                                    max={5.0}
                                    step={0.01}
                                    suffix="s"
                                    color={row.color}
                                    onChange={v => {
                                      const updatedDecays = { ...(track.drumDecays ?? {}) }
                                      updatedDecays[row.pitch] = v
                                      updateTrack(track.id, { drumDecays: updatedDecays })
                                    }}
                                  />
                                )
                              })}
                            </div>
                          </details>
                        )}

                        {track.instrument === 'synth' && (
                          <details style={{ marginTop: '8px', marginBottom: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <summary style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none', outline: 'none' }}>
                              ▶ Synth Envelope Overrides
                            </summary>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px', borderLeft: '1px solid rgba(255,255,255,0.05)', marginTop: '8px' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  useStore.getState().setActiveTrackId(track.id)
                                  useStore.getState().setIsSynthStudioModalVisible(true)
                                }}
                                style={{
                                  background: '#12141c',
                                  border: '1px solid rgba(77, 171, 247, 0.35)',
                                  color: '#4dabf7',
                                  borderRadius: '6px',
                                  padding: '6px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  marginBottom: '6px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px'
                                }}
                              >
                                <IconSliders size={12} /> Launch Visual Synth Studio
                              </button>
                              <SliderRow label="Attack (Strike)" value={track.synthAttack ?? 0.01} min={0.001} max={2.0} step={0.01} color="#4dabf7" onChange={v => updateTrack(track.id, { synthAttack: v })} />
                              <SliderRow label="Decay" value={track.synthDecay ?? 0.1} min={0.01} max={2.0} step={0.01} color="#4dabf7" onChange={v => updateTrack(track.id, { synthDecay: v })} />
                              <SliderRow label="Sustain" value={track.synthSustain ?? 0.5} min={0} max={1.0} step={0.01} color="#4dabf7" onChange={v => updateTrack(track.id, { synthSustain: v })} />
                              <SliderRow label="Release" value={track.synthRelease ?? 0.5} min={0.01} max={5.0} step={0.01} color="#4dabf7" onChange={v => updateTrack(track.id, { synthRelease: v })} />
                            </div>
                          </details>
                        )}

                        {track.instrument === 'synth' && (
                          <details style={{ marginTop: '4px', marginBottom: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <summary style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none', outline: 'none' }}>
                              ▶ Synth Engine Core
                            </summary>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px', borderLeft: '1px solid rgba(255,255,255,0.05)', marginTop: '8px' }}>
                              <div
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                                onDragStart={e => e.stopPropagation()}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}
                              >
                                <span style={{ fontSize: '10px', color: '#aaa' }}>Oscillator</span>
                                <StopPropSelect
                                  value={track.synthOscillator ?? 'triangle'}
                                  onChange={e => updateTrack(track.id, { synthOscillator: e.target.value as any })}
                                  style={{ background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px', fontSize: '10px', width: '80px' }}
                                >
                                  <option value="sine">Sine</option>
                                  <option value="square">Square</option>
                                  <option value="sawtooth">Sawtooth</option>
                                  <option value="triangle">Triangle</option>
                                </StopPropSelect>
                              </div>
                              <SliderRow label="Filter Cut" value={track.synthFilterFreq ?? 2000} min={20} max={15000} step={10} color="#ff3366" onChange={v => updateTrack(track.id, { synthFilterFreq: v })} />
                              <SliderRow label="Filter Q" value={track.synthFilterQ ?? 1} min={0.1} max={20} step={0.1} color="#ff3366" onChange={v => updateTrack(track.id, { synthFilterQ: v })} />
                              <SliderRow label="Detune" value={track.synthDetune ?? 0} min={-1200} max={1200} step={1} suffix="ct" color="#4dabf7" onChange={v => updateTrack(track.id, { synthDetune: v })} />
                              <SliderRow label="Glide" value={track.synthPortamento ?? 0} min={0} max={1} step={0.01} color="#4dabf7" onChange={v => updateTrack(track.id, { synthPortamento: v })} />
                            </div>
                          </details>
                        )}

                        {track.instrument === 'synth' && (
                          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <span style={{ fontSize: '11px', color: '#aaa' }}>Override Scale</span>
                              <ToggleSwitch
                                checked={!!track.scaleOverride}
                                onChange={checked => updateTrack(track.id, {
                                  scaleOverride: checked ? (track.scaleOverride || { ...scaleLock, enabled: true }) : undefined
                                })}
                              />
                            </div>
                            {track.scaleOverride && (
                              <>
                                <div
                                  onMouseDown={e => e.stopPropagation()}
                                  onClick={e => e.stopPropagation()}
                                  onDragStart={e => e.stopPropagation()}
                                  style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}
                                >
                                  <StopPropSelect
                                    value={track.scaleOverride.root}
                                    onChange={e => updateTrack(track.id, { scaleOverride: { ...track.scaleOverride!, root: +e.target.value } })}
                                    style={{ flex: 1, background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px', fontSize: '11px' }}
                                  >
                                    {(track.scaleOverride.accidental === 'sharp' ? NOTE_NAMES_SHARP : NOTE_NAMES_FLAT).map((n, i) => <option key={i} value={i}>{n}</option>)}
                                  </StopPropSelect>
                                  <StopPropSelect
                                    value={track.scaleOverride.mode}
                                    onChange={e => updateTrack(track.id, { scaleOverride: { ...track.scaleOverride!, mode: e.target.value } })}
                                    style={{ flex: 2, background: '#1e1e2e', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px', fontSize: '10px' }}
                                  >
                                    {SCALE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                                  </StopPropSelect>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span style={{ fontSize: '10px', color: '#666' }}>Accidentals</span>
                                  <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                                    <button
                                      onClick={() => updateTrack(track.id, { scaleOverride: { ...track.scaleOverride!, accidental: 'sharp' } })}
                                      style={{ background: track.scaleOverride.accidental === 'sharp' ? '#4dabf7' : 'transparent', border: 'none', color: 'white', padding: '1px 6px', fontSize: '9px', cursor: 'pointer' }}
                                    >#</button>
                                    <button
                                      onClick={() => updateTrack(track.id, { scaleOverride: { ...track.scaleOverride!, accidental: 'flat' } })}
                                      style={{ background: track.scaleOverride.accidental === 'flat' ? '#4dabf7' : 'transparent', border: 'none', color: 'white', padding: '1px 6px', fontSize: '9px', cursor: 'pointer' }}
                                    >b</button>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {track.instrument === 'synth' && (
                          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <div>
                                <span style={{ fontSize: '11px', color: '#00e6ff', fontWeight: 700, display: 'block' }}>Microtonal Tuning (EDO)</span>
                                <span style={{ fontSize: '9px', color: '#888' }}>
                                  {track.edoDivision && track.edoDivision !== 12 ? `${track.edoDivision}-EDO (${(1200 / track.edoDivision).toFixed(2)}¢/step)` : '12-EDO (Standard)'}
                                </span>
                              </div>
                              <ToggleSwitch
                                checked={!!(track.edoDivision && track.edoDivision !== 12)}
                                onChange={checked => {
                                  if (checked) {
                                    updateTrack(track.id, { edoDivision: 53, edoPreset: '53-edo', edoRootNote: 60 })
                                  } else {
                                    updateTrack(track.id, { edoDivision: 12, edoPreset: '12-edo', edoRootNote: 60 })
                                  }
                                }}
                                color="#00e6ff"
                              />
                            </div>
                            {track.edoDivision && track.edoDivision !== 12 && (
                              <div style={{ background: 'rgba(0,230,255,0.04)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(0,230,255,0.15)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 600 }}>Tuning Preset</span>
                                  <StopPropSelect
                                    value={track.edoPreset || (track.edoDivision ? `${track.edoDivision}-edo` : '53-edo')}
                                    onChange={e => {
                                      const val = e.target.value
                                      if (val === '12-edo') {
                                        updateTrack(track.id, { edoDivision: 12, edoPreset: '12-edo', edoRootNote: 60 })
                                      } else if (val === 'custom') {
                                        updateTrack(track.id, { edoPreset: 'custom', edoDivision: track.edoDivision && track.edoDivision !== 12 ? track.edoDivision : 69 })
                                      } else {
                                        const div = parseInt(val)
                                        updateTrack(track.id, { edoDivision: div, edoPreset: val as any })
                                      }
                                    }}
                                    style={{ background: '#1e1e2e', color: '#00e6ff', border: '1px solid rgba(0,230,255,0.3)', borderRadius: '4px', padding: '3px 6px', fontSize: '10.5px', fontWeight: 700 }}
                                  >
                                    <option value="12-edo">12-EDO (Western Standard 12-TET)</option>
                                    <option value="53-edo">53-EDO (Turkish Makam / Holdrian)</option>
                                    <option value="24-edo">24-EDO (Arabic Quarter-Tones)</option>
                                    <option value="19-edo">19-EDO (Lush Minor 3rds)</option>
                                    <option value="31-edo">31-EDO (Huygens Pure Meantone)</option>
                                    <option value="47-edo">47-EDO (Alien Ambient)</option>
                                    <option value="custom">Custom N-EDO</option>
                                  </StopPropSelect>
                                </div>
                                {track.edoPreset === 'custom' && (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '10px', color: '#aaa' }}>Divisions Per Octave (N)</span>
                                    <input
                                      type="number"
                                      min={5}
                                      max={120}
                                      value={track.edoDivision || 69}
                                      onChange={e => {
                                        const n = Math.max(5, Math.min(120, parseInt(e.target.value) || 12))
                                        updateTrack(track.id, { edoDivision: n, edoPreset: 'custom' })
                                      }}
                                      onMouseDown={e => e.stopPropagation()}
                                      onClick={e => e.stopPropagation()}
                                      style={{ width: '55px', background: '#1e1e2e', color: '#00e6ff', border: '1px solid rgba(0,230,255,0.3)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', textAlign: 'center', fontWeight: 'bold' }}
                                    />
                                  </div>
                                )}
                                <div style={{ fontSize: '9px', color: '#888', lineHeight: 1.3 }}>
                                  Step size: <b style={{ color: '#00e6ff' }}>{(1200 / (track.edoDivision || 53)).toFixed(2)}¢</b> • {
                                    track.edoDivision === 53 ? 'Turkish Makam (Holdrian comma, pure 3:2 fifths & 5:4 thirds)' :
                                      track.edoDivision === 24 ? 'Quarter-tones for Arabic Rast & Bayati' :
                                        track.edoDivision === 31 ? '1/4-comma meantone (pure major thirds)' :
                                          track.edoDivision === 19 ? 'Neo-Renaissance consonance' :
                                            track.edoDivision === 47 ? 'Exotic xenharmonic neutral intervals' :
                                              `${track.edoDivision || 53} equal divisions of octave`
                                  }
                                </div>
                                {track.scalaScaleName && (
                                  <div style={{ fontSize: '9px', color: '#ffd43b', background: 'rgba(255,212,59,0.08)', padding: '3px 6px', borderRadius: '4px', border: '1px solid rgba(255,212,59,0.25)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ opacity: 0.7 }}>Scala:</span> <b>{track.scalaScaleName}</b>
                                  </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleImportScala(track.id) }}
                                    title="Load a .scl tuning file to configure this track"
                                    style={{
                                      flex: 1,
                                      background: 'rgba(0, 230, 255, 0.12)',
                                      border: '1px solid rgba(0, 230, 255, 0.35)',
                                      color: '#00e6ff',
                                      borderRadius: '4px',
                                      padding: '3px 6px',
                                      fontSize: '9.5px',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '4px'
                                    }}
                                  >
                                    <IconUpload size={11} /> Load .scl
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); exportTrackScala(track) }}
                                    title="Export this track's tuning as a .scl file"
                                    style={{
                                      flex: 1,
                                      background: 'rgba(255, 255, 255, 0.05)',
                                      border: '1px solid rgba(255, 255, 255, 0.12)',
                                      color: '#aaa',
                                      borderRadius: '4px',
                                      padding: '3px 6px',
                                      fontSize: '9.5px',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '4px'
                                    }}
                                  >
                                    <IconDownload size={11} /> Export .scl
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{ marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <SliderRow
                            label="Target BPM"
                            value={track.targetTempo ?? globalBpm}
                            min={20}
                            max={400}
                            step={1}
                            suffix=" BPM"
                            color="#ffcc00"
                            onChange={value => updateTrack(track.id, { targetTempo: value })}
                          />
                          {track.targetTempo !== undefined && track.targetTempo !== globalBpm && (
                            <button
                              onClick={() => updateTrack(track.id, { targetTempo: undefined })}
                              style={{ ...buttonStyle('#ffcc00'), marginTop: '-2px', marginBottom: '8px', width: '100%', fontSize: '9px', padding: '3px' }}
                            >
                              Reset to Global ({globalBpm})
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
                          <button onClick={() => exportTrack(track.id, 'wav')} disabled={projectExportData?.isRendering} style={buttonStyle('#4dabf7')}>
                            {projectExportData?.trackId === track.id && projectExportData?.type === 'wav' && projectExportData?.isRendering ? '...' : 'WAV'}
                          </button>
                          <button onClick={() => exportTrack(track.id, 'mp3')} disabled={projectExportData?.isRendering} style={buttonStyle('#00e6ff')}>
                            {projectExportData?.trackId === track.id && projectExportData?.type === 'mp3' && projectExportData?.isRendering ? '...' : 'MP3'}
                          </button>
                          <button onClick={() => exportTrack(track.id, 'midi')} disabled={projectExportData?.isRendering} style={buttonStyle('#ffd43b')}>
                            {projectExportData?.trackId === track.id && projectExportData?.type === 'midi' && projectExportData?.isRendering ? '...' : 'MIDI'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {track.collapsed && (
                  <div style={{ padding: '0 32px 4px', opacity: 0.5 }}>
                    {(() => {
                      const childCount = tracks.filter(t => t.parentId === track.id).length
                      return childCount > 0 ? (
                        <div style={{ fontSize: '10px', color: track.color, fontWeight: 700 }}>
                          {childCount} SUBTRACK{childCount > 1 ? 'S' : ''} HIDDEN
                        </div>
                      ) : null
                    })()}
                  </div>
                )}
              </div>
            )
          }

          return (
            <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '10px 12px' }}>
              {tracks.filter(t => !t.parentId).map(parent => {
                const parentIndex = tracks.findIndex(t => t.id === parent.id)
                return (
                  <div key={parent.id}>
                    {renderTrack(parent, parentIndex)}
                    {!parent.collapsed && (
                      <div
                        style={{ position: 'relative' }}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, tracks.length, parent.id)}
                      >
                        {tracks.filter(t => t.parentId === parent.id).map(child => {
                          const childIndex = tracks.findIndex(t => t.id === child.id)
                          return (
                            <div key={child.id} style={{ paddingLeft: '22px', position: 'relative' }}>
                              <div style={{ position: 'absolute', left: '10px', top: '-10px', bottom: '25px', width: '2px', background: `${child.color}33`, borderRadius: '1px' }} />
                              <div style={{ position: 'absolute', left: '10px', top: '15px', width: '10px', height: '2px', background: `${child.color}33`, borderRadius: '1px' }} />
                              {renderTrack(child, childIndex, true)}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Global drop zone at the bottom */}
              <div
                style={{
                  height: '40px',
                  marginTop: '10px',
                  border: '2px dashed rgba(255,255,255,0.08)',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#333',
                  fontSize: '10px',
                  fontWeight: 700,
                  background: 'rgba(77,171,247,0.03)',
                  transition: 'all 0.2s',
                  cursor: 'default'
                }}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, tracks.length, undefined)}
                onDragEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(77,171,247,0.08)'}
                onDragLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(77,171,247,0.03)'}
              >
                DRAG HERE TO CONVERT TO MAIN TRACK
              </div>
            </div>
          )
        })()}
      </div>

      {contextMenu && createPortal(
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#14141c',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px',
            zIndex: 9999,
            minWidth: '170px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            overflow: 'hidden',
            transform: `${contextMenu.x > window.innerWidth / 2 ? 'translateX(-100%)' : ''} ${contextMenu.y > window.innerHeight / 2 ? 'translateY(-100%)' : ''}`.trim()
          }}
          ref={contextMenuRef}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '6px 0' }}>
            {contextMenu.mode === 'background' ? (
              <>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    useStore.getState().setLeftPaneTopRatio(isLeftPaneFlipped ? 1.0 : 0.0)
                    setContextMenu(null)
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <IconList size={13} style={{ color: '#4dabf7' }} />
                  <span>Show Only Tracks Pane</span>
                </button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    useStore.getState().setLeftPaneTopRatio(isLeftPaneFlipped ? 0.0 : 1.0)
                    setContextMenu(null)
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <IconSettings size={13} style={{ color: '#69db7c' }} />
                  <span>Show Only Settings</span>
                </button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    useStore.getState().setLeftPaneTopRatio(0.6)
                    setContextMenu(null)
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <IconColumns size={13} style={{ color: '#ff9900' }} />
                  <span>Show Both (Split View)</span>
                </button>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    handleAddTrack('synth')
                    setContextMenu(null)
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <IconMusic size={13} style={{ color: '#da77f2' }} />
                  <span>Add Synth Track</span>
                </button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    handleAddTrack('drum')
                    setContextMenu(null)
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <IconDrum size={13} style={{ color: '#ffd43b' }} />
                  <span>Add Drum Track</span>
                </button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    handleImportMuzTrack()
                    setContextMenu(null)
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <IconDownload size={13} style={{ color: '#69db7c' }} />
                  <span>Import .muztrack Track</span>
                </button>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    setIsLeftPaneFlipped(!isLeftPaneFlipped)
                    setContextMenu(null)
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <IconAlign size={13} style={{ color: '#69db7c' }} />
                  <span>{isLeftPaneFlipped ? 'Flip Layout (Settings at Top)' : 'Flip Layout (Tracks at Top)'}</span>
                </button>
              </>
            ) : contextMenu.mode === 'main' && contextMenu.isMultiSelect ? (
              <>
                {(() => {
                  const allMuted = selectedTrackIds.length > 0 && selectedTrackIds.every(id => tracks.find(t => t.id === id)?.muted)
                  const allSoloed = selectedTrackIds.length > 0 && selectedTrackIds.every(id => tracks.find(t => t.id === id)?.soloed)
                  const allHidden = selectedTrackIds.length > 0 && selectedTrackIds.every(id => tracks.find(t => t.id === id)?.hidden)
                  const allSelectable = selectedTrackIds.length > 0 && selectedTrackIds.every(id => tracks.find(t => t.id === id)?.allowMultiTrackSelect)
                  return (
                    <>
                      {/* Multi-Track Note Selection Actions */}
                      <button
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#00e6ff', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}
                        onClick={() => {
                          const targetNotes = notes.filter(n => selectedTrackIds.includes(n.trackId));
                          setSelectedNoteIds(targetNotes.map(n => n.id));
                          setContextMenu(null);
                          useStore.getState().showToast(`Selected all ${targetNotes.length} notes across ${selectedTrackIds.length} tracks`, 'success');
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 230, 255, 0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        title="Select all notes on all currently selected tracks"
                      >
                        <IconCursor size={13} style={{ color: '#00e6ff' }} />
                        <span>Select Notes Across Selected Tracks</span>
                      </button>
                      <button
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                        onClick={() => {
                          const trackNoteIds = notes.filter(n => selectedTrackIds.includes(n.trackId)).map(n => n.id);
                          const merged = Array.from(new Set([...selectedNoteIds, ...trackNoteIds]));
                          setSelectedNoteIds(merged);
                          setContextMenu(null);
                          useStore.getState().showToast(`Added notes to selection (${merged.length} total)`, 'info');
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        title="Add notes from all selected tracks to your active selection"
                      >
                        <IconPlus size={13} style={{ color: '#4dabf7' }} />
                        <span>Add Tracks' Notes to Selection</span>
                      </button>
                      <button
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                        onClick={() => {
                          commitHistory();
                          const remaining = notes.filter(n => !selectedTrackIds.includes(n.trackId));
                          const removedCount = notes.length - remaining.length;
                          useStore.setState({ notes: remaining });
                          setSelectedNoteIds(selectedNoteIds.filter(id => remaining.some(n => n.id === id)));
                          setContextMenu(null);
                          useStore.getState().showToast(`Cleared ${removedCount} notes across ${selectedTrackIds.length} tracks`, 'info');
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 107, 107, 0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        title="Delete all notes across selected tracks"
                      >
                        <IconTrash size={13} style={{ color: '#ff6b6b' }} />
                        <span>Clear Notes Across Selected Tracks</span>
                      </button>
                      <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().updateTracks(selectedTrackIds, { muted: !allMuted }); setContextMenu(null) }}><IconVolumeX size={13} /> {allMuted ? 'Unmute Selected' : 'Mute Selected'}</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#00e6ff', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().updateTracks(selectedTrackIds, { soloed: !allSoloed }); setContextMenu(null) }}><IconSpeaker size={13} /> {allSoloed ? 'Unsolo Selected' : 'Solo Selected'}</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'loop' } : null)}><IconLoop size={13} /> Loop Selected</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().updateTracks(selectedTrackIds, { hidden: !allHidden }); setContextMenu(null) }}><IconVolumeX size={13} /> {allHidden ? 'Show Selected Tracks' : 'Hide Selected Tracks'}</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().updateTracks(selectedTrackIds, { allowMultiTrackSelect: !allSelectable }); setContextMenu(null) }}><IconCursor size={13} /> {allSelectable ? 'Disable Multi-track Note Selection' : 'Enable Multi-track Note Selection'}</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { commitHistory(); useStore.getState().duplicateTracks(selectedTrackIds); setContextMenu(null) }}><IconCopy size={13} /> Duplicate Selected Tracks</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#da77f2', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => {
                        const state = useStore.getState()
                        const selectedTracks = state.tracks.filter(t => selectedTrackIds.includes(t.id))

                        const mergeTransactions: { targetId: string, sourceIds: string[] }[] = []

                        if (state.bothGridActive) {
                          const synthTracks = state.tracks.filter(t => t.instrument === 'synth')
                          const drumTracks = state.tracks.filter(t => t.instrument === 'drum')

                          const activeSynth = state.activeTrackId && synthTracks.find(t => t.id === state.activeTrackId)
                            ? synthTracks.find(t => t.id === state.activeTrackId)
                            : synthTracks[0]

                          const activeDrum = state.activeTrackId && drumTracks.find(t => t.id === state.activeTrackId)
                            ? drumTracks.find(t => t.id === state.activeTrackId)
                            : drumTracks[0]

                          if (activeSynth) {
                            const sources = selectedTracks.filter(t => t.instrument === 'synth' && t.id !== activeSynth.id).map(t => t.id)
                            if (sources.length > 0) mergeTransactions.push({ targetId: activeSynth.id, sourceIds: sources })
                          }
                          if (activeDrum) {
                            const sources = selectedTracks.filter(t => t.instrument === 'drum' && t.id !== activeDrum.id).map(t => t.id)
                            if (sources.length > 0) mergeTransactions.push({ targetId: activeDrum.id, sourceIds: sources })
                          }
                        } else {
                          const targetTrack = state.tracks.find(t => t.id === state.activeTrackId)
                          if (!targetTrack) {
                            state.showToast('No active track selected to merge into.', 'error')
                            setContextMenu(null)
                            return
                          }
                          const sources = selectedTracks.filter(t => t.instrument === targetTrack.instrument && t.id !== targetTrack.id).map(t => t.id)
                          if (sources.length > 0) mergeTransactions.push({ targetId: targetTrack.id, sourceIds: sources })
                        }

                        if (mergeTransactions.length === 0) {
                          state.showToast('No valid source tracks selected to merge into active track(s).', 'error')
                          setContextMenu(null)
                          return
                        }

                        useStore.setState((currentState) => {
                          let newTracks = [...currentState.tracks]
                          let newNotes = [...currentState.notes]
                          let newClips = [...currentState.clips]
                          const automationCurves = { ...currentState.automationCurves }
                          let newSelectedTrackIds = [...currentState.selectedTrackIds]

                          mergeTransactions.forEach(({ targetId, sourceIds }) => {
                            newTracks = newTracks.filter(t => !sourceIds.includes(t.id))
                            newNotes = newNotes.filter(n => !sourceIds.includes(n.trackId))
                            newClips = newClips.filter(c => !sourceIds.includes(c.trackId))

                            sourceIds.forEach(sourceId => {
                              const sourceNotes = currentState.notes.filter(n => n.trackId === sourceId)
                              const sourceClips = currentState.clips.filter(c => c.trackId === sourceId)

                              sourceNotes.forEach(n => {
                                newNotes.push({ ...n, id: newId(), trackId: targetId })
                              })

                              sourceClips.forEach(c => {
                                newClips.push({ ...c, id: newId(), trackId: targetId })
                              })

                              delete automationCurves[sourceId]
                            })
                            newSelectedTrackIds = newSelectedTrackIds.filter(id => !sourceIds.includes(id))
                          })

                          return {
                            tracks: newTracks,
                            notes: newNotes,
                            clips: newClips,
                            automationCurves,
                            selectedTrackIds: newSelectedTrackIds
                          }
                        })

                        setContextMenu(null)
                        state.showToast('Selected tracks merged into active track(s).', 'success')
                      }}><IconPlus size={13} /> Merge Selected</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().setProjectExportData({ type: 'wav', trackIds: selectedTrackIds, octaveOffset: 0, semitoneOffset: 0, normalize: true, includeMetronome: false, autoFade: true, isRendering: false, progress: 0 }); setContextMenu(null) }}><IconDownload size={13} /> Export Selected Mix (WAV)</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#00e6ff', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().setProjectExportData({ type: 'mp3', trackIds: selectedTrackIds, octaveOffset: 0, semitoneOffset: 0, normalize: true, includeMetronome: false, autoFade: true, isRendering: false, progress: 0 }); setContextMenu(null) }}><IconDownload size={13} /> Export Selected Mix (MP3)</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#da77f2', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 600 }} onClick={() => {
                        const selTracks = tracks.filter(t => selectedTrackIds.includes(t.id))
                        const selNotes = notes.filter(n => selectedTrackIds.includes(n.trackId))
                        const state = useStore.getState()
                        const xml = generateMusicXML(selTracks, selNotes, state.bpm, state.timeSignature, true)
                        downloadScore(xml, 'selected_tracks.musicxml')
                        setContextMenu(null)
                      }}><IconMusic size={13} /> Export Selected (MusicXML)</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 600 }} onClick={() => {
                        const selTracks = tracks.filter(t => selectedTrackIds.includes(t.id))
                        const selNotes = notes.filter(n => selectedTrackIds.includes(n.trackId))
                        const state = useStore.getState()
                        const json = generateMuzTrack(selTracks, selNotes, state.bpm, state.timeSignature)
                        downloadMuzTrack(json, 'selected_tracks.muztrack')
                        setContextMenu(null)
                      }}><IconDownload size={13} /> Export Selected (.muztrack)</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ffd43b', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().setProjectExportData({ type: 'midi', trackIds: selectedTrackIds, octaveOffset: 0, semitoneOffset: 0, normalize: false, includeMetronome: false, autoFade: false, isRendering: false, progress: 0 }); setContextMenu(null) }}><IconMidi size={13} /> Export Selected (MIDI)</button>
                      <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#da77f2', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().setScorePreviewTrackIds(selectedTrackIds); useStore.getState().setIsScorePreviewVisible(true); setContextMenu(null) }}><IconMusic size={13} /> Score Editor / MusicXML</button>
                    </>
                  )
                })()}
              </>
            ) : contextMenu.mode === 'main' ? (
              <>
                {/* Only show subtrack options for root tracks */}
                {!tracks.find(t => t.id === contextMenu.trackId)?.parentId && (
                  <>
                    <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 700 }} onClick={(e) => handleAddTrack('synth', contextMenu.trackId, e)}><IconMusic size={13} /> ADD SYNTH SUBTRACK</button>
                    <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ff9900', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 700 }} onClick={(e) => handleAddTrack('drum', contextMenu.trackId, e)}><IconDrum size={13} /> ADD DRUM SUBTRACK</button>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
                  </>
                )}
                {/* Single Track Note Selection Actions */}
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#00e6ff', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}
                  onClick={() => {
                    const t = tracks.find(x => x.id === contextMenu.trackId);
                    const trackNotes = notes.filter(n => n.trackId === contextMenu.trackId);
                    setSelectedNoteIds(trackNotes.map(n => n.id));
                    setActiveTrackId(contextMenu.trackId);
                    setContextMenu(null);
                    useStore.getState().showToast(`Selected all ${trackNotes.length} notes on "${t?.name || 'Track'}"`, 'success');
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 230, 255, 0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  title="Select all notes on this track"
                >
                  <IconCursor size={13} style={{ color: '#00e6ff' }} />
                  <span>Select All Notes on Track</span>
                </button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    const t = tracks.find(x => x.id === contextMenu.trackId);
                    const trackNoteIds = notes.filter(n => n.trackId === contextMenu.trackId).map(n => n.id);
                    const merged = Array.from(new Set([...selectedNoteIds, ...trackNoteIds]));
                    setSelectedNoteIds(merged);
                    setContextMenu(null);
                    useStore.getState().showToast(`Added ${trackNoteIds.length} notes from "${t?.name || 'Track'}" (${merged.length} total)`, 'info');
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  title="Add this track's notes to your current selection"
                >
                  <IconPlus size={13} style={{ color: '#4dabf7' }} />
                  <span>Add Track Notes to Selection</span>
                </button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    const t = tracks.find(x => x.id === contextMenu.trackId);
                    commitHistory();
                    const remaining = notes.filter(n => n.trackId !== contextMenu.trackId);
                    const removedCount = notes.length - remaining.length;
                    useStore.setState({ notes: remaining });
                    setSelectedNoteIds(selectedNoteIds.filter(id => remaining.some(n => n.id === id)));
                    setContextMenu(null);
                    useStore.getState().showToast(`Cleared ${removedCount} notes on "${t?.name || 'Track'}"`, 'info');
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 107, 107, 0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  title="Delete all notes on this track"
                >
                  <IconTrash size={13} style={{ color: '#ff6b6b' }} />
                  <span>Clear Track Notes</span>
                </button>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { useStore.getState().toggleTrackVisibility(contextMenu.trackId); setContextMenu(null) }}><IconVolumeX size={13} /> {tracks.find(t => t.id === contextMenu.trackId)?.hidden ? 'Show Track' : 'Hide Track'}</button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => {
                  const t = tracks.find(x => x.id === contextMenu.trackId);
                  useStore.getState().updateTrack(contextMenu.trackId, { allowMultiTrackSelect: !t?.allowMultiTrackSelect });
                  setContextMenu(null);
                }}><IconCursor size={13} /> <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>{tracks.find(t => t.id === contextMenu.trackId)?.allowMultiTrackSelect && <IconCheck size={12} color="#00e6ff" />}Select Notes on Track</span></button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { commitHistory(); useStore.getState().duplicateTracks([contextMenu.trackId]); setContextMenu(null) }}><IconCopy size={13} /> Duplicate Track</button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { setEditingTrackId(contextMenu.trackId); setContextMenu(null) }}><IconEdit size={13} /> Rename</button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'sync' } : null)}><IconSync size={13} /> Sync AFX to...</button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ffd43b', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => handleImportMidi(contextMenu.trackId)}><IconDownload size={13} /> Import MIDI</button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => handleImportSheet(contextMenu.trackId)}><IconMusic size={13} /> Import from Sheet</button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => handleImportMuzTrack()}><IconDownload size={13} /> Import Track (.muztrack)</button>
                {tracks.find(t => t.id === contextMenu.trackId)?.instrument === 'synth' && (
                  <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#00e6ff', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => handleImportScala(contextMenu.trackId)}><IconUpload size={13} /> Import Scala Tuning (.scl)</button>
                )}
                {(tracks.find(t => t.id === contextMenu.trackId)?.instrument === 'synth' || tracks.find(t => t.id === contextMenu.trackId)?.instrument === 'drum') && (
                  <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#da77f2', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => {
                    useStore.getState().setShowImportAudioModal(true, contextMenu.trackId)
                    setContextMenu(null)
                  }}><IconSpeaker size={13} /> Import Audio</button>
                )}
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#00e6ff', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}
                  onClick={() => {
                    const t = tracks.find(x => x.id === contextMenu.trackId)
                    if (!t) return
                    const tNotes = notes.filter(n => n.trackId === t.id)
                    const state = useStore.getState()
                    const xml = generateMusicXML([t], tNotes, t.targetTempo || state.bpm, state.timeSignature, true)
                    downloadScore(xml, `${(t.name || 'track').toLowerCase().replace(/\s+/g, '_')}.musicxml`)
                    setContextMenu(null)
                  }}
                >
                  <IconDownload size={13} /> Export Track (MusicXML)
                </button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}
                  onClick={() => {
                    const t = tracks.find(x => x.id === contextMenu.trackId)
                    if (!t) return
                    const tNotes = notes.filter(n => n.trackId === t.id)
                    const state = useStore.getState()
                    const json = generateMuzTrack([t], tNotes, t.targetTempo || state.bpm, state.timeSignature)
                    downloadMuzTrack(json, `${(t.name || 'track').toLowerCase().replace(/\s+/g, '_')}.muztrack`)
                    setContextMenu(null)
                  }}
                >
                  <IconDownload size={13} /> Export Track (.muztrack)
                </button>
                {tracks.find(t => t.id === contextMenu.trackId)?.instrument === 'synth' && (
                  <button
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#00e6ff', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 600 }}
                    onClick={() => {
                      const t = tracks.find(x => x.id === contextMenu.trackId)
                      exportTrackScala(t)
                      setContextMenu(null)
                    }}
                  >
                    <IconDownload size={13} /> Export Scala Tuning (.scl)
                  </button>
                )}
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ffd43b', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }}
                  onClick={() => {
                    useStore.getState().setProjectExportData({
                      type: 'wav',
                      trackId: contextMenu.trackId,
                      octaveOffset: 0,
                      semitoneOffset: 0,
                      normalize: true,
                      includeMetronome: false,
                      autoFade: true,
                      isRendering: false,
                      progress: 0
                    })
                    setContextMenu(null)
                  }}
                >
                  <IconDownload size={13} /> Export Track Audio / Mix...
                </button>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ff9900', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'make_subtrack' } : null)}><IconPlus size={13} /> Make subtrack of...</button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#da77f2', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'merge_track' } : null)}><IconPlus size={13} /> Merge into...</button>
                <button style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: 500 }} onClick={() => { removeTrack(contextMenu.trackId); setSelectedNoteIds([]); setContextMenu(null) }}><IconTrash size={13} /> Delete Track</button>
              </>
            ) : contextMenu.mode === 'sync' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '4px' }}>
                  <button onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'main' } : null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}><IconChevronLeft size={14} /></button>
                  <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800 }}>Sync AFX Target</span>
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }} className="thin-scroll">
                  {tracks.filter(t => t.id !== contextMenu.trackId).map(t => (
                    <button
                      key={t.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 500 }}
                      onClick={() => { syncTrackSettings(contextMenu.trackId, t.id); setContextMenu(null) }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.color }} />
                      {t.name}
                    </button>
                  ))}
                  {tracks.length <= 1 && (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '10px', color: '#444' }}>No other tracks found</div>
                  )}
                </div>
              </>
            ) : contextMenu.mode === 'merge_track' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '4px' }}>
                  <button onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'main' } : null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}><IconChevronLeft size={14} /></button>
                  <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800 }}>Merge into</span>
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '4px 0' }} className="thin-scroll">
                  {tracks.filter(t => t.id !== contextMenu.trackId && t.instrument === tracks.find(source => source.id === contextMenu.trackId)?.instrument).map(t => (
                    <button
                      key={t.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 500 }}
                      onClick={() => {
                        const sourceId = contextMenu.trackId;
                        const targetId = t.id;
                        commitHistory();

                        useStore.setState((currentState) => {
                          const newTracks = currentState.tracks.filter(t => t.id !== sourceId)
                          const newNotes = currentState.notes.filter(n => n.trackId !== sourceId)
                          const newClips = currentState.clips.filter(c => c.trackId !== sourceId)

                          const sourceNotes = currentState.notes.filter(n => n.trackId === sourceId);
                          const sourceClips = currentState.clips.filter(c => c.trackId === sourceId);

                          sourceNotes.forEach(n => {
                            newNotes.push({ ...n, id: newId(), trackId: targetId });
                          });

                          sourceClips.forEach(c => {
                            newClips.push({ ...c, id: newId(), trackId: targetId });
                          });

                          const automationCurves = { ...currentState.automationCurves }
                          delete automationCurves[sourceId]

                          const newSelectedTrackIds = currentState.selectedTrackIds.filter(id => id !== sourceId)

                          return {
                            tracks: newTracks,
                            notes: newNotes,
                            clips: newClips,
                            automationCurves,
                            selectedTrackIds: newSelectedTrackIds
                          };
                        });

                        setContextMenu(null);
                        useStore.getState().showToast('Tracks merged successfully.', 'success');
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.color }} />
                      {t.name}
                    </button>
                  ))}
                  {tracks.filter(t => t.id !== contextMenu.trackId && t.instrument === tracks.find(source => source.id === contextMenu.trackId)?.instrument).length === 0 && (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '10px', color: '#444' }}>No compatible tracks</div>
                  )}
                </div>
              </>
            ) : contextMenu.mode === 'loop' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '4px' }}>
                  <button onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'main' } : null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}><IconChevronLeft size={14} /></button>
                  <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800 }}>{contextMenu.isMultiSelect ? 'Loop Selected Tracks' : 'Loop Track'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px 0' }}>
                  <button
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 600 }}
                    onClick={() => {
                      if (contextMenu.isMultiSelect) {
                        selectedTrackIds.forEach(id => loopTrack(id, 'fillToEnd', true));
                      } else {
                        loopTrack(contextMenu.trackId, 'fillToEnd', true);
                      }
                      setContextMenu(null)
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  ><IconLoop size={13} style={{ opacity: 0.8 }} /> Loop to End (Snap)</button>
                  <button
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#4dabf7', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 600 }}
                    onClick={() => {
                      if (contextMenu.isMultiSelect) {
                        selectedTrackIds.forEach(id => loopTrack(id, 'fillToEnd', false));
                      } else {
                        loopTrack(contextMenu.trackId, 'fillToEnd', false);
                      }
                      setContextMenu(null)
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  ><IconLoop size={13} style={{ opacity: 0.8 }} /> Loop to End (Exact)</button>
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
                  <button
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 600 }}
                    onClick={() => {
                      if (contextMenu.isMultiSelect) {
                        selectedTrackIds.forEach(id => loopTrack(id, 'perfectCycle', true));
                      } else {
                        loopTrack(contextMenu.trackId, 'perfectCycle', true);
                      }
                      setContextMenu(null)
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  ><IconLoop size={13} style={{ opacity: 0.8 }} /> Loop Perfect Cycles (Snap)</button>
                  <button
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#69db7c', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 600 }}
                    onClick={() => {
                      if (contextMenu.isMultiSelect) {
                        selectedTrackIds.forEach(id => loopTrack(id, 'perfectCycle', false));
                      } else {
                        loopTrack(contextMenu.trackId, 'perfectCycle', false);
                      }
                      setContextMenu(null)
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  ><IconLoop size={13} style={{ opacity: 0.8 }} /> Loop Perfect Cycles (Exact)</button>
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
                  <button
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#ffd43b', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 600 }}
                    onClick={() => { setNTimesPromptTrackId({ id: contextMenu.trackId, multi: !!contextMenu.isMultiSelect }); setContextMenu(null) }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  ><IconLoop size={13} style={{ opacity: 0.8 }} /> Loop N Times...</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '4px' }}>
                  <button onClick={() => setContextMenu(prev => prev ? { ...prev, mode: 'main' } : null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}><IconChevronLeft size={14} /></button>
                  <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800 }}>Make Subtrack of</span>
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '4px 0' }} className="thin-scroll">
                  {(() => {
                    const currentTrack = tracks.find(t => t.id === contextMenu.trackId)
                    if (!currentTrack) return null

                    return (
                      <>
                        {currentTrack.parentId && (
                          <button
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', textAlign: 'left', fontSize: '11px', fontWeight: 600 }}
                            onClick={() => {
                              commitHistory()
                              updateTrack(contextMenu.trackId, { parentId: undefined })
                              setContextMenu(null)
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <IconX size={13} style={{ marginRight: '4px' }} /> None (Make main track)
                          </button>
                        )}

                        {tracks
                          .filter(t => !t.parentId && t.id !== currentTrack.id)
                          .map(parent => {
                            const children = tracks.filter(t => t.parentId === parent.id)
                            return (
                              <div key={parent.id} style={{ display: 'flex', flexDirection: 'column' }}>
                                <button
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    width: '100%',
                                    padding: '6px 16px',
                                    background: 'none',
                                    border: 'none',
                                    color: '#eee',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    fontSize: '11px',
                                    fontWeight: 500
                                  }}
                                  onClick={() => {
                                    commitHistory()
                                    updateTrack(contextMenu.trackId, { parentId: parent.id, color: parent.color })
                                    setContextMenu(null)
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                >
                                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: parent.color }} />
                                  {parent.instrument === 'synth' ? <IconMusic size={11} style={{ opacity: 0.7 }} /> : <IconDrum size={11} style={{ opacity: 0.7 }} />}
                                  {parent.name}
                                </button>

                                {children.map(child => (
                                  <div key={child.id} style={{ paddingLeft: '24px', position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <div style={{ position: 'absolute', left: '14px', top: '-6px', bottom: '15px', width: '2px', background: `${child.color}33`, borderRadius: '1px' }} />
                                    <div style={{ position: 'absolute', left: '14px', top: '10px', width: '10px', height: '2px', background: `${child.color}33`, borderRadius: '1px' }} />

                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        width: '100%',
                                        padding: '4px 16px',
                                        color: '#555',
                                        fontSize: '10px',
                                        fontWeight: 500,
                                        userSelect: 'none'
                                      }}
                                    >
                                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: child.color, opacity: 0.4 }} />
                                      {child.instrument === 'synth' ? <IconMusic size={9} style={{ opacity: 0.4 }} /> : <IconDrum size={9} style={{ opacity: 0.4 }} />}
                                      {child.name}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )
                          })
                        }
                      </>
                    )
                  })()}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {midiImportData && createPortal(
        <div className="animate-modal-bg" style={{ position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="animate-modal-card" style={{ width: '100%', maxWidth: '500px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px', boxShadow: '0 30px 70px rgba(0,0,0,0.85)', overflow: 'hidden', background: '#12131a' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(77,171,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconMidi size={18} style={{ color: '#4dabf7' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', color: 'white', letterSpacing: '-0.5px' }}>MIDI Import</h3>
                  <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#666', fontWeight: 500 }}>{midiImportData.midi.header.name || 'Untitled MIDI File'}</p>
                </div>
              </div>
              <button onClick={() => setMidiImportData(null)} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
            </div>

            <div style={{ padding: '20px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Source BPM</span>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: '#fff', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      value={midiImportData.midi ? Math.round(midiImportData.midi.header.tempos[0]?.bpm || 120) : 120}
                      onChange={(e) => {
                        const val = Number(e.target.value)
                        if (!val || val <= 0) return
                        if (!midiImportData.midi) return
                        const newMidi = new Midi(midiImportData.midi.toArray())
                        if (!newMidi.header.tempos) newMidi.header.tempos = []
                        if (newMidi.header.tempos.length === 0) {
                          newMidi.header.tempos.push({ bpm: val, ticks: 0 })
                        } else {
                          newMidi.header.tempos[0].bpm = val
                        }
                        setMidiImportData({ ...midiImportData, midi: newMidi })
                      }}
                      style={{
                        width: '55px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        padding: '2px 6px',
                        outline: 'none',
                        textAlign: 'center'
                      }}
                    />
                    <span style={{ color: '#444', fontSize: '10px' }}>BPM</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '10px', color: '#888', fontWeight: 600 }}>Inherit Tempo</span>
                  <ToggleSwitch checked={midiImportData.inheritTempo} onChange={v => setMidiImportData(d => d ? { ...d, inheritTempo: v } : null)} color="#ff9900" />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.12em', display: 'block', marginBottom: '10px' }}>Transformation</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Octave Correction</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button onClick={() => setMidiImportData(d => d ? { ...d, octaveOffset: d.octaveOffset - 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>-</button>
                      <span style={{ width: '20px', textAlign: 'center', fontWeight: 800, fontSize: '13px', color: '#4dabf7' }}>{midiImportData.octaveOffset}</span>
                      <button onClick={() => setMidiImportData(d => d ? { ...d, octaveOffset: d.octaveOffset + 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>+</button>
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Pitch Transpose</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button onClick={() => setMidiImportData(d => d ? { ...d, semitoneOffset: d.semitoneOffset - 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>-</button>
                      <span style={{ width: '20px', textAlign: 'center', fontWeight: 800, fontSize: '13px', color: '#ffd43b' }}>{midiImportData.semitoneOffset}</span>
                      <button onClick={() => setMidiImportData(d => d ? { ...d, semitoneOffset: d.semitoneOffset + 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>+</button>
                    </div>
                  </div>
                  {midiImportData.isDrum && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Drum Map Cycle</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button onClick={() => setMidiImportData(d => d ? { ...d, drumMapOffset: d.drumMapOffset - 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>-</button>
                        <span style={{ width: '20px', textAlign: 'center', fontWeight: 800, fontSize: '13px', color: '#ff9900' }}>{((midiImportData.drumMapOffset % 5) + 5) % 5}</span>
                        <button onClick={() => setMidiImportData(d => d ? { ...d, drumMapOffset: d.drumMapOffset + 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>+</button>
                      </div>
                    </div>
                  )}
                  {!midiImportData.isDrum && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Smart Mapping</div>
                        <div style={{ fontSize: '9px', color: '#444', fontWeight: 600 }}>Snap to project scale</div>
                      </div>
                      <ToggleSwitch checked={midiImportData.smartMapping} onChange={v => setMidiImportData(d => d ? { ...d, smartMapping: v } : null)} color="#da77f2" />
                    </div>
                  )}
                </div>
              </div>

              <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.12em', display: 'block', marginBottom: '10px' }}>Select Source Track</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto' }} className="thin-scroll">
                {midiImportData.midi.tracks.filter(t => t.notes.length > 0).map((t, i) => (
                  <button
                    key={i}
                    onClick={() => executeMidiImport(t)}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)',
                      textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: t.channel === 9 ? 'rgba(255,153,0,0.12)' : 'rgba(77,171,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {t.channel === 9 ? <IconDrum size={14} style={{ color: '#ff9900' }} /> : <IconMusic size={14} style={{ color: '#4dabf7' }} />}
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'white' }}>{t.name || `Track ${i + 1}`}</div>
                        <div style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>{t.instrument.family || 'Synthetic'}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', fontWeight: 800, color: '#4dabf7' }}>{t.notes.length} notes</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: '12px', background: 'rgba(0,0,0,0.1)', borderTop: '1px solid rgba(255,255,255,0.03)', textAlign: 'center', fontSize: '9px', color: '#333', fontWeight: 600, letterSpacing: '0.05em' }}>
              PRO TIP: USE OCTAVE CORRECTION IF NOTES LAND OUTSIDE GRID RANGE
            </div>
          </div>
        </div>,
        document.body
      )}

      {projectExportData && createPortal(
        <div className="animate-modal-bg" style={{ position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000, padding: '20px' }}>
          <div className="animate-modal-card" style={{ background: '#12131a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px', width: '100%', maxWidth: '520px', boxShadow: '0 30px 70px rgba(0,0,0,0.85)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(77,171,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconDownload size={20} style={{ color: '#4dabf7' }} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>Render Project</h2>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#666', fontWeight: 500 }}>
                    {projectExportData.trackId ? `Stem: ${tracks.find(t => t.id === projectExportData.trackId)?.name}` : 'Project Master Mix'}
                  </p>
                </div>
              </div>
              {!projectExportData.isRendering && (
                <button onClick={() => setProjectExportData(null)} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
              )}
            </div>

            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }} className="thin-scroll">
              {projectExportData.isRendering ? (
                <div style={{ textAlign: 'center', padding: '30px 0' }}>
                  <div className="rendering-animation" style={{ marginBottom: '20px' }}>
                    <div style={{ width: '50px', height: '50px', borderRadius: '50%', border: '3px solid rgba(77,171,247,0.1)', borderTopColor: '#4dabf7', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
                  </div>
                  <h3 style={{ margin: '0 0 4px', color: '#fff', fontSize: '16px' }}>
                    {projectExportData.bounceMode === 'realtime' ? 'Recording live output...' : 'Rendering...'}
                  </h3>
                  <p style={{ margin: 0, color: '#555', fontSize: '12px' }}>
                    {projectExportData.bounceMode === 'realtime'
                      ? 'Capturing the live master bus'
                      : `High-fidelity ${projectExportData.type.toUpperCase()} master`}
                  </p>

                  {projectExportData.bounceMode === 'realtime' && (
                    <div style={{ margin: '18px auto 0', width: '100%', maxWidth: '280px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '4px 8px', borderRadius: '999px', background: 'rgba(255,107,107,0.12)', border: '1px solid rgba(255,107,107,0.25)', color: '#ff6b6b', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ff6b6b', display: 'inline-block', animation: 'pulse 1s ease-in-out infinite' }} />
                          Recording
                        </div>
                        <div style={{ color: '#aaa', fontSize: '11px', fontWeight: 700 }}>
                          {formatExportSeconds(projectExportData.renderElapsedSeconds)} / {formatExportSeconds(projectExportData.renderTotalSeconds)}
                        </div>
                      </div>
                      <div style={{ height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ height: '100%', width: `${clamp(projectExportData.progress ?? 0, 0, 100)}%`, background: '#ff6b6b', transition: 'width 0.12s linear' }} />
                      </div>
                    </div>
                  )}

                  <button
                    onClick={cancelProjectExport}
                    style={{
                      marginTop: '24px',
                      padding: '8px 20px',
                      borderRadius: '8px',
                      background: 'rgba(255,59,48,0.15)',
                      color: '#ff453a',
                      border: '1px solid rgba(255,59,48,0.3)',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255,59,48,0.25)'
                      e.currentTarget.style.borderColor = 'rgba(255,59,48,0.5)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255,59,48,0.15)'
                      e.currentTarget.style.borderColor = 'rgba(255,59,48,0.3)'
                    }}
                  >
                    Cancel Export
                  </button>
                </div>
              ) : (() => {
                const pitchSnapEnabled = useStore.getState().pitchSnapEnabled
                const customSynthRows = useStore.getState().customSynthRows
                const exportTracksList = projectExportData.trackIds && projectExportData.trackIds.length > 0
                  ? tracks.filter(t => projectExportData.trackIds!.includes(t.id))
                  : projectExportData.trackId
                    ? tracks.filter(t => t.id === projectExportData.trackId)
                    : tracks
                const hasMicrotonalTracks = exportTracksList.some(t => t.instrument === 'synth' && t.edoDivision && t.edoDivision !== 12)
                const isMidiDisabled = (!pitchSnapEnabled || customSynthRows.length > 0) && !hasMicrotonalTracks && !(projectExportData.exportScalaWithMidi ?? true)
                const isAudioFormat = projectExportData.type === 'wav' || projectExportData.type === 'mp3'

                return (
                  <>
                    {/* Format Selector Bar */}
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                        <IconDownload size={14} style={{ color: '#aaa' }} />
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Export Format</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
                        {([
                          { id: 'wav' as const, label: 'WAV', desc: 'Audio', color: '#4dabf7', disabled: false },
                          { id: 'mp3' as const, label: 'MP3', desc: 'Audio', color: '#00e6ff', disabled: false },
                          { id: 'midi' as const, label: 'MIDI', desc: isMidiDisabled ? '12-TET Only' : hasMicrotonalTracks ? '+ Scala' : 'Standard', color: '#ffd43b', disabled: isMidiDisabled },
                          { id: 'scala' as const, label: 'Scala', desc: '.scl Tuning', color: '#ff922b', disabled: false },
                          { id: 'musicxml' as const, label: 'Score', desc: 'MusicXML', color: '#da77f2', disabled: false },
                          { id: 'muztrack' as const, label: '.muztrack', desc: 'EDO Grid', color: '#69db7c', disabled: false },
                        ] as const).map(fmt => {
                          const isSelected = projectExportData.type === fmt.id
                          return (
                            <button
                              key={fmt.id}
                              onClick={() => {
                                if (fmt.disabled) return
                                setProjectExportData({ ...projectExportData, type: fmt.id })
                              }}
                              title={fmt.disabled ? 'Standard MIDI is disabled on non-scale free grid. Use Scala, MusicXML or .muztrack!' : fmt.label}
                              style={{
                                padding: '8px 4px',
                                borderRadius: '10px',
                                border: isSelected ? `1.5px solid ${fmt.color}` : '1px solid rgba(255,255,255,0.06)',
                                background: isSelected ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)',
                                color: fmt.disabled ? '#555' : isSelected ? '#fff' : '#aaa',
                                cursor: fmt.disabled ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '2px',
                                opacity: fmt.disabled ? 0.45 : 1,
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span style={{ fontSize: '12px', fontWeight: 800, color: fmt.disabled ? '#666' : isSelected ? fmt.color : '#ccc' }}>
                                {fmt.label}
                              </span>
                              <span style={{ fontSize: '9px', fontWeight: 600, opacity: 0.7 }}>
                                {fmt.desc}
                              </span>
                            </button>
                          )
                        })}
                      </div>

                      {isMidiDisabled && projectExportData.type === 'midi' && (
                        <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255, 107, 107, 0.1)', border: '1px solid rgba(255, 107, 107, 0.3)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <IconInfo size={14} style={{ color: '#ff6b6b', flexShrink: 0, marginTop: '2px' }} />
                          <span style={{ fontSize: '11px', color: '#ffc9c9', lineHeight: 1.4 }}>
                            <strong>Free Grid Active:</strong> Unlocked free pitch grid cannot be exported as standard MIDI semitones. Please switch to <strong>Scala (.scl)</strong>, <strong>MusicXML</strong>, or <strong>.muztrack</strong>.
                          </span>
                        </div>
                      )}

                      {hasMicrotonalTracks && projectExportData.type === 'midi' && !isMidiDisabled && (
                        <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255, 146, 43, 0.08)', border: '1px solid rgba(255, 146, 43, 0.25)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <IconZap size={14} style={{ color: '#ff922b', flexShrink: 0, marginTop: '2px' }} />
                          <span style={{ fontSize: '11px', color: '#ffd8a8', lineHeight: 1.4 }}>
                            <strong>Microtonal EDO Scale Detected:</strong> Exporting MIDI paired with a companion <strong>Scala (.scl)</strong> tuning file. Load the .scl file into your VST synthesizer (Vital, Surge XT, Serum, Pianoteq) to instantly retune your instruments!
                          </span>
                        </div>
                      )}

                      {projectExportData.type === 'scala' && (
                        <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255, 146, 43, 0.08)', border: '1px solid rgba(255, 146, 43, 0.25)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <IconSliders size={14} style={{ color: '#ff922b', flexShrink: 0, marginTop: '2px' }} />
                          <span style={{ fontSize: '11px', color: '#ffd8a8', lineHeight: 1.4 }}>
                            <strong>Huygens-Fokker Scala (.scl) Tuning File:</strong> Generates a precision microtonal tuning file for {exportTracksList[0]?.edoDivision || 12}-EDO. Universally supported by software synths (Surge XT, Vital, Serum, Pianoteq, Kontakt, DecentSampler).
                          </span>
                        </div>
                      )}

                      {projectExportData.type === 'musicxml' && (
                        <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(218, 119, 242, 0.08)', border: '1px solid rgba(218, 119, 242, 0.25)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <IconMusic size={14} style={{ color: '#da77f2', flexShrink: 0, marginTop: '2px' }} />
                          <span style={{ fontSize: '11px', color: '#eebefa', lineHeight: 1.4 }}>
                            <strong>MusicXML Score Export:</strong> Generates sheet music notation with microtonal accidentals (quarter-tones 𝄳/𝄱 and exact decimal &lt;alter&gt; tags) compatible with MuseScore, Dorico, Sibelius, and Finale.
                          </span>
                        </div>
                      )}

                      {projectExportData.type === 'muztrack' && (
                        <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(105, 219, 124, 0.08)', border: '1px solid rgba(105, 219, 124, 0.25)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <IconDownload size={14} style={{ color: '#69db7c', flexShrink: 0, marginTop: '2px' }} />
                          <span style={{ fontSize: '11px', color: '#b2f2bb', lineHeight: 1.4 }}>
                            <strong>MuseGrid .muztrack Format:</strong> Losslessly preserves arbitrary EDO divisions (e.g. 19, 24, 31, 53-EDO), exact continuous floating-point pitches, pitch bends, vocal lyrics, and synth parameters.
                          </span>
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                        <IconSettings size={14} style={{ color: '#aaa' }} />
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Transformation</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', display: 'block' }}>Octave Shift</span>
                            <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff', marginTop: '1px' }}>{projectExportData.octaveOffset > 0 ? `+${projectExportData.octaveOffset}` : projectExportData.octaveOffset} Oct</div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => setProjectExportData({ ...projectExportData, octaveOffset: clamp(projectExportData.octaveOffset - 1, -3, 3) })} style={{ ...buttonStyle('#ff9900'), width: '28px', height: '28px', padding: 0, fontSize: '14px' }}>-</button>
                            <button onClick={() => setProjectExportData({ ...projectExportData, octaveOffset: clamp(projectExportData.octaveOffset + 1, -3, 3) })} style={{ ...buttonStyle('#ff9900'), width: '28px', height: '28px', padding: 0, fontSize: '14px' }}>+</button>
                          </div>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', display: 'block' }}>Semitone Transpose</span>
                            <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff', marginTop: '1px' }}>{projectExportData.semitoneOffset > 0 ? `+${projectExportData.semitoneOffset}` : projectExportData.semitoneOffset} ST</div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => setProjectExportData({ ...projectExportData, semitoneOffset: clamp(projectExportData.semitoneOffset - 1, -12, 12) })} style={{ ...buttonStyle('#4dabf7'), width: '28px', height: '28px', padding: 0, fontSize: '14px' }}>-</button>
                            <button onClick={() => setProjectExportData({ ...projectExportData, semitoneOffset: clamp(projectExportData.semitoneOffset + 1, -12, 12) })} style={{ ...buttonStyle('#4dabf7'), width: '28px', height: '28px', padding: 0, fontSize: '14px' }}>+</button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                        <IconTimeline size={14} style={{ color: '#aaa' }} />
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Temporal Range</span>
                      </div>
                      {/* Multi-Region Export Option */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '10px' }}>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>Multi-Region Export Mode</div>
                          <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>Select multiple timeline ranges to stitch</div>
                        </div>
                        <ToggleSwitch
                          checked={exportRegionMode}
                          onChange={v => {
                            setExportRegionMode(v)
                          }}
                          color="#12b886"
                        />
                      </div>

                      {exportRegionMode && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', padding: '12px', background: 'rgba(18,184,134,0.03)', border: '1px dashed rgba(18,184,134,0.2)', borderRadius: '12px' }}>
                          <div style={{ fontSize: '10px', color: '#8b92a5', fontWeight: 500, lineHeight: '1.4', display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                            <IconInfo size={13} style={{ color: '#12b886', flexShrink: 0, marginTop: '1px' }} />
                            <span><strong>How to select:</strong> Click and drag on the timeline or grid to select a region. Hold <strong>Ctrl</strong> to select multiple parts. Right-click inside a region to delete it.</span>
                          </div>
                          {exportRegions.length === 0 ? (
                            <div style={{ fontSize: '11px', color: '#555', textAlign: 'center', padding: '10px 0' }}>No regions selected yet. Drag on the grid to create one.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {exportRegions.map((region, idx) => (
                                <div key={region.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '6px 10px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: '#12b886', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      {idx + 1}
                                    </div>
                                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#eee' }}>
                                      {Math.round(region.startTick)} - {Math.round(region.endTick)} t
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <span style={{ fontSize: '9px', color: '#555', fontWeight: 800, textTransform: 'uppercase' }}>Gap (s)</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="60"
                                        step="0.1"
                                        value={region.gap}
                                        onMouseDown={e => e.stopPropagation()}
                                        onMouseUp={e => e.stopPropagation()}
                                        onClick={e => e.stopPropagation()}
                                        onKeyDown={e => e.stopPropagation()}
                                        onChange={e => {
                                          const val = Math.max(0, parseFloat(e.target.value) || 0)
                                          updateExportRegionGap(region.id, val)
                                        }}
                                        style={{ width: '45px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: '#fff', fontSize: '11px', textAlign: 'center', outline: 'none', padding: '2px 0' }}
                                      />
                                    </div>
                                    <button
                                      onClick={() => removeExportRegion(region.id)}
                                      style={{ background: 'none', border: 'none', color: '#fa5252', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                    >
                                      <IconTrash size={12} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {!exportRegionMode && loopEnabled && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '10px' }}>
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>Export Loop Region Only</div>
                            <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>({loopStart} to {loopEnd} ticks)</div>
                          </div>
                          <ToggleSwitch
                            checked={projectExportData.startTick === loopStart && projectExportData.endTick === loopEnd}
                            onChange={v => {
                              const lastTick = notes.length > 0 ? Math.max(...notes.map(n => n.time + n.duration)) : 768
                              setProjectExportData({
                                ...projectExportData,
                                startTick: v ? loopStart : 0,
                                endTick: v ? loopEnd : lastTick
                              })
                            }}
                            color="#12b886"
                          />
                        </div>
                      )}
                      {!exportRegionMode && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '10px 16px' }}>
                            <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', display: 'block' }}>Start Tick</span>
                            <input
                              type="number"
                              step="any"
                              value={projectExportData.startTick ?? 0}
                              onMouseDown={e => e.stopPropagation()}
                              onMouseUp={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                              onChange={e => setProjectExportData({ ...projectExportData, startTick: parseFloat(e.target.value) || 0 })}
                              style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 800, outline: 'none', marginTop: '4px' }}
                            />
                          </div>
                          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '10px 16px' }}>
                            <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', display: 'block' }}>End Tick</span>
                            <input
                              type="number"
                              step="any"
                              value={projectExportData.endTick ?? 0}
                              onMouseDown={e => e.stopPropagation()}
                              onMouseUp={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                              onChange={e => setProjectExportData({ ...projectExportData, endTick: parseFloat(e.target.value) || 0 })}
                              style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 800, outline: 'none', marginTop: '4px' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {isAudioFormat && (
                      <div style={{ marginBottom: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                          <IconSpeaker size={14} style={{ color: '#aaa' }} />
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Render Engine</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '12px 16px' }}>
                            <div style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', marginBottom: '8px' }}>Bounce Mode</div>
                            <div style={{ display: 'flex', gap: '0', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                              {([
                                { value: 'offline' as const, label: 'Offline (Fast)', color: '#4dabf7' },
                                { value: 'realtime' as const, label: 'Real-Time (1:1)', color: '#ff6b6b' },
                              ] as const).map(opt => {
                                const isActive = (projectExportData.bounceMode ?? 'offline') === opt.value
                                return (
                                  <button
                                    key={opt.value}
                                    onClick={() => setProjectExportData({ ...projectExportData, bounceMode: opt.value })}
                                    style={{
                                      flex: 1,
                                      padding: '8px 12px',
                                      background: isActive ? `${opt.color}22` : 'rgba(0,0,0,0.2)',
                                      border: 'none',
                                      borderRight: opt.value === 'offline' ? '1px solid rgba(255,255,255,0.1)' : 'none',
                                      color: isActive ? opt.color : '#666',
                                      fontSize: '11px',
                                      fontWeight: isActive ? 800 : 600,
                                      cursor: 'pointer',
                                      transition: 'all 0.2s',
                                    }}
                                  >
                                    {opt.label}
                                  </button>
                                )
                              })}
                            </div>
                            <div style={{ fontSize: '10px', color: '#555', marginTop: '6px', lineHeight: 1.4 }}>
                              {(projectExportData.bounceMode ?? 'offline') === 'offline'
                                ? 'Renders faster than real-time using an offline audio context.'
                                : 'Records the live mix output. Guarantees 1:1 match with what you hear.'}
                            </div>
                          </div>

                          {(projectExportData.bounceMode === 'realtime') && (
                            <RealtimeTailBufferControl
                              value={projectExportData.realtimeTailSeconds ?? 2}
                              onChange={value => setProjectExportData({ ...projectExportData, realtimeTailSeconds: value })}
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {isAudioFormat && (
                      <div style={{ marginBottom: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                          <IconSpeaker size={14} style={{ color: '#aaa' }} />
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mastering & Extras</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>Auto-Normalization</div>
                            <ToggleSwitch checked={projectExportData.normalize} onChange={v => setProjectExportData({ ...projectExportData, normalize: v })} color="#4dabf7" />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>Auto-Fade Out</div>
                            <ToggleSwitch checked={projectExportData.autoFade} onChange={v => setProjectExportData({ ...projectExportData, autoFade: v })} color="#ff9900" />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>Include Procedural FX</div>
                            <ToggleSwitch checked={!!projectExportData.includeProceduralFx} onChange={v => setProjectExportData({ ...projectExportData, includeProceduralFx: v })} color="#4dabf7" disabled={!studioSettings.proceduralFxEnabled} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>Include Metronome</div>
                            <ToggleSwitch checked={projectExportData.includeMetronome} onChange={v => setProjectExportData({ ...projectExportData, includeMetronome: v })} color="#da77f2" />
                          </div>
                          {projectExportData.type === 'wav' && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>WAV Bit Depth</div>
                              <StopPropSelect
                                value={String(projectExportData.bitDepth ?? 24)}
                                onChange={e => setProjectExportData({ ...projectExportData, bitDepth: parseInt(e.target.value, 10) as NativeBitDepth })}
                                style={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '11px', outline: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}
                              >
                                <option value="16">16-bit</option>
                                <option value="24">24-bit</option>
                                <option value="32">32-bit float</option>
                              </StopPropSelect>
                            </div>
                          )}
                          {projectExportData.type === 'mp3' && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>MP3 Quality</div>
                              <StopPropSelect
                                value={projectExportData.mp3Kbps ?? 320}
                                onChange={e => setProjectExportData({ ...projectExportData, mp3Kbps: parseInt(e.target.value, 10) })}
                                style={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '11px', outline: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}
                              >
                                <option value="128">128 kbps</option>
                                <option value="192">192 kbps</option>
                                <option value="256">256 kbps</option>
                                <option value="320">320 kbps</option>
                              </StopPropSelect>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Scala (.scl) Companion & Tuning Section */}
                    {(projectExportData.type === 'midi' || projectExportData.type === 'scala' || hasMicrotonalTracks) && (
                      <div style={{ marginBottom: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                          <IconSliders size={14} style={{ color: '#aaa' }} />
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Scala (.scl) Tuning Options</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: '#eee' }}>Export Scala (.scl) Tuning File</div>
                              <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
                                {projectExportData.type === 'midi'
                                  ? `Generates companion .scl tuning file for ${exportTracksList[0]?.edoDivision || 12}-EDO alongside MIDI`
                                  : `Generates .scl file for ${exportTracksList[0]?.edoDivision || 12}-EDO VST tuning`}
                              </div>
                            </div>
                            <ToggleSwitch
                              checked={projectExportData.exportScalaWithMidi ?? true}
                              onChange={v => setProjectExportData({ ...projectExportData, exportScalaWithMidi: v })}
                              color="#ff922b"
                            />
                          </div>
                          {projectExportData.type === 'midi' && (
                            <div style={{ padding: '8px 12px', background: 'rgba(255,146,43,0.04)', borderRadius: '8px', border: '1px solid rgba(255,146,43,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '10px', color: '#ffd8a8' }}>Quick 1-Click: Download only the Scala (.scl) file</span>
                              <button
                                onClick={() => exportTrackScala(exportTracksList[0])}
                                style={{
                                  background: 'rgba(255,146,43,0.15)',
                                  border: '1px solid rgba(255,146,43,0.3)',
                                  color: '#ff922b',
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                Download .scl
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      disabled={projectExportData.type === 'midi' && isMidiDisabled}
                      onClick={
                        projectExportData.type === 'midi' ? executeMidiExport :
                          projectExportData.type === 'scala' ? executeScalaExport :
                            projectExportData.type === 'musicxml' ? executeScoreExport :
                              projectExportData.type === 'muztrack' ? executeMuzTrackExport :
                                executeAudioExport
                      }
                      style={{
                        width: '100%',
                        padding: '14px',
                        borderRadius: '12px',
                        background: (projectExportData.type === 'midi' && isMidiDisabled)
                          ? 'rgba(255,255,255,0.02)'
                          : 'rgba(255,255,255,0.07)',
                        color: (projectExportData.type === 'midi' && isMidiDisabled) ? '#555' : 'white',
                        border: '1px solid rgba(255,255,255,0.15)',
                        fontSize: '14px',
                        fontWeight: 700,
                        cursor: (projectExportData.type === 'midi' && isMidiDisabled) ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => {
                        if (projectExportData.type === 'midi' && isMidiDisabled) return
                        e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={e => {
                        if (projectExportData.type === 'midi' && isMidiDisabled) return
                        e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }}
                    >
                      {projectExportData.type === 'midi' && isMidiDisabled
                        ? 'MIDI Disabled on Free Grid'
                        : projectExportData.type === 'scala'
                          ? 'Download Scala (.scl) Tuning File'
                          : projectExportData.type === 'midi' && (projectExportData.exportScalaWithMidi ?? true)
                            ? 'Start MIDI + Scala (.scl) Export'
                            : `Start ${projectExportData.type === 'musicxml' ? 'MusicXML' :
                              projectExportData.type === 'muztrack' ? '.muztrack' :
                                projectExportData.type.toUpperCase()
                            } Export`
                      }
                    </button>
                  </>
                )
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}
      {isMidiLabInjecting && activeLabTrack && createPortal(
        <div className="animate-modal-bg" style={{ position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="animate-modal-card" style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px', boxShadow: '0 30px 70px rgba(0,0,0,0.85)', overflow: 'hidden', background: '#12131a' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', color: 'white', letterSpacing: '-0.5px' }}>Target Selection</h3>
                <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#4dabf7', fontWeight: 700 }}>Preparing {activeLabTrack.name || 'Lab Track'}</p>
              </div>
              <button onClick={() => { setIsMidiLabInjecting(false); setActiveLabTrack(null) }} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.12em', display: 'block', marginBottom: '10px' }}>Import into Track</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '180px', overflowY: 'auto' }} className="thin-scroll">
                  {tracks.map(t => (
                    <button
                      key={t.id}
                      onClick={() => handleMidiLabInject(t.id)}
                      style={{
                        width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.02)',
                        color: 'white', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.color }} />
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '15px' }}>
                <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.12em', display: 'block', marginBottom: '10px' }}>Create New Destination</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    onClick={() => handleMidiLabInject('new-synth')}
                    style={{ ...buttonStyle('#4dabf7'), padding: '12px', fontSize: '10px', fontWeight: 800 }}
                  >
                    SYNTH
                  </button>
                  <button
                    onClick={() => handleMidiLabInject('new-drum')}
                    style={{ ...buttonStyle('#ff9900'), padding: '12px', fontSize: '10px', fontWeight: 800 }}
                  >
                    PERCUSSION
                  </button>

                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showDeleteConfirm && createPortal(
        <div className={deleteConfirmClosing ? "animate-modal-bg-exit" : "animate-modal-bg"} style={{ position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          {/* Subtle click-catcher container */}
          <div
            onClick={closeDeleteConfirm}
            style={{ position: 'absolute', inset: 0 }}
          />
          <div className={`${deleteConfirmClosing ? "animate-modal-card-exit" : "animate-modal-card"}`} style={{ position: 'relative', width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px', boxShadow: '0 30px 70px rgba(0,0,0,0.85)', overflow: 'hidden', background: '#12131a' }}>
            <div style={{ padding: '24px', textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(255,80,80,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto', border: '1px solid rgba(255,80,80,0.3)' }}>
                <IconX size={24} color="#ff6b6b" />
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '17px', color: 'white', fontWeight: 800, letterSpacing: '-0.3px' }}>Delete Custom FX?</h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#aaa', lineHeight: 1.5, fontWeight: 500 }}>
                Are you sure you want to delete this custom FX config? This cannot be undone.
              </p>
            </div>
            <div style={{ padding: '16px 24px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '12px' }}>
              <button
                onClick={closeDeleteConfirm}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#aaa', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = '#aaa'}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteCustomFxConfig(activeCustomFxId)
                  setActiveCustomFxId(customFxConfigs.find(c => c.id !== activeCustomFxId)?.id || '')
                  closeDeleteConfirm()
                }}
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
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {nTimesPromptTrackId && createPortal(
        <div className="animate-modal-bg" style={{ position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="animate-modal-card" style={{ position: 'relative', width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px', boxShadow: '0 30px 70px rgba(0,0,0,0.85)', overflow: 'hidden', background: '#12131a' }}>
            <div style={{ padding: '20px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', color: 'white', fontWeight: 800, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: '8px' }}><IconLoop size={16} style={{ color: '#ffd43b' }} /> {nTimesPromptTrackId.multi ? 'Loop Tracks' : 'Loop Track'}</h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#aaa', fontWeight: 500, lineHeight: 1.4 }}>
                How many times would you like to loop {nTimesPromptTrackId.multi ? 'these tracks\'' : 'this track\'s'} sequence?
              </p>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: '14px', color: '#888', fontSize: '15px', fontWeight: 700 }}>N =</span>
                <input
                  type="number"
                  min="1"
                  autoFocus
                  placeholder="e.g. 4"
                  value={nTimesInput}
                  onChange={e => setNTimesInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const times = Math.min(1000, Number(nTimesInput))
                      if (!isNaN(times) && times > 0) {
                        if (nTimesPromptTrackId.multi) {
                          selectedTrackIds.forEach(id => loopTrack(id, 'nTimes', false, times))
                        } else {
                          loopTrack(nTimesPromptTrackId.id, 'nTimes', false, times)
                        }
                      }
                      setNTimesPromptTrackId(null)
                    }
                    if (e.key === 'Escape') setNTimesPromptTrackId(null)
                  }}
                  style={{ width: '100%', padding: '10px 14px 10px 45px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '15px', fontWeight: 600, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div style={{ padding: '16px 20px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setNTimesPromptTrackId(null)}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#aaa', fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = '#aaa'}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const times = Math.min(1000, Number(nTimesInput))
                  if (!isNaN(times) && times > 0) {
                    if (nTimesPromptTrackId.multi) {
                      selectedTrackIds.forEach(id => loopTrack(id, 'nTimes', false, times))
                    } else {
                      loopTrack(nTimesPromptTrackId.id, 'nTimes', false, times)
                    }
                  }
                  setNTimesPromptTrackId(null)
                }}
                style={{ flex: 1, border: 'none', background: '#ffd43b', color: '#000', borderRadius: '8px', padding: '10px', fontSize: '12px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#ffcc00'}
                onMouseLeave={e => e.currentTarget.style.background = '#ffd43b'}
              >
                Loop
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {sheetImportData && createPortal(
        <div className="animate-modal-bg" style={{ position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="animate-modal-card" style={{ width: '100%', maxWidth: '460px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px', boxShadow: '0 30px 70px rgba(0,0,0,0.85)', overflow: 'hidden', background: '#12131a' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(77,171,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconMusic size={18} style={{ color: '#4dabf7' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', color: 'white', letterSpacing: '-0.3px', fontWeight: 800 }}>MusicXML Import</h3>
                  <p style={{ margin: '1px 0 0', fontSize: '10px', color: '#666', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }}>{sheetImportData.filename}</p>
                </div>
              </div>
              <button onClick={() => setSheetImportData(null)} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '70vh', overflowY: 'auto' }} className="thin-scroll">
              {/* Tempo Sync */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Source BPM</span>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: '#fff', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      value={Math.round(sheetImportData.parsedBpm || 120)}
                      onChange={(e) => {
                        const val = Number(e.target.value)
                        if (!val || val <= 0) return
                        setSheetImportData(d => d ? { ...d, parsedBpm: val } : null)
                      }}
                      style={{
                        width: '55px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        padding: '2px 6px',
                        outline: 'none',
                        textAlign: 'center'
                      }}
                    />
                    <span style={{ color: '#444', fontSize: '10px' }}>BPM</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '10px', color: '#888', fontWeight: 600 }}>Inherit Tempo</span>
                  <ToggleSwitch checked={sheetImportData.inheritTempo} onChange={v => setSheetImportData(d => d ? { ...d, inheritTempo: v } : null)} color="#ff9900" />
                </div>
              </div>

              {/* Transformations */}
              <div>
                <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.12em', display: 'block', marginBottom: '8px' }}>Transformation</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Octave Correction</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button onClick={() => setSheetImportData(d => d ? { ...d, octaveOffset: d.octaveOffset - 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>-</button>
                      <span style={{ width: '20px', textAlign: 'center', fontWeight: 800, fontSize: '13px', color: '#4dabf7' }}>{sheetImportData.octaveOffset}</span>
                      <button onClick={() => setSheetImportData(d => d ? { ...d, octaveOffset: d.octaveOffset + 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>+</button>
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Pitch Transpose</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button onClick={() => setSheetImportData(d => d ? { ...d, semitoneOffset: d.semitoneOffset - 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>-</button>
                      <span style={{ width: '20px', textAlign: 'center', fontWeight: 800, fontSize: '13px', color: '#ffd43b' }}>{sheetImportData.semitoneOffset}</span>
                      <button onClick={() => setSheetImportData(d => d ? { ...d, semitoneOffset: d.semitoneOffset + 1 } : null)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}>+</button>
                    </div>
                  </div>
                  {!sheetImportData.isDrum && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Smart Mapping</div>
                        <div style={{ fontSize: '9px', color: '#444', fontWeight: 600 }}>Snap to project scale</div>
                      </div>
                      <ToggleSwitch checked={sheetImportData.smartMapping} onChange={v => setSheetImportData(d => d ? { ...d, smartMapping: v } : null)} color="#da77f2" />
                    </div>
                  )}
                </div>
              </div>

              {/* Timing & Expression Settings */}
              <div>
                <span style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.12em', display: 'block', marginBottom: '8px' }}>Timing & Expression Options</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Snap to Grid</div>
                      <div style={{ fontSize: '9px', color: '#444', fontWeight: 600 }}>Align notes to project grid steps</div>
                    </div>
                    <ToggleSwitch checked={sheetImportData.snapToGrid} onChange={v => setSheetImportData(d => d ? { ...d, snapToGrid: v } : null)} color="#ff9900" />
                  </div>
                  {!sheetImportData.isDrum && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Import Glissandos & Slides</div>
                        <div style={{ fontSize: '9px', color: '#444', fontWeight: 600 }}>Parse pitch slides into note properties</div>
                      </div>
                      <ToggleSwitch checked={sheetImportData.importPitchSlides} onChange={v => setSheetImportData(d => d ? { ...d, importPitchSlides: v } : null)} color="#4dabf7" />
                    </div>
                  )}
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Import Dynamics as Velocity</div>
                      <div style={{ fontSize: '9px', color: '#444', fontWeight: 600 }}>Parse sheet dynamics into note velocities</div>
                    </div>
                    <ToggleSwitch checked={sheetImportData.importVelocity} onChange={v => setSheetImportData(d => d ? { ...d, importVelocity: v } : null)} color="#20c997" />
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>Default Fallback Velocity</div>
                      <div style={{ fontSize: '9px', color: '#444', fontWeight: 600 }}>Value used for notes without dynamics</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AppSlider
                        min={1}
                        max={127}
                        value={sheetImportData.defaultVelocity}
                        color="#20c997"
                        width="80px"
                        onChange={val => setSheetImportData(d => d ? { ...d, defaultVelocity: val } : null)}
                      />
                      <span style={{ width: '24px', textAlign: 'right', fontWeight: 800, fontSize: '12px', color: '#20c997' }}>{sheetImportData.defaultVelocity}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Import Button */}
              <button
                onClick={executeSheetImport}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.07)',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.15)',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  marginTop: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
                  e.currentTarget.style.transform = 'translateY(-1px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                <IconMusic size={15} /> IMPORT SHEET DATA
              </button>
            </div>
            <div style={{ padding: '12px', background: 'rgba(0,0,0,0.1)', borderTop: '1px solid rgba(255,255,255,0.03)', textAlign: 'center', fontSize: '9px', color: '#333', fontWeight: 600, letterSpacing: '0.05em' }}>
              TIP: ACTIVATE GLISSANDO IMPORT FOR DYNAMIC EXPRESSIVE SYNTH LINES
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
