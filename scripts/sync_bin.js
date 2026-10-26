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
