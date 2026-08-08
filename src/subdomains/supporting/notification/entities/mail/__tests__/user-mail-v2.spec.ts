import { Config, ConfigService } from 'src/config/config';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { UserMailV2 } from '../user-mail-v2';

/**
 * Pins the partner-brand vs DFX-default template selection that UserMailV2 makes from
 * Config.mail.wallet[wallet.name]?.template. The fallback branch (no wallet / no template)
 * is the path every unbranded customer mail takes.
 */
describe('UserMailV2', () => {
  beforeAll(() => {
    new ConfigService();
  });

  const baseParams = {
    to: 'user@example.com',
    subject: 'Verification code',
    salutation: 'Hello',
    texts: [],
  };

  it('falls back to user-v2 when wallet is undefined', () => {
    const mail = new UserMailV2(baseParams, undefined as unknown as Wallet);

    expect(mail.template).toBe('user-v2');
    expect(mail.walletName).toBeUndefined();
  });

  it('falls back to user-v2 when wallet has no name', () => {
    const mail = new UserMailV2(baseParams, Object.assign(new Wallet(), {}));

    expect(mail.template).toBe('user-v2');
    expect(mail.walletName).toBeUndefined();
  });

  it('falls back to user-v2 when wallet name has no mail config entry', () => {
    const mail = new UserMailV2(baseParams, Object.assign(new Wallet(), { name: 'UnknownWalletXYZ' }));

    expect(mail.template).toBe('user-v2');
    expect(mail.walletName).toBe('UnknownWalletXYZ');
  });

  it('falls back to user-v2 when wallet config exists but has no template', () => {
    const previous = Config.mail.wallet['NoTemplateWallet'];
    Config.mail.wallet['NoTemplateWallet'] = { displayName: 'NoTemplate' };

    try {
      const mail = new UserMailV2(baseParams, Object.assign(new Wallet(), { name: 'NoTemplateWallet' }));

      expect(mail.template).toBe('user-v2');
      expect(mail.walletName).toBe('NoTemplateWallet');
    } finally {
      if (previous === undefined) delete Config.mail.wallet['NoTemplateWallet'];
      else Config.mail.wallet['NoTemplateWallet'] = previous;
    }
  });

  it('uses the wallet template when Config.mail.wallet provides one', () => {
    const mail = new UserMailV2(baseParams, Object.assign(new Wallet(), { name: 'Denario' }));

    expect(mail.template).toBe('denario');
    expect(mail.walletName).toBe('Denario');
  });

  it('merges default social URLs into templateParams', () => {
    const mail = new UserMailV2(baseParams, Object.assign(new Wallet(), { name: 'DFX' }));

    expect(mail.templateParams.twitterUrl).toBe(Config.social.twitter);
    expect(mail.templateParams.telegramUrl).toBe(Config.social.telegram);
    expect(mail.templateParams.linkedinUrl).toBe(Config.social.linkedin);
    expect(mail.templateParams.instagramUrl).toBe(Config.social.instagram);
    expect(mail.templateParams.to).toBe(baseParams.to);
    expect(mail.templateParams.subject).toBe(baseParams.subject);
  });
});
