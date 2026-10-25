// AssemblyScript DSP audio engine
// Compiles to WASM to process sample blocks with zero JS GC jitter.

// Constants
const MAX_VOICES: i32 = 64;
const MAX_TRACKS: i32 = 32;
const MATH_PI: f32 = 3.141592653589793 as f32;

// Global settings
let sampleRate: f32 = 44100.0;
let bpm: f32 = 120.0;

// Track Parameters
class TrackParams {
  instrumentType: i32 = 0; // 0 = Synth, 1 = Drum
  oscType: i32 = 0;        // 0 = Sine, 1 = Triangle, 2 = Square, 3 = Saw
  attack: f32 = 0.005;
  decay: f32 = 0.15;
  sustain: f32 = 0.7;
  release: f32 = 0.25;
  volume: f32 = 0.7;
  pan: f32 = 0.0;          // -1.0 (Left) to 1.0 (Right)
  distortion: f32 = 0.0;   // 0.0 to 1.0
  delayTime: f32 = 0.25;   // seconds
  delayFeedback: f32 = 0.3;
  delayWet: f32 = 0.0;
}

const trackSettings = new Array<TrackParams>(MAX_TRACKS);

// Initialize track settings
export function initTrackSettings(): void {
  for (let i = 0; i < MAX_TRACKS; i++) {
    trackSettings[i] = new TrackParams();
  }
}

// Voice definition
class Voice {
  active: i32 = 0;
  trackId: i32 = 0;
  noteId: i32 = -1;
  pitch: f32 = 60.0;       // MIDI Pitch
  velocity: f32 = 0.0;     // 0.0 to 1.0
  
  // Phase counters
  phase: f32 = 0.0;
  phase2: f32 = 0.0;
  noiseSeed: u32 = 123456789;
  
  // ADSR
  envVal: f32 = 0.0;
  envStage: i32 = 0;       // 0 = Off, 1 = Attack, 2 = Decay, 3 = Sustain, 4 = Release
  envTime: f32 = 0.0;      // seconds in current stage
  
  // Glissando / Slide
  isSliding: i32 = 0;
  slideStartPitch: f32 = 60.0;
  slideEndPitch: f32 = 60.0;
  slideDuration: f32 = 0.0; // seconds
  slideElapsed: f32 = 0.0;  // seconds
  
  // Vibrato & Tremolo
  vibratoDepth: f32 = 0.0;  // semitones
  vibratoRate: f32 = 0.0;   // Hz
  vibratoPhase: f32 = 0.0;
  tremoloDepth: f32 = 0.0;  // 0.0 to 1.0
  tremoloRate: f32 = 0.0;   // Hz
  tremoloPhase: f32 = 0.0;
  
  // Custom synth type variables
  drumType: i32 = 0;        // 0=Kick, 1=Snare, 2=HihatClosed, 3=HihatOpen, 4=Clap
  drumTime: f32 = 0.0;      // elapsed time in seconds for drum synthesis
}

const voices = new Array<Voice>(MAX_VOICES);

// Initialize voices
export function initVoices(): void {
  for (let i = 0; i < MAX_VOICES; i++) {
    voices[i] = new Voice();
  }
}

// Stereo output buffers (128 samples per block)
const outL_data = new Float32Array(128);
const outR_data = new Float32Array(128);

export function getOutLPointer(): usize {
  return changetype<usize>(outL_data.dataStart);
}

export function getOutRPointer(): usize {
  return changetype<usize>(outR_data.dataStart);
}

// Delay lines per track (simple ring buffer)
const DELAY_BUF_SIZE: i32 = 44100 * 2; // 2 seconds max at 44.1k
const delayBuffersL = new Array<Float32Array>(MAX_TRACKS);
const delayBuffersR = new Array<Float32Array>(MAX_TRACKS);
const delayWriteIndices = new Array<i32>(MAX_TRACKS);

export function initDelayBuffers(): void {
  for (let i = 0; i < MAX_TRACKS; i++) {
    delayBuffersL[i] = new Float32Array(DELAY_BUF_SIZE);
    delayBuffersR[i] = new Float32Array(DELAY_BUF_SIZE);
    delayWriteIndices[i] = 0;
  }
}

