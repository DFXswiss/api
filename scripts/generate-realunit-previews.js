#!/usr/bin/env node
/**
 * Generates HTML previews of all RealUnit email templates with example data.
 * Uses RealUnit translations with fallback to DFX defaults (same as production).
 * Usage: node scripts/generate-realunit-previews.js
 * Output: scripts/email-previews/realunit/
 */

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const TEMPLATE_DIR = path.join(__dirname, '../src/subdomains/supporting/notification/templates');
const I18N_DIR = path.join(__dirname, '../src/shared/i18n/de');
const OUTPUT_DIR = path.join(__dirname, 'email-previews/realunit');

const compile = Handlebars.compile(fs.readFileSync(path.join(TEMPLATE_DIR, 'realunit.hbs'), 'utf-8'));
const ru = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'mail-realunit.json'), 'utf-8'));
const dfx = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'mail.json'), 'utf-8'));

// Deep get helper
function get(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

// Wallet-aware translate: try RealUnit first, fallback to DFX
function t(key) {
  return get(ru, key) ?? get(dfx, key) ?? `[MISSING: ${key}]`;
}

const style = 'Open Sans,Helvetica,Arial,sans-serif';

function text(str) {
  if (!str) return null;
  return { text: str, style, marginTop: '10px', marginBottom: '10px' };
}

function parseSpecialTag(str) {
  const match = /^(.*)\[(\w+):([^\]]+)\](.*)$/.exec(str);
  return match ? { text: match[1], textSuffix: match[4], tag: match[2], value: match[3] } : null;
}

function translatedText(str, opts = {}) {
  if (!str) return null;
  const tag = parseSpecialTag(str);
  if (tag) {
    const result = { text: tag.text, style, marginTop: '10px', marginBottom: '10px' };
    if (tag.tag === 'url')
      result.url = { link: opts.url || tag.value, text: tag.value, textSuffix: tag.textSuffix, button: opts.button };
    if (tag.tag === 'mail') result.mail = { address: tag.value, textSuffix: tag.textSuffix, button: opts.button };
    return result;
  }
  return text(str);
}

function interpolate(str, params) {
  if (!str) return '';
  return str.replace(/\{(\w+)\}/g, (_, key) => params[key] || `{${key}}`);
}

function buildMail(salutation, texts) {
  const filtered = texts.filter((t) => t && (t.text || t.url || t.mail));
  return compile({ salutation, texts: filtered });
}

// --- Mail definitions ---
const sampleName = 'Max Mustermann';
const sampleUrl = 'https://realunit.ch/app';
const sampleKycUrl = 'https://realunit.ch/app/kyc';

const mails = [];
let id = 0;

function add(file, subject, category, salutation, texts) {
  id++;
  const num = String(id).padStart(2, '0');
  mails.push({ id: num, file: `${num}-${file}`, subject, category, salutation, texts });
}

// === KAUF (Buy Crypto) ===
add('buy-crypto-completed', t('payment.crypto_output.title'), 'Kauf', t('payment.crypto_output.salutation'), [
  text(t('payment.crypto_output.body')),
]);

// === VERKAUF (Processing) ===
add('sell-processing', t('payment.processing.title'), 'Verkauf', t('payment.processing.salutation'), [
  text(t('payment.processing.body')),
]);

// === VERKAUF ABGESCHLOSSEN (Fiat Output) ===
add('sell-completed', t('payment.fiat_output.title'), 'Verkauf', t('payment.fiat_output.salutation'), [
  text(t('payment.fiat_output.body')),
]);

// === EINGANG ===
add('fiat-input', t('payment.fiat_input.title'), 'Eingang', t('payment.fiat_input.salutation'), []);

add('fiat-input-currency-exchange', t('payment.fiat_input.title'), 'Eingang', t('payment.fiat_input.salutation'), [
  text(
    interpolate(t('payment.fiat_input.currency_exchange'), {
      bankAccount: 'CH98 0000 0000 0000 0',
      bankAsset: 'EUR',
      inputAsset: 'CHF',
    }),
  ),
]);

add('crypto-input', t('payment.crypto_input.title'), 'Eingang', t('payment.crypto_input.salutation'), []);

add(
  'unassigned-transaction',
  t('payment.fiat_input.unassigned.title'),
  'Eingang',
  t('payment.fiat_input.unassigned.salutation'),
  [translatedText(t('payment.fiat_input.unassigned.transaction_button'), { url: sampleUrl, button: 'true' })],
);

