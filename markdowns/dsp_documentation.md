# The Ultimate Beginner's Guide to Custom DSP in MuseGrid

Welcome! If you don't know a single thing about code and the term "DSP" sounds like an alien language to you, you are exactly in the right place. 

By the end of this massive, comprehensive guide, you will understand how digital audio works, how to write basic JavaScript code, and how to build almost any audio effect in the world from scratch—directly inside MuseGrid's Custom FX pane.

---

## Chapter 1: The Absolute Basics of Sound and Code

### What is Sound?
Imagine throwing a rock into a calm pond. Ripples travel outwards through the water. Sound is exactly the same, but instead of water, it's ripples of air pressure traveling to your ear. 

When a speaker plays sound, it pushes out and pulls in extremely fast, creating these air ripples. 

### What is Digital Sound?
A computer can't store a continuous physical wave of air. Instead, it takes "snapshots" of the speaker's position thousands of times per second. 
- **Sample Rate:** The number of snapshots a computer takes every second. In modern audio, this is usually **44,100** times per second (or 44.1kHz). 
- **Sample:** A single snapshot. It is just a number between `-1.0` (speaker pulled all the way back) and `+1.0` (speaker pushed all the way out). `0.0` means the speaker is perfectly still in the middle.

### What is DSP?
**Digital Signal Processing (DSP)** is the art of taking those numbers, doing some basic math on them, and spitting out new numbers. 
If you multiply all the numbers by 0.5, the speaker doesn't push out as far. Congratulations, you just built a Volume control! 

### The Bare Minimum Coding You Need to Know
Code is just a list of instructions. We will use a language called **JavaScript**. Here are the 3 concepts you need:

**1. Variables (Storage Boxes)**
A variable is a box that holds a number. You can name the box whatever you want.
```javascript
let myVolume = 0.5; 
```

**2. Math**
You can add `+`, subtract `-`, multiply `*`, and divide `/`.
```javascript
let newValue = oldValue * myVolume;
```

**3. The 'For' Loop (The Conveyor Belt)**
Remember how audio has 44,100 samples per second? MuseGrid hands you these samples in small batches (usually 128 at a time). To process them, you need a "loop" that says: *"For every single sample in this batch, do this math."*
```javascript
for (let i = 0; i < 128; i++) {
  // Do math on sample number 'i'
}
```

---

## Chapter 2: The MuseGrid Custom FX Environment

When you open the Custom FX pane in MuseGrid, you are writing code that runs millions of times per minute. Your code is handed six magic tools:

1. `input`: An array (a list) of the incoming audio samples. `input[0]` is the Left speaker. `input[1]` is the Right speaker.
2. `output`: An empty array where you put your finished audio samples. `output[0]` is the Left speaker. `output[1]` is the Right speaker.
3. `params`: The knobs and sliders you create in the UI. 
4. `state`: A special memory box. It remembers numbers even after the current batch of 128 samples is finished. (Crucial for delays and echoes!)
5. `sampleRate`: The current audio sample rate of the system (e.g., 44100 or 48000). Crucial for calculating time and frequency math!
6. `currentTime`: The exact current audio time in seconds.

### The Anatomy of the Loop
Every single effect you ever write will start with this exact structure:

```javascript
// Step 1: Get the left and right speakers
const inL = input[0];
const inR = input[1];
const outL = output[0];
const outR = output[1];

// Step 2: Loop through all 128 samples
for (let i = 0; i < 128; i++) {
  // Step 3: Read the current incoming sample
  let currentSampleLeft = inL[i];
  let currentSampleRight = inR[i];

  // ---> DO YOUR MAGIC MATH HERE <---

  // Step 4: Send the math result to the output
  outL[i] = currentSampleLeft;
  outR[i] = currentSampleRight;
}
```
If you run exactly this code, the audio goes in, nothing changes, and it goes out. This is called a **Bypass**. 

Let's start doing magic.

---

## Chapter 3: Manipulating Amplitude (Volume)