// Helper functions
function midiToFreq(pitch: f32): f32 {
  if (pitch != pitch) return 0.0;
  const clampedPitch = Math.max(0.0, Math.min(127.0, pitch)) as f32;
  return 440.0 * (Math.exp((clampedPitch - 69.0) * 0.057762265046662105) as f64) as f32; // ln(2)/12
}

function randomNoise(voice: Voice): f32 {
  // Simple LCG noise generator using integer arithmetic
  voice.noiseSeed = (voice.noiseSeed * 1664525 + 1013904223);
  return ((voice.noiseSeed as f32) / (4294967295.0 as f32)) * 2.0 - 1.0;
}

function clamp(val: f32, minVal: f32, maxVal: f32): f32 {
  return Math.max(minVal, Math.min(maxVal, val)) as f32;
}

// Trigger Note On
export function triggerNoteOn(
  trackId: i32,
  noteId: i32,
  pitch: f32,
  velocity: f32,
  slideEnd: f32,
  slideTime: f32,
  vibDepth: f32,
  vibRate: f32,
  tremDepth: f32,
  tremRate: f32
): void {
  if (trackId < 0 || trackId >= MAX_TRACKS) return;
  const track = trackSettings[trackId];

  // If mono or synth, see if noteId already exists to retrigger/update
  // Find a free voice
  let voiceIdx = -1;
  let oldestVoiceIdx = 0;
  let oldestEnvVal: f32 = 999.0;

  for (let i = 0; i < MAX_VOICES; i++) {
    const v = voices[i];
    if (v.active == 0) {
      voiceIdx = i;
      break;
    }
    // Track oldest voice for stealing
    if (v.envVal < oldestEnvVal) {
      oldestEnvVal = v.envVal;
      oldestVoiceIdx = i;
    }
  }

  // Steal voice if none available
  if (voiceIdx == -1) {
    voiceIdx = oldestVoiceIdx;
  }

  const v = voices[voiceIdx];
  v.active = 1;
  v.trackId = trackId;
  v.noteId = noteId;
  v.pitch = pitch;
  v.velocity = velocity;
  v.phase = 0.0;
  v.phase2 = 0.0;
  v.envVal = 0.0;
  v.envStage = 1; // Attack
  v.envTime = 0.0;
  v.drumTime = 0.0;

  // Glissando
  if (slideTime > 0.01 && Math.abs(slideEnd - pitch) > 0.01) {
    v.isSliding = 1;
    v.slideStartPitch = pitch;
    v.slideEndPitch = slideEnd;
    v.slideDuration = slideTime;
    v.slideElapsed = 0.0;
  } else {
    v.isSliding = 0;
  }

  // Vibrato & Tremolo
  v.vibratoDepth = vibDepth;
  v.vibratoRate = vibRate;
  v.vibratoPhase = 0.0;
  v.tremoloDepth = tremDepth;
  v.tremoloRate = tremRate;
  v.tremoloPhase = 0.0;

  // If drum track, determine which piece to play based on pitch
  if (track.instrumentType == 1) {
    const pInt = pitch as i32;
    if (pInt == 0 || pInt == 35 || pInt == 36) {
      v.drumType = 0;
    } else if (pInt == 1 || pInt == 38 || pInt == 40) {
      v.drumType = 1;
    } else if (pInt == 2 || pInt == 42 || pInt == 44) {
      v.drumType = 2;
    } else if (pInt == 3 || pInt == 46) {
      v.drumType = 3;
    } else {
      v.drumType = 4; // Clap
    }
  }
}

// Trigger Note Off
export function triggerNoteOff(trackId: i32, noteId: i32): void {
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = voices[i];
    if (v.active == 1 && v.trackId == trackId && (v.noteId == noteId || noteId == -1)) {
      v.envStage = 4; // Release stage
      v.envTime = 0.0;
    }
  }
}

