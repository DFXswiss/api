import { buildMerkleRoot, merkleInclusionProof, sha256, verifyMerkleProof } from '../merkle';

/** Deterministic leaf: sha256 of `leaf-<i>` so tests don't depend on random data. */
function leaf(i: number): Buffer {
  return sha256(Buffer.from(`leaf-${i}`));
}

function leaves(count: number): Buffer[] {
  return Array.from({ length: count }, (_, i) => leaf(i));
}

/** Reference parent hash matching the module's documented `sha256(left || right)` rule. */
function parent(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([left, right]));
}

describe('merkle', () => {
  describe('buildMerkleRoot', () => {
    it('throws on zero leaves', () => {
      expect(() => buildMerkleRoot([])).toThrow();
    });

    it('returns the leaf itself for a single-leaf tree', () => {
      const l = leaf(0);
      expect(buildMerkleRoot([l]).equals(l)).toBe(true);
    });

    it('hashes the pair for two leaves', () => {
      const [a, b] = leaves(2);
      expect(buildMerkleRoot([a, b]).equals(parent(a, b))).toBe(true);
    });

    it('duplicates the last node for three leaves', () => {
      const [a, b, c] = leaves(3);
      // level 1: [h(a,b), h(c,c)]  ->  root: h( h(a,b), h(c,c) )
      const expected = parent(parent(a, b), parent(c, c));
      expect(buildMerkleRoot([a, b, c]).equals(expected)).toBe(true);
    });

    it('builds a balanced tree for four leaves', () => {
      const [a, b, c, d] = leaves(4);
      const expected = parent(parent(a, b), parent(c, d));
      expect(buildMerkleRoot([a, b, c, d]).equals(expected)).toBe(true);
    });

    it('is deterministic across repeated calls', () => {
      const ls = leaves(4);
      expect(buildMerkleRoot(ls).equals(buildMerkleRoot(ls))).toBe(true);
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
