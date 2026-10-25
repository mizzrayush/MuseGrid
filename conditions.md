# MuseGrid — Conditions Report

Full-app feature inventory, wiring status, defect register, and the style contract every future edit must follow.
Written 2026-10-25. Every line number was opened and checked on that date.

Companion documents: `features.md` is the *aspirational manual* (it is wrong in places — see §9),
`dsp_documentation.md` covers synthesis math. This file is the *verified state of the build*.

---

## 1. What this app is, so findings stay in context

MuseGrid is a **musical-idea → MIDI brainstorming workstation**, not a DAW. Judge features by
speed of idea capture, not by DAW parity. There is no audio-track recording, no arrangement timeline,
no per-clip automation in the DAW sense — the grid is a note/pattern sketchpad.

Three DSP stacks exist **on purpose** (see project memory "Engine history"):

| Stack | Location | Status |
| :--- | :--- | :--- |
| JUCE 8 native | `native/Source/` (~6,900 lines) | **Authoritative.** Ships as `bin/MuseGrid.exe`. |
| Tone.js web | `src/engine/AudioEngine.ts` (5,615) | Fallback for `vite --mode web`; needed for browser dev. |
| AssemblyScript WASM | `assembly/index.ts`, `public/audio-dsp.wasm` | Superseded; only `npm run build:wasm` and `test-wasm.cjs` reference it. |

### The bridge contract (this is where most silent bugs live)
- **Outbound, fire-and-forget:** `invokeJuce(...)` / `window.juceAudioBridge.postCommand(json)` →
  `native/Source/Bridge/JuceBridge.cpp` `handleAudioCommand` → `AudioEngine`. **No return value.**
  Anything that expects engine feedback must read the Zustand store, never the engine.
- **Outbound, request/response:** `window.ipcRenderer.invoke(channel, obj)`. All 10 channels used by JS
  are registered in `JuceBridge.cpp:167-178` (`save-project`, `save-project-path`, `open-project`,
  `save-midi`, `save-file`, `render-audio`, `show-open-dialog`, `toggle-fullscreen`, `vst3-scan`,
  `vst3-get-plugins`) — verified, no orphan channels.
- **Native detection:** `window.__isJuceNative__`; the request/response path additionally requires
  `window.ipcRenderer?.invoke` — see `canUseNativeBounce()` in `src/utils/nativeBounce.ts`.

### Codebase size (frontend 53,664 lines)
`LeftPane.tsx` 12,709 · `AudioEngine.ts` 5,615 · `GridCanvas.tsx` 3,614 · `store.ts` 3,033 ·
`DrumDesignerModal.tsx` 3,019 · `ImportAudioModal.tsx` 2,292 · `SynthStudioModal.tsx` 1,991 ·
`ScriptingModal.tsx` 1,990 · `RightPane.tsx` 1,880 · `ScriptAPI.ts` 1,729 · `App.tsx` 1,637 ·
`MidiEditSection.tsx` 1,625 · `HelpPane.tsx` 1,589 · `audioRender.ts` 1,332 · `midiEditing.ts` 1,223 ·
`ScoreEditor.tsx` 1,072 · `RecordingEngine.ts` 761 · `ScorePreviewModal.tsx` 633 · `aiLab.ts` 484 ·
`StemSplitterPane.tsx` 461 · `musicTheory.ts` 434 · `index.css` 413 · `DrumSequencer.tsx` 334

---

## 2. THEME CONTRACT — mandatory for every edit

The look is an *industrial dark / glass* UI: near-black panels, thin white-alpha borders, small bold
type, cyan→blue accents, glow on interaction. The single biggest maintenance problem is that **the
theme is enforced almost entirely by hand-typed inline styles, not by shared code.**

Measured across `src/` (counts are exact, taken 2026-10-25):

| Metric | Value | Consequence |
| :--- | :--- | :--- |
| Inline `style={{ }}` objects | **3,008** | `LeftPane.tsx` alone has 1,423; a palette change touches thousands of literals. |
| Distinct hard-coded hex colours | 20+ high-frequency | See the palette table below. |
| CSS-class usages in TSX | ~13 total | `thin-scroll` 36, `animate-modal-card/bg` 10 each, `modern-slider` 8, `glass-panel` 4, `fade-in-content` 4. |
| CSS custom properties actually consumed | 1 (`--text-muted`, 44 uses) | `--bg-dark`, `--accent-primary`, `--accent-tertiary`, `--accent-purple`, `--grid-line` are defined but **never read by any component**. |
| `borderRadius` literals | `4px` 241, `6px` 206, `8px` 58, `12px` 47, `3px` 44, `5px` 35 | Two "standard" radii (4 and 6) in near-equal use. |
| `fontSize` literals | `11px` 381, `10px` 356, `9px` 187, `12px` 149, `14px` 119 | **11px is the base size**, 10px labels, 9px micro-labels. 8px (11 uses) is below legible. |
| `fontWeight` literals | 800 ×276, 700 ×239, 600 ×175 | Panel chrome is 700–800; nothing uses 400 except body copy. |

### 2.1 Palette to use (values from `src/index.css:1-13` plus measured dominance)

| Role | Value | Source / heaviest use |
| :--- | :--- | :--- |
| App background | `#0f1015` (`--bg-dark`) | `index.css:3` |
| Panel / card solid | `#12131a`, `#12141c`, `#191b21` (`--bg-panel-solid`), `#1a1a24`, `#1e1e2e` | `index.css:360`, `SynthStudioModal.tsx:1105` |
| Translucent panel | `rgba(255,255,255,0.05)` (47×), `0.08` (33×), `0.1` (28×) over `backdrop-filter: blur(12px)` | `index.css:135-140` `.glass-panel` |
| Border / separator | `1px solid rgba(255,255,255,0.08)`; grid lines `rgba(255,255,255,0.06)` | `index.css:139`, `App.tsx:469` |
| **Primary accent (default control)** | **`#4dabf7`** (333×) — the default `AppSlider` colour, `AppSlider.tsx:20` | export/zoom/blue actions |
| Secondary accent (focus/glow) | `#00e6ff` (212×) — `select:focus` ring `index.css:44-47` | cyan states |
| Danger / record / FX | `#ff3366` (108×) | |
| Success / play | `#00e676` (`index.css:197-211`) | transport play button only |
| Modulation / purple | `#da77f2` (117×) | LFO, AI, score |
| Green (utility) | `#69db7c` (109×) | EQ, `.muztrack` |
| Orange (drums) | `#ff9900` (88×), `#ffcc00` (72×), `#ff922b` | drum lanes, Scala export |
| Text | `#fff` titles · `#aaa` (245×) default · `#888` (144×) secondary · `#8b92a5` (`--text-muted`) · `#e0e6ed` select text | |

### 2.2 Required building blocks — use these instead of hand-rolling

| Need | Use | Why |
| :--- | :--- | :--- |
| Slider | `AppSlider` (`src/ui/AppSlider.tsx:9`) | Owns `.modern-slider` geometry + `--slider-progress` fill math. |
| Track styling | class `modern-slider` (+ `compact-slider` for dense rows) | `index.css:235-319`: 4px track, 12px thumb (9px compact), `border-radius: 999px`, thumb border `#111318`, hover glow `color-mix(...25%...)`. |
| Dropdown in a floating panel | `StopPropSelect` | `LeftPane.tsx:133` — stops `mousedown`/`click`/`drag` propagation so the parent context menu doesn't close. |
| Modal | classes `animate-modal-bg` + `animate-modal-card` (+ `*-exit`) | `index.css:346-394`; fixed `z-index: 100000`, `rgba(8,9,14,0.78)` + `blur(10px)` scrim, card `#12131a`, spring `cubic-bezier(0.34,1.56,0.64,1)`. |
| Scrollable pane | `thin-scroll` | 5px thumb, `scrollbar-gutter: stable` (`index.css:109-128`). |
| Right-click menu | `useContextMenuDismissal` (`src/ui/useContextMenuDismissal.ts`) | Escape + outside-click, capture phase. |
| Icon button | 40×40, radius 8, `rgba(255,255,255,0.05)` → `0.1` on hover, `translateY(-1px)` | the `.btn-icon` recipe, `index.css:217-233`. |
| Primary action | gradient `135deg rgba(0,230,255,.9) → rgba(0,140,255,.9)`, text `#071324`, radius 6, 12px/700 | `.btn-primary`, `index.css:142-164`. |
| Motion | `all 0.15s ease` for hover/press, `0.22s cubic-bezier(0.16,1,0.3,1)` for panels, `scale(0.97)` on `:active` | `index.css:152,163,356` |

### 2.3 Rules for new UI code
1. **Never invent a new hex value.** Pick from §2.1. If nothing fits, add a `--` token to `:root` and
   *use the token*, don't paste the literal in 40 places.
2. **Never hand-style a range input.** Render `<AppSlider>`; add a prop if a call site needs something.
3. New sizes stay inside the existing ladder: 9 / 10 / 11 / 12 / 14px type; 3 / 4 / 6 / 8 / 12px radii;
   4 / 6 / 8 / 10 / 14px gaps. `fontSize: '8px'` (11 sites) and `'48px'` (1 site) are outliers — don't add more.
4. Anything inside a right-click menu must use `StopPropSelect`/`stopPropagation` or the menu closes on interaction.
5. Match the panel you're editing, not the app average. Read 200 lines around the insertion point first.
6. Native-first: build the JUCE side and the bridge param before the control, then wire the UI —
   a control that only moves Tone.js is a defect in the shipped build.

---

## 3. FIXED THIS SESSION — do not re-report these

