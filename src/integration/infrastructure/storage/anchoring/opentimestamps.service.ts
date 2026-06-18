import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as OpenTimestamps from 'opentimestamps';

/** Result of verifying a detached `.ots` proof against its digest. */
export interface OtsVerifyResult {
  /** Present once the timestamp is anchored in a Bitcoin block. */
  bitcoin?: { height: number };
  /** true while the timestamp is still only attested by the calendars (not yet on-chain). */
  pending: boolean;
}

/**
 * Thin async/await wrapper around the `opentimestamps` npm library for the GeBüV
 * anchoring pipeline. It deliberately knows nothing about Merkle trees, storage or
 * scheduling — callers feed it a single 32-byte SHA-256 digest (typically a daily
 * Merkle root) and get back / consume serialized detached `.ots` proof bytes.
 *
 * The underlying library mixes synchronous constructors with promise-returning
 * network calls; everything is normalized to `async` here.
 *
 * NOTE: `verify` is run with `ignoreBitcoinNode: true`, so attestation is checked
 * against the public block explorers the library trusts, NOT a local Bitcoin node.
 * Verifying against a trusted local node (the strongest GeBüV posture) is not possible
 * from this pure service and must be wired up separately if/when a node is available.
 */
@Injectable()
export class OpenTimestampsService {
  /**
   * Create a detached timestamp over `digest` (an already-computed SHA-256, e.g. a
   * Merkle root) by submitting it to the public OpenTimestamps calendars.
   *
   * Returns the serialized `.ots` bytes to be persisted. At this point the proof is
   * typically still "pending" — it carries calendar commitments but no Bitcoin
   * attestation yet; call `upgrade` later to complete it.
   */
  async stamp(digest: Buffer): Promise<Buffer> {
    const detached = this.detachedFromDigest(digest);

    await OpenTimestamps.stamp(detached);

    return Buffer.from(detached.serializeToBytes());
  }

  /**
   * Attempt to upgrade a pending `.ots` proof to a complete Bitcoin attestation by
   * asking the calendars for the now-available block path.
   *
   * Returns the upgraded `.ots` bytes if anything changed, otherwise the original
   * bytes unchanged (still pending).
   */
  async upgrade(otsBytes: Buffer): Promise<Buffer> {
    const detached = OpenTimestamps.DetachedTimestampFile.deserialize(otsBytes);

    const changed = await OpenTimestamps.upgrade(detached);

    return changed ? Buffer.from(detached.serializeToBytes()) : otsBytes;
  }

  /**
   * Verify that `otsBytes` is a valid timestamp over `digest`.
   *
   * Returns the Bitcoin attestation height once anchored; while the proof is still
   * calendar-only it reports `pending: true` with no `bitcoin` field.
   */
  async verify(digest: Buffer, otsBytes: Buffer): Promise<OtsVerifyResult> {
    const detachedOts = OpenTimestamps.DetachedTimestampFile.deserialize(otsBytes);
    const detached = this.detachedFromDigest(digest);

    // ignoreBitcoinNode: verify against the library's trusted explorers, not a local node.
    const result = await OpenTimestamps.verify(detachedOts, detached, { ignoreBitcoinNode: true });

    // The library returns an object keyed by chain (e.g. { bitcoin: { height, timestamp } });
    // an empty/undefined result means the proof is not yet anchored.
    const bitcoin = result && result.bitcoin;
    if (bitcoin && typeof bitcoin.height === 'number') return { bitcoin: { height: bitcoin.height }, pending: false };

    return { pending: true };
  }

  /** Build a DetachedTimestampFile that commits directly to an already-computed SHA-256 digest. */
  private detachedFromDigest(digest: Buffer): any {
    return OpenTimestamps.DetachedTimestampFile.fromHash(new OpenTimestamps.Ops.OpSHA256(), digest);
  }
}
