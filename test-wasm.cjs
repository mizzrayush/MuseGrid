const fs = require('fs');

async function test() {
  const wasmBuffer = fs.readFileSync('public/audio-dsp.wasm');
  const wasmModule = await WebAssembly.compile(wasmBuffer);
  
  const imports = {
    env: {
      abort: (msg, file, line, col) => {
        console.error(`WASM Abort at ${file}:${line}:${col} - ${msg}`);
      }
    }
  };
  
  const instance = await WebAssembly.instantiate(wasmModule, imports);
  const wasm = instance.exports;
  
  wasm.initTrackSettings();
  wasm.initVoices();
  wasm.initDelayBuffers();
  
  wasm.setGlobalSettings(44100.0, 120.0);
  
  // Set up track 0
  wasm.setTrackParam(0, 0, 0); // Sine wave
  wasm.setTrackParam(0, 5, 1.0); // Volume 1.0
  wasm.setTrackParam(0, 1, 0.01); // Attack 10ms
  wasm.setTrackParam(0, 2, 0.1); // Decay 100ms
  wasm.setTrackParam(0, 3, 0.5); // Sustain 0.5
  wasm.setTrackParam(0, 4, 0.1); // Release 100ms
  wasm.setTrackParam(0, 11, 0); // Synth
  
  // Trigger note on
  // trackId, noteId, pitch, velocity, slideEnd, slideTime, vibDepth, vibRate, tremDepth, tremRate
  wasm.triggerNoteOn(0, 1, 60.0, 1.0, 60.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  
  const outLPtr = wasm.getOutLPointer();
  const outRPtr = wasm.getOutRPointer();
  
  let totalNonZero = 0;
  
  // Process 10 blocks
  for(let i=0; i<10; i++) {
    wasm.process();
    const mem = new Float32Array(wasm.memory.buffer, outLPtr, 128);
    for(let j=0; j<128; j++) {
      if (Math.abs(mem[j]) > 0.0001) totalNonZero++;
    }
  }
  
  console.log('Total non-zero samples after note on:', totalNonZero);
}

test().catch(console.error);
