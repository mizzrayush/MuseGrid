// MuseGrid Algorithmic Script: 30-Second Professional Electro Track
// Run this directly in the MuseGrid Scripting Engine!
// It creates a full composition with Drums, Acid Bass, and a Supersaw Synth.

// 1. Reset Project and Set Global Parameters
Muse.project.new();
MuseState.setBpm(125); 
MuseState.setProjectInfo({ projectName: "Algorithmic Electro Hit" });
MuseState.setLoopStart(0);
MuseState.setLoopEnd(16 * 768); // 16 bars (1 bar = 768 ticks)
MuseState.setLoopEnabled(true);

// 2. Setup Tracks with Built-in FX
const drumTrackId = 'trk-drums';
const bassTrackId = 'trk-bass';
const synthTrackId = 'trk-synth';

// Drum Track
MuseState.addTrack({
  id: drumTrackId,
  name: "Main Drums",
  instrument: "drum",
  volume: 0.9,
  pan: 0,
  muted: false,
  soloed: false,
  color: "#fa5252",
  drumKit: "electro",
  fxOrder: ["eq", "reverb"],
  reverbWet: 0.1,
  reverbDecay: 1.2
});

// Acid Bass Track
MuseState.addTrack({
  id: bassTrackId,
  name: "Acid Bass",
  instrument: "synth",
  volume: 0.85,
  pan: 0,
  muted: false,
  soloed: false,
  color: "#339af0",
  synthPreset: "acid",
  synthFilterFreq: 1200, 
  synthAttack: 0.01,
  synthDecay: 0.2,
  synthSustain: 0.1,
  synthRelease: 0.1,
  fxOrder: ["distortion", "chorus"],
  distortionWet: 0.3,
  distortionAmount: 0.6,
  chorusWet: 0.2
});

// Supersaw Synth Track
MuseState.addTrack({
  id: synthTrackId,
  name: "Supersaw Chords",
  instrument: "synth",
  volume: 0.75,
  pan: 0,
  muted: false,
  soloed: false,
  color: "#da77f2",
  synthPreset: "supersaw",
  synthAttack: 0.05,
  synthDecay: 0.5,
  synthSustain: 0.8,
  synthRelease: 1.0,
  fxOrder: ["delay", "reverb"],
  delayWet: 0.4,
  delayTime: 0.35, 
  delayFeedback: 0.5,
  reverbWet: 0.4,
  reverbDecay: 3.0
});

// Helper for generating IDs
const uuid = () => Math.random().toString(36).substr(2, 9);

// Helper for adding notes
const notesToInsert = [];
const insertNote = (trackId, time, pitch, duration = 48, velocity = 100) => {
  notesToInsert.push({
    id: uuid(),
    trackId,
    time,
    pitch,
    duration,
    velocity
  });
};

// --- ALGORITHMIC COMPOSITION ---

const BAR_TICKS = 768; // 4 beats * 192 ticks
const B_TICK = 192;    // 1 beat
const S_TICK = 48;     // 1/16th note

// Progression: C min, Ab maj, F min, G min
// Roots in MIDI pitch (C2 = 36)
const chords = [
  { root: 36, notes: [36, 39, 43] }, // C min
  { root: 32, notes: [32, 36, 39] }, // Ab maj (Ab1)
  { root: 29, notes: [29, 32, 36] }, // F min (F1)
  { root: 31, notes: [31, 34, 38] }, // G min (G1)
];

// Generate 16 Bars
for (let bar = 0; bar < 16; bar++) {
  const barOffset = bar * BAR_TICKS;
  const chordIdx = Math.floor(bar / 2) % chords.length; // Change chord every 2 bars
  const root = chords[chordIdx].root;
  const currentChord = chords[chordIdx].notes.map(p => p + 24); // Shift up 2 octaves (C4 = 60)
  
  // 1. DRUMS (Kick: 0, Snare: 1, ClosedHat: 2, OpenHat: 3, Clap: 4, Crash: 8)
  for (let b = 0; b < 4; b++) {
    insertNote(drumTrackId, barOffset + b * B_TICK, 0, S_TICK, 110); // 4-on-the-floor kick
  }
  
  insertNote(drumTrackId, barOffset + B_TICK, 4, S_TICK, 100);     // beat 2 clap
  insertNote(drumTrackId, barOffset + B_TICK * 3, 4, S_TICK, 100); // beat 4 clap
  insertNote(drumTrackId, barOffset + B_TICK * 3, 1, S_TICK, 90);  // beat 4 snare layer
  
  for (let s = 0; s < 16; s++) {
    if (s % 2 !== 0) {
      insertNote(drumTrackId, barOffset + s * S_TICK, 3, S_TICK, 80); // Open hat on offbeats
    } else {
      const vel = (s % 4 === 0) ? 95 : 70; // Accented downbeat hats
      insertNote(drumTrackId, barOffset + s * S_TICK, 2, S_TICK, vel);
    }
  }

  if (bar % 4 === 0) {
    insertNote(drumTrackId, barOffset, 8, B_TICK, 100); // Crash every 4 bars
  }

  // 2. BASS
  // Funky 16th note rhythm pattern: 1 e + a 2 e + a 3 e + a 4 e + a
  // Steps: 0, 2, 3, 5, 8, 10, 11, 14
  const bassRhythm = [0, 2, 3, 5, 8, 10, 11, 14];
  
  bassRhythm.forEach(step => {
    // Add octave jumps for spice on certain steps
    const pitch = (step === 5 || step === 14) ? root + 12 : root;
    const vel = (step === 0 || step === 8) ? 110 : 85;
    insertNote(bassTrackId, barOffset + step * S_TICK, pitch, S_TICK, vel);
  });

  // 3. MAIN SYNTH
  if (bar < 8) {
    // First 8 bars: Sustained lush chords
    currentChord.forEach(pitch => {
      insertNote(synthTrackId, barOffset, pitch, BAR_TICKS, 75);
    });
  } else {
    // Last 8 bars: High-energy Arpeggiator buildup
    for (let s = 0; s < 16; s++) {
      const noteIdx = s % currentChord.length;
      let pitch = currentChord[noteIdx];
      
      // Every 4th note jump an octave to make it sparkle
      if (s % 4 === 3) pitch += 12;
      insertNote(synthTrackId, barOffset + s * S_TICK, pitch, S_TICK, 80);
    }
    // Deep pad layer beneath the arp
    insertNote(synthTrackId, barOffset, currentChord[0] - 12, BAR_TICKS, 60);
  }
}

// 3. Batch Commit Notes, Finalize and Play
if (typeof MuseState.addNotes === 'function') {
  MuseState.addNotes(notesToInsert);
} else {
  notesToInsert.forEach(n => MuseState.addNote(n));
}
MuseState.requestCanvasAlign();
Muse.ui.toggleModal('scripting', false); // Close the modal window
MuseState.showToast('Professional Electro Track Generated!', 'success');

// Play automatically after a tiny delay to ensure state sets
setTimeout(() => {
  Muse.transport.play();
}, 500);
