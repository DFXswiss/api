import { deserializeMerkleProof, serializeMerkleProof } from '../merkle-proof-codec';
import { MerkleProofStep } from '../merkle';

describe('merkle-proof-codec', () => {
  const validSibling = Buffer.alloc(32, 0xab);
  const validSteps: MerkleProofStep[] = [
    { sibling: validSibling, right: true },
    { sibling: Buffer.alloc(32, 0xcd), right: false },
  ];

  describe('serializeMerkleProof / deserializeMerkleProof roundtrip', () => {
    it('returns equivalent steps after serialize then deserialize', () => {
      const json = serializeMerkleProof(validSteps);
      const restored = deserializeMerkleProof(json);

      expect(restored).toHaveLength(2);
      expect(restored[0].right).toBe(true);
      expect(restored[0].sibling.equals(validSibling)).toBe(true);
      expect(restored[1].right).toBe(false);
      expect(restored[1].sibling.equals(Buffer.alloc(32, 0xcd))).toBe(true);
    });
  });

  describe('deserializeMerkleProof validation', () => {
    it('throws when JSON is not an array', () => {
      expect(() => deserializeMerkleProof(JSON.stringify({ sibling: 'x', right: true }))).toThrow(
        'expected an array of steps',
      );
    });

    it('throws on non-hex sibling', () => {
      const json = JSON.stringify([{ sibling: 'g'.repeat(64), right: true }]);
      expect(() => deserializeMerkleProof(json)).toThrow('Invalid merkle proof step at index 0');
    });

    it('throws on wrong-length hex sibling (63 chars)', () => {
      const json = JSON.stringify([{ sibling: 'a'.repeat(63), right: true }]);
      expect(() => deserializeMerkleProof(json)).toThrow('Invalid merkle proof step at index 0');
    });

    it('throws on wrong-length hex sibling (65 chars)', () => {
      const json = JSON.stringify([{ sibling: 'a'.repeat(65), right: true }]);
      expect(() => deserializeMerkleProof(json)).toThrow('Invalid merkle proof step at index 0');
    });

    it('throws on uppercase hex sibling (lowercase required)', () => {
      const json = JSON.stringify([{ sibling: 'A'.repeat(64), right: true }]);
      expect(() => deserializeMerkleProof(json)).toThrow('Invalid merkle proof step at index 0');
    });

    it('throws on non-boolean right', () => {
      const json = JSON.stringify([{ sibling: 'a'.repeat(64), right: 'yes' }]);
      expect(() => deserializeMerkleProof(json)).toThrow('Invalid merkle proof step at index 0');
    });
  });
});
