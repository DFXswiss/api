import { MerkleProofStep } from './merkle';

/** JSON shape of one persisted proof step (sibling hex-encoded). */
interface SerializedMerkleProofStep {
  sibling: string;
  right: boolean;
}

/**
 * Serialize an inclusion proof for storage on `archive_file.merkleProof`.
 * Siblings are hex-encoded 32-byte digests.
 */
export function serializeMerkleProof(proof: MerkleProofStep[]): string {
  const serialized: SerializedMerkleProofStep[] = proof.map((step) => ({
    sibling: step.sibling.toString('hex'),
    right: step.right,
  }));
  return JSON.stringify(serialized);
}

/**
 * Deserialize a persisted inclusion proof from `archive_file.merkleProof`.
 * Throws if the JSON is not an array of steps with hex sibling digests.
 */
export function deserializeMerkleProof(json: string): MerkleProofStep[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid merkle proof JSON: expected an array of steps');
  }

  return parsed.map((step: SerializedMerkleProofStep, index: number) => {
    if (typeof step?.sibling !== 'string' || !/^[0-9a-f]{64}$/.test(step.sibling) || typeof step?.right !== 'boolean') {
      throw new Error(`Invalid merkle proof step at index ${index}`);
    }
    return {
      sibling: Buffer.from(step.sibling, 'hex'),
      right: step.right,
    };
  });
}
