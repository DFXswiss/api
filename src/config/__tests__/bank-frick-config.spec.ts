import { GetConfig } from '../config';

describe('Bank Frick config', () => {
  it('restores PEM line breaks in the private key', () => {
    const previousPrivateKey = process.env.FRICK_PRIVATE_KEY;
    const previousServerPublicKey = process.env.FRICK_SERVER_PUBLIC_KEY;
    process.env.FRICK_PRIVATE_KEY = 'synthetic-line-one<br>synthetic-line-two';
    process.env.FRICK_SERVER_PUBLIC_KEY = 'synthetic-public-one<br>synthetic-public-two';

    try {
      expect(GetConfig().bank.frick.privateKey).toBe('synthetic-line-one\nsynthetic-line-two');
      expect(GetConfig().bank.frick.serverPublicKey).toBe('synthetic-public-one\nsynthetic-public-two');
    } finally {
      if (previousPrivateKey === undefined) delete process.env.FRICK_PRIVATE_KEY;
      else process.env.FRICK_PRIVATE_KEY = previousPrivateKey;
      if (previousServerPublicKey === undefined) delete process.env.FRICK_SERVER_PUBLIC_KEY;
      else process.env.FRICK_SERVER_PUBLIC_KEY = previousServerPublicKey;
    }
  });
});
