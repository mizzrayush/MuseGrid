export interface FileSelection {
  name: string
  filePath?: string
  data: ArrayBuffer
}

/**
 * Robustly decompress project data (zlib/deflate, gzip, or plain JSON text)
 * and safely strips any trailing null terminators.
 */
export async function parseProjectPayload(file: FileSelection): Promise<any> {
  const ipc = (window as any).ipcRenderer
  // If native IPC with filePath is available, try native decompression first
  if (file.filePath && ipc && typeof ipc.invoke === 'function') {
    try {
      const res = await ipc.invoke('open-project-path', file.filePath)
      if (res && typeof res.data === 'string' && res.data.length > 0) {
        const clean = res.data.replace(/\0+$/, '').trim()
        return JSON.parse(clean)
      }
    } catch (e) {
      console.warn('Native open-project-path failed, falling back to buffer decoding:', e)
    }
  }

  // Fallback: decode ArrayBuffer using web streams or text decoder
  const bytes = new Uint8Array(file.data)
  let text = ''

  // Check if GZIP (0x1f 0x8b)
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('gzip')
      const decompressedStream = new Response(new Blob([file.data]).stream().pipeThrough(ds))
      text = await decompressedStream.text()
    } catch (e) {
      console.warn('GZIP decompression failed:', e)
    }
  }

  // Check if ZLIB / DEFLATE (0x78)
  if (!text && bytes.length >= 2 && bytes[0] === 0x78 && typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate')
      const decompressedStream = new Response(new Blob([file.data]).stream().pipeThrough(ds))
      text = await decompressedStream.text()
    } catch (e) {
      console.warn('Deflate decompression failed:', e)
    }
  }

  // Try deflate-raw if still not decoded
  if (!text && typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw')
      const decompressedStream = new Response(new Blob([file.data]).stream().pipeThrough(ds))
      text = await decompressedStream.text()
    } catch {}
  }

  // Fallback to plain UTF-8 text decoder
  if (!text) {
    text = new TextDecoder().decode(file.data)
  }

  const clean = text.replace(/\0+$/, '').trim()
  return JSON.parse(clean)
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
      // Do NOT add "*.*" if specific extensions are specified, so the file dialog filters strictly
      const filters = [
        { name: options.fileTypeName, extensions: options.extensions }
      ]
      if (!options.extensions || options.extensions.length === 0 || options.extensions.includes('*')) {
        filters.push({ name: 'All Files', extensions: ['*'] })
      }

      const res = await ipc.invoke('show-open-dialog', {
        title: options.title,
        filters
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
        filePath: res.filePath,
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
