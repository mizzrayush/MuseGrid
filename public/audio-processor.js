class WasmAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.wasm = null;
    this.wasmMemory = null;
    this.outLPtr = 0;
    this.outRPtr = 0;
    this.outLBuffer = null;
    this.outRBuffer = null;
    this.messageQueue = [];

    console.warn("[audio-processor] WasmAudioProcessor constructor called.");

    this.port.onmessage = async (e) => {
      try {
        console.warn(`[audio-processor] Received message: ${e.data.type}`);
        if (e.data.type === 'wasm-module') {
          const imports = {
            env: {
              abort: (msg, file, line, col) => {
                console.error(`WASM Abort at ${file}:${line}:${col} - ${msg}`);
              }
            }
          };
          const result = await WebAssembly.instantiate(e.data.module, imports);
          const instance = result.instance ? result.instance : result;
          this.wasm = instance.exports;
          
          // Initialize DSP arrays
          this.wasm.initTrackSettings();
          this.wasm.initVoices();
          this.wasm.initDelayBuffers();

          // Get pointers to stereo output arrays
          this.outLPtr = this.wasm.getOutLPointer();
          this.outRPtr = this.wasm.getOutRPointer();
          this.wasmMemory = this.wasm.memory.buffer;

          // Create Float32Array views pointing directly into WASM linear memory
          this.outLBuffer = new Float32Array(this.wasmMemory, this.outLPtr, 128);
          this.outRBuffer = new Float32Array(this.wasmMemory, this.outRPtr, 128);

          this.ready = true;
          console.warn("[audio-processor] WASM module instantiated successfully. Ready = true.");
          
          // Process queued messages
          console.warn(`[audio-processor] Processing ${this.messageQueue.length} queued messages.`);
          for (const msg of this.messageQueue) {
            this.handleMessage(msg);
          }
          this.messageQueue = [];
          
          this.port.postMessage({ type: 'ready' });
        } else {
          if (!this.ready) {
            console.warn(`[audio-processor] Queuing message ${e.data.type} because WASM is not ready yet.`);
            this.messageQueue.push(e.data);
          } else {
            this.handleMessage(e.data);
          }
        }
      } catch (err) {
        console.error('Error in WASM AudioWorklet processor port handler:', err);
      }
    };
  }

  handleMessage(data) {
    if (!this.wasm) return;
    
    if (data.type === 'note-on') {
      console.warn(`[audio-processor] Note-on: trackId=${data.trackId}, pitch=${data.pitch}, vel=${data.velocity}`);
      this.wasm.triggerNoteOn(
        data.trackId,
        data.noteId,
        data.pitch,
        data.velocity,
        data.slideEnd || 0.0,
        data.slideTime || 0.0,
        data.vibratoDepth || 0.0,
        data.vibratoRate || 0.0,
        data.tremoloDepth || 0.0,
        data.tremoloRate || 0.0
      );
    } else if (data.type === 'note-off') {
      console.warn(`[audio-processor] Note-off: trackId=${data.trackId}, noteId=${data.noteId}`);
      this.wasm.triggerNoteOff(data.trackId, data.noteId);
    } else if (data.type === 'track-param') {
      console.warn(`[audio-processor] Track-param: trackId=${data.trackId}, paramId=${data.paramId}, value=${data.value}`);
      this.wasm.setTrackParam(data.trackId, data.paramId, data.value);
    } else if (data.type === 'global-settings') {
      console.warn(`[audio-processor] Global-settings: sampleRate=${data.sampleRate}, bpm=${data.bpm}`);
      this.wasm.setGlobalSettings(data.sampleRate, data.bpm);
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.ready || !this.wasm) {
      return true;
    }

    if (this.wasmMemory !== this.wasm.memory.buffer) {
      this.wasmMemory = this.wasm.memory.buffer;
      this.outLBuffer = new Float32Array(this.wasmMemory, this.outLPtr, 128);
      this.outRBuffer = new Float32Array(this.wasmMemory, this.outRPtr, 128);
    }

    this.wasm.process();

    // `process()` can allocate (new voices/buffers) and grow linear memory,
    // which detaches the Float32Array views captured before the call.
    if (this.wasmMemory !== this.wasm.memory.buffer) {
      this.wasmMemory = this.wasm.memory.buffer;
      this.outLBuffer = new Float32Array(this.wasmMemory, this.outLPtr, 128);
      this.outRBuffer = new Float32Array(this.wasmMemory, this.outRPtr, 128);
    }

    const output = outputs[0];
    if (output) {
      if (!output[0] || !output[1]) {
        console.warn(`[audio-processor] WARNING: Output channels count is ${output.length}`);
      }
      if (output[0]) output[0].set(this.outLBuffer.subarray(0, output[0].length));
      if (output[1]) output[1].set(this.outRBuffer.subarray(0, output[1].length));
    }

    return true;
  }
}

registerProcessor('wasm-audio-processor', WasmAudioProcessor);
