declare module 'opentimestamps' {
  export interface DetachedTimestampFile {
    serializeToBytes(): Uint8Array;
  }

  export interface ChainAttestation {
    height: number;
    timestamp?: number;
    [key: string]: unknown;
  }

  export interface VerifyResult {
    bitcoin?: ChainAttestation;
    [chain: string]: ChainAttestation | undefined;
  }

  export interface VerifyOptions {
    ignoreBitcoinNode: boolean;
  }

  export function stamp(detached: DetachedTimestampFile): Promise<void>;
  export function upgrade(detached: DetachedTimestampFile): Promise<boolean>;
  export function verify(
    detachedOts: DetachedTimestampFile,
    detached: DetachedTimestampFile,
    options: VerifyOptions,
  ): Promise<VerifyResult | undefined>;

  export const DetachedTimestampFile: {
    deserialize(otsBytes: Uint8Array | Buffer): DetachedTimestampFile;
    fromHash(op: Ops.OpSHA256, digest: Buffer): DetachedTimestampFile;
  };

  export namespace Ops {
    class OpSHA256 {}
  }
}