// === AUSSTEHEND (Pending) ===
const pendingTypes = [
  ['monthly-limit', 'monthly_limit'],
  ['annual-limit', 'annual_limit'],
  ['annual-limit-without-kyc', 'annual_limit_without_kyc'],
  ['manual-check', 'manual_check'],
  ['high-risk-kyc', 'high_risk_kyc_needed'],
  ['video-ident', 'video_ident_needed'],
  ['kyc-data', 'kyc_data_needed'],
  ['name-check-no-kyc', 'name_check_without_kyc'],
  ['asset-kyc', 'asset_kyc_needed'],
  ['merge-incomplete', 'merge_incomplete'],
  ['bank-release', 'bank_release_pending'],
  ['olky-no-kyc', 'olky_no_kyc'],
  ['bank-tx-needed', 'bank_tx_needed'],
];

for (const [file, key] of pendingTypes) {
  const prefix = `payment.pending.${key}`;
  const title = t(`${prefix}.title`);
  const sal = t(`${prefix}.salutation`);
  const lines = [];
  for (let i = 1; i <= 5; i++) {
    const line = t(`${prefix}.line${i}`);
    if (line) {
      lines.push(
        translatedText(interpolate(line, { urlText: sampleKycUrl, phone: '+41 79 *** ** 67' }), {
          url: sampleKycUrl,
          button: i === 3 ? 'true' : undefined,
        }),
      );
    }
  }
  add(`pending-${file}`, title, 'Ausstehend', sal, lines);
}

// === RÜCKERSTATTUNG ===
add(
  'chargeback-crypto',
  t('payment.chargeback.crypto.title'),
  'Rückerstattung',
  t('payment.chargeback.crypto.salutation'),
  [
    text(t('payment.chargeback.crypto.body')),
    text(interpolate(t('payment.chargeback.introduction'), { reason: t('payment.chargeback.reasons.monthly_limit') })),
  ],
);

add('chargeback-fiat', t('payment.chargeback.fiat.title'), 'Rückerstattung', t('payment.chargeback.fiat.salutation'), [
  text(t('payment.chargeback.fiat.body')),
]);

add(
  'chargeback-unconfirmed',
  t('payment.chargeback.unconfirmed.title'),
  'Rückerstattung',
  t('payment.chargeback.unconfirmed.salutation'),
  [translatedText(t('payment.chargeback.unconfirmed.transaction_button'), { url: sampleUrl, button: 'true' })],
);

// === KYC ===
add('kyc-success', t('kyc.success.title'), 'KYC', t('kyc.success.salutation'), [text(t('kyc.success.message'))]);

add('kyc-failed', t('kyc.failed.title'), 'KYC', t('kyc.failed.salutation'), [
  text(
    interpolate(t('kyc.failed.message'), {
      stepName: t('kyc.step_names.ident'),
      reason: t('kyc.failed.reasons.personal_data_not_matching'),
    }),
  ),
  translatedText(interpolate(t('kyc.retry'), { urlText: sampleKycUrl }), { url: sampleKycUrl }),
]);

add('kyc-missing-data', t('kyc.missing_data.title'), 'KYC', t('kyc.missing_data.salutation'), [
  text(interpolate(t('kyc.missing_data.message'), { stepName: t('kyc.step_names.personal_data') })),
  translatedText(interpolate(t('kyc.next_step'), { urlText: sampleKycUrl }), { url: sampleKycUrl }),
]);

add('kyc-reminder', t('kyc.reminder.title'), 'KYC', t('kyc.reminder.salutation'), [
  text(t('kyc.reminder.message')),
  translatedText(interpolate(t('kyc.next_step'), { urlText: sampleKycUrl }), { url: sampleKycUrl }),
]);

// === AUTH ===
add('login', t('login.title'), 'Authentifizierung', t('login.salutation'), [
  translatedText(interpolate(t('login.message'), { urlText: sampleUrl, expiration: '15' }), {
    url: sampleUrl,
    button: 'true',
  }),
]);

add(
  'verification-code-2fa',
  t('verification_code.default.title'),
  'Authentifizierung',
  t('verification_code.default.salutation'),
  [
    text(
      interpolate(t('verification_code.message'), {
        code: '<strong style="font-size:24px;color:#1988C6;letter-spacing:4px;">482 951</strong>',
      }),
    ),
    translatedText(interpolate(t('verification_code.closing'), { expiration: '10' }), {}),
  ],
);

add(
  'email-verification-code',
  t('verification_code.email.title'),
  'Authentifizierung',
  t('verification_code.email.salutation'),
  [
    text(
      interpolate(t('verification_code.message'), {
        code: '<strong style="font-size:24px;color:#1988C6;letter-spacing:4px;">738 264</strong>',
      }),
    ),
    translatedText(interpolate(t('verification_code.closing'), { expiration: '10' }), {}),
  ],
);

// === ACCOUNT ===
add('account-merge-request', t('account_merge.request.title'), 'Account', t('account_merge.request.salutation'), [
  text(interpolate(t('general.welcome'), { name: sampleName })),
  translatedText(interpolate(t('account_merge.request.message'), { urlText: sampleUrl }), {
    url: sampleUrl,
    button: 'true',
  }),
]);

