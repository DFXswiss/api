import { GetConfig } from '../config';

describe('Bank Frick config', () => {
  it('restores PEM line breaks in the private key', () => {
    const previousPrivateKey = process.env.FRICK_PRIVATE_KEY;
    process.env.FRICK_PRIVATE_KEY = 'synthetic-line-one<br>synthetic-line-two';

    try {
      expect(GetConfig().bank.frick.privateKey).toBe('synthetic-line-one\nsynthetic-line-two');
    } finally {
      if (previousPrivateKey === undefined) delete process.env.FRICK_PRIVATE_KEY;
      else process.env.FRICK_PRIVATE_KEY = previousPrivateKey;
    }
  });
});