| # | Issue | Fix location |
| :--- | :--- | :--- |
| F1 | Synth Studio graph blank after synth → sampler → synth. Canvases live inside `{!samplerMode && …}`, so they remounted without an effect dep changing. | `SynthStudioModal.tsx:424`, `:606`, `:735` — guards now `if (!isVisible \|\| samplerMode) return` and `samplerMode` is in the deps. |
| F2 | Changing the preset select stored only a name; sliders/graph kept showing the old patch. | `applyPreset` at `SynthStudioModal.tsx:403`, driven by `SYNTH_PRESET_PARAMS` at `src/utils/instruments.ts:32`, which mirrors `native/Source/Audio/AudioEngine.cpp:283-327`. |
| F3 | `UNHANDLED_REJECTION … reading 'setPointerCapture'` — `e.currentTarget` is nulled once React dispatch ends, and these handlers `await Tone.start()`. | `GridCanvas.tsx` — the node is captured before the `await` at 7 sites (`handleTimelinePointerDown`, `handlePointerDown`). |
| F4 | ScoreEditor ledger lines spun forever for any note at/above staff step 12 (loop counted down while the bound counted up). | `src/renderer/ScoreEditor.tsx:599` — `for (let s = 12; s <= mapping.step; s += 2)`. |
| F5 | Offline bounce wired to the JUCE engine with 16/24/32-bit output, plus a procedural-FX guard so JS-only script FX can't be silently dropped. | `src/utils/nativeBounce.ts:68-69,144`, `native/Source/Audio/OfflineRenderer.cpp:59`, `src/utils/wavEncoder.ts:15`, `LeftPane.tsx:2617`. |
| F6 | Loop region not reset on new project; custom context menus not dismissed by outside click/Escape; slider thickness inconsistent across modals. | session fixes (tasks #6-#8). |
| F7 | Metronome no longer forces a WAV bounce onto the Tone.js renderer: the click is synthesized in JUCE from the Click panel settings, so metronome + VST3 now export together on the native engine. See §12. | `src/utils/nativeBounce.ts`, `native/Source/Audio/OfflineRenderer.cpp`, `native/Source/Bridge/JuceBridge.cpp` |

Deliberate, **not** a bug: JS envelope `tension ∈ [-1, 1]` (`src/utils/envelopeCurves.ts`) and native
`setExponential(k)` with `k ≈ -3…-6` (`AudioEngine.cpp:283-327`) are different units and are not
converted. It is only a defect where the UI implies they are the same control.

---

## 4. VERIFIED FINDINGS — keyboard & input layer

Verified in code and (where marked ✓) live in the dev server at `http://localhost:5199` via `window.Muse.getState()`.

### BUGS

| ID | Severity | Finding | Evidence |
| :--- | :--- | :--- | :--- |
| K1 | **High** | **There is no Spacebar play/pause.** The only global transport-less `keydown` in `App.tsx` handles F11 fullscreen. Dispatching `Space` changed nothing. ✓ | `src/App.tsx:221-236` (whole handler is `if (e.key === 'F11')`); `features.md:385` claims it exists. |
| K2 | **High** | **None of the documented tool shortcuts exist** — `D` `E` `S` `M` `X` `J` `T` (draw/erase/select/move/split/join/mute) are handled nowhere. Dispatching `d`, `s`, `m` left `activeTool === 'draw'`. ✓ | exhaustive grep of every `keydown` listener (`App.tsx:236`, `GridCanvas.tsx:781`, `RecordingEngine.ts:365`, `DrumDesignerModal.tsx:547`, `ImportAudioModal.tsx:852`, `SynthStudioModal.tsx:366`, `useContextMenuDismissal.ts:28`) plus no accelerators in `native/Source`. |
| K3 | Medium | **No Ctrl+S / Ctrl+O / Ctrl+R**, even though Save/Open are in the file menu. Users must find the menu every time. | `features.md:386-388` claims all three; no handler exists. Menu-only: `App.tsx:741`, `:752`, `:788`. |
| K4 | Medium | **Any focused `<button>` disables the entire canvas shortcut layer.** The guard returns early on `BUTTON`, and Chromium keeps focus on a button after a normal click — so after clicking any toolbar/panel button, `Q`, `Delete`, Ctrl+Z, Alt+S etc. do nothing until focus moves elsewhere. | `src/renderer/GridCanvas.tsx:601-610`. |
| K5 | Medium | `Ctrl+C` and `Ctrl+V` blocks **fall through without `preventDefault()` or `return`** (`:617-638`), unlike every other branch. Copying also fires on plain `Ctrl+C` inside the canvas with no selection guard, and paste bypasses the native clipboard. | `GridCanvas.tsx:617`, `:624`. |
| K6 | Low | `Delete`/`Backspace` calls `store.commitHistory()` **unconditionally**, before checking that anything is selected — an empty delete still writes an undo entry. | `GridCanvas.tsx:638-642`. |
| K7 | Low | `q` quantize matches the bare key with **no modifier check**, so Ctrl+Q / Alt+Q also fire it. Same class of issue for any single-letter branch that doesn't test `e.ctrlKey/altKey === false`. | `GridCanvas.tsx:645`. |
| K8 | Info | Space *is* consumed for manual step-advance while punching in, which will collide with K1 if Space becomes play/pause. Any fix must scope it. | `src/engine/RecordingEngine.ts:395`. |

### What does exist (the real shortcut surface)

Undo/Redo `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` · Copy/Paste `Ctrl+C`/`Ctrl+V` · Select-all-on-track `Ctrl+A` ·
Quick Legato `Ctrl+L` · Glue `Ctrl+G` · Quantize `Q` · Delete · Escape (deselect, and menu dismissal via
capture-phase listener) · `Shift+↑/↓` octave transpose · `Ctrl+↑/↓` semitone or EDO-step transpose
(unit-correct: `12 / edo`) · `Alt+S` strum · `Alt+U` chop 1/16 · `Alt+A` arpeggiator · `Alt+R` humanize ·
`Alt+Y` time-reverse · `F11` fullscreen · `Enter`/`Space` manual step advance (record mode only) ·
`Ctrl+wheel` horizontal zoom · `Shift+wheel` fast horizontal scroll · `Alt+drag` snap bypass.
All at `GridCanvas.tsx:614-790`.

---

## 5. VERIFIED FINDINGS — code & repo hygiene

| ID | Finding | Evidence |
| :--- | :--- | :--- |
| H1 | `src/App.css` is **184 lines of dead Vite/Electron boilerplate** (`.hero`, `#next-steps`, `#docs`, `#spacer`, `.ticks`, `.counter`). It is imported by nothing and none of those class/id names appear in any TSX. | `grep App.css src` → no import; `grep className="hero"` etc → 0 matches. |
| H2 | `.btn-primary` and `.btn-icon` are fully specified in `index.css:142-233` and **used by exactly zero components** — every button is styled inline instead. | class-usage census §2. |
| H3 | `StopPropSelect` is a *private* function inside `LeftPane.tsx:133` and used 32 times there, while **19 raw `<select>` elements** exist in 8 other files (`RightPane` 6, `MidiEditSection` 4, `LeftPane` 8, modals). Same control, two behaviours, no shared source. | grep `<select` per file. |
| H4 | 8 sliders still hand-roll the `modern-slider` markup instead of using `AppSlider`, each recomputing `--slider-progress` and `--slider-color` by hand. They are visually correct today but will drift the moment the CSS changes. | `DrumSequencer.tsx:266`, `ImportAudioModal.tsx:170`, `LeftPane.tsx:451`, `:541`, `MidiEditSection.tsx:1605`, `RightPane.tsx:120`, `:1032`, `:1086`. |
| H5 | Previous-generation build debris is still in the project root and is *not* ignored: `electron/`, `dist-electron/`, `test-wasm.cjs`, `assembly/` + `public/audio-dsp.wasm`, and six loose log files (`debug.log`, `dev-server.*.log`, `static-server.*.log`, `vite-dev.*.log`, `stdout.txt`). | directory listing. |
| H6 | **There is no git repository** — no baseline, no blame, no way to diff a regression. Highest-value 10-minute fix available. | `Is a git repository: false`. |

---

## 5B. VERIFIED FINDINGS — Vocal Designer, lyric parsing, Daisy Bell preview

Reported symptom: *"the preview of Daisy Bell is not clear at all, maybe an error in syllable parsing."*
It is not one bug. Eleven were found; three of them fully explained the symptom. All verified by reading
the code and by timing the live preview in the dev build at 48 kHz.

### What the button actually runs

`LeftPane.tsx:7568-7585` → `audioEngine.previewVoicePreset(preset)`.
`AudioEngine.ts:5534-5612` builds a 20-syllable `DAISY_MELODY` (`:5564-5589`, ~8.6 s + 0.44 s of breath
pauses), then for **each** syllable constructs a fresh `VocalModelVoice` (`:5594`) and triggers it at
velocity **1.0** (`:5595`) into a single `previewGain` wired straight to `ctx.destination` (`:5558`).
Two consequences up front: every syllable has identical dynamics, and the preview bypasses the master
limiter and every track FX, so its level/timbre cannot be compared with playback.

### V1 — **High**: the click handler blocks the UI for 4–7 s, and the first syllables are collapsed onto each other — **FIXED 2026-10-25**

Measured on the running dev build (default Soprano, then Celestial Choir, then Robot):

| preset | mode | main-thread block | audio clock advanced during the block | syllables scheduled before "now" |
| :--- | :--- | ---: | ---: | ---: |
| Soprano (default) | waveguide | **4,194 ms** | 1,901 ms | **first 4** ("Dai-sy, Dai-sy") |
| Celestial Choir | fof | **6,993 ms** | 3,139 ms | **first 8** ("Dai-sy, Dai-sy, give me your an") |
| Robot | formant | 859 ms | 240 ms | first 1–2 |

`offset` (the schedule clock) is captured **once** at `AudioEngine.ts:5591`, then every note's buffer is
rendered synchronously inside the same click handler (`:2106-2278` waveguide, `:1886-1955` FOF,
`:1602-1607` a fresh `sr × 1.5` noise buffer per note). WebAudio clamps any `start(t)` whose `t` is
already in the past to "now". Because the audio clock advances ~1.9 s (waveguide) / ~3.1 s (FOF) while
the loop is still rendering, the opening syllables are **started at the same instant as a stack of
overlapping voices**. That is the "not clear at all" sound: a chord of four to eight syllables, not a
melody. The UI is also frozen for the duration.

**Fix applied:** the click handler no longer schedules the whole phrase in one pass. It now schedules in
chunks of ≤90 ms of rendering time, re-reads `ctx.currentTime` before every syllable, and clamps the start
with `Math.max(nextStart, ctx.currentTime + 0.02)` — a past start is now impossible. A generation counter
(`activeVoicePreviewGeneration`) cancels an in-flight schedule when PREVIEW is clicked again or the preset
changes. Re-measured on :5199: 24 `AudioBufferSourceNode.start` calls, **1** marginal past start (the very
first, by design at +20 ms), vowel onsets spaced 0.55 s / 0.46 s apart, and the worst single block
**166–595 ms** instead of 4,194–6,993 ms. The residual per-syllable cost (first 553 ms cold, then
78–113 ms) is the render itself; it is now a series of short stalls instead of one long freeze. Rendering
the phrase into an `OfflineAudioContext` would remove the stalls entirely and is still the better design
(see fix order).

### V2 — **High**: the shipped waveguide presets flatten every vowel to nearly the same tract — **FIXED 2026-10-25**

`AudioEngine.ts:2037-2048` applies the "Pink Trombone" `tongueIndex` / `tongueDiameter` / `lipDiameter`
knobs by **overwriting the vowel's own area function** at a fixed section, for every vowel. Measured with
the Soprano preset (`tongueIndex 28` → section 6, aperture 2.2 cm):

| vowel | primary constriction before → after | lip radiation area before → after |
| :--- | :--- | :--- |
| /i/ | 0.70 → **2.90** (4.1× wider) | 4.0 → 1.62 |
| /u/ | 0.45 → **2.90** (6.4× wider) | 0.45 → 1.62 |
| /o/ | 0.65 → 1.10 | 0.65 → 1.62 |
| /a/ | 3.8 mid-tract **pinched to 2.90** (a constriction is added) | 8.5 → **1.62** (5.2× narrower) |

Mean pairwise tract-shape distance across the five vowels falls 8.67 → 7.17, and /i/ loses the
constriction that produces F2 ≈ 2290 Hz. Every waveguide preset ships these values
(`store.ts:257-286, 315-342, 371-398`), so the default preview physically cannot articulate distinct
vowels. Worse, `dAreasRaw` (the diphthong target) is copied **before** the override (`:2034`), so
mid-note the tract jumps from a flattened vowel to an anatomically correct one.

**Fix applied:** tongue/lip values are now applied only after the user actually moves one of those three
knobs. `VoicePreset` gained `tongueShaping?: boolean`; `updateParam` in `LeftPane.tsx` sets it when
`tongueIndex` / `tongueDiameter` / `lipDiameter` changes, and `AudioEngine.ts` skips the override when the
flag is unset. Shipped presets therefore keep their vowel-specific area functions, and the diphthong target
(`dAreasRaw`) is no longer rewritten. The flag is persisted with the preset, so a user who deliberately
shapes the tract still hears it.

### V3 — **High**: nasals are impossible in every shipped waveguide preset — **FIXED 2026-10-25**

`AudioEngine.ts:2019`:
`velumOpening = preset.velumOpening !== undefined ? preset.velumOpening : (isNasal ? 0.40 : 0)`.
All three waveguide presets set `velumOpening: 0.0` (`store.ts:279, 335, 395`), so `isNasal` is dead code
and /m/ /n/ always render with a closed velum. "me" and "an" have no nasal resonance; the only cue left
is a 350 Hz low-passed noise thud (`:1703-1708`).

**Fix applied:** the velum is now opened to at least 0.40 for a nasal consonant regardless of the preset:
`Math.max(preset.velumOpening ?? 0, isNasal ? 0.40 : 0)`. A preset that asks for more nasal coupling still
gets it; a preset pinned at 0 no longer silences the nasal branch.

### V4 — **High**: no coda consonants exist — **FIXED 2026-10-25**

`parseSyllable` returned only `{vowel, consonant (onset), diphthongTarget}`, so word-final consonants were
never parsed or rendered. In the Daisy text "half" → /h/+/æ/, "all" → /ɔ/, "I'm" → /aɪ/, "give" → /gɪ/,
"love" → /lʌ/, "your" → /joʊ/ and "an" → /æ/ — the lyric was a chain of open syllables.

**Fix applied:** `parseSyllable` now returns `finalConsonant`. The lexicon carries explicit codas
(`give`/`love` → v, `half` → f, `all`/`call`/`fall` → l, `for`/`your`/`swer` → r, `an` → n, `I'm` → m,
`of` → v, plus the common lyric words `time`, `night`, `life`, `moon`, `dream`, `heart`, `world`, …).
The rule-based fallback extracts the trailing consonant cluster, stripping a silent final `e` only when
a vowel remains ("give" → v) and rejecting a bare final h/w ("oh", "now"). `trigger` fires the coda
through the same burst table as the onset (`consonantBurstSpec`, `:2354`) at `duration − codaLen` and
ducks the vowel into it (`:1668-1678`). The vowel gate now ends **on** `duration` instead of 35 ms
after it, so the next syllable's onset is not buried.

### V5 — **Medium**: onset classification is an ordered `includes()` chain with holes — **PARTIALLY FIXED 2026-10-25**

`AudioEngine.ts:1617-1722`, substring tests, first match wins:
- **`c` and `j` match no branch at all** → zero burst for the lexicon entries `"come"`, `"call"`
  (consonant `c`) and `"joy"` (`j`). In the waveguide path `cAreasRaw` is also unchanged and `consLen = 0`
  (`:2057-2088`).
- Clusters are matched by which letter appears first in the chain, not phonetically: `"cr"` (from "cra")
  matches the `l || r` branch → an /r/ burst, so **"cra-zy" is sung "ra-zy"**; `"sw"` (from "swer")
  matches `s` and the /w/ vanishes; `"sk"`, `"st"`, `"pl"`, `"br"` lose their stop.
- `isVoiced` (`:1744`) and the waveguide's `isUnvoiced` (`:2058`) are independent substring lists that
  disagree: `"cr"` is voiced in one and has `consLen 0` in the other; `"h"` gets 100 ms in the burst chain
  and 30 ms in the waveguide.

**Fix applied (partial):** `c` and `j` now have their own branch in the burst chain — a band-passed
affricate/fricative burst at 2.2 kHz (j) / 1.8 kHz (c), 60 ms / 40 ms, scaled by the preset's consonant
volume and length. `"cra-zy"` is no longer sung "ra-zy" because the chain now tests `c`/`j` before the
`l || r` branch. Still open: cluster phonetics (`sw`, `sk`, `st`, `pl`, `br`) and the disagreement between
`isVoiced` and the waveguide's `isUnvoiced` list.

### V6 — **Medium**: two unrelated consonant systems run at once

The band-passed noise-burst chain (`:1609-1739`) executes in **all three** modes and connects straight to
`rackInput`, so in waveguide mode you hear both that raw burst **and** the in-tract turbulence
(`:2237-2248`). The burst is never shaped by the tract. `vowelStartDelay` is derived from the burst
chain's `consDur` (`:1741-1750`) while the waveguide's own closure uses a different `consLen`
(`:2057-2064`), so envelope and articulation are on different clocks. For "half": burst /h/ = 100 ms,
waveguide /h/ = 30 ms, gain is held at 0 until 80 ms — the model's consonant is inaudible and the burst
is not.

### V7 — **Medium**: FOF adds unfiltered white noise and has no consonant model — **PARTIALLY FIXED 2026-10-25**

`:1946` `sampleVal += (Math.random()*2-1) * breath * 0.08` — per-sample white noise with no low-pass, on
top of the packet sum; at the shipped `breathiness 0.08` that is roughly −17 dB of broadband hiss on
every note. FOF also ignores `cAreas` / `isStop` entirely, so only V6's burst articulates.
Separately, `maxActivePulses = 16` with a 35 ms packet life (`:1878`, `:1927`) caps the model at
16 / 0.035 ≈ **457 Hz**; above ~A4 the ring recycles packets that are still sounding (clicks). Daisy's top
note is F4 = 349 Hz, so the preview escapes this and the instrument does not.

**Fix applied (partial):** the per-sample white noise was replaced by a one-pole low-passed noise state
(`noiseState += 0.18 * (white − noiseState)`), removing the broadband hiss while keeping breathiness audible
at a lower level (0.10). The packet ring is now sized from the actual packet life and note frequency —
`maxActivePulses = clamp(ceil(f0 × 0.035) + 4, 16, 64)` — so the ≈457 Hz ceiling is gone up to the clamp.
Still open: FOF still has no consonant model of its own (it relies on V6's shared burst chain).

### V8 — **Medium**: setting any FOF formant frequency silently disables the diphthong glide — **FIXED 2026-10-25**

`:1863-1866` reads `userF[i]` for **both** the start and the target:
`rawF2 = userF[i] !== undefined ? userF[i]! : profile2.f[i]`. Touch one F4/F5 slider and base == target,
so the vowel never morphs. Shipped presets leave `fofF*` unset, so this bites only after editing.

**Fix applied:** the glide now reads the user override **only for the start vowel**. The target formant is
always `profile2.f[i]` when a diphthong exists
(`const rawF2 = hasDiphthong ? profile2.f[i] : rawF1`), so editing a formant no longer freezes the morph.
Monophthongs still track the override in both slots, as before.

### V9 — **Highest structural impact**: the preview is a different synth from the track and the export

- Preview is **always** the JS `VocalModelVoice` (`:5594`); `previewVoicePreset` has no
  `__isJuceNative__` branch.
- Live playback in the packaged build is **always** JUCE: `playNote` posts and returns at
  `AudioEngine.ts:4808-4813`, so the JS vocal path at `:4947-4992` is unreachable there.
- **The native vocal voice is unreachable too.** The instrument string comes from
  `buildNativeNoteOnCommand` (`nativeNoteCommand.ts:49`), which derives it only from `type` or
  `track.instrument`. `type` is declared `'synth' | 'drum' | 'vst3'` (`AudioEngine.ts:4794`) and is passed in
  as `track.instrument` (`Scheduler.ts:192`); `Track.instrument` is the same three-value union
  (`store.ts:675`). "Vocal mode" is not an instrument — it is `{ instrument: 'synth', synthPreset: 'vocal' }`
  (`LeftPane.tsx:7270`).
- The per-note `instrumentOverride` (which *can* be `'vocal'`, set from the Note Inspector at
  `RightPane.tsx:358`) is the **7th** `playNote` argument, and the native call at `AudioEngine.ts:4810`
  simply does not forward it. Every extra argument (`instrumentOverride`, `detune`) is dropped on that path.
- So JUCE receives `noteOn { instrument: "synth", lyric: … }`. `AudioEngine.cpp:617-626` routes it to
  `noteOnSynth(... targetTrack->synthPreset ...)`. `synthPreset` is `"vocal"`, which has no branch in
  `SynthVoice::setPreset` (`native/Source/Audio/SynthVoice.cpp:52-120`) — it lands in the `else // warm`
  case, i.e. the track's previous osc/ADSR or the default triangle.
- `JuceBridge.cpp` contains **zero** occurrences of "vocal": there is no command to set a vocal preset,
  and the 60 Vocal Designer controls have no destination.
- The native vocal implementation that *does* exist is unreachable from the UI, and is itself a stub:
  `VocalModelVoice::setVowelFormants` (`native/Source/Audio/VocalModelVoice.cpp:33-88`) compares the
  **whole string** against `i|ee|e|eh|o|oh|u|oo`, else /a/; `AudioEngine.cpp:615` calls
  `noteOnVocal(...)` with only six arguments, so tractLength 1.0, breathiness 0.1, tension 0.85
  (`VoiceManager.h:45-53`) and no vibrato. If it were reachable, `"Dai"`/`"sy"`/`"swer"` would all be /a/.

Net effect in the shipped build: **a vocal track is a plain triangle synth**, the whole Vocal Designer
panel has no effect on playback or export, and what you preview is not what you hear or render. The
offline renderer reads the same `noteOn` payload (`OfflineRenderer.cpp:51`) and therefore inherits the
same routing — it is not more vocal than playback, only more monophthong if the branch were ever hit.

### V10 — Low: preset-editing semantics

`updateParam` (`LeftPane.tsx:7342`) upserts the **global** preset library on every slider movement; built-ins
can be mutated but not renamed (`:7361`) and there is no reset-to-default. `selectedVoicePresetId`
(`:1211`) is local pane state that resets to `soprano` on remount and is unrelated to the note's actual
`voicePresetId` (set in the Note Inspector, `RightPane.tsx:1363`). There is no lyric field in this pane and
no way to preview your own text — the Daisy text is hard-coded.

### V11 — **High**: the Daisy lexicon mis-sang three words, and the vowel tail masked every next onset — **FIXED 2026-10-25**

The gate held the vowel at full level until `duration` and only then released over 35 ms
(`:1800-1805`), while `previewVoicePreset` starts the next syllable at exactly `duration` (`:5651`).
Every onset consonant therefore played under the previous vowel still at full level; the 30–40 ms
plosives (g, d, b, t, k, p) were buried completely, so the words lost their attacks as well as their
endings. The release is now a 35 ms duck that finishes **on** the note boundary, and a coda gets a duck
as long as its own burst.

Three lexicon entries were wrong for this lyric:
- `"cra"` was `vowel: 'a'` → "crazy" /ˈkreɪzi/ was sung "crah"; **fixed to `e` + `i` glide** = /eɪ/.
- `"swer"` was `consonant: 'sw'` → the silent w in "an-swer" was pronounced; **fixed to `s`**.
- `"your"` had `diphthongTarget: 'u'` → /joʊ/ instead of /jɔr/; **fixed to /jɔr/** with a final r.
- `"of"` was /ɒ/; **fixed to /ʌ/ + v.**

**Verification:** an `OfflineAudioContext` render of the real `VocalModelVoice` for "give" and "you"
(waveguide, FOF, formant) shows non-silent output in every mode, peak 0.02–0.62 (no clipping), and
**0.00000 RMS after the note boundary** in all six renders — the vowel no longer spills into the next
syllable. The parser was re-run over all 20 Daisy syllables: Dai /daɪ/, sy /si/, give /gɪv/, me /mi/,
your /jɔr/, an /æn/, swer /ser/ (schwa approximated by /e/), do /du/, I'm /aɪm/, half /hæf/,
cra /kreɪ/, zy /zi/, all /ɔl/, for /fɔr/, the /θe/ (schwa approximated), love /lʌv/, of /ʌv/, you /ju/.

Still open: the coda is a noise burst, not a voiced constriction, so /v/ and /l/ are approximated by
frication rather than real voicing (V6 — two consonant systems still run at once).

### Reproduction

1. Open Vocal Designer, keep Soprano, click PREVIEW → UI freezes ~4 s and the opening syllables overlap.
   Switch to Celestial Choir (FOF) → ~7 s freeze, first eight syllables stacked.
2. In the packaged build, put lyrics on a vocal track and play → a plain triangle synth (not a voice at
   all); moving any Vocal Designer slider changes nothing, and the lyric never reaches the engine.
3. In the dev build, play the same track → the JS model. V2–V4 and V11 are fixed; V6 (two consonant
   systems) and V9 (native vocal unreachable) remain.

### Fix order — status as of 2026-10-25

1. **Native (V9) — still open.** Port a syllable parser and send parsed vowel + preset fields over the
   bridge; until then the panel is decorative in the packaged build. This is the largest remaining item.
2. **Preview (V1) — fixed.** Chunked scheduling with a per-syllable clock read; freeze 4.2–7.0 s → 0.17–0.60 s
   and no stacked onsets. Rendering the phrase into an `OfflineAudioContext` remains the better long-term
   design and would remove the residual 80–110 ms stalls.
3. **Waveguide (V2/V3) — fixed.** Tongue/lip applied only after the user moves a knob; nasality derived per
   consonant.
4. **Parser (V4/V5/V11) — fixed for the Daisy path.** Codas parsed and rendered, the Daisy lexicon
   corrected, and the vowel gate no longer masks the next onset. Still open: general cluster phonetics
   (`sw`, `sk`, `st`, `pl`, `br`) and the `isVoiced` / `isUnvoiced` disagreement (V6).
5. **FOF (V7/V8) — partially fixed.** Breath noise low-passed, packet ring sized from `f0`; V8 fixed.

---

## 6. FEATURE INVENTORY BY PANEL

*(populated from the seven audit passes; each row = one control, with wiring status and defect)*

Legend for **Status**: `native` = the control reaches the JUCE engine · `Tone only` = works in the dev/web
build but has no native command, so it is inert in the shipped app · `store only` = changes UI/project state
with no audio effect · `dead` = no handler or unreachable · `partial` = wired with a specific defect.
Rows marked ◐ assert status at **group** level; the individual controls in that group were enumerated but
not each tested.

### 6.1 Top bar — `src/App.tsx`

| Control | Where | Status | Verified defect |
| :--- | :--- | :--- | :--- |
| PLAY / STOP | `:525-528` | native | Tooltip says "Start Playback (Space)" / "Stop Playback (Space)" — **no Space handler exists** (K1). The tooltip is the lie that started K1. |
| BPM − / + / numeric field | `:538-594` | native | `setBpm` exists in the bridge. Per-track `targetTempo` multiplier then diverges from this value (see 6.10 playhead rows). |
| Playhead follow: playhead / grid | `:595-604` | store only | View-only; the mode is not persisted in the project (autosave omits view settings, `store.ts:2877-2949`). |
| New Project | `:684` | store | Destructive confirm modal at `:1580`. |
| Save / Save As… | `:696-768` | IPC | No Ctrl+S (K3); menu-only. |
| Open Project / .muztrack | `:783` | IPC | No Ctrl+O (K3). |
| Export menu (WAV / MP3 / stems / MIDI / …) | `:901-1014` | native | See 6.12. |
| Help / manual | `:1042` | modal | — |
| F11 fullscreen | `:221-236` | native IPC | **The only global key handler in the app.** |

### 6.2 Left pane — tools and edit actions (`src/ui/LeftPane.tsx:4515-4526`)

| Control | Status | Verified defect |
| :--- | :--- | :--- |
| Draw / Erase / Select / Slice / Stretch (5 tools) | store only | Tooltips advertise "(D) (E) (S) (X)" — no such shortcuts exist (K2). `slice` and `stretch` are silently inert unless notes are selected. `features.md` lists Move/Join/Mute tools; the store union has only these five (`store.ts:934`) — those three do not exist. |
| Cursor feedback per tool | partial | Only draw→crosshair and erase→cell; select/slice/stretch all get `default`, so 4 of 5 tools are visually identical (`GridCanvas.tsx:2778, 3033`). |

### 6.3 Left pane — grid, song, quantize, groove

| Group (control count) | Where | Status | Verified defect |
| :--- | :--- | :--- | :--- |
| Master Volume (1) | `LeftPane.tsx:4287` | **Tone only** | Sets `Tone.Destination.volume` only (`AudioEngine.ts:2859`). Native `masterVolume` is declared at `AudioEngine.h:205` and **never read**, and no bridge command carries it — so in the packaged build this slider does nothing and there is no gain stage before the limiter (see 6.8 for the per-engine master bus). |
| Click / Swing / Loop Start / Loop End (4) | `:4542-4546` | native / store | Loop Start/End are ticks; changing tempo does not rescale the stored loop. |
| Block Time / Shade Width / Timeline (3) | `:5405-5407` | store only | Purely visual. |
| Min Note Size (1) | `:5416` | store only | — |
| Lowest / Highest Octave (2) | `:5422-5423` | store only | Bounds are not enforced against existing notes; reducing the range hides notes without warning. |
| Timing / Velocity Strength, Quantize Strength (3) | `:5671-5735` | store only | Quantize strength is read by `Q`; see K7 (fires on Ctrl+Q). |
| Drum row map: Pitch A/B, Proportion, Frequency (4) | `:641-682` | store only | Edits the mapping used by the drum grid; resets when a kit is re-selected. |
| Magnetic Snap / Merge Threshold (2) | `:838-839` | store only | — |
| Piano-roll bounds / QWERTY typing piano / EDO remap (sections) | `:5000-5450` | partial | QWERTY typo piano ignores the focused-button guard (K4), so typing on the piano stops working after one click elsewhere. |

### 6.4 Left pane — synth engine and custom rows

Fourteen sliders at `LeftPane.tsx:6256-6314`: Attack, Decay, Sustain, Release, Harmonicity, Mod Index,
Mod Attack/Decay/Sustain/Release, Filter Cut, Filter Q, plus the custom-synth rows (Base Freq, Octaves,
F-Attack, F-Decay, F-Sustain, F-Release) and the waveform/preset selects.

| Group | Status | Verified defect |
| :--- | :--- | :--- |
| ADSR + filter (10 controls) | native | `setTrackSynthParam` demotes the preset to `"custom"` but **does not clobber the other params** (`AudioEngine.cpp:250-273`) — the earlier "preset custom clobbers edits" claim was wrong. |
| Mod envelope (5 controls) | Tone only | No native counterpart in `AudioEngine.cpp`; in the packaged build these sliders move but do nothing. |
| Waveform / preset select | native | **`'sawtooth'` maps to oscillator 4 = Noise** at `JuceBridge.cpp:630`, while `:627` handles `'saw'` correctly. Any code path sending `'sawtooth'` gets noise instead of a saw. |
| Custom synth rows (4 controls) | store only | Row pitch label is double-scaled in the canvas (`GridCanvas.tsx:1804-1810`). |
| Sampler mode | native | Wired in both engines (session task #2/#5). |

### 6.5 Left pane — Vocal Designer (`LeftPane.tsx:7284-7600`)

In this table **preview only** means the control affects the JS Daisy Bell preview and nothing else. In the
native build a "vocal track" is `{ instrument: 'synth', synthPreset: 'vocal' }`, and JUCE treats that
preset as an unknown name → default triangle synth (V9). There is no vocal path to reach.

| Group (count) | Where | Status | Note |
| :--- | :--- | :--- | :--- |
| Preset select / New / Delete / Name (4) | `:7284-7364` | store only | Global library upsert; built-ins cannot be renamed; no reset (`:7361`). |
| Vocal engine mode select (3 modes) | `:7374-7382` | **preview only** | No native command carries `synthesisMode`. |
| Tract anatomy (9 sliders) | `:7395-7403` | **preview only** | Also the source of V2 (vowel flattening). |
| Aerodynamics (3) | `:7411-7413` | **preview only** | — |
| Glottal source (6) | `:7421-7426` | **preview only** | — |
| Consonants (3) | `:7434-7436` | **preview only** | Consonant settings never reach JUCE. |
| Buffer envelope (2 + 2 checkboxes) | `:7444-7455` | preview only | — |
| FOF formants F1–F5 shifts, bandwidths (10) | `:7472-7481` | **preview only** | Touching any FOF frequency disables the diphthong glide (V8). |
| FOF envelope/morph (4) | `:7489-7492` | preview only | — |
| FOF glottal/vibrato (7) | `:7500-7506` | preview only | FOF breath is unfiltered white noise (V7). |
| Formant-mode controls (12) | `:7551-7563` | preview only | — |
| PREVIEW VOICE — DAISY BELL | `:7568-7585` | **JS only** | Chunked scheduling (V1); codas, lexicon and the vowel gate fixed (V4/V11). Not the sound the track renders (V9). |
| Import / Export preset (.muzice) | `:7587-7600` | store/IPC | Export writes the whole preset object; import is not validated. |

Total in this panel: **~67 controls**, of which **60 have no effect on native playback** (and the other
seven — library select/new/delete/name and preset I/O — only change what the preview reads).

### 6.6 Left pane — drum designer / drum grid

| Group (count) | Where | Status | Verified defect |
| :--- | :--- | :--- | :--- |
| Amp ADSR (4) | `:10625-10628` | native (`drumDecay` only) | Only decay is transmitted; attack/sustain/release are Tone-only. |
| Filter / Detune / Glide (4) | `:10657-10660` | Tone only | No native drum filter. |
| Kit select | — | native | `setKitByName` uses `contains()`; `'eightOhEight'` does **not** contain `"808"` → falls through to Default (`DrumEngine.cpp:41-49`). |
| Drum grid channels, custom mixes, proportional mixer | `:641-682` | store only | Mix proportions are not applied to the native drum engine. |
| Drum row map / custom drum rows | section | store only | `pitchOffset` notes still render on the parent row (`DrumSequencer.tsx:40, 205`). |

### 6.7 Left pane — MIDI performance FX / generators

| Group (count) | Where | Status | Note |
| :--- | :--- | :--- | :--- |
| Velocity scale / offset / pitch sens (3) | `:7924-7926` | store only | Applied at insertion time, not destructively. |
| Density (1) | `:8157` | store only | — |
| Steps / Pulses / Rotation / Pitch (4) | `:8519-8533` | store only | — |

### 6.8 Left pane — FX racks and master chain

Thirty-one FX and master controls. Native FX are **one processor per type**, in a fixed order, so the rack
UI (ordering, duplicates, bypass) is largely a front-end fiction.

| # | Control | Where | Status | Defect + evidence |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Effects chain drag-reorder | `LeftPane.tsx:10226-10233` | store only | Reorder mutates `fxInstances` / the Tone rack; the native chain is hard-coded eq→distortion→bitcrush→filter→chorus→phaser→delay→dpreverb→reverb→freeverb (`AudioEngine.cpp:843-852`). |
| 2 | Card ON/OFF (bypass) | `:10262-10297` | partial | No bypass in the native protocol; JS sends `wet: 0`. Because there is one processor per type, bypassing one duplicate silences **every** instance of that type (`AudioEngine.ts:3254-3281`). |
| 3 | Duplicate Effect (＋) | `:10312-10333` | **store only** | Native keeps one processor per `fxType`; the last posted duplicate wins and both cards edit the same state (`AudioEngine.cpp:386-457`). |
| 4 | Delete Effect (×) | `:10335-10341` | store only | The sole built-in instance cannot be removed; `getTrackFxInstances` re-inserts any removed default (`store.ts:1948-1953`, `fxDefaults.ts:60-71`). |
| 5 | Add Effect → VST3 | `:10384-10405` | native | VST3 is always processed **after** all built-ins, so a mid-chain insert is ignored (`AudioEngine.cpp:854-912`). |
| 6 | Add Effect → Custom JS FX | `:10408-10434` | **Tone only** | `applyTrackSettings` has no branch for custom ids except `custom-bitcrusher`, so the card is silent natively (`AudioEngine.ts:3320-3325`). |
| 7 | EQ Low / Mid / High | `:9446-9448` | native | Bypass zeroes gains instead of true bypass; bands fixed at 250/1k/4k Hz with no type/frequency control (`EQEffect.h:76-88`). |
| 8 | Drive | `:9454` | native | **Labelled Drive but sends `wet` (mix)**; the real drive is "Grit" (`AudioEngine.cpp:400-401`). |
| 9 | Grit | `:9455` | native | Sets drive 0–1; native output is gain-compensated by `1/(1+drive*0.5)`, unlike Tone (`DistortionEffect.h:70`). |
| 10 | Chorus wet / C-Rate / C-Depth | `:9461-9463` | native | Rate clamped 0.05–20 Hz natively, 0.1–10 in the UI (`ChorusEffect.h:41-44`). |
| 11 | C-Delay | `:9464` | native | Free text, no unit; silently clamped 0.5–20 ms (`ChorusEffect.h:52-55`). |
| 12 | Phaser wet / P-Rate / P-BaseFreq | `:9470-9473` | native | Clamped 0.05–20 Hz; base clamped 50–5000 Hz (`PhaserEffect.h:41-49`). |
| 13 | **P-Oct** | `:9472` | **dead** | Never posted (`AudioEngine.ts:3312-3315`) and `PhaserEffect` has no octave setter at all. |
| 14 | Delay wet / D-Time | `:9479-9480` | native | Delay length is recomputed per block with no smoothing → clicks/zipper while dragging (`DelayEffect.h:58-59`). |
| 15 | Feedback | `:9481` | native | UI caps 0.9, native 0.95 (cosmetic mismatch, `DelayEffect.h:41-44`). |
| 16 | DPreverb wet | `:9487` | native | — |
| 17 | DPreverb Tail | `:9488` | partial | JS sends `tail/10` into `setRoomSize`; tail ≥ 10 s saturates at 1.0 (`AudioEngine.ts:3295`, `AudioEngine.cpp:419`). |
| 18 | **DPreverb Shape** | `:9489` | **dead** | `decay` is never posted; natively `decay` also maps to roomSize, not a shape (`AudioEngine.ts:3294-3297`). |
| 19 | DPreverb Tone | `:9490` | native | Becomes reverb damping, not a band-pass tone (`AudioEngine.cpp:421`). |
| 20 | Reverb wet | `:9496` | native | **Mix law is wrong**: `dryLevel = 1 − wet*0.5` (`ReverbEffect.h:66`) → the wet/dry sum exceeds unity, up to **+3.5 dB at wet = 1**, pumping the limiter. |
| 21 | R-Decay | `:9497` | partial | Sent as `roomSize = decay/10`; 2.5 s becomes 0.25, so there is no real decay-time control (`AudioEngine.ts:3299-3301`). |
| 22 | **R-PreDelay** | `:9498` | **dead** | Never posted; native reverb has no pre-delay parameter. |
| 23 | Freeverb wet / F-Room | `:9504-9505` | native | — |
| 24 | F-Damp (Hz) | `:9506` | partial | UI Hz ÷ 10000 into a 0–1 damping factor; 20 kHz becomes 2 → clamped 1 (`AudioEngine.cpp:433`). |
| 25 | FX Tail Buffer | `:501` | store only | Render-only setting; the native bounce never receives it. |
| 26 | Procedural f(x) modulators | `:361-381, 9437-9440` | **Tone only** | Require a Tone rack; the native branch returns before racks exist and there is no modulator command (`AudioEngine.ts:2917, 3327`). |
| 27 | VST3 mix / bypass | `:9515-9519, 9572-9583` | native | Bypass applied twice (flag + wet 0); wet defaults differ (UI 0.4, struct 1.0) (`AudioEngine.cpp:1112`). |
| 28 | Master Volume | `:4287` | **Tone only** | See 6.3 — no native gain stage. |
| 29 | Master Limiter toggle | `:4406-4424` | **Tone only** | Native limiter is unconditional; "off" is not representable (`AudioEngine.cpp:924-927`). |
| 30 | Limiter Threshold | `:4428-4437` | **Tone only** | Native is fixed at −0.3 dB / 50 ms (`LimiterEffect.h:22-23`); Tone "off" still limits at 0 dB (`AudioEngine.ts:2883`). |
| 31 | Master meter | — | **absent** | No master/mixer meter exists, and the bridge exposes no audio levels (`JuceBridge.cpp:565-800`). The only meter in the app is the mic analyser in the import modal, which is WebAudio-only (`ImportAudioModal.tsx:452-487`). |

Also verified: in the JS renderer the metronome and the vocal preview both bypass the JS master limiter
(`AudioEngine.ts:2670-2682`, `:5558`). The native export click added in §12 is mixed into the master
bus before the limiter instead.

### 6.9 Mixer, tracks, groups, clips

The app has **no mixer view**. "Mixer" in the UI means the per-track strip in the sidebar
(`LeftPane.tsx:9409-10150`) plus the "Note Mixer" section (`:568-700`), which injects custom pitch
rows and proportional drum-mix rows rather than mixing levels.
Everything below was checked against both engines; "native" means the change reaches JUCE.

| # | Control / feature | Where | Status | Verified defect |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Track list, root tracks + nested subtracks | `:9409`, `:10900-10930` | store | Nesting exists only in the sidebar; both engines treat a child as a peer track. |
| 2 | Add Synth / Add Drum track | `:2213-2244` | native | `createInstrument` is posted; the child is seeded `volume: 0.8` and copies nothing else (no FX, no send). |
| 3 | Add track as subtrack / "Make subtrack of..." | `:11386`; menu `:11240` | store | `parentId` never crosses the bridge — `createTrack` payload is only `{ trackId, instrument }` (`AudioEngine.ts:3125-3129`). |
| 4 | Inline rename (double-click) | `:9664-9681` | store | Empty names fall back to the old name, but the rename never calls `commitHistory()` — Ctrl+Z skips it. |
| 5 | Collapse / expand strip | `:9628` | store | Collapsed hides Vol/Pan/FX; mute, solo and OFF stay. Correct. |
| 6 | **M** mute | `:9686` | native | Synced by `applyTrackSettings` (`AudioEngine.ts:3147-3152`); solo isolation scans all tracks (`AudioEngine.cpp:758-768`) — correct. |
| 7 | **S** solo | `:9687` | native | Same path. Correct while the track exists in JUCE; see #8. |
| 8 | **OFF** — "Kill / Note-Off … on this track" | `:9700-9734` | **global** | Posts `allNotesOff` **with** `trackId` (`AudioEngine.ts:4317-4320`), but the bridge calls `audioEngine.allNotesOff()` with no argument (`JuceBridge.cpp:577-580`) → every track is cut. The toast ("Sent Note-Off to <name>") is wrong. |
| 9 | Vol fader | `:9739` | native | Range is 0–1, native clamps 0–2 (`AudioEngine.cpp:198-205`). A track seeded above 1 renders pinned at the top and the fader cannot restore it (see #18). |
| 10 | Pan | `:10143` | native | Only shown for the active track inside the expanded strip. |
| 11 | Hide track (context menu) | `:11304`; bulk `:11127` | **visual only** | Dims the row (`:9650`) and suppresses cross-grid ghosts (`GridCanvas.tsx:1111`); the scheduler never reads `hidden`, so a hidden track still plays and exports. |
| 12 | **Delete Track** | `:11388` | **lost / leaky** | Calls `removeTrack(id)` and nothing else: no `commitHistory()` (not undoable), no `audioEngine` call, no `removeTrack` post — the command exists at `JuceBridge.cpp:599` and has **zero callers in `src/`**. `store.removeTrack` (`store.ts:1679-1692`) drops tracks/notes/automation but not `clips` and not `groups[].trackIds` → orphan clips and dangling group members. |
| 13 | Delete a **soloed** track | `:11388` + missing bridge call | **silences the project** | The native track survives with `soloed = 1`, so `hasSolo` stays true and every surviving track is skipped (`AudioEngine.cpp:758-768`). Nothing in the UI can un-solo it, because it is no longer in `tracks`. |
| 14 | Duplicate track(s) | `:11176` | store | Remaps `parentId` correctly (`store.ts:1727-1742`); the copy gets a fresh native track only when `applyTrackSettings` next runs. |
| 15 | Merge into… | `:11433-11460` | store | Moves notes/clips and removes the source rows via **raw `useStore.setState`**, bypassing `removeTrack` and history; sources also leak in JUCE (#12). |
| 16 | Sync settings from another track | `:11210` | store | Copies a fixed field list (`store.ts:2597-2660`): volume, pan, EQ, the ten legacy FX scalars, transpose and (same instrument only) preset/ADSR/kit. It does **not** copy `fxInstances`, so FX cards, their order and per-card settings stay behind. |
| 17 | Track count / drag reorder | `:9620` | store | Reorder is a `tracks[]` permutation; no engine impact (expected). |
| 18 | **Generated / AI tracks** | `:2319`, `:2383`, `:3087`, `:3120` | **wrong level** | Four creation paths seed `volume: 100` (diatonic chords/bass, suggestions, AI chorale voices — three tracks at once — and AI chords/bass) where every other path uses 0–1. Native clamps to 2.0; the Tone path converts with `gainToDb(100)` = **+40 dB**. The generated tracks therefore arrive at/above clipping and their fader shows 1.0. |
| 19 | Groups — create / add active track / remove member / delete | `:9291-9317` | **UI only** | `TrackGroup` is `{ id, name, color, trackIds, collapsed }` (`store.ts:857-863`): no gain, mute, solo or bus, and no native command. Grouping does not affect the mixer at all. |
| 20 | Group rename / recolour | `:9296-9301` | **absent** | The name is generated as `Group N` and there is no input to change it; the colour is fixed at `#b197fc`. `collapsed` only hides the member list in this section. |
| 21 | Deleting a group | `:9300` | store | Removes the list entry only; members are untouched (correct), but a deleted track's id stays in every group that contained it (#12). |
| 22 | Pattern Clips — create from selection | `:2402` | store | Stores `{ startTick, endTick }`; clips are **never drawn on the grid and never played**. |
| 23 | Clip generative bake (`Generate`) | `:8506-8512` | store | `generateClipNotes` (`store.ts:2473`) writes real notes into the track; the clip remains a bookmark. Toast says "Baked … pattern", which is accurate. |
| 24 | Clip type / pitch / overwrite / remove | `:8483-8560` | store | All operate on note material only. Deleting the track leaves the clip behind (#12). |
| 25 | Note Mixer → Custom Pitch row | `:594-608` | native | Computes one interpolated MIDI pitch from two notes and adds a grid row (`customSynthRows`); notes placed on it carry that pitch, so both engines play it. Correct. |
| 26 | Note Mixer → proportional **Custom Hit** drum row | `:611-627` | **Tone only** | The row's synthetic pitch is `1000 + Date.now() % 10000` and the A/B velocity split (`proportion`) exists only in the JS drum path (`AudioEngine.ts:4473-4481, 5286-5291`). Natively the pitch reaches `triggerHit`, whose fallback is `((pad % 16) + 16) % 16` (`DrumEngine.cpp:82-84`) → it sounds **one arbitrary pad** (whichever the timestamp happens to select) at full velocity instead of the two mixed hits. |

Track struct size: 121 fields, of which 23 are UI-only and 19 are referenced nowhere (§8.4).

### 6.10 Grid canvas — `src/renderer/GridCanvas.tsx`

| # | Group / feature | Where | Status | Verified defect |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Row/column geometry | `:190, 211-236` | store only | `getYPitch` returns 60 for out-of-range y (`:232`); a hidden row = `-1000` (`:221`) is still drawn if the pitch rounds into range. |
| 2 | Snap grid / subdivision lines | `:366-367, 1171-1212` | **dead** | `snapResolution` / `snapTick` are never drawn; only used for step-record and input. |
| 3 | Scale-fold shading | `:194-207, 1215-1231` | partial | Fold forced off for EDO (`:195`); fold rows keyed by `String(Math.round(p))` so micro pitches collapse (`:216`). |
| 4 | EDO row background and lines | `:1234-1254, 1322-1345` | partial | `gridSizeY` clamped 10–32 px (`:190`) → 53-EDO is unreadable at any zoom. |
| 5 | Horizontal row lines | `:1347-1352` | partial | **No `beginPath()`** before the batch (cf. `:1328`) → re-strokes a stale path. |
| 6 | Vertical grid lines | `:1188-1211` | partial | Same path stroked twice (`:1191` and `:1211`) → majors drawn 2×. |
| 7 | Ghost notes (same instrument) | `:298-303, 1416` | store only | Selection colour white overrides track colour (`:1415`). |
| 8 | Cross-grid ghosting | `:305-308, 1553-1566` | partial | No horizontal culling (`:1554`); pitch ignored — synth ghosts are a 5 px strip, drum ghosts full-height bars. |
| 9 | Loop bracket | `:1267-1282`; timeline `:994-999` | native | No drag handles (`:1279`); the two copies use different coordinate spaces (screen vs world). |
| 10 | Playhead (grid) | `:1677-1684` | native | Uses `tickToX(playhead × multiplier)`. |
| 11 | Playhead (sticky timeline) | `:1065-1079` | native | Uses `tickToX(playhead)` with **no tempo multiplier** → two playheads at different x on any `targetTempo` track. |
| 12 | Playhead-follow pan | `:522-528` vs `:1119-1120` | partial | `getEffectivePanX` uses raw ticks; render uses `tickToX` → drift once a column is resized. |
| 13 | EDO / custom row labels | `:1736-1810` | partial | `globalAlpha` leaks from the previous row into the next row's `fillRect` (`:1794`→`:1758`). |
| 14 | 12-TET piano-key labels | `:1814-1873` | partial | Same alpha leak (`:1867`→`:1826`). |
| 15 | customSynthRows labels | `:1804-1810, 1875-1881` | partial | `getPitchY(row.pitch) × (scaledGridSizeY/gridSizeY)` = double scaling. |
| 16 | MPE note colouring | `:1438-1450` | store only | All MPE fields collapse to one 2.5 px dot; no pressure/timbre/bend hue. |
| 17 | Pitch-glide trajectory | `:1497-1549` | native | `shadowBlur = 4` per note per frame (`:1509`). |
| 18 | Micro cents / badge | `:1464-1495` | partial | `edo \|\| 53` fallback (`:1470`) mislabels 12-TET fractional notes. |
| 19 | Velocity lane | `:1894-2073` | **Tone only** | x uses raw ticks (`:1954`) while the grid uses `tickToX` (`:1398`) → thumbs misalign on resized columns. |
| 20 | Lane playhead | `:2039` | Tone only | Raw tick, no multiplier, no `tickToX` — a third mapping. |
| 21 | Automation curve render | `:2013-2019` | store only | Samples every `max(4, 8/zoom)` ticks → ~19k `lineTo` per frame. |
| 22 | Velocity hit priority | `:3428-3446` | store only | No vertical threshold → any note within 15 ticks steals the click; automation points are unreachable. |
| 23 | Loop handle drag | `:2970-2977` | store only | World-x used as ticks (`snapTick(x)`), ignoring `xToTick`. |
| 24 | Slice tool | `:2620-2630` | native | `Math.round(xToTick)` ignores snap; `pitchEnd`/`bpm` copied wholesale. |
| 25 | Erase tool / right-click delete | `:2615-2618`, `:2567` | native | `removeNote` with **no `commitHistory()`** → not undoable. |
| 26 | Box select | `:2989-3015` | native | Correct (header offset subtracted at `:2992`). |
| 27 | Note hit-test for short/micro notes | `:2539-2553` | native | `8/zoom` minimum end → notes < 8 px are pure resize; 6/zoom on 10 px EDO rows = cannot move. |
| 28 | Stretch tool | `:2940-2966` | native | Writes **fractional tick times** → invalid MusicXML durations. |
| 29 | Export-region overlay | `:1001-1043, 1284-1319` | store only | Lerp state lives in a ref and never marks dirty. |
| 30 | rAF structure | `:862, :1099, :1894` | partial | Three always-on loops, no dirty/visibility check, 60 fps while stopped. |
| 31 | Render-loop deps | `:1891` | partial | `customRowOrder` / `effectiveRowOrder` / `drumRows` missing → stale row map after reorder. |
| 32 | Read-only state | `:1430, 2778, 3033` | partial | Only cursor + resize suppression; no banner/watermark. |
| 33 | Keyboard layer | `:601-610` | partial | Early return on `BUTTON` kills every shortcut after a toolbar click (K4). |

### 6.11 Drum sequencer — `src/renderer/DrumSequencer.tsx`

| # | Feature | Where | Status | Defect |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Step toggle | `:78-89` | store only | `Math.round(time/STEP)` (`:73,76`) vs `Math.floor` playhead (`:69`) → cell and flash disagree by one step. |
| 2 | Notes outside `0..steps` | `:191, 211` | partial | Invisible and untoggleable. |
| 3 | Velocity | `:264-275` | store only | Permanent inline slider per active cell (no popup); `updateNote` without `commitHistory` (`:93`). |
| 4 | Resolution buttons | `:115-117` | store only | Triplet labels wrong: 64→"1/12T", 32→"1/24T" (should be 1/8T, 1/16T). |
| 5 | Custom ticks / steps | `:131-137, 155-161` | store only | `snapResolution` is shared with the synth grid → editing drums changes piano-roll snap (`GridCanvas:367`). |
| 6 | Pad row mapping | `:40, 205` | store only | Exact `row.pitch` match; `pitchOffset` notes land on the parent row. |
| 7 | Drag-paint | — | **dead** | No pointerdown/move painting; only `onClick` (`:221`). |
| 8 | Playhead sync | `:62-70` | Tone only | `% drumSteps` (no drift); loop overlay `:177-190` uses `%` of the flex container, not the step cells. |
| 9 | Place-playhead menu | `:294` | Tone only | `import('tone')` at click time inside the native build. |

### 6.12 Score editor, preview and export

| # | Feature | Where | Status | Defect |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Staff / ledger geometry | `ScoreEditor.tsx:156-166, 593-602` | store only | F4 fix holds. |
| 2 | Duration glyphs | `:605-608, 759-762` | partial | Thresholds 144/72/18/36 with PPQ 192 → quarter (192) drawn whole, eighth (96) drawn half: **off by two levels**. |
| 3 | Beams / key signature | — | **dead** | Individual flags only (`:674-691`); sharps hard-wired (`:28-41`); no key-sig control. |
| 4 | Time signature | `:135-136` | store only | `beats × 192` assumes a quarter beat → 6/8 measures are twice the real length (`:359`). |
| 5 | tick↔x hit mapping | `:172-184, 227-229` | partial | `getBoundingClientRect()` CSS px vs an 840-unit viewBox → up to 20 % x error. |
| 6 | Notation→MIDI edits | `:247-288, 624-635` | store only | `addNote`/`removeNote` never `commitHistory` → score edits are not undoable; **no read-only guard at all**. |
| 7 | Non-12-TET staff position | `:22-77, 205` | partial | Rounded to nearest MIDI (`:24`); hover preview calls `getPitchDiatonic(pitch)` without EDO args → label differs from the placed note (`:588`). |
| 8 | Score playhead | `:897-921` | partial | Emitted as siblings inside a non-relative flex scroller (`:402`) → anchors to the pane. |
| 9 | Preview: multi-staff durations | `ScorePreviewModal.tsx:460-468` | partial | No duration glyphs/dots — every note is a stem + filled head (`:583-598`). |
| 10 | Preview: time signature | `:525-526` | **dead** | Hard-coded "4/4". |
| 11 | Preview: drum staff | `:561` | partial | All drum pitches flattened to `yCenter`; clef glyph `𝄥` is a bass clef (`:519`). |
| 12 | Preview: accidentals / micro | `:591, 560` | partial | Literal `♯` always; EDO pitches silently snapped, no cents badge. |
| 13 | Print / PDF | `:96-160` | **Tone only** | `window.open('','_blank')` + `document.write` → silent no-op in WebView2 (`:98`). |
| 14 | PNG export | `:197-224` | native | No `img.onerror` → the promise can hang forever. |
| 15 | MusicXML filename | `:246` | native | `/\\s+/g` (escaped backslash) → spaces are not replaced (cf. correct `:227`). |
| 16 | XML divisions | `scoreExport.ts:19-22` | native | Correct beat-type handling — **contradicts** the on-screen `beats × 192`, so bars differ from the screen for x/8. |
| 17 | XML note type | `:56-62` | native | Always treats `ticksPerBeat` as a quarter → 6/8 durations one level long. |
| 18 | XML chord length | `:191-192, 217` | native | All voices forced to `chordNotes[0].duration`. |
| 19 | XML measure overflow | `:192` | native | Clamped to `endTick` with **no tie/notations** → note tails dropped. |
| 20 | XML micro pitch | `:86-124, 115-116` | native | 53-EDO alter ±0.23 emitted as a sharp; pitch 71.9 → `B♯4` (wrong octave + accidental). |
| 21 | XML fractional duration | `:217` ← `GridCanvas:2954` | native | Stretch writes float times → non-integer `<duration>` → invalid file. |
| 22 | `saveFileWithDialog` | `fileExport.ts:40-79` | native | Passes a **data: URL string** to the `save-file` channel (`:59,64`); falls through to an anchor download in WebView2 (`:76-78, 109-121`). |
| 23 | `.muztrack` parse | `scoreExport.ts:353-361` | store only | Accepts any object with a `tracks` array — no field validation. |

### 6.13 Note inspector — `src/ui/RightPane.tsx`

| Group | Where | Status | Note |
| :--- | :--- | :--- | :--- |
| Track assignment / instrument override | `:838, 865` | native | Override wins over the track instrument in `nativeNoteCommand.ts:49`. |
| Note BPM override | `:904` | partial | Multiplies tick→seconds only; the canvas playhead does not apply the same multiplier (6.10 #11). |
| Play full note on pause | `:953` | Tone only | — |
| Velocity / Detune / Pitch-Row | `:1020-1126` | native | Detune becomes a fractional MIDI pitch, correct. |
| Vocal singing settings (lyric + voice preset) | `:1325-1388` | **partial** | This is the *only* place `voicePresetId` is set (`:1363`); the Vocal Designer dropdown is unrelated (V10). The lyric string crosses the bridge inside `noteOn`, but no native branch reads it because the instrument is always `synth` — the note plays as the track's triangle synth (V9). |
| MPE expression | `:1389+` | store only | Pressure/timbre stored, collapsed in the canvas (6.10 #16). |
| Timing & duration | `:1589` | native | — |
| Merge / deduplicate | `:1778` | store only | — |

### 6.14 Modals and system

| Feature | Where | Status | Note |
| :--- | :--- | :--- | :--- |
| Synth Studio | `SynthStudioModal.tsx` | native | F1/F2 fixed this session. |
| Drum Designer | `DrumDesignerModal.tsx` | native | Has its own keydown listener (`:547`). |
| Import Audio | `ImportAudioModal.tsx` | native | Own listener (`:852`). |
| Scripting console | `ScriptingModal.tsx` | partial | `Muse.notes` / `Muse.voice` exposed; script FX are JS-only and are guarded on bounce (F5). |
| MIDI edit | `MidiEditSection.tsx` | store only | 4 raw `<select>`s, 1 hand-rolled slider (H3/H4). |
| Help / manual | `App.tsx:1042` | static | — |
| Toast notifications | `showToast` | working | — |
| Autosave / crash recovery | `store.ts:2877-2949` | partial | Omits **all view settings** (zoom, scroll, follow mode, split ratio, selected pane). |
| Project serializer | `App.tsx:63-82` | partial | Serialises notes/tracks + voice presets; omits UI state. |
| Export panel (WAV/MP3, bit depth, metronome) | `LeftPane.tsx:2441` | native for WAV | Offline WAV renders in JUCE, VST3 included, and now also carries the Click panel metronome (F7). MP3, multi-region and Procedural FX still render in Tone. |

### 6.15 Keyboard (summary — full table in §4)

| Shortcut class | Reality |
| :--- | :--- |
| Transport (`Space`) | **absent** (K1) |
| Files (`Ctrl+S/O/R`) | **absent** (K3) |
| Tools (`D/E/S/M/X/J/T`) | **absent** (K2) |
| Edit (`Ctrl+Z/Y/C/V/A/L/G`, `Q`, `Delete`) | present, with K5/K6/K7 defects |
| Transform (`Shift+↑/↓`, `Ctrl+↑/↓`, `Alt+S/U/A/R/Y`) | present; Alt+Y double-fires (two mounted GridCanvas instances, `App.tsx:1370` and `:1548`) |
| View (`Ctrl+wheel`, `Shift+wheel`, `Alt+drag`, `F11`) | present |

### 6.16 Native bridge contract

| Command | Handler | Sent by UI? |
| :--- | :--- | :--- |
| `render-audio` (request/response, not a post) | `JuceBridge.cpp:437` | yes — offline WAV bounce; the payload now includes a `metronome` config |
| `noteOn` / `noteOff` / `allNotesOff` | `JuceBridge.cpp:567-579` | yes |
| `play` / `stop` / `setBpm` | `:581-591` | yes |
| `createTrack` / `clearAllTracks` | `:593-606` | yes |
| `removeTrack` | `:599` | **no** — nothing in `src/` posts it |
| `setTrackParam` (volume/pan/muted/soloed/instrument/synthPreset/oscType) | `:608-637` | yes |
| `setTrackSynthParam` (ADSR) | `:639+` | yes |
| vocal preset / lyric pitch / consonant | **does not exist** — no command carries VoicePreset fields (V9) | — |
| native→JS events | **does not exist** — only `window.ipcRenderer.invoke` request/response (`:167-178`); no push channel, so no meters or CPU readout from JUCE | — |

---

## 7. DEFECT REGISTER (ranked)

**S1** = wrong output or lost work · **S2** = feature is inert in the shipped build · **S3** = visibly wrong ·
**S4** = performance / ergonomics. "✓" = reproduced live in the dev build, not just read.
"✔ fixed" = corrected and re-verified on 2026-10-25 · "✔ partial" = the named half was corrected, the rest is
still open · "✔ not a bug" = the entry was wrong on re-reading the code (kept for the record).

### S1 — wrong output, lost work, or unusable

| ID | Finding | Evidence |
| :--- | :--- | :--- |
| **V9** | **Native vocal tracks are plain synth tracks.** `buildNativeNoteOnCommand` never forwards `instrumentOverride`, and "vocal" is not an instrument — it is `synthPreset: 'vocal'`, which `SynthVoice::setPreset` does not know, so it falls through to the default triangle. The whole Vocal Designer is inert in the packaged app; preview, playback and export are three different sounds. | `AudioEngine.ts:4794, 4810`; `Scheduler.ts:192`; `store.ts:675`; `nativeNoteCommand.ts:49`; `SynthVoice.cpp:52-120`; `JuceBridge.cpp` has no vocal command; `AudioEngine.cpp:615` unreachable. |
| **V1** ✓ ✔ fixed | **Daisy Bell preview freezes the UI 4–7 s and starts the opening 4–8 syllables simultaneously.** The phrase audibly begins as a chord. **Now:** chunked scheduling, clock re-read per syllable, no past starts; worst block 166–595 ms, onsets 0.55 s / 0.46 s apart. | measured before: 4,194 ms / 6,993 ms / 859 ms; `AudioEngine.ts:5634-5672`; see §5B V1. |
| **A1** ✔ fixed | **`removeTrack` is never sent to JUCE.** Deleting a track leaves its voice, FX and VST3 instance alive in the native engine. If the deleted track was soloed, the surviving tracks are silenced for the rest of the session (the native copy keeps `soloed = 1`, so `hasSolo` never clears and nothing in the UI can reach it). | handler exists `JuceBridge.cpp:599`; no caller in `src/`; isolation scan `AudioEngine.cpp:758-768`; delete handler `LeftPane.tsx:11388`. |
| **A2** ✔ fixed | **The stretch tool writes fractional ticks.** Output is non-integer `<duration>` in MusicXML and non-integer chord keys in the score. MuseScore rejects it. | `GridCanvas.tsx:2940-2966`, `scoreExport.ts:217`, `ScoreEditor.tsx:424`. |
| **A3** | **MusicXML measure overflow drops note tails with no tie.** Long notes are silently truncated at the barline. | `scoreExport.ts:192`. |
| **A4** | **6/8 is internally inconsistent: the screen uses `beats×192`, export uses 96 per eighth.** Bars and durations disagree between view and file. | `ScoreEditor.tsx:136`, `ScorePreviewModal.tsx:80` vs `scoreExport.ts:19-22`. |
| **A5** ✔ fixed | **Erase, right-click delete, and every score-editor edit bypass `commitHistory()`.** Undo silently skips them. | `GridCanvas.tsx:2567, 2615`; `ScoreEditor.tsx:264, 270, 632, 1060`. |
| **A6** ✔ not a bug | ~~`'sawtooth'` maps to oscillator 4 = Noise.~~ **Verified:** the branch matches `"saw" \|\| "sawtooth"` and assigns oscillator 3 (saw). The register entry misread the line. | `JuceBridge.cpp:631`. |
| **A7** ✔ fixed | **The "808" kit never loads.** `setKitByName` uses `contains("808")` but the id is `eightOhEight`. | `DrumEngine.cpp:41-49`. |
| **A8** | **Two GridCanvas instances are mounted at once** (synth and drum), so every canvas shortcut fires twice. Confirmed with a +24-semitone Alt+Y (self-inverse made it look like a no-op). | `App.tsx:1370`, `:1548`; listener at `GridCanvas.tsx:781`. |
| **A9** | **Print / PDF is a silent no-op in WebView2** (`window.open` + `document.write`), with no toast, while PNG/MIDI use the `save-file` IPC channel. | `ScorePreviewModal.tsx:96-98`. |
| **A10** ✔ fixed | **PNG export can hang forever** — `renderSvgToCanvas` has `onload` but no `onerror`. | `ScorePreviewModal.tsx:197-224`. |
| **A11** | **Score editor ignores read-only mode entirely** — no `readOnlyMode` check anywhere in its edit handlers, unlike both grids. | `ScoreEditor.tsx:88-288`. |
| **A12** | **FX order, duplicates and bypass are front-end fiction.** Native FX are one processor per type in a fixed sequence, so reordering does nothing, duplicates share one processor, and bypassing one duplicate silences every instance of that type. | `AudioEngine.cpp:386-457, 843-852`; `AudioEngine.ts:3254-3281`. |
| **A13** | **Master Volume does nothing in the packaged app.** It only sets `Tone.Destination.volume`; the native master has no gain stage, so there is nothing between the track sum and the limiter. | `AudioEngine.ts:2859`; `AudioEngine.h:205` (never read); no bridge command. |
| **A14** | **Master Limiter toggle and threshold are inert natively** — the limiter always runs at −0.3 dB / 50 ms. There is also no master meter anywhere in the app. | `LeftPane.tsx:4406-4437`; `AudioEngine.cpp:924-927`; `LimiterEffect.h:22-23`. |
| **T1** ✔ fixed | **Every generated/AI track is created at `volume: 100` instead of 0–1** → Tone applies +40 dB, native clamps to 2.0, and the fader can never show or restore the true value. AI chorale alone adds three such tracks at once. | `LeftPane.tsx:2319, 2383, 3087, 3120`; `AudioEngine.ts:3387`; `AudioEngine.cpp:198-205`. |
| **V2** ✔ fixed | **The shipped waveguide presets flatten every vowel** — /i/ constriction 0.70 → 2.90, /u/ 0.45 → 2.90, /a/ mid-tract pinched 3.8 → 2.90, lip area 8.5 → 1.62. | `AudioEngine.ts:2037-2048`; arithmetic in §5B. |
| **V4** | **No coda consonants.** "half" is sung "ha", "all" is a bare vowel, "I'm" loses its /m/. | `parseSyllable` return at `:2618`. |

### S2 — feature is inert in the shipped build (Tone-only or unreachable)

| ID | Finding | Evidence |
| :--- | :--- | :--- |
| **B1** | 60 of 67 Vocal Designer controls (all three synthesis modes, anatomy, consonants, envelopes, FOF formants) affect only the JS preview. | §6.5; no bridge command. |
| **B2** | Synth mod envelope (5 sliders) has no native counterpart. | `LeftPane.tsx:6265-6272`; no command in `JuceBridge.cpp`. |
| **B3** | Drum attack/sustain/release and drum filter/detune/glide are Tone-only; only decay is sent. | `LeftPane.tsx:10625-10660`; `nativeNoteCommand.ts:95`. |
| **B4** | Drum velocity lane, automation lane and the place-playhead menu call into Tone. | `DrumSequencer.tsx:294`; `GridCanvas.tsx:1894-2073`. |
| **B5** | "Play full note on pause" is Tone-only. | `RightPane.tsx:953`. |
| **B6** | Drag-paint in the drum sequencer does not exist (click only). | `DrumSequencer.tsx:221`. |
| **B7** | Beams, key signatures and print layout in the score are unimplemented. | `ScoreEditor.tsx:674-691, 28-41`. |
| **B8** | Custom JS FX cards are silent natively (`applyTrackSettings` has no branch for custom ids). | `AudioEngine.ts:3320-3325`. |
| **B9** | Procedural f(x) modulators require a Tone rack; the native branch returns before racks exist. | `AudioEngine.ts:2917, 3327`; `LeftPane.tsx:361-381`. |
| **B10** | VST3 always processes after all built-in FX — a mid-chain insert is ignored. | `AudioEngine.cpp:854-912`. |
| **B11** | The FX Tail Buffer setting never reaches the native bounce. | `LeftPane.tsx:501`. |
| **T2** | **Subtrack bus exists only in Tone.** A child's rack is routed into the parent's rack input (`AudioEngine.ts:3737-3741`); natively `createTrack` carries no `parentId`, so children sum flat to the master and the parent's fader, pan and FX do nothing to them. | `AudioEngine.ts:3125-3129`; `LeftPane.tsx:2235`. |
| **T3** | **Groups are a sidebar list, not a mixer.** `TrackGroup` has no gain/mute/solo and no bridge command; membership has no effect on playback, export, or even the track list order. Group name cannot be edited. | `store.ts:857-863`; UI `LeftPane.tsx:9291-9317`; no group command in `JuceBridge.cpp`. |
| **T4** | **Hide Track is visual only** — dims the row and hides cross-grid ghosts, but the scheduler and exporter never read `track.hidden`. | `LeftPane.tsx:11304`; `GridCanvas.tsx:1111`; no read in `Scheduler.ts`. |
| **T9** | **"Custom Hit" proportional drum rows play a single arbitrary pad natively.** The A/B mix lives only in the JS drum path; the synthetic pitch arrives at `DrumEngine::triggerHit`, whose out-of-range fallback is `pad % 16`. | `LeftPane.tsx:609-627`; `AudioEngine.ts:4473-4481, 5286-5291`; `DrumEngine.cpp:82-84`. |

### S3 — visibly wrong

| ID | Finding | Evidence |
| :--- | :--- | :--- |
| **C1** | **Three different playhead mappings** → two red lines on any `targetTempo` track, and drift after resizing a column. | `GridCanvas.tsx:1679` vs `:1065` vs `:2039` vs `:522-528`. |
| **C2** | **Duration glyphs are two levels too long** — a quarter note renders as a whole note. | `ScoreEditor.tsx:605-608`. |
| **C3** ✔ fixed | Missing `beginPath()` on row lines and major columns (stale path re-stroked). **Now:** row lines open their own path; the major-column half was already correct. | `GridCanvas.tsx:1347`, `:1211`. |
| **C4** ✔ fixed | `globalAlpha` leaks between rows in both label panels. | `GridCanvas.tsx:1794→1758`, `:1867→1826`. |
| **C5** ✔ fixed | Velocity thumbs, automation points and loop-handle drags use raw ticks while the grid uses `tickToX` → everything misaligns once a column is resized. | `GridCanvas.tsx:1954, 3424, 2971, 2977`. |
| **C6** ✔ fixed | Drum step toggling rounds where the playhead floors → cell and flash disagree by one step. | `DrumSequencer.tsx:69, 73, 76`. |
| **C7** ✔ fixed | Triplet labels in the drum grid are wrong (64 → "1/12T", 32 → "1/24T"). | `DrumSequencer.tsx:115-117`. |
| **C8** | The drum grid and piano roll share one `snapResolution` → editing drums changes piano-roll snap. | `DrumSequencer.tsx:131-137`; `GridCanvas.tsx:367`. |
| **C9** | The score playhead anchors to the pane, not the system row, and disappears past the last system. | `ScoreEditor.tsx:897-921, 402`. |
| **C10** | The score's tick↔x hit mapping is up to 20 % off (CSS px vs 840-unit viewBox), and the last 12 ticks of every system are unplaceable. | `ScoreEditor.tsx:172-189, 221-233`. |
| **C11** | Micro pitches export at the wrong staff position (a 53-EDO ±0.23 is emitted as a sharp; 71.9 → `B♯4`). | `scoreExport.ts:86-124`. |
| **C12** | `edo \|\| 53` fallback mislabels ordinary 12-TET fractional notes as 53-EDO. | `GridCanvas.tsx:1470`. |
| **C13** ✔ not a bug | ~~customSynthRow labels are double-scaled.~~ **Verified:** the label panel is drawn in screen space after `ctx.restore()`, so `zoom` must be applied there. The scaling is correct. | `GridCanvas.tsx:1804-1810`. |
| **C14** ✔ fixed | The music XML filename regex is `/\\s+/g`, so spaces survive. | `ScorePreviewModal.tsx:246`. |
| **C15** ✔ fixed | **Reverb wet/dry sums above unity** (`dryLevel = 1 − wet*0.5`) → up to +3.5 dB at wet = 1, pumping the limiter. | `ReverbEffect.h:66`. |
| **C16** | **The "Drive" slider is actually a wet/mix control**; "Grit" is the real drive. Every preset labelled by Drive is mislabelled. | `LeftPane.tsx:9454-9455`; `AudioEngine.cpp:400-401`. |
| **C17** | R-Decay is sent as `roomSize = decay/10` and F-Damp as `Hz/10000`, so neither is in the unit the UI shows. | `AudioEngine.ts:3299-3301, 433`. |
| **C18** | DPreverb is a plain reverb natively; Tail and Shape both collapse into roomSize, so tail ≥ 10 s is identical. | `AudioEngine.cpp:416-421`. |
| **C19** | Three FX controls are posted nowhere: P-Oct, R-PreDelay, DPreverb Shape. | `AudioEngine.ts:3294-3315`. |
| **V3** ✔ fixed | Nasals are impossible in the three shipped waveguide presets (`velumOpening: 0` makes `isNasal` dead code). | `AudioEngine.ts:2019`; `store.ts:279, 335, 395`. |
| **V5** ✔ partial | `c`/`j` produce no consonant at all; `"cr"` → /r/ ("cra-zy" → "ra-zy"); `"sw"` loses /w/. **Now:** `c`/`j` get a band-passed burst and are tested before the `l \|\| r` branch; clusters and the `isVoiced`/`isUnvoiced` disagreement remain. | `AudioEngine.ts:1617-1722`. |
| **V6** | Two consonant systems run concurrently (raw burst + tract turbulence) on different clocks. | `:1609-1739` vs `:2057-2064, 2237-2248`. |
| **V7** ✔ partial | FOF adds unfiltered white noise (~−17 dB hiss) and its packet ring caps the model at ≈457 Hz. **Now:** noise is low-passed; the ring is sized from `f0 × packetLife` (clamped 16–64). FOF still has no consonant model of its own. | `:1946`, `:1878`, `:1927`. |
| **V8** ✔ fixed | Setting any FOF formant frequency disables the diphthong glide. | `:1863-1866`. |
| **T5** ✔ fixed | **The per-track OFF button kills every track.** The payload carries `trackId`, the bridge drops it, and the toast claims only the named track was stopped. | `LeftPane.tsx:9700-9734`; `AudioEngine.ts:4317-4320`; `JuceBridge.cpp:577-580`. |
| **T6** ✔ partial | **Vol fader tops out at 1.0 while the engine accepts 2.0**, so any track seeded with `volume: 100` (T1) displays at maximum and snaps back to 1.0 on the first touch — a 6 dB jump the user did not ask for. **Now:** the T1 seeding fix removes the trigger (new tracks start at 1.0). The 1.0 vs 2.0 ceiling mismatch itself is unchanged. | `LeftPane.tsx:9739`; `AudioEngine.cpp:198-205`. |

### S4 — ergonomics, performance, missing expected input

| ID | Finding | Evidence |
| :--- | :--- | :--- |
| **K1** | No Spacebar play/pause; the PLAY tooltip claims it. | `App.tsx:221-236`, `:526`. |
| **K2** | No D/E/S/M/X/J/T tool shortcuts; the tooltips advertise (D)(E)(S)(X). | `LeftPane.tsx:4515-4526`. |
| **K3** | No Ctrl+S / Ctrl+O / Ctrl+R. | §4. |
| **K4** | Any focused `<button>` disables the whole canvas shortcut layer. | `GridCanvas.tsx:601-610`. |
| **K5** ✔ fixed | Ctrl+C/Ctrl+V fall through without `preventDefault()`/`return`. | `GridCanvas.tsx:618-640`. |
| **K6** ✔ fixed | Empty Delete still writes an undo entry. | `GridCanvas.tsx:642-647`. |
| **K7** ✔ fixed | `q` has no modifier guard (Ctrl+Q/Alt+Q also quantize). | `GridCanvas.tsx:649`. |
| **D1** | Three always-on rAF loops redraw every canvas at 60 fps while stopped; row loops are not culled (53-EDO ≈ 370 rows × stroke + text per frame). | `GridCanvas.tsx:862, 1099, 1894, 1217-1257`. |
| **D2** | Automation curve samples ticks, not pixels (~19k `lineTo`/frame). | `GridCanvas.tsx:2014`. |
| **D3** | `selectedNoteIds.includes()` inside render and pointermove → O(notes × selection). | `:1614, 2589, 2648`. |
| **D4** | Per-note `shadowBlur` in the render loop is the most expensive 2D op available. | `:1509, 1990-1992`. |
| **D5** | `Math.max(...allNotes)` in three files → RangeError risk on large projects. | `ScoreEditor.tsx:143`, `ScorePreviewModal.tsx:83`, `scoreExport.ts:25`. |
| **D6** | Delay time is unsmoothed (recomputed per block) → clicks and zipper noise while dragging D-Time. | `DelayEffect.h:58-59`. |
| **D7** | Every track change reposts ~30 JSON commands including the whole FX chain and sampler payload — once per store update and per slider tick. | `AudioEngine.ts:3123-3326`. |
| **D8** | Every track allocates three stereo reverbs plus seven other FX even at wet 0, and processes all of them every block. | `AudioEngine.h:55-64`; `AudioEngine.cpp:843-852`. |
| **D9** | Any FX order or bypass change disconnects and rebuilds every node in the Tone rack. | `AudioEngine.ts:3360-3384`. |
| **D10** | `setTrackFxParam` takes the global `trackMutex` per parameter while the audio callback holds it for a whole block. | `AudioEngine.cpp:388, 745`. |
| **U1** | Only draw/erase get a cursor; select/slice/stretch are indistinguishable. | `GridCanvas.tsx:2778, 3033`. |
| **U2** | Slice/erase misses are silent. | `:2615, 2620`. |
| **U3** | No read-only indication in the canvas or the score editor. | `GridCanvas.tsx:1430`; `ScoreEditor.tsx:88-288`. |
| **U4** | The velocity lane's hit priority makes automation points unreachable. | `GridCanvas.tsx:3428-3446`. |
| **U5** | Autosave omits every view setting. | `store.ts:2877-2949`. |
| **U6** | The Vocal Designer dropdown does not choose the voice any note uses (that is the Note Inspector), and resets on remount. | `LeftPane.tsx:1211, 7339`; `RightPane.tsx:1363`. |
| **T7** | **Delete Track is not undoable** and leaves orphan `clips` plus dangling `groups[].trackIds`; Merge into… has the same gap. | `LeftPane.tsx:11388`; `store.ts:1679-1692`; `LeftPane.tsx:11433-11460`. |
| **T8** | **Pattern Clips are never drawn on the grid and never played** — they are a bake scratchpad in a sidebar section, although "Pattern Clips (Generative)" reads like a timeline feature. | `LeftPane.tsx:8481-8560`; no `clips` read in `GridCanvas.tsx` or `Scheduler.ts`. |

### Still-open verification

1. Dual-grid rAF cost: open both grids, count `requestAnimationFrame` callbacks per frame with a wrapper; expect ~3×.
2. Playhead divergence (C1): set `bpm 140` + `targetTempo 120`, play, read pixel columns at y≈5 and y≈200.
3. Fractional-tick export (A2): stretch a note, then open the MusicXML in MuseScore 4.
4. WebView2 print path (A9): click Print/PDF in `bin/MuseGrid.exe`, check `debug.log` for a blocked popup.
5. PNG hang (A10): trigger PNG export with an unresolvable SVG filter reference; confirm no toast after 30 s.
6. FOF >A4 click (V7): play a vocal note at C5 with Celestial Choir and listen for ring-buffer resets.
7. Vocal routing (V9): in `bin/MuseGrid.exe`, set a track to Vocal, play a note, and confirm it sounds
   like the default triangle rather than a voice — the code path says the `vocal` instrument never arrives.
8. Solo-delete (A1/#13): solo track B, delete B, then play track A — expect silence until restart.
9. Custom Hit (T9): add a proportional drum row, place a note, export or play natively — expect one
   unrelated pad, not the A/B blend.

---

## 8. DEAD / UNREACHABLE FEATURES

"Dead" here means one of: no handler at all, a handler with no observable effect in either engine, a
command that exists but is never sent, or state that is written/saved but read nowhere.

### 8.1 Whole files and stylesheets

| Item | Evidence |
| :--- | :--- |
| `src/App.css` — 184 lines of Vite/Electron boilerplate | imported by nothing; none of its classes appear in any TSX (H1). |
| `.btn-primary`, `.btn-icon` in `index.css:142-233` | used by exactly zero components; every button is inline-styled (H2). |
| `electron/`, `dist-electron/`, `test-wasm.cjs`, `assembly/`, `public/audio-dsp.wasm` | previous-generation debris, unignored (H5). |

### 8.2 Bridge commands and native paths

| Item | Evidence |
| :--- | :--- |
| `removeTrack` command | implemented `JuceBridge.cpp:599`, **never posted** from `src/`. Deleting a track therefore leaves a live track in JUCE — including its solo flag, which silences the project (A1). |
| `allNotesOff` track filter | the JS payload carries `trackId` (`AudioEngine.ts:4317-4320`) but `JuceBridge.cpp:577-580` calls `allNotesOff()` with no argument, so the field is ignored and every track is cut (T5). |
| Any group / bus command | does not exist. Groups are a sidebar list with no audio meaning (T3). |
| Any parent/subtrack bus command | does not exist; the Tone rack nests child into parent (`AudioEngine.ts:3737-3741`), the native engine has no parent. |
| Any vocal-preset command | does not exist; 60 UI controls have no destination (V9). |
| Native→JS event channel | does not exist; only `invoke` request/response (`JuceBridge.cpp:167-178`). No native meters, CPU, or transport position is ever pushed to the UI. |
| Synth mod-envelope parameters | no native field in `AudioEngine.cpp`; the sliders write project state only. |
| Master volume, limiter enable/threshold, master meter | no native counterpart at all (A13, A14). |
| FX chain order, duplicate FX, per-card bypass | no native representation — one processor per type in a fixed order (A12). |
| Custom JS FX and procedural f(x) modulators | no native command; silent in the packaged build (B8, B9). |
| Drum attack/sustain/release, drum filter/detune/glide | no native field; only `drumDecay` crosses the bridge. |
| Proportional drum rows (`customDrumRows.proportion`) | no native field and no synthetic-pitch resolution — the value is reduced modulo 16 into an arbitrary pad (T9). |

### 8.3 Code paths inside the renderers

| Item | Evidence |
| :--- | :--- |
| Snap-subdivision drawing | `snapResolution` is read for input but never rendered (`GridCanvas.tsx:366-367, 1171-1212`). |
| `isNasal` in the waveguide | unreachable while any preset pins `velumOpening`; all three waveguide presets do (`AudioEngine.ts:2019`). |
| `pulse.amp` in the FOF loop | assigned at `:1911`, never read — the packet amplitude is hard-coded via `baseAmp`. |
| FOF consonant model | no `cAreas`/`isStop` branch exists; only the generic burst chain runs (`:1839-1989`). |
| Drum drag-paint | no pointer handlers (`DrumSequencer.tsx:221`). |
| Score beams / key signature | unimplemented (`ScoreEditor.tsx:674-691`). |
| Preview time signature | hard-coded "4/4" (`ScorePreviewModal.tsx:525-526`). |
| Print / PDF in WebView2 | returns silently (`ScorePreviewModal.tsx:96-98`). |
| Move / Join / Mute tools | listed in `features.md:389-394` and in the tooltips; no such tool exists in the store union (`store.ts:934`). |
| P-Oct, R-PreDelay, DPreverb Shape | controls exist and persist, but nothing posts them and the native effects have no matching parameter (`AudioEngine.ts:3294-3315`). |
| Master meter | no mixer/master meter at all; the help text's "real-time peak meter" is the mic analyser inside `ImportAudioModal.tsx:452-487`. |
| Pattern Clips | `clips[]` is rendered only as a sidebar list (`LeftPane.tsx:8483`); neither `GridCanvas.tsx` nor `Scheduler.ts` reads it. A clip is a bake bookmark, never a timeline object (T8). |
| Hide Track | `track.hidden` is read only by the ghost-note pass (`GridCanvas.tsx:1111`) and the row style (`LeftPane.tsx:9650`); playback and export ignore it (T4). |
| Group `collapsed` | hides the member list inside the Groups section only; it does not collapse the tracks anywhere else (`LeftPane.tsx:9297-9302`). |

### 8.4 State that is written but never used

| Item | Evidence |
| :--- | :--- |
| `Track` struct: **19 of 121 fields are referenced nowhere**, 23 more are UI-only | `store.ts` field census. They are still serialised into every project and autosave blob. |
| `Note.voicePresetId` | saved, exported and shown in the inspector (`RightPane.tsx:1363`), read only by the JS path (`AudioEngine.ts:4965`) — **zero effect in the native build**. |
| `voicePresets` library | persisted to `localStorage` (`store.ts:2838`) and into projects; read only by the JS path and the preview. |
| `Track.voicePresetId` | declared at `store.ts:35`, never written by any UI — the Note Inspector writes the per-note field instead. |
| Vocal Designer `selectedVoicePresetId` | local pane state (`LeftPane.tsx:1211`), never persisted, resets on remount. |
| View settings (zoom, scroll, follow mode, split ratio, selected pane) | written to component state, omitted from autosave and the project serializer (`store.ts:2877-2949`, `App.tsx:63-82`). |

### 8.5 Deliberate non-features (do not "fix" these)

| Item | Why it is not a bug |
| :--- | :--- |
| EDO pitch offsets in 12-TET semitone units (±12 = an octave in any EDO) | Verified correct; the grid converts with `12 / edo` for transposition. |
| JS envelope `tension ∈ [-1,1]` vs native `setExponential(k ≈ -3…-6)` | Different units by design (§3). Only a defect where one UI element implies they are the same. |
| Three DSP stacks (Electron/Tone → WASM → JUCE) | Historical; JUCE is authoritative. `engineMode === 'wasm'` is retained but not shipped. |

---

## 9. WHERE `features.md` IS WRONG

`features.md` documents the product as an "industrial-grade neural composition workstation". Its theme
description (§1.1) is accurate and matches §2 above. Its shortcut table is not.

| `features.md` claim | Reality |
| :--- | :--- |
| §14 table, rows `Spacebar`, `Ctrl+S`, `Ctrl+O`, `Ctrl+R`, `D`, `E`, `S`, `M`, `X`, `J`, `T` | **Not implemented.** No listener exists for them (K1-K3). |
| §14 "Up/Down Arrow: pan vertical view", "Left/Right: pan horizontal" | Arrows are only used transposed-with-modifier (`Shift`, `Ctrl`). Unmodified panning not found in `GridCanvas.tsx:600-790`. |
| §14 "Ctrl+Scroll: horizontal zoom", "Shift+Scroll: fast navigation", "Alt+Click: bypass snapping" | Present in the canvas wheel/pointer handlers — accurate. |
| §2.2 autosave & crash recovery | Verify against §6 settings rows before trusting. |
| §7 "Neural Composition Engine" | Real code path is `src/utils/aiLab.ts` (484 lines) + `proceduralSuggestions.ts`; see §6 for its actual wiring. |

**Action:** treat §14 of `features.md` as a wish list. Either implement the shortcuts (recommended:
Space, Ctrl+S, Ctrl+O, Ctrl+Z family already, and tool keys scoped so K4/K7 don't repeat) or delete the rows.

---

## 10. HOW TO REBUILD AND TEST WHAT YOU CHANGE

```bash
# web dev server (plain `vite` is wrong: vite-plugin-electron spawns Electron and dies)
npx vite --mode web --port 5199 --strictPort      # vite.config.ts:9 isWeb, :14 gates electron()
# typecheck + lint
npx tsc -b && npx eslint .                         # eslint's --format compact no longer ships
# native build (MSVC 18 BuildTools)
cmd //c 'call "C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Auxiliary/Build/vcvarsall.bat" x64 && ninja -C native/build'
# deploy
cp native/build/MuseGrid_artefacts/Release/MuseGrid.exe bin/ && cp -r dist bin/dist
# run & read the log
bin/MuseGrid.exe                                   # log: D:\MyApps\MuseGrid Native\debug.log
```

Scripted UI testing: the Zustand store is exposed as `window.Muse` — `window.Muse.getState()` for
assertions, and canvas pixel checksums via
`document.querySelector('canvas').getContext('2d').getImageData(...)` to prove a graph actually drew.

**There is no `Muse.setState()`.** To stage a scenario, call the store actions instead
(`getState().addNote(...)`, `setSelectedNoteIds(...)`, `togglePlay()`, …), or use the namespaces that do
exist: `Muse.Tone`, `Muse.audioEngine`, `Muse.transport`, `Muse.notes`, `Muse.track`, `Muse.voice`,
`Muse.fx`, `Muse.exportAudio`. Note that any notes you add this way only exist in memory — reloading the
dev page discards them (autosave may still have written them, so check `localStorage` before blaming the
app).

Timing measurement recipe (used for V1): read `Tone.getContext().rawContext.currentTime` immediately
before and after a call, and `performance.now()` around it. A control that blocks longer than the audio
clock advance is scheduling notes in the past; WebAudio will clamp their start times to "now".
A background instance is already running on port 5199 (log `./_audit_dev.log`).

---

## 11. FIXES APPLIED — 2026-10-25

Every entry below was re-verified against the current source before editing. No file was removed and no
feature was deleted; the changes are additive or in-place corrections.

### S1

| ID | What changed | File(s) |
| :--- | :--- | :--- |
| **V1** | Daisy Bell preview schedules in ≤90 ms chunks, re-reads the clock per syllable, clamps every start to `now + 0.02`, and aborts on a new generation. Worst block 4,194–6,993 ms → 166–595 ms; no stacked onsets (24 start calls, 1 marginal past start). | `AudioEngine.ts:2710, 5634-5672` |
| **A1** | Track deletion now posts `removeTrack` to JUCE (subscription mirrors `removeTrack`/`removeTracks`). Fixes the stuck-solo case. | `AudioEngine.ts`, `store.ts` |
| **A2** | Stretch writes integer ticks, so MusicXML durations and score chord keys stay integral. | `GridCanvas.tsx`, `ScoreEditor.tsx` |
| **A5** | Erase, right-click delete and the four score-editor edit paths now call `commitHistory()` before mutating. | `GridCanvas.tsx:2584-2645`, `ScoreEditor.tsx` |
| **A7** | 808 kit resolves by name (`"808"` **or** `"eightoh"`), matching the `eightOhEight` id. | `DrumEngine.cpp:45` |
| **A10** | `img.onerror` closes the PNG-export promise and revokes the object URL, so a failed SVG render no longer hangs. | `ScorePreviewModal.tsx:217` |
| **T1** | All four generated/AI track creation sites seed `volume: 1.0` instead of `100`. | `LeftPane.tsx` |
| **V2** | Tongue/lip anatomy applies only after the user moves one of those knobs (`tongueShaping` flag). Shipped presets keep their vowel-specific tracts; diphthong targets are no longer overwritten. | `store.ts:224`, `LeftPane.tsx:7346`, `AudioEngine.ts:2064` |
| **V3** | Velum opens to ≥0.40 for a nasal consonant regardless of preset; presets can still request more. | `AudioEngine.ts` |

### S3

| ID | What changed | File(s) |
| :--- | :--- | :--- |
| **C3** | Row lines open a fresh path before stroking. (The major-column half was already correct — no change.) | `GridCanvas.tsx:1347` |
| **C4** | `globalAlpha` reset to 1.0 before both label-panel branches. | `GridCanvas.tsx` |
| **C5** | Velocity thumbs, automation points, the automation playhead, loop handles and export-region drags all convert through `tickToX`/`xToTick`; automation sampling is tick-consistent. | `GridCanvas.tsx` |
| **C6** | Drum cell lookup floors the step (same rule as the playhead flash). | `DrumSequencer.tsx:73-76` |
| **C7** | Triplet labels corrected to 1/8T (64) and 1/16T (32). | `DrumSequencer.tsx:115-118` |
| **C14** | Filename regex is `/\s+/g` (a single backslash), so spaces become underscores. | `ScorePreviewModal.tsx:246` |
| **C15** | Reverb dry gain is `1 − wet`, so wet+dry = unity instead of +3.5 dB. | `ReverbEffect.h:66` |
| **V3/V5/V7/V8** | See §5B for the vocal fixes; V5 and V7 are partial. | `AudioEngine.ts` |

### S4

| ID | What changed | File(s) |
| :--- | :--- | :--- |
| **K5** | Ctrl+C/Ctrl+V `preventDefault()` and return; paste is blocked in read-only mode. | `GridCanvas.tsx:618-640` |
| **K6** | Delete with an empty selection returns before `commitHistory()`. | `GridCanvas.tsx:642-647` |
| **K7** | Quantize requires no Ctrl/Meta/Alt. | `GridCanvas.tsx:649` |
| **T5** | `allNotesOff` honours the `trackId` in the payload; the toast is now truthful. | `JuceBridge.cpp`, `DrumEngine`, `VoiceManager` |

### Corrections to this document

- **A6** was wrong: `JuceBridge.cpp:631` already maps `"sawtooth"` to oscillator 3 (saw). No fix needed.
- **C13** was wrong: the label panel is drawn in screen space, so the zoom multiplication is correct.
- **C3** was half wrong: the major-column path already had `beginPath()`.

### Still open (deliberately not touched)

- **V9 / B1** — native vocal: JUCE has no syllable-aware vocal voice wired to the bridge, so the Vocal
  Designer still affects only the preview. This is a feature, not a one-line fix.
- **V4** — coda consonants are absent from `parseSyllable` (structural parser change).
- **V6** — the two consonant systems still run concurrently.
- **A3, A4, A8, A9, A11–A14, C1, C2, C8–C12, C16–C19, T2, T3, T4, T6–T9, K1–K4, D1–D10, U1–U6** — not
  started this round; they need design decisions or larger refactors.
- **Track deletion is still not undoable** — `commitHistory` snapshots `notes` only. A1 and T7 fixed the
  *engine* leak and the orphaned `clips`/`groups` entries, not the history model.
- **`bin/dist` was rebuilt and deployed with §12** (see below). At the time of the round above it was
  still stale; the front-end bundle, `bin/dist` and `bin/MuseGrid.exe` are now current.

---

## 12. FIXES APPLIED — 2026-10-25 (native metronome export)

The export metronome used to be a Tone.js-only feature: `buildNativeBouncePayload` returned `null`
whenever **Include Metronome** was on, which moved the whole WAV bounce to the browser renderer and
dropped VST3 instruments. The click is now synthesized inside the JUCE bounce, so metronome + VST3
export together.

### What changed

| Area | Change | File(s) |
| :--- | :--- | :--- |
| Payload | `NativeMetronomeConfig` added to the bounce payload (bpm, start tick, beats per measure, Click volume, gain dB, pitch decay, octaves, ADSR, down/up pitch and velocity). The `includeMetronome` bail-out was removed; multi-region and Procedural FX still stay on Tone. | `src/utils/nativeBounce.ts` |
| Bridge | `handleRenderAudio` parses `metronome` into `RenderJob::MetronomeConfig`; a metronome-only bounce (no note events) is now valid. | `native/Source/Bridge/JuceBridge.cpp:437` |
| Renderer | `MetronomePlayer` + `ClickVoice` synthesize a MembraneSynth-style click: exponential pitch drop, ADSR, dB gain, downbeat accent, one click per quarter note, `32n` gate. Clicks land on the project beat grid (a range starting mid-measure keeps the real accents). | `native/Source/Audio/OfflineRenderer.cpp` |
| Master chain | The renderer mixes the click into the master bus **before** the limiter: `AudioEngine` can defer its limiter for the bounce and apply it once the click is in the block. | `native/Source/Audio/AudioEngine.h/.cpp` |
| Tone fallback | The browser renderer now aligns clicks to the project beat grid too, instead of restarting the count at the export start. | `src/utils/audioRender.ts:610` |
| Help pane | Export section states that the click uses the Click panel settings and no longer switches the WAV render to the browser engine. | `src/ui/HelpPane.tsx` |

### Verification

- `native/build/TestOfflineRender.exe`: 23/23 checks. New checks prove metronome-only bounce succeeds
  with no note events, downbeat is louder than upbeat at the configured velocities, the click decays
  between beats, and a range starting at tick 192 keeps the project accent grid.
- `npx tsc -b` clean; `npx eslint` on the touched TS files reports no errors.
- `npx vite build` succeeded; the JUCE app was rebuilt, and both `bin/MuseGrid.exe` and `bin/dist`
  were deployed.
- Payload checked live in the dev build: `buildNativeBouncePayload` with **Include Metronome** returns
  a payload carrying the Click panel values (bpm 120, 4/4, volume 0.7, −6 dB, C6/C5, vel 1.0/0.65).

### Limits that remain

- **MP3, multi-region exports and Procedural FX** still render in the browser engine — the metronome
  works there, but VST3 does not.
- The native click is an approximation of Tone's `MembraneSynth` envelope, not sample-identical to the
  dev-build click.

---

## 13. FIXES APPLIED — 2026-10-25 (Daisy Bell intelligibility)

| ID | What changed | File(s) |
| :--- | :--- | :--- |
| **V4** | `parseSyllable` returns a word-final consonant. Explicit lexicon codas plus a rule-based coda fallback (silent final `e` stripped only when a vowel remains; bare final h/w rejected). A coda burst fires at `duration − codaLen` and the vowel ducks into it. | `AudioEngine.ts:2430, 2354, 2308` |
| **V11** | The vowel gate ends on the note boundary instead of 35 ms after it, so the next syllable's onset is audible; coda length drives the duck. Lexicon corrected: `cra` /eɪ/, `swer` onset /s/ + final /r/, `your` /jɔr/ (no /u/ glide), `of` /ʌv/. | `AudioEngine.ts:1668-1678, 2568-2586` |
| **V5 (part)** | Waveguide stop detection excludes `th` (`^(p|t|k|b|d|g)(?!h)`, after stripping a leading `s`), so "the" no longer gets a plosive pop. | `AudioEngine.ts:2091` |

### Verification

- `npx tsc --noEmit` clean; `npx eslint src/engine/AudioEngine.ts` 0 errors (244 pre-existing warnings).
- `npx vite build` succeeded; `dist` copied to `bin/dist`. The bundle contains `consonantBurstSpec`.
- Dev build (:5199): PREVIEW VOICE — DAISY BELL runs 3.5 s with **no console errors** and a running
  AudioContext.
- Offline render of the real `VocalModelVoice` ("give", "you"; waveguide/FOF/formant): all non-silent,
  peak 0.02–0.62, **tail RMS 0.00000 after the note boundary** in all six renders.
- Parser output re-checked for all 20 Daisy syllables (table in §5B V11).

### Limits that remain

- Codas are noise bursts through the shared burst chain; /v/, /l/, /r/ are approximations, not voiced
  constrictions (V6).
- The preview still bypasses the master limiter and all track FX, and it is still the JS engine, not the
  JUCE voice used by playback/export (V9).
- The first syllable still loses part of its 15 ms attack when the synchronous buffer render overruns the
  20 ms scheduling headroom.

## 14. UI CORRECTIONS — 2026-10-25

| ID | What changed | File(s) |
| :--- | :--- | :--- |
| **U1** | The ALIEN CURVE WARP MATRIX pills in Synth Studio no longer draw a selected-state halo (`boxShadow: 0 0 10px rgba(0,230,255,0.4)`). Drum Designer's equivalent pills already used `boxShadow: none`, so nothing there changed. | `SynthStudioModal.tsx:1497-1507` |
| **U2** | Filter graph handle floated above the response curve because its position was passed as the quadratic **control point**, which the curve never reaches. The control point is now offset by `2P − (A+B)/2` per segment so the curve passes exactly through `(cutoffX, cutoffY)` at `t = 0.5`. Drag Q now uses the same vertical mapping the graph draws with (`peakNorm = (0.45 − yNorm) / 0.35`), so the handle tracks the cursor instead of jumping. | `SynthStudioModal.tsx:695-732, 742-762` |
| **U3** | Selected alien pill is now solid `#2b4c7e` with a `#4dabf7` border and white text — the same selected style as the SYNTH tab and the WAVEFORM GEOMETRY buttons — instead of a cyan gradient. | `SynthStudioModal.tsx:1498-1500` |
| **U4** | Removed the glowing cyan dot before "ALIEN CURVE WARP MATRIX". It was hardcoded, unconditional, and bound to no state, so it signalled nothing. | `SynthStudioModal.tsx:1460-1462` |
| **U5** | Remaining gradients on interactive controls replaced with flat fills and a hover shade: Drum Designer alien pills and choke pills (`#2b4c7e` selected / `#4dabf7` border / white text, hover `#34598f`; unselected hover `rgba(255,255,255,0.08)`), pad-mode segmented buttons (flat tint), SAVE & CLOSE (primary `#2b4c7e`), New Project confirm and delete-FX confirm (`#c92a4e`, hover `#d93a5e`), Add Converted MIDI to Grid (`#9b4dca`, hover `#ab5fdb`), Genie keypad keys, `.btn-primary`, scrollbar thumb hover. Handlers, state and labels unchanged. | `DrumDesignerModal.tsx:2029-2071, 2367-2382, 2922-2937, 2983-2996`; `App.tsx:1605`; `LeftPane.tsx:5988, 12443`; `ImportAudioModal.tsx:2263`; `index.css:96, 127, 142-160` |
| **U6** | Decorative gradients on non-controls flattened to solid tints: Chord Detective and Drum Voice Distribution cards, Synth Studio alien panel background, Render Project modal header. | `RightPane.tsx:650, 690`; `SynthStudioModal.tsx:1474`; `LeftPane.tsx:11796` |
| **U7** | Static / state-independent glows removed: Chain Glides button, "+ Add Effect" select, alien panel inset shadow, Chord Detective card shadow, delete-FX hover glow, AI generate button idle inset, stem-splitter progress fill. State-driven glows left intact (record, count-in, step-record, input focus, pressed keys, file drag-over, MIDI activity, AI loading, FX bypass, playheads, status dots). | `MidiEditSection.tsx:1220`; `LeftPane.tsx:5909, 10424, 12450-12459`; `SynthStudioModal.tsx:1481`; `RightPane.tsx:657`; `StemSplitterPane.tsx:388` |
| **U8** | Removed the decorative cyan dot before "ALIEN TRANSIENT CURVE MATRIX" in Drum Designer — unconditional, no state, no tooltip (the twin of U4). | `DrumDesignerModal.tsx:2333-2339` |

### Verification

- New bundle contains 0 occurrences of the button glow literal (previous build had 1), one fewer
  `0 0 8px #00e6ff` (the removed dot; two other status dots elsewhere are untouched), and one fewer
  `linear-gradient(135deg, #00e6ff, #0088ff)` (the alien pills; other components still use it).
- After U5-U8: **one** `linear-gradient` remains in the JS bundle (`DrumSequencer.layeredBackground`,
  lane colours = data) and **one** in the CSS bundle (`AppSlider` fill, functional progress). No
  gradient remains on any button, card, panel or header.
- Only state-dependent `boxShadow` glows remain; every static one listed in U7 is gone.
- `npx tsc --noEmit` clean. The 11 eslint errors across the edited files are all pre-existing and in
  untouched regions: `DrumDesignerModal.tsx:157-169, 218`, `ImportAudioModal.tsx:255`,
  `SynthStudioModal.tsx:238, 335`. No new findings; no handlers, state or labels were removed.
- `npx vite build` succeeded and `dist` was copied to `bin/dist` (`index-dvlcHQBy.js`); no native
  rebuild was needed.
