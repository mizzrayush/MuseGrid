import * as Tone from 'tone'
import { useStore, type Track } from './store'
import { audioEngine } from './AudioEngine'
import { snapTick, snapToScale } from '../utils/musicTheory'

export interface RetrospectiveNote {
  pitch: number
  velocity: number
  startTick: number
  duration: number
  wallTimeMs: number
  durationMs: number
  transportTick: number
  transportWasRunning: boolean
  timestamp: number
}

const QWERTY_KEY_MAP: Record<string, number> = {
  'a': 0,   // C
  'w': 1,   // C#
  's': 2,   // D
  'e': 3,   // D#
  'd': 4,   // E
  'f': 5,   // F
  't': 6,   // F#
  'g': 7,   // G
  'y': 8,   // G#
  'h': 9,   // A
  'u': 10,  // A#
  'j': 11,  // B
  'k': 12,  // C+1
  'o': 13,  // C#+1
  'l': 14,  // D+1
  'p': 15,  // D#+1
  ';': 16,  // E+1
}

class RecordingEngine {
  private midiAccess: MIDIAccess | null = null
  private activeMidiNotes = new Map<number, {
    time: number
    pitch: number
    velocity: number
    wallTimeMs: number
    transportTick: number
    transportWasRunning: boolean
  }>()
  private activeQwertyNotes = new Map<string, {
    pitch: number
    time: number
    velocity: number
    wallTimeMs: number
    transportTick: number
    transportWasRunning: boolean
  }>()
  private retrospectiveBuffer: RetrospectiveNote[] = []
  private countInTimer: any = null
  private isCountingIn: boolean = false
  private activityTimeout: any = null
  private isInitialized: boolean = false

  // Step Recording state
  private stepChordNotes = new Map<number, { pitch: number; velocity: number }>()
  private stepHeldKeys = new Set<number>()
  private stepCommitTimer: any = null
  private stepReleaseDebounceTimer: any = null

  public init() {
    if (this.isInitialized) return
    this.isInitialized = true
    this.initMidi()
    this.initKeyboardListeners()
  }

  // --- Web MIDI API Integration ---
  public async initMidi() {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      return
    }