### 1. Basic Volume Control (Gain)
To change the volume, we multiply the sample by a number. 
- Multiply by `1.0`: No change.
- Multiply by `0.5`: Half volume.
- Multiply by `2.0`: Double volume (might cause distortion!).

```javascript
const inL = input[0];
const inR = input[1];
const outL = output[0];
const outR = output[1];

// Grab our custom knob value from the UI
let volumeKnob = params.volume;

for (let i = 0; i < 128; i++) {
  // Multiply the incoming sound by our knob
  outL[i] = inL[i] * volumeKnob;
  outR[i] = inR[i] * volumeKnob;
}
```

### 2. Auto-Panner (Moving sound Left to Right)
Instead of a static volume, what if we automatically turn the left ear up while turning the right ear down, and vice versa? 
To do this smoothly, we use a math function called `Math.sin()`, which generates a smooth, wavy wave (a sine wave) that goes up and down.

We need `state` to keep track of where we are in the wave!

```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

// Initialize our wave tracker if it doesn't exist yet
if (state.phase === undefined) {
  state.phase = 0;
}

// Speed of the pan (higher number = faster panning)
let speed = 0.0005; 

for (let i = 0; i < 128; i++) {
  // Advance our wave tracker
  state.phase = state.phase + speed;

  // Generate a smooth wave between 0.0 and 1.0
  // Math.sin generates -1 to 1. We do some math to make it 0 to 1.
  let panValue = (Math.sin(state.phase) + 1) / 2;

  // If panValue is 1.0, Left is full volume (1.0), Right is silence (1.0 - 1.0 = 0.0)
  outL[i] = inL[i] * panValue;
  outR[i] = inR[i] * (1.0 - panValue);
}
```

### 3. Ring Modulation (Dalek Voice)
If we make the auto-panner wave so incredibly fast that you can't hear it moving left to right anymore, it creates strange, metallic, robotic tones. This is called Ring Modulation.

```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

if (state.phase === undefined) state.phase = 0;

// VERY fast speed
let speed = 0.05; 

for (let i = 0; i < 128; i++) {
  state.phase += speed;
  
  // The modulator is just a sine wave going from -1 to 1 really fast
  let modulator = Math.sin(state.phase);

  outL[i] = inL[i] * modulator;
  outR[i] = inR[i] * modulator;
}
```

---

## Chapter 4: Time-Based Effects (Delay, Echo, Chorus)

To create an echo, the computer needs to play a sound, wait a moment, and play it again. 
Because our code only sees 128 tiny snapshots at a time, it literally has no memory of the past. If you don't save the sample somewhere, it's gone forever.

To solve this, we build a **Delay Line** using `state`. Think of a delay line like a massive bucket of water. You pour new audio into the top, and you drill a hole in the bottom to let old audio leak out a few seconds later.

### 1. Simple Slapback Delay
We will create an array in `state` that holds 44,100 samples (exactly 1 second of audio). We will have a "record head" that writes to the array, and a "play head" that reads from it.

```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

// Initialize our delay bucket ONLY ONCE
if (state.delayBuffer === undefined) {
  // Create a bucket that holds 44100 samples (1 second)
  state.delayBuffer = new Float32Array(44100);
  // Keep track of our position in the bucket
  state.writeIndex = 0;
}

for (let i = 0; i < 128; i++) {
  let drySignal = inL[i]; // We will just do Mono for simplicity here

  // 1. Read the old sound that we recorded 1 second ago!
  let delayedSignal = state.delayBuffer[state.writeIndex];

  // 2. Output the mix (Dry signal + the old delayed signal)
  outL[i] = drySignal + (delayedSignal * 0.5); // Echo is half volume
  outR[i] = outL[i]; // Copy to right ear

  // 3. Record the CURRENT sound into the bucket so we can hear it later
  state.delayBuffer[state.writeIndex] = drySignal;

  // 4. Move the bucket position forward. If we hit the end, loop back to the start!
  state.writeIndex = state.writeIndex + 1;
  if (state.writeIndex >= 44100) {
    state.writeIndex = 0;
  }
}
```

