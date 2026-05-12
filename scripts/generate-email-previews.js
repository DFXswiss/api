#!/usr/bin/env node
/**
 * Generates HTML previews of all DFX email templates with example data.
 * Usage: node scripts/generate-email-previews.js
 * Output: scripts/email-previews/
 */

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const TEMPLATE_DIR = path.join(__dirname, '../src/subdomains/supporting/notification/templates');
const I18N_DIR = path.join(__dirname, '../src/shared/i18n/de');
const OUTPUT_DIR = path.join(__dirname, 'email-previews');

// Load translations
const mailTranslations = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'mail.json'), 'utf-8'));

// Load and compile templates
const userV2Template = Handlebars.compile(fs.readFileSync(path.join(TEMPLATE_DIR, 'user-v2.hbs'), 'utf-8'));
const personalTemplate = Handlebars.compile(fs.readFileSync(path.join(TEMPLATE_DIR, 'personal.hbs'), 'utf-8'));

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Constants
const SOCIAL = {
  twitterUrl: 'https://twitter.com/DFX_Swiss',
  telegramUrl: 'https://t.me/DFXswiss',
  linkedinUrl: 'https://www.linkedin.com/company/dfxswiss/',
  instagramUrl: 'https://www.instagram.com/dfx.swiss/',
};

const STYLE = 'Open Sans,Helvetica,Arial,sans-serif';
const ZAPFINO = 'Zapfino';

// Helper: create a text block
function text(content, opts = {}) {
  return {
    text: content,
    style: opts.style || STYLE,
    url: opts.url,
    mail: opts.mail,
    underline: opts.underline,
    marginTop: opts.marginTop || '10px',
    marginBottom: opts.marginBottom || '10px',
  };
}

function space() {
  return text('');
}

function button(label, link) {
  return {
    text: '',
    style: STYLE,
    url: { link, text: label, button: true },
  };
}

function urlLink(label, link) {
  return {
    text: 'oder<br>',
    style: STYLE,
    url: { link, text: label },
  };
}

function dfxTeamClosing() {
  return [
    space(),
    text(mailTranslations.general.dfx_team_closing),
    { text: mailTranslations.general.dfx_closing_message, style: ZAPFINO },
    space(),
    space(),
  ];
}

function supportText() {
  return text('Bei Fragen stehen wir dir<br>gerne unter <a style="color:white" href="https://app.dfx.swiss/support">https://app.dfx.swiss/support</a> zur Seite.');
}

function thanksText() {
  return text(mailTranslations.general.thanks);
}

// Render a UserV2 email
function renderUserV2(salutation, texts) {
  return userV2Template({ salutation, texts, ...SOCIAL });
}

// Render a Personal email
function renderPersonal(prefix, bannerUrl) {
  return personalTemplate({ prefix, banner: bannerUrl || 'https://dfx.swiss/wp-content/uploads/2022/07/02.03.2022_DFX_Logo_grund_dunkel_1.png' });
}

const TX_URL = 'https://app.dfx.swiss/tx/T-12345';
const KYC_URL = 'https://app.dfx.swiss/kyc?code=abc123';
const SUPPORT_URL = 'https://app.dfx.swiss/support/issue/42';

// ============================================================
// ALL EMAIL DEFINITIONS
// ============================================================

const emails = [];

