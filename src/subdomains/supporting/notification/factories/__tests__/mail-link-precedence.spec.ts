import { I18nService } from 'nestjs-i18n';
import mailDe from 'src/shared/i18n/de/mail.json';
import { MailFactory, MailTranslationKey } from '../mail.factory';

// A `[url:...]` tag means one of two things, and the caller cannot tell them apart: either the tag
// carries the display text and the target comes from `params.url`, or the tag IS the target because
// it is the same for every recipient. Callers pass `url` for a whole block of lines, so a shared
// param used to retarget the hard-coded links — the mail showed one address and opened another.
describe('MailFactory link precedence', () => {
  const KYC_URL = 'https://app.dfx.swiss/kyc?code=ABC-123';
  const CALL_SETTINGS_URL = 'https://app.dfx.swiss/settings?a=call';

  let factory: MailFactory;

  // Resolves against the real translation file, so the specs below break if a text switches shape.
  function lookup(key: string): string | undefined {
    const value = key
      .replace(/^mail\./, '')
      .split('.')
      .reduce<any>((node, segment) => (node == null ? undefined : node[segment]), mailDe);
    return typeof value === 'string' ? value : undefined;
  }

  beforeEach(() => {
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

    factory = new MailFactory(i18n);
  });

  function affix(key: string, params?: Record<string, string>): { link?: string; text?: string } {
    const [element] = (factory as any).mapMailAffix({ key, params }, 'de');
    return { link: element?.url?.link, text: element?.url?.text };
  }

  // The reported case: the customer clicked the call-time link and landed in the KYC flow.
  const PHONE_REASONS = [
    'manual_check_phone',
    'manual_check_ip_phone',
    'manual_check_ip_country_phone',
    'manual_check_external_account_phone',
  ];

  it.each(PHONE_REASONS)('keeps the call-time link in the %s pending mail', (reason) => {
    const { link, text } = affix(`${MailTranslationKey.PENDING}.${reason}.line3`, {
      url: KYC_URL,
      urlText: KYC_URL,
    });

    expect(link).toBe(CALL_SETTINGS_URL);
    expect(text).toBe(CALL_SETTINGS_URL);
  });

  it.each(PHONE_REASONS)('keeps the call-time link in the %s chargeback mail', (reason) => {
    const { link } = affix(`${MailTranslationKey.CHARGEBACK_REASON}.${reason}`, {
      url: 'https://dilisense.com/en/search/Max%20Muster',
      urlText: 'https://dilisense.com/en/search/Max%20Muster',
    });

    expect(link).toBe(CALL_SETTINGS_URL);
  });

  // Same shape, different mail: the limit-request form was retargeted to the KYC flow as well.
  it('keeps the limit-request link in the annual-limit pending mail', () => {
    const { link } = affix(`${MailTranslationKey.PENDING}.annual_limit.line4`, {
      url: KYC_URL,
      urlText: KYC_URL,
    });

    expect(link).toBe('https://app.dfx.swiss/support/issue?issue-type=LimitRequest');
  });

  // The other shape must keep working: the tag is display text, the caller owns the target.
  it('lets the caller target a display-text link', () => {
    const TX_URL = 'https://app.dfx.swiss/tx/T123';

    const { link, text } = affix(`${MailTranslationKey.PENDING}.manual_check_phone.line5`, { url: TX_URL });

    expect(link).toBe(TX_URL);
    expect(text).toBe('Klick hier');
  });

  // `[url:{urlText}]` resolves to an absolute address before the tag is parsed, so both rules agree.
  it('uses the substituted url of a placeholder link', () => {
    const { link, text } = affix(`${MailTranslationKey.PENDING}.kyc_data_needed.line2`, {
      url: KYC_URL,
      urlText: KYC_URL,
    });

    expect(link).toBe(KYC_URL);
    expect(text).toBe(KYC_URL);
  });

  it('falls back to the tag when the caller passes no url', () => {
    const { link } = affix(`${MailTranslationKey.GENERAL}.support`);

    expect(link).toBe('https://app.dfx.swiss/support');
  });

  // Guards the rule itself rather than one translation: no text may show an absolute address while
  // a caller-supplied url sends the reader somewhere else.
  it('never shows an address that differs from the link target', () => {
    const texts: string[] = [];
    const collect = (node: unknown): void => {
      if (typeof node === 'string') texts.push(node);
      else if (node && typeof node === 'object') Object.values(node).forEach(collect);
    };
    collect(mailDe);

    const inlineUrlTexts = texts.filter((t) => /\[url:https?:\/\//i.test(t));
    expect(inlineUrlTexts.length).toBeGreaterThan(0);

    for (const text of inlineUrlTexts) {
      const inline = /\[url:(https?:\/\/[^\]]+)\]/i.exec(text)![1];
      expect((MailFactory as any).resolveLink(inline, KYC_URL)).toBe(inline);
    }
  });
});