### 2. Feedback Echo (Repeating Delays)
A slapback delay only echoes once. If you want the echo to echo... to echo... to echo... you just have to record the *delayed sound* back into the bucket along with the new sound! This is called **Feedback**.

```javascript
// Step 3 from above changes to:
// We record the new sound, PLUS a quieter version of the old sound!
let feedbackAmount = 0.6; // 60% of the echo goes back in
state.delayBuffer[state.writeIndex] = drySignal + (delayedSignal * feedbackAmount);
```

### 3. Chorus and Flanger
If you have a delay line that is very, very short (e.g., 1000 samples, which is about 20 milliseconds), and you use a `Math.sin()` wave to constantly stretch and shrink the delay time, the pitch of the echo wobbles up and down. Mix this wobbling echo with the original dry sound, and you get a **Chorus** effect!

---

## Chapter 5: Nonlinear Effects (Distortion)

Distortion is incredibly simple in DSP. Remember that a speaker can only push out to `+1.0` and pull in to `-1.0`. 
What happens if you multiply the volume so high that the number becomes `+5.0`? The computer can't play `+5.0`. It forcefully chops off the top of the wave, flattening it to `+1.0`. 

A flattened wave looks like a square, and square waves sound fuzzy, gritty, and loud. This is called **Hard Clipping (Overdrive/Distortion)**.

### 1. Hard Clipper Distortion
```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

// Turn up the gain to push the sound past the limit
let drive = 5.0; 

for (let i = 0; i < 128; i++) {
  // Multiply by drive
  let pushedLeft = inL[i] * drive;
  
  // Math.max and Math.min are used to brutally chop the number off
  // If pushedLeft is 3.5, Math.min(3.5, 1.0) forces it down to 1.0.
  // If it is -2.0, Math.max(-2.0, -1.0) forces it up to -1.0.
  let clippedLeft = Math.max(-1.0, Math.min(1.0, pushedLeft));
  
  outL[i] = clippedLeft;
  
  // Do the same for the right
  let pushedRight = inR[i] * drive;
  let clippedRight = Math.max(-1.0, Math.min(1.0, pushedRight));
  outR[i] = clippedRight;
}
```

### 2. Bitcrushing
Old video game consoles (like the NES) sounded crunchy because they couldn't store millions of different sample values; they could only store 16 or 256 chunky steps.
We can force modern, smooth audio to snap to chunky steps by multiplying it, rounding it to a whole number, and dividing it back down.

```javascript
let bitDepth = 4; // Very crunchy
let steps = Math.pow(2, bitDepth); // 16 steps

for (let i = 0; i < 128; i++) {
  // Multiply up to 16, round it, divide back down
  outL[i] = Math.round(inL[i] * steps) / steps;
  outR[i] = Math.round(inR[i] * steps) / steps;
}
```

---

## Chapter 6: Filters (EQ)

Filters are how you remove high frequencies (making it sound muffled/underwater) or remove low frequencies (making it sound thin/tinny). 
In DSP, a simple Lowpass Filter is just a sluggish follower. It tries to reach the current sample value, but it's lazy, so it only travels a small percentage of the way there. Because it's lazy, it can't move fast enough to follow the rapid high frequencies, effectively silencing them!

### Simple 1-Pole Lowpass Filter (Underwater Effect)
```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

if (state.lazyFollowerL === undefined) {
  state.lazyFollowerL = 0;
  state.lazyFollowerR = 0;
}

// 0.01 means it only travels 1% of the distance per sample. (Very muffled)
// 0.99 means it travels 99% of the distance. (Very bright, almost bypass)
let sluggishness = 0.05; 

for (let i = 0; i < 128; i++) {
  let targetL = inL[i];
  
  // The core formula of a simple filter:
  // Current Position = Current Position + (Distance to Target * Speed)
  state.lazyFollowerL = state.lazyFollowerL + ((targetL - state.lazyFollowerL) * sluggishness);
  
  outL[i] = state.lazyFollowerL;

  // Same for right
  let targetR = inR[i];
  state.lazyFollowerR = state.lazyFollowerR + ((targetR - state.lazyFollowerR) * sluggishness);
  outR[i] = state.lazyFollowerR;
}
```

