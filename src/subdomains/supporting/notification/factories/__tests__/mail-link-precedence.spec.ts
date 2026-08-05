import { readFileSync, readdirSync } from 'fs';
import { I18nService } from 'nestjs-i18n';
import { join, resolve } from 'path';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import mailDe from 'src/shared/i18n/de/mail.json';
import { MailFactory, MailTranslationKey } from '../mail.factory';

// A `[url:...]` tag means one of two things, and the caller cannot tell them apart: either the tag
// carries the display text and the target comes from `params.url`, or the tag IS the target because
// it is the same for every recipient. Callers pass `url` for a whole block of lines, so a shared
// param used to retarget the hard-coded links — the mail showed one address and opened another.
describe('MailFactory link precedence', () => {
  const KYC_URL = 'https://app.dfx.swiss/kyc?code=ABC-123';
  const DILISENSE_URL = 'https://dilisense.com/en/search/Max%20Muster';
  const CALL_SETTINGS_URL = 'https://app.dfx.swiss/settings?a=call';

  const I18N_DIR = resolve(__dirname, '../../../../../shared/i18n');

  // Resolves against a real translation document, so the specs below break if a text switches shape.
  function buildFactory(doc: unknown): MailFactory {
    const lookup = (key: string): string | undefined => {
      const value = key
        .replace(/^mail[^.]*\./, '')
        .split('.')
        .reduce<any>((node, segment) => (node == null ? undefined : node[segment]), doc);
      return typeof value === 'string' ? value : undefined;
    };

    const i18n = {
      // nestjs-i18n returns the key itself when nothing matches; the factory relies on that.
      translate: (key: string, opts?: { args?: Record<string, string> }) => {
        const text = lookup(key);
        if (text == null) return key;
        return Object.entries(opts?.args ?? {}).reduce(
          (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), value),
          text,
        );
      },
    } as unknown as I18nService;

    return new MailFactory(i18n);
  }

  function linkFor(doc: unknown, key: string, params?: Record<string, string>): { link?: string; text?: string } {
    const [element] = (buildFactory(doc) as any).mapMailAffix({ key, params }, 'de');
    return { link: element?.url?.link, text: element?.url?.text };
  }

  function affix(key: string, params?: Record<string, string>): { link?: string; text?: string } {
    return linkFor(mailDe, key, params);
  }

  // The reported case: the customer clicked the call-time link and landed in the KYC flow.
  const PHONE_REASONS = [
    AmlReason.MANUAL_CHECK_PHONE,
    AmlReason.MANUAL_CHECK_IP_PHONE,
    AmlReason.MANUAL_CHECK_IP_COUNTRY_PHONE,
    AmlReason.MANUAL_CHECK_EXTERNAL_ACCOUNT_PHONE,
  ];

  // Keys are built the way the notification services build them, so a renamed reason breaks the spec.
  it.each(PHONE_REASONS)('keeps the call-time link in the %s pending mail', (reason) => {
    const { link, text } = affix(`${MailFactory.parseMailKey(MailTranslationKey.PENDING, reason)}.line3`, {
      url: KYC_URL,
      urlText: KYC_URL,
    });

    expect(link).toBe(CALL_SETTINGS_URL);
    expect(text).toBe(CALL_SETTINGS_URL);
  });

  // The chargeback mail resolves the reason as a `{reason}` param of `chargeback.introduction`, so the
  // tag only appears after substitution — this is the path the return notification services take.
  it.each(PHONE_REASONS)('keeps the call-time link in the %s chargeback mail', (reason) => {
    const { link, text } = affix(`${MailTranslationKey.CHARGEBACK}.introduction`, {
      reason: MailFactory.parseMailKey(MailTranslationKey.CHARGEBACK_REASON, reason),
      url: DILISENSE_URL,
      urlText: DILISENSE_URL,
    });

    expect(link).toBe(CALL_SETTINGS_URL);
    expect(text).toBe(CALL_SETTINGS_URL);
  });

  // Same shape, different mail: the limit-request form was retargeted to the KYC flow as well.
  it('keeps the limit-request link in the annual-limit pending mail', () => {
    const { link } = affix(`${MailFactory.parseMailKey(MailTranslationKey.PENDING, AmlReason.ANNUAL_LIMIT)}.line4`, {
      url: KYC_URL,
      urlText: KYC_URL,
    });

    expect(link).toBe('https://app.dfx.swiss/support/issue?issue-type=LimitRequest');
  });

  // The other shape must keep working: the tag is display text, the caller owns the target.
  it('lets the caller target a display-text link', () => {
    const TX_URL = 'https://app.dfx.swiss/tx/T123';

    const { link, text } = affix(
      `${MailFactory.parseMailKey(MailTranslationKey.PENDING, AmlReason.MANUAL_CHECK_PHONE)}.line5`,
      { url: TX_URL },
    );

    expect(link).toBe(TX_URL);
    expect(text).toBe('Klick hier');
  });

  // `[url:{urlText}]` resolves to an absolute address before the tag is parsed, so both rules agree.
  it('uses the substituted url of a placeholder link', () => {
    const { link, text } = affix(
      `${MailFactory.parseMailKey(MailTranslationKey.PENDING, AmlReason.KYC_DATA_NEEDED)}.line2`,
      { url: KYC_URL, urlText: KYC_URL },
    );

    expect(link).toBe(KYC_URL);
    expect(text).toBe(KYC_URL);
  });

  it('falls back to the tag when the caller passes no url', () => {
    const { link } = affix(`${MailTranslationKey.GENERAL}.support`);

    expect(link).toBe('https://app.dfx.swiss/support');
  });

  //*** RULE GUARD ***//

  // Guards the rule itself rather than one translation, across every language and wallet override: no
  // text may show an absolute address while a caller-supplied url sends the reader somewhere else.
  type InlineLink = { key: string; link: string };

  function inlineLinks(doc: unknown): InlineLink[] {
    const found: InlineLink[] = [];
    const collect = (node: unknown, path: string[]): void => {
      if (typeof node === 'string') {
        const match = /\[url:(https?:\/\/[^\]]+)\]/i.exec(node);
        if (match) found.push({ key: path.join('.'), link: match[1] });
      } else if (node && typeof node === 'object') {
        Object.entries(node).forEach(([segment, child]) => collect(child, [...path, segment]));
      }
    };
    collect(doc, []);

    return found;
  }

  // Every mail translation file, including the per-wallet overrides, so a new language or a new
  // wallet copy is covered the moment it is added.
  const TRANSLATION_FILES: [string, unknown][] = readdirSync(I18N_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      readdirSync(join(I18N_DIR, dir.name))
        .filter((file) => /^mail.*\.json$/.test(file))
        .map((file): [string, unknown] => [
          `${dir.name}/${file}`,
          JSON.parse(readFileSync(join(I18N_DIR, dir.name, file), 'utf8')),
        ]),
    );

  it('guards every mail translation file, and finds hard-coded links to guard', () => {
    expect(TRANSLATION_FILES.map(([name]) => name)).toEqual(expect.arrayContaining(['de/mail.json', 'en/mail.json']));
    expect(TRANSLATION_FILES.reduce((total, [, doc]) => total + inlineLinks(doc).length, 0)).toBeGreaterThan(0);
  });

  it.each(TRANSLATION_FILES)('never shows an address that differs from the link target in %s', (_name, doc) => {
    for (const { key, link } of inlineLinks(doc)) {
      // A caller url is present and points elsewhere — the inline address must still win.
      expect(linkFor(doc, `mail.${key}`, { url: KYC_URL, urlText: KYC_URL }).link).toBe(link);
    }
  });
});
