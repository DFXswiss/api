// Mock for @scure/base to avoid ESM import issues in Jest
module.exports = {
  bech32m: {
    encode: jest.fn((prefix, words) => {
      // Return a mock Spark address for testing
      return 'sp1mockaddressfromjest1234567890abcdef';
    }),
    decode: jest.fn((address) => {
      // Mock validation for test addresses
      const validPrefixes = ['sp1', 'spt1', 'sprt1', 'sps1', 'spl1'];

      // Check if it's a valid test address format
      if (typeof address !== 'string' || address.length < 10) {
        throw new Error('Invalid address');
      }

      // Extract prefix (first 3-5 characters)
      let prefix = '';
      for (const p of validPrefixes) {
        if (address.startsWith(p)) {
          prefix = p;
          break;
        }
      }

      if (!prefix) {
        throw new Error('Invalid prefix');
      }

      // Return mock decoded data
      return {
        prefix: prefix,
        words: new Uint8Array(32)
      };
    }),
    toWords: jest.fn((data) => {
      // Return mock words array
      return new Uint8Array(32);
    }),
    fromWords: jest.fn((words) => {
      // Return mock data with correct length for Spark addresses (32 bytes for P2TR)
      return new Uint8Array(32);
    })
  },
  // Add base58 mocks for other modules that may use it
  createBase58check: jest.fn(() => ({
    encode: jest.fn(),
    decode: jest.fn()
  })),
  base58: {
    encode: jest.fn(),
    decode: jest.fn()
  },
  base58check: jest.fn(() => ({
    encode: jest.fn(),
    decode: jest.fn()
  }))
};