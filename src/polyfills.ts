import { EventSource } from 'eventsource';

// @arkade-os/sdk opens its settlement (batch) and contract event streams via a global
// `EventSource`, but Node only ships EventSource behind the --experimental-eventsource flag.
// Register the WHATWG-compliant polyfill globally so those streams work on our runtime instead
// of throwing `ReferenceError: EventSource is not defined` (which broke Arkade VTXO settlement
// and flooded the logs). Imported first in main.ts so it runs before any SDK code executes.
Object.assign(globalThis, { EventSource });
