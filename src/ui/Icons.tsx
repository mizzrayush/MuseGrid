// Central SVG icon library — all icons are 16×16 viewbox, stroke-based
interface IconProps { size?: number; className?: string; style?: React.CSSProperties; title?: string; color?: string; fill?: string }

const S = ({ size = 16, title, children, color, fill = "none", style, ...rest }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...style, color }} {...rest}>
    {title && <title>{title}</title>}
    {children}
  </svg>
)

export const IconPencil   = (p: IconProps) => <S {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></S>
export const IconEraser   = (p: IconProps) => <S {...p}><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></S>
export const IconCursor   = (p: IconProps) => <S {...p}><path d="m4 4 7.07 17 2.51-7.39L21 11.07Z"/></S>
export const IconScissors = (p: IconProps) => <S {...p}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></S>
export const IconUndo     = (p: IconProps) => <S {...p}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></S>
export const IconRedo     = (p: IconProps) => <S {...p}><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></S>
export const IconLoop     = (p: IconProps) => <S {...p}><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></S>
export const IconPlay     = ({ fill = "currentColor", ...p }: IconProps) => <S {...p}><polygon points="5 3 19 12 5 21 5 3" fill={fill}/></S>
export const IconStop     = ({ fill = "currentColor", ...p }: IconProps) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" fill={fill}/></S>
export const IconMusic    = (p: IconProps) => <S {...p}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></S>
export const IconDrum     = (p: IconProps) => <S {...p}><ellipse cx="12" cy="9" rx="9" ry="4"/><path d="M3 9v4a9 4 0 0 0 18 0V9"/><line x1="12" y1="13" x2="12" y2="22"/></S>
export const IconSave     = (p: IconProps) => <S {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></S>
export const IconOpen     = (p: IconProps) => <S {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></S>
export const IconDownload = (p: IconProps) => <S {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></S>
export const IconUpload   = (p: IconProps) => <S {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></S>
export const IconTrash    = (p: IconProps) => <S {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></S>
export const IconEdit     = (p: IconProps) => <S {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></S>
export const IconMute     = (p: IconProps) => <S {...p}><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></S>
export const IconSolo     = (p: IconProps) => <S {...p}><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></S>
export const IconChord    = (p: IconProps) => <S {...p}><rect x="2" y="8" width="4" height="10" rx="1"/><rect x="9" y="4" width="4" height="14" rx="1"/><rect x="16" y="6" width="4" height="12" rx="1"/></S>
export const IconNewFile  = (p: IconProps) => <S {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></S>
export const IconMidi     = (p: IconProps) => <S {...p}><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4"/><path d="M10 10v4"/><circle cx="13" cy="10" r="1" fill="currentColor"/><path d="M16 10v4"/></S>
export const IconStretch  = (p: IconProps) => <S {...p}><path d="M21 12H3"/><path d="m15 6 6 6-6 6"/><path d="m9 6-6 6 6 6"/></S>
export const IconTimeline = (p: IconProps) => <S {...p}><path d="M3 5v14h18"/><path d="M9 9h10"/><path d="M9 13h10"/><path d="M9 17h10"/></S>
export const IconAlign    = (p: IconProps) => <S {...p}><path d="M4 6h16"/><path d="M4 18h16"/><path d="M12 3v18"/><path d="m8 10-4 2 4 2"/><path d="m16 10 4 2-4 2"/></S>
export const IconPin      = (p: IconProps) => <S {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></S>
export const IconSkipBack = (p: IconProps) => <S {...p}><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></S>
export const IconChevronRight = (p: IconProps) => <S {...p}><polyline points="9 18 15 12 9 6"/></S>
export const IconChevronDown  = (p: IconProps) => <S {...p}><polyline points="6 9 12 15 18 9"/></S>
export const IconPalette      = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="7.5" r="1.5" fill="currentColor" /><circle cx="7.5" cy="12" r="1.5" fill="currentColor" /><circle cx="16.5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="16.5" r="1.5" fill="currentColor" /></S>
export const IconSettings     = (p: IconProps) => <S {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2a2 2 0 0 1-2 2a2 2 0 0 0-2 2a2 2 0 0 1-2 2a2 2 0 0 0-2 2v.44a2 2 0 0 0 2 2a2 2 0 0 1 2 2a2 2 0 0 0 2 2a2 2 0 0 1 2 2a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2a2 2 0 0 1 2-2a2 2 0 0 0 2-2a2 2 0 0 1 2-2a2 2 0 0 0 2-2v-.44a2 2 0 0 0-2-2a2 2 0 0 1-2-2a2 2 0 0 0-2-2a2 2 0 0 1-2-2a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></S>
export const IconSpeaker      = (p: IconProps) => <S {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6" r="1"/></S>
export const IconSync         = (p: IconProps) => <S {...p}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.72 2.24"/><path d="M21 3v9h-9"/></S>
export const IconChevronLeft   = (p: IconProps) => <S {...p}><polyline points="15 18 9 12 15 6"/></S>
export const IconMaximize   = (p: IconProps) => <S {...p}><path d="M4 8V4h4"/><path d="M16 4h4v4"/><path d="M4 16v4h4"/><path d="M20 16v4h-4"/></S>
export const IconTarget     = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="1"/><circle cx="12" cy="12" r="5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></S>
export const IconX            = (p: IconProps) => <S {...p}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></S>
export const IconVolume       = (p: IconProps) => <S {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></S>
export const IconVolumeX      = (p: IconProps) => <S {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></S>
export const IconMic          = (p: IconProps) => <S {...p}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></S>
export const IconPlus         = (p: IconProps) => <S {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></S>
export const IconWand         = (p: IconProps) => <S {...p}><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></S>
export const IconHeadphones   = (p: IconProps) => <S {...p}><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></S>
export const IconCopy         = (p: IconProps) => <S {...p}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></S>
export const IconPaste        = (p: IconProps) => <S {...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></S>
export const IconList         = (p: IconProps) => <S {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></S>
export const IconColumns      = (p: IconProps) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></S>
export const IconZap          = (p: IconProps) => <S {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></S>
export const IconSliders      = (p: IconProps) => <S {...p}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></S>
export const IconShuffle      = (p: IconProps) => <S {...p}><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></S>
export const IconArrowUp      = (p: IconProps) => <S {...p}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></S>
export const IconArrowDown    = (p: IconProps) => <S {...p}><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></S>
export const IconLayers       = (p: IconProps) => <S {...p}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></S>
export const IconFilter       = (p: IconProps) => <S {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></S>
export const IconCheck        = (p: IconProps) => <S {...p}><polyline points="20 6 9 17 4 12"/></S>
export const IconHelp         = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></S>
export const IconBook         = (p: IconProps) => <S {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></S>
export const IconAlertTriangle = (p: IconProps) => <S {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></S>
export const IconInfo         = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></S>
export const IconSparkles     = (p: IconProps) => <S {...p}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></S>
export const IconWaveform     = (p: IconProps) => <S {...p}><path d="M2 12h2l3-9 4 18 4-12 3 6 2-3h2"/></S>
export const IconPiano        = (p: IconProps) => <S {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="4" x2="6" y2="20"/><line x1="10" y1="4" x2="10" y2="20"/><line x1="14" y1="4" x2="14" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/><rect x="4.5" y="4" width="3" height="9" fill="currentColor"/><rect x="8.5" y="4" width="3" height="9" fill="currentColor"/><rect x="16.5" y="4" width="3" height="9" fill="currentColor"/></S>
export const IconTerminal     = (p: IconProps) => <S {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></S>
export const IconSearch       = (p: IconProps) => <S {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></S>
export const IconAlertCircle  = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></S>


export const IconMuseLogo = ({ size = 24, style, className }: { size?: number; style?: React.CSSProperties; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      display: 'inline-block',
      verticalAlign: 'middle',
      flexShrink: 0,
      ...style
    }}
    className={className}
  >
    <defs>
      <linearGradient id="mg-logo-bg" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1e202e" />
        <stop offset="100%" stopColor="#101118" />
      </linearGradient>
      <linearGradient id="mg-bar-grad1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#00e6ff" />
        <stop offset="100%" stopColor="#0077ff" />
      </linearGradient>
      <linearGradient id="mg-bar-grad2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ff3366" />
        <stop offset="100%" stopColor="#ff6b3b" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#mg-logo-bg)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
    <rect x="5.5" y="10" width="2.5" height="8" rx="1.25" fill="url(#mg-bar-grad1)" />
    <rect x="9.5" y="5.5" width="2.5" height="12.5" rx="1.25" fill="url(#mg-bar-grad1)" />
    <rect x="13.5" y="8" width="2.5" height="10" rx="1.25" fill="url(#mg-bar-grad2)" />
    <rect x="17.5" y="12" width="2.5" height="6" rx="1.25" fill="url(#mg-bar-grad2)" />
    <circle cx="6.75" cy="6.5" r="1.2" fill="#00e6ff" opacity="0.9" />
    <circle cx="18.75" cy="8.5" r="1.2" fill="#ff3366" opacity="0.9" />
  </svg>
)