---

## Chapter 7: Spatial Audio (Tricking the Brain)

Because MuseGrid gives you independent `output[0]` (Left) and `output[1]` (Right) arrays, you have total control over the 3D space. 

How does human hearing know if a sound is to our left? 
1. **Volume:** It's louder in the left ear. (Standard panning).
2. **Time (The Haas Effect):** The sound hits our left ear a fraction of a millisecond *before* it travels around our big head and hits our right ear!

### The Haas Effect (Ultra-Wide Stereo Spreader)
If we take a boring mono synthesizer and delay the right ear by just 10 milliseconds, the human brain gets confused. It interprets this tiny delay as a massive, wide 3D space.

```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

if (state.rightDelay === undefined) {
  state.rightDelay = new Float32Array(441); // 441 samples is exactly 10 milliseconds at 44.1kHz!
  state.idx = 0;
}

for (let i = 0; i < 128; i++) {
  // Left ear goes straight through immediately!
  outL[i] = inL[i];

  // Right ear plays the delayed sound
  let delayedR = state.rightDelay[state.idx];
  outR[i] = delayedR;

  // Record the current right ear into the delay bucket
  state.rightDelay[state.idx] = inR[i];

  // Move the bucket forward
  state.idx++;
  if (state.idx >= 441) state.idx = 0;
}
```
*Try this effect on a mono drum loop or synth. The width will instantly jump out of your speakers!*

---

## Chapter 8: Dynamics (Compressors and Sidechain)

To build a compressor, we need the code to look at how loud the audio is, and if it's too loud, automatically turn the volume down.
Because audio waves vibrate back and forth from +1 to -1 rapidly, we can't just check if a single sample is loud. We need an **Envelope Follower**—a tracker that smooths out the rapid vibrations into a single "Loudness Level".

### Simple Limiter (Brickwall)
This measures the loudness. If it goes above a limit, it forcefully turns the volume knob down.

```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

if (state.envelope === undefined) state.envelope = 0;

let threshold = 0.5; // Start turning down if louder than 0.5
let release = 0.999; // How fast the volume knob returns to normal

for (let i = 0; i < 128; i++) {
  // Math.abs turns negative waves positive, giving us pure loudness
  let loudnessL = Math.abs(inL[i]);
  let loudnessR = Math.abs(inR[i]);
  let maxLoudness = Math.max(loudnessL, loudnessR);

  // If the audio is louder than our envelope, jump the envelope up immediately
  if (maxLoudness > state.envelope) {
    state.envelope = maxLoudness;
  } else {
    // Otherwise, slowly let the envelope fall back down
    state.envelope = state.envelope * release;
  }

  // Calculate the volume knob (gain reduction)
  let gain = 1.0;
  if (state.envelope > threshold) {
    // If envelope is 1.0, and threshold is 0.5, gain becomes 0.5 (turned down!)
    gain = threshold / state.envelope; 
  }

  outL[i] = inL[i] * gain;
  outR[i] = inR[i] * gain;
}
```

---

## Chapter 9: The Copy-Paste Recipe Book

Here are 5 complete, world-class effects you can literally copy and paste directly into MuseGrid's Custom FX panel.

### Recipe 1: The "Vinyl Record" Lo-Fi Degrader
Adds pitch wobble, muffled EQ, and gentle saturation to make things sound old.

