import { createHash } from 'node:crypto';

/**
 * Pure Merkle-tree primitives for the GeBüV anchoring pipeline, following the
 * RFC 6962 Merkle Tree Hash (MTH) construction.
 *
 * DOMAIN SEPARATION (load-bearing — verification depends on it):
 *   - LEAF_PREFIX = 0x00, NODE_PREFIX = 0x01 (single bytes).
 *   - `leafHash(d) = sha256(0x00 || d)` where `d` is a 32-byte document DIGEST.
 *     Callers (archive.service.ts) pass `archive_file.sha256` as raw digest bytes;
 *     the raw document bytes are NOT available inside this module. The exported
 *     functions therefore domain-separate each digest via `leafHash` before it
 *     enters the tree — leaves are never used raw.
 *   - `node(l, r) = sha256(0x01 || l || r)` for two 32-byte child hashes.
 *
 * TREE SHAPE (Merkle Tree Hash, MTH) for a list D[n] of digests, n >= 1:
 *   - n == 1: MTH(D) = leafHash(D[0]).
 *   - n > 1: let k be the largest power of two STRICTLY smaller than n
 *     (k = 1; while (k * 2 < n) k *= 2). Then
 *     MTH(D[0:n]) = node(MTH(D[0:k]), MTH(D[k:n])).
 *     There is NO duplication of a trailing odd element (avoids CVE-2012-2459).
 *   - n == 0: throw.
 *
 * Worked example (3 leaves d0,d1,d2; L_i = leafHash(d_i)):
 *   k=2, root = node(node(L0,L1), L2)
 *   — NOT node(node(L0,L1), node(L2,L2)) (the old, wrong, duplicated form).
 *
 * Inclusion proofs (RFC 6962 §2.1.1 audit path) use the same split rule and are
 * ordered from the leaf's immediate sibling first to the root-adjacent sibling last.
 */

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

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

/** Domain-separate a document digest into a leaf hash: sha256(0x00 || d). */
function leafHash(digest: Buffer): Buffer {
  return sha256(Buffer.concat([LEAF_PREFIX, digest]));
}

/** Combine two child hashes into a parent: sha256(0x01 || left || right). */
function node(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([NODE_PREFIX, left, right]));
}

/**
 * Largest power of two strictly smaller than `n`.
 * For n == 1 this is unused (caller handles the base case).
 */
function largestPowerOfTwoStrictlyLessThan(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/**
 * Build the Merkle root over document digests per RFC 6962 MTH.
 *
 * Throws on an empty input. Each digest is leaf-hashed before entering the tree.
 */
export function buildMerkleRoot(leafDigests: Buffer[]): Buffer {
  if (leafDigests.length === 0) throw new Error('Cannot build a Merkle root from zero leaves');

  return mth(leafDigests);
}

/** Recursive Merkle Tree Hash over a slice of document digests. */
function mth(digests: Buffer[]): Buffer {
  const n = digests.length;
  if (n === 1) return leafHash(digests[0]);

  const k = largestPowerOfTwoStrictlyLessThan(n);
  return node(mth(digests.slice(0, k)), mth(digests.slice(k)));
}

/**
 * Compute the RFC 6962 §2.1.1 inclusion (audit) path for the digest at `index`.
 *
 * Ordered from the leaf's immediate sibling first to the root-adjacent sibling last —
 * the order `verifyMerkleProof` walks (leaf → root).
 *
 * For a single-digest tree the proof is empty. Sibling subtree hashes are recomputed
 * via MTH (acceptable for small daily KYC batches).
 */
export function merkleInclusionProof(leafDigests: Buffer[], index: number): MerkleProofStep[] {
  if (leafDigests.length === 0) throw new Error('Cannot build a proof from zero leaves');
  if (index < 0 || index >= leafDigests.length) {
    throw new Error(`Leaf index ${index} out of range [0, ${leafDigests.length})`);
  }

  return auditPath(leafDigests, index);
}

/** Recursive audit-path construction matching the MTH split rule. */
function auditPath(digests: Buffer[], index: number): MerkleProofStep[] {
  const n = digests.length;
  if (n === 1) return [];

  const k = largestPowerOfTwoStrictlyLessThan(n);

  if (index < k) {
    // Target in left half: recurse left, then append right-half sibling (sibling is RIGHT).
    const proof = auditPath(digests.slice(0, k), index);
    proof.push({ sibling: mth(digests.slice(k)), right: true });
    return proof;
  }

  // Target in right half: recurse right, then append left-half sibling (sibling is LEFT).
  const proof = auditPath(digests.slice(k), index - k);
  proof.push({ sibling: mth(digests.slice(0, k)), right: false });
  return proof;
}

/**
 * Recompute the root from a document DIGEST and its inclusion proof, then compare
 * against the expected `root`. Returns true only on an exact byte match.
 *
 * `leaf` is the raw document digest (not pre-hashed). This function applies
 * `leafHash` internally before walking the proof:
 *   computed = leafHash(leaf);
 *   for each step: computed = step.right
 *     ? node(computed, step.sibling)
 *     : node(step.sibling, computed);
 *   return computed.equals(root)
 */
export function verifyMerkleProof(leaf: Buffer, proof: MerkleProofStep[], root: Buffer): boolean {
  let computed = leafHash(leaf);

  for (const step of proof) {
    computed = step.right ? node(computed, step.sibling) : node(step.sibling, computed);
  }

  return computed.equals(root);
}
