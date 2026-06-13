// Lightweight server-side logger that prepends HH:MM:SS timestamps.
// Use instead of console.log in all pipeline and Gemini service files.

export function log(...args: unknown[]): void {
  const ts = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', // UTC+7, no DST
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  console.log(`[${ts}]`, ...args)
}
