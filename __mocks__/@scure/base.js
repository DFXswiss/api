// Mock for @scure/base to avoid ESM import issues in Jest
module.exports = {
  bech32m: {
    encode: jest.fn((prefix, words) => {
      // Return a mock Spark address for testing
      return 'sp1mockaddressfromjest1234567890abcdef';
    }),
    decode: jest.fn((address) => {
      // Return mock decoded data
      return {
        prefix: 'sp1',
        words: new Uint8Array(32)
      };
    }),
    toWords: jest.fn((data) => {
      // Return mock words array
      return new Uint8Array(32);
    }),
    fromWords: jest.fn((words) => {
      // Return mock data
      return new Uint8Array(20);
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