// --- 1. BUY CRYPTO COMPLETED ---
emails.push({
  name: '01-buy-crypto-completed',
  subject: 'Krypto-Asset verschickt',
  category: 'Kauf (Buy Crypto)',
  template: 'user-v2',
  render: () => renderUserV2(
    'Deine Krypto-Assets wurden an deine Adresse ausgezahlt',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Transaktion:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      text(mailTranslations.payment.warning),
      space(),
      supportText(),
      space(),
      thanksText(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 2. BUY CRYPTO PROCESSING ---
emails.push({
  name: '02-buy-crypto-processing',
  subject: 'Transaktion wird weiterverarbeitet',
  category: 'Transaktion',
  template: 'user-v2',
  render: () => renderUserV2(
    'Deine Transaktion wird nun weiterverarbeitet',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Transaktion:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      space(),
      supportText(),
      space(),
      thanksText(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 3. BUY CRYPTO PENDING (Monthly Limit) ---
emails.push({
  name: '03-buy-crypto-pending-monthly-limit',
  subject: '30 Tage Limit überschritten',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.monthly_limit.salutation,
    [
      text(mailTranslations.payment.pending.monthly_limit.line1),
      text(mailTranslations.payment.pending.monthly_limit.line2),
      { text: 'Limit erhöhen mit Verifizierung?<br>Klicke den nachfolgenden Link um dich zu verifizieren:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      text(mailTranslations.payment.pending.monthly_limit.line4),
      { text: 'Wenn du dich nicht verifizieren möchtest kannst du auch eine Rückzahlung anfordern:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 4. BUY CRYPTO PENDING (Annual Limit) ---
emails.push({
  name: '04-buy-crypto-pending-annual-limit',
  subject: 'Jährliches Limit überschritten',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.annual_limit.salutation,
    [
      text(mailTranslations.payment.pending.annual_limit.line1),
      text(mailTranslations.payment.pending.annual_limit.line2),
      text(mailTranslations.payment.pending.annual_limit.line3),
      { text: 'Du kannst einen Antrag auf Limit Erhöhung über den folgenden Link stellen:<br>', style: STYLE, url: { link: 'https://app.dfx.swiss/support/issue?issue-type=LimitRequest', text: 'https://app.dfx.swiss/support/issue?issue-type=LimitRequest' } },
      { text: 'Wenn du dich nicht verifizieren möchtest kannst du auch eine Rückzahlung anfordern:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 5. BUY CRYPTO PENDING (Manual Check) ---
emails.push({
  name: '05-buy-crypto-pending-manual-check',
  subject: 'Einzahlung wird geprüft',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.manual_check.salutation,
    [
      text(mailTranslations.payment.pending.manual_check.line1),
      text(mailTranslations.payment.pending.manual_check.line2),
      text(mailTranslations.payment.pending.manual_check.line3),
      text(mailTranslations.payment.pending.manual_check.line4),
      { text: 'Um den aktuellen Stand deiner Transaktion einsehen zu können:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 6. BUY CRYPTO PENDING (High Risk KYC) ---
emails.push({
  name: '06-pending-high-risk-kyc',
  subject: 'Problem bei deiner Einzahlung',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.high_risk_kyc_needed.salutation,
    [
      text(mailTranslations.payment.pending.high_risk_kyc_needed.line1),
      text(mailTranslations.payment.pending.high_risk_kyc_needed.line2),
      { text: 'Klicke daher den nachfolgenden Link um dich zu verifizieren:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      text(mailTranslations.payment.pending.high_risk_kyc_needed.line4),
      { text: 'Wenn du dich nicht verifizieren möchtest kannst du auch eine Rückzahlung anfordern:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 7. BUY CRYPTO PENDING (Video Ident) ---
emails.push({
  name: '07-pending-video-ident',
  subject: 'Video-Verifizierung (KYC) erforderlich',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.video_ident_needed.salutation,
    [
      text(mailTranslations.payment.pending.video_ident_needed.line1),
      text(mailTranslations.payment.pending.video_ident_needed.line2),
      { text: 'Klicke daher den nachfolgenden Link um dich zu verifizieren:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      text(mailTranslations.payment.pending.video_ident_needed.line4),
      { text: 'Wenn du dich nicht verifizieren möchtest kannst du auch eine Rückzahlung anfordern:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 10. BUY CRYPTO PENDING (KYC Data Needed) ---
emails.push({
  name: '08-pending-kyc-data',
  subject: 'KYC Daten erforderlich',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.kyc_data_needed.salutation,
    [
      text(mailTranslations.payment.pending.kyc_data_needed.line1),
      { text: 'Klicke daher den nachfolgenden Link und führe mindestens die ersten Schritte aus, bis du deinen Namen und deine Adresse eingegeben hast:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      text(mailTranslations.payment.pending.kyc_data_needed.line3),
      text(mailTranslations.payment.pending.kyc_data_needed.line4),
      { text: 'Wenn du stattdessen eine Rückzahlung anfordern möchtest:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 9. BUY CRYPTO PENDING (Merge Incomplete) ---
emails.push({
  name: '09-pending-merge-incomplete',
  subject: 'E-Mail Bestätigung ausstehend',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.merge_incomplete.salutation,
    [
      text(mailTranslations.payment.pending.merge_incomplete.line1),
      text(mailTranslations.payment.pending.merge_incomplete.line2),
      text(mailTranslations.payment.pending.merge_incomplete.line3),
      { text: 'Wenn du stattdessen eine Rückzahlung anfordern möchtest:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 10. BUY CRYPTO PENDING (Name Check without KYC) ---
emails.push({
  name: '10-pending-name-check-no-kyc',
  subject: 'Vollständige Verifizierung erforderlich',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.name_check_without_kyc.salutation,
    [
      text(mailTranslations.payment.pending.name_check_without_kyc.line1),
      text(mailTranslations.payment.pending.name_check_without_kyc.line2),
      { text: 'Klicke daher den nachfolgenden Link um dich zu verifizieren:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      text(mailTranslations.payment.pending.name_check_without_kyc.line4),
      { text: 'Wenn du dich nicht verifizieren möchtest kannst du auch eine Rückzahlung anfordern:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 16. BUY CRYPTO PENDING (Asset KYC Needed) ---
emails.push({
  name: '11-pending-asset-kyc',
  subject: 'Verifizierung (KYC) erforderlich',
  category: 'Transaktion - Pending',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.pending.asset_kyc_needed.salutation,
    [
      text(mailTranslations.payment.pending.asset_kyc_needed.line1),
      text(mailTranslations.payment.pending.asset_kyc_needed.line2),
      { text: 'Klicke daher den nachfolgenden Link um dich zu verifizieren:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      text(mailTranslations.payment.pending.asset_kyc_needed.line4),
      { text: 'Wenn du dich nicht verifizieren möchtest kannst du auch eine Rückzahlung anfordern:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier' } },
      space(),
      supportText(),
      space(),
      thanksText(),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 17. BUY CRYPTO RETURN (Chargeback - Example: Monthly Limit) ---
emails.push({
  name: '12-chargeback-crypto',
  subject: 'Guthaben wurde erstattet',
  category: 'Transaktion - Rückerstattung',
  template: 'user-v2',
  render: () => renderUserV2(
    'Dein Guthaben wurde an deine Wallet-Adresse zurückerstattet',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Rückzahlung:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      text('Grund, warum wir zurückerstattet haben:<br>' + mailTranslations.payment.chargeback.reasons.monthly_limit),
      { text: 'Du kannst den KYC Prozess hier starten:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      space(),
      supportText(),
      space(),
      thanksText(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 18. BUY CRYPTO CHARGEBACK UNCONFIRMED ---
emails.push({
  name: '13-chargeback-unconfirmed',
  subject: 'Aktion ausstehend',
  category: 'Transaktion - Rückerstattung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.payment.chargeback.unconfirmed.salutation,
    [
      { text: 'Du kannst die Aktion über folgenden Link ausführen:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 19. BUY FIAT COMPLETED ---
emails.push({
  name: '14-buy-fiat-completed',
  subject: 'Auszahlung verschickt',
  category: 'Verkauf (Buy Fiat)',
  template: 'user-v2',
  render: () => renderUserV2(
    'Deine Auszahlung wurde an dein Bankkonto verschickt',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Transaktion:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      space(),
      supportText(),
      space(),
      thanksText(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 20. CRYPTO INPUT RETURN ---
emails.push({
  name: '15-chargeback-crypto-input',
  subject: 'Guthaben wurde erstattet',
  category: 'Transaktion - Rückerstattung',
  template: 'user-v2',
  render: () => renderUserV2(
    'Dein Guthaben wurde an deine Wallet-Adresse zurückerstattet',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Rückzahlung:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      text('Grund, warum wir zurückerstattet haben:<br>' + mailTranslations.payment.chargeback.reasons.asset_currently_not_available),
      space(),
      supportText(),
      space(),
      thanksText(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 23. FIAT INPUT (Crypto-Kauf Eingang) ---
emails.push({
  name: '16-fiat-input',
  subject: 'Einzahlung eingetroffen',
  category: 'Zahlungseingang',
  template: 'user-v2',
  render: () => renderUserV2(
    'Deine Einzahlung ist bei DFX eingetroffen und ist in Bearbeitung',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Transaktion:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 24. FIAT INPUT with Currency Exchange ---
emails.push({
  name: '17-fiat-input-currency-exchange',
  subject: 'Einzahlung eingetroffen',
  category: 'Zahlungseingang',
  template: 'user-v2',
  render: () => renderUserV2(
    'Deine Einzahlung ist bei DFX eingetroffen und ist in Bearbeitung',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Transaktion:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      space(),
      text('Übrigens: Das CH68 0857 3177 9752 0181 2 Bankkonto ist ein EUR-Konto, wenn du CHF schickst wird dies direkt bei der Bank getauscht und wir erhalten EUR.<br>Wenn möglich schicke also direkt EUR zu diesem Bankkonto.'),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 25. CRYPTO INPUT ---
emails.push({
  name: '18-crypto-input',
  subject: 'Krypto-Asset eingetroffen',
  category: 'Zahlungseingang',
  template: 'user-v2',
  render: () => renderUserV2(
    'Dein Krypto-Asset ist bei uns eingetroffen',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Transaktion:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 26. UNASSIGNED TX ---
emails.push({
  name: '19-unassigned-transaction',
  subject: 'Einzahlung zuordnen',
  category: 'Zahlungseingang',
  template: 'user-v2',
  render: () => renderUserV2(
    'Deine Einzahlung kann nicht automatisch zugeordnet werden',
    [
      { text: 'Bitte ordne deinen Zahlungseingang deiner Bestellung zu:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 27. BANK TX RETURN ---
emails.push({
  name: '20-chargeback-fiat',
  subject: 'Guthaben wurde erstattet',
  category: 'Transaktion - Rückerstattung',
  template: 'user-v2',
  render: () => renderUserV2(
    'Dein Guthaben wurde an dein Bankkonto zurückerstattet',
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deiner Transaktion:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      { text: 'oder<br>', style: STYLE, url: { link: TX_URL, text: TX_URL } },
      space(),
      supportText(),
      space(),
      thanksText(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 28. KYC SUCCESS ---
emails.push({
  name: '21-kyc-success',
  subject: 'Verifikation erfolgreich',
  category: 'KYC / Verifizierung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.kyc.success.salutation,
    [
      space(),
      text(mailTranslations.kyc.success.message),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 29. KYC FAILED ---
emails.push({
  name: '22-kyc-failed',
  subject: 'Problem bei Verifizierung',
  category: 'KYC / Verifizierung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.kyc.failed.salutation,
    [
      space(),
      text("Der Schritt 'Identifikation' konnte aus folgendem Grund nicht abgeschlossen werden:<br>" + mailTranslations.kyc.failed.reasons.first_name_not_matching),
      space(),
      { text: '', style: STYLE, url: { link: KYC_URL, text: 'Klick hier', button: true } },
      { text: 'oder versuche es über die folgende URL erneut:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 30. KYC MISSING DATA ---
emails.push({
  name: '23-kyc-missing-data',
  subject: 'Fehlende Daten bei Verifizierung',
  category: 'KYC / Verifizierung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.kyc.missing_data.salutation,
    [
      space(),
      text("Bei dem Schritt 'Persönliche Daten' fehlen noch Daten, die du noch ergänzen musst, um deine Verifizierung abzuschließen"),
      space(),
      { text: '', style: STYLE, url: { link: KYC_URL, text: 'Klick hier', button: true } },
      { text: 'oder versuche es über die folgende URL erneut:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 31. KYC REMINDER ---
emails.push({
  name: '24-kyc-reminder',
  subject: 'Vervollständige Verifizierung',
  category: 'KYC / Verifizierung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.kyc.reminder.salutation,
    [
      space(),
      text(mailTranslations.kyc.reminder.message),
      space(),
      { text: '', style: STYLE, url: { link: KYC_URL, text: 'Klick hier', button: true } },
      { text: 'Um mit deiner Verifizierung fortzufahren, klicke auf der DFX-Services Webseite<br> oben rechts auf den Menüpunkt und dann auf "KYC"<br> und klicke den "Weiter" Button oder nutze den folgenden Link:<br>', style: STYLE, url: { link: KYC_URL, text: KYC_URL } },
      ...dfxTeamClosing(),
    ]
  ),
});

// --- LOGIN ---
emails.push({
  name: '25-login',
  subject: 'DFX Login',
  category: 'Login / Auth',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.login.salutation,
    [
      space(),
      { text: '', style: STYLE, url: { link: 'https://app.dfx.swiss/login?token=abc123xyz', text: 'Klick hier', button: true } },
      { text: 'oder klicke den nachfolgenden Link innerhalb von 30 Minuten um dich bei DFX einzuloggen:<br>', style: STYLE, url: { link: 'https://app.dfx.swiss/login?token=abc123xyz', text: 'https://app.dfx.swiss/login?token=abc123xyz' } },
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 34. VERIFICATION CODE (2FA) ---
emails.push({
  name: '26-verification-code-2fa',
  subject: 'Verifizierungscode',
  category: 'Login / Auth',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.verification_code.default.salutation,
    [
      space(),
      text('Dein Verifizierungscode lautet:<br><strong style="font-size:24px;color:#f5516c">847 293</strong>'),
      space(),
      { text: 'Der Verifizierungscode ist für 30 Minuten gültig. Bitte teile diesen Verifizierungscode nicht mit anderen Personen. Wenn du keinen Verifizierungscode angefordert hast, kontaktiere bitte unverzüglich den Support unter ', style: STYLE, url: { link: 'https://app.dfx.swiss/support', text: 'https://app.dfx.swiss/support' } },
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 35. EMAIL VERIFICATION CODE ---
emails.push({
  name: '27-email-verification-code',
  subject: 'E-Mail Verifizierungscode',
  category: 'Login / Auth',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.verification_code.email.salutation,
    [
      space(),
      text('Dein Verifizierungscode lautet:<br><strong style="font-size:24px;color:#f5516c">591 037</strong>'),
      space(),
      { text: 'Der Verifizierungscode ist für 30 Minuten gültig. Bitte teile diesen Verifizierungscode nicht mit anderen Personen. Wenn du keinen Verifizierungscode angefordert hast, kontaktiere bitte unverzüglich den Support unter ', style: STYLE, url: { link: 'https://app.dfx.swiss/support', text: 'https://app.dfx.swiss/support' } },
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 36. ACCOUNT DEACTIVATION ---
emails.push({
  name: '28-account-deactivation',
  subject: 'Account deaktiviert',
  category: 'Account-Verwaltung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.account_deactivation.salutation,
    [
      space(),
      text('Hi Max'),
      space(),
      text(mailTranslations.account_deactivation.message),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 37. ACCOUNT MERGE REQUEST ---
emails.push({
  name: '29-account-merge-request',
  subject: 'E-Mail bestätigen',
  category: 'Account-Verwaltung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.account_merge.request.salutation,
    [
      space(),
      text('Hi Max'),
      space(),
      { text: '', style: STYLE, url: { link: 'https://app.dfx.swiss/merge?token=xyz789', text: 'Klick hier', button: true } },
      { text: 'oder klicke den nachfolgenden Link, um deine E-Mail für einen anderen Account zu bestätigen:<br>', style: STYLE, url: { link: 'https://app.dfx.swiss/merge?token=xyz789', text: 'https://app.dfx.swiss/merge?token=xyz789' } },
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 38. ADDED ADDRESS ---
emails.push({
  name: '30-added-address',
  subject: 'Adresse zu Account hinzugefügt',
  category: 'Account-Verwaltung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.account_merge.added_address.salutation,
    [
      space(),
      text('Hi Max'),
      space(),
      text('Die Adresse bc1q42lja79elem0anu8q860g3...kj84 wurde deinem Account hinzugefügt.'),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 39. CHANGED MAIL ---
emails.push({
  name: '31-changed-mail',
  subject: 'Account Email wurde geändert',
  category: 'Account-Verwaltung',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.account_merge.changed_mail.salutation,
    [
      space(),
      text('Hi Max'),
      space(),
      text('Du hast zwei Accounts mit unterschiedlichen Email Adressen angelegt, welche nun zusammengelegt wurden. Die Email max@example.com wird ab sofort für deinen Account verwendet.'),
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 40. RECOMMENDATION MAIL ---
emails.push({
  name: '32-recommendation-mail',
  subject: 'DFX-Einladung',
  category: 'Empfehlung / Referral',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.recommendation.recommended.salutation,
    [
      space(),
      text('Hi Anna'),
      space(),
      text('Max Muster (max@example.com) hat dich eingeladen DFX zu nutzen'),
      space(),
      { text: 'Du kannst ganz einfach den nachfolgenden Button anklicken und dir einen Account mit dieser Email Adresse einrichten:<br>', style: STYLE, url: { link: 'https://app.dfx.swiss/register?ref=REF123', text: 'Klick hier', button: true } },
      space(),
      { text: 'Oder du benutzt den nachfolgenden Link:<br>', style: STYLE, url: { link: 'https://app.dfx.swiss/register?ref=REF123', text: 'https://app.dfx.swiss/register?ref=REF123' } },
      space(),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- REF REWARD ---
emails.push({
  name: '33-ref-reward',
  subject: 'Auszahlung Referral Rewards',
  category: 'Empfehlung / Referral',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.referral.salutation,
    [
      { text: 'Klicke den nachfolgenden Button für weitere Details zu deinem Referral Reward:<br>', style: STYLE, url: { link: TX_URL, text: 'Klick hier', button: true } },
      space(),
      text(mailTranslations.referral.dfx_ambassador),
      ...dfxTeamClosing(),
    ]
  ),
});

// --- 43. SUPPORT MESSAGE ---
emails.push({
  name: '34-support-message',
  subject: 'Neue Support Nachricht',
  category: 'Support',
  template: 'user-v2',
  render: () => renderUserV2(
    mailTranslations.support_message.salutation,
    [
      { text: 'Du hast eine neue Nachricht in deinem Support Ticket erhalten. Dein Ticket kannst du unter folgender URL abrufen:<br>', style: STYLE, url: { link: SUPPORT_URL, text: SUPPORT_URL } },
    ]
  ),
});

// ============================================================
// GENERATE INDEX + ALL FILES
// ============================================================

// Group by category
const categories = {};
emails.forEach((email) => {
  if (!categories[email.category]) categories[email.category] = [];
  categories[email.category].push(email);
});

// Generate each email HTML
emails.forEach((email) => {
  const html = email.render();
  fs.writeFileSync(path.join(OUTPUT_DIR, `${email.name}.html`), html, 'utf-8');
});

// Generate index.html
const indexHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DFX E-Mail Previews</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; color: #1a1a1a; }
    .header { background: #072440; color: white; padding: 32px; text-align: center; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { opacity: 0.7; font-size: 14px; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .category { margin-bottom: 32px; }
    .category h2 { font-size: 18px; color: #072440; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #072440; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .card { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.12); transition: transform 0.15s, box-shadow 0.15s; cursor: pointer; text-decoration: none; color: inherit; display: block; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .card-preview { height: 180px; overflow: hidden; border-bottom: 1px solid #e5e7eb; position: relative; }
    .card-preview iframe { width: 500px; height: 600px; border: none; transform: scale(0.65); transform-origin: top left; pointer-events: none; }
    .card-body { padding: 12px 16px; }
    .card-body .subject { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
    .card-body .template { font-size: 12px; color: #6b7280; }
    .stats { text-align: center; margin-bottom: 24px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>DFX E-Mail Previews</h1>
    <p>${emails.length} E-Mails mit Beispieldaten (Deutsch)</p>
  </div>
  <div class="container">
    <p class="stats">Klicke auf eine Karte, um die E-Mail in voller Groesse anzuzeigen.</p>
    ${Object.entries(categories).map(([cat, items]) => `
    <div class="category">
      <h2>${cat} (${items.length})</h2>
      <div class="grid">
        ${items.map((e) => `
        <a class="card" href="${e.name}.html" target="_blank">
          <div class="card-preview">
            <iframe src="${e.name}.html" loading="lazy"></iframe>
          </div>
          <div class="card-body">
            <div class="subject">${e.subject}</div>
            <div class="template">Template: ${e.template}</div>
          </div>
        </a>`).join('')}
      </div>
    </div>`).join('')}
  </div>
</body>
</html>`;

fs.writeFileSync(path.join(OUTPUT_DIR, '00_index.html'), indexHtml, 'utf-8');

console.log(`\n✅ Generated ${emails.length} email previews in ${OUTPUT_DIR}/`);
console.log(`📂 Open: ${OUTPUT_DIR}/00_index.html`);
