import { useEffect, type RefObject } from 'react'

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
