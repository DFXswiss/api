import { EventSource } from 'eventsource';
import '../polyfills';

describe('polyfills', () => {
  // Guards against a silent regression: if a future eventsource major changes its export
  // shape, the polyfill would register `undefined` and the @arkade-os/sdk EventSource streams
  // would throw again on our runtime without anyone noticing.
  it('registers the eventsource polyfill as the global EventSource', () => {
    expect((globalThis as { EventSource?: unknown }).EventSource).toBe(EventSource);
    expect(typeof (globalThis as { EventSource?: unknown }).EventSource).toBe('function');
  });
});
