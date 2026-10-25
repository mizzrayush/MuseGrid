export interface FileSelection {
  name: string
  data: ArrayBuffer
}

/**
 * Universal file picker and reader that works across Electron desktop and web browser fallback.
 */
export const selectAndReadFile = async (options: {
  title: string
  accept: string
  extensions: string[]
  fileTypeName: string
}): Promise<FileSelection | null> => {
  const ipc = (window as any).ipcRenderer
  if (ipc) {
    try {
      const res = await ipc.invoke('show-open-dialog', {
        title: options.title,
        filters: [
          { name: options.fileTypeName, extensions: options.extensions },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (!res) return null
      return {
        name: res.name,
        data: res.data
      }
    } catch (err) {
      console.warn('IPC show-open-dialog failed, falling back to input element:', err)
    }
  }

  return new Promise((resolve) => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = options.accept
    fileInput.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const data = await file.arrayBuffer()
      resolve({
        name: file.name,
        data
      })
    }
    fileInput.click()
  })
}