    try {
      const access = await navigator.requestMIDIAccess()
      this.midiAccess = access
      this.updateConnectedDevices()

      access.onstatechange = () => {
        this.updateConnectedDevices()
        this.attachMidiInputs()
      }

      this.attachMidiInputs()
    } catch (e) {
      console.warn('Web MIDI Access request denied or failed:', e)
    }
  }

  private updateConnectedDevices() {
    if (!this.midiAccess) return
    const deviceNames: string[] = []
    this.midiAccess.inputs.forEach(input => {
      if (input.name && input.state === 'connected') {
        deviceNames.push(input.name)
      }
    })
    useStore.getState().setActiveMidiDeviceNames(deviceNames)
  }

  private attachMidiInputs() {
    if (!this.midiAccess) return
    this.midiAccess.inputs.forEach(input => {
      input.onmidimessage = (e: MIDIMessageEvent) => {
        if (!e.data) return
        const [status, note, velocity] = Array.from(e.data as Uint8Array)
        const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0
        const isNoteOff = (status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0)

        this.triggerActivityPulse()

        if (isNoteOn) {
          this.handleNoteOn(note, velocity)
        } else if (isNoteOff) {
          this.handleNoteOff(note)
        }
      }
    })
  }

  private triggerActivityPulse() {
    useStore.getState().setMidiActivityPulse(true)
    clearTimeout(this.activityTimeout)
    this.activityTimeout = setTimeout(() => {
      useStore.getState().setMidiActivityPulse(false)
    }, 180)
  }

  // --- Live Note Routing & Processing ---
  public handleNoteOn(pitch: number, velocity: number = 100) {
    const state = useStore.getState()
    const trackId = state.activeTrackId
    if (!trackId) return

    const activeTrack = state.tracks.find(t => t.id === trackId)
    let soundingPitch = pitch

    // Microtonal EDO Keyboard Remap
    if (activeTrack?.instrument === 'synth' && activeTrack.edoDivision && activeTrack.edoDivision !== 12 && state.recordEdoMappingMode !== 'off') {
      const edo = activeTrack.edoDivision
      const root = activeTrack.edoRootNote ?? 60
      const stepSize = 12 / edo

      if (state.recordEdoMappingMode === 'linear') {
        const offset = pitch - root
        soundingPitch = Math.round((root + offset * stepSize) * 1000) / 1000
      } else if (state.recordEdoMappingMode === 'harmonic') {
        const dist = pitch - root
        const nearestStep = Math.round(dist / stepSize)
        soundingPitch = Math.round((root + nearestStep * stepSize) * 1000) / 1000
      }
    } else {
      // Scale conformance if enabled
      const effectiveScale = activeTrack?.scaleOverride || state.scaleLock
      if ((state.recordScaleConform || state.scaleLock.enabled) && activeTrack?.instrument === 'synth' && effectiveScale.enabled && (!activeTrack.edoDivision || activeTrack.edoDivision === 12)) {
        soundingPitch = snapToScale(soundingPitch, effectiveScale.root, effectiveScale.mode, effectiveScale.customIntervals)
      }
    }

    const { synthLowerOctave, synthUpperOctave } = state
    const lowestPitch = (synthLowerOctave + 1) * 12
    const highestPitch = (synthUpperOctave + 1) * 12 + 11
    soundingPitch = Math.max(lowestPitch, Math.min(highestPitch, soundingPitch))
    soundingPitch = Math.round(soundingPitch * 1000) / 1000

    audioEngine.triggerLiveNote(trackId, soundingPitch, velocity)

    // --- STEP RECORDING MODE ---
    if (state.isStepRecording) {
      this.stepHeldKeys.add(pitch)
      this.stepChordNotes.set(pitch, { pitch: soundingPitch, velocity })

      if (this.stepReleaseDebounceTimer) {
        clearTimeout(this.stepReleaseDebounceTimer)
        this.stepReleaseDebounceTimer = null
      }

      if (state.stepRecordAdvanceMode === 'timer') {
        if (this.stepCommitTimer) clearTimeout(this.stepCommitTimer)
        this.stepCommitTimer = setTimeout(() => {
          this.commitStepChord()
        }, Math.max(20, state.stepRecordChordSensitivityMs))
      }
      return
    }

    // --- REGULAR LIVE RECORDING TRACKING ---
    const nowMs = performance.now()
    const transportTick = Tone.Transport.ticks
    const transportWasRunning = Tone.Transport.state === 'started'

    this.activeMidiNotes.set(pitch, {
      time: transportTick,
      pitch: soundingPitch,
      velocity,
      wallTimeMs: nowMs,
      transportTick,
      transportWasRunning
    })
  }

  public handleNoteOff(pitch: number) {
    const state = useStore.getState()
    const trackId = state.activeTrackId

    const pending = this.activeMidiNotes.get(pitch)
    const stepPending = this.stepChordNotes.get(pitch)
    if (trackId) {
      audioEngine.releaseLiveNote(trackId, pending ? pending.pitch : (stepPending ? stepPending.pitch : pitch))
    }

    // --- STEP RECORDING MODE ---
    if (state.isStepRecording) {
      this.stepHeldKeys.delete(pitch)

      if (state.stepRecordAdvanceMode === 'release') {
        if (this.stepHeldKeys.size === 0 && this.stepChordNotes.size > 0) {
          // All keys of chord released! Use small debounce window so slightly unsynced finger releases don't fragment
          if (this.stepReleaseDebounceTimer) clearTimeout(this.stepReleaseDebounceTimer)
          const debounceMs = Math.min(80, Math.max(25, Math.round(state.stepRecordChordSensitivityMs * 0.4)))
          this.stepReleaseDebounceTimer = setTimeout(() => {
            if (this.stepHeldKeys.size === 0 && this.stepChordNotes.size > 0) {
              this.commitStepChord()
            }
          }, debounceMs)
        }
      }
      return
    }

    if (!pending) return
    this.activeMidiNotes.delete(pitch)

    const nowMs = performance.now()
    const rawEnd = Tone.Transport.ticks
    let time = pending.time
    let end = rawEnd
    let finalPitch = pending.pitch
    const durationMs = Math.max(30, nowMs - pending.wallTimeMs)

    // Calculate duration in ticks (using real elapsed ms if transport was paused)
    const ticksPerMs = ((state.bpm || 120) * 192) / 60000
    const realDurationTicks = Math.max(24, Math.round(durationMs * ticksPerMs))
    let duration = pending.transportWasRunning && Tone.Transport.state === 'started' && (end > time)
      ? Math.max(24, end - time)
      : realDurationTicks

    // 1. Input Quantization (Live record snap)
    if (state.recordInputQuantize > 0) {
      time = snapTick(time, state.recordInputQuantize)
      end = snapTick(rawEnd, state.recordInputQuantize)
      duration = Math.max(state.recordInputQuantize, end - time)
    } else if (state.recordInputQuantize === -1 || state.quantizeInputEnabled) {
      time = snapTick(time, state.snapResolution)
      end = snapTick(rawEnd, state.snapResolution)
      duration = Math.max(state.snapResolution, end - time)
    }

    // 2. Scale Conformance (for standard 12-TET tracks)
    const activeTrack = state.tracks.find(t => t.id === trackId)
    const effectiveScale = activeTrack?.scaleOverride || state.scaleLock
    if ((state.recordScaleConform || state.scaleLock.enabled) && activeTrack?.instrument === 'synth' && effectiveScale.enabled && (!activeTrack.edoDivision || activeTrack.edoDivision === 12)) {
      finalPitch = snapToScale(finalPitch, effectiveScale.root, effectiveScale.mode, effectiveScale.customIntervals)
    }

    const { synthLowerOctave, synthUpperOctave } = state
    const lowestPitch = (synthLowerOctave + 1) * 12
    const highestPitch = (synthUpperOctave + 1) * 12 + 11
    finalPitch = Math.max(lowestPitch, Math.min(highestPitch, finalPitch))
    finalPitch = Math.round(finalPitch * 1000) / 1000

    // 3. Retrospective Circular Buffer (always records every note)
    this.retrospectiveBuffer.push({
      pitch: finalPitch,
      velocity: pending.velocity,
      startTick: Math.max(0, time),
      duration,
      wallTimeMs: pending.wallTimeMs,
      durationMs,
      transportTick: pending.transportTick,
      transportWasRunning: pending.transportWasRunning,
      timestamp: Date.now()
    })
    const cutoff = Date.now() - 3 * 60 * 1000
    this.retrospectiveBuffer = this.retrospectiveBuffer.filter(n => n.timestamp >= cutoff).slice(-400)
    state.setRetrospectiveNoteCount(this.retrospectiveBuffer.length)

    // 4. Live Recording onto Track
    if (state.isRecording && trackId) {
      state.addNote({
        id: Math.random().toString(36).substr(2, 9),
        trackId,
        time: Math.max(0, time),
        duration,
        pitch: finalPitch,
        velocity: pending.velocity
      })
    }
  }

  // --- Step Recording Chord Commit ---
  public commitStepChord() {
    const state = useStore.getState()
    const trackId = state.activeTrackId
    if (!trackId || this.stepChordNotes.size === 0) return

    const notesToCommit = Array.from(this.stepChordNotes.values())
    this.stepChordNotes.clear()
    this.stepHeldKeys.clear()
    if (this.stepCommitTimer) {
      clearTimeout(this.stepCommitTimer)
      this.stepCommitTimer = null
    }
    if (this.stepReleaseDebounceTimer) {
      clearTimeout(this.stepReleaseDebounceTimer)
      this.stepReleaseDebounceTimer = null
    }

    // 1. Calculate Base Step Advance in ticks
    const baseStepTicks = state.stepRecordStepSize > 0 ? state.stepRecordStepSize : state.snapResolution
    const stepAdvanceTicks = Math.round(baseStepTicks * (state.stepRecordStepColumns || 1))

    // 2. Calculate Note Duration in ticks
    let noteDurationTicks: number
    if (state.stepRecordNoteDuration > 0) {
      noteDurationTicks = Math.round((state.stepRecordNoteDuration * (state.stepRecordNoteColumns || 1)) * (state.stepRecordGatePercent / 100))
    } else {
      noteDurationTicks = Math.round((baseStepTicks * (state.stepRecordNoteColumns || 1)) * (state.stepRecordGatePercent / 100))
    }
    noteDurationTicks = Math.max(12, noteDurationTicks)

    // 3. Target Position
    const cursorTick = state.stepRecordCursorTick

    // If replace mode (not overdub), remove any overlapping notes at this column on this track
    if (!state.midiOverdub) {
      state.eraseNotesInRegion(trackId, cursorTick, cursorTick + stepAdvanceTicks)
    }

    state.commitHistory()
    notesToCommit.forEach(n => {
      state.addNote({
        id: Math.random().toString(36).substr(2, 9),
        trackId,
        time: cursorTick,
        duration: noteDurationTicks,
        pitch: n.pitch,
        velocity: n.velocity
      })
    })

    // 4. Advance cursor to next column/bar
    state.advanceStepRecordCursor()
  }

  // --- QWERTY Typing Piano Keyboard & Step Navigation ---
  private initKeyboardListeners() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'SELECT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.hasAttribute('contenteditable')
      ) {
        return
      }

      const state = useStore.getState()

      // Step Recording Navigation Hotkeys (always active when Step Recording is armed)
      if (state.isStepRecording) {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          state.advanceStepRecordCursor()
          return
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          state.retreatStepRecordCursor()
          return
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          state.deleteStepRecordCurrentColumn()
          return
        }
        if ((e.key === 'Enter' || e.key === ' ') && state.stepRecordAdvanceMode === 'manual') {
          e.preventDefault()
          this.commitStepChord()
          return
        }
      }

      if (!state.qwertyPianoEnabled) return
      if (e.repeat) return

      const key = e.key.toLowerCase()

      // Octave Shift
      if (key === 'z') {
        e.preventDefault()
        const next = Math.max(1, state.qwertyOctave - 1)
        state.setQwertyOctave(next)
        state.showToast(`QWERTY Octave: C${next}`, 'info')
        return
      }
      if (key === 'x') {
        e.preventDefault()
        const next = Math.min(7, state.qwertyOctave + 1)
        state.setQwertyOctave(next)
        state.showToast(`QWERTY Octave: C${next}`, 'info')
        return
      }

      // Velocity Shift
      if (key === 'c') {
        e.preventDefault()
        const next = Math.max(15, state.qwertyVelocity - 15)
        state.setQwertyVelocity(next)
        state.showToast(`Velocity: ${next}`, 'info')
        return
      }
      if (key === 'v') {
        e.preventDefault()
        const next = Math.min(127, state.qwertyVelocity + 15)
        state.setQwertyVelocity(next)
        state.showToast(`Velocity: ${next}`, 'info')
        return
      }

      // Musical Key
      if (key in QWERTY_KEY_MAP) {
        e.preventDefault()
        const offset = QWERTY_KEY_MAP[key]
        const pitch = (state.qwertyOctave + 1) * 12 + offset
        const nowMs = performance.now()
        const transportTick = Tone.Transport.ticks
        const transportWasRunning = Tone.Transport.state === 'started'
        this.activeQwertyNotes.set(key, {
          pitch,
          time: transportTick,
          velocity: state.qwertyVelocity,
          wallTimeMs: nowMs,
          transportTick,
          transportWasRunning
        })
        this.triggerActivityPulse()
        this.handleNoteOn(pitch, state.qwertyVelocity)
      }
    })

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (this.activeQwertyNotes.has(key)) {
        const item = this.activeQwertyNotes.get(key)
        this.activeQwertyNotes.delete(key)
        if (item) {
          this.handleNoteOff(item.pitch)
        }
      }
    })
  }

  // --- Step Recording Toggle ---
  public toggleStepRecording() {
    const state = useStore.getState()
    const next = !state.isStepRecording
    if (next) {
      if (state.isRecording || this.isCountingIn) {
        this.cancelCountIn()
        this.activeMidiNotes.clear()
        state.setIsRecording(false)
      }
      this.stepChordNotes.clear()
      this.stepHeldKeys.clear()
      state.setIsStepRecording(true)
      state.showToast('Step Recording Armed (Column-by-Column)', 'success')
    } else {
      this.stepChordNotes.clear()
      this.stepHeldKeys.clear()
      if (this.stepCommitTimer) clearTimeout(this.stepCommitTimer)
      if (this.stepReleaseDebounceTimer) clearTimeout(this.stepReleaseDebounceTimer)
      state.setIsStepRecording(false)
      state.showToast('Step Recording Disarmed', 'info')
    }
  }

  // --- Toggle Recording & Count-In ---
  public toggleRecording() {
    const state = useStore.getState()
    if (state.isRecording || this.isCountingIn) {
      // Stop recording
      this.cancelCountIn()
      this.activeMidiNotes.clear()
      state.setIsRecording(false)
      state.commitHistory()
      state.showToast('Recording Stopped & Saved', 'info')
      return
    }

    if (state.isStepRecording) {
      state.setIsStepRecording(false)
    }

    // Pre-Roll / Count-In
    if (state.recordCountIn > 0) {
      this.startCountIn(state.recordCountIn, () => this.beginRecording())
    } else {
      this.beginRecording()
    }
  }

  public startCountIn(bars: number, onComplete: () => void) {
    if (this.isCountingIn) {
      this.cancelCountIn()
      return
    }

    const state = useStore.getState()
    const bpm = state.bpm
    const beatsTotal = bars * 4
    let currentBeat = 0

    this.isCountingIn = true
    state.setCountInRemaining(beatsTotal)

    const beatIntervalMs = (60 / bpm) * 1000
    audioEngine.triggerMetronomeClick(true)

    this.countInTimer = setInterval(() => {
      currentBeat++
      const remaining = beatsTotal - currentBeat

      if (remaining <= 0) {
        clearInterval(this.countInTimer)
        this.countInTimer = null
        this.isCountingIn = false
        state.setCountInRemaining(null)
        onComplete()
      } else {
        state.setCountInRemaining(remaining)
        const isDownbeat = (currentBeat % 4) === 0
        audioEngine.triggerMetronomeClick(isDownbeat)
      }
    }, beatIntervalMs)
  }

  public cancelCountIn() {
    if (this.countInTimer) {
      clearInterval(this.countInTimer)
      this.countInTimer = null
    }
    this.isCountingIn = false
    useStore.getState().setCountInRemaining(null)
  }

  public beginRecording() {
    const state = useStore.getState()
    let targetTrackId = state.activeTrackId

    // Handle "New Track (Take Mode)"
    if (state.recordTargetMode === 'new_track') {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId) || state.tracks[0]
      const takeNumber = state.recordTakeCounter
      const newTrackId = 'track_' + Math.random().toString(36).substr(2, 9)
      const newTrackName = `Recording ${takeNumber}`

      const newTrack: Track = {
        ...(activeTrack || {
          instrument: 'synth',
          volume: 1,
          pan: 0,
          muted: false,
          soloed: false,
        }),
        id: newTrackId,
        name: newTrackName,
        color: '#ff4d6d',
        allowMultiTrackSelect: false,
      }

      state.addTrack(newTrack)
      state.setActiveTrackId(newTrackId)
      state.setRecordTakeCounter(takeNumber + 1)
      targetTrackId = newTrackId
    }

    state.commitHistory()

    // Replace mode vs Overdub mode
    if (!state.midiOverdub && targetTrackId) {
      state.clearTrackNotes(targetTrackId)
    }

    state.setIsRecording(true)
    state.showToast(`Recording Live on ${state.tracks.find(t => t.id === targetTrackId)?.name || 'Track'}`, 'success')

    // Start transport playback if not playing
    if (Tone.Transport.state !== 'started') {
      audioEngine.togglePlay()
    }
  }

  // --- Active Recall (Retrospective MIDI Capture) ---
  public recallActiveRetrospective() {
    this.captureActiveRecall()
  }

  public captureActiveRecall() {
    const state = useStore.getState()
    if (this.retrospectiveBuffer.length === 0) {
      state.showToast('No recent notes in memory to recall. Jam some notes first!', 'info')
      return
    }

    const notesToRecall = [...this.retrospectiveBuffer]
    let targetTrackId = state.activeTrackId
    const targetMode = state.recordTargetMode

    if (targetMode === 'new_track' || !targetTrackId) {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId) || state.tracks[0]
      const takeNumber = state.recordTakeCounter
      const newTrackId = 'track_' + Math.random().toString(36).substr(2, 9)
      const newTrackName = `Recall ${takeNumber}`

      const newTrack: Track = {
        ...(activeTrack || {
          instrument: 'synth',
          volume: 1,
          pan: 0,
          muted: false,
          soloed: false,
        }),
        id: newTrackId,
        name: newTrackName,
        color: '#ffcc00',
        allowMultiTrackSelect: false,
      }

      state.addTrack(newTrack)
      state.setActiveTrackId(newTrackId)
      state.setRecordTakeCounter(takeNumber + 1)
      targetTrackId = newTrackId
    }

    state.commitHistory()

    const bpm = state.bpm || 120
    const ticksPerMs = (bpm * 192) / 60000
    const firstNote = notesToRecall[0]
    const anchorTick = Math.max(0, state.playheadPosition)
    const mode = state.recallPlacementMode || 'time_snap'

    const notesToAdd: { time: number; duration: number; pitch: number; velocity: number }[] = []

    if (mode === 'sequence_columns') {
      // --- MODE: SEQUENTIAL COLUMNS (One column/step per chord or note) ---
      const baseTicks = state.stepRecordStepSize > 0 ? state.stepRecordStepSize : (state.snapResolution > 0 ? state.snapResolution : 48)
      const stepDelta = Math.round(baseTicks * (state.stepRecordStepColumns || 1))
      const noteDur = Math.round((state.stepRecordNoteDuration > 0 ? state.stepRecordNoteDuration : baseTicks) * (state.stepRecordNoteColumns || 1) * ((state.stepRecordGatePercent || 100) / 100))

      let currentColumnIndex = 0
      let chordAnchorMs = firstNote.wallTimeMs

      for (let i = 0; i < notesToRecall.length; i++) {
        const n = notesToRecall[i]
        // If note was played significantly later than current chord anchor, advance to next column
        if (n.wallTimeMs - chordAnchorMs > Math.max(20, state.stepRecordChordSensitivityMs)) {
          currentColumnIndex++
          chordAnchorMs = n.wallTimeMs
        }

        notesToAdd.push({
          time: anchorTick + currentColumnIndex * stepDelta,
          duration: Math.max(12, noteDur),
          pitch: n.pitch,
          velocity: n.velocity
        })
      }
    } else if (mode === 'time_free') {
      // --- MODE: REAL-TIME FREE (Exact micro-timing / human feel, no snapping) ---
      for (const n of notesToRecall) {
        const offsetMs = Math.max(0, n.wallTimeMs - firstNote.wallTimeMs)
        const offsetTicks = Math.round(offsetMs * ticksPerMs)
        const durTicks = Math.max(24, Math.round(n.durationMs * ticksPerMs))

        notesToAdd.push({
          time: anchorTick + offsetTicks,
          duration: durTicks,
          pitch: n.pitch,
          velocity: n.velocity
        })
      }
    } else {
      // --- MODE: TIME + SNAP TO GRID (Default) ---
      // Uses real elapsed time between notes, then snaps according to grid snapping rules
      const shouldSnap = state.snapEnabled !== false && state.snapResolution > 0
      const snapRes = state.recordInputQuantize > 0
        ? state.recordInputQuantize
        : (state.snapResolution > 0 ? state.snapResolution : 48)

      for (const n of notesToRecall) {
        let offsetTicks = Math.round(Math.max(0, n.wallTimeMs - firstNote.wallTimeMs) * ticksPerMs)
        let durTicks = Math.max(24, Math.round(n.durationMs * ticksPerMs))

        if (shouldSnap) {
          offsetTicks = snapTick(offsetTicks, snapRes)
          durTicks = Math.max(snapRes, snapTick(durTicks, snapRes))
        }

        notesToAdd.push({
          time: anchorTick + offsetTicks,
          duration: durTicks,
          pitch: n.pitch,
          velocity: n.velocity
        })
      }
    }

    // Insert all notes onto the target track
    notesToAdd.forEach(n => {
      state.addNote({
        id: Math.random().toString(36).substr(2, 9),
        trackId: targetTrackId!,
        time: Math.max(0, n.time),
        duration: n.duration,
        pitch: n.pitch,
        velocity: n.velocity
      })
    })

    const maxNoteEnd = Math.max(...notesToAdd.map(n => n.time + n.duration), 0)
    const currentGridTicks = state.gridColumnCount * state.gridBlockTicks
    if (maxNoteEnd + 768 > currentGridTicks) {
      state.setGridColumnCount(Math.ceil((maxNoteEnd + 1536) / state.gridBlockTicks))
    }

    const trackObj = useStore.getState().tracks.find(t => t.id === targetTrackId)
    const modeLabel = mode === 'sequence_columns' ? 'Columns' : (mode === 'time_free' ? 'Real Time' : 'Time + Snap')
    state.showToast(`Recalled ${notesToAdd.length} notes (${modeLabel}) into ${trackObj?.name || 'track'}!`, 'success')
  }

  public getRetrospectiveBuffer(): RetrospectiveNote[] {
    return [...this.retrospectiveBuffer]
  }

  public clearRetrospectiveBuffer() {
    this.retrospectiveBuffer = []
    useStore.getState().setRetrospectiveNoteCount(0)
  }
}

export const recordingEngine = new RecordingEngine()
