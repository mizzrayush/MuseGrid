// Global System Logger for MuseGrid Native
// Intercepts and records console.error, console.warn, console.info, console.log,
// uncaught exceptions, and unhandled promise rejections.

export type LogLevel = 'error' | 'warn' | 'info' | 'log';

export interface LogEntry {
  id: string;
  timestamp: string; // HH:mm:ss.SSS
  isoTime: string;
  level: LogLevel;
  source: string;
  message: string;
  stack?: string;
}

const MAX_LOGS = 1000;
let logEntries: LogEntry[] = [];
let listeners: Array<(logs: LogEntry[]) => void> = [];
let initialized = false;

function notifyListeners() {
  const shallowCopy = [...logEntries];
  for (const listener of listeners) {
    try {
      listener(shallowCopy);
    } catch (e) {
      // Ignore listener errors to avoid recursion
    }
  }
}

function formatArg(arg: any): { text: string; stack?: string } {
  if (arg === null) return { text: 'null' };
  if (arg === undefined) return { text: 'undefined' };
  if (arg instanceof Error) {
    return {
      text: `${arg.name}: ${arg.message}`,
      stack: arg.stack,
    };
  }
  if (typeof arg === 'object') {
    try {
      return { text: JSON.stringify(arg, null, 2) };
    } catch {
      return { text: String(arg) };
    }
  }
  return { text: String(arg) };
}

function addLog(level: LogLevel, source: string, args: any[]) {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  const timestamp = `${hours}:${minutes}:${seconds}.${ms}`;

  const formattedParts: string[] = [];
  let foundStack: string | undefined = undefined;

  for (const arg of args) {
    const { text, stack } = formatArg(arg);
    formattedParts.push(text);
    if (!foundStack && stack) {
      foundStack = stack;
    }
  }

  const message = formattedParts.join(' ');

  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    timestamp,
    isoTime: now.toISOString(),
    level,
    source,
    message,
    stack: foundStack,
  };

  logEntries.push(entry);
  if (logEntries.length > MAX_LOGS) {
    logEntries.shift();
  }

  notifyListeners();
}

export function initGlobalLogger() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);
  const originalConsoleInfo = console.info.bind(console);
  const originalConsoleLog = console.log.bind(console);

  console.error = function (...args: any[]) {
    try {
      addLog('error', 'console', args);
    } catch {
      // Ignore internal logger errors
    }
    originalConsoleError(...args);
  };

  console.warn = function (...args: any[]) {
    try {
      addLog('warn', 'console', args);
    } catch {
      // Ignore internal logger errors
    }
    originalConsoleWarn(...args);
  };

  console.info = function (...args: any[]) {
    try {
      addLog('info', 'console', args);
    } catch {
      // Ignore internal logger errors
    }
    originalConsoleInfo(...args);
  };

  console.log = function (...args: any[]) {
    try {
      // Filter out hyper-frequent animation/render logs if any
      const firstArg = typeof args[0] === 'string' ? args[0] : '';
      if (!firstArg.startsWith('[scheduler-tick]')) {
        addLog('log', 'console', args);
      }
    } catch {
      // Ignore internal logger errors
    }
    originalConsoleLog(...args);
  };

  window.addEventListener('error', (event: ErrorEvent) => {
    try {
      const errMsg = event.message || 'Uncaught Error';
      const stack = event.error?.stack;
      addLog('error', 'uncaught-error', [errMsg, event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : '', stack]);
    } catch {
      // Ignore
    }
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason;
      addLog('error', 'unhandled-rejection', ['Unhandled Promise Rejection:', reason]);
    } catch {
      // Ignore
    }
  });

  // Log initial workstation startup
  addLog('info', 'system', ['MuseGrid Native Logging Subsystem initialized. Monitoring active.']);
}

export function getLogs(): LogEntry[] {
  return [...logEntries];
}

export function clearLogs() {
  logEntries = [];
  notifyListeners();
}

export function subscribeToLogs(listener: (logs: LogEntry[]) => void): () => void {
  listeners.push(listener);
  listener([...logEntries]);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

export function formatLogsForExport(): string {
  const now = new Date();
  const errors = logEntries.filter(e => e.level === 'error').length;
  const warnings = logEntries.filter(e => e.level === 'warn').length;
  const infos = logEntries.filter(e => e.level === 'info' || e.level === 'log').length;

  const header = [
    '======================================================================',
    'MuseGrid Native - System Diagnostics & Console Log',
    `Generated: ${now.toLocaleString()} (${now.toISOString()})`,
    `Total Entries: ${logEntries.length} | Errors: ${errors} | Warnings: ${warnings} | Info/Log: ${infos}`,
    `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`,
    `Native Mode: ${(window as any).__isJuceNative__ ? 'JUCE 8 Standalone (WebView2)' : 'Browser'}`,
    '======================================================================',
    '',
  ].join('\n');

  const lines = logEntries.map(entry => {
    let out = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`;
    if (entry.stack) {
      out += `\n  Stack trace:\n    ${entry.stack.replace(/\n/g, '\n    ')}`;
    }
    return out;
  });

  return header + lines.join('\n');
}

export async function copyLogsToClipboard(): Promise<boolean> {
  const text = formatLogsForExport();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

export function downloadLogsAsFile(filename?: string) {
  const text = formatLogsForExport();
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const targetName = filename || `musegrid-console-log-${dateStr}.log`;

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = targetName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
