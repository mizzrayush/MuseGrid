import { useState, useMemo } from 'react'
import { useStore } from '../engine/store'
import { IconX, IconDownload } from './Icons'
import { generateMusicXML, downloadScore } from '../utils/scoreExport'
import { saveFileWithDialog } from '../utils/fileExport'

interface ScorePreviewModalProps {
  onClose: () => void
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

// Converts MIDI pitch to a diatonic step number (where C4/Middle C = 0) and accidental
function getPitchDiatonic(pitch: number) {
  const safePitch = isFinite(pitch) ? (Math.round(pitch * 100000) / 100000) : 60
  const nearestMidi = Math.round(safePitch)
  const noteInOctave = ((nearestMidi % 12) + 12) % 12
  const octave = Math.floor((safePitch + 0.001) / 12) - 1

  const octaveSteps: Record<number, { step: number; accidental?: string }> = {
    0: { step: 0 },
    1: { step: 0, accidental: '♯' },
    2: { step: 1 },
    3: { step: 1, accidental: '♯' },
    4: { step: 2 },
    5: { step: 3 },
    6: { step: 3, accidental: '♯' },
    7: { step: 4 },
    8: { step: 4, accidental: '♯' },
    9: { step: 5 },
    10: { step: 5, accidental: '♯' },
    11: { step: 6 },
  }

  const mapping = octaveSteps[noteInOctave] || { step: 0 }
  const octDiff = octave - 4
  const finalStep = mapping.step + octDiff * 7

  return {
    step: finalStep,
    accidental: mapping.accidental,
    name: NOTE_NAMES[noteInOctave] + octave
  }
}

export default function ScorePreviewModal({ onClose }: ScorePreviewModalProps) {
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
    }, 200)
  }

  const tracks = useStore(state => state.tracks)
  const notes = useStore(state => state.notes)
  const timeSignature = useStore(state => state.timeSignature)
  const scorePreviewTrackIds = useStore(state => state.scorePreviewTrackIds) || []

  const selectedTrackIds = useMemo(() => {
    if (scorePreviewTrackIds.length > 0) return scorePreviewTrackIds
    const activeTrack = tracks.find(t => t.id === useStore.getState().activeTrackId)
    if (activeTrack) return [activeTrack.id]
    return tracks.length > 0 ? [tracks[0].id] : []
  }, [scorePreviewTrackIds, tracks])

  const [showNoteNames, setShowNoteNames] = useState<boolean>(true)
  const [showLyrics, setShowLyrics] = useState<boolean>(true)

  // Selected tracks details
  const selectedTracks = useMemo(() => tracks.filter(t => selectedTrackIds.includes(t.id)), [tracks, selectedTrackIds])

  // Get notes for the selected tracks
  const trackNotes = useMemo(() => {
    return notes.filter(n => selectedTrackIds.includes(n.trackId)).sort((a, b) => a.time - b.time)
  }, [notes, selectedTrackIds])

  // Determine measure count dynamically from time signature (e.g. 4/4 = 768 ticks per measure, 6/8 = 576 ticks per measure)
  const [sigNum, sigDen] = (timeSignature || '4/4').split('/')
  const beatsPerMeasure = parseInt(sigNum) || 4
  const beatType = parseInt(sigDen) || 4
  const ticksPerBeat = beatType === 8 ? 96 : (beatType === 2 ? 384 : 192)
  const ticksPerMeasure = beatsPerMeasure * ticksPerBeat
  const maxTime = useMemo(() => {
    if (trackNotes.length === 0) return ticksPerMeasure * 4
    return Math.max(...trackNotes.map(n => n.time + n.duration))
  }, [trackNotes, ticksPerMeasure])

  const totalMeasures = useMemo(() => {
    return Math.max(Math.ceil(maxTime / ticksPerMeasure), 4)
  }, [maxTime])

  // Group notes into 4-measure staff systems
  const measuresPerSystem = 4
  const ticksPerSystem = ticksPerMeasure * measuresPerSystem
  const totalSystems = Math.ceil(totalMeasures / measuresPerSystem)

  // Handler to print sheet music (PDF Export)
  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const scoreHtml = document.getElementById('musegrid-printable-score')?.innerHTML || ''
    const title = selectedTracks.length === 1 ? selectedTracks[0].name : 'Multi-Track Score'
    
    printWindow.document.write(`
      <html>
        <head>
          <title>MuseGrid Score - ${title}</title>
          <style>
            body {
              font-family: 'Inter', sans-serif;
              background: #fff;
              color: #000;
              padding: 40px;
            }
            .score-header {
              text-align: center;
              margin-bottom: 30px;
            }
            .score-title {
              font-size: 26px;
              font-weight: 800;
              margin: 0;
              letter-spacing: -0.02em;
            }
            .score-subtitle {
              font-size: 14px;
              color: #555;
              margin: 5px 0 0 0;
            }
            .system-container {
              margin-bottom: 40px;
              page-break-inside: avoid;
            }
            svg {
              width: 100%;
              height: auto;
            }
            /* SVG color overrides for print */
            svg text { fill: #000 !important; }
            svg line { stroke: #000 !important; }
            svg path { stroke: #000 !important; }
            svg ellipse { fill: #000 !important; }
          </style>
        </head>
        <body>
          <div class="score-header">
            <h1 class="score-title">${title}</h1>
            <p class="score-subtitle">Composed on MuseGrid • Tempo: ${useStore.getState().bpm} BPM</p>
          </div>
          ${scoreHtml}
          <script>
            window.onload = function() {
              window.print();
              window.close();
            }
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  // Handler to export as PNG
  const handleDownloadPng = async () => {
    const svgs = document.querySelectorAll('#musegrid-printable-score svg');
    if (svgs.length === 0) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const svgWidth = parseInt(svgs[0].getAttribute('width') || '790');
    const heights = Array.from(svgs).map(svg => parseInt(svg.getAttribute('height') || '150'));
    const gap = 40;
    const totalHeight = heights.reduce((sum, h) => sum + h, 0) + (svgs.length - 1) * gap;
    
    const headerHeight = 150;
    canvas.width = svgWidth;
    canvas.height = headerHeight + totalHeight + 40;
    
    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Header
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 36px serif';
    ctx.textAlign = 'center';
    const title = selectedTracks.length === 1 ? selectedTracks[0].name : 'Multi-Track Score';
    ctx.fillText(title || 'Composition', canvas.width / 2, 80);
    
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#555555';
    ctx.fillText(`Composed on MuseGrid • Tempo: ${useStore.getState().bpm} BPM`, canvas.width / 2, 110);
    
    let currentY = headerHeight;
    
    const renderSvgToCanvas = (svgElement: Element, yPos: number): Promise<void> => {
      return new Promise((resolve) => {
        const clone = svgElement.cloneNode(true) as SVGSVGElement;
        
        const elements = clone.querySelectorAll('*');
        elements.forEach((el: any) => {
          if (el.getAttribute('fill') === '#e0e0e0') el.setAttribute('fill', '#000000');
          if (el.getAttribute('stroke') === '#e0e0e0') el.setAttribute('stroke', '#000000');
        });
        
        const svgData = new XMLSerializer().serializeToString(clone);
        const img = new Image();
        const svgBlob = new Blob([svgData], {type: 'image/svg+xml;charset=utf-8'});
        const url = URL.createObjectURL(svgBlob);
        
        img.onload = () => {
          ctx.drawImage(img, 0, yPos);
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = () => {
          // Never leave the export awaiting a failed decode — skip this page and continue
          URL.revokeObjectURL(url);
          console.warn('Score PNG export: failed to rasterize an SVG page');
          resolve();
        };
        img.src = url;
      });
    };
    
    for (let i = 0; i < svgs.length; i++) {
      await renderSvgToCanvas(svgs[i], currentY);
      currentY += heights[i] + gap;
    }
    
    const dataUrl = canvas.toDataURL('image/png');
    const filename = `score_${title.toLowerCase().replace(/\s+/g, '_')}.png`;
    const saved = await saveFileWithDialog(dataUrl, {
      filename,
      title: 'Save Score Image',
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });
    if (saved) {
      useStore.getState().showToast(`Saved score image: ${filename}`, 'success');
    }
  }

  // Handler to export as MusicXML
  const handleExportMusicXML = () => {
    if (selectedTracks.length === 0) return
    const timeSig = useStore.getState().timeSignature || '4/4'
    const bpm = useStore.getState().bpm || 120

    const xml = generateMusicXML(selectedTracks, trackNotes, bpm, timeSig, showLyrics)
    const title = selectedTracks.length === 1 ? selectedTracks[0].name : 'score'
    downloadScore(xml, `${title.toLowerCase().replace(/\s+/g, '_')}.musicxml`)
  }

  return (
    <div className={isClosing ? "animate-modal-bg-exit" : "animate-modal-bg"} style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(8, 9, 14, 0.78)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      zIndex: 100000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }} onClick={handleClose}>
      <div 
        className={isClosing ? "animate-modal-card-exit" : "animate-modal-card"}
        style={{
          width: '100%',
          maxWidth: '1000px',
          height: '90%',
          background: '#12131a',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '16px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255,255,255,0.01)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>𝄞</span>
              <span style={{ fontSize: '16px', fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>Score & Sheet Music</span>
            </div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
              Dynamic multi-track notation previewer
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {/* Note Name Toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showNoteNames}
                onChange={e => setShowNoteNames(e.target.checked)}
                style={{ accentColor: '#4dabf7', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Note Names</span>
            </label>

            {/* Lyrics Toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showLyrics}
                onChange={e => setShowLyrics(e.target.checked)}
                style={{ accentColor: '#4dabf7', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 600 }}>Lyrics</span>
            </label>

            {/* Print / PDF Button */}
            <button
              onClick={handlePrint}
              disabled={trackNotes.length === 0}
              style={{
                background: '#4dabf7',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: trackNotes.length === 0 ? 'not-allowed' : 'pointer',
                opacity: trackNotes.length === 0 ? 0.4 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              Print / PDF
            </button>

            {/* PNG Download */}
            <button
              onClick={handleDownloadPng}
              disabled={trackNotes.length === 0}
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: '#aaa',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: trackNotes.length === 0 ? 'not-allowed' : 'pointer',
                opacity: trackNotes.length === 0 ? 0.4 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s'
              }}
            >
              <IconDownload size={12} /> PNG
            </button>

            {/* MusicXML Export */}
            <button
              onClick={handleExportMusicXML}
              disabled={trackNotes.length === 0}
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: '#aaa',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: trackNotes.length === 0 ? 'not-allowed' : 'pointer',
                opacity: trackNotes.length === 0 ? 0.4 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s'
              }}
              title="Export composition as MusicXML for MuseScore, Finale, or Sibelius"
            >
              <IconDownload size={12} /> MusicXML
            </button>

            {/* Close Button */}
            <button
              onClick={handleClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <IconX size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body / Score Area */}
        <div 
          style={{
            flex: 1,
            padding: '40px 24px',
            overflowY: 'auto',
            background: '#0a0a0d',
            display: 'flex',
            justifyContent: 'center',
          }}
          className="thin-scroll"
        >
          {trackNotes.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#555',
              textAlign: 'center',
              padding: '60px'
            }}>
              <span style={{ fontSize: '48px', marginBottom: '16px' }}>𝄢</span>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#aaa' }}>No Notes Found on Selected Tracks</div>
            </div>
          ) : (
            <div 
              id="musegrid-printable-score"
              style={{
                width: '100%',
                maxWidth: '850px',
                background: '#14151a',
                boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
                borderRadius: '8px',
                padding: '40px 30px',
                color: '#ffffff',
                boxSizing: 'border-box',
                minHeight: '100%'
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: '40px', borderBottom: '2px solid #333', paddingBottom: '12px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '0', color: '#ffffff', letterSpacing: '-0.02em', fontFamily: 'serif' }}>
                  {selectedTracks.length === 1 ? selectedTracks[0].name : 'Multi-Track Score'}
                </h1>
                <p style={{ fontSize: '12px', color: '#aaa', margin: '4px 0 0 0', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Composed on MuseGrid • Tempo: {useStore.getState().bpm} BPM
                </p>
              </div>

              {Array.from({ length: totalSystems }).map((_, systemIndex) => {
                const startTick = systemIndex * ticksPerSystem
                const endTick = startTick + ticksPerSystem

                const N = selectedTracks.length;
                const staffSpacing = 95;
                const topPadding = 30;
                const bottomPadding = 30;
                const svgWidth = 790;
                const svgHeight = topPadding + Math.max(1, N) * staffSpacing + bottomPadding;
                const clefWidth = 60;
                const margin = 20;
                const noteAreaWidth = svgWidth - clefWidth - margin;

                return (
                  <div key={systemIndex} className="system-container" style={{ marginBottom: '40px' }}>
                    <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
                      
                      {/* Left Bracket connecting all staves */}
                      {N > 1 && (
                        <path 
                          d={`M 15 ${topPadding + 20} L 8 ${topPadding + 20} L 8 ${topPadding + (N - 1) * staffSpacing + 55} L 15 ${topPadding + (N - 1) * staffSpacing + 55}`} 
                          stroke="#e0e0e0" strokeWidth="2.5" fill="none" 
                        />
                      )}

                      {selectedTracks.map((track, trackIndex) => {
                        const yOffset = topPadding + (trackIndex * staffSpacing);
                        const yCenter = yOffset + 35; // center of this staff
                        const stepHeight = 4.5;
                        const middleCY = yCenter + 6 * stepHeight;

                        const staffLinesY = [
                          yCenter + 4 * stepHeight,
                          yCenter + 2 * stepHeight,
                          yCenter,
                          yCenter - 2 * stepHeight,
                          yCenter - 4 * stepHeight
                        ]

                        const systemNotes = trackNotes.filter(n => n.trackId === track.id && n.time >= startTick && n.time < endTick);
                        const chordGroups: Record<number, typeof trackNotes> = {}
                        systemNotes.forEach(note => {
                          if (!chordGroups[note.time]) chordGroups[note.time] = []
                          chordGroups[note.time].push(note)
                        })
                        const sortedChordTimes = Object.keys(chordGroups).map(Number).sort((a, b) => a - b)

                        return (
                          <g key={track.id}>
                            {/* Track Name */}
                            <text x="20" y={yOffset + 12} fontSize="10" fill="#777" fontWeight="bold">{track.name}</text>

                            {/* 5 Staff Lines */}
                            {staffLinesY.map((lineY, i) => (
                              <line key={i} x1="20" y1={lineY} x2={svgWidth} y2={lineY} stroke="#e0e0e0" strokeWidth="1.2" />
                            ))}

                            {/* Left Staff Boundary */}
                            <line x1="20" y1={staffLinesY[4]} x2="20" y2={staffLinesY[0]} stroke="#e0e0e0" strokeWidth="2.5" />

                            {/* Treble Clef */}
                            <text x="25" y={yCenter + 15} fontSize="42" fontFamily="serif" fill="#e0e0e0">
                              {track.instrument === 'drum' ? '𝄥' : '𝄞'}
                            </text>

                            {/* Time Signature */}
                            {systemIndex === 0 && (
                              <g>
                                <text x="55" y={yCenter - 8} fontSize="16" fontWeight="800" fontFamily="serif" fill="#e0e0e0">{beatsPerMeasure}</text>
                                <text x="55" y={yCenter + 10} fontSize="16" fontWeight="800" fontFamily="serif" fill="#e0e0e0">{beatType}</text>
                              </g>
                            )}

                            {/* Measure Bar Lines */}
                            {Array.from({ length: measuresPerSystem }).map((_, mIndex) => {
                              const measureNumber = systemIndex * measuresPerSystem + mIndex + 1
                              const relTime = mIndex + 1
                              const x = clefWidth + (relTime / measuresPerSystem) * noteAreaWidth

                              return (
                                <g key={mIndex}>
                                  <line x1={x} y1={staffLinesY[4]} x2={x} y2={staffLinesY[0]} stroke="#e0e0e0" strokeWidth={mIndex === measuresPerSystem - 1 ? "2.5" : "1"} />
                                  {mIndex === measuresPerSystem - 1 && (
                                    <line x1={x - 4} y1={staffLinesY[4]} x2={x - 4} y2={staffLinesY[0]} stroke="#e0e0e0" strokeWidth="1" />
                                  )}
                                  {trackIndex === 0 && (
                                    <text x={x - noteAreaWidth / (measuresPerSystem * 2)} y={staffLinesY[4] - 8} fontSize="9" fontWeight="600" fontFamily="sans-serif" textAnchor="middle" fill="#777">
                                      {measureNumber}
                                    </text>
                                  )}
                                </g>
                              )
                            })}

                            {/* Render Notes */}
                            {sortedChordTimes.map(time => {
                              const chordNotes = chordGroups[time]
                              const relTime = time - startTick
                              const x = clefWidth + (relTime / ticksPerSystem) * noteAreaWidth

                              return (
                                <g key={time}>
                                  {chordNotes.map(note => {
                                    const mapping = getPitchDiatonic(note.pitch)
                                    const y = track.instrument === 'drum' ? yCenter : middleCY - mapping.step * stepHeight
                                    
                                    const ledgers: number[] = []
                                    if (track.instrument !== 'drum') {
                                      if (mapping.step <= 0) {
                                        for (let s = 0; s >= mapping.step; s -= 2) ledgers.push(s)
                                      } else if (mapping.step >= 12) {
                                        for (let s = 12; s <= mapping.step; s += 2) ledgers.push(s)
                                      }
                                    }

                                    const stemUp = track.instrument === 'drum' || mapping.step < 6

                                    return (
                                      <g key={note.id}>
                                        {/* Ledger Lines */}
                                        {ledgers.map(lStep => {
                                          const lY = middleCY - lStep * stepHeight
                                          return <line key={lStep} x1={x - 10} y1={lY} x2={x + 10} y2={lY} stroke="#e0e0e0" strokeWidth="1.2" />
                                        })}

                                        {/* Stem Line */}
                                        {stemUp ? (
                                          <line x1={x + 5.5} y1={y} x2={x + 5.5} y2={y - 25} stroke="#e0e0e0" strokeWidth="1.5" strokeLinecap="round" />
                                        ) : (
                                          <line x1={x - 5.5} y1={y} x2={x - 5.5} y2={y + 25} stroke="#e0e0e0" strokeWidth="1.5" strokeLinecap="round" />
                                        )}

                                        {/* Accidental */}
                                        {track.instrument !== 'drum' && mapping.accidental && (
                                          <text x={x - 12} y={y + 4} fontSize="14" fontWeight="bold" fontFamily="serif" fill="#e0e0e0">♯</text>
                                        )}

                                        {/* Note Head */}
                                        {track.instrument === 'drum' ? (
                                          <rect x={x - 4} y={y - 4} width="8" height="8" fill="#e0e0e0" transform={`rotate(45 ${x} ${y})`} />
                                        ) : (
                                          <ellipse cx={x} cy={y} rx="6" ry="4.2" transform={`rotate(-22 ${x} ${y})`} fill="#e0e0e0" />
                                        )}

                                        {/* Note Name Overlay */}
                                        {showNoteNames && track.instrument !== 'drum' && (
                                          <text x={x} y={y + 1} fontSize="5.5" fontWeight="bold" fontFamily="sans-serif" fill="#14151a" textAnchor="middle" alignmentBaseline="middle">
                                            {mapping.name.replace(/\d/, '')}
                                          </text>
                                        )}
                                      </g>
                                    )
                                  })}

                                  {/* Lyrics */}
                                  {showLyrics && chordNotes.some(n => n.lyric) && (
                                    <text x={x} y={yCenter + 35} fontSize="10" fontWeight="bold" fontFamily="sans-serif" fill="#e0e0e0" textAnchor="middle">
                                      {chordNotes.find(n => n.lyric)?.lyric}
                                    </text>
                                  )}
                                </g>
                              )
                            })}
                          </g>
                        )
                      })}
                    </svg>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