add('added-address', t('account_merge.added_address.title'), 'Account', t('account_merge.added_address.salutation'), [
  text(interpolate(t('general.welcome'), { name: sampleName })),
  text(interpolate(t('account_merge.added_address.message'), { userAddress: '0x1234...abcd' })),
]);

add('changed-mail', t('account_merge.changed_mail.title'), 'Account', t('account_merge.changed_mail.salutation'), [
  text(interpolate(t('general.welcome'), { name: sampleName })),
  text(interpolate(t('account_merge.changed_mail.message'), { userMail: 'm***@example.com' })),
]);

add('account-deactivation', t('account_deactivation.title'), 'Account', t('account_deactivation.salutation'), [
  text(interpolate(t('general.welcome'), { name: sampleName })),
  text(t('account_deactivation.message')),
]);

// === SONSTIGES ===
add(
  'recommendation-mail',
  t('recommendation.recommended.title'),
  'Sonstiges',
  t('recommendation.recommended.salutation'),
  [
    text(interpolate(t('recommendation.recommended.message'), { name: 'Anna Beispiel', mail: 'anna@example.com' })),
    translatedText(t('recommendation.recommended.registration_button'), { url: sampleUrl, button: 'true' }),
    translatedText(interpolate(t('recommendation.recommended.registration_link'), { urlText: sampleUrl }), {
      url: sampleUrl,
    }),
  ],
);

add('ref-reward', t('referral.title'), 'Sonstiges', t('referral.salutation'), [text(t('referral.dfx_ambassador'))]);

add('support-message', t('support_message.title'), 'Sonstiges', t('support_message.salutation'), [
  text(t('support_message.message')),
]);

add('limit-request', t('limit_request.title'), 'Sonstiges', t('limit_request.title'), [
  text(interpolate(t('limit_request.message'), { limitAmount: "500'000" })),
]);

// === GENERATE ===
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const mail of mails) {
  const html = buildMail(mail.salutation, mail.texts);
  fs.writeFileSync(path.join(OUTPUT_DIR, `${mail.file}.html`), html);
}

// Index
const categories = {};
for (const m of mails) {
  if (!categories[m.category]) categories[m.category] = [];
  categories[m.category].push(m);
}

const indexHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RealUnit E-Mail Vorlagen</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; color: #1a1a1a; }
    .header { background: #F5F7F8; border-bottom: 2px solid #E8ECF0; padding: 32px; text-align: center; }
    .header img { height: 48px; margin-bottom: 16px; }
    .header h1 { font-size: 22px; color: #1E1D22; margin-bottom: 8px; }
    .header p { color: #4A5568; font-size: 14px; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .category { margin-bottom: 32px; }
    .category h2 { font-size: 16px; color: #1988C6; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #1988C6; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .card { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.10); transition: transform 0.15s, box-shadow 0.15s; cursor: pointer; text-decoration: none; color: inherit; display: block; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.13); }
    .card-preview { height: 180px; overflow: hidden; border-bottom: 1px solid #e5e7eb; position: relative; }
    .card-preview iframe { width: 500px; height: 600px; border: none; transform: scale(0.65); transform-origin: top left; pointer-events: none; }
    .card-body { padding: 12px 16px; }
    .card-body .subject { font-weight: 600; font-size: 14px; margin-bottom: 4px; color: #1E1D22; }
    .card-body .template { font-size: 12px; color: #6b7280; }
    .stats { text-align: center; margin-bottom: 24px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <img src="https://realunit.ch/wp-content/uploads/2023/06/realunit-logo-tagline-full-color-rgb.svg" alt="RealUnit Schweiz AG">
    <h1>RealUnit E-Mail Vorlagen</h1>
    <p>${mails.length} Vorlagen mit Beispieldaten (Deutsch) – generiert am ${new Date().toLocaleDateString('de-CH')}</p>
  </div>
  <div class="container">
    <p class="stats">Klicken Sie auf eine Karte, um die E-Mail in voller Groesse anzuzeigen.</p>
${Object.entries(categories)
  .map(
    ([cat, items]) => `
    <div class="category">
      <h2>${cat} (${items.length})</h2>
      <div class="grid">
${items
  .map(
    (m) => `        <a class="card" href="${m.file}.html" target="_blank">
          <div class="card-preview"><iframe src="${m.file}.html" loading="lazy"></iframe></div>
          <div class="card-body">
            <div class="subject">${m.subject}</div>
            <div class="template">${m.file}</div>
          </div>
        </a>`,
  )
  .join('\n')}
      </div>
    </div>`,
  )
  .join('\n')}
  </div>
</body>
</html>`;

fs.writeFileSync(path.join(OUTPUT_DIR, '00_index.html'), indexHtml);
console.log(`Generated ${mails.length} mail templates + index in ${OUTPUT_DIR}`);
