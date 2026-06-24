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
    await import('./instrumentation-node')
  }
}