```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

if (!state.init) {
  state.filtL = 0; state.filtR = 0;
  state.phase = 0;
  state.init = true;
}

for (let i = 0; i < 128; i++) {
  // 1. Gentle saturation (Tape warmth)
  let warmL = Math.tanh(inL[i] * 1.5);
  let warmR = Math.tanh(inR[i] * 1.5);

  // 2. Wow and Flutter (Pitch wobble simulation using subtle tremolo)
  state.phase += 0.0001; // slow wobble
  let wobble = 0.9 + (Math.sin(state.phase) * 0.1);
  
  // 3. Lowpass filter (Muffle the high end)
  state.filtL += (warmL - state.filtL) * 0.1; // 0.1 is very muffled
  state.filtR += (warmR - state.filtR) * 0.1;

  outL[i] = state.filtL * wobble;
  outR[i] = state.filtR * wobble;
}
```

### Recipe 2: The "Cyberpunk" Digital Decimator
Crushes the audio into harsh digital garbage. Great for heavy electronic drums.

```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

if (state.holdL === undefined) {
  state.holdL = 0; state.holdR = 0;
  state.counter = 0;
}

// Skips updating the audio every 8 samples (Sample Rate Reduction)
let skipFactor = 8; 
let bitSteps = 8; // Bitcrushing

for (let i = 0; i < 128; i++) {
  state.counter++;
  
  // Only grab a new snapshot every 8 samples
  if (state.counter > skipFactor) {
    state.counter = 0;
    // Crush the bits at the same time
    state.holdL = Math.round(inL[i] * bitSteps) / bitSteps;
    state.holdR = Math.round(inR[i] * bitSteps) / bitSteps;
  }

  // Output the held, frozen, crunchy snapshot
  outL[i] = state.holdL;
  outR[i] = state.holdR;
}
```

### Recipe 3: The "Infinite Void" Ambient Reverb (Simplified)
A massive, smeared delay cluster that creates a huge ambient tail.

```javascript
const inL = input[0]; const inR = input[1];
const outL = output[0]; const outR = output[1];

if (!state.buf1) {
  // 4 different prime-number length delays to prevent ringing
  state.buf1 = new Float32Array(3701);
  state.buf2 = new Float32Array(4111);
  state.buf3 = new Float32Array(5393);
  state.buf4 = new Float32Array(6151);
  state.idx1 = 0; state.idx2 = 0; state.idx3 = 0; state.idx4 = 0;
}

for (let i = 0; i < 128; i++) {
  let mono = (inL[i] + inR[i]) * 0.5;

  let d1 = state.buf1[state.idx1];
  let d2 = state.buf2[state.idx2];
  let d3 = state.buf3[state.idx3];
  let d4 = state.buf4[state.idx4];

  // Feedback matrix (mixing them all together into a wash)
  let wash = (d1 + d2 + d3 + d4) * 0.23; // 0.23 means very long decay!

  // Feed back into the buffers
  state.buf1[state.idx1] = mono + wash;
  state.buf2[state.idx2] = mono + wash;
  state.buf3[state.idx3] = mono + wash;
  state.buf4[state.idx4] = mono + wash;

  // Advance pointers
  state.idx1 = (state.idx1 + 1) % 3701;
  state.idx2 = (state.idx2 + 1) % 4111;
  state.idx3 = (state.idx3 + 1) % 5393;
  state.idx4 = (state.idx4 + 1) % 6151;

  // Send different wash to left and right for wide stereo
  outL[i] = inL[i] + d1 + d3;
  outR[i] = inR[i] + d2 + d4;
}
```

---

## Final Words of Advice

When writing custom DSP:
1. **Never use `console.log` inside the `for` loop!** It runs 44,100 times a second and will instantly crash your browser.
2. **Beware of Feedback Loops!** If you multiply a delay by > 1.0, it will get infinitely loud in a fraction of a second and explode your speakers. Always test new delays at low volumes.
3. **Have Fun!** DSP is literally painting with numbers. If you multiply things randomly, you might discover an incredible new synthesizer sound!

You are now officially a DSP engineer. Go build some noise!
