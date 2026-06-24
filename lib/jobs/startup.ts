// Starts the in-process job worker exactly once per server process.
// Called from instrumentation.ts on the Node.js runtime after TLS setup.

import { log } from '@/lib/logger'

let started = false

export function startWorker(): void {
  if (started) return
  started = true

  // Dynamic import keeps all pipeline dependencies out of the instrumentation
  // bundle (they use node:* APIs incompatible with the Edge runtime).
  import('./worker')
    .then(({ runWorkerLoop }) => {
      runWorkerLoop().catch((err: unknown) => {
        console.error(
          '[worker] fatal loop error — worker has stopped. ' +
          'Restart the server to resume processing.',
          err,
        )
      })
    })
    .catch((err: unknown) => {
      console.error('[worker] failed to load worker module:', err)
    })

  log(`[worker] startup scheduled (id will be logged on first loop tick)`)
}
