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

      let arrayBuffer: ArrayBuffer
      if (typeof res.data === 'string') {
        let base64 = res.data
        if (base64.startsWith('data:') && base64.includes(';base64,')) {
          base64 = base64.split(';base64,')[1]
        }
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        arrayBuffer = bytes.buffer
      } else if (res.data instanceof ArrayBuffer) {
        arrayBuffer = res.data
      } else if (Array.isArray(res.data)) {
        arrayBuffer = new Uint8Array(res.data).buffer
      } else if (res.data && typeof res.data === 'object' && res.data.buffer instanceof ArrayBuffer) {
        arrayBuffer = res.data.buffer
      } else {
        arrayBuffer = new ArrayBuffer(0)
      }

      return {
        name: res.name || 'file',
        data: arrayBuffer
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
