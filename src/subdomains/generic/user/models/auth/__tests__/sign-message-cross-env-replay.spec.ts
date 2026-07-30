import { ethers } from 'ethers';
import { verifyMessage } from 'ethers/lib/utils';
import { Configuration } from 'src/config/config';

// Test-only private key — never a real wallet; exists solely in this unit test.
const wallet = new ethers.Wallet('0x' + '01'.repeat(32));

describe("sign-message cross-env replay (a signature valid on one environment's text must not verify on another's)", () => {
  const originalEnv = process.env.ENVIRONMENT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENVIRONMENT;
    } else {
      process.env.ENVIRONMENT = originalEnv;
    }
  });

  it('signMessageGeneral: PRD signature must not verify under the DEV message (and vice versa)', async () => {
    process.env.ENVIRONMENT = 'prd';
    const prdConfig = new Configuration();
    const prdMessage = prdConfig.auth.signMessageGeneral + wallet.address;
    const signature = await wallet.signMessage(prdMessage);

    expect(verifyMessage(prdMessage, signature).toLowerCase()).toBe(wallet.address.toLowerCase());

    process.env.ENVIRONMENT = 'dev';
    const devConfig = new Configuration();
    const devMessage = devConfig.auth.signMessageGeneral + wallet.address;

    expect(verifyMessage(devMessage, signature).toLowerCase()).not.toBe(wallet.address.toLowerCase());

    const devSignature = await wallet.signMessage(devMessage);
    expect(verifyMessage(prdMessage, devSignature).toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });

  it('signMessage: PRD signature must not verify under the DEV message (and vice versa)', async () => {
    process.env.ENVIRONMENT = 'prd';
    const prdConfig = new Configuration();
    const prdMessage = prdConfig.auth.signMessage + wallet.address;
    const signature = await wallet.signMessage(prdMessage);

    expect(verifyMessage(prdMessage, signature).toLowerCase()).toBe(wallet.address.toLowerCase());

    process.env.ENVIRONMENT = 'dev';
    const devConfig = new Configuration();
    const devMessage = devConfig.auth.signMessage + wallet.address;

    expect(verifyMessage(devMessage, signature).toLowerCase()).not.toBe(wallet.address.toLowerCase());

    const devSignature = await wallet.signMessage(devMessage);
    expect(verifyMessage(prdMessage, devSignature).toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });
});
