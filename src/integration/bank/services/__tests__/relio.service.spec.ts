/**
 * Unit tests for Relio service signing logic and amount conversion
 *
 * The signing functions are tested as standalone implementations
 * to validate the canonical string building logic that had multiple bug fixes.
 */

describe('RelioService', () => {
  // --- Signing Logic (standalone implementation matching RelioService) --- //

  /**
   * Build canonical body string with top-level sorted keys
   * Matches RelioService.buildCanonicalBody() exactly
   */
  function buildCanonicalBody(body: unknown): string {
    if (!body) {
      return '';
    }

    if (typeof body === 'object') {
      if (Array.isArray(body)) {
        return JSON.stringify(body);
      }

      const obj = body as Record<string, unknown>;
      const sortedKeys = Object.keys(obj).sort();
      const sortedObj: Record<string, unknown> = {};

      for (const key of sortedKeys) {
        sortedObj[key] = obj[key];
      }

      return JSON.stringify(sortedObj);
    }

    if (typeof body === 'string') {
      return body;
    }

    return JSON.stringify(body);
  }

  /**
   * Create canonical request string for signing
   * Matches RelioService.createCanonicalString() exactly
   */
  function createCanonicalString(method: string, originalUrl: string, body?: unknown): string {
    const canonicalBody = buildCanonicalBody(body);
    return `${method.toUpperCase()}${originalUrl}${canonicalBody}`;
  }

  // --- Amount Conversion (matching RelioService) --- //

  function convertRelioAmount(amount: string): number {
    const numericAmount = parseInt(amount, 10);
    if (isNaN(numericAmount)) return 0;
    return numericAmount / 100;
  }

  function toRelioAmount(amount: number): string {
    return Math.round(amount * 100).toString();
  }

  // --- Tests for buildCanonicalBody --- //

  describe('buildCanonicalBody', () => {
    it('should return empty string for null', () => {
      expect(buildCanonicalBody(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(buildCanonicalBody(undefined)).toBe('');
    });

    it('should return "{}" for empty object (truthy check)', () => {
      // This was a bug fix - empty object {} is truthy, so it should return '{}'
      expect(buildCanonicalBody({})).toBe('{}');
    });

    it('should sort top-level object keys alphabetically', () => {
      const body = { zebra: 1, apple: 2, mango: 3 };
      expect(buildCanonicalBody(body)).toBe('{"apple":2,"mango":3,"zebra":1}');
    });

    it('should NOT sort nested object keys (top-level only)', () => {
      const body = { b: { z: 1, a: 2 }, a: 'first' };
      // Top-level keys sorted: a, b
      // Nested object z, a stays as-is in the original order
      expect(buildCanonicalBody(body)).toBe('{"a":"first","b":{"z":1,"a":2}}');
    });

    it('should stringify arrays as-is without sorting', () => {
      const body = [3, 1, 2];
      expect(buildCanonicalBody(body)).toBe('[3,1,2]');
    });

    it('should stringify array of objects as-is', () => {
      const body = [{ b: 1, a: 2 }];
      expect(buildCanonicalBody(body)).toBe('[{"b":1,"a":2}]');
    });

    it('should return string as-is', () => {
      expect(buildCanonicalBody('already a string')).toBe('already a string');
    });

    it('should stringify numbers', () => {
      expect(buildCanonicalBody(42)).toBe('42');
    });

    it('should stringify true', () => {
      expect(buildCanonicalBody(true)).toBe('true');
    });

    it('should return empty string for false (falsy)', () => {
      // false is falsy, so it returns '' (same as null/undefined)
      expect(buildCanonicalBody(false)).toBe('');
    });

    it('should handle complex nested structure with top-level sorting only', () => {
      const body = {
        walletId: 'wallet-123',
        amount: { currency: 'CHF', value: '1000' },
        name: 'Test Payment',
      };
      // Top-level keys sorted: amount, name, walletId
      expect(buildCanonicalBody(body)).toBe(
        '{"amount":{"currency":"CHF","value":"1000"},"name":"Test Payment","walletId":"wallet-123"}',
      );
    });
  });

  // --- Tests for createCanonicalString --- //

  describe('createCanonicalString', () => {
    it('should create canonical string for GET request without body', () => {
      const result = createCanonicalString('GET', '/v1/auth/context');
      expect(result).toBe('GET/v1/auth/context');
    });

    it('should create canonical string for GET request with query params', () => {
      const result = createCanonicalString('GET', '/v1/wallets?pageNumber=1&pageSize=10');
      expect(result).toBe('GET/v1/wallets?pageNumber=1&pageSize=10');
    });

    it('should uppercase the method', () => {
      const result = createCanonicalString('get', '/v1/auth/context');
      expect(result).toBe('GET/v1/auth/context');
    });

    it('should create canonical string for POST request with body', () => {
      const body = { targetWalletId: 'target', sourceWalletId: 'source' };
      const result = createCanonicalString('POST', '/v1/quotes-fx', body);
      // Body keys sorted: sourceWalletId, targetWalletId
      expect(result).toBe('POST/v1/quotes-fx{"sourceWalletId":"source","targetWalletId":"target"}');
    });

    it('should handle DELETE request', () => {
      const result = createCanonicalString('DELETE', '/v1/accounts/123/payments/456');
      expect(result).toBe('DELETE/v1/accounts/123/payments/456');
    });
  });

  // --- Tests for Amount Conversion --- //

  describe('convertRelioAmount', () => {
    it('should convert minor units to major units', () => {
      expect(convertRelioAmount('98434500')).toBe(984345);
    });

    it('should handle cents correctly', () => {
      expect(convertRelioAmount('10050')).toBe(100.5);
    });

    it('should handle zero', () => {
      expect(convertRelioAmount('0')).toBe(0);
    });

    it('should return 0 for invalid input', () => {
      expect(convertRelioAmount('invalid')).toBe(0);
    });

    it('should return 0 for empty string', () => {
      expect(convertRelioAmount('')).toBe(0);
    });
  });

  describe('toRelioAmount', () => {
    it('should convert major units to minor units', () => {
      expect(toRelioAmount(984345)).toBe('98434500');
    });

    it('should handle decimals correctly', () => {
      expect(toRelioAmount(100.5)).toBe('10050');
    });

    it('should round to nearest cent', () => {
      expect(toRelioAmount(100.555)).toBe('10056');
      expect(toRelioAmount(100.554)).toBe('10055');
    });

    it('should handle zero', () => {
      expect(toRelioAmount(0)).toBe('0');
    });

    it('should handle small amounts', () => {
      expect(toRelioAmount(0.01)).toBe('1');
    });
  });
});
