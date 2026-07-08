// Structured server-side logger.
//
// Production (NODE_ENV=production): emits JSON lines for log aggregators.
//   { ts, level, msg, meetingId?, jobId?, userId?, step?, provider?, count?, durationMs?, detail?, error? }
//
// Development: human-readable [HH:MM:SS] LEVEL msg { ctx? }
//
// Privacy invariant: ctx fields are identifiers and counts only — NEVER transcript
// text, audio bytes, API keys, or full request bodies.

export interface LogCtx {
  meetingId?: string
  jobId?: string
  userId?: string
  step?: string
  provider?: string
  count?: number
  durationMs?: number
  detail?: string
  error?: string
  /** Any additional structured fields for this log site. */
  [key: string]: unknown
}

type Level = 'INFO' | 'WARN' | 'ERROR'

function ts(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function emit(level: Level, msg: string, ctx?: LogCtx): void {
  const now = ts()
  if (process.env.NODE_ENV === 'production') {
    const line = JSON.stringify({ ts: now, level, msg, ...ctx })
    if (level === 'ERROR') {
      console.error(line)
    } else if (level === 'WARN') {
      console.warn(line)
    } else {
      console.log(line)
    }
  } else {
    const ctxStr = ctx && Object.keys(ctx).length > 0 ? ' ' + JSON.stringify(ctx) : ''
    const out = `[${now}] ${level} ${msg}${ctxStr}`
    if (level === 'ERROR') {
      console.error(out)
    } else if (level === 'WARN') {
      console.warn(out)
    } else {
      console.log(out)
    }
  }
}

/** Drop-in for legacy `console.log` with timestamp prefix. */
export function log(msg: string, ctx?: LogCtx): void {
  emit('INFO', msg, ctx)
}

export const logger = {
  info:  (msg: string, ctx?: LogCtx) => emit('INFO',  msg, ctx),
  warn:  (msg: string, ctx?: LogCtx) => emit('WARN',  msg, ctx),
  error: (msg: string, ctx?: LogCtx) => emit('ERROR', msg, ctx),
}
