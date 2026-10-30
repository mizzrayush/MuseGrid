# 🌌 MUSEGRID: THE INDUSTRIAL-GRADE NEURAL COMPOSITION WORKSTATION
## COMPLETE TECHNICAL SPECIFICATION AND OPERATIONAL MANUAL

---

## 🏗️ 1. ARCHITECTURE AND USER INTERFACE PHILOSOPHY

MuseGrid is designed as a high-fidelity music production workstation that combines algorithmic composition with real-time audio synthesis. The user interface prioritizes data density and clear visual hierarchies.

### 1.1 The Visual Language & Aesthetic Framework
*   **Industrial Dark Theme**: The interface uses a dark gray and black color scheme to reduce eye strain during long production sessions.
    *   Main Workspace Background: `#0a0a0f`
    *   Control Panels & Windows: `#0f1015`
    *   Form Controls & Button Frames: `#161720` / `#191b21`
    *   Borders & Separators: `rgba(255, 255, 255, 0.08)`
*   **Glassmorphism Panels**: Floating cards, dropdown menus, and settings drawers use translucent panels with a blur filter (`backdrop-filter: blur(12px)`) to keep the interface legible without hiding background elements.
*   **Color-Coded Instrument States**: Visual accents are color-coded to identify different track types and processing states:
    *   **Synthesizer and Lead Tracks**: Cyan and soft blue range (`#00e6ff` to `#4dabf7`).
    *   **Drum Machines and Samplers**: Orange and yellow range (`#ff922b` to `#ffcc00`).
    *   **Audio FX and Distortion Saturation**: Hot pink and magenta range (`#ff3366`).
    *   **AI Assistants and Stem Separators**: Purple and violet range (`#da77f2`).
*   **Micro-Animations**: Hover-triggered color changes, slide-out panels, and modal entrances use CSS transition curves to provide tactile feedback:
    *   Standard Panel Animation: `all 0.22s cubic-bezier(0.4, 0, 0.2, 1)`
    *   Knob and Slider Glows: `box-shadow 0.15s ease-in-out`
*   **Hardware-Accelerated Canvas**: The grid is rendered using double-buffered HTML5 canvases to handle thousands of notes and automation points at 60 FPS without dropping frames.

### 1.2 Layout Regions and Component Structures
*   **Top Bar (Transport and Session Controls)**:
    *   **Transport Panel**: Play, Pause, Record, and Overdub toggle buttons.
    *   **Tempo Master**: A horizontal BPM slider and numeric input box (adjustable from 20.0 to 300.0 BPM).
    *   **Time Divisions**: Snap-resolution dropdown, accompanied by Triplet and Dotted toggles.
    *   **Layout Modes**: Toggle buttons to switch between Split View and Overlay View.
    *   **File Controls**: Quick-action buttons to create a new session, load files, save projects, trigger a mixdown, or open the notation preview.
*   **Left Pane (The Arranger Drawer)**:
    *   A scrollable side panel containing controls for project settings, mix properties, timing resolutions, humanization, scale locking, custom synthesizers, drum voice physical models, and the AI panel.
*   **Main Arranger Grid (The Canvas)**:
    *   The primary interface for note entry. It renders the Piano Roll keyboard, step sequencer rows, playhead indicator, loop bracket boundaries, and automation lanes.
*   **Right Pane (Note Inspector & Help Panel)**:
    *   A contextual sidebar that opens when notes are selected, letting users edit individual pitch, velocity, timing, and MPE settings. It also includes keyboard shortcuts and documentation references.

---

## 🗄️ 2. PROJECT FILES AND STATE PERSISTENCE

MuseGrid stores sessions in plain-text formats to make sharing, backing up, and restoring projects simple and robust.

### 2.1 File Schemas
*   **The `.muz` Session Schema**:
    *   A structured JSON file that contains all data required to restore a project.
    *   Example structure:
        ```json
        {
          "version": "1.2.0",
          "bpm": 120.0,
          "timeSignature": "4/4",
          "tracks": [
            {
              "id": "track-0",
              "name": "Synth Lead",
              "instrument": "synth",
              "volume": 85,
              "pan": -0.2,
              "muted": false,
              "soloed": false,
              "color": "#4dabf7",
              "synthPreset": "analogSynth",
              "fxInstances": []
            }
          ],
          "notes": [
            {
              "id": "note-0",
              "trackId": "track-0",
              "time": 0,
              "duration": 48,
              "pitch": 60,
              "velocity": 100,
              "pitchSlide": 2,
              "pitchSlideTime": 12
            }
          ],
          "clips": [],
          "customFxConfigs": []
        }
        ```
*   **The `.muzset` Preferences Schema**:
    *   An independent JSON file used to backup and sync user configurations, custom drum mapping tables, and UI layout settings without changing note data.

### 2.2 Save, Auto-Save, and Crash Recovery
*   **Auto-Save Engine**: The Zustand state store writes the session data to `localStorage` every 5 seconds. If the application crashes, the project state is recovered automatically upon restarting the app.
*   **Background Silent Write**: The desktop version uses Electron's file bridge to write data directly to the active `.muz` file without popping up file dialogues, avoiding interruptions during composition.
*   **Dirty State Tracking**: If the active project contains changes that have not been written to disk, an asterisk (`*`) appears next to the file name in the application title bar (e.g., `MuseGrid - SynthSession*`).

