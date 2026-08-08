import { I18nService } from 'nestjs-i18n';
import { Config, ConfigService, Environment } from 'src/config/config';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { ErrorMonitoringMail } from '../../entities/mail/error-monitoring-mail';
import { InternalMail } from '../../entities/mail/internal-mail';
import { PersonalMail } from '../../entities/mail/personal-mail';
import { UserMailV2 } from '../../entities/mail/user-mail-v2';
import { MailContext, MailContextType, MailType } from '../../enums';
import { MailRequest } from '../../interfaces';
import { MailFactory, MailKey, MailTranslationKey } from '../mail.factory';

describe('MailFactory', () => {
  let factory: MailFactory;
  let translate: jest.Mock;

  beforeAll(() => {
    if (!process.env.ENVIRONMENT) process.env.ENVIRONMENT = Environment.LOC;
    new ConfigService();
  });

  beforeEach(() => {
    translate = jest.fn((key: string, opts?: { lang?: string; args?: Record<string, string> }) => {
      // nestjs-i18n returns the key itself when nothing matches; the factory relies on that.
      if (key.includes('missing')) return key;
      if (key.endsWith('.body') && key.includes('mail-denario')) return 'wallet body override';
      // Wallet-scoped keys look like `mail-denario.template.closing` (not `mail.template.`).
      const templateIdx = key.indexOf('.template.');
      if (templateIdx >= 0) {
        const suffix = key.slice(templateIdx + '.template.'.length);
        const brand: Record<string, string> = {
          closing: 'Kind regards',
          sign_off: 'Denario',
          disclaimer: 'Disclaimer text',
          legal_address: 'Street 1',
          privacy_label: 'Privacy',
          privacy_url: 'https://example.com/privacy',
          imprint_label: 'Imprint',
          imprint_url: 'https://example.com/imprint',
          website_url: 'https://example.com',
          logo_url: 'https://example.com/logo.png',
          logo_alt: 'Logo',
        };
        // Empty string exercises the "unset" path in getWalletBrand.pick
        if (suffix === 'empty_field') return '';
        return brand[suffix] ?? key;
      }
      if (key.includes('[url:')) return key; // keep special tags intact
      if (key.includes('[mail:')) return key;
      if (opts?.args) {
        return Object.entries(opts.args).reduce(
          (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
          `translated:${key}`,
        );
      }
      return `translated:${key}`;
    });

    factory = new MailFactory({ translate } as unknown as I18nService);
  });

  function userData(overrides: Record<string, unknown> = {}) {
    return createCustomUserData({
      id: 1,
      mail: 'user@example.com',
      firstname: 'Ada',
      language: { id: 1, symbol: 'EN' } as any,
      ...overrides,
    });
  }

  function wallet(name: string, mailConfig?: string): Wallet {
    return Object.assign(new Wallet(), { name, mailConfig });
  }

  //*** createMail switch ***//

  it('creates an internal mail', () => {
    const request: MailRequest = {
      type: MailType.INTERNAL,
      context: MailContext.MONITORING,
      correlationId: 'i-1',
      input: {
        to: 'ops@dfx.swiss',
        title: 'Internal title',
        salutation: { key: 'mail.general.hi' },
        prefix: [{ key: 'mail.general.support' }],
      },
    };

    const mail = factory.createMail(request) as InternalMail;

    expect(mail).toBeInstanceOf(InternalMail);
    expect(mail.template).toBe('internal');
    expect(mail.subject).toBe('Internal title');
    expect(mail.templateParams.salutation).toBe('mail.general.hi');
    expect(mail.templateParams.prefix).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.any(String) })]),
    );
  });

  it('creates an internal mail without optional salutation and prefix', () => {
    const mail = factory.createMail({
      type: MailType.INTERNAL,
      context: MailContext.MONITORING,
      input: { to: 'ops@dfx.swiss', title: 'Bare' },
    } as MailRequest) as InternalMail;

    expect(mail.templateParams.salutation).toBeUndefined();
    expect(mail.templateParams.prefix).toBeUndefined();
  });

  it('creates a generic mail with default social params', () => {
    const mail = factory.createMail({
      type: MailType.GENERIC,
      context: MailContext.CUSTOM,
      correlationId: 'g-1',
      input: {
        to: 'user@example.com',
        subject: 'Hello',
        salutation: 'Hi',
        body: 'Body',
      },
    } as MailRequest);

    expect(mail.templateParams.twitterUrl).toBe(Config.social.twitter);
    expect(mail.templateParams.telegramUrl).toBe(Config.social.telegram);
    expect(mail.subject).toBe('Hello');
    expect(mail.to).toBe('user@example.com');
  });

  it('creates an error-monitoring mail', () => {
    const mail = factory.createMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      correlationId: 'e-1',
      input: { subject: 'Boom', errors: ['a', 'b'] },
    } as MailRequest) as ErrorMonitoringMail;

    expect(mail).toBeInstanceOf(ErrorMonitoringMail);
    expect(mail.subject).toContain('Boom');
  });

  it('throws on an unsupported mail type', () => {
    expect(() =>
      factory.createMail({ type: 'Nope' as MailType, context: MailContext.CUSTOM, input: {} as any }),
    ).toThrow(/Unsupported mail type/);
  });

  //*** User V2 ***//

  it('returns undefined when the wallet has disabled the mail context', () => {
    const mail = factory.createMail({
      type: MailType.USER_V2,
      context: MailContext.SUPPORT_MESSAGE,
      input: {
        userData: userData(),
        wallet: wallet('DFX', MailContextType.INFO),
        title: 'mail.support_message.title',
        texts: [],
      },
    } as MailRequest);

    expect(mail).toBeUndefined();
  });

  it('builds a UserMailV2 without a wallet (DFX defaults)', () => {
    const mail = factory.createMail({
      type: MailType.USER_V2,
      context: MailContext.VERIFICATION_MAIL,
      correlationId: 'u-1',
      options: { suppressRecurring: true },
      input: {
        userData: userData(),
        title: `${MailTranslationKey.VERIFICATION_CODE}.default.title`,
        salutation: { key: `${MailTranslationKey.VERIFICATION_CODE}.default.salutation` },
        texts: [{ key: `${MailTranslationKey.VERIFICATION_CODE}.message`, params: { code: '123' } }],
      },
    } as MailRequest) as UserMailV2;

    expect(mail).toBeInstanceOf(UserMailV2);
    expect(mail.template).toBe('user-v2');
    expect(mail.to).toBe('user@example.com');
    expect(mail.templateParams.hasWelcome).toBe(false);
    expect(mail.templateParams.brand).toBeUndefined();
  });

  it('uses forcedLang and centralized welcome for preferred wallets', () => {
    // Ensure RealUnit is present even when REALUNIT_MAIL_USER is unset in the test env.
    const previous = Config.mail.wallet.RealUnit;
    Config.mail.wallet.RealUnit = {
      template: 'realunit',
      forcedLang: 'de',
      centralizedWelcome: true,
      displayName: 'RealUnit',
    };

    try {
      const mail = factory.createMail({
        type: MailType.USER_V2,
        context: MailContext.VERIFICATION_MAIL,
        input: {
          userData: userData({ firstname: 'Ada', language: { id: 1, symbol: 'EN' } as any }),
          wallet: wallet('RealUnit'),
          title: `${MailTranslationKey.VERIFICATION_CODE}.default.title`,
          texts: undefined,
        },
      } as MailRequest) as UserMailV2;

      expect(mail.template).toBe('realunit');
      expect(mail.templateParams.hasWelcome).toBe(true);
      // forcedLang 'de' must drive translate calls
      expect(translate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ lang: 'de' }));
    } finally {
      if (previous === undefined) delete Config.mail.wallet.RealUnit;
      else Config.mail.wallet.RealUnit = previous;
    }
  });

  it('skips centralized welcome when the user has no usable name', () => {
    const previous = Config.mail.wallet.Denario;
    expect(previous?.centralizedWelcome).toBe(true);

    const mail = factory.createMail({
      type: MailType.USER_V2,
      context: MailContext.VERIFICATION_MAIL,
      input: {
        userData: userData({ firstname: '  ', organizationName: undefined }),
        wallet: wallet('Denario'),
        title: `${MailTranslationKey.VERIFICATION_CODE}.default.title`,
        texts: [],
      },
    } as MailRequest) as UserMailV2;

    expect(mail.templateParams.hasWelcome).toBe(false);
  });

  it('prepends wallet body override when a wallet-only body translation exists', () => {
    const mail = factory.createMail({
      type: MailType.USER_V2,
      context: MailContext.VERIFICATION_MAIL,
      input: {
        userData: userData({ firstname: undefined, organizationName: undefined }),
        wallet: wallet('Denario'),
        title: 'mail.verification_code.default.title',
        texts: [{ key: 'mail.verification_code.message' }],
      },
    } as MailRequest) as UserMailV2;

    // bodyKey = title with .title → .body; translate mock returns a wallet body for mail-denario.*.body
    expect(mail.templateParams.texts.length).toBeGreaterThan(0);
  });

  //*** Personal ***//

  it('returns undefined for personal mail when the wallet disabled the context', () => {
    const mail = factory.createMail({
      type: MailType.PERSONAL,
      context: MailContext.LIMIT_REQUEST,
      input: {
        userData: userData(),
        wallet: wallet('DFX', MailContextType.ALL),
        title: 'mail.limit_request.title',
        banner: 'https://example.com/b.png',
      },
    } as MailRequest);

    expect(mail).toBeUndefined();
  });

  it('creates a personal mail without a wallet and without prefix', () => {
    const mail = factory.createMail({
      type: MailType.PERSONAL,
      context: MailContext.LIMIT_REQUEST,
      correlationId: 'p-1',
      input: {
        userData: userData(),
        title: 'mail.limit_request.title',
        banner: 'https://example.com/b.png',
        from: 'from@example.com',
        displayName: 'Support',
        bcc: 'bcc@example.com',
      },
    } as MailRequest) as PersonalMail;

    expect(mail).toBeInstanceOf(PersonalMail);
    expect(mail.template).toBe('personal');
    expect(mail.to).toBe('user@example.com');
    expect(mail.bcc).toBe('bcc@example.com');
  });

  it('creates a personal mail with a branded wallet and prefix', () => {
    const mail = factory.createMail({
      type: MailType.PERSONAL,
      context: MailContext.LIMIT_REQUEST,
      input: {
        userData: userData({ organizationName: 'ACME' }),
        wallet: wallet('Denario'),
        title: 'mail.limit_request.title',
        prefix: [{ key: 'mail.limit_request.message', params: { limitAmount: '1000' } }],
        banner: 'https://example.com/b.png',
      },
    } as MailRequest) as PersonalMail;

    expect(mail).toBeInstanceOf(PersonalMail);
    expect(mail.templateParams.prefix.length).toBeGreaterThan(0);
  });

  //*** translate / brand / affix helpers ***//

  it('prefers a wallet-scoped translation when present', () => {
    translate.mockImplementation((key: string) => {
      if (key.startsWith('mail-denario.')) return 'wallet-copy';
      return key;
    });

    expect(factory.translate('mail.general.support', 'en', undefined, 'Denario')).toBe('wallet-copy');
  });

  it('falls back to the default key when the wallet key is missing', () => {
    translate.mockImplementation((key: string) => key);

    expect(factory.translate('mail.general.support', 'en', undefined, 'Denario')).toBe('mail.general.support');
  });

  it('returns undefined brand when walletName is missing', () => {
    const brand = (factory as any).getWalletBrand('en', undefined);
    expect(brand).toBeUndefined();
  });

  it('returns undefined brand when every template field is empty', () => {
    translate.mockImplementation((key: string) => (key.includes('.template.') ? '' : key));

    const brand = (factory as any).getWalletBrand('en', 'Denario');
    expect(brand).toBeUndefined();
  });

  it('builds a brand with complete privacy/imprint pairs and hasLegalLead', () => {
    const brand = (factory as any).getWalletBrand('en', 'Denario');

    expect(brand).toEqual(
      expect.objectContaining({
        closing: 'Kind regards',
        legalAddress: 'Street 1',
        privacyLabel: 'Privacy',
        privacyUrl: 'https://example.com/privacy',
        imprintLabel: 'Imprint',
        imprintUrl: 'https://example.com/imprint',
        hasLegalLead: true,
      }),
    );
  });

  it('drops incomplete privacy/imprint pairs from the brand', () => {
    translate.mockImplementation((key: string) => {
      if (key.endsWith('privacy_label')) return 'Privacy';
      if (key.endsWith('privacy_url')) return ''; // incomplete pair
      if (key.endsWith('imprint_label')) return 'Imprint';
      if (key.endsWith('imprint_url')) return ''; // incomplete pair
      if (key.endsWith('legal_address')) return '';
      if (key.includes('mail.template.')) return '';
      return key;
    });

    const brand = (factory as any).getWalletBrand('en', 'Denario');
    // every field empty → undefined brand
    expect(brand).toBeUndefined();
  });

  it('returns no wallet body texts when walletName is missing or body is missing', () => {
    expect((factory as any).getWalletBodyTexts('mail.x.title', 'en', undefined)).toEqual([]);

    translate.mockImplementation((key: string) => key); // wallet-only lookup returns key → undefined
    expect((factory as any).getWalletBodyTexts('mail.x.title', 'en', 'Denario')).toEqual([]);
  });

  it('skips the DFX team closing for centralizedWelcome wallets', () => {
    const affix = (factory as any).mapMailAffix({ key: MailKey.DFX_TEAM_CLOSING }, 'en', 'Denario');
    expect(affix).toEqual([]);
  });

  it('keeps the DFX team closing for wallets without centralizedWelcome', () => {
    const affix = (factory as any).mapMailAffix({ key: MailKey.DFX_TEAM_CLOSING }, 'en', 'DFX');
    expect(affix.length).toBeGreaterThan(0);
    expect(affix.some((a: { style?: string }) => a.style === 'Zapfino')).toBe(true);
  });

  it('maps SPACE to an empty line and filters falsy affix entries', () => {
    const result = (factory as any).getMailAffix(
      [null, { key: MailKey.SPACE, params: { value: '2' } }, undefined],
      'en',
    );
    expect(result).toEqual([{ text: '', style: expect.any(String) }]);
  });

  it('parses url and mail special tags and maps params', () => {
    translate.mockImplementation((key: string, opts?: { args?: Record<string, string> }) => {
      if (key === 'mail.with.url') return 'Click [url:Klick hier] now';
      if (key === 'mail.with.mail') return 'Write [mail:support@dfx.swiss] please';
      if (key === 'mail.with.https') return 'Open [url:https://app.dfx.swiss/settings]';
      if (opts?.args) return key;
      return key;
    });

    const [urlAffix] = (factory as any).mapMailAffix(
      { key: 'mail.with.url', params: { url: 'https://app.dfx.swiss/kyc', button: 'true', style: 'Custom' } },
      'en',
    );
    expect(urlAffix.url).toEqual(
      expect.objectContaining({
        link: 'https://app.dfx.swiss/kyc',
        text: 'Klick hier',
        button: 'true',
      }),
    );
    expect(urlAffix.style).toBe('Custom');

    const [mailAffix] = (factory as any).mapMailAffix({ key: 'mail.with.mail', params: { button: 'false' } }, 'en');
    expect(mailAffix.mail).toEqual(expect.objectContaining({ address: 'support@dfx.swiss', button: 'false' }));

    const [httpsAffix] = (factory as any).mapMailAffix(
      { key: 'mail.with.https', params: { url: 'https://app.dfx.swiss/kyc' } },
      'en',
    );
    // absolute tag wins over caller url
    expect(httpsAffix.url.link).toBe('https://app.dfx.swiss/settings');
  });

  it('falls back to the tag value when the caller passes no url', () => {
    translate.mockImplementation((key: string) => (key === 'mail.link' ? 'Go [url:display-text]' : key));

    const [affix] = (factory as any).mapMailAffix({ key: 'mail.link' }, 'en');
    expect(affix.url.link).toBe('display-text');
  });

  it('skips empty wallet overrides for centralizedWelcome wallets', () => {
    translate.mockImplementation((key: string) => {
      if (key.startsWith('mail-denario.') || key === 'mail.empty') return '';
      return key;
    });

    const empty = (factory as any).mapMailAffix({ key: 'mail.empty' }, 'en', 'Denario');
    expect(empty).toEqual([]);
  });

  it('does not skip empty text for wallets without centralizedWelcome', () => {
    translate.mockImplementation(() => '');

    const affix = (factory as any).mapMailAffix({ key: 'mail.empty' }, 'en', 'DFX');
    expect(affix).toHaveLength(1);
    expect(affix[0].text).toBe('');
  });

  it('translateParams maps every entry through translate and returns {} for null params', () => {
    translate.mockImplementation((key: string) => `T:${key}`);

    expect((factory as any).translateParams({ a: 'mail.a', b: 'mail.b' }, 'en', undefined)).toEqual({
      a: 'T:mail.a',
      b: 'T:mail.b',
    });
    expect((factory as any).translateParams(undefined, 'en')).toEqual({});
  });

  it('parseMailKey converts camelCase values to snake_case keys', () => {
    expect(MailFactory.parseMailKey(MailTranslationKey.PENDING, 'manualCheckPhone')).toBe(
      'mail.payment.pending.manual_check_phone',
    );
  });

  it('resolves a plain-object wallet without disabledMailTypes via Object.assign', () => {
    // isDisabledMailWallet re-hydrates plain wallet objects so the disabledMailTypes getter exists.
    const mail = factory.createMail({
      type: MailType.USER_V2,
      context: MailContext.SUPPORT_MESSAGE,
      input: {
        userData: userData(),
        wallet: { name: 'DFX' } as Wallet,
        title: 'mail.support_message.title',
        texts: [],
      },
    } as MailRequest);

    expect(mail).toBeInstanceOf(UserMailV2);
  });
});
