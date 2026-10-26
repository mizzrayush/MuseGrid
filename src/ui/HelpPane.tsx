import { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../engine/store';
import {
  IconSettings, IconMusic, IconDrum, IconAlign, IconSave, IconPlay,
  IconTerminal, IconBook, IconDownload, IconCopy, IconTrash,
  IconSearch, IconAlertCircle, IconAlertTriangle, IconInfo, IconCheck, IconX, IconMic, IconSliders
} from './Icons';
import {
  subscribeToLogs, clearLogs, downloadLogsAsFile, copyLogsToClipboard,
  type LogEntry
} from '../utils/logger';

export default function HelpPane() {
  const isHelpPaneVisible = useStore(s => s.isHelpPaneVisible);
  const setIsHelpPaneVisible = useStore(s => s.setIsHelpPaneVisible);
  const [activeTab, setActiveTab] = useState<'help' | 'console'>('help');
  const [activeSection, setActiveSection] = useState('getting_started');

  // Console monitor state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const consoleBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isHelpPaneVisible) return;
    const unsubscribe = subscribeToLogs((newLogs) => {
      setLogs(newLogs);
    });
    return unsubscribe;
  }, [isHelpPaneVisible]);

  useEffect(() => {
    if (activeTab === 'console' && autoScroll) {
      consoleBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab, autoScroll]);

  const errorCount = useMemo(() => logs.filter(l => l.level === 'error').length, [logs]);
  const warnCount = useMemo(() => logs.filter(l => l.level === 'warn').length, [logs]);
  const infoCount = useMemo(() => logs.filter(l => l.level === 'info' || l.level === 'log').length, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (levelFilter === 'error' && l.level !== 'error') return false;
      if (levelFilter === 'warn' && l.level !== 'warn') return false;
      if (levelFilter === 'info' && (l.level !== 'info' && l.level !== 'log')) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const msg = l.message.toLowerCase();
        const src = l.source.toLowerCase();
        const stack = (l.stack || '').toLowerCase();
        return msg.includes(query) || src.includes(query) || stack.includes(query);
      }
      return true;
    });
  }, [logs, levelFilter, searchQuery]);

  const handleCopy = async () => {
    const success = await copyLogsToClipboard();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isHelpPaneVisible) return null;

  const sections = [
    { id: 'getting_started', label: 'Getting Started', icon: <IconPlay size={14} /> },
    { id: 'top_bar', label: 'Top Bar & Navigation', icon: <IconAlign size={14} /> },
    { id: 'left_pane', label: 'Tracks & Instruments', icon: <IconMusic size={14} /> },
    { id: 'grid_canvas', label: 'Grid Canvas & Piano Roll', icon: <IconMusic size={14} /> },
    { id: 'automation_lanes', label: 'Automation & Modulation Lanes', icon: <IconSliders size={14} /> },
    { id: 'drum_sequencer', label: 'Drum Sequencer', icon: <IconDrum size={14} /> },
    { id: 'right_pane', label: 'Advanced Tools & Gen', icon: <IconSettings size={14} /> },
    { id: 'midi_editing_suite', label: 'Advanced MIDI Suite & Theory', icon: <IconMusic size={14} /> },
    { id: 'fx_rack', label: 'Audio Effects & FX Rack', icon: <IconSettings size={14} /> },
    { id: 'procedural_fx', label: 'Procedural Math FX', icon: <IconSettings size={14} /> },
    { id: 'engine_settings', label: 'Engine & Workstation Settings', icon: <IconSettings size={14} /> },
    { id: 'vocal_extract', label: 'Vocal Extraction', icon: <IconMusic size={14} /> },
    { id: 'scripting', label: 'Scripting & Automation', icon: <IconSettings size={14} /> },
    { id: 'export_save', label: 'Exporting & Persistence', icon: <IconSave size={14} /> },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: <IconAlign size={14} /> },
    { id: 'synth_lab', label: 'Synth & Drum Synthesis', icon: <IconMusic size={14} /> },
    { id: 'neural_ai', label: 'Neural AI Composer', icon: <IconPlay size={14} /> },
    { id: 'midi_remap', label: 'MIDI Import & Remap Lab', icon: <IconAlign size={14} /> },
    { id: 'stem_splitter_onnx', label: 'AI Stem Splitter & ONNX', icon: <IconSettings size={14} /> },
    { id: 'score_sheet_preview', label: 'Score & Sheet Music Preview', icon: <IconMusic size={14} /> },
    { id: 'tech_appendix', label: 'Technical Appendix & MPE', icon: <IconSettings size={14} /> },
    { id: 'scripting_examples', label: 'Scripting API Examples', icon: <IconSettings size={14} /> },
    { id: 'production_workflows', label: 'Production Workflows', icon: <IconPlay size={14} /> },
    { id: 'calibration_latency', label: 'Calibration & Latency Settings', icon: <IconSettings size={14} /> },
    { id: 'troubleshooting_faq', label: 'Troubleshooting & FAQ', icon: <IconAlign size={14} /> },
    { id: 'glossary_credits', label: 'Glossary, Credits & Licensing', icon: <IconSave size={14} /> },
    { id: 'vst3_hosting', label: 'VST3 Plugin Hosting', icon: <IconSettings size={14} /> },
    { id: 'drum_designer', label: 'Drum Designer Synthesis', icon: <IconDrum size={14} /> },
    { id: 'audio_recording', label: 'Audio Recording & Inputs', icon: <IconMic size={14} /> },
    { id: 'microtonal_edo', label: 'Microtonal Tuning & Scala', icon: <IconMusic size={14} /> },
    { id: 'system_console', label: 'System Console & Diagnostics', icon: <IconTerminal size={14} /> },
  ];

  const renderConsoleView = () => {

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Console Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '10px', padding: '12px 20px',
          background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}>
          {/* Level Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => setLevelFilter('all')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px',
                borderRadius: '6px', border: '1px solid',
                borderColor: levelFilter === 'all' ? '#4dabf7' : 'rgba(255,255,255,0.08)',
                background: levelFilter === 'all' ? 'rgba(77,171,247,0.15)' : 'rgba(255,255,255,0.02)',
                color: levelFilter === 'all' ? '#4dabf7' : '#aaa',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer'
              }}
            >
              <span>All</span>
              <span style={{ opacity: 0.7 }}>({logs.length})</span>
            </button>

            <button
              onClick={() => setLevelFilter('error')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px',
                borderRadius: '6px', border: '1px solid',
                borderColor: levelFilter === 'error' ? '#ff6b6b' : 'rgba(255,255,255,0.08)',
                background: levelFilter === 'error' ? 'rgba(255,107,107,0.15)' : 'rgba(255,255,255,0.02)',
                color: levelFilter === 'error' ? '#ff8787' : '#aaa',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer'
              }}
            >
              <IconAlertCircle size={12} color="#ff6b6b" />
              <span>Errors</span>
              <span style={{ opacity: 0.7 }}>({errorCount})</span>
            </button>

            <button
              onClick={() => setLevelFilter('warn')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px',
                borderRadius: '6px', border: '1px solid',
                borderColor: levelFilter === 'warn' ? '#fcc419' : 'rgba(255,255,255,0.08)',
                background: levelFilter === 'warn' ? 'rgba(252,196,25,0.15)' : 'rgba(255,255,255,0.02)',
                color: levelFilter === 'warn' ? '#ffd43b' : '#aaa',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer'
              }}
            >
              <IconAlertTriangle size={12} color="#fcc419" />
              <span>Warnings</span>
              <span style={{ opacity: 0.7 }}>({warnCount})</span>
            </button>

            <button
              onClick={() => setLevelFilter('info')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px',
                borderRadius: '6px', border: '1px solid',
                borderColor: levelFilter === 'info' ? '#74c0fc' : 'rgba(255,255,255,0.08)',
                background: levelFilter === 'info' ? 'rgba(116,192,252,0.15)' : 'rgba(255,255,255,0.02)',
                color: levelFilter === 'info' ? '#74c0fc' : '#aaa',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer'
              }}
            >
              <IconInfo size={12} color="#74c0fc" />
              <span>Info</span>
              <span style={{ opacity: 0.7 }}>({infoCount})</span>
            </button>
          </div>

          {/* Search box & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Search Input */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'rgba(0,0,0,0.3)', padding: '4px 10px',
              borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <IconSearch size={12} color="#777" />
              <input
                type="text"
                placeholder="Filter logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'transparent', border: 'none', color: '#fff',
                  fontSize: '11px', outline: 'none', width: '120px'
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: '#777', cursor: 'pointer', padding: 0 }}
                >
                  <IconX size={10} />
                </button>
              )}
            </div>

            {/* Copy Button */}
            <button
              onClick={handleCopy}
              title="Copy entire log to clipboard"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px',
                borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)',
                background: copied ? 'rgba(81,207,102,0.15)' : 'rgba(255,255,255,0.03)',
                color: copied ? '#51cf66' : '#ccc', fontSize: '11px', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              {copied ? <IconCheck size={12} color="#51cf66" /> : <IconCopy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            {/* Export File Button */}
            <button
              onClick={() => downloadLogsAsFile()}
              title="Save log file as .log text format"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px',
                borderRadius: '6px', border: '1px solid rgba(77,171,247,0.3)',
                background: 'rgba(77,171,247,0.12)', color: '#4dabf7',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              <IconDownload size={12} />
              <span>Save Log</span>
            </button>

            {/* Clear Button */}
            <button
              onClick={clearLogs}
              title="Clear all console logs"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 8px',
                borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)', color: '#888',
                fontSize: '11px', cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              <IconTrash size={12} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Console Log List */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 20px',
          background: '#090a0f', fontFamily: 'Consolas, "Fira Code", Monaco, monospace',
          fontSize: '12px', lineHeight: 1.55
        }} className="thin-scroll">
          {filteredLogs.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100%', minHeight: '300px', color: '#666', gap: '12px'
            }}>
              <IconCheck size={32} color="#51cf66" />
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#aaa' }}>
                No console messages recorded matching current criteria
              </div>
              <div style={{ fontSize: '11px', color: '#666' }}>
                Errors, warnings, and audio engine diagnostics will appear here automatically.
              </div>
            </div>
          ) : (
            filteredLogs.map(entry => {
              const isError = entry.level === 'error';
              const isWarn = entry.level === 'warn';
              const isInfo = entry.level === 'info';

              const badgeColor = isError ? '#ff8787' : isWarn ? '#ffd43b' : isInfo ? '#74c0fc' : '#adb5bd';
              const badgeBg = isError ? 'rgba(255,107,107,0.18)' : isWarn ? 'rgba(252,196,25,0.18)' : isInfo ? 'rgba(116,192,252,0.15)' : 'rgba(255,255,255,0.06)';
              const badgeBorder = isError ? 'rgba(255,107,107,0.3)' : isWarn ? 'rgba(252,196,25,0.3)' : 'transparent';

              return (
                <div
                  key={entry.id}
                  style={{
                    padding: '8px 10px',
                    marginBottom: '6px',
                    borderRadius: '6px',
                    background: isError ? 'rgba(255,107,107,0.04)' : isWarn ? 'rgba(252,196,25,0.03)' : 'rgba(255,255,255,0.015)',
                    borderLeft: `3px solid ${badgeColor}`,
                    borderTop: '1px solid rgba(255,255,255,0.03)',
                    borderRight: '1px solid rgba(255,255,255,0.03)',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {/* Timestamp */}
                    <span style={{ color: '#555', fontSize: '11px', userSelect: 'none' }}>
                      {entry.timestamp}
                    </span>

                    {/* Badge */}
                    <span style={{
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 700,
                      color: badgeColor,
                      background: badgeBg,
                      border: `1px solid ${badgeBorder}`,
                      letterSpacing: '0.5px'
                    }}>
                      {entry.level.toUpperCase()}
                    </span>

                    {/* Source */}
                    <span style={{ color: '#666', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(255,255,255,0.03)' }}>
                      {entry.source}
                    </span>
                  </div>

                  {/* Message */}
                  <div style={{
                    color: isError ? '#ffa8a8' : isWarn ? '#ffe066' : '#e1e4e8',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: '12px',
                    paddingLeft: '2px'
                  }}>
                    {entry.message}
                  </div>

                  {/* Stack trace if present */}
                  {entry.stack && (
                    <details style={{ marginTop: '4px', fontSize: '11px' }}>
                      <summary style={{ color: '#888', cursor: 'pointer', outline: 'none', userSelect: 'none' }}>
                        Stack Trace
                      </summary>
                      <pre style={{
                        marginTop: '6px',
                        padding: '8px 10px',
                        borderRadius: '4px',
                        background: 'rgba(0,0,0,0.4)',
                        color: '#aaa',
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                        border: '1px solid rgba(255,255,255,0.05)'
                      }}>
                        {entry.stack}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })
          )}
          <div ref={consoleBottomRef} />
        </div>

        {/* Console Footer Status */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 20px', background: 'rgba(255,255,255,0.02)',
          borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '11px', color: '#666'
        }}>
          <div>
            Showing {filteredLogs.length} of {logs.length} events
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Auto-scroll to latest</span>
          </label>
        </div>
      </div>
    );
  };

  return (

    <div className="animate-modal-bg" style={{
      position: 'fixed', inset: 0, background: 'rgba(8, 9, 14, 0.78)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 100000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px'
    }}>
      <div className="animate-modal-card" style={{
        width: '100%', maxWidth: '1060px', height: '100%', maxHeight: '820px',
        background: '#12131a', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '24px', display: 'flex', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.85)'
      }}>
        {/* Sidebar */}
        <div style={{
          width: '260px', background: 'rgba(255,255,255,0.02)', borderRight: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#fff', fontWeight: 800 }}>MuseGrid Help</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>Documentation & Diagnostics</p>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }} className="thin-scroll">
            {sections.map(sec => (
              <button
                key={sec.id}
                onClick={() => {
                  setActiveSection(sec.id);
                  if (activeTab !== 'help') setActiveTab('help');
                }}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 14px', marginBottom: '4px',
                  background: activeTab === 'help' && activeSection === sec.id ? 'rgba(77,171,247,0.15)' : 'transparent',
                  border: 'none', borderRadius: '8px', cursor: 'pointer',
                  color: activeTab === 'help' && activeSection === sec.id ? '#4dabf7' : '#aaa',
                  fontSize: '13px', fontWeight: activeTab === 'help' && activeSection === sec.id ? 700 : 500,
                  display: 'flex', alignItems: 'center', gap: '10px',
                  transition: 'all 0.2s'
                }}
              >
                {sec.icon} {sec.label}
              </button>
            ))}
          </div>

          {/* Quick Console Status in Sidebar Footer */}
          <div style={{
            padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', fontSize: '11px', color: '#888'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: errorCount > 0 ? '#ff6b6b' : '#51cf66'
              }} />
              <span>Console: {errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : 'Operational'}</span>
            </div>
            <button
              onClick={() => setActiveTab('console')}
              style={{
                background: 'none', border: 'none', color: '#4dabf7',
                cursor: 'pointer', fontSize: '11px', fontWeight: 600, padding: 0
              }}
            >
              Open
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          {/* Header Bar with Tab Splitter */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.02)'
          }}>
            {/* Tab Splitter: HELP and CONSOLE */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: 'rgba(0,0,0,0.3)', padding: '3px', borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              <button
                onClick={() => setActiveTab('help')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 14px', borderRadius: '6px', border: 'none',
                  background: activeTab === 'help' ? 'rgba(77,171,247,0.2)' : 'transparent',
                  color: activeTab === 'help' ? '#4dabf7' : '#888',
                  fontSize: '12px', fontWeight: activeTab === 'help' ? 700 : 500,
                  cursor: 'pointer', transition: 'all 0.15s ease'
                }}
              >
                <IconBook size={14} />
                <span>HELP</span>
              </button>

              <button
                onClick={() => setActiveTab('console')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 14px', borderRadius: '6px', border: 'none',
                  background: activeTab === 'console' ? 'rgba(77,171,247,0.2)' : 'transparent',
                  color: activeTab === 'console' ? '#4dabf7' : '#888',
                  fontSize: '12px', fontWeight: activeTab === 'console' ? 700 : 500,
                  cursor: 'pointer', transition: 'all 0.15s ease'
                }}
              >
                <IconTerminal size={14} />
                <span>CONSOLE</span>
                {errorCount > 0 ? (
                  <span style={{
                    background: '#e03131', color: '#fff', fontSize: '10px',
                    fontWeight: 700, padding: '1px 6px', borderRadius: '10px', lineHeight: 1.2
                  }}>
                    {errorCount}
                  </span>
                ) : (
                  <span style={{
                    background: 'rgba(255,255,255,0.08)', color: '#aaa', fontSize: '10px',
                    fontWeight: 600, padding: '1px 5px', borderRadius: '8px'
                  }}>
                    {logs.length}
                  </span>
                )}
              </button>
            </div>

            {/* Close Button */}
            <button
              onClick={() => setIsHelpPaneVisible(false)}
              title="Close"
              style={{
                width: '32px', height: '32px', background: 'rgba(255,255,255,0.05)',
                border: 'none', borderRadius: '50%', color: '#aaa', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s, color 0.15s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            >
              <IconX size={16} />
            </button>
          </div>

          {activeTab === 'help' ? (
          <div key={activeSection} style={{ flex: 1, overflowY: 'auto', padding: '40px', animation: 'contentFadeIn 0.25s ease-out forwards' }} className="thin-scroll">
            {activeSection === 'getting_started' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Getting Started with MuseGrid</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  Welcome to MuseGrid! This application is a fully-featured, browser-based digital audio workstation (DAW) and sequencer.
                  It allows you to compose music, draw melodies on a Piano Roll, sequence drums on a Step Sequencer, apply advanced procedural and standard audio effects, and export your final mix.
                </p>

                <div style={{ background: 'rgba(77,171,247,0.1)', borderLeft: '4px solid #4dabf7', padding: '15px', borderRadius: '4px', marginTop: '20px' }}>
                  <h3 style={{ margin: '0 0 10px', color: '#4dabf7' }}>The Basic Workflow</h3>
                  <ol style={{ margin: 0, paddingLeft: '20px', color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                    <li><strong>Create a Track</strong>: Use the Left Pane to create a Synth or Drum track.</li>
                    <li><strong>Draw Notes</strong>: Click on the main Grid Canvas to draw notes for a Synth, or use the Drum Sequencer to plot beats.</li>
                    <li><strong>Edit Settings</strong>: Expand the track in the Left Pane to change the synthesizer preset, adjust ADSR envelopes, or add Audio Effects (Delay, Reverb, EQ).</li>
                    <li><strong>Hit Play</strong>: Use the Play button at the top to hear your creation.</li>
                    <li><strong>Save & Export</strong>: Click 'Export Mix' at the top to save your music to your computer, or download the Project File (.muz) to save your work.</li>
                  </ol>
                </div>
              </div>
            )}

            {activeSection === 'top_bar' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Top Bar & Navigation</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>The Top Bar houses the main global controls for playback, tempo, and file management.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Playback & Tempo</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>PLAY / STOP</strong>: Starts and stops audio playback. Shortcut: Spacebar.</li>
                  <li><strong>BPM (Beats Per Minute)</strong>: The speed of your song. Click the number to type a new tempo.</li>
                  <li><strong>Align (Grid Icon)</strong>: Shifts the view of the grid so the playhead is perfectly visible on screen.</li>
                  <li><strong>Skip Back (Rewind Icon)</strong>: Immediately resets the playhead (the vertical playback line) back to the beginning (0:00).</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Playhead Follow Modes (Head vs Grid)</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Head</strong>: The grid remains still, and the playhead line moves across the screen from left to right.</li>
                  <li><strong>Grid</strong>: The playhead remains locked in the center of the screen, and the entire grid scrolls underneath it from right to left (useful for keeping your eyes fixed in one spot).</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Zoom Controls</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  Clicking <strong>Level Zoom</strong> allows you to click and drag horizontally on the grid background to stretch or squish the timeline.
                  You can also use the mouse wheel while holding <code>Shift</code> to scroll horizontally, or hold <code>Ctrl</code> to zoom in and out.
                  Use the <strong>Sync Zoom</strong> toggle to keep Synth and Drum zooming synchronized!
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>MIDI Recording</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Record</strong>: If you have a MIDI keyboard plugged in, click this to record what you play directly onto the active track.</li>
                  <li><strong>REP (Replace) vs OVR (Overdub)</strong>:
                    <br />- <strong>REP</strong> will erase existing notes in the track as you record over them.
                    <br />- <strong>OVR</strong> will layer your new recorded notes on top of the existing ones.
                  </li>
                </ul>
              </div>
            )}

            {activeSection === 'left_pane' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Left Pane (Tracks & Instruments)</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>The Left Pane manages all the instruments, audio routing, and track-level MIDI editing in your project.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Track Management</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Add Track</strong>: Click the "+" button at the top to add a new Synth or Drum track.</li>
                  <li><strong>Track Header</strong>: Shows the track name, color, Volume slider, Pan slider (Left/Right audio balance), Mute (M), and Solo (S) buttons.</li>
                  <li><strong>Right-Click Track Menu</strong>: Rename, Delete, Duplicate, or Import MIDI/Audio for the track.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Advanced MIDI Editing Suite</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>The <strong>Edit</strong> subpanel provides a comprehensive piano roll manipulation center with 6 specialized drawers:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Quick Tools</strong>: Legato (Ctrl+L), Strum (Alt+S), Flam Grace note, Glue (Ctrl+G), Dice @ Grid, and Overlap cleaner. Includes a Micro-Nudge toolbar (±1t, ±6t).</li>
                  <li><strong>Chop & Arpeggiator</strong>: Subdivides notes into straight, triplet, dotted, and progressive trap rolls (Accelerando/Decelerando) with gate control, plus a multi-pattern Arpeggiator (Up, Down, Up/Down, Down/Up, Converge, Diverge, Random).</li>
                  <li><strong>Pitch & 32 World Scales</strong>: Octave (±12) and Semitone (±1) transposition, Modal Transpose across scale degrees, Force-to-Scale key quantizer, Diatonic Harmonizer (triads, 7ths, 3rds, 5ths, power chords), and Chord Inversions. <em>(Automatically hidden when a Drum track is selected)</em>.</li>
                  <li><strong>Dynamics & Velocity</strong>: Velocity presets (pp to ff), Normalize Peak, Velocity Ramp with Linear, Exponential, Logarithmic, and S-Curve shapes, plus Dynamics Compressor.</li>
                  <li><strong>Humanize & Flip</strong>: Expressive Humanizer (Alt+R) with organic jitter, Time Reverse (Alt+Y), Pitch Invert, and Time Stretch (Double/Half time).</li>
                  <li><strong>Selection & Cleanup</strong>: Filter Odd/Even notes (great for hi-hat accents), isolate Top-Line melody or Bassline voices, and purge micro-notes below 12 ticks.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Chord Assist & Progression Lab</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Generate harmonic beds and voicings directly onto your active synth track with complete musical freedom:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Full Octave & Root Freedom</strong>: Select any root note (C through B) and any octave (C1 through C7) — no longer restricted to a single fixed pitch!</li>
                  <li><strong>1-Click Genre Chord Progressions</strong>: Instantly generates authentic chord progressions for Pop Anthem (I-V-vi-IV), Neo-Soul / Lo-Fi (ii9-V13-Imaj9-VI7alt), Dark Trap (i-VI-VII-v), Cinematic Epic (i-VI-III-VII), Anime Royal Road (IVmaj7-V7-iii7-vi), and Andalusian Cadence (i-VII-VI-V).</li>
                  <li><strong>Auto-Chords & Auto-Bass</strong>: Generates separate accompaniment tracks matching the active progression.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Synth & Drum Inspector</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Clicking on a track header expands its settings:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Synth Settings</strong>: Oscillator waveforms (Sine, Square, Sawtooth, Triangle), ADSR Envelope, Lowpass Filter (Cutoff and Resonance).</li>
                  <li><strong>Drum Settings</strong>: Drum kit presets and physical modeling parameters (decay, tension, pitch drop) for Kick, Snare, and Hi-hats.</li>
                  <li><strong>Target BPM</strong>: Force this specific track to play at a different speed than the global BPM.</li>
                </ul>
              </div>
            )}

            {activeSection === 'grid_canvas' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Grid Canvas & Piano Roll</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>This is where you compose your music, visualize notes, and orchestrate the arrangement.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Drawing & Editing Notes</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Draw Mode (Pencil / B)</strong>: Click on the grid to place a note. Click and drag edges to resize.</li>
                  <li><strong>Erase Mode (Eraser / E)</strong>: Click a note to delete it.</li>
                  <li><strong>Select Mode (Cursor / V)</strong>: Box-select or lasso multiple notes. Drag to move or delete together.</li>
                  <li><strong>Slice Mode (Knife / C)</strong>: Click and drag vertically across notes to slice them cleanly.</li>
                  <li><strong>Timeline Region Selection (Ruler Header)</strong>: Click and drag along the top ruler header to highlight a time range across all tracks (or single track). A floating action bar appears with quick actions to Duplicate, Mute/Unmute, Split, Quantize, or Delete notes in the selected span.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Ghost Notes Suite & Track Jumping</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Compose counter-melodies and harmonies with full visual reference of your arrangement:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Ghost Notes Toggle & Opacity</strong>: Enable Ghost Notes in Left Pane Display Preferences. Adjust the opacity slider (10% to 60%) to make background notes as subtle or visible as you prefer.</li>
                  <li><strong>Cross-Instrument Ghost Guides</strong>:
                    <br />- When viewing a Synth Piano Roll, subtle rhythm tick markers appear along the timeline corresponding to Drum triggers.
                    <br />- When viewing the Drum Sequencer, translucent guide bars show where Synth notes trigger, allowing you to lock in the groove.
                  </li>
                  <li><strong>Ghost Track Quick Jump</strong>: Double-click any ghost note directly on the canvas to instantly switch your active track focus to that note's track!</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Advanced Grid Controls (Bottom Panel)</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Snap (Magnet)</strong>: When enabled, notes snap cleanly to grid divisions (1/4 down to 1/64, triplets, dotted).</li>
                  <li><strong>Scale Lock (32 World Scales)</strong>: Choose a Key and Scale from 32 world traditions (Arabic Maqamat, Indian Ragas, Japanese Koto, Western Modes). Correct notes are highlighted in glowing green.</li>
                  <li><strong>Auto-Extend Grid</strong>: Placing notes near the end automatically lengthens the canvas.</li>
                </ul>
              </div>
            )}

            {activeSection === 'drum_sequencer' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Drum Sequencer & Physical Models</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>When you select a Drum Track, MuseGrid seamlessly switches into the Drum Step Sequencer matrix.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Dual-Grid Architecture & Context Sensitivity</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Grid Separation</strong>: Synths use the chromatic 128-key Piano Roll; Drum tracks use the specialized Percussion Matrix.</li>
                  <li><strong>Context-Aware Editing</strong>: When a drum track is active, tonal tools (Scale Lock, Chords, Harmonizer, Inversions) automatically hide to eliminate clutter, and drum-specific tools are highlighted.</li>
                  <li><strong>Active Track Scoping</strong>: All MIDI edits strictly affect only the active track.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Trap Ratchets & Rolls</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Ratchets (2x - 12x)</strong>: Subdivide any drum hit into rapid hi-hat or snare rolls with one click.</li>
                  <li><strong>Velocity Dynamics</strong>: Choose Flat, Crescendo (gradual swell), or Decrescendo (fade out) dynamic profiles.</li>
                  <li><strong>Micro-Nudge (±1t, ±6t)</strong>: Nudge drum triggers by subtle sub-grid tick amounts to dial in unquantized groove and pocketing.</li>
                </ul>
              </div>
            )}

            {activeSection === 'automation_lanes' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Automation & Modulation Lanes</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  MuseGrid features a multi-target automation engine with continuous curve interpolation and concurrent multi-parameter execution.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Accessing the Automation Drawer</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Toggle Lane</strong>: Click the <strong>Automation</strong> button in the bottom panel beneath the Piano Roll or Drum matrix.</li>
                  <li><strong>Target Selector</strong>: Use the dropdown in the automation toolbar to choose which parameter to draw and edit.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Supported Automation Targets</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Velocity (Vel)</strong>: Controls note strike strength and initial dynamic response (0 to 127).</li>
                  <li><strong>Volume (Vol)</strong>: Continuous audio gain scaling across the track timeline.</li>
                  <li><strong>Pan (L/R)</strong>: Stereo field placement from 100% Left (-1.0) to Center (0.0) to 100% Right (+1.0).</li>
                  <li><strong>Filter Cutoff (Hz)</strong>: Sweeps lowpass and resonant filter frequencies dynamically during note playback.</li>
                  <li><strong>Pitch Bend / Glides</strong>: Microtonal pitch modulation across notes.</li>
                  <li><strong>Expression & Dynamics</strong>: Polyphonic expression and timbre modulations.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Drawing & Editing Points</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Add Point</strong>: Click anywhere on the automation canvas to create a new control point at that tick and value.</li>
                  <li><strong>Move Point</strong>: Click and drag any existing point to adjust its timing or value.</li>
                  <li><strong>Delete Point</strong>: Right-click or double-click a point to remove it.</li>
                  <li><strong>Clear Active Curve</strong>: Click the <strong>Clear</strong> button to wipe all points for the selected parameter while preserving other automation curves.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Concurrent Multi-Parameter Curves</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  Each track maintains independent, non-destructive automation curves for every parameter simultaneously. For instance, you can combine a rising Volume swell with a panning sweep and a filter cutoff drop—all evaluated concurrently during playback, stem bounce, and native C++ rendering.
                </p>
              </div>
            )}

            {activeSection === 'right_pane' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Note Inspector & Advanced Tools (Right Pane)</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>The Right Pane contains note-level MPE controls, real-time harmonic analysis, and generative matrix algorithms.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Real-Time Chord Detective & Scale Degree Analyzer</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>When you select multiple notes on a synth track, the live Harmonic Inspector instantly detects and displays:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Full Chord Name</strong>: Identifies exact chords such as C, Am7, G9, F#dim, Bbaug, Dsus4, and slash chords like C / E.</li>
                  <li><strong>Inversion Analysis</strong>: Identifies Root Position, 1st Inversion, 2nd Inversion, 3rd Inversion, or Open Voicing based on the lowest sounding bass note.</li>
                  <li><strong>Scale Degree Roman Numerals</strong>: Analyzes the chord root relative to the project key (e.g. I, ii, IV, vi, or b7 Altered).</li>
                  <li><strong>Drum Voice Distribution</strong>: On drum tracks, switches to a percussion hit breakdown (e.g. Kick: 8, Snare: 4, Closed Hat: 16).</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Note Inspector Actions</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Ratchets & Rolls (2x - 12x)</strong>: Subdivide selected notes into fast rolls with Flat, Crescendo, or Decrescendo velocity curves.</li>
                  <li><strong>Sub-Grid Micro-Nudge (±1t, ±6t)</strong>: Pocket selected notes forward or backward by minute tick offsets.</li>
                  <li><strong>MPE Pitch Glides</strong>: Add smooth exponential glides or stepped glissandos up to ±24 semitones.</li>
                  <li><strong>Filter Sweeps & Vibrato</strong>: Automate note-level cutoff sweeps and vibrato wobbles.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Generative Matrix</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Euclidean Rhythm</strong>: Mathematically generates evenly spaced rhythmic pulses across steps.</li>
                  <li><strong>Cellular Automata</strong>: Generates evolving algorithmic melodies based on Conway's Game of Life.</li>
                </ul>
              </div>
            )}

            {activeSection === 'midi_editing_suite' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Advanced MIDI Editing & Music Theory</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  MuseGrid features a comprehensive MIDI manipulation suite combined with an expansive 32-scale world music theory engine.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>32 World, Maqam, Raga & Modal Scales</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Unlock rich melodic traditions from across the globe in Scale Lock, Modal Transpose, and the Harmonizer:</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <strong style={{ color: '#69db7c', fontSize: '12px' }}>Middle Eastern & Maqamat</strong>
                    <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                      <li><strong>Arabic Hijaz</strong>: Phrygian Dominant (0, 1, 4, 5, 7, 8, 10)</li>
                      <li><strong>Arabic Bayati</strong>: Modal Bayati (0, 2, 3, 5, 7, 8, 10)</li>
                      <li><strong>Arabic Saba</strong>: Melancholic quarter-tone feel (0, 1, 3, 4, 7, 8, 10)</li>
                      <li><strong>Arabic Rast</strong>: Diatonic Rast foundation (0, 2, 4, 5, 7, 9, 11)</li>
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <strong style={{ color: '#4dabf7', fontSize: '12px' }}>Indian Classical Ragas</strong>
                    <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                      <li><strong>Raga Bhairav</strong>: Morning solemnity (0, 1, 4, 5, 7, 8, 11)</li>
                      <li><strong>Raga Yaman</strong>: Kalyan evening beauty (0, 2, 4, 6, 7, 9, 11)</li>
                      <li><strong>Raga Todi</strong>: Deep meditative tension (0, 1, 3, 6, 7, 8, 11)</li>
                      <li><strong>Raga Kafi</strong>: Spring folk / Dorian (0, 2, 3, 5, 7, 9, 10)</li>
                      <li><strong>Raga Bhupali</strong>: Pure pentatonic (0, 2, 4, 7, 9)</li>
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <strong style={{ color: '#ffd43b', fontSize: '12px' }}>East Asian & Japanese</strong>
                    <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                      <li><strong>Japanese Hirajoshi</strong>: Traditional koto (0, 2, 3, 7, 8)</li>
                      <li><strong>Japanese Insen</strong>: Shamisen tuning (0, 1, 5, 7, 10)</li>
                      <li><strong>Japanese Kumoi</strong>: Melancholic pentatonic (0, 2, 3, 7, 9)</li>
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <strong style={{ color: '#ff6b6b', fontSize: '12px' }}>Mediterranean & Exotic</strong>
                    <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                      <li><strong>Hungarian Minor</strong>: Gypsy / Double Harmonic (0, 2, 3, 6, 7, 8, 11)</li>
                      <li><strong>Spanish 8-Tone</strong>: Flamenco 8-tone scale (0, 1, 3, 4, 5, 6, 8, 10)</li>
                      <li><strong>Whole Tone</strong>: Dreamlike Debussy impressionism (0, 2, 4, 6, 8, 10)</li>
                      <li><strong>Octatonic</strong>: Half-Whole & Whole-Half diminished jazz</li>
                      <li><strong>Enigmatic & Prometheus</strong>: Verdi & Scriabin mystic scales</li>
                    </ul>
                  </div>
                </div>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Signature Piano Roll Tools</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Strummer (Alt+S)</strong>: Realistic chord strumming with tension acceleration curves, stroke direction (Up/Down/Alternate), and velocity ramps.</li>
                  <li><strong>Chopper (Alt+U)</strong>: Slices notes by grid divisions (1/4 to 1/64, triplets, dotted) or progressive trap rolls.</li>
                  <li><strong>Humanizer (Alt+R)</strong>: Injects natural micro-timing jitter, velocity variation, duration humanization, and scale-conformed pitch wander.</li>
                  <li><strong>Time Reverse (Alt+Y)</strong>: Retrograde reflection of note patterns across time.</li>
                  <li><strong>Pitch Inversion</strong>: Mirrors melodies across the vertical harmonic center axis.</li>
                  <li><strong>Harmonizer & Inversions</strong>: Generates diatonic 3rds, 5ths, triads, and 7ths, or transposes chords through 1st, 2nd, and 3rd inversions.</li>
                </ul>
              </div>
            )}

            {activeSection === 'fx_rack' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Audio Effects Rack</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Inside the expanded Track Inspector (Left Pane), you will find the FX RACK. This allows you to add standard audio effects to your instrument.</p>

                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>EQ (Equalizer)</strong>: Boost or cut Low, Mid, and High frequencies.</li>
                  <li><strong>Distortion</strong>: Adds grit and saturation. Adjust 'Amount' for intensity and 'Mix' for how much distorted signal blends with the clean signal.</li>
                  <li><strong>Chorus</strong>: Duplicates the sound and slightly detunes it to create a thick, swirling, stereo-widening effect.</li>
                  <li><strong>Phaser</strong>: Creates a sweeping, sweeping sci-fi filter effect.</li>
                  <li><strong>Delay</strong>: Creates echoes. 'Time' is the speed of echoes, 'Feedback' is how many echoes occur before fading out.</li>
                  <li><strong>Reverb</strong>: Simulates the sound of playing in a physical room or massive hall. 'Decay' makes the room sound bigger, 'PreDelay' separates the dry sound from the echo.</li>
                </ul>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  <strong>Important</strong>: Audio flows from top to bottom. You can drag and drop effects in the list to change their order. (e.g., Distortion before Reverb sounds completely different than Reverb before Distortion).
                </p>
              </div>
            )}

            {activeSection === 'procedural_fx' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Procedural Math FX Engine</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>The Procedural FX Engine allows you to automate any parameter in the FX Rack using math! It is meant for extreme sound design and glitch effects.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>How to use it</h3>
                <ol style={{ margin: 0, paddingLeft: '20px', color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li>Open the FX Rack on a track and click the "MATH" button next to any parameter (like Delay Time or Distortion Amount).</li>
                  <li>Type a mathematical formula into the box.</li>
                  <li>Ensure the <strong>Procedural FX Engine</strong> is enabled globally (in the Studio Settings at the bottom left of the screen).</li>
                </ol>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Writing Formulas</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Your formula must return a number. You can use these variables:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><code>t</code>: The current time in seconds.</li>
                  <li><code>b</code>: The current beat number (e.g., 1, 2, 3, 4).</li>
                  <li><code>m</code>: The current measure/bar number.</li>
                  <li><code>ticks</code>: The raw internal tick counter.</li>
                  <li><code>sampleRate</code>: The audio sample rate (e.g., 44100). Essential for time/frequency math!</li>
                  <li><code>currentTime</code>: The exact audio context time in seconds.</li>
                  <li><code>v</code>: In a <strong>Live Equation Lane</strong>, the lane's own drawn value at that moment, so an equation can shape what you drew instead of replacing it.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Live Equation Lanes (Automation)</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  Every track lane can be driven by an equation instead of only hand-drawn points. Turn on
                  <strong> Live Equation Lane</strong> in the left panel's <em>Automation (Procedural)</em> section. Nothing is baked:
                  the lane is read live during playback and again, sample-accurately, during export, so preview and bounce always match.
                </p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li>The lane always works in <strong>0–127 lane space</strong>; the target decides what that number means.</li>
                  <li><strong>Override / Add / Multiply</strong> combine the equation with the drawn points, exactly like the FX modulators.</li>
                  <li>Targets: Velocity, Volume, Pan, any <strong>VST3 parameter</strong>, and the per-note expression parameters
                    <em> Filter cutoff, Vibrato depth, Vibrato rate, Tremolo depth, Tremolo rate, Detune, Glide amount</em>.</li>
                  <li>Filter cutoff is followed <strong>continuously inside each note</strong> — the lane's own shape is fed to the engine's
                    per-sample filter curve. Vibrato, tremolo, detune and glide are taken once per note, at the note's centre, the same way velocity has always behaved.</li>
                  <li>A formula lane needs no drawn points. Turning it off returns the lane to the points you drew, untouched.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Advanced Math & Optimization (For DSP Nerds)</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Want to write high-performance C++ level DSP in JavaScript? Follow these competitive programming rules:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Bitwise Math</strong>: Instead of <code>Math.floor(x)</code>, use <code>x | 0</code>. It is significantly faster. Instead of <code>index % 65536</code>, use <code>index & 65535</code> for circular buffers.</li>
                  <li><strong>Zero Garbage Collection</strong>: Never allocate new objects or arrays inside your formula. If you need a buffer, pre-allocate a <code>Float32Array</code> in your <code>state</code> object!</li>
                  <li><strong>Monomorphism</strong>: Keep your variable types strict. If <code>x = 0.0</code>, do not change it to a boolean or string later. This allows the V8 engine to JIT compile your code to raw machine instructions.</li>
                </ul>
              </div>
            )}

            {activeSection === 'engine_settings' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Engine & Workstation Settings</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>The "Studio Settings" (gear icon) and "Manage Settings" sections at the bottom left give you deep control over MuseGrid's behavior.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Global Engine Configurations</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Audio Sample Rate</strong>: Select between 44100 Hz, 48000 Hz, 88200 Hz, or 96000 Hz depending on your hardware limits and latency preferences. Requires a page reload.</li>
                  <li><strong>Master Limiter</strong>: Prevents the global output from clipping above 0dB. Turn this off for pure dynamic range (at the risk of distortion).</li>
                  <li><strong>Metronome</strong>: Toggles a click-track to help you record on beat.</li>
                  <li><strong>Play Full Note on Pause</strong>: If enabled, stopping playback will still allow the current notes to decay naturally. If disabled, notes cut off immediately.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Groove & Deduplication Engine</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Global Swing</strong>: Skews every off-beat note late by a certain percentage, creating a "bouncing" or "shuffling" feel.</li>
                  <li><strong>Groove Timing / Velocity Strength</strong>: Introduces humanized micro-imperfections in timing and velocity across the grid so it doesn't sound robotic.</li>
                  <li><strong>Note Deduplication Engine</strong>: MuseGrid actively protects against double-triggered notes. You can configure the "Proximity Tolerance" (how close notes must be to be considered duplicates) and "Overlap Threshold".</li>
                </ul>
              </div>
            )}

            {activeSection === 'vocal_extract' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Vocal Extraction (Spleeter)</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>MuseGrid features an integrated AI stem separation tool.</p>

                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>How it works</strong>: Drop any full audio file (MP3/WAV) into the Vocal Extractor panel on the right.</li>
                  <li><strong>Processing</strong>: It runs an AI model entirely in your browser using TensorFlow.js (meaning no audio is sent to the cloud). It isolates the vocals from the instruments.</li>
                  <li><strong>Results</strong>: You will get two new files: an "Acappella" (vocals only) and an "Instrumental" (music only) track or 4 tracks depending on the model settings (2-stem vs 4-stem). These can then be used in the timeline via the Audio to Midi Modal!</li>
                </ul>
              </div>
            )}

            {activeSection === 'scripting' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Scripting & Automation</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>MuseGrid features a powerful JavaScript Scripting Engine (Monaco Editor) that allows you to automate tasks, generate algorithmic music, register custom DSP instruments, and perform batch exports.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Global Variables</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>The Scripting Engine injects three global objects directly into your script environment:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><code>MuseState</code>: The live application state (a Zustand store). Contains all tracks, notes, global settings, and mutation functions.</li>
                  <li><code>Muse</code>: The ScriptAPI helper object containing utility functions like <code>Muse.exportAudio</code>, <code>Muse.fx</code>, and <code>Muse.audioEngine</code>.</li>
                  <li><code>Tone</code>: The full Tone.js library, useful for writing custom DSP and complex audio routing.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Understanding <code>MuseState</code> (The Core API)</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Because MuseGrid is reactive, any mutation function you call on <code>MuseState</code> instantly updates the DAW UI and audio engine. <strong>Do not mutate arrays directly</strong>; always use the provided setter functions!</p>
                
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '15px' }}>
                  <h4 style={{ margin: '0 0 10px', color: '#fff' }}>Read-Only Properties (State)</h4>
                  <ul style={{ color: '#ccc', lineHeight: 1.6, fontSize: '13px', margin: 0 }}>
                    <li><code>MuseState.tracks</code>: Array of track objects. Key properties: <code>id, name, instrument, volume, pan, muted, soloed, synthPreset, drumKit</code>.</li>
                    <li><code>MuseState.notes</code>: Array of all notes across all tracks. Key properties: <code>id, trackId, time (ticks), duration (ticks), pitch (0-127), velocity (0-1)</code>.</li>
                    <li><code>MuseState.bpm</code>: Current tempo.</li>
                    <li><code>MuseState.isPlaying</code>: Boolean indicating playback state.</li>
                    <li><code>MuseState.loopEnabled, loopStart, loopEnd</code>: Transport loop bounds in ticks (1 beat = 192 ticks).</li>
                  </ul>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '15px' }}>
                  <h4 style={{ margin: '0 0 10px', color: '#fff' }}>Mutation Functions (Actions)</h4>
                  <ul style={{ color: '#ccc', lineHeight: 1.6, fontSize: '13px', margin: 0 }}>
                    <li><code>MuseState.addNote(note)</code>: Adds a single note. Requires a unique string <code>id</code>.</li>
                    <li><code>MuseState.removeNote(id)</code>: Deletes a note by ID.</li>
                    <li><code>MuseState.updateNote(id, updates)</code>: Patches a note (e.g. <code>{"{ pitch: 60 }"}</code>).</li>
                    <li><code>MuseState.clearTrackNotes(trackId)</code>: Wipes all notes from a specific track.</li>
                    <li><code>MuseState.addTrack(track)</code>: Adds a new track object.</li>
                    <li><code>MuseState.updateTrack(id, updates)</code>: Modifies track parameters like volume, name, or FX.</li>
                    <li><code>MuseState.setBpm(bpm)</code>: Changes the global tempo.</li>
                    <li><code>MuseState.setIsPlaying(boolean)</code>: Starts/stops the transport.</li>
                    <li><code>MuseState.showToast(message, type)</code>: Displays a UI notification. Types: <code>'success', 'info', 'error'</code>.</li>
                  </ul>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '15px' }}>
                  <h4 style={{ margin: '0 0 10px', color: '#69db7c' }}>MIDI Editing Suite API (<code>Muse.editor</code>)</h4>
                  <p style={{ color: '#aaa', fontSize: '12px', margin: '0 0 8px' }}>All methods operate strictly on the active track (selected notes, or all track notes if none selected):</p>
                  <ul style={{ color: '#ccc', lineHeight: 1.6, fontSize: '13px', margin: 0 }}>
                    <li><code>Muse.editor.ratchet(slices, velocityProfile?)</code>: Subdivides notes into 2x-12x ratchets with 'flat', 'crescendo', or 'decrescendo' dynamics.</li>
                    <li><code>Muse.editor.microNudge(ticks)</code>: Shifts notes in time by exact sub-grid ticks (e.g. +6, -1) for human groove.</li>
                    <li><code>Muse.editor.strum(direction?, spreadTicks?)</code>: Strum chord notes with micro-delays ('up' or 'down').</li>
                    <li><code>Muse.editor.legato()</code>: Stretches note durations to eliminate gaps.</li>
                    <li><code>Muse.editor.flam(offsetTicks?)</code>: Generates grace note double triggers.</li>
                    <li><code>Muse.editor.glue()</code>: Merges contiguous same-pitch notes.</li>
                    <li><code>Muse.editor.dice(slices?)</code>: Slices notes across grid divisions.</li>
                    <li><code>Muse.editor.removeOverlaps()</code>: Shortens notes to eliminate overlapping collisions on the same pitch.</li>
                    <li><code>Muse.editor.chop(divisionTicks?)</code>: Chops notes by tick resolution (48 = 1/16, 24 = 1/32).</li>
                    <li><code>Muse.editor.arpeggiate(options?)</code>: Converts chords into arpeggios ('up', 'down', 'upDown', 'converge', 'diverge', 'random').</li>
                    <li><code>Muse.editor.modalTranspose(steps)</code>: Transposes notes by scale degree steps within the project key.</li>
                    <li><code>Muse.editor.forceToScale()</code>: Conforms all chromatic notes to the nearest valid scale pitch.</li>
                    <li><code>Muse.editor.harmonize(type)</code>: Adds parallel harmonies ('triad', 'seventh', 'third', 'fifth', 'powerChord', 'octaveUp', 'octaveDown').</li>
                    <li><code>Muse.editor.invertChord(direction?)</code>: Inverts chords ('up' transposes lowest note +12; 'down' transposes highest note -12).</li>
                    <li><code>Muse.editor.velocityRamp(start?, end?, curve?)</code>: Smooth velocity swells with 'linear', 'exponential', 'logarithmic', or 'sCurve'.</li>
                    <li><code>Muse.editor.velocityCompress(target?, ratio?)</code>: Compresses dynamic range towards target velocity.</li>
                    <li><code>Muse.editor.velocityNormalize(peak?)</code>: Scales velocities so the loudest note reaches peak (default 127).</li>
                    <li><code>Muse.editor.fixedVelocity(vel?)</code>: Sets all notes to an exact velocity.</li>
                    <li><code>Muse.editor.humanize(options?)</code>: Adds organic timing, velocity, duration, and pitch jitter.</li>
                    <li><code>Muse.editor.timeStretch(multiplier)</code>: Stretches or compresses timing (0.5 = 2x speed, 2.0 = half speed).</li>
                    <li><code>Muse.editor.flipHorizontal()</code>: Reverses notes chronologically across selection bounding box.</li>
                    <li><code>Muse.editor.flipVertical()</code>: Mirrors pitches across the center axis.</li>
                    <li><code>Muse.editor.purgeShortNotes(minTicks?)</code>: Removes micro-notes below tick threshold (default 12t).</li>
                    <li><code>Muse.editor.filterOddEven(keep)</code>: Selects alternating 'odd' or 'even' notes.</li>
                    <li><code>Muse.editor.filterVoice(voice)</code>: Selects 'top' melody voice or 'bottom' bass voice.</li>
                    <li><code>Muse.editor.generateProgression(style, root?, octave?, startTick?)</code>: Generates a complete genre progression ('popAnthem', 'neoSoul', 'darkTrap', 'cinematic', 'animeRoyal', 'andalusian').</li>
                    <li><code>Muse.editor.detectChord()</code>: Analyzes and returns root, quality, inversion, and full name of selected notes.</li>
                  </ul>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '15px' }}>
                  <h4 style={{ margin: '0 0 10px', color: '#4dabf7' }}>Music Theory & Analysis API (<code>Muse.midi</code>)</h4>
                  <ul style={{ color: '#ccc', lineHeight: 1.6, fontSize: '13px', margin: 0 }}>
                    <li><code>Muse.midi.detectChord(pitches)</code>: Analyzes pitch array and returns chord name, quality, inversion, and bass note.</li>
                    <li><code>Muse.midi.detectScaleDegree(rootPc, scaleRoot?, scaleMode?)</code>: Returns Roman numeral degree (e.g. 'I', 'vi', 'b7 (Altered)').</li>
                    <li><code>Muse.midi.getProgressions()</code>: Returns dictionary of all 6 genre chord progressions with step offsets.</li>
                    <li><code>Muse.midi.getScales()</code>: Returns array of all 32 world, microtonal, maqam, raga, and modal scale names.</li>
                  </ul>
                </div>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Example: Generative Arpeggiator Script</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>This script clears the first track, generates a random C Minor arpeggio over 4 bars, and plays it:</p>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`// 1. Get the first synth track
const track = MuseState.tracks.find(t => t.instrument === 'synth');
if (!track) throw new Error("No synth track found!");

// 2. Clear existing notes
MuseState.clearTrackNotes(track.id);

// 3. Define C Minor Pentatonic Scale MIDI values (C4 = 60)
const cMinorPent = [60, 63, 65, 67, 70, 72, 75];

// 4. Generate 4 bars of 16th notes (4 bars * 16 notes = 64 notes)
// 1 beat = 192 ticks. 16th note = 192 / 4 = 48 ticks.
const stepSize = 48; 

for (let i = 0; i < 64; i++) {
  // Randomly skip some notes for a groovier rhythm
  if (Math.random() > 0.8) continue;

  const randomPitch = cMinorPent[Math.floor(Math.random() * cMinorPent.length)];
  
  MuseState.addNote({
    id: 'gen-note-' + i + '-' + Date.now(),
    trackId: track.id,
    time: i * stepSize,
    duration: stepSize * (Math.random() > 0.5 ? 1 : 0.5), // Short or long staccato
    pitch: randomPitch,
    velocity: 64 + Math.floor(Math.random() * 63) // Random velocity between 64 and 127
  });
}

MuseState.showToast('Generated C Minor Arpeggio!', 'success');
MuseState.setBpm(110);
Muse.audioEngine.stop(); // Reset transport
setTimeout(() => {
  if (!MuseState.getState().isPlaying) Muse.audioEngine.togglePlay();
}, 100);`}
                </pre>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Non-Causal Offline FX</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Realtime Custom FX process small audio blocks as they arrive, so they cannot truly hear future audio. For pre-echo, reverse-style effects, and other non-causal processing, create an <strong>Offline Buffer FX</strong>. These cards use the same track-rack sliders, but run during WAV/MP3 export with access to the full rendered track buffer.</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><code>input</code> and <code>output</code> are full-length <code>Float32Array[]</code> channel buffers.</li>
                  <li><code>params</code> contains the slider/text values from the track card.</li>
                  <li><code>sampleRate</code>, <code>duration</code>, and <code>context</code> expose render timing, track, notes, project range, and FX metadata.</li>
                  <li>Offline Buffer FX are export-only; realtime playback passes through them without adding latency.</li>
                </ul>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`const effectId = Muse.fx.createOfflineEffect({
  id: 'my-pre-echo',
  name: 'My Pre-Echo',
  params: [
    { name: 'wet', label: 'Wet', min: 0, max: 1, defaultVal: 0.35 },
    { name: 'preDelay', label: 'Pre Echo', min: 0.01, max: 2, defaultVal: 0.25 }
  ],
  code: \`const wet = params.wet ?? 0.35;
const offset = Math.floor((params.preDelay ?? 0.25) * sampleRate);
for (let ch = 0; ch < input.length; ch++) {
  for (let i = 0; i < input[ch].length; i++) {
    const future = i + offset < input[ch].length ? input[ch][i + offset] : 0;
    output[ch][i] = input[ch][i] + future * wet;
  }
}\`
});

Muse.fx.addCustomEffectToTrack(MuseState.activeTrackId, effectId);`}
                </pre>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Example: Custom DSP Injection</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Write your own audio engine using Tone.js and attach it to a track. It will automatically serialize into your project file!</p>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`class MyFatSynth extends Tone.Synth {
  constructor(options) {
    super(options);
    this.oscillator.type = 'fatsawtooth';
    this.oscillator.count = 3;
    this.oscillator.spread = 20;
    this.envelope.attack = 0.05;
    this.envelope.release = 1.2;
  }
}

// Register it with the engine
Muse.audioEngine.registerCustomSynth('my-fat-synth', MyFatSynth);

// Assign it to the first track
const track = MuseState.tracks[0];
MuseState.updateTrack(track.id, { 
  synthPreset: 'scripted', 
  scriptedDspId: 'my-fat-synth' 
});

MuseState.showToast('Custom DSP Registered!', 'success');`}
                </pre>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Example: Batch Audio Export Loop</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Automate high-speed rendering of multiple pitch variations to generate a sample pack. (Check your downloads folder after running!)</p>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`MuseState.showToast('Starting Batch Render...', 'info');

const offsets = [-12, 0, 12]; // Render sub, normal, and high octave
const format = 'mp3'; // or 'wav'

for (const offset of offsets) {
  const filename = \`render_octave_\${offset}.\${format}\`;
  
  await Muse.exportAudio(filename, { 
    format: format,
    semitoneOffset: offset,
    normalize: true
  });
}

MuseState.showToast('Batch Render Complete!', 'success');`}
                </pre>
              </div>
            )}

            {activeSection === 'export_save' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Exporting, Saving, and Persistence</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>How to manage your projects and configurations.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Saving Projects (.muz)</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li>Click <strong>Save</strong> in the Top Bar to save the project as a <code>.muz</code> file to your computer.</li>
                  <li><strong>Local Storage Autosave</strong>: MuseGrid saves continuously in the background. Refreshing the page restores your exact state.</li>
                  <li>Use <strong>Open</strong> to load a <code>.muz</code> file.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Manage Workstation Preferences (.muzset)</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li>At the very bottom left, click <strong>Manage Settings</strong>.</li>
                  <li>Here you can export a <code>musegrid_preferences.muzset</code> file. This saves your specific layout, zoom levels, grid configurations, and engine preferences independently from your music!</li>
                  <li>You can import this preference file into any other project to instantly recall your perfect workflow setup.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Exporting Audio</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li>Click <strong>Export Mix</strong> in the Top Bar. Choose <strong>WAV</strong> (highest quality) or <strong>MP3</strong> (smaller file size).</li>
                  <li>In the export menu, you can apply global transposition, Auto-Fade out, and choose to <strong>Include Procedural FX</strong>.</li>
                  <li>If you enable the Loop brace in the timeline, the export will only render the looped area.</li>
                  <li><strong>Include Metronome</strong> places the click in the file using the sound, gain, downbeat and upbeat settings from the Click panel.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Which Export Should I Choose?</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>The format sets the file; the bounce mode sets how it is produced. Choose by what the file is for.</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <strong style={{ color: '#4dabf7', fontSize: '12px' }}>WAV - Final Mixes</strong>
                    <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                      <li>Rendered by the native engine, including the instruments, effects and VST3 plugins you hear.</li>
                      <li>16-bit, 24-bit, or 32-bit float.</li>
                      <li>Use for releasing, mastering, and archiving.</li>
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <strong style={{ color: '#00e6ff', fontSize: '12px' }}>MP3 - Sharing</strong>
                    <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                      <li>Smaller files, encoded at 128 to 320 kbps.</li>
                      <li>Rendered by the browser engine: VST3 plugins and some native-only settings are not included.</li>
                      <li>Use for demos, links, and quick references.</li>
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <strong style={{ color: '#69db7c', fontSize: '12px' }}>Offline (Fast) - Default</strong>
                    <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                      <li>Renders as fast as the computer allows, without playing the song.</li>
                      <li>The right choice for almost every export.</li>
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <strong style={{ color: '#ff6b6b', fontSize: '12px' }}>Real-Time (1:1) - Live Output</strong>
                    <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                      <li>Records while the song plays, so it takes the full length of the song.</li>
                      <li>Falls back to the offline renderer if live capture is unavailable.</li>
                      <li>Use only when you need to verify timing-dependent live behavior.</li>
                    </ul>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', marginTop: '15px' }}>
                  <strong style={{ color: '#ffd43b', fontSize: '12px' }}>When WAV Uses the Browser Engine</strong>
                  <ul style={{ color: '#ccc', margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.5 }}>
                    <li>Exporting multiple regions, or enabling Procedural FX, moves a WAV export to the browser renderer.</li>
                    <li>The metronome is rendered by the native engine using the Click panel settings, so a WAV with the click and VST3 instruments stays on the native engine.</li>
                    <li>Leave procedural FX off when the render must match what you hear in the app.</li>
                  </ul>
                </div>
              </div>
            )}

            {activeSection === 'shortcuts' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Keyboard Shortcuts</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Master these to speed up your composition and editing workflow.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '16px', marginBottom: '10px' }}>Transport & Tools</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '13px', listStyleType: 'none', padding: 0, margin: 0 }}>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>Space</kbd> Play / Pause</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>Del</kbd> or <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>Backspace</kbd> Delete selected notes</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>Shift</kbd> + Mouse Wheel: Scroll horizontally</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>Ctrl</kbd> + Mouse Wheel: Zoom in/out</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>Ctrl</kbd> + <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>A</kbd> Select all notes on active track</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>Esc</kbd> Deselect all notes</li>
                  </ul>
                  <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '13px', listStyleType: 'none', padding: 0, margin: 0 }}>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>V</kbd> Select Tool (Pointer)</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>B</kbd> Draw Tool (Pencil)</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>E</kbd> Erase Tool</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>C</kbd> Slice Tool (Knife)</li>
                  </ul>
                </div>

                <h3 style={{ color: '#69db7c', marginTop: '24px', marginBottom: '10px' }}>Piano Roll Keyboard Shortcuts</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '13px', listStyleType: 'none', padding: 0, margin: 0 }}>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Ctrl + L</kbd> Quick Legato (stretch notes to eliminate gaps)</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Ctrl + G</kbd> Glue contiguous same-pitch notes</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Alt + S</kbd> Quick Strum (stagger chord notes)</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Alt + U</kbd> Quick Chop (subdivide by 1/16 grid)</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Alt + R</kbd> Quick Humanize (timing, velocity, duration jitter)</li>
                  </ul>
                  <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '13px', listStyleType: 'none', padding: 0, margin: 0 }}>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Alt + Y</kbd> Flip Horizontal (Time Reverse / Retrograde)</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Shift + ↑ / ↓</kbd> Transpose Octave (±12 semitones)</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Ctrl + ↑ / ↓</kbd> Transpose Semitone (±1 semitone)</li>
                    <li style={{ marginBottom: '8px' }}><kbd style={{ background: '#1c3829', color: '#69db7c', border: '1px solid rgba(105,219,124,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Double-Click Ghost</kbd> Jump active track to note's track</li>
                  </ul>
                </div>
              </div>
            )}

            {activeSection === 'synth_lab' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Instrument Design & Synthesis Lab</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Every track in MuseGrid runs a dedicated synthesizer model or a physical drum modeler. Access these via the Instrument Lab accordion in the Left Pane.</p>

                <h3 style={{ color: '#00e6ff', marginTop: '20px' }}>Synthesizer Models</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Subtractive Synth</strong>: Combines dual oscillators (Sine, Square, Sawtooth, Triangle) fed into a resonant lowpass filter. Features standard ADSR envelopes.</li>
                  <li><strong>FM Synth</strong>: Frequency Modulation synthesizer. Carriers are modulated by modulator waves with adjustable <strong>Harmonicity</strong> (frequency ratio) and <strong>Modulation Index</strong> (depth).</li>
                  <li><strong>MonoSynth</strong>: Monophonic lead/bass synth featuring an auto-cutoff filter sweep on note triggers.</li>
                </ul>

                <h3 style={{ color: '#00e6ff', marginTop: '20px' }}>Fourier Waveform Architect</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Write custom mathematical equations to construct custom waveforms/wavetables. It calculates up to 64 harmonics using sine terms.</p>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '15px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#aaa', display: 'block', marginBottom: '6px' }}>Example Formulas:</span>
                  <ul style={{ color: '#ddd', margin: 0, paddingLeft: '20px', fontSize: '13px' }}>
                    <li><strong>Square Wave</strong>: <code>sin(t) + 0.33 * sin(3*t) + 0.2 * sin(5*t)</code></li>
                    <li><strong>Sawtooth Wave</strong>: <code>sin(t) - 0.5 * sin(2*t) + 0.33 * sin(3*t)</code></li>
                  </ul>
                </div>

                <h3 style={{ color: '#ff922b', marginTop: '20px' }}>Drum Physical Modeling Engine</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Drum triggers run real-time physical simulation models rather than static sample playbacks:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Membrane Model</strong>: Simulates the tension, pitch drop, and skin decay of kicks and tom drums.</li>
                  <li><strong>Noise Model</strong>: Employs filtered white noise to synthesize acoustic snare rattle, clap friction, and shaker hits.</li>
                  <li><strong>Metal Model</strong>: Combines six out-of-phase FM carrier oscillators to generate inharmonic metallic cymbal and hi-hat structures.</li>
                </ul>
              </div>
            )}

            {activeSection === 'neural_ai' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Neural Composition Engine (AI)</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>MuseGrid packages offline and browser-run generative algorithms to assist chord, melody, and rhythm creation.</p>

                <h3 style={{ color: '#da77f2', marginTop: '20px' }}>Generative Controllers</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Temperature (0.1 - 2.0)</strong>: Controls randomness. Low values are strict, while higher values generate experimental sequences.</li>
                  <li><strong>Density</strong>: Controls how many notes or rests are populated in the generated grid.</li>
                  <li><strong>Seed Memory</strong>: Sets the number of preceding measures the model analyzes to form its pattern.</li>
                </ul>

                <h3 style={{ color: '#da77f2', marginTop: '20px' }}>AI Composer Models</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Melody Generator</strong>: Generates monophonic lines matching the active Scale Lock parameters.</li>
                  <li><strong>Beat Architect & Morphing</strong>: Generates drum beats using Markov probabilities, or morphs/interpolates step patterns between two drum tracks.</li>
                  <li><strong>Chord & Counterpoint Generator</strong>: Populates jazz voicings, diatonic chords, or standard voice-leading counterpoint lines (Alto, Tenor, Bass) under an active melody.</li>
                  <li><strong>Piano Genie</strong>: An interactive 8-button interface allowing live diatonic solos.</li>
                  <li><strong>Arrangement Suggestions</strong>: Analyzes track densities and displays tips for improving session structures.</li>
                </ul>
              </div>
            )}

            {activeSection === 'midi_remap' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>MIDI Import & Remap Laboratory</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Cleanly import and parse MIDI (Type 0 and 1) or MusicXML files with advanced alignment tools.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Remapping Operations</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Channel Auditioning</strong>: Select and import only specific channels or instruments from a multi-track MIDI file.</li>
                  <li><strong>Global Offsets</strong>: Apply time scaling (half-time or double-time multipliers), velocity scaling, and pitch transpositions during the import pipeline.</li>
                  <li><strong>Smart Scale Snap</strong>: Snaps imported pitches to conform directly to the active project scale.</li>
                  <li><strong>Pitch Pruning</strong>: Lists all unique note rows found in the MIDI file. Exclude specific pitches (like drum noise or sub-bass lines) before notes hit the sequencer.</li>
                  <li><strong>Drum Auto-Map</strong>: Maps Standard GM percussion channels (e.g. Channel 10) directly to MuseGrid's 16-pad layout.</li>
                </ul>
              </div>
            )}

            {activeSection === 'stem_splitter_onnx' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>AI Stem Splitter & ONNX Runtime</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Isolate vocals and instrumental tracks directly inside the client workspace using neural network separation models.</p>

                <h3 style={{ color: '#da77f2', marginTop: '20px' }}>Local Execution Backends</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>All models run locally on your machine via ONNX Runtime Web:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>CPU (WASM)</strong>: Uses WebAssembly for general CPU processing on all hardware.</li>
                  <li><strong>GPU (WebGPU)</strong>: Leverages local graphics hardware acceleration for fast, high-speed stem separation.</li>
                </ul>

                <h3 style={{ color: '#da77f2', marginTop: '20px' }}>Separation Options</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>4-Stem Mode</strong>: Isolates Drums, Bass, Vocals, and Other elements.</li>
                  <li><strong>2-Stem Mode</strong>: Extracts Vocals and Instrumental stems.</li>
                  <li><strong>Audio to MIDI Transcription</strong>: Processes separated audio buffers (such as Bass or Vocals) to detect frequency peaks, creating a track and placing the transcribed MIDI notes onto the grid.</li>
                </ul>
              </div>
            )}

            {activeSection === 'score_sheet_preview' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Score & Sheet Music Preview</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Generate clean, visual sheet music and notation sheets for any active synth track in real time.</p>

                <h3 style={{ color: '#00e6ff', marginTop: '20px' }}>Notation Engine Features</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Treble Staff Representation</strong>: Maps MIDI note numbers to standard diatonic lines, displaying accidentals.</li>
                  <li><strong>Ledger Lines</strong>: Draws extra lines above and below the standard staff for low and high pitches.</li>
                  <li><strong>Note Name Overlay</strong>: Renders note names inside note heads for educational sheet reading.</li>
                  <li><strong>Compound Meter Normalization</strong>: Dynamically adjusts measure lengths and ticks per beat for compound and non-standard time signatures (e.g., 6/8, 3/8, 2/2, 4/4).</li>
                  <li><strong>Cross-Measure Tied Notes</strong>: Notes that cross barlines are cleanly split and marked with MusicXML &lt;tie&gt; and &lt;tied&gt; notations so external engravers (MuseScore, Dorico, Sibelius) render them with proper ties.</li>
                  <li><strong>Read-Only Mode Lock</strong>: When Read-Only Mode is active, score stave clicking, note tuning, and deletion are locked to prevent accidental edits.</li>
                  <li><strong>Export Formats</strong>:
                    <br />- <strong>Vector SVG</strong>: Download a high-res vector graphic.
                    <br />- <strong>Print Score</strong>: Formats the notation for physical printing.
                    <br />- <strong>MusicXML</strong>: Export score XML to load into MuseScore, Sibelius, or Finale.
                  </li>
                </ul>
              </div>
            )}

            {activeSection === 'tech_appendix' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Technical Appendix & MPE Parameters</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Detailed parameter specifications for DSP execution and rendering.</p>

                <h3 style={{ color: '#ff3366', marginTop: '20px' }}>MPE Note-Level Expressions</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Unlike standard global modulation, MuseGrid tracks MPE values at the note level:</p>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Pitch Glide</strong>: Transposes pitch (-24 to +24 semitones) over duration (0 to 384 ticks). Supports <strong>smooth</strong> (exponential) or <strong>stepped</strong> (glissando) glide styles.</li>
                  <li><strong>Vibrato Wobble</strong>: Modulates cents depth (0 to 100 ct) and rate (0.1 to 20.0 Hz).</li>
                  <li><strong>Tremolo Gater</strong>: Gates volume with depth ratio (0.0 to 1.0) and rate (0.1 to 20.0 Hz).</li>
                  <li><strong>Filter Sweep (Wah)</strong>: Automates cutoff sweep (20 to 20,000 Hz) over duration (0 to 384 ticks).</li>
                </ul>

                <h3 style={{ color: '#ff3366', marginTop: '20px' }}>WASM & Tone Audio Engines</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Toggle between standard Web Audio (Tone.js) and the custom C++ compilation WASM engine. The WASM engine handles thousands of active oscillators and filter nodes with zero audio stutter, supporting MPE, instrument custom presets, and drum physically modeled voices.</p>
              </div>
            )}

            {activeSection === 'scripting_examples' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Scripting API Examples</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Load these scripts inside the Monaco script editor to explore scripting possibilities.</p>

                <h3 style={{ color: '#40c057', marginTop: '20px' }}>1. Custom Arpeggiator</h3>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`const trackId = Muse.getState().activeTrackId;
if (!trackId) {
  console.error("Select a track first.");
  return;
}
const intervals = [0, 4, 7, 11]; // Major 7th
const duration = 96; // 8th note
for (let t = 0; t < 768; t += duration) {
  const step = Math.floor(t / duration) % intervals.length;
  MuseState.addNote({
    id: "arp-" + t + "-" + Math.random(),
    trackId: trackId,
    time: t,
    duration: duration - 10,
    pitch: 60 + intervals[step],
    velocity: 100
  });
}`}
                </pre>

                <h3 style={{ color: '#40c057', marginTop: '20px' }}>2. Microtonal Tuning</h3>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`const state = Muse.getState();
const notes = state.notes.filter(n => n.trackId === state.activeTrackId);
const tunings = [0, 40, -20, 20, -40]; // Microtonal offsets
notes.forEach((note, idx) => {
  MuseState.updateNote(note.id, {
    detune: tunings[idx % tunings.length]
  });
});
console.log("Applied tuning to " + notes.length + " notes.");`}
                </pre>

                <h3 style={{ color: '#40c057', marginTop: '20px' }}>3. Generate Neo-Soul Chords & Strum</h3>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`// Generate lush ii9 - V13 - Imaj9 - VI7alt chords at C3
const chords = Muse.editor.generateProgression('neoSoul', 0, 3, 0);
console.log('Inserted ' + chords.length + ' chord notes');

// Strum chords upward with 14-tick micro delay
Muse.editor.strum('up', 14);

// Detect chord name of first chord
const detected = Muse.editor.detectChord();
console.log('First chord detected:', detected?.fullName);`}
                </pre>

                <h3 style={{ color: '#40c057', marginTop: '20px' }}>4. Trap Hi-Hat Ratchet Roll with Crescendo</h3>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`// Select your hi-hat notes or call on active track
const selected = Muse.editor.getSelectedNotes();
if (selected.length === 0) {
  console.log('Select notes first to apply roll');
} else {
  // 6x Ratchet with crescendo velocity dynamic profile
  Muse.editor.ratchet(6, 'crescendo');
  // Micro-nudge forward +6 ticks for swing pocket
  Muse.editor.microNudge(6);
  console.log('Applied 6x ratchet roll with crescendo & micro-nudge!');
}`}
                </pre>

                <h3 style={{ color: '#40c057', marginTop: '20px' }}>5. Harmonic Chord Detective & Scale Degree</h3>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', color: '#a5d8ff', fontSize: '12px', overflowX: 'auto', border: '1px solid rgba(77,171,247,0.2)' }} className="thin-scroll">
{`// Detect chord from an array of MIDI pitches
const chord = Muse.midi.detectChord([60, 64, 67, 71]); // C, E, G, B
console.log('Chord Name:', chord?.fullName); // 'Cmaj7'
console.log('Inversion:', chord?.inversion); // 'Root Position'

// Analyze Roman numeral scale degree in C Major
const degree = Muse.midi.detectScaleDegree(0, 0, 'Major');
console.log('Scale degree Roman numeral:', degree); // 'I'`}
                </pre>
              </div>
            )}

            {activeSection === 'production_workflows' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Production Workflows</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Recipes to accomplish complex production goals.</p>

                <h3 style={{ color: '#ffcc00', marginTop: '20px' }}>Creating Custom Fourier Wavetables</h3>
                <ol style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px', paddingLeft: '20px' }}>
                  <li>Create a new Synth track in the Left Pane.</li>
                  <li>Expand the track inspector and open the <strong>Instrument Lab</strong>.</li>
                  <li>Set synthesis mode to <strong>Fourier Expression</strong>.</li>
                  <li>Enter your waveform formula (e.g. <code>sin(t) + 0.5*sin(2*t)</code>) and partial count.</li>
                  <li>Click <strong>Generate Table</strong> to rebuild the oscillator wavetable.</li>
                </ol>

                <h3 style={{ color: '#ffcc00', marginTop: '20px' }}>Separating Audio Stems & Transcribing to MIDI</h3>
                <ol style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px', paddingLeft: '20px' }}>
                  <li>Open the <strong>Stem Splitter</strong> in the Left Pane.</li>
                  <li>Upload your stereo audio file and choose your separation mode (2-stem or 4-stem).</li>
                  <li>Select hardware backend (WebGPU or CPU) and click <strong>Start Split</strong>.</li>
                  <li>Once completed, click <strong>To MIDI</strong> on the desired stem to transcribe notes and import them into the active arranger grid.</li>
                </ol>
              </div>
            )}

            {activeSection === 'calibration_latency' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Calibration & Latency Settings</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Calibrate the audio engine to resolve audio delays and align incoming MIDI recording signals.</p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Audio Buffer & Look-Ahead Settings</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Look-Ahead Time (5ms - 100ms)</strong>: Determines how far in advance audio events are scheduled. Higher values improve playback stability, while lower values reduce trigger delay.</li>
                  <li><strong>Buffer Size (256 - 2048)</strong>: Balances CPU consumption against output latency. Smaller sizes (e.g., 256 samples) are best for live recording, while larger values (e.g., 1024 samples) are best for handling heavy effects racks.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Latency Calibration Wizard</h3>
                <ol style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px', paddingLeft: '20px' }}>
                  <li>Open the global settings drawer in the Left Pane and click <strong>Calibration Mode</strong>.</li>
                  <li>Tap your MIDI key or keyboard pad in sync with the audible rhythm clicks.</li>
                  <li>The engine calculates the latency offset (-100ms to +100ms) and calibrates input timing automatically.</li>
                </ol>
              </div>
            )}

            {activeSection === 'troubleshooting_faq' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Troubleshooting & FAQ</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>Fixes for common workstation audio and sequence issues.</p>

                <h3 style={{ color: '#ff3366', marginTop: '20px' }}>Audio Crackle, Pops or Buffer Underflow</h3>
                <ol style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px', paddingLeft: '20px' }}>
                  <li>Lower the global volume to prevent main bus output clipping.</li>
                  <li>Enable the <strong>Master Limiter</strong> panel in the settings menu.</li>
                  <li>Disable heavy real-time custom math effects to reduce CPU load.</li>
                  <li>Increase your audio buffer size to 1024 samples.</li>
                </ol>

                <h3 style={{ color: '#ff3366', marginTop: '20px' }}>MIDI Alignment and Timing Issues</h3>
                <ol style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px', paddingLeft: '20px' }}>
                  <li>Open the <strong>MIDI Remap Laboratory</strong> in the Left Pane.</li>
                  <li>Enable <strong>Smart Scale Snap</strong> to conform imported pitches to the project scale.</li>
                  <li>Adjust the time scaling multiplier if the notes import too fast or slow.</li>
                </ol>
              </div>
            )}

            {activeSection === 'glossary_credits' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Glossary & Credits</h1>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>System Terminology</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '13px' }}>
                  <li><strong>MPE (MIDI Polyphonic Expression)</strong>: Extends standard MIDI to allow note-level pitch glides, filter sweeps, and volume gates.</li>
                  <li><strong>ONNX Web Runtime</strong>: Enables execution of neural network models (like Spleeter stems isolation) locally inside the browser.</li>
                  <li><strong>DPreverb (Distributed Pre-Reverb)</strong>: Unique offline reverb node that scatters reflections across time domains.</li>
                  <li><strong>PPQ (Pulses Per Quarter Note)</strong>: Sequencing resolution. MuseGrid runs at 192 PPQ (1 quarter note = 192 ticks).</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Open Source Dependencies</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '13px' }}>
                  <li><strong>React & Zustand</strong>: User Interface and global state storage.</li>
                  <li><strong>Tone.js</strong>: Web Audio synthesis scheduling and signal routing.</li>
                  <li><strong>Monaco Editor</strong>: Live JavaScript scripting console.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Licensing</h3>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '13px' }}>All audio renders, WAV, and MP3 files exported from MuseGrid are 100% royalty-free. Users retain full intellectual property rights for all compositions.</p>
              </div>
            )}

            {activeSection === 'vst3_hosting' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>VST3 Plugin Hosting</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  MuseGrid Native integrates a 64-bit VST3 hosting environment driven directly by the native JUCE 8 C++ audio engine.
                  Both software instrument synths and audio effect processors are supported.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Scanning & Plugin Directories</h3>
                <p style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  The engine scans the standard 64-bit Windows VST3 directory (<code>C:\Program Files\Common Files\VST3</code>).
                  To scan for installed plugins:
                </p>
                <ol style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px', paddingLeft: '20px' }}>
                  <li>Open the Left Pane and expand the global settings or VST subpane.</li>
                  <li>Click <strong>Scan Plugins</strong>. The native scanner parses metadata, input/output bus topology, and factory presets into the registry.</li>
                </ol>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Assigning VST3 Instruments & Effects</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Synth Tracks</strong>: Open track details in the Left Pane. Under the <em>Instrument</em> dropdown, choose any scanned VST3 plugin. The native engine automatically instantiates the plugin and routes MIDI note and pitch-bend events directly to its processor.</li>
                  <li><strong>FX Inserts</strong>: Under the track's FX Rack, insert third-party VST3 equalizers, compressors, reverbs, or modulation plugins.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Plugin Editor Windows (GUI)</h3>
                <p style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  Click <strong>Open GUI</strong> on any assigned VST3 track or effect to launch the plugin's native editor window.
                  The window runs independently on the main message loop without blocking audio rendering threads. Closing the window maintains the running DSP state and parameters.
                </p>
              </div>
            )}

            {activeSection === 'drum_designer' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Drum Designer Synthesis</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  The Drum Designer is a dedicated parametric percussion synthesis module. It synthesizes drums through real-time mathematical oscillator modeling and noise shaping rather than static samples.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Oscillator Architecture</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Body Oscillator</strong>: Generates the fundamental tone (Sine, Triangle, or Square) with dedicated start pitch, end pitch, pitch drop time, and exponential decay curves.</li>
                  <li><strong>Click / Transient Layer</strong>: Generates an initial transient impulse to provide attack definition and punch across mix environments.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Noise & Filter Envelopes</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Noise Generator</strong>: Filtered white and pink noise stages for snares, claps, and open/closed cymbals.</li>
                  <li><strong>Tone Filter</strong>: Multi-mode low-pass, high-pass, and band-pass filtering with variable resonance.</li>
                  <li><strong>Overdrive & Distortion</strong>: Non-linear waveshaping stage for adding harmonic saturation and presence.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Sequencer Routing</h3>
                <p style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  Designed drum patches can be linked directly to specific channels within the Step Sequencer or triggered from the main Piano Roll canvas via chromatic MIDI mapping.
                </p>
              </div>
            )}

            {activeSection === 'audio_recording' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Audio Recording & Inputs</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  MuseGrid provides direct multi-track recording for incoming microphone, line-in, and hardware MIDI controller signals.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Hardware Driver Configuration</h3>
                <p style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  Configure active input and output devices via the Engine Settings panel. On Windows, low-latency WASAPI Exclusive and ASIO driver interfaces can be configured with selectable hardware buffer sizes (128, 256, 512, or 1024 samples).
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Recording Workflow</h3>
                <ol style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px', paddingLeft: '20px' }}>
                  <li>Select an Audio track in the Left Pane and click the <strong>Record Arm</strong> button.</li>
                  <li>Verify input signal levels using the real-time peak meter.</li>
                  <li>Optionally enable the Metronome in the Top Bar and configure count-in measures (1 or 2 bars).</li>
                  <li>Press <strong>Record (R)</strong> or click the Record button in the transport controls to begin tracking.</li>
                  <li>Recorded takes are rendered onto the timeline with non-destructive waveform visualization.</li>
                </ol>
              </div>
            )}

            {activeSection === 'microtonal_edo' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>Microtonal Tuning & Scala</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  Beyond standard 12-tone equal temperament (12-TET), MuseGrid supports microtonal pitch geometry, historical tunings, and continuous frequency space.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Equal Divisions of the Octave (EDO)</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>12-EDO</strong>: Standard Western semitone system.</li>
                  <li><strong>19-EDO</strong>: Provides third-tones, improved minor thirds, and close harmonic fifths.</li>
                  <li><strong>24-EDO</strong>: Quarter-tone system dividing each octave into 24 equal steps of 50 cents.</li>
                  <li><strong>31-EDO</strong>: Extended meantone tuning with pure major thirds and septimal intervals.</li>
                  <li><strong>53-EDO</strong>: High-resolution division approximating pure Pythagorean and 5-limit intervals.</li>
                </ul>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Continuous Free Frequency Grid</h3>
                <p style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  Enabling Free Pitch mode unlocks note nodes from discrete pitch intervals entirely, allowing arbitrary decimal frequencies, non-standard pitch glides, and unquantized intonation curves.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Scala (.scl) Companion Export</h3>
                <p style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  When exporting projects composed in non-12-EDO tunings, MuseGrid generates standard Huygens-Fokker <code>.scl</code> tuning files alongside the MIDI data. Loading the companion <code>.scl</code> file into compatible synthesizers (e.g., Vital, Surge XT, Pianoteq, Serum) retunes their voice engines to match the exact project intonation.
                </p>
              </div>
            )}

            {activeSection === 'system_console' && (
              <div>
                <h1 style={{ margin: '0 0 20px', color: '#fff' }}>System Console & Diagnostics</h1>
                <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: '14px' }}>
                  The System Console provides real-time event monitoring, error logging, and diagnostic export for troubleshooting audio engine and script execution issues.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Accessing the Console</h3>
                <p style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  Click the <strong>CONSOLE</strong> tab at the top of the Help dialog or click <strong>Open</strong> in the sidebar status bar. If any errors occur during playback, audio export, or VST instantiation, an error badge counter will display on the tab.
                </p>

                <h3 style={{ color: '#4dabf7', marginTop: '20px' }}>Diagnostics & Export Options</h3>
                <ul style={{ color: '#ddd', lineHeight: 1.6, fontSize: '14px' }}>
                  <li><strong>Severity Filtering</strong>: Filter logs by <em>Errors</em>, <em>Warnings</em>, or <em>Info</em>.</li>
                  <li><strong>Search</strong>: Search log messages for specific track names, parameters, or VST filenames.</li>
                  <li><strong>Stack Traces</strong>: Expand the <em>Stack Trace</em> dropdown on any error entry to view the precise source file and line call stack.</li>
                  <li><strong>Save Log</strong>: Exports a complete diagnostic log file (<code>.log</code>) including environment details, platform architecture, and recorded event history.</li>
                  <li><strong>Copy</strong>: Copies formatted diagnostic output directly to the clipboard.</li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          renderConsoleView()
        )}
        </div>
      </div>
    </div>
  );
}

