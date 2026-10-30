import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Closes a custom context menu the way the OS closes a native one: any pointer
 * press outside the menu, or Escape, dismisses it. Capture phase is required
 * because app components stopPropagation on their own clicks.
 *
 * Takes the state setter rather than a close callback so the listeners are not
 * re-subscribed on every render while the menu is open.
 */
export function useContextMenuDismissal(open: boolean, clearMenu: (v: null) => void, menuRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (e: PointerEvent) => {
      const menu = menuRef.current
      if (menu && e.target instanceof Node && menu.contains(e.target)) return
      clearMenu(null)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      clearMenu(null)
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, clearMenu, menuRef])
}

/**
 * Places a menu the way the OS does: at the cursor when it fits, flipped to the other side
 * when it would leave the viewport, and clamped to the margin if neither side fits.
 * Returns viewport (fixed-position) coordinates, measured from the rendered menu.
 */
export function useContextMenuPosition(
  open: boolean,
  x: number,
  y: number,
  menuRef: RefObject<HTMLElement | null>,
  margin = 8,
) {
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = x
    let top = y
    if (left + rect.width + margin > vw) left = x - rect.width
    if (top + rect.height + margin > vh) top = y - rect.height
    left = Math.max(margin, Math.min(left, vw - rect.width - margin))
    top = Math.max(margin, Math.min(top, vh - rect.height - margin))

    setPosition(prev => (prev.left === left && prev.top === top ? prev : { left, top }))
  }, [open, x, y, menuRef, margin])

  return position
}
