import type { CSSProperties, FC } from 'react'

export function sliderProgress(value: number, min: number, max: number): string {
  if (max <= min) return '0%'
  return `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`
}

/** Range control with the shared .modern-slider geometry; only colour and value vary per call site. */
export const AppSlider: FC<{
  value: number
  min: number
  max: number
  step?: number
  color?: string
  width?: string
  compact?: boolean
  disabled?: boolean
  title?: string
  onChange: (value: number) => void
}> = ({ value, min, max, step = 1, color = '#4dabf7', width = '100%', compact = false, disabled, title, onChange }) => (
  <input
    type="range"
    className={compact ? 'modern-slider compact-slider' : 'modern-slider'}
    min={min}
    max={max}
    step={step}
    value={value}
    disabled={disabled}
    title={title}
    onChange={e => onChange(Number(e.target.value))}
    style={{ width, '--slider-color': color, '--slider-progress': sliderProgress(value, min, max), accentColor: color } as CSSProperties}
  />
)
