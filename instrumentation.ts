// Next.js instrumentation — runs ONCE on server startup.
//
// This file is bundled for BOTH the Node.js and Edge runtimes, so it must not
// statically import any `node:*` modules (the Edge analyzer rejects them). The
// actual TLS setup lives in `instrumentation-node.ts` and is loaded lazily, and
// only on the Node.js runtime, via a dynamic import.
//
// See `instrumentation-node.ts` for why this exists (corporate TLS proxy).

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 1. Corporate TLS proxy setup must run first so that all outbound HTTPS
    //    calls (Speechmatics, Gemini, Supabase) trust the corporate CA.
    await import('./instrumentation-node')
    // 2. Start the durable job worker after TLS is ready.
    const { startWorker } = await import('./lib/jobs/startup')
    startWorker()
  }
}