// Set Track Params
export function setTrackParam(
  trackId: i32,
  paramId: i32,
  value: f32
): void {
  if (trackId < 0 || trackId >= MAX_TRACKS) return;
  const t = trackSettings[trackId];

  // paramId map:
  // 0 = oscType, 1 = attack, 2 = decay, 3 = sustain, 4 = release,
  // 5 = volume, 6 = pan, 7 = distortion, 8 = delayTime, 9 = delayFeedback, 10 = delayWet, 11 = instrumentType
  if (paramId == 0) t.oscType = value as i32;
  else if (paramId == 1) t.attack = value;
  else if (paramId == 2) t.decay = value;
  else if (paramId == 3) t.sustain = value;
  else if (paramId == 4) t.release = value;
  else if (paramId == 5) t.volume = value;
  else if (paramId == 6) t.pan = value;
  else if (paramId == 7) t.distortion = value;
  else if (paramId == 8) t.delayTime = value;
  else if (paramId == 9) t.delayFeedback = value;
  else if (paramId == 10) t.delayWet = value;
  else if (paramId == 11) t.instrumentType = value as i32;
}

// Set Global Settings
export function setGlobalSettings(newSampleRate: f32, newBpm: f32): void {
  sampleRate = newSampleRate;
  bpm = newBpm;
}

