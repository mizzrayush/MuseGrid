import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function getIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../icon.ico')
}

function createWindow() {
  win = new BrowserWindow({
    title: 'MuseGrid',
    icon: getIconPath(),
    width: 1420,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  win.once('ready-to-show', () => {
    win?.show()
    win?.maximize()
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    if (win && !win.isMaximized()) {
      win.maximize()
    }
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  ipcMain.handle('save-project', async (event, projectData: string) => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Save MuseGrid Project',
      filters: [{ name: 'MuseGrid Project', extensions: ['muz'] }]
    })
    if (filePath) {
      const compressed = zlib.gzipSync(projectData)
      await fs.writeFile(filePath, compressed)
      return filePath
    }
    return null
  })

  ipcMain.handle('save-project-path', async (event, projectData: string, filePath: string) => {
    try {
      const compressed = zlib.gzipSync(projectData)
      await fs.writeFile(filePath, compressed)
      return true
    } catch (err) {
      console.error(err)
      return false
    }
  })

  ipcMain.handle('open-project', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Open MuseGrid Project',
      properties: ['openFile'],
      filters: [
        { name: 'MuseGrid Projects & Tracks', extensions: ['muz', 'muztrack'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (filePaths && filePaths.length > 0) {
      const raw = await fs.readFile(filePaths[0])
      let data: string
      try {
        data = zlib.gunzipSync(raw).toString('utf-8')
      } catch {
        // Fallback: file might be uncompressed JSON (saved via browser fallback)
        data = raw.toString('utf-8')
      }
      return { data, filePath: filePaths[0] }
    }
    return null
  })

  ipcMain.handle('save-midi', async (event, midiData: Uint8Array) => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export MIDI',
      filters: [{ name: 'MIDI File', extensions: ['mid'] }]
    })
    if (filePath) {
      await fs.writeFile(filePath, Buffer.from(midiData))
      return true
    }
    return false
  })

  ipcMain.handle('save-file', async (event, options: { data: string | Uint8Array; filename: string; title?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const ext = options.filename.includes('.') ? options.filename.substring(options.filename.lastIndexOf('.') + 1) : '*'
    const { filePath } = await dialog.showSaveDialog({
      title: options.title || 'Save File',
      defaultPath: options.filename,
      filters: options.filters || [{ name: ext.toUpperCase() + ' File', extensions: [ext] }, { name: 'All Files', extensions: ['*'] }]
    })
    if (filePath) {
      let buf: Buffer
      if (typeof options.data === 'string') {
        if (options.data.startsWith('data:') && options.data.includes(';base64,')) {
          const b64 = options.data.split(';base64,')[1]
          buf = Buffer.from(b64, 'base64')
        } else {
          buf = Buffer.from(options.data, 'utf-8')
        }
      } else {
        buf = Buffer.from(options.data)
      }
      await fs.writeFile(filePath, buf)
      return filePath
    }
    return null
  })

  ipcMain.handle('show-open-dialog', async (event, options: { title?: string; filters: { name: string; extensions: string[] }[] }) => {
    const { filePaths } = await dialog.showOpenDialog({
      title: options.title,
      properties: ['openFile'],
      filters: options.filters
    })
    if (filePaths && filePaths.length > 0) {
      const filePath = filePaths[0]
      const name = path.basename(filePath)
      const data = await fs.readFile(filePath)
      return { name, filePath, data }
    }
    return null
  })

  ipcMain.handle('toggle-fullscreen', () => {
    if (win) {
      const next = !win.isFullScreen()
      win.setFullScreen(next)
      return next
    }
    return false
  })

  ipcMain.handle('is-fullscreen', () => {
    return win ? win.isFullScreen() : false
  })

  createWindow()
})
