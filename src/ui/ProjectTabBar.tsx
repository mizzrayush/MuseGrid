import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useStore, type ProjectTab } from '../engine/store'
import { IconSparkles, IconX, IconPlus } from './Icons'

interface ProjectTabBarProps {
  onRequestCloseTab?: (tab: ProjectTab) => void
}

export const ProjectTabBar: React.FC<ProjectTabBarProps> = ({ onRequestCloseTab }) => {
  const openTabs = useStore(s => s.openTabs)
  const activeTabId = useStore(s => s.activeTabId)
  const switchTab = useStore(s => s.switchTab)
  const closeTab = useStore(s => s.closeTab)
  const openStartTab = useStore(s => s.openStartTab)

  // Real-time active tab store subscriptions for instant feedback (single tab & live project edits)
  const activeIsDirty = useStore(s => s.isDirty)
  const activeNotesCount = useStore(s => s.notes.length)
  const activeProjectName = useStore(s => s.projectName)
  const activeFilePath = useStore(s => s.projectFilePath)

  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [closingTabIds, setClosingTabIds] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const hasOverflow = el.scrollWidth > el.clientWidth
    setCanScrollLeft(hasOverflow && el.scrollLeft > 2)
    setCanScrollRight(hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  const activeTabRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activeTabId])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return

    const ro = new ResizeObserver(() => checkScroll())
    ro.observe(el)
    window.addEventListener('resize', checkScroll)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', checkScroll)
    }
  }, [openTabs, activeTabId, checkScroll])

  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY !== 0 && scrollRef.current) {
      scrollRef.current.scrollLeft += e.deltaY * 0.6
      checkScroll()
    }
  }

  const handleClose = (e: React.MouseEvent, tab: ProjectTab) => {
    e.stopPropagation()
    const isActive = activeTabId === tab.id
    const hasUnsaved = isActive
      ? (activeIsDirty || (!activeFilePath && activeNotesCount > 0))
      : (tab.isDirty || (!tab.filePath && (tab.projectData?.notes?.length ?? 0) > 0))

    const resolvedTab: ProjectTab = {
      ...tab,
      isDirty: hasUnsaved,
      name: isActive ? (activeProjectName || tab.name) : tab.name,
      filePath: isActive ? activeFilePath : tab.filePath
    }

    if (hasUnsaved) {
      // Must prompt user to save via modal dialog before closing!
      if (onRequestCloseTab) {
        onRequestCloseTab(resolvedTab)
      } else {
        closeTab(tab.id)
      }
    } else {
      // Clean tab: play smooth exit collapse animation before removing from store
      setClosingTabIds(prev => new Set(prev).add(tab.id))
      setTimeout(() => {
        if (onRequestCloseTab) {
          onRequestCloseTab(resolvedTab)
        } else {
          closeTab(tab.id)
        }
        setClosingTabIds(prev => {
          const next = new Set(prev)
          next.delete(tab.id)
          return next
        })
      }, 160)
    }
  }

  const handleCloseStartTab = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (openTabs.length > 0) {
      switchTab(openTabs[0].id)
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        maxWidth: 'clamp(140px, 22vw, 320px)',
        flex: '0 1 auto',
        overflow: 'hidden'
      }}
    >
      <style>{`
        @keyframes mgTabEnter {
          0% {
            opacity: 0;
            transform: scale(0.92) translateY(2px);
            max-width: 0px;
            padding-left: 0;
            padding-right: 0;
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
            max-width: 130px;
          }
        }
        @keyframes mgDotPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.9;
          }
          50% {
            transform: scale(1.3);
            opacity: 1;
          }
        }
      `}</style>

      {/* Inner Container: Holds Scrollable Track Strictly Contained */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden'
        }}
      >
        {/* Scrollable Tabs Track */}
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          onWheel={handleWheel}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            overflowX: 'auto',
            width: '100%',
            minWidth: 0,
            padding: '2px 2px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            maskImage: canScrollLeft && canScrollRight
              ? 'linear-gradient(to right, transparent 0px, black 16px, black calc(100% - 16px), transparent 100%)'
              : canScrollLeft
                ? 'linear-gradient(to right, transparent 0px, black 16px, black 100%)'
                : canScrollRight
                  ? 'linear-gradient(to right, black 0%, black calc(100% - 16px), transparent 100%)'
                  : 'none',
            WebkitMaskImage: canScrollLeft && canScrollRight
              ? 'linear-gradient(to right, transparent 0px, black 16px, black calc(100% - 16px), transparent 100%)'
              : canScrollLeft
                ? 'linear-gradient(to right, transparent 0px, black 16px, black 100%)'
                : canScrollRight
                  ? 'linear-gradient(to right, black 0%, black calc(100% - 16px), transparent 100%)'
                  : 'none'
          }}
          className="thin-scroll"
        >
          {/* Start Tab (shown when active or when no project tabs are open) */}
          {(activeTabId === 'start' || openTabs.length === 0) && (
            <div
              onClick={() => switchTab('start')}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px 4px 10px',
                borderRadius: '7px',
                fontSize: '11px',
                fontWeight: activeTabId === 'start' ? 700 : 600,
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                background: activeTabId === 'start'
                  ? 'linear-gradient(180deg, rgba(77, 171, 247, 0.2) 0%, rgba(77, 171, 247, 0.08) 100%)'
                  : 'rgba(255, 255, 255, 0.02)',
                border: activeTabId === 'start'
                  ? '1px solid rgba(77, 171, 247, 0.45)'
                  : '1px solid rgba(255, 255, 255, 0.06)',
                boxShadow: activeTabId === 'start'
                  ? '0 3px 12px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(77, 171, 247, 0.25)'
                  : 'none',
                color: activeTabId === 'start' ? '#ffffff' : '#8b92a5',
                flexShrink: 0
              }}
              title="Start Screen (Templates, AI & Library)"
            >
              <IconSparkles size={11} style={{ color: activeTabId === 'start' ? '#4dabf7' : '#777', transition: 'color 0.2s' }} />
              <span>Start</span>

              {openTabs.length > 0 && (
                <button
                  onClick={handleCloseStartTab}
                  title="Return to Active Project"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    background: 'transparent',
                    border: 'none',
                    color: '#8899aa',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: '2px',
                    transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'
                    e.currentTarget.style.color = '#fff'
                    e.currentTarget.style.transform = 'scale(1.15)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = '#8899aa'
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                >
                  <IconX size={10} />
                </button>
              )}
            </div>
          )}

          {/* Project Tabs */}
          {openTabs.map(tab => {
            const isActive = activeTabId === tab.id
            const isHovered = hoveredTabId === tab.id
            const isClosing = closingTabIds.has(tab.id)

            const tabName = isActive ? (activeProjectName || tab.name || 'Untitled') : (tab.name || 'Untitled')
            const tabFilePath = isActive ? activeFilePath : tab.filePath

            // Real-time Dirty / Unsaved Detection:
            // Active tab reads live store state (notes & isDirty) so single-tab projects update instantaneously
            const hasUnsavedChanges = isActive
              ? (activeIsDirty || (!activeFilePath && activeNotesCount > 0))
              : (tab.isDirty || (!tab.filePath && (tab.projectData?.notes?.length ?? 0) > 0))

            const isSavedOnDisk = Boolean(tabFilePath) && !hasUnsavedChanges

            // Status Dot colors:
            // 1. Saved on disk: Green dot (#00e676)
            // 2. Unsaved changes (AI notes, edits, dirty): Amber/Orange dot (#f59f00) with pulse
            // 3. Blank empty untitled draft: Neutral muted dot (#5a627a) - never falsely marked green!
            const dotColor = hasUnsavedChanges
              ? '#f59f00'
              : isSavedOnDisk
                ? '#00e676'
                : '#5a627a'

            const dotGlow = hasUnsavedChanges
              ? '0 0 7px rgba(245, 159, 0, 0.8)'
              : isSavedOnDisk
                ? '0 0 6px rgba(0, 230, 118, 0.5)'
                : 'none'

            const statusTitle = hasUnsavedChanges
              ? 'Unsaved changes (Save to persist)'
              : isSavedOnDisk
                ? `Saved to disk: ${tabFilePath}`
                : 'Untitled draft (empty)'

            return (
              <div
                key={tab.id}
                ref={isActive ? activeTabRef : undefined}
                onClick={() => switchTab(tab.id)}
                onMouseEnter={() => setHoveredTabId(tab.id)}
                onMouseLeave={() => setHoveredTabId(null)}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: isClosing ? '4px 0' : '4px 6px 4px 8px',
                  borderRadius: '7px',
                  fontSize: '11px',
                  fontWeight: isActive ? 700 : 600,
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1), max-width 0.16s ease-out, opacity 0.16s ease-out, padding 0.16s ease-out, transform 0.16s ease-out',
                  background: isActive
                    ? 'linear-gradient(180deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.04) 100%)'
                    : isHovered
                      ? 'rgba(255, 255, 255, 0.05)'
                      : 'rgba(255, 255, 255, 0.02)',
                  border: isActive
                    ? '1px solid rgba(77, 171, 247, 0.45)'
                    : isHovered
                      ? '1px solid rgba(255, 255, 255, 0.12)'
                      : '1px solid rgba(255, 255, 255, 0.05)',
                  boxShadow: isActive
                    ? '0 3px 12px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                    : isHovered
                      ? '0 2px 8px rgba(0, 0, 0, 0.25)'
                      : 'none',
                  color: isActive ? '#ffffff' : isHovered ? '#c9d1d9' : '#8b92a5',
                  flex: isClosing ? '0 0 0px' : '0 1 110px',
                  minWidth: isClosing ? '0px' : '40px',
                  maxWidth: isClosing ? '0px' : '110px',
                  opacity: isClosing ? 0 : 1,
                  transform: isClosing ? 'scale(0.8) translateY(-4px)' : isActive ? 'translateY(0)' : 'translateY(1px)',
                  overflow: 'hidden',
                  animation: 'mgTabEnter 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
                title={tabFilePath || tabName}
              >

                {/* Status Dot */}
                <span
                  title={statusTitle}
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: dotColor,
                    boxShadow: dotGlow,
                    animation: hasUnsavedChanges ? 'mgDotPulse 2.2s infinite ease-in-out' : 'none',
                    transition: 'background 0.25s ease, box-shadow 0.25s ease'
                  }}
                />

                {/* Title */}
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '75px',
                    letterSpacing: '-0.1px'
                  }}
                >
                  {tabName}
                </span>

                {hasUnsavedChanges && (
                  <span
                    style={{
                      color: '#f59f00',
                      fontWeight: 800,
                      fontSize: '11px',
                      lineHeight: 1,
                      textShadow: '0 0 6px rgba(245, 159, 0, 0.6)'
                    }}
                    title="Unsaved changes"
                  >
                    *
                  </span>
                )}

                {/* Close Button */}
                <button
                  onClick={e => handleClose(e, tab)}
                  title="Close Tab"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    background: 'transparent',
                    border: 'none',
                    color: isActive ? '#aaa' : '#666',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: 'auto',
                    flexShrink: 0,
                    opacity: isActive || isHovered ? 1 : 0.2,
                    transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255, 51, 102, 0.22)'
                    e.currentTarget.style.color = '#ff6b8b'
                    e.currentTarget.style.transform = 'scale(1.15)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = isActive ? '#aaa' : '#666'
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                  onMouseDown={e => {
                    e.currentTarget.style.transform = 'scale(0.9)'
                  }}
                >
                  <IconX size={10} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Plus Button to open Start Screen / New Project */}
      <button
        onClick={() => openStartTab()}
        title="Open Start Screen (New Project, Template & AI)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          borderRadius: '6px',
          background: activeTabId === 'start' ? 'rgba(77, 171, 247, 0.15)' : 'rgba(255, 255, 255, 0.03)',
          border: activeTabId === 'start' ? '1px solid rgba(77, 171, 247, 0.35)' : '1px solid rgba(255, 255, 255, 0.07)',
          color: activeTabId === 'start' ? '#4dabf7' : '#8b92a5',
          cursor: 'pointer',
          padding: 0,
          marginLeft: '4px',
          transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
          flexShrink: 0
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(77, 171, 247, 0.18)'
          e.currentTarget.style.color = '#4dabf7'
          e.currentTarget.style.borderColor = 'rgba(77, 171, 247, 0.4)'
          e.currentTarget.style.transform = 'scale(1.08)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'scale(1)'
          if (activeTabId !== 'start') {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
            e.currentTarget.style.color = '#8b92a5'
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.07)'
          }
        }}
      >
        <IconPlus size={11} />
      </button>
    </div>
  )
}

export default ProjectTabBar
