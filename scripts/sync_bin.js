import fs from 'fs'
import path from 'path'

const projectRoot = process.cwd()
const distDir = path.join(projectRoot, 'dist')
const binDistDir = path.join(projectRoot, 'bin', 'dist')

if (fs.existsSync(distDir)) {
  if (!fs.existsSync(binDistDir)) {
    fs.mkdirSync(binDistDir, { recursive: true })
  }
  fs.cpSync(distDir, binDistDir, { recursive: true })
}

const assetIcon = path.join(projectRoot, 'assets', 'icon.ico')
const rootIcon = path.join(projectRoot, 'icon.ico')
const binIcon = path.join(projectRoot, 'bin', 'icon.ico')
const sourceIcon = fs.existsSync(assetIcon) ? assetIcon : rootIcon
if (fs.existsSync(sourceIcon)) {
  fs.copyFileSync(sourceIcon, binIcon)
}
