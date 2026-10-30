import type { Track, Note } from '../engine/store'
import { ARTICULATION_FIELDS } from './articulations'
import { saveFileWithDialog } from './fileExport'

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export function generateMusicXML(tracks: Track[], allNotes: Note[], bpm: number, timeSignature: string, includeLyrics = false): string {
  const timeSig = timeSignature || '4/4'
  const [beats, beatType] = timeSig.split('/').map(Number)
  const ticksPerBeat = beatType === 8 ? 96 : 192
  const ticksPerMeasure = beats * ticksPerBeat
  const divisions = ticksPerBeat

  // Calculate maximum measure count across ALL tracks
  const maxTime = allNotes.length === 0 ? ticksPerMeasure * 4 : Math.max(...allNotes.map(n => n.time + n.duration))
  const totalMeasures = Math.max(Math.ceil(maxTime / ticksPerMeasure), 4)

  const bpmValue = bpm || 120

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC
    "-//Recordare//DTD MusicXML 4.0 Partwise//EN"
    "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${tracks.length === 1 ? escapeXml(tracks[0].name || 'Composition') : 'Multi-Track Score'}</work-title>
  </work>
  <identification>
    <creator type="composer">MuseGrid Composer</creator>
    <encoding>
      <software>MuseGrid DAW</software>
      <encoding-date>${new Date().toISOString().split('T')[0]}</encoding-date>
    </encoding>
  </identification>
  <part-list>\n`

  tracks.forEach((track, idx) => {
    xml += `    <score-part id="P${idx + 1}">
      <part-name>${escapeXml(track.name || `Track ${idx + 1}`)}</part-name>
    </score-part>\n`
  })

  xml += `  </part-list>\n`

  // Helper to map ticks to note types
  const getNoteType = (dur: number): string => {
    if (dur >= ticksPerBeat * 4) return 'whole'
    if (dur >= ticksPerBeat * 2) return 'half'
    if (dur >= ticksPerBeat) return 'quarter'
    if (dur >= ticksPerBeat / 2) return 'eighth'
    return '16th'
  }

  // Helper to generate rest nodes
  const appendRest = (dur: number): string => {
    if (dur <= 0) return ''
    const type = getNoteType(dur)
    return `      <note>
        <rest/>
        <duration>${dur}</duration>
        <voice>1</voice>
        <type>${type}</type>
      </note>\n`
  }

  const DIATONIC_STEPS: Array<{ step: string; semitones: number }> = [
    { step: 'C', semitones: 0 },
    { step: 'D', semitones: 2 },
    { step: 'E', semitones: 4 },
    { step: 'F', semitones: 5 },
    { step: 'G', semitones: 7 },
    { step: 'A', semitones: 9 },
    { step: 'B', semitones: 11 },
  ]

  const getPitchInfo = (rawPitch: number) => {
    const safePitch = isFinite(rawPitch) ? rawPitch : 60
    const octave = Math.floor(safePitch / 12) - 1
    const pitchInOctave = safePitch - (octave + 1) * 12

    let bestStep = 'C'
    let minDiff = Infinity
    let bestAlter = 0

    for (const base of DIATONIC_STEPS) {
      let diff = pitchInOctave - base.semitones
      if (diff > 6) diff -= 12
      if (diff < -6) diff += 12
      if (Math.abs(diff) < Math.abs(minDiff)) {
        minDiff = diff
        bestStep = base.step
        bestAlter = diff
      }
    }

    const roundedAlter = Math.round(bestAlter * 100) / 100
    let accidental: string | undefined = undefined
    if (Math.abs(roundedAlter) >= 0.01) {
      if (Math.abs(roundedAlter - 1) < 0.06) accidental = 'sharp'
      else if (Math.abs(roundedAlter - (-1)) < 0.06) accidental = 'flat'
      else if (Math.abs(roundedAlter - 0.5) < 0.06) accidental = 'quarter-sharp'
      else if (Math.abs(roundedAlter - (-0.5)) < 0.06) accidental = 'quarter-flat'
      else if (Math.abs(roundedAlter - 1.5) < 0.06) accidental = 'three-quarters-sharp'
      else if (Math.abs(roundedAlter - (-1.5)) < 0.06) accidental = 'three-quarters-flat'
      else if (roundedAlter > 0) accidental = 'sharp'
      else if (roundedAlter < 0) accidental = 'flat'
    }

    return {
      step: bestStep,
      alter: roundedAlter,
      octave,
      accidental
    }
  }

  interface SlicedNote extends Note {
    sliceTime: number;
    sliceDuration: number;
    tieStart?: boolean;
    tieStop?: boolean;
  }

  const sliceNoteForMeasures = (note: Note, measureTicks: number): SlicedNote[] => {
    const noteEnd = note.time + note.duration
    const slices: SlicedNote[] = []
    let curStart = note.time

    while (curStart < noteEnd) {
      const curMeasureIndex = Math.floor(curStart / measureTicks)
      const measureEnd = (curMeasureIndex + 1) * measureTicks
      const curEnd = Math.min(noteEnd, measureEnd)
      const curDur = Math.max(1, curEnd - curStart)

      const isFirst = curStart === note.time
      const isLast = curEnd === noteEnd

      slices.push({
        ...note,
        sliceTime: curStart,
        sliceDuration: curDur,
        tieStart: !isLast,
        tieStop: !isFirst
      })

      curStart = curEnd
    }

    return slices
  }

  tracks.forEach((track, idx) => {
    xml += `  <part id="P${idx + 1}">\n`
    const rawTrackNotes = allNotes.filter(n => n.trackId === track.id)
    const trackNotes = rawTrackNotes.flatMap(n => sliceNoteForMeasures(n, ticksPerMeasure))

    for (let m = 0; m < totalMeasures; m++) {
      const measureNumber = m + 1
      const startTick = m * ticksPerMeasure
      const endTick = startTick + ticksPerMeasure

      xml += `    <measure number="${measureNumber}">\n`

      // Output attributes on first measure
      if (m === 0) {
        xml += `      <attributes>
        <divisions>${divisions}</divisions>
        <key>
          <fifths>0</fifths>
          <mode>major</mode>
        </key>
        <time>
          <beats>${beats}</beats>
          <beat-type>${beatType}</beat-type>
        </time>
        <clef>
          <sign>${track.instrument === 'drum' ? 'percussion' : 'G'}</sign>
          <line>2</line>
        </clef>
      </attributes>\n`

        // Output metronome direction on first measure of the FIRST track only
        if (idx === 0) {
          xml += `      <direction placement="above">
        <direction-type>
          <metronome parentheses="no">
            <beat-unit>quarter</beat-unit>
            <per-minute>${bpmValue}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="${bpmValue}"/>
      </direction>\n`
        }
      }

      // Filter notes starting in this measure
      const measureNotes = trackNotes.filter(n => n.sliceTime >= startTick && n.sliceTime < endTick)

      // Group by start time
      const chordGroups: Record<number, typeof trackNotes> = {}
      measureNotes.forEach(note => {
        if (!chordGroups[note.sliceTime]) chordGroups[note.sliceTime] = []
        chordGroups[note.sliceTime].push(note)
      })

      const sortedTimes = Object.keys(chordGroups).map(Number).sort((a, b) => a - b)
      let currentTick = startTick

      sortedTimes.forEach(time => {
        if (time > currentTick) {
          const restDur = time - currentTick
          xml += appendRest(restDur)
          currentTick = time
        }

        const chordNotes = chordGroups[time]
        const firstNoteDuration = chordNotes[0]?.sliceDuration || 48
        const chordDuration = Math.max(1, Math.min(firstNoteDuration, endTick - time))

        chordNotes.forEach((note, index) => {
          const { step, alter, octave, accidental } = getPitchInfo(note.pitch)
          const typeStr = getNoteType(chordDuration)

          xml += `      <note>\n`
          if (index > 0) {
            xml += `        <chord/>\n`
          }
          if (track.instrument === 'drum') {
            xml += `        <unpitched>
          <display-step>${step}</display-step>
          <display-octave>${octave}</display-octave>
        </unpitched>\n`
          } else {
            xml += `        <pitch>
          <step>${step}</step>\n`
            if (alter !== 0) {
              xml += `          <alter>${alter}</alter>\n`
            }
            xml += `          <octave>${octave}</octave>
        </pitch>\n`
          }
          
          xml += `        <duration>${chordDuration}</duration>
        <voice>1</voice>
        <type>${typeStr}</type>\n`

          if (note.tieStart) {
            xml += `        <tie type="start"/>\n`
          }
          if (note.tieStop) {
            xml += `        <tie type="stop"/>\n`
          }
          
          if (track.instrument !== 'drum' && accidental) {
            xml += `        <accidental>${accidental}</accidental>\n`
          }
          if (includeLyrics && note.lyric) {
            xml += `        <lyric number="1">
          <text>${escapeXml(note.lyric)}</text>
        </lyric>\n`
          }
          if (note.tieStart || note.tieStop) {
            xml += `        <notations>\n`
            if (note.tieStop) xml += `          <tied type="stop"/>\n`
            if (note.tieStart) xml += `          <tied type="start"/>\n`
            xml += `        </notations>\n`
          }
          xml += `      </note>\n`
        })

        currentTick += chordDuration
      })

      if (currentTick < endTick) {
        xml += appendRest(endTick - currentTick)
      }

      xml += `    </measure>\n`
    }

    xml += `  </part>\n`
  })

  xml += `</score-partwise>\n`

  return xml
}

export function downloadScore(xmlString: string, filename: string): void {
  saveFileWithDialog(xmlString, {
    defaultFilename: filename,
    title: 'Export Score (MusicXML)',
    extensions: ['musicxml', 'xml'],
    mimeType: 'application/vnd.recordare.musicxml+xml'
  })
}

export type MuzTrackExpression = Partial<Pick<Note,
  | 'vibratoDepth' | 'vibratoRate' | 'vibratoDelay' | 'vibratoFade' | 'vibratoWave'
  | 'tremoloDepth' | 'tremoloRate' | 'tremoloWave'
  | 'filterStart' | 'filterEnd' | 'filterSweepTime' | 'filterSweepRamp'
  | 'pitchSlide' | 'pitchSlideTime' | 'pitchSlideRamp' | 'pitchSlideCustomCurve'
  | 'glideStyle' | 'octaves' | 'resonance' | 'decay'
>>

export interface MuzTrackExportData {
  format: 'muztrack'
  version: '1.0'
  title: string
  bpm: number
  timeSignature: string
  exportedAt: string
  tracks: Array<{
    id: string
    name: string
    color: string
    instrument: string
    synthPreset?: string
    drumKit?: string
    edoDivision?: number
    edoPreset?: string
    edoRootNote?: number
    volume?: number
    pan?: number
  }>
  notes: Array<{
    id: string
    trackId: string
    pitch: number
    time: number
    duration: number
    velocity: number
    lyric?: string
    frequencyHz: number
    centsFromRoot: number
    edoDivision?: number
    velocityInspectorModified?: boolean
    /** Per-note articulation values; omitted for notes that use the track defaults. */
    expression?: MuzTrackExpression
  }>
}

/**
 * Copies only known articulation fields so a .muztrack file cannot overwrite note
 * identity, timing, or pitch through a malformed `expression` object.
 */
export function readMuzTrackExpression(source: { expression?: unknown } | null | undefined): Partial<Note> {
  const expression = source?.expression
  if (!expression || typeof expression !== 'object') return {}
  const result: Partial<Note> = {}
  ARTICULATION_FIELDS.forEach(key => {
    const value = (expression as Record<string, unknown>)[key]
    if (value !== undefined) (result as Record<string, unknown>)[key] = value
  })
  return result
}

export function generateMuzTrack(tracks: Track[], allNotes: Note[], bpm: number, timeSignature: string): string {
  const trackIdSet = new Set(tracks.map(t => t.id))
  const filteredNotes = allNotes.filter(n => trackIdSet.has(n.trackId))

  const data: MuzTrackExportData = {
    format: 'muztrack',
    version: '1.0',
    title: tracks.length === 1 ? (tracks[0].name || 'Track') : 'Multi-Track Export',
    bpm: bpm || 120,
    timeSignature: timeSignature || '4/4',
    exportedAt: new Date().toISOString(),
    tracks: tracks.map(t => ({
      id: t.id,
      name: t.name,
      color: t.color,
      instrument: t.instrument,
      synthPreset: t.synthPreset,
      drumKit: t.drumKit,
      edoDivision: t.edoDivision || 12,
      edoPreset: t.edoPreset,
      edoRootNote: t.edoRootNote ?? 60,
      volume: t.volume,
      pan: t.pan
    })),
    notes: filteredNotes.map(n => {
      const parentTrack = tracks.find(t => t.id === n.trackId)
      const edo = parentTrack?.edoDivision || 12
      const root = parentTrack?.edoRootNote ?? 60
      const freq = 440 * Math.pow(2, (n.pitch - 69) / 12)
      const centsFromRoot = Math.round((n.pitch - root) * 100)
      const expression: MuzTrackExpression = {}
      ARTICULATION_FIELDS.forEach(key => {
        const value = n[key]
        if (value !== undefined) (expression as Record<string, unknown>)[key] = value
      })

      return {
        id: n.id,
        trackId: n.trackId,
        pitch: n.pitch,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
        lyric: n.lyric,
        frequencyHz: Math.round(freq * 100) / 100,
        centsFromRoot,
        edoDivision: edo,
        ...(n.velocityInspectorModified ? { velocityInspectorModified: true } : {}),
        ...(Object.keys(expression).length > 0 ? { expression } : {})
      }
    })
  }

  return JSON.stringify(data, null, 2)
}

export function downloadMuzTrack(jsonString: string, filename: string): void {
  saveFileWithDialog(jsonString, {
    defaultFilename: filename,
    title: 'Export Track (.muztrack)',
    extensions: ['muztrack', 'json'],
    mimeType: 'application/json'
  })
}

/**
 * Validates and parses a MuseGrid .muztrack JSON string.
 */
export function parseMuzTrack(jsonString: string): MuzTrackExportData {
  const data = JSON.parse(jsonString)
  if (!data || (data.format !== 'muztrack' && !Array.isArray(data.tracks))) {
    throw new Error('Invalid .muztrack file: missing format signature or track array')
  }
  if (!Array.isArray(data.tracks) || !Array.isArray(data.notes)) {
    throw new Error('Invalid .muztrack file: malformed tracks or notes array')
  }
  return data as MuzTrackExportData
}

