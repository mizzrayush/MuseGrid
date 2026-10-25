export {}

declare global {
  interface Window {
    ipcRenderer: {
      on(channel: string, listener: (...args: unknown[]) => void): void
      off(channel: string, ...omit: unknown[]): void
      send(channel: string, ...omit: unknown[]): void
      invoke(channel: string, ...omit: unknown[]): Promise<unknown>
    }
  }
}
