import { useState } from 'react'
import { AppSlider } from './AppSlider'

export const ACCENT = '#ff922b'

export const sectionTitle = (text: string) => (
  <div style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: '6px' }}>{text}</div>
)

export const chipStyle = (active: boolean, color = '#fff') => ({
  flex: 1,
  padding: '4px 6px',
  borderRadius: '4px',
  border: '1px solid transparent',
  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
  color: active ? color : '#666',
  fontSize: '9px',
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  whiteSpace: 'nowrap' as const,
})

const formatSliderValue = (value: number, suffix?: string) => {
  if (suffix === '%') return String(Math.round(value * 100))
  if (suffix === 'bars') return String(Math.round(value))
  return String(Math.round(value * 100) / 100)
}

/**
 * Labelled range control with a typable value box. The box accepts values outside the
 * slider range, so presets can be typed in even when the track only goes so far.
 */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 0.01,
  suffix,
  color = ACCENT,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  color?: string
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(() => formatSliderValue(value, suffix))
  const [prevValue, setPrevValue] = useState(value)
  const [focused, setFocused] = useState(false)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!focused) setText(formatSliderValue(value, suffix))
  }

  const commit = () => {
    const parsed = parseFloat(text)
    if (Number.isFinite(parsed)) onChange(suffix === '%' ? parsed / 100 : parsed)
    else setText(formatSliderValue(value, suffix))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
      <span style={{ width: '74px', fontSize: '10px', color: '#999', fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <AppSlider value={value} min={min} max={max} step={step} color={color} onChange={onChange} />
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit() }}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(formatSliderValue(value, suffix))
            e.currentTarget.blur()
          }
        }}
        style={{
          width: '40px',
          flexShrink: 0,
          textAlign: 'right',
          fontSize: '9.5px',
          color,
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.35)',
          border: `1px solid ${focused ? color : 'rgba(255,255,255,0.08)'}`,
          borderRadius: '4px',
          padding: '2px 4px',
          outline: 'none',
        }}
      />
      {suffix === '%' && <span style={{ width: '8px', fontSize: '9.5px', color, fontFamily: 'monospace', flexShrink: 0 }}>%</span>}
    </div>
  )
}

/** Small On/Off control used by every toggle row in the generative panes. */
export function ToggleChip({
  active,
  onLabel = 'On',
  offLabel = 'Off',
  color = '#69db7c',
  onClick,
  title,
}: {
  active: boolean
  onLabel?: string
  offLabel?: string
  color?: string
  onClick: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        ...chipStyle(active, color),
        flex: '0 0 auto',
        padding: '3px 10px',
        border: `1px solid ${active ? `${color}59` : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {active ? onLabel : offLabel}
    </button>
  )
}

/** Label + hint on the left, On/Off chip on the right. */
export function ToggleRow({
  label,
  hint,
  active,
  onClick,
  title,
}: {
  label: string
  hint?: string
  active: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: '10px', color: '#999', fontWeight: 600 }}>
        {label}
        {hint && <span style={{ color: '#666', fontWeight: 500 }}> · {hint}</span>}
      </span>
      <ToggleChip active={active} onClick={onClick} title={title} />
    </div>
  )
}
