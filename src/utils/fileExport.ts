export interface SaveDialogFilter {
  name: string
  extensions: string[]
}

export interface SaveDialogOptions {
  title?: string
  defaultFilename?: string
  filename?: string
  extensions?: string[]
  filters?: SaveDialogFilter[]
  mimeType?: string
}

/**
 * Universal save-file utility for MuseGrid that always prompts the user
 * with a native Windows / OS Save File Dialog instead of silently downloading.
 * Supports:
 *  1. JUCE Native standalone via window.ipcRenderer.invoke('save-file')
 *  2. Electron standalone via window.ipcRenderer.invoke('save-file')
 *  3. Modern Browsers via window.showSaveFilePicker()
 *  4. Graceful browser download fallback if APIs are unavailable
 */
export async function saveFileWithDialog(
  content: Blob | Uint8Array | string,
  options: SaveDialogOptions
): Promise<string | boolean | null> {
  const filename = options.filename || options.defaultFilename || 'export'
  
  let filterExtensions = options.extensions
  if (!filterExtensions && options.filters && options.filters.length > 0) {
    filterExtensions = options.filters.flatMap(f => f.extensions)
  }
  const ext = filterExtensions?.[0] || (filename.includes('.') ? filename.substring(filename.lastIndexOf('.') + 1) : '')
  const extensions = filterExtensions || (ext ? [ext] : ['*'])
  const title = options.title || `Save ${filename}`

  // 1. If running in native JUCE or Electron environment via window.ipcRenderer
  const ipc = (window as any).ipcRenderer
  if (ipc && typeof ipc.invoke === 'function') {
    try {
      let dataUrl: string
      if (content instanceof Blob) {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(content)
        })
      } else if (content instanceof Uint8Array) {
        const blob = new Blob([content as any])
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      } else {
        dataUrl = String(content)
      }

      const pattern = extensions.map(e => (e.startsWith('.') ? `*${e}` : `*.${e}`)).join(';')
      const result = await ipc.invoke('save-file', {
        data: dataUrl,
        filename,
        title,
        pattern,
        filters: options.filters || [{ name: `${(extensions[0] || 'File').toUpperCase()} Files`, extensions }]
      })

      // If user cancelled, result is null, false, or undefined
      if (result) {
        return result
      }
      return null
    } catch (ipcErr) {
      console.warn('[saveFileWithDialog] IPC save-file failed, falling back:', ipcErr)
    }
  }

  // 2. If modern browser File System Access API (showSaveFilePicker) is supported
  if (typeof (window as any).showSaveFilePicker === 'function') {
    try {
      const mime = options.mimeType || (ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : ext === 'mid' ? 'audio/midi' : 'application/octet-stream')
      const types = [{
        description: title,
        accept: {
          [mime]: extensions.map(e => (e.startsWith('.') ? e : `.${e}`))
        }
      }]
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types
      })
      const writable = await handle.createWritable()
      const blob = content instanceof Blob ? content : new Blob([content as any], { type: mime })
      await writable.write(blob)
      await writable.close()
      return true
    } catch (pickerErr: any) {
      if (pickerErr?.name === 'AbortError') {
        // User deliberately clicked Cancel in the system save dialog
        return null
      }
      console.warn('[saveFileWithDialog] showSaveFilePicker failed, falling back:', pickerErr)
    }
  }

  // 3. Fallback to anchor click download
  const blob = content instanceof Blob
    ? content
    : new Blob([content as any], { type: options.mimeType || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return true
}
