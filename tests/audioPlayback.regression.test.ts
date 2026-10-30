import assert from 'node:assert/strict'
import test from 'node:test'
import {
  drumSampleShouldLoop,
  getSamplerPlayPlan,
  getSamplerPlaybackPlan,
  resolveSamplerRegion,
  usesWebAudioSamplePlayback,
} from '../src/utils/audioPlayback.ts'

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

test('loop points default to the trim and stay inside it', () => {
  assert.deepEqual(resolveSamplerRegion({ startOffset: 0.2, endOffset: 0.8 }), {
    playStart: 0.2,
    playEnd: 0.8,
    loopStart: 0.2,
    loopEnd: 0.8,
  })
  assert.deepEqual(resolveSamplerRegion({ startOffset: 0.2, endOffset: 0.8, loopStartOffset: 0.4, loopEndOffset: 0.1 }), {
    playStart: 0.2,
    playEnd: 0.8,
    loopStart: 0.4,
    loopEnd: 0.4 + 0.005,
  })
})

test('reverse playback maps trim and loop into the reversed buffer', () => {
  assert.deepEqual(resolveSamplerRegion({
    startOffset: 0.125,
    endOffset: 0.75,
    loopStartOffset: 0.375,
    loopEndOffset: 0.625,
    reverse: true,
  }), {
    playStart: 0.25,
    playEnd: 0.875,
    loopStart: 0.375,
    loopEnd: 0.625,
  })
})

test('a sustain loop engages only after the first pass reaches the loop end', () => {
  const region = resolveSamplerRegion({ loopStartOffset: 0.5, loopEndOffset: 0.7 })
  // 1s sample, loop end at 0.7s: a 0.5s note never reaches the loop
  assert.equal(getSamplerPlayPlan(0.5, region, 1, 1, false).shouldLoop, false)
  // a 1s note passes the loop end and wraps inside 0.5-0.7
  assert.equal(getSamplerPlayPlan(1, region, 1, 1, false).shouldLoop, true)
  // holding a key longer than the first pass at double rate still loops
  assert.equal(getSamplerPlayPlan(0.5, region, 1, 2, false).shouldLoop, true)
})

test('release tail mode reports the span that plays after the loop', () => {
  const region = resolveSamplerRegion({ startOffset: 0, endOffset: 1, loopStartOffset: 0.4, loopEndOffset: 0.6 })
  const plan = getSamplerPlayPlan(2, region, 2, 1, false, 'releaseTail')
  assert.equal(plan.shouldLoop, true)
  assert.equal(plan.loopMode, 'releaseTail')
  assert.ok(Math.abs(plan.tailStartSeconds - 1.2) < 1e-9)
  assert.ok(Math.abs(plan.tailDurationSeconds - 0.8) < 1e-9)
  // trim end == loop end means there is no tail to resume
  const flush = resolveSamplerRegion({ loopStartOffset: 0.4, loopEndOffset: 1 })
  assert.equal(getSamplerPlayPlan(2, flush, 2, 1, false, 'releaseTail').tailDurationSeconds, 0)
})

test('release tail is opt-in and keeps the sustain plan otherwise', () => {
  const region = resolveSamplerRegion({})
  assert.equal(getSamplerPlayPlan(2, region, 1, 1, false).loopMode, 'sustain')
  assert.equal(getSamplerPlayPlan(2, region, 1, 1, false, undefined).loopMode, 'sustain')
})

test('release tail follows the reversed buffer like the loop does', () => {
  const region = resolveSamplerRegion({
    startOffset: 0.125,
    endOffset: 0.75,
    loopStartOffset: 0.375,
    loopEndOffset: 0.625,
    reverse: true,
  })
  const plan = getSamplerPlayPlan(2, region, 2, 1, false, 'releaseTail')
  // play 0.25-0.875, loop 0.375-0.625, tail 0.625-0.875 in reversed seconds
  assert.ok(Math.abs(plan.tailStartSeconds - 1.25) < 1e-9)
  assert.ok(Math.abs(plan.tailDurationSeconds - 0.5) < 1e-9)
})

test('drum pads stay one-shot unless a loop mode is chosen', () => {
  const region = resolveSamplerRegion({ loopStartOffset: 0.4, loopEndOffset: 0.6 })
  assert.equal(drumSampleShouldLoop(2, region, 2, 1, undefined), false)
  assert.equal(drumSampleShouldLoop(2, region, 2, 1, 'off'), false)
  // first pass is 0.6 * 2s = 1.2s
  assert.equal(drumSampleShouldLoop(1, region, 2, 1, 'sustain'), false)
  assert.equal(drumSampleShouldLoop(2, region, 2, 1, 'sustain'), true)
  assert.equal(drumSampleShouldLoop(2, region, 2, 1, 'releaseTail'), true)
})

