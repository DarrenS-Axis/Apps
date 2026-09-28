/** Structured-ish logging: readable on a terminal, greppable in a file. */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLOURS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

let threshold = LEVELS.info;
let logFile = null;

export function configureLogging({ level = 'info', file = null } = {}) {
  threshold = LEVELS[level] ?? LEVELS.info;
  logFile = file;
  if (file) mkdirSync(dirname(file), { recursive: true });
}

function emit(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const extras = fields && Object.keys(fields).length
    ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${format(v)}`).join(' ')
    : '';
  const plain = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}${extras}`;
  const colour = COLOURS[level] ?? '';
  process.stdout.write(`${colour}${plain}\x1b[0m\n`);
  if (logFile) {
    try {
      appendFileSync(logFile, plain + '\n');
    } catch {
      // Never let logging take the bot down.
    }
  }
}

function format(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && v.includes(' ')) return JSON.stringify(v);
  return String(v);
}

export const log = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};

/** Redact anything that looks like a credential before it reaches a log line. */
export function redact(value) {
  if (typeof value !== 'string') return value;
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
