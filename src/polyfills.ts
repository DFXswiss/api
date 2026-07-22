import { EventSource } from 'eventsource';

// @arkade-os/sdk opens its settlement (batch) and contract event streams via a global
// `EventSource`, but Node only ships EventSource behind the --experimental-eventsource flag.
// Register the WHATWG-compliant polyfill globally so those streams work on our runtime instead
// of throwing `ReferenceError: EventSource is not defined` (which broke Arkade VTXO settlement
// and flooded the logs). Imported first in main.ts so it runs before any SDK code executes.
Object.assign(globalThis, { EventSource });

// Global bigint JSON serialization. Since §2.3 native-first exactness (#4287) several raw-entity admin/staff
// endpoints (buy-crypto PUT :id + :id/amlCheck, buy-fiat, ref-reward, pay-in controllers) return the entity
// directly, and those entities now carry `bigint` exact base-unit columns (input/output/networkStart/
// payoutFee…AmountBaseUnits). Node's JSON.stringify throws `TypeError: Do not know how to serialize a BigInt`
// on a populated bigint, so editing such a row would surface as an HTTP 500. Render a bigint as its exact
// DECIMAL STRING on the wire: exact base-unit integers routinely exceed 2^53 (18-dp wei of a large balance is
// ~10^21), so a string is the only lossless form — matching how PayoutService.checkOrderCompletion already
// stringifies base units. The DB layer is untouched: baseUnitsTransformer/chfCentsTransformer serialize through
// explicit .toString()/Number, never JSON. Imported first in main.ts so it is active before the app is created.
declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function (): string {
  return this.toString();
};