---

## 🎛️ 3. LEFT PANE CONTROLLER MODULES

The Left Pane contains the parameters and controls for configuring the workstation.

### 3.1 Preferences & Global Mix
*   **Unified Scroll (`scrollBoth`)**: Keeps the horizontal scroll offsets of the Piano Roll and the Step Sequencer synchronized when working in Split Mode.
*   **Playhead Follow Mode**:
    *   `Page`: The grid flips pages once the playback cursor moves past the right edge.
    *   `Smooth`: The grid scrolls continuously to keep the playback cursor centered in the screen.
*   **Limiter Control**: A master bus limiter to prevent digital clipping on output. It exposes a toggle switch and a threshold slider (-10.0 dBFS to 0.0 dBFS).
*   **Note Completion**:
    *   `ON`: Envelopes release naturally when the sequencer is paused.
    *   `OFF`: All notes are silenced immediately upon pausing playback.

### 3.2 Editor Tools
*   **DRAW (D)**: Click to add notes; drag to set their duration.
*   **ERASE (E)**: Click any note to delete it from the track.
*   **SELECT (S)**: Click and drag to select multiple notes within a marquee box.
*   **MOVE (M)**: Click and drag notes to shift their time positions or transpose their pitch.
*   **SPLIT (X)**: Splits a note into two at the cursor's horizontal coordinate.
*   **JOIN (J)**: Merges adjacent notes of the identical pitch into a single continuous note.
*   **MUTE (T)**: Mutes individual notes; muted notes are grayed out on the canvas and do not trigger audio.
*   **SCRUB**: Scrub playback back and forth by clicking and dragging across the ruler.

### 3.3 Snap and Grid Modifiers
*   **Grid Snap Divisions**: Snaps note placements to standard musical divisions:
    *   `1 Bar`, `1/2`, `1/4`, `1/8`, `1/16`, `1/32`, `1/64`
*   **Division Modifiers**:
    *   **Triplet (T)**: Snaps notes to triplet divisions (e.g., 1/12 or 1/24 note).
    *   **Dotted (D)**: Snaps notes to dotted divisions, extending duration snaps by 1.5x.
    *   **Ticks Override**: Input a custom integer to snap note starts and lengths to a specific tick value (e.g., 12 or 24 ticks).

### 3.4 Humanize & Groove
*   **Jitter Timing**: Adds randomized timing offsets (0 to 48 ticks) to note starts to mimic performance variations.
*   **Jitter Velocity**: Adds randomized velocity offsets (0 to 64 units) to note volumes.
*   **Groove Extraction**: Analyzes the micro-timing and velocity curves of a selection of notes and saves them to a groove template.
*   **Groove Application**: Applies saved groove profiles to other tracks, with timing and velocity strength sliders (0% to 100%).