// Main processing block (processes 128 samples per block)
export function process(): void {
  // Clear output buffers
  for (let i = 0; i < 128; i++) {
    outL_data[i] = 0.0;
    outR_data[i] = 0.0;
  }

  const trackAccumL = new Float32Array(128);
  const trackAccumR = new Float32Array(128);

  const sampleTime: f32 = 1.0 / sampleRate;

  for (let tId = 0; tId < MAX_TRACKS; tId++) {
    const track = trackSettings[tId];
    
    // Clear track accumulator
    for (let i = 0; i < 128; i++) {
      trackAccumL[i] = 0.0;
      trackAccumR[i] = 0.0;
    }

    let hasActiveVoices = false;

    for (let vId = 0; vId < MAX_VOICES; vId++) {
      const v = voices[vId];
      if (v.active == 0 || v.trackId != tId) continue;

      hasActiveVoices = true;

      for (let s = 0; s < 128; s++) {
        // --- 1. Glissando (Pitch Slide) ---
        if (v.isSliding == 1) {
          v.slideElapsed += sampleTime;
          if (v.slideElapsed >= v.slideDuration) {
            v.pitch = v.slideEndPitch;
            v.isSliding = 0;
          } else {
            const t = v.slideElapsed / v.slideDuration;
            v.pitch = v.slideStartPitch + (v.slideEndPitch - v.slideStartPitch) * t;
          }
        }

        // --- 2. Vibrato (Pitch modulation) ---
        let pitchMod: f32 = 0.0;
        if (v.vibratoDepth > 0.01) {
          v.vibratoPhase += (2.0 as f32) * MATH_PI * v.vibratoRate * sampleTime;
          if (v.vibratoPhase > (2.0 as f32) * MATH_PI) v.vibratoPhase -= (2.0 as f32) * MATH_PI;
          pitchMod = (Math.sin(v.vibratoPhase as f64) as f32) * v.vibratoDepth;
        }

        const currentFreq = midiToFreq(v.pitch + pitchMod);

        // --- 3. Amplitude Envelope (ADSR) ---
        v.envTime += sampleTime;
        if (v.envStage == 1) { // Attack
          if (track.attack > 0.001) {
            v.envVal = v.envTime / track.attack;
            if (v.envVal >= 1.0) {
              v.envVal = 1.0;
              v.envStage = 2; // Decay
              v.envTime = 0.0;
            }
          } else {
            v.envVal = 1.0;
            v.envStage = 2;
            v.envTime = 0.0;
          }
        } else if (v.envStage == 2) { // Decay
          if (track.decay > 0.001) {
            const targetVal = track.sustain;
            v.envVal = 1.0 - (1.0 - targetVal) * (v.envTime / track.decay);
            if (v.envTime >= track.decay) {
              v.envVal = targetVal;
              v.envStage = 3; // Sustain
              v.envTime = 0.0;
            }
          } else {
            v.envVal = track.sustain;
            v.envStage = 3;
            v.envTime = 0.0;
          }
        } else if (v.envStage == 3) { // Sustain
          v.envVal = track.sustain;
        } else if (v.envStage == 4) { // Release
          if (track.release > 0.001) {
            const startVal = track.sustain;
            v.envVal = startVal * (1.0 - (v.envTime / track.release));
            if (v.envTime >= track.release) {
              v.envVal = 0.0;
              v.envStage = 0; // Off
              v.active = 0;
            }
          } else {
            v.envVal = 0.0;
            v.envStage = 0;
            v.active = 0;
          }
        }

        if (v.active == 0) {
          break;
        }

        // --- 4. Tremolo (Amplitude modulation) ---
        let tremoloMod: f32 = 1.0;
        if (v.tremoloDepth > 0.01) {
          v.tremoloPhase += (2.0 as f32) * MATH_PI * v.tremoloRate * sampleTime;
          if (v.tremoloPhase > (2.0 as f32) * MATH_PI) v.tremoloPhase -= (2.0 as f32) * MATH_PI;
          tremoloMod = 1.0 - (v.tremoloDepth * 0.5 * (1.0 + (Math.sin(v.tremoloPhase as f64) as f32)));
        }

        const currentVolume = v.velocity * v.envVal * tremoloMod;

        // --- 5. Generate Waveform Sample ---
        let sample: f32 = 0.0;

        if (track.instrumentType == 0) {
          // Synth waveform
          v.phase += (2.0 as f32) * MATH_PI * currentFreq * sampleTime;
          if (v.phase > (2.0 as f32) * MATH_PI) v.phase -= (2.0 as f32) * MATH_PI;

          if (track.oscType == 0) { // Sine
            sample = Math.sin(v.phase as f64) as f32;
          } else if (track.oscType == 1) { // Triangle
            const t = v.phase / ((2.0 as f32) * MATH_PI);
            sample = (4.0 * Math.abs(t - Math.floor(t + 0.5) as f32) - 1.0) as f32;
          } else if (track.oscType == 2) { // Square
            sample = v.phase < MATH_PI ? 1.0 : -1.0;
          } else if (track.oscType == 3) { // Saw
            sample = ((2.0 as f32) * (v.phase / ((2.0 as f32) * MATH_PI)) - 1.0) as f32;
          }
        } else {
          // Drum kit synthesizer
          v.drumTime += sampleTime;
          
          if (v.drumType == 0) {
            // --- KICK SYNTH ---
            const kickSweep = Math.exp(-v.drumTime * 45.0) as f32;
            const kickFreq = (45.0 as f32) + kickSweep * (180.0 as f32);
            v.phase += (2.0 as f32) * MATH_PI * kickFreq * sampleTime;
            if (v.phase > (2.0 as f32) * MATH_PI) v.phase -= (2.0 as f32) * MATH_PI;
            
            const kickOsc = Math.sin(v.phase as f64) as f32;
            const kickEnv = Math.exp(-v.drumTime * 12.0) as f32;
            
            sample = kickOsc * kickEnv;
            if (v.drumTime > 0.35) v.active = 0;

          } else if (v.drumType == 1) {
            // --- SNARE SYNTH ---
            const snareFreq = 180.0 as f32;
            v.phase += (2.0 as f32) * MATH_PI * snareFreq * sampleTime;
            if (v.phase > (2.0 as f32) * MATH_PI) v.phase -= (2.0 as f32) * MATH_PI;
            
            const bodyOsc = Math.sin(v.phase as f64) as f32;
            const bodyEnv = Math.exp(-v.drumTime * 35.0) as f32;
            
            const noiseOsc = randomNoise(v);
            const noiseEnv = Math.exp(-v.drumTime * 18.0) as f32;
            
            sample = (bodyOsc * bodyEnv * 0.4) + (noiseOsc * noiseEnv * 0.6);
            if (v.drumTime > 0.25) v.active = 0;

          } else if (v.drumType == 2) {
            // --- CLOSED HIHAT SYNTH ---
            const metalNoise = randomNoise(v);
            const hatEnv = Math.exp(-v.drumTime * 65.0) as f32;
            
            const hpSample = metalNoise - v.phase2;
            v.phase2 = metalNoise;
            
            sample = hpSample * hatEnv * 0.5;
            if (v.drumTime > 0.08) v.active = 0;

          } else if (v.drumType == 3) {
            // --- OPEN HIHAT SYNTH ---
            const metalNoise = randomNoise(v);
            const hatEnv = Math.exp(-v.drumTime * 14.0) as f32;
            
            const hpSample = metalNoise - v.phase2;
            v.phase2 = metalNoise;
            
            sample = hpSample * hatEnv * 0.5;
            if (v.drumTime > 0.45) v.active = 0;

          } else if (v.drumType == 4) {
            // --- CLAP SYNTH ---
            const clapNoise = randomNoise(v);
            let clapEnv: f32 = 0.0;
            
            if (v.drumTime < 0.01) {
              clapEnv = 1.0 - (v.drumTime / 0.01);
            } else if (v.drumTime < 0.02) {
              clapEnv = 0.9 - ((v.drumTime - 0.01) / 0.01);
            } else if (v.drumTime < 0.03) {
              clapEnv = 0.8 - ((v.drumTime - 0.02) / 0.01);
            } else {
              clapEnv = 0.7 * (Math.exp(-(v.drumTime - 0.03) * 15.0) as f64) as f32;
            }
            
            sample = clapNoise * clapEnv * 0.6;
            if (v.drumTime > 0.3) v.active = 0;
          }
        }

        // Apply amplitude envelope value
        const finalSample = sample * currentVolume;

        // Panning calculation
        const panL = Math.min(1.0, 1.0 - track.pan) as f32;
        const panR = Math.min(1.0, 1.0 + track.pan) as f32;

        trackAccumL[s] += finalSample * panL;
        trackAccumR[s] += finalSample * panR;
      }
    }

    if (!hasActiveVoices && track.delayWet < 0.01) continue;

    // --- 6. Track Level FX (Distortion, Delay) ---
    const distAmt = track.distortion;
    const wetDelay = track.delayWet;
    const delayTimeSec = track.delayTime;
    const delayFb = track.delayFeedback;

    const delayBufferL = delayBuffersL[tId];
    const delayBufferR = delayBuffersR[tId];
    let writeIdx = delayWriteIndices[tId];

    const delaySamples = (delayTimeSec * sampleRate) as i32;
    const delayOffset = clamp(delaySamples as f32, 1.0, (DELAY_BUF_SIZE - 1) as f32) as i32;

    for (let s = 0; s < 128; s++) {
      let lVal = trackAccumL[s];
      let rVal = trackAccumR[s];

      // Prevent NaN/Infinity propagation
      if (lVal != lVal || lVal < -100.0 || lVal > 100.0) lVal = 0.0;
      if (rVal != rVal || rVal < -100.0 || rVal > 100.0) rVal = 0.0;

      // Wave-shaper Distortion
      if (distAmt > 0.01) {
        const drive = 1.0 + distAmt * 8.0;
        lVal = Math.tanh((lVal * drive) as f64) as f32;
        rVal = Math.tanh((rVal * drive) as f64) as f32;
      }

      // Delay effect
      if (wetDelay > 0.01) {
        let readIdx = writeIdx - delayOffset;
        if (readIdx < 0) readIdx += DELAY_BUF_SIZE;

        const delayedL = delayBufferL[readIdx];
        const delayedR = delayBufferR[readIdx];

        // Write to delay buffer (input + feedback)
        delayBufferL[writeIdx] = lVal + delayedL * delayFb;
        delayBufferR[writeIdx] = rVal + delayedR * delayFb;

        // Mix delay in
        lVal = lVal * (1.0 - wetDelay) + delayedL * wetDelay;
        rVal = rVal * (1.0 - wetDelay) + delayedR * wetDelay;
      }

      writeIdx++;
      if (writeIdx >= DELAY_BUF_SIZE) writeIdx = 0;

      // Accumulate to global output buffers with track volume
      outL_data[s] += lVal * track.volume;
      outR_data[s] += rVal * track.volume;
    }

    delayWriteIndices[tId] = writeIdx;
  }

  // --- 7. Master Limiter/Clipping ---
  for (let s = 0; s < 128; s++) {
    // Soft clip output to prevent digital clipping
    outL_data[s] = Math.tanh((outL_data[s] * 0.95) as f64) as f32;
    outR_data[s] = Math.tanh((outR_data[s] * 0.95) as f64) as f32;
  }
}
