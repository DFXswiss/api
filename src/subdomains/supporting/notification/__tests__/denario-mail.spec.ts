import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import { I18nModule, I18nService } from 'nestjs-i18n';
import * as path from 'path';
import { Config, ConfigService, GetConfig } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { UserMailV2 } from '../entities/mail/user-mail-v2';
import { MailContext, MailType } from '../enums';
import { MailFactory, MailKey, MailTranslationKey } from '../factories/mail.factory';
import { MailRequest } from '../interfaces';

/**
 * Denario (+ RealUnit regression) mail rendering: factory + templates + real i18n.
 * Renders HTML the same way MailService.compileTemplate does (handlebars on templateParams).
 */

function leaves(obj: unknown, prefix = ''): string[] {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function renderMailHtml(mail: UserMailV2): string {
  const templatePath = path.join(
    process.cwd(),
    'src/subdomains/supporting/notification/templates',
    `${mail.template}.hbs`,
  );
  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  return handlebars.compile(templateContent)(mail.templateParams);
}

/** Visible body only — pre-header also embeds salutation for inbox preview. */
function bodyHtml(html: string): string {
  const start = html.indexOf('id="u_body"');
  return start >= 0 ? html.slice(start) : html;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function userData(overrides: Partial<UserData> & { languageSymbol?: string } = {}): UserData {
  const { languageSymbol = 'EN', ...rest } = overrides;
  return {
    id: 1,
    mail: 'user@example.com',
    firstname: 'Joshua',
    organizationName: undefined,
    kycUrl: 'https://app.dfx.swiss/kyc?code=test',
    language: { symbol: languageSymbol },
    ...rest,
  } as unknown as UserData;
}

function wallet(name: string): Wallet {
  return { name } as Wallet;
}

/** Same input shape as TfaService.sendVerificationMail (default / 2FA). */
function verificationRequest(ud: UserData, w?: Wallet): MailRequest {
  return {
    type: MailType.USER_V2,
    context: MailContext.VERIFICATION_MAIL,
    input: {
      userData: ud,
      wallet: w,
      title: `${MailTranslationKey.VERIFICATION_CODE}.default.title`,
      salutation: { key: `${MailTranslationKey.VERIFICATION_CODE}.default.salutation` },
      texts: [
        { key: `${MailTranslationKey.VERIFICATION_CODE}.message`, params: { code: '123456' } },
        { key: MailKey.SPACE, params: { value: '2' } },
        { key: `${MailTranslationKey.VERIFICATION_CODE}.closing`, params: { expiration: '10' } },
        { key: MailKey.SPACE, params: { value: '4' } },
        { key: MailKey.DFX_TEAM_CLOSING },
      ],
    },
  };
}

/** Same input shape as KycNotificationService.kycStepReminder. */
function kycReminderRequest(ud: UserData, w?: Wallet): MailRequest {
  return {
    type: MailType.USER_V2,
    context: MailContext.KYC_REMINDER,
    input: {
      userData: ud,
      wallet: w,
      title: `${MailTranslationKey.KYC_REMINDER}.title`,
      salutation: { key: `${MailTranslationKey.KYC_REMINDER}.salutation` },
      texts: [
        { key: MailKey.SPACE, params: { value: '1' } },
        { key: `${MailTranslationKey.KYC_REMINDER}.message` },
        { key: MailKey.SPACE, params: { value: '2' } },
        {
          key: `${MailTranslationKey.GENERAL}.button`,
          params: { url: ud.kycUrl, button: 'true' },
        },
        {
          key: `${MailTranslationKey.KYC}.next_step`,
          params: { url: ud.kycUrl, urlText: ud.kycUrl },
        },
        { key: MailKey.DFX_TEAM_CLOSING },
      ],
    },
  };
}

describe('Denario mail (factory + denario.hbs + i18n)', () => {
  let factory: MailFactory;
  let i18n: I18nService;

  beforeAll(async () => {
    new ConfigService();

    // RealUnit mail wallet is gated on REALUNIT_MAIL_USER in config; ensure test can use realunit.hbs.
    if (!Config.mail.wallet.RealUnit) {
      Config.mail.wallet.RealUnit = {
        template: 'realunit',
        forcedLang: 'de',
        centralizedWelcome: true,
        displayName: 'RealUnit',
      };
    }

    const i18nConfig = GetConfig().i18n;
    const module = await Test.createTestingModule({
      imports: [I18nModule.forRoot({ ...i18nConfig, loaderOptions: { ...i18nConfig.loaderOptions, watch: false } })],
      providers: [MailFactory],
    }).compile();

    factory = module.get(MailFactory);
    i18n = module.get(I18nService);
  });

  it('Denario with name: welcome → salutation → code', () => {
    const mail = factory.createMail(
      verificationRequest(userData({ firstname: 'Joshua' }), wallet('Denario')),
    ) as UserMailV2;
    expect(mail.templateParams.hasWelcome).toBe(true);

    const body = bodyHtml(renderMailHtml(mail));
    const welcomeIdx = body.indexOf('Hi Joshua');
    const salutationIdx = body.indexOf('You have requested a verification code');
    const codeIdx = body.indexOf('123456');
    expect(welcomeIdx).toBeGreaterThanOrEqual(0);
    expect(salutationIdx).toBeGreaterThanOrEqual(0);
    expect(codeIdx).toBeGreaterThanOrEqual(0);
    expect(welcomeIdx).toBeLessThan(salutationIdx);
    expect(salutationIdx).toBeLessThan(codeIdx);
  });

  it('Denario without name: salutation before code (not after)', () => {
    const mail = factory.createMail(
      verificationRequest(
        userData({ firstname: undefined, organizationName: undefined, languageSymbol: 'EN' }),
        wallet('Denario'),
      ),
    ) as UserMailV2;
    expect(mail.templateParams.hasWelcome).toBe(false);

    const body = bodyHtml(renderMailHtml(mail));
    const salutationIdx = body.indexOf('You have requested a verification code');
    const codeIdx = body.indexOf('123456');
    expect(salutationIdx).toBeGreaterThanOrEqual(0);
    expect(codeIdx).toBeGreaterThanOrEqual(0);
    expect(salutationIdx).toBeLessThan(codeIdx);
    expect(body).not.toContain('Hi ');
    expect(body).not.toContain('Guten Tag');
  });

  it('RealUnit without name: salutation before code (regression guard)', () => {
    const mail = factory.createMail(
      verificationRequest(
        userData({ firstname: undefined, organizationName: undefined, languageSymbol: 'DE' }),
        wallet('RealUnit'),
      ),
    ) as UserMailV2;
    expect(mail.template).toBe('realunit');
    expect(mail.templateParams.hasWelcome).toBe(false);

    const body = bodyHtml(renderMailHtml(mail));
    const salutationIdx = body.indexOf('Sie haben einen Verifizierungscode angefordert');
    const codeIdx = body.indexOf('123456');
    expect(salutationIdx).toBeGreaterThanOrEqual(0);
    expect(codeIdx).toBeGreaterThanOrEqual(0);
    expect(salutationIdx).toBeLessThan(codeIdx);
  });

  it('RealUnit with name: welcome → salutation → code', () => {
    const mail = factory.createMail(
      verificationRequest(userData({ firstname: 'Joshua', languageSymbol: 'DE' }), wallet('RealUnit')),
    ) as UserMailV2;
    expect(mail.templateParams.hasWelcome).toBe(true);

    const body = bodyHtml(renderMailHtml(mail));
    const welcomeIdx = body.indexOf('Guten Tag Joshua');
    const salutationIdx = body.indexOf('Sie haben einen Verifizierungscode angefordert');
    const codeIdx = body.indexOf('123456');
    expect(welcomeIdx).toBeGreaterThanOrEqual(0);
    expect(salutationIdx).toBeGreaterThanOrEqual(0);
    expect(codeIdx).toBeGreaterThanOrEqual(0);
    expect(welcomeIdx).toBeLessThan(salutationIdx);
    expect(salutationIdx).toBeLessThan(codeIdx);
  });

  it('empty texts list: salutation appears exactly once in the visible body', () => {
    const mail = factory.createMail({
      type: MailType.USER_V2,
      context: MailContext.VERIFICATION_MAIL,
      input: {
        userData: userData({ firstname: undefined, organizationName: undefined }),
        wallet: wallet('Denario'),
        title: `${MailTranslationKey.VERIFICATION_CODE}.default.title`,
        salutation: { key: `${MailTranslationKey.VERIFICATION_CODE}.default.salutation` },
        texts: [],
      },
    }) as UserMailV2;
    expect(mail.templateParams.texts).toEqual([]);
    expect(mail.templateParams.hasWelcome).toBe(false);

    const body = bodyHtml(renderMailHtml(mail));
    const needle = 'You have requested a verification code';
    expect(countOccurrences(body, needle)).toBe(1);
    expect(body).toContain('class="salutation"');
  });

  it('includes the do-not-share security note in EN and DE verification closing', () => {
    const enMail = factory.createMail(
      verificationRequest(userData({ languageSymbol: 'EN' }), wallet('Denario')),
    ) as UserMailV2;
    const deMail = factory.createMail(
      verificationRequest(userData({ languageSymbol: 'DE' }), wallet('Denario')),
    ) as UserMailV2;
    const enHtml = renderMailHtml(enMail);
    const deHtml = renderMailHtml(deMail);

    expect(enHtml.toLowerCase()).toMatch(/do not share|not share it with anyone/);
    expect(deHtml).toMatch(/teilen Sie diesen Verifizierungscode nicht|nicht mit anderen Personen/i);
  });

  it('uses distinct verification subjects for default vs email in EN and DE', () => {
    for (const lang of ['en', 'de'] as const) {
      const defaultTitle = i18n.translate(`mail-denario.verification_code.default.title`, { lang }) as string;
      const emailTitle = i18n.translate(`mail-denario.verification_code.email.title`, { lang }) as string;
      expect(defaultTitle).toBeTruthy();
      expect(emailTitle).toBeTruthy();
      expect(defaultTitle).not.toBe(emailTitle);
    }
  });

  it('KYC reminder for Denario does not render DFX brand slogans', () => {
    const mail = factory.createMail(
      kycReminderRequest(userData({ firstname: 'Joshua', languageSymbol: 'EN' }), wallet('Denario')),
    ) as UserMailV2;
    const html = renderMailHtml(mail);

    expect(html).not.toContain('DFX-Services');
    expect(html).not.toContain('Your DFX Team');
    expect(html).not.toContain('Bitcoiners by heart');
    expect(html).toContain('Complete your verification');
    expect(html).toContain('Kind regards');
    expect(html).toContain('Denario');
  });

  it('static copy files contain no DFX product/app URLs', () => {
    // Shared mail-asset CDN only — same host onChainLabs uses. Everything else under dfx.swiss is banned.
    const allowedMailAssetPrefix = 'https://dfx.swiss/images/mails/';
    for (const lang of ['en', 'de']) {
      const raw = fs.readFileSync(path.join(process.cwd(), `src/shared/i18n/${lang}/mail-denario.json`), 'utf-8');
      const withoutAllowedAssets = raw.split(allowedMailAssetPrefix).join('');
      expect(withoutAllowedAssets).not.toContain('dfx.swiss');
      expect(raw).not.toContain('DFX-Services');
      expect(raw).not.toContain('Your DFX Team');
      expect(raw).not.toContain('Bitcoiners by heart');
    }
  });

  it('falls back to English Denario copy for unsupported account languages (fr)', () => {
    const mail = factory.createMail(
      verificationRequest(userData({ firstname: 'Joshua', languageSymbol: 'FR' }), wallet('Denario')),
    ) as UserMailV2;
    const html = renderMailHtml(mail);

    expect(mail.subject).toBe('Verification code');
    expect(html).toContain('You have requested a verification code');
    expect(html).not.toContain('Bonjour');
    expect(html).toContain('Hi Joshua');
  });

  it('does not set brand for DFX wallet and keeps user-v2 template', () => {
    const mail = factory.createMail(verificationRequest(userData(), wallet('DFX'))) as UserMailV2;
    expect(mail.template).toBe('user-v2');
    expect(mail.templateParams.brand).toBeUndefined();

    const html = renderMailHtml(mail);
    expect(html).toContain('Your DFX Team');
  });

  it('covers the same key set in EN and DE, at least RealUnit ∩ DFX EN', () => {
    const en = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/shared/i18n/en/mail-denario.json'), 'utf-8'));
    const de = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/shared/i18n/de/mail-denario.json'), 'utf-8'));
    const realunit = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'src/shared/i18n/de/mail-realunit.json'), 'utf-8'),
    );
    const dfxEn = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/shared/i18n/en/mail.json'), 'utf-8'));

    const ken = new Set(leaves(en));
    const kde = new Set(leaves(de));
    const ruKeys = new Set(leaves(realunit));
    const dfxKeys = new Set(leaves(dfxEn));
    const parityTarget = [...ruKeys].filter((k) => dfxKeys.has(k));

    expect([...ken].sort()).toEqual([...kde].sort());
    for (const k of parityTarget) {
      expect(ken.has(k)).toBe(true);
      expect(kde.has(k)).toBe(true);
    }
    for (const k of [
      'template.closing',
      'template.sign_off',
      'template.disclaimer',
      'template.legal_address',
      'template.privacy_label',
      'template.privacy_url',
      'template.imprint_label',
      'template.imprint_url',
      'template.website_url',
      'template.logo_url',
      'template.logo_alt',
    ]) {
      expect(ken.has(k)).toBe(true);
      expect(kde.has(k)).toBe(true);
    }
  });

  it('renders logo from copy when logo_url is set', () => {
    const en = loadDenarioTemplate('en');
    const logoUrl = nonEmpty(en.logo_url);
    const logoAlt = nonEmpty(en.logo_alt);
    // Premise of this test: production copy ships a logo URL (counter-proof empties it → red).
    expect(logoUrl).toBeTruthy();
    expect(logoAlt).toBeTruthy();

    const mail = factory.createMail(
      verificationRequest(userData({ languageSymbol: 'EN' }), wallet('Denario')),
    ) as UserMailV2;
    expect(mail.templateParams.brand?.logoUrl).toBe(logoUrl);
    expect(mail.templateParams.brand?.logoAlt).toBe(logoAlt);

    const html = renderMailHtml(mail);
    const body = bodyHtml(html);
    // Attribute values are Handlebars-escaped in the rendered HTML.
    expect(body).toContain(`src="${escapeHtml(logoUrl!)}"`);
    expect(body).toContain(`alt="${escapeHtml(logoAlt!)}"`);
    // Header uses the image, not the typed wordmark.
    expect(body).not.toContain('D E N A R I O');
  });

  it('falls back to wordmark when logo_url is empty (synthetic brand)', () => {
    const spy = jest.spyOn(factory as any, 'translateWalletOnly').mockImplementation((key: string) => {
      const suffix = key.replace(/^mail\.template\./, '');
      const map: Record<string, string | undefined> = {
        closing: 'Kind regards',
        sign_off: 'Denario',
        disclaimer: 'automated',
        website_url: 'https://www.denario.swiss/',
        logo_url: '',
        logo_alt: 'Denario',
        legal_address: '',
        privacy_label: '',
        privacy_url: '',
        imprint_label: '',
        imprint_url: '',
      };
      const v = map[suffix];
      return v && v !== '' ? v : undefined;
    });
    try {
      const mail = factory.createMail(
        verificationRequest(userData({ languageSymbol: 'EN' }), wallet('Denario')),
      ) as UserMailV2;
      expect(mail.templateParams.brand?.logoUrl).toBeUndefined();

      const body = bodyHtml(renderMailHtml(mail));
      expect(body).toContain('D E N A R I O');
      // No header logo image (wordmark fallback).
      expect(body).not.toMatch(/<img\b[^>]*src=/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('uses black button color (not partner-foreign red) on KYC reminder mail', () => {
    const mail = factory.createMail(
      kycReminderRequest(userData({ firstname: 'Joshua', languageSymbol: 'EN' }), wallet('Denario')),
    ) as UserMailV2;
    const html = renderMailHtml(mail);
    expect(html).not.toContain('D52A1E');
    expect(html).not.toContain('d52a1e');
    // Button CSS + MSO fillcolor
    expect(html).toMatch(/background-color:\s*#000000/);
    expect(html).toMatch(/fillcolor="#000000"/);
  });

  it('renders Denario brand footer from copy (copy-driven, not data-state)', () => {
    const en = loadDenarioTemplate('en');
    const mail = factory.createMail(
      verificationRequest(userData({ languageSymbol: 'EN' }), wallet('Denario')),
    ) as UserMailV2;
    const brand = mail.templateParams.brand;
    const html = renderMailHtml(mail);
    const body = bodyHtml(html);

    // Scalar brand fields — always from copy, never hard-coded partner state.
    expect(brand?.closing).toBe(nonEmpty(en.closing));
    expect(brand?.signOff).toBe(nonEmpty(en.sign_off));
    expect(brand?.disclaimer).toBe(nonEmpty(en.disclaimer));
    expect(brand?.websiteUrl).toBe(nonEmpty(en.website_url));
    expect(brand?.legalAddress).toBe(nonEmpty(en.legal_address));

    // HTML assertions use Handlebars-escaped copy values (& → &amp;, etc.).
    if (brand?.closing) expect(body).toContain(escapeHtml(brand.closing));
    if (brand?.signOff) expect(body).toContain(escapeHtml(brand.signOff));
    if (brand?.websiteUrl) expect(html).toContain(escapeHtml(brand.websiteUrl));
    if (brand?.disclaimer) expect(html).toContain(escapeHtml(brand.disclaimer));
    if (brand?.legalAddress) expect(body).toContain(escapeHtml(brand.legalAddress));

    // Legal links: complete pairs only. Expectations are derived from the copy file.
    const hasPrivacy = !!(nonEmpty(en.privacy_label) && nonEmpty(en.privacy_url));
    const hasImprint = !!(nonEmpty(en.imprint_label) && nonEmpty(en.imprint_url));

    if (hasPrivacy) {
      expect(brand?.privacyUrl).toBe(en.privacy_url);
      expect(brand?.privacyLabel).toBe(en.privacy_label);
      expect(body).toContain(`href="${escapeHtml(en.privacy_url)}"`);
      expect(body).toContain(escapeHtml(en.privacy_label));
    } else {
      expect(brand?.privacyUrl).toBeUndefined();
      // Label alone must not become a link (match escaped text content as Handlebars would render it).
      if (nonEmpty(en.privacy_label)) {
        expect(body).not.toMatch(new RegExp(`href="[^"]*"[^>]*>\\s*${escapeRegExp(escapeHtml(en.privacy_label))}`));
      }
      if (nonEmpty(en.privacy_url)) {
        expect(body).not.toContain(`href="${escapeHtml(en.privacy_url)}"`);
      }
    }

    if (hasImprint) {
      expect(brand?.imprintUrl).toBe(en.imprint_url);
      expect(brand?.imprintLabel).toBe(en.imprint_label);
      expect(body).toContain(`href="${escapeHtml(en.imprint_url)}"`);
      expect(body).toContain(escapeHtml(en.imprint_label));
    } else {
      expect(brand?.imprintUrl).toBeUndefined();
      if (nonEmpty(en.imprint_label)) {
        expect(body).not.toMatch(new RegExp(`href="[^"]*"[^>]*>\\s*${escapeRegExp(escapeHtml(en.imprint_label))}`));
      }
      if (nonEmpty(en.imprint_url)) {
        expect(body).not.toContain(`href="${escapeHtml(en.imprint_url)}"`);
      }
    }

    // Separator only when both complete legal links are present.
    if (hasPrivacy && hasImprint) {
      expect(body).toMatch(/&nbsp;\|&nbsp;/);
    } else {
      expect(body).not.toMatch(/&nbsp;\|&nbsp;/);
    }

    expect(html).not.toMatch(/href\s*=\s*["']\s*["']/);
    // Disclaimer spacing (layout, not partner data).
    expect(html).toMatch(/padding:\s*16px 30px 20px 30px/);
  });

  /**
   * Footer pairing mechanics independent of mail-denario.json contents.
   * Drives getWalletBrand via a spy on translateWalletOnly so factory AND/OR rules are under test.
   */
  it('legal footer mechanics: complete pairs only, all address×privacy×imprint combos', () => {
    type Raw = {
      legal_address?: string;
      privacy_label?: string;
      privacy_url?: string;
      imprint_label?: string;
      imprint_url?: string;
    };

    const applyFactoryPairing = (raw: Raw) => {
      const legalAddress = nonEmpty(raw.legal_address);
      const privacyLabel = nonEmpty(raw.privacy_label);
      const privacyUrl = nonEmpty(raw.privacy_url);
      const imprintLabel = nonEmpty(raw.imprint_label);
      const imprintUrl = nonEmpty(raw.imprint_url);
      // Must match MailFactory.getWalletBrand (label AND url).
      const hasPrivacyLink = !!(privacyLabel && privacyUrl);
      const hasImprintLink = !!(imprintLabel && imprintUrl);
      // Must match MailFactory.getWalletBrand hasLegalLead.
      const hasLegalLead = !!(legalAddress || hasPrivacyLink || hasImprintLink);
      return {
        legalAddress,
        privacyLabel: hasPrivacyLink ? privacyLabel : undefined,
        privacyUrl: hasPrivacyLink ? privacyUrl : undefined,
        imprintLabel: hasImprintLink ? imprintLabel : undefined,
        imprintUrl: hasImprintLink ? imprintUrl : undefined,
        hasLegalLead: hasLegalLead || undefined,
      };
    };

    const bools = [false, true] as const;
    for (const address of bools) {
      for (const privacy of bools) {
        for (const imprint of bools) {
          const raw: Raw = {
            legal_address: address ? 'ADDR-LINE' : '',
            privacy_label: privacy ? 'Privacy L' : '',
            privacy_url: privacy ? 'https://example.test/privacy' : '',
            imprint_label: imprint ? 'Imprint L' : '',
            imprint_url: imprint ? 'https://example.test/imprint' : '',
          };

          // Factory path: spy feeds synthetic raw template keys.
          const spy = jest.spyOn(factory as any, 'translateWalletOnly').mockImplementation((key: string) => {
            const suffix = key.replace(/^mail\.template\./, '');
            const map: Record<string, string | undefined> = {
              legal_address: raw.legal_address,
              privacy_label: raw.privacy_label,
              privacy_url: raw.privacy_url,
              imprint_label: raw.imprint_label,
              imprint_url: raw.imprint_url,
              closing: 'Kind regards',
              sign_off: 'Denario',
              disclaimer: 'automated',
              website_url: 'https://www.denario.swiss/',
              logo_url: '',
              logo_alt: '',
            };
            const v = map[suffix];
            return v && v !== '' ? v : undefined;
          });

          try {
            const mail = factory.createMail(
              verificationRequest(userData({ languageSymbol: 'EN' }), wallet('Denario')),
            ) as UserMailV2;
            const brand = mail.templateParams.brand!;
            const expected = applyFactoryPairing(raw);

            expect(brand.legalAddress).toBe(expected.legalAddress);
            expect(brand.privacyUrl).toBe(expected.privacyUrl);
            expect(brand.privacyLabel).toBe(expected.privacyLabel);
            expect(brand.imprintUrl).toBe(expected.imprintUrl);
            expect(brand.imprintLabel).toBe(expected.imprintLabel);
            expect(brand.hasLegalLead).toBe(expected.hasLegalLead);

            // Render real denario.hbs so footer layout changes are under test.
            const html = renderMailHtml(mail);
            const footerStart = html.indexOf('&copy; Denario. All rights reserved.');
            expect(footerStart).toBeGreaterThanOrEqual(0);
            // Slice from legal footer region (look back for address/links or a few KB).
            const footer = html.slice(Math.max(0, footerStart - 800), footerStart + 80);

            if (address) expect(footer).toContain('ADDR-LINE');
            else expect(footer).not.toContain('ADDR-LINE');

            if (privacy) {
              expect(footer).toContain('href="https://example.test/privacy"');
              expect(footer).toContain('Privacy L');
            } else {
              expect(footer).not.toContain('https://example.test/privacy');
            }

            if (imprint) {
              expect(footer).toContain('href="https://example.test/imprint"');
              expect(footer).toContain('Imprint L');
            } else {
              expect(footer).not.toContain('https://example.test/imprint');
            }

            if (privacy && imprint) expect(footer).toMatch(/&nbsp;\|&nbsp;/);
            else expect(footer).not.toMatch(/&nbsp;\|&nbsp;/);

            expect(footer).not.toMatch(/href\s*=\s*["']\s*["']/);
            expect(footer).toContain('&copy; Denario. All rights reserved.');

            // Copyright always on its own line: never glued to text/link; no leading blank when empty.
            const hasAnyLead = address || privacy || imprint;
            if (hasAnyLead) {
              expect(footer).toMatch(/<br>\s*&copy;/);
              expect(footer).not.toMatch(/(?:<\/a>|[A-Za-z0-9.])\s*&copy;/);
            } else {
              expect(footer).not.toMatch(/<br>\s*&copy;/);
            }
          } finally {
            spy.mockRestore();
          }
        }
      }
    }

    // Incomplete pairs must not produce links (factory: label AND url).
    const incompleteCases: Raw[] = [
      { privacy_label: 'Only label', privacy_url: '' },
      { privacy_label: '', privacy_url: 'https://example.test/orphan-url' },
      { imprint_label: 'Only imprint label', imprint_url: '' },
      { imprint_label: '', imprint_url: 'https://example.test/orphan-imprint' },
    ];

    for (const raw of incompleteCases) {
      const spy = jest.spyOn(factory as any, 'translateWalletOnly').mockImplementation((key: string) => {
        const suffix = key.replace(/^mail\.template\./, '');
        const map: Record<string, string | undefined> = {
          legal_address: raw.legal_address,
          privacy_label: raw.privacy_label,
          privacy_url: raw.privacy_url,
          imprint_label: raw.imprint_label,
          imprint_url: raw.imprint_url,
          closing: 'x',
          sign_off: 'y',
          disclaimer: 'z',
          website_url: 'https://www.denario.swiss/',
        };
        const v = map[suffix];
        return v && v !== '' ? v : undefined;
      });
      try {
        const mail = factory.createMail(
          verificationRequest(userData({ languageSymbol: 'EN' }), wallet('Denario')),
        ) as UserMailV2;
        const brand = mail.templateParams.brand!;
        expect(brand.privacyUrl).toBeUndefined();
        expect(brand.imprintUrl).toBeUndefined();
        // URL-only must not leak into brand either.
        if (raw.privacy_url) expect(brand.privacyUrl).toBeUndefined();
        if (raw.imprint_url) expect(brand.imprintUrl).toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    }
  });
});

type DenarioTemplate = {
  closing: string;
  sign_off: string;
  disclaimer: string;
  legal_address: string;
  privacy_label: string;
  privacy_url: string;
  imprint_label: string;
  imprint_url: string;
  website_url: string;
  logo_url: string;
  logo_alt: string;
};

function loadDenarioTemplate(lang: 'en' | 'de'): DenarioTemplate {
  const file = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), `src/shared/i18n/${lang}/mail-denario.json`), 'utf-8'),
  ) as { template: DenarioTemplate };
  return file.template;
}

function nonEmpty(value: string | undefined | null): string | undefined {
  return value != null && value !== '' ? value : undefined;
}

/** Match Handlebars Utils.escapeExpression when comparing copy to rendered HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/`/g, '&#x60;')
    .replace(/=/g, '&#x3D;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