### 3.5 Scale Lock & Theory Controls
*   **Scale Lock Toggle**: Hides non-scale keys and pitch rows, aligning notes to the selected scale.
*   **Key Selector**: Select the root note key (C, C#, D, etc.).
*   **Mode Selector**: Select the musical scale (Major, Natural Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harmonic Minor, Pentatonic).
*   **Snap-on-Release**: Snaps notes to valid scale degrees when they are dragged and dropped.

---

## 🎛️ 4. INSTRUMENT DESIGN & SYNTHESIS LAB

Every track in MuseGrid runs a dedicated synthesizer or drum physical modeler.

### 4.1 Synthesizer Models
*   **Subtractive Synth**:
    *   Uses dual oscillators (Sine, Square, Sawtooth, Triangle) mixed into a lowpass resonant filter.
    *   Exposes Attack, Decay, Sustain, and Release envelope controls.
*   **FM Synth (Frequency Modulation)**:
    *   Modulates the carrier wave's pitch with a modulator wave.
    *   Exposes `Harmonicity` (pitch ratio) and `Modulation Index` (modulation depth) controls.
*   **MonoSynth**:
    *   A monophonic synthesizer designed for basslines and lead melodies.
    *   Features a built-in filter sweep envelope linked to note triggers.

### 4.2 Fourier Waveform Architect
The custom waveform designer lets users write mathematical expressions to build custom wavetable shapes:
*   **Harmonic Synthesis**: Input a Fourier series formula using sine terms.
*   **Fourier Expression Syntax**:
    *   Square Wave: `sin(t) + 0.33 * sin(3*t) + 0.2 * sin(5*t)`
    *   Sawtooth Wave: `sin(t) - 0.5 * sin(2*t) + 0.33 * sin(3*t)`
*   **Partial Count**: Choose the number of harmonics (up to 64) to calculate when generating the wavetable.

### 4.3 Drum Synthesis Engine
Drum tracks start from a 16-channel template that grows as far as MIDI pitches allow, running real-time physical models instead of static samples:
*   **Membrane Model**:
    *   Simulates the tension and resonance of a drum skin.
    *   Controls: Pitch frequency, pitch decay time, and amplitude decay envelope.
*   **Noise Model**:
    *   Uses filtered white noise to synthesize acoustic snare drums, handclaps, and shaker instruments.
    *   Controls: Bandpass filter frequency, filter resonance, and amplitude decay envelope.
*   **Metal Model**:
    *   Uses six frequency-modulated oscillators to simulate metallic cymbals and hi-hats.
    *   Controls: Pitch frequency, metal resonance decay, and harmonic spread.

---

## 🎛️ 5. THE EFFECTS RACK & ROUTING RACK

MuseGrid tracks host a modular chain of effects to process audio signals.

### 5.1 Real-Time Audio Effects
*   **Algorithmic Reverb**: Exposes Reverb Decay (0.1s to 12.0s), Pre-Delay (0ms to 200ms), and Wet Mix level.
*   **Stereo Echo / Delay**: Exposes Delay Time (0.01s to 3.0s), Echo Feedback (0% to 95%), Ping-Pong panning toggle, and Wet Mix level.
*   **Waveshaper Distortion**: Exposes Drive Intensity (0 to 100), Anti-Aliasing Oversampling (None, 2x, 4x), and Wet Mix level.
*   **Three-Band EQ (EQ3)**: High-shelf, mid-bell, and low-shelf filter bands with +/-24dB gain adjustments.
*   **Chorus**: LFO rate, delay depth, delay time, and Wet Mix level.
*   **Phaser**: LFO sweep rate, sweep width (1 to 8 octaves), base frequency, and Wet Mix level.

### 5.2 LFO parameter modulation
*   **FX Modulator**: Map an LFO to any effect parameter.
*   **LFO Modes**:
    *   `override`: Completely replaces the parameter value with the LFO output.
    *   `add`: Adds the LFO value to the parameter value.
    *   `multiply`: Multiplies the parameter value by the LFO value.
*   **LFO Formula**: Write math formulas (e.g. `sin(t)` or `cos(t*2)`) to drive parameter modulation over time.

### 5.3 Distributed Pre-Reverb (DPreverb)
*   A non-causal reverb node designed for creating ambient reverb swells.
*   The export engine uses the `getMaxDPreverbTailSeconds` function to read reverb decay times, extending the render duration to ensure reverb tails fade out naturally in the exported file.

---

## 🎨 6. CANVAS RENDER LOOP & WORKFLOW MODES

Note rendering on the central grid is handled by a double-buffered HTML5 canvas to manage performance with large projects.

### 6.1 Display Layouts
*   **Split Mode**: Separates the workspace horizontally, showing synth tracks on a scrollable piano roll at the top, and drum step rows at the bottom.
*   **Overlay Mode**: Merges all tracks onto a single master piano roll. Notes from inactive tracks are shown as semi-transparent "ghost" notes.

### 6.2 View Navigation
*   **Vertical Key Zoom**: Adjusts the height of note rows on the piano roll.
*   **Horizontal Grid Zoom**: Scales the time axis to adjust view detail.
*   **Scroll Lock**:
    *   `scrollBoth`: Locks horizontal scrolling between the split canvas views.
    *   `horizScrollLockEnabled` / `vertScrollLockEnabled`: Prevents accidental panning on one axis when drawing notes.

### 6.3 Canvas Gestures
*   **Box Selection**: Drag a marquee box to select groups of notes.
*   **Micro-Timing Placement**: Hold `ALT` while dragging a note to bypass grid snaps.
*   **Double-Click Focus**: Double-clicking a ghost note in Overlay Mode switches active track focus to that note's parent track.

---

## 🧠 7. NEURAL COMPOSITION ENGINE (AI)

MuseGrid includes generative AI tools to help compose melodies, drum loops, and chord progressions.

### 7.1 Generator Controls
*   **Temperature**: Controls randomness (0.1 for predictable patterns, up to 2.0 for highly randomized sequences).
*   **Density**: Controls note density, adjusting the balance of note placements and rests.
*   **Length**: Generative span from 1 to 16 bars.
*   **Seed Memory**: The number of preceding bars analyzed to guide the generated output.
*   **Octave Shift**: Vertically shifts the generated notes (-3 to +3 octaves).

### 7.2 Generative Models
*   **Melody Generator**: Generates melodic lines within the limits of the selected `Scale Lock`.
*   **Beat Architect**: Generates drum patterns by calculating Markov-chain probabilities based on the selected drum kit.
*   **Beat Morphing**: Interpolates between a source drum track and a target drum track, generating a transitional pattern across a specified duration.
*   **Chord Generator**: Generates diatonic chords or extended jazz voicings beneath an active melodic line.
*   **Counterpoint Generator**: Generates three independent counter-melodies (Alto, Tenor, Bass) that follow voice-leading principles.
*   **Piano Genie**: An 8-button interface that maps simple button presses to diatonic scale degrees, letting users play solos in real-time.
*   **Structural Suggestions**: Analyzes active tracks and displays tips to improve arrangements, such as "Add an arpeggio in bar 4."

---

## 🔬 8. MIDI IMPORT AND REMAP LABORATORY

The MIDI Remap Laboratory parses external files and aligns them to the current project settings.

### 8.1 Import Pipeline
*   **File Formats**: Supports importing `.mid` (MIDI Type 0 and Type 1) and `.musicxml` files.
*   **Channel Auditioning**: Parses multi-track files into individual channels, letting users isolate specific parts for import.
*   **Global Offsets**: Apply pitch transposition (octaves/semitones), time scaling (half-time/double-time), and velocity scaling before importing notes to the timeline.

### 8.2 Pitch and Drum Mapping
*   **Smart Drum Auto-Map**: Maps General MIDI (GM) percussion numbers to MuseGrid's default 16-channel drum layout; additional channels can be added from the Track pane or the Step Sequencer header.
*   **Smart Scale Snap**: Snaps incoming pitches to the active `Scale Lock`.
*   **Pitch Pruning**: Displays a list of all unique pitches detected in a file, letting users select and exclude specific pitches before importing them.

---

## 🚀 9. RENDER ENGINE & EXPORT SUITE

The export engine generates audio mixdowns and notation files.

### 9.1 Audio Export (Mixdown)
*   **File Formats**: Bounces audio as lossless `.wav` (PCM) or compressed `.mp3`.
*   **Mix Options**: Export the master stereo bus, individual stems, or select tracks.
*   **Export Regions**:
    *   `exportRegionMode`: Toggles rendering of multiple disjoint regions.
    *   `exportRegions`: Define export brackets with start ticks, end ticks, and gaps between regions to batch-render parts.
*   **Loudness Normalization**: Normalizes audio peaks to -0.1 dBFS to maximize level.
*   **Logarithmic Auto-Fade**: Applies a 2-second fade-out at the end of the export to prevent clicks.

### 9.2 Sheet Music and MIDI Export
*   **Standard MIDI File (Type 1)**: Exports notes, velocities, and ticks.
*   **MusicXML Export**: Exports track data as XML notation for use in sheet music editors.

---

## 🤖 10. HEADLESS SCRIPTING & GLOBAL API

MuseGrid includes a global API (`window.Muse`) that lets users control the workstation programmatically through the browser console or the scripting editor.

### 10.1 Global Objects
*   `Muse`: The primary interface for controlling tracks, effects, projects, and rendering.
*   `MuseState`: Provides direct read and write access to the Zustand state store.
*   `Tone`: Exposes the Tone.js instance, letting users add custom web audio nodes and routing outside the standard interface.

### 10.2 API Reference

#### Track API (`Muse.track`)
*   `Muse.track.add(name: string, instrument: 'synth' | 'drum'): string`
    *   Creates a track and returns its ID.
*   `Muse.track.remove(trackId: string): void`
    *   Deletes a track by ID.
*   `Muse.track.update(trackId: string, updates: Partial<Track>): void`
    *   Updates track properties like volume, pan, and mute states.
*   `Muse.track.loop(trackId: string, mode: 'fillToEnd' | 'perfectCycle' | 'nTimes', snapToBar: boolean, times?: number): void`
    *   Loops a track's notes based on the chosen mode.

#### Effects API (`Muse.fx`)
*   `Muse.fx.createCustomEffect(config: CustomEffectConfig): string`
    *   Creates a custom effect node.
*   `Muse.fx.createOfflineEffect(config: CustomEffectConfig): string`
    *   Creates an offline, non-causal effect node for rendering.
*   `Muse.fx.addCustomEffectToTrack(trackId: string, effectId: string): string`
    *   Adds a custom effect to a track's rack.
*   `Muse.fx.setDPreverb(trackId: string, settings: Partial<DPreverbSettings>): string`
    *   Configures the built-in DPreverb on a track.
*   `Muse.fx.getMaxDPreverbTailSeconds(trackIds?: string[]): number`
    *   Calculates the longest enabled reverb tail across tracks.

#### Project & Export API (`Muse.project` & `Muse.export`)
*   `Muse.project.save(filename?: string): void`
    *   Saves the project.
*   `Muse.project.load(file?: File): Promise<void>`
    *   Loads a project file.
*   `Muse.project.new(): void`
    *   Resets the canvas and creates a new project.
*   `Muse.exportAudio(filename: string, options: ExportOptions): Promise<boolean>`
    *   Renders audio to WAV or MP3.
*   `Muse.exportScore(options: { trackId: string, format: 'musicxml' }): Promise<void>`
    *   Exports a track to MusicXML.

---

## 💻 11. SCRIPTING CONSOLE & HISTORICAL DECK

The Scripting Modal provides an integrated environment for writing and testing custom composition scripts.

### 11.1 Monaco Editor Integration
*   **Typescript Typings**: The editor auto-registers custom `d.ts` file typings to provide autocomplete and syntax validation for `Muse`, `MuseState`, and `Tone` classes.
*   **Layout Control**: Features dragging handles to adjust the editor width and the console output height.

### 11.2 Console Output & Run History
*   **Execution Logs**: Captures script output, including return values and errors.
*   **Run History Stack**:
    *   Stores up to 30 past script executions.
    *   **Deep Revert Action**: When run, each history item saves a snapshot of the project state. Clicking "Revert" restores notes, tracks, and instruments to their exact pre-script state.

---

## 🎚️ 12. AI STEM SPLITTER & TRANSCRIBER

The Stem Splitter uses neural separation models to extract stems from stereo files.

### 12.1 ONNX Model Separation
*   **Execution Backends**: Run models via **CPU (WASM)** or **GPU (WebGPU)**.
*   **Separation Modes**:
    *   `4-Stem`: Extracts Drums, Bass, Vocals, and Other.
    *   `2-Stem`: Extracts Vocals and Instrumental stems.
*   **Export Options**: Download extracted stems as individual WAV files or package them into a ZIP archive.

### 12.2 Audio to MIDI Transcription
*   **Transcription Engine**: Analyzes extracted stems (e.g., bass or vocals) to detect pitch peaks and timing.
*   **MIDI Generation**: Automatically converts detected notes into MIDI sequences, creates a new synth track, and places the notes on the timeline aligned to the project tempo.

---

## 𝄞 13. SCORE PREVIEW & SHEET MUSIC PREVIEWER

The Score Preview Modal provides a notation preview of synth tracks.

### 13.1 Diatonic Step Mapping
*   **Diatonic Pitch Conversion**: Converts MIDI pitch numbers to diatonic steps (where C4 = step 0) and accidentals.
*   **Ledger Lines**: Calculates note placement to draw ledger lines for pitches above or below the treble staff.
*   **Clef and Notation**: Renders notes on a standard treble staff, using stem-up or stem-down placement based on pitch height.

### 13.2 View and Export Options
*   **Note Name Overlay**: Toggles note name labels inside note heads for educational use.
*   **Print Score**: Opens a print window formatted for physical sheet music.
*   **Vector SVG Download**: Downloads the notation canvas as a scalable vector graphic (.svg).
*   **MusicXML Export**: Generates a MusicXML file compatible with external sheet music editors.

---

## ⌨️ 14. COMPREHENSIVE WORKSTATION HOTKEYS

| Hotkey | Action | Scope |
| :--- | :--- | :--- |
| `Spacebar` | Toggle Play / Pause | Global |
| `Ctrl + S` | Save Project (Silent Overwrite) | Global |
| `Ctrl + O` | Open Project File | Global |
| `Ctrl + R` | Reload Workstation Session | Global |
| `D` | Switch to DRAW Tool | Canvas |
| `E` | Switch to ERASE Tool | Canvas |
| `S` | Switch to SELECT Tool | Canvas |
| `M` | Switch to MOVE Tool | Canvas |
| `X` | Switch to SPLIT Tool | Canvas |
| `J` | Switch to JOIN Tool | Canvas |
| `T` | Switch to MUTE Tool | Canvas |
| `Delete` / `Backspace` | Delete Selected Notes | Canvas |
| `Ctrl + Z` | Undo Last Edit | Canvas |
| `Ctrl + Y` / `Ctrl + Shift + Z` | Redo Last Edit | Canvas |
| `Ctrl + C` | Copy Selected Notes to Clipboard | Canvas |
| `Ctrl + V` | Paste Clipboard Notes at Playhead | Canvas |
| `Ctrl + D` | Duplicate Selected Notes | Canvas |
| `Ctrl + A` | Select All Notes on Active Track | Canvas |
| `Up Arrow` / `Down Arrow` | Pan Vertical View | Canvas |
| `Left Arrow` / `Right Arrow` | Pan Horizontal View | Canvas |
| `Shift + Scroll Wheel` | Fast Horizontal Navigation | Canvas |
| `Ctrl + Scroll Wheel` | Horizontal Time Zooming | Canvas |
| `Alt + Mouse Click/Drag` | Bypass Grid Snapping (Micro-Timing) | Canvas |

---

## ⚙️ 15. DETAILED TECHNICAL PARAMETER APPENDIX

Below is an exhaustive breakdown of the internal parameters, control ranges, mathematical algorithms, and state bindings utilized in the MuseGrid workstation engine.

### 15.1 MPE Note-Level Expressions
Unlike standard MIDI which applies pitch bends and modulations channel-wide, MuseGrid tracks MPE values at the individual note level in the Zustand store.
*   **Pitch Glide (`pitchSlide` / `pitchSlideTime`)**:
    *   *Unit*: Pitch slide in Semitones (-24 to +24), duration in Ticks (0 to 384).
    *   *Style*: Configured globally via `glideStyle` as either `smooth` (exponential linear ramp) or `stepped` (discretized semitone glissando).
    *   *Audio Render*: Tone.js parameter automation via `rampTo` on the oscillator frequency.
*   **Vibrato Wobble (`vibratoDepth` / `vibratoRate`)**:
    *   *Unit*: Depth in Cents (0 to 100), Rate in Hertz (0.1 to 20.0 Hz).
    *   *Operation*: Modulates carrier oscillator frequency. Evaluated in real-time by multiplying the vibrato LFO shape by the note's cents depth divided by 100.
*   **Tremolo Gater (`tremoloDepth` / `tremoloRate`)**:
    *   *Unit*: Depth ratio (0.0 to 1.0), Rate in Hertz (0.1 to 20.0 Hz).
    *   *Operation*: Modulates note volume level. The audio engine applies a secondary gain envelope to gate volume at the selected rate.
*   **Filter Sweep (`filterStart` / `filterEnd` / `filterSweepTime`)**:
    *   *Unit*: Frequencies in Hertz (20 to 20,000 Hz), duration in Ticks (0 to 384).
    *   *Operation*: Sweeps the filter cutoff frequency of the target note's voice. If a note lacks specific values, it defaults to the track's filter cutoff settings.

### 15.2 Physical Drum Modeling Equations
The Drum Physical Designer runs mathematical simulations to generate percussion sounds:
1.  **Membrane Model (Tension Simulation)**:
    *   Synthesizes the pitch drop of a drum skin strike:
        $$f(t) = f_{end} + (f_{start} - f_{end}) \cdot e^{-\lambda_{pitch} \cdot t}$$
    *   Where:
        *   $f_{start}$: Initial frequency (Hz), determined by pad tuning.
        *   $f_{end}$: Terminating frequency (Hz).
        *   $\lambda_{pitch}$: Decoupled decay rate (seconds).
        *   $t$: Time elapsed since trigger.
2.  **Noise Model (Friction & Rattles)**:
    *   Generates a white noise sequence passed through a high-order bandpass filter:
        $$y(t) = H_{bandpass}\Big(Noise(t)\Big) \cdot e^{-\lambda_{amplitude} \cdot t}$$
    *   Where $H_{bandpass}$ represents the digital filter coefficients mapped to snare noise cutoff and Q.
3.  **Metal Model (Cymbal Harmonic Partial Array)**:
    *   Combines six out-of-phase frequency modulation carriers to generate metallic noise:
        $$x_{metal}(t) = \sum_{n=1}^{6} A_n \cdot \sin\Big(2\pi \cdot f_n \cdot t + \beta \cdot \sin(2\pi \cdot f_{mod} \cdot t)\Big) \cdot e^{-\lambda_n \cdot t}$$
    *   Where $f_n$ represents the inharmonic ratios calculated to recreate metallic cymbals (hi-hats and rides).

### 15.3 Offline Audio Processing & Non-Causal Rendering
During project exports, the audio engine runs an offline Web Audio rendering pipeline (`OfflineAudioContext`) to write tracks to disk.
*   **Multi-Region Batch Render**:
    *   If `exportRegionMode` is active, the engine parses `exportRegions` into an array of start/end tick pairs:
        $$\text{Regions} = \Big\{ [t_{start, 1}, t_{end, 1}], [t_{start, 2}, t_{end, 2}], \dots \Big\}$$
    *   The engine renders each region to a separate audio buffer, inserts silence gaps, and stitches them into a single WAV or MP3 file.
*   **Reverb Tail Padding**:
    *   The system uses the `getMaxDPreverbTailSeconds` function to read all active reverbs:
        $$T_{tail} = \max_{k \in \text{tracks}} \Big( \text{decay}_{k} \cdot \text{wet}_{k} \Big)$$
    *   The total duration of the offline render is calculated by adding the reverb tail padding to the final note tick:
        $$\text{RenderTicks} = \text{MaxNoteTick} + \text{TicksPerSecond} \cdot T_{tail}$$
    *   This prevents the tails of reverbs or delay lines from cutting off abruptly at the end of the exported file.

---

## 🛠️ 16. DETAILED SCRIPTING API EXAMPLES & CODE SNIPPETS

To assist power users in automating common studio workflows, this section provides comprehensive script examples that can be loaded directly into the Monaco scripting console.

### 16.1 Arpeggiator Generator Script
This script generates an arpeggiated sequence on the active track based on custom scales, tempo factors, and directions (e.g. Up, Down, Converge).
```javascript
// // Custom Arpeggiator script
const state = Muse.getState();
const trackId = state.activeTrackId;

if (!trackId) {
  console.error("No track selected! Select a track in the Left Pane first.");
  return;
}

const rootPitch = 60; // Middle C
const scaleIntervals = [0, 2, 4, 7, 9, 11]; // Major Hexatonic
const sequenceDuration = 96; // 8th note arpeggios
const barCount = 4;
const totalTicks = barCount * 192;

console.log("Generating arpeggio sequence for track: " + trackId);

for (let tick = 0; tick < totalTicks; tick += sequenceDuration) {
  const stepIndex = Math.floor(tick / sequenceDuration) % scaleIntervals.length;
  const interval = scaleIntervals[stepIndex];
  
  const noteId = "arp-" + Math.random().toString(36).substring(2, 9);
  MuseState.addNote({
    id: noteId,
    trackId: trackId,
    time: tick,
    duration: sequenceDuration - 12,
    pitch: rootPitch + interval,
    velocity: 100 + Math.floor(Math.random() * 20) - 10,
    vibratoDepth: 10,
    vibratoRate: 6
  });
}

console.log("Arpeggiator sequence generation completed successfully.");
```

### 16.2 Generative Ambient Drone Engine
This script instantiates several overlapping notes on multiple synth tracks to create complex ambient textures. It automatically inserts custom offline effects and automates filter sweeps.
```javascript
// // Ambient Drone Engine
console.log("Initializing ambient drone engine...");

// 1. Add track for low-end drone
const bassTrackId = Muse.track.add("Ambient Sub", "synth");
// 2. Add track for pad chord voices
const padTrackId = Muse.track.add("Cloud Pad", "synth");

// Apply lowpass filter sweep presets to pad
Muse.track.update(padTrackId, {
  volume: 90,
  pan: 0.3
});

// 3. Generate drone notes
const dronePitches = [36, 43, 48]; // C1, G1, C2
dronePitches.forEach((pitch, index) => {
  MuseState.addNote({
    id: "drone-" + index + "-" + Date.now(),
    trackId: bassTrackId,
    time: 0,
    duration: 1536, // 8 bars
    pitch: pitch,
    velocity: 80,
    filterStart: 200,
    filterEnd: 1200,
    filterSweepTime: 768
  });
});

// 4. Generate pad note cluster
const chordPitches = [60, 64, 67, 71, 74]; // Cmaj9 chord
chordPitches.forEach((pitch, index) => {
  MuseState.addNote({
    id: "pad-" + index + "-" + Date.now(),
    trackId: padTrackId,
    time: 192, // Starts at bar 2
    duration: 1344,
    pitch: pitch,
    velocity: 90,
    vibratoDepth: 20,
    vibratoRate: 4,
    tremoloDepth: 0.4,
    tremoloRate: 3
  });
});

// 5. Add custom echo effect to the pad track
const delayFxId = Muse.fx.createOfflineEffect({
  name: "Ambient Echo",
  code: `
    const wet = params.wet ?? 0.5;
    const feedback = params.feedback ?? 0.7;
    const delaySamples = Math.floor(0.4 * sampleRate);
    
    for (let c = 0; c < input.length; c++) {
      const inData = input[c];
      const outData = output[c];
      for (let i = 0; i < inData.length; i++) {
        const past = i >= delaySamples ? outData[i - delaySamples] : 0;
        outData[i] = inData[i] + past * feedback * wet;
      }
    }
  `,
  params: [
    { name: "wet", min: 0, max: 1, defaultVal: 0.5 },
    { name: "feedback", min: 0, max: 0.95, defaultVal: 0.7 }
  ]
});

Muse.fx.addCustomEffectToTrack(padTrackId, delayFxId);
console.log("Ambient Drone Engine completed setup.");
```

### 16.3 Microtonal Scala Tuning Evaluator
This script bypasses standard musical scales to map notes to custom pitch offsets using note detuning.
```javascript
// // Custom Scala microtonal detune script
const state = Muse.getState();
const trackId = state.activeTrackId;

if (!trackId) {
  console.error("Select an active track first.");
  return;
}

// 5-Tone Equal Temperament offsets in cents from nearest standard semitone
const microOffsets = [0, 40, -20, 20, -40]; 
const notesToScale = state.notes.filter(n => n.trackId === trackId);

notesToScale.forEach((note, index) => {
  const offsetCents = microOffsets[index % microOffsets.length];
  MuseState.updateNote(note.id, {
    detune: offsetCents
  });
});

console.log("Successfully adjusted detune settings on " + notesToScale.length + " notes.");
```

---

## 🚀 17. STEP-BY-STEP PRODUCTION WORKFLOWS

Follow these recipes to execute complex operations in the workstation environment.

### 17.1 Creating a Custom wavetable using Fourier Synthesis
1.  Navigate to the Left Pane and expand the **Track Manager**.
2.  Click **Add Track** and choose **Synth Track**.
3.  Select the newly created track to focus the editor workspace.
4.  In the Left Pane, expand the **Instrument Lab** accordion.
5.  Set the Synthesis mode selector to **Fourier Expression**.
6.  In the equation input box, enter the formula for your custom waveform (e.g. `sin(t) + 0.5*sin(2*t) + 0.25*sin(4*t)`).
7.  Set the **Harmonic Partial Count** to `32`.
8.  Click **Generate Table**. The audio engine will evaluate the equation and update the track's oscillator shape.
9.  Play notes on the grid to hear the synthesized waveform.

### 17.2 Splitting a Stereo Audio File into Stems and Transcribing it to MIDI
1.  Click the **Stem Splitter** tab in the Left Pane.
2.  Drag and drop a stereo `.wav` or `.mp3` file into the upload zone.
3.  Choose either `4-Stem` (vocals, drums, bass, other) or `2-Stem` (vocals, instrumental) separation mode.
4.  Select your hardware backend: **GPU (WebGPU)** for acceleration or **CPU (WASM)** for general compatibility.
5.  Click **Start Stem Separation** and wait for the ONNX model to finish.
6.  Once separation completes, the stems will appear in the output panel.
7.  Click **To MIDI** next to the Bass stem.
8.  The transcriber will analyze the audio buffer, detect notes, create a new track, and import the transcribed MIDI sequence to the grid.

---

## 🐛 18. ENGINE TROUBLESHOOTING & FAQ

### 18.1 Audio Glitches and Buffer Underruns
*   **Problem**: You hear crackling, pops, or stuttering audio during project playback.
*   **Solution**:
    1.  Lower the **Master Volume** to prevent digital clipping in the main mix.
    2.  Open the **Master Limiter** panel and decrease the threshold value to prevent signal peaks from clipping.
    3.  Check if multiple custom offline effects are running in real-time. Disable heavy DSP configurations to free up CPU cycles.
    4.  If using WebGPU for stem separation, verify that your browser supports WebGPU and has hardware acceleration enabled in settings.

### 18.2 MIDI Import Timing Issues
*   **Problem**: Imported MIDI notes do not align with the grid snap settings.
*   **Solution**:
    1.  Open the **MIDI Remap Laboratory** in the Left Pane.
    2.  Enable **Smart Scale Snap** to snap imported notes to the active scale.
    3.  Adjust the time scaling multiplier (e.g., `0.5x` or `2.0x`) if the file imports at the wrong tempo.
    4.  Select the target track to ensure the MIDI note events map to the correct instrument layout.

---

## 📖 19. GLOSSARY OF SYSTEM TERMINOLOGY

To help developers and power users, this section defines the key terms, acronyms, and technologies used throughout the MuseGrid workstation environment.

*   **MPE (MIDI Polyphonic Expression)**: A protocol that allows notes to carry individual modulation data (such as pitch slide, vibrato, or filter sweeps) rather than applying modulation to an entire MIDI channel.
*   **Tone.js**: A Web Audio framework used by MuseGrid to build synthesizers, route signals, schedule events, and manage the master mixing pipeline.
*   **Wavetable Synthesis**: A sound generation method where oscillators play cyclic waveforms loaded from a pre-calculated table, rather than calculating basic geometric waveforms on the fly.
*   **Karplus-Strong Algorithm**: A physical modeling technique that uses a short feedback loop containing a delay line and a filter to simulate the vibration of a plucked string.
*   **ONNX (Open Neural Network Exchange)**: A format used to execute AI and neural network models (such as the Demucs stem separator) inside the web browser via WebAssembly or WebGPU backends.
*   **OfflineAudioContext**: A non-real-time Web Audio rendering pipeline used to export project arrangements to WAV or MP3 files faster than real-time playback.
*   **DPreverb (Distributed Pre-Reverb)**: An offline reverberation effect developed for MuseGrid that generates diffuse ambient tails by scattering reflections across disjoint time domains.
*   **PPQ (Pulses Per Quarter Note / Ticks)**: The timing resolution of the workstation's sequencer. MuseGrid operates at a resolution of 192 PPQ, meaning a single quarter note is divided into 192 ticks.

---

## 🎚️ 20. HARDWARE CALIBRATION & LATENCY COMPENSATION

To ensure accurate playback and recording, MuseGrid provides advanced latency adjustments to synchronize the audio engine with external MIDI inputs and sound hardware.

### 20.1 Buffer Size and Latency Settings
*   **Look-Ahead Time**:
    *   Adjusts how far in advance (in milliseconds) the Tone.js scheduler schedules events in the Web Audio context.
    *   Range: 5ms to 100ms. Higher values prevent audio dropouts but increase the delay between drawing notes and hearing them.
*   **Buffer Size**:
    *   Determines the size of the Web Audio processing block (typically 256, 512, 1024, or 2048 samples).
    *   Lower buffer sizes (e.g., 256 samples) reduce latency, while larger sizes (e.g., 1024 samples) provide more CPU headroom for complex effect chains.

### 20.2 Latency Calibration Workflow
1.  Connect your MIDI keyboard or controller.
2.  Open the **Global Settings** accordion in the Left Pane.
3.  Click the **Calibration Mode** button. The workstation will play a short rhythmic click and wait for your input.
4.  Tap a pad or key in sync with the click.
5.  The system calculates the delay between the audio trigger and the incoming MIDI note and sets the **Latency Offset** accordingly (offset range: -100ms to +100ms).
6.  This calibration ensures that live recordings align with the visual sequencer grid.

---

## 📜 21. LICENSING COMPLIANCE & TECHNICAL CREDITS

The development of the MuseGrid workstation has been made possible by leveraging the open-source software ecosystem. This section acknowledges our dependencies and outlines user rights.

### 21.1 Open Source Dependencies
*   **React & Zustand**:
    *   Core frontend and state management systems.
    *   Licensed under the MIT License. Copyright (c) Meta Platforms, Inc. and Zustand contributors.
*   **Tone.js & Web Audio API**:
    *   Enables audio synthesis, signal routing, and spatial layout calculations.
    *   Licensed under the MIT License. Copyright (c) Yotam Mann.
*   **ONNX Runtime Web**:
    *   Enables local machine learning and stem separation models directly in client sessions.
    *   Licensed under the MIT License. Copyright (c) Microsoft Corporation.
*   **Monaco Editor**:
    *   Powers the headless script editor panel.
    *   Licensed under the MIT License. Copyright (c) Microsoft Corporation.

### 21.2 User Licensing Agreements
*   **Personal and Commercial Use**:
    *   All musical outputs, loops, audio renders, and MIDI files generated within MuseGrid are 100% royalty-free.
    *   Users retain full intellectual property and commercial distribution rights for all compositions.
    *   Custom DSP scripts developed in the Monaco Console belong exclusively to their respective authors.

---

*MuseGrid Technical Manual — End of Specification.*
