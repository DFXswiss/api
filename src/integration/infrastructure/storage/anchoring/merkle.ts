import { createHash } from 'node:crypto';

/**
 * Pure Merkle-tree primitives for the GeBüV anchoring pipeline.
 *
 * HASH / CONCATENATION RULE (load-bearing — verification depends on it):
 *   - All hashing is SHA-256 (`node:crypto`).
 *   - A parent node is `parent = sha256(left || right)`, where `||` is raw byte
 *     concatenation of the two 32-byte child digests (left first, then right).
 *   - Leaves are used as-is: they are NOT re-hashed by this module. Callers pass
 *     already-hashed leaves (e.g. `sha256(documentBytes)`). This keeps the module
 *     agnostic about leaf preimages and avoids a hidden hashing convention.
 *   - On a level with an ODD number of nodes, the last node is DUPLICATED and
 *     paired with itself (`parent = sha256(last || last)`). This is the classic
 *     Bitcoin-style promotion rule and is reproduced identically in proofs and
 *     verification so the computed root always matches.
 *
 * Edge cases:
 *   - 0 leaves: `buildMerkleRoot` throws (an empty tree has no root).
 *   - 1 leaf: the root IS that leaf (no hashing applied), and its inclusion proof
 *     is the empty path.
 */

/** A single step of an inclusion proof: the sibling digest and whether it sits on the right. */
export interface MerkleProofStep {
  sibling: Buffer;
  /** true if the sibling is the RIGHT child (i.e. the running hash is the LEFT child). */
  right: boolean;
}

/** SHA-256 of the given bytes. */
export function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/** Hash a parent from its two children using the documented `sha256(left || right)` rule. */
function hashPair(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([left, right]));
}

/**
 * Build the Merkle root over `leaves`.
 *
 * Throws on an empty input. For a single leaf the root equals that leaf.
 * On odd levels the last node is duplicated (see module rule).
 */
export function buildMerkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) throw new Error('Cannot build a Merkle root from zero leaves');

  let level = leaves;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      // Odd node count: duplicate the last node and pair it with itself.
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(hashPair(left, right));
    }
    level = next;
  }

  return level[0];
}

/**
 * Compute the inclusion proof for the leaf at `index` — the ordered list of sibling
 * digests (with their left/right position) from the leaf up to (but excluding) the root.
 *
 * For a single-leaf tree the proof is empty. The duplication rule for odd levels is
 * applied identically here, so a leaf that is the duplicated odd node gets a sibling
 * equal to itself on the right.
 */
export function merkleInclusionProof(leaves: Buffer[], index: number): MerkleProofStep[] {
  if (leaves.length === 0) throw new Error('Cannot build a proof from zero leaves');
  if (index < 0 || index >= leaves.length) throw new Error(`Leaf index ${index} out of range [0, ${leaves.length})`);

  const proof: MerkleProofStep[] = [];

  let level = leaves;
  let idx = index;
  while (level.length > 1) {
    const isLeft = idx % 2 === 0;
    // Sibling index; for the duplicated last odd node the sibling is the node itself.
    const siblingIdx = isLeft ? Math.min(idx + 1, level.length - 1) : idx - 1;

    proof.push({ sibling: level[siblingIdx], right: isLeft });

    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(hashPair(left, right));
    }

    level = next;
    idx = Math.floor(idx / 2);
  }

  return proof;
}

/**
 * Recompute the root from `leaf` and its `proof` and compare it against the expected `root`.
 * Returns true only on an exact byte match.
 */
export function verifyMerkleProof(leaf: Buffer, proof: MerkleProofStep[], root: Buffer): boolean {
  let computed = leaf;

  for (const step of proof) {
    computed = step.right ? hashPair(computed, step.sibling) : hashPair(step.sibling, computed);
  }

  return computed.equals(root);
}
