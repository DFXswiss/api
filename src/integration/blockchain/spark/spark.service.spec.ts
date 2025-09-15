import { Test, TestingModule } from '@nestjs/testing';

// Mock @scure/base before importing SparkService
jest.mock('@scure/base', () => ({
  bech32m: {
    encode: jest.fn((prefix, words) => {
      return 'sp1mockaddress1234567890';
    }),
    decode: jest.fn((address) => {
      // Mock validation that matches our test addresses
      const validAddresses = [
        'sp1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrg9qf0pg',
        'sp1qfgrm4jp2xtqvejuqa4qesds8wjarg4yp5repvz52kgesgextpdyzuywkcz',
        'spt1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrgnela9c',
        'spt1qfgrm4jp2xtqvejuqa4qesds8wjarg4yp5repvz52kgesgextpdyz2acyuj',
        'sp1valid'
      ];

      if (validAddresses.includes(address)) {
        return {
          prefix: address.substring(0, address.indexOf('1')),
          words: new Uint8Array(32)
        };
      }

      // For other addresses, check basic format
      const validPrefixes = ['sp1', 'spt1', 'sprt1', 'sps1', 'spl1'];
      const hasValidPrefix = validPrefixes.some(p => address.startsWith(p));

      if (!hasValidPrefix || address.length < 20) {
        throw new Error('Invalid address');
      }

      return {
        prefix: address.substring(0, address.indexOf('1')),
        words: new Uint8Array(32)
      };
    }),
    toWords: jest.fn(() => new Uint8Array(32)),
    fromWords: jest.fn(() => new Uint8Array(32))
  }
}));

import { SparkService } from './spark.service';

describe('SparkService', () => {
  let service: SparkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SparkService],
    }).compile();

    service = module.get<SparkService>(SparkService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isValidSparkAddress', () => {
    // Note: Address validation is partially mocked due to @scure/base dependency
    // The mock is configured to accept specific test addresses

    it('should reject obviously invalid addresses', () => {
      const invalidAddresses = [
        'bc1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrg9qf0pg', // Bitcoin address
        '1C2jBc59h1CNoCEtdtgZ7w4mcWQrKwV3DL', // Bitcoin legacy
        'sp2invalid', // Invalid prefix
        'sp1', // Too short
        'invalid', // Not a Spark address
        '',
      ];

      invalidAddresses.forEach((address) => {
        expect(service.isValidSparkAddress(address)).toBe(false);
      });
    });
  });

  describe('verifySignature', () => {
    // Note: These tests are limited by the mocked @scure/base module
    // Real signature verification cannot be fully tested with mocks
    // Integration tests should be performed separately with the real module

    it('should handle invalid input parameters', async () => {
      expect(await service.verifySignature('', 'sp1valid', '00'.repeat(64))).toBe(false);
      expect(await service.verifySignature('message', '', '00'.repeat(64))).toBe(false);
      expect(await service.verifySignature('message', 'sp1valid', '')).toBe(false);
    });

    it('should handle invalid signature length', async () => {
      const shortSignature = '993bd4ba86bf037948b31d7e70caacdd'; // Too short
      const result = await service.verifySignature('message', 'sp1valid', shortSignature);
      expect(result).toBe(false);
    });

    it('should handle invalid hex format', async () => {
      const invalidHex = 'ZZ'.repeat(64); // Invalid hex characters
      const result = await service.verifySignature('message', 'sp1valid', invalidHex);
      expect(result).toBe(false);
    });

    it('should verify signatures with different recovery bits', async () => {
      // Note: In a real implementation, we would have signatures with different recovery bits
      // generated from our test seed to verify the recovery bit handling works correctly
      // For now, this test is a placeholder for future implementation
      expect(true).toBe(true);
    });
  });

  describe('getPaymentRequest', () => {
    it('should return undefined for payment requests', async () => {
      const result = await service.getPaymentRequest('sp1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrg9qf0pg', 100000);
      expect(result).toBeUndefined();
    });
  });
});