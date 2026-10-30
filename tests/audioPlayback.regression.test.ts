import assert from 'node:assert/strict'
import test from 'node:test'
import { getSamplerPlaybackPlan, usesWebAudioSamplePlayback } from '../src/utils/audioPlayback.ts'

test('long sampler notes loop the selected sample region until note-off', () => {
  assert.deepEqual(getSamplerPlaybackPlan(4, 1, false), {
    shouldLoop: true,
    sourceDuration: undefined,
  })
})

test('short sampler notes remain one-shot unless loop-while-held is enabled', () => {
  assert.deepEqual(getSamplerPlaybackPlan(0.5, 1, false), {
    shouldLoop: false,
    sourceDuration: 1,
  })
  assert.deepEqual(getSamplerPlaybackPlan(0.5, 1, true), {
    shouldLoop: true,
    sourceDuration: undefined,
  })
})

test('custom drum and synth samples use Web Audio instead of the WASM synth path', () => {
  assert.equal(usesWebAudioSamplePlayback({
    instrument: 'drum',
    drumPadModes: { 10: 'sample' },
  }, 'drum', 10), true)
  assert.equal(usesWebAudioSamplePlayback({
    instrument: 'synth',
    synthMode: 'sampler',
  }, 'synth', 60), true)
  assert.equal(usesWebAudioSamplePlayback({ instrument: 'drum' }, 'drum', 10), false)
})
