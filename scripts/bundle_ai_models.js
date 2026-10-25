import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'ai_models')
const MAGENTA_DIR = path.join(PUBLIC_DIR, 'magenta')
const DEMUCS_DIR = path.join(PUBLIC_DIR, 'demucs')

const MAGENTA_BASE = 'https://storage.googleapis.com/magentadata/js/checkpoints'
const MAGENTA_MODELS = [
  'music_rnn/basic_rnn',
  'music_rnn/drum_kit_rnn',
  'music_vae/drums_2bar_hikl_small',
  'coconet/bach',
  'music_vae/groovae_4bar',
  'piano_genie/model/epiano/stp_iq_auto_contour_dt_166006',
  'transcription/onsets_frames_uni'
]

const DEMUCS_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx'

async function downloadFile(url, outputPath) {
  console.log(`Downloading: ${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
  
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  fs.writeFileSync(outputPath, buffer)
}

async function bundleMagentaModels() {
  for (const model of MAGENTA_MODELS) {
    console.log(`\n--- Bundling Magenta Model: ${model} ---`)
    const modelDir = path.join(MAGENTA_DIR, model)
    fs.mkdirSync(modelDir, { recursive: true })

    const manifestUrl = `${MAGENTA_BASE}/${model}/weights_manifest.json`
    const manifestPath = path.join(modelDir, 'weights_manifest.json')
    
    try {
      await downloadFile(manifestUrl, manifestPath)
    } catch (e) {
      console.warn(`WARNING: No weights_manifest.json found for ${model}.`)
      continue
    }

    const manifestStr = fs.readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestStr)

    for (const group of manifest) {
      if (!group.paths) continue
      for (const p of group.paths) {
        const shardUrl = `${MAGENTA_BASE}/${model}/${p}`
        const shardPath = path.join(modelDir, p)
        await downloadFile(shardUrl, shardPath)
      }
    }
  }
}

async function bundleDemucsModel() {
  console.log(`\n--- Bundling Demucs Model ---`)
  fs.mkdirSync(DEMUCS_DIR, { recursive: true })
  const outputPath = path.join(DEMUCS_DIR, 'htdemucs_embedded.onnx')
  await downloadFile(DEMUCS_URL, outputPath)
}

async function main() {
  console.log('Starting AI Model Bundling Process...')
  
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true })
  }

  await bundleMagentaModels()
  await bundleDemucsModel()

  console.log('\n--- Bundling Complete! ---')
  console.log(`All models downloaded to: ${PUBLIC_DIR}`)
}

main().catch(err => {
  console.error('\nERROR during bundling:', err)
  process.exit(1)
})
