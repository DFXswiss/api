// Guards the global bigint JSON serialization registered in src/polyfills.ts. Since §2.3 native-first exactness
// (#4287) raw-entity admin endpoints (e.g. buy-crypto PUT :id) return entities carrying `bigint` exact base-unit
// columns; without a toJSON, Express' JSON.stringify would throw `Do not know how to serialize a BigInt` and 500
// the moment such a row is populated. This proves a bigint serializes losslessly to a decimal STRING.
import 'src/polyfills';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';

describe('bigint JSON serialization polyfill (#4287)', () => {
  it('serializes a bigint field to a decimal string instead of throwing', () => {
    expect(() => JSON.stringify({ x: 1n })).not.toThrow();
    expect(JSON.stringify({ x: 1n })).toBe('{"x":"1"}');
  });

  it('preserves exact base-unit magnitudes that exceed 2^53 (why a string, not a number)', () => {
    // 18-dp wei of a large balance (~10^21) is far beyond Number.MAX_SAFE_INTEGER (2^53 ≈ 9.007e15)
    const wei = 12345678901234567890n;
    expect(wei > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(JSON.parse(JSON.stringify({ outputAmountBaseUnits: wei })).outputAmountBaseUnits).toBe(
      '12345678901234567890',
    );
  });

  it('lets a populated raw entity serialize without throwing (the HTTP-500 case)', () => {
    const buyCrypto = new BuyCrypto();
    buyCrypto.outputAmountBaseUnits = 12345678901234567890n;
    buyCrypto.inputAmountBaseUnits = 5000n;

    let json = '';
    expect(() => (json = JSON.stringify(buyCrypto))).not.toThrow();
    expect(JSON.parse(json)).toMatchObject({
      outputAmountBaseUnits: '12345678901234567890',
      inputAmountBaseUnits: '5000',
    });
  });
});
