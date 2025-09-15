// Global mock for @scure/base ESM module
// This is needed because Jest doesn't handle ESM modules well
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