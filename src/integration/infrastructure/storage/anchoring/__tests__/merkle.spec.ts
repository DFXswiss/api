import { buildMerkleRoot, merkleInclusionProof, sha256, verifyMerkleProof } from '../merkle';

/** Deterministic leaf: sha256 of `leaf-<i>` so tests don't depend on random data. */
function leaf(i: number): Buffer {
  return sha256(Buffer.from(`leaf-${i}`));
}

function leaves(count: number): Buffer[] {
  return Array.from({ length: count }, (_, i) => leaf(i));
}

// Independent reference helpers — do NOT call production merkle functions.
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function leafHash(d: Buffer): Buffer {
  return sha256(Buffer.concat([LEAF_PREFIX, d]));
}

function node(l: Buffer, r: Buffer): Buffer {
  return sha256(Buffer.concat([NODE_PREFIX, l, r]));
}

describe('merkle', () => {
  describe('buildMerkleRoot', () => {
    it('throws on zero leaves', () => {
      expect(() => buildMerkleRoot([])).toThrow();
    });

    it('returns leafHash(d) for a single-leaf tree', () => {
      const d0 = leaf(0);
      expect(buildMerkleRoot([d0]).equals(leafHash(d0))).toBe(true);
    });

    it('hashes the pair for two leaves', () => {
      const [a, b] = leaves(2);
      expect(buildMerkleRoot([a, b]).equals(node(leafHash(a), leafHash(b)))).toBe(true);
    });

    it('builds an unbalanced tree for three leaves (no last-node duplication)', () => {
      const [a, b, c] = leaves(3);
      // k=2: root = node(node(L0,L1), L2) — NOT node(node(L0,L1), node(L2,L2))
      const expected = node(node(leafHash(a), leafHash(b)), leafHash(c));
      expect(buildMerkleRoot([a, b, c]).equals(expected)).toBe(true);
    });

    it('builds a balanced tree for four leaves', () => {
      const [a, b, c, d] = leaves(4);
      const expected = node(node(leafHash(a), leafHash(b)), node(leafHash(c), leafHash(d)));
      expect(buildMerkleRoot([a, b, c, d]).equals(expected)).toBe(true);
    });

    it('is deterministic across repeated calls', () => {
      const ls = leaves(4);
      expect(buildMerkleRoot(ls).equals(buildMerkleRoot(ls))).toBe(true);
    });

    it('CVE-2012-2459: three-leaf and four-leaf-with-duplicated-last produce different roots', () => {
      const [a, b, c] = leaves(3);
      const root3 = buildMerkleRoot([a, b, c]);
      const root4dup = buildMerkleRoot([a, b, c, c]);
      expect(root3.equals(root4dup)).toBe(false);
    });

    it('applies domain-separation prefixes (leaf and node)', () => {
      const d = leaf(0);
      const root1 = buildMerkleRoot([d]);
      // Single leaf is leafHash(d), not the raw digest.
      expect(root1.equals(d)).toBe(false);
      expect(root1.equals(leafHash(d))).toBe(true);

      const [a, b] = leaves(2);
      const root2 = buildMerkleRoot([a, b]);
      // Two leaves use node() with 0x01 prefix, not bare sha256 of concatenated leaf hashes.
      const bareNoPrefix = sha256(Buffer.concat([leafHash(a), leafHash(b)]));
      expect(root2.equals(bareNoPrefix)).toBe(false);
      expect(root2.equals(node(leafHash(a), leafHash(b)))).toBe(true);
    });
  });

  describe('inclusion proof + verification', () => {
    for (let size = 1; size <= 5; size++) {
      it(`verifies every leaf in a tree of size ${size}`, () => {
        const ls = leaves(size);
        const root = buildMerkleRoot(ls);

        for (let index = 0; index < size; index++) {
          const proof = merkleInclusionProof(ls, index);
          expect(verifyMerkleProof(ls[index], proof, root)).toBe(true);
        }
      });
    }

    it('produces an empty proof for a single-leaf tree', () => {
      const ls = leaves(1);
      expect(merkleInclusionProof(ls, 0)).toEqual([]);
    });

    it('throws for an out-of-range index', () => {
      const ls = leaves(3);
      expect(() => merkleInclusionProof(ls, 3)).toThrow();
      expect(() => merkleInclusionProof(ls, -1)).toThrow();
    });

    it('throws for a proof over zero leaves', () => {
      expect(() => merkleInclusionProof([], 0)).toThrow();
    });
  });

  describe('tamper detection', () => {
    const ls = leaves(4);
    const root = buildMerkleRoot(ls);
    const index = 1;
    const proof = merkleInclusionProof(ls, index);

    it('rejects a manipulated leaf', () => {
      const tampered = sha256(Buffer.from('not-the-original-leaf'));
      expect(verifyMerkleProof(tampered, proof, root)).toBe(false);
    });

    it('rejects a tampered sibling in the proof', () => {
      const badProof = proof.map((s, i) => (i === 0 ? { ...s, sibling: sha256(Buffer.from('wrong')) } : s));
      expect(verifyMerkleProof(ls[index], badProof, root)).toBe(false);
    });

    it('rejects a flipped left/right position', () => {
      const badProof = proof.map((s) => ({ ...s, right: !s.right }));
      expect(verifyMerkleProof(ls[index], badProof, root)).toBe(false);
    });

    it('rejects verification against a wrong root', () => {
      const wrongRoot = sha256(Buffer.from('some-other-root'));
      expect(verifyMerkleProof(ls[index], proof, wrongRoot)).toBe(false);
    });

    it("rejects another leaf's proof for this leaf", () => {
      const otherProof = merkleInclusionProof(ls, 2);
      expect(verifyMerkleProof(ls[index], otherProof, root)).toBe(false);
    });
  });
});
