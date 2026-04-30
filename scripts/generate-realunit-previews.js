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

// Per-mail trigger explanations: when (customer-facing), mailContext (technical),
// transition (DB/state condition that fires the cron / direct call).
// Source: src/subdomains/{core,supporting,generic}/**/*notification.service.ts (verified 2026-04-30).
const triggers = {
  'buy-crypto-completed': {
    when: 'Sobald Ihre Fiat-Einzahlung verbucht und die gekauften RealUnit-Token in Ihr Wallet überwiesen wurden, bestätigt Ihnen diese Mail den abgeschlossenen Kauf.',
    mailContext: 'BUY_CRYPTO_COMPLETED',
    transition: 'BuyCrypto.status = COMPLETE, isComplete = true, amlCheck = PASS, outputAmount gesetzt — Cron BUY_CRYPTO_MAIL.',
  },
  'sell-processing': {
    when: 'Sobald Ihre RealUnit-Token im Verkaufsprozess angekommen sind und DFX die Auszahlung an Ihre Bank ausgelöst hat. Diese Mail bestätigt den Start der Verarbeitung.',
    mailContext: 'BUY_FIAT_PROCESSING',
    transition: 'BuyFiat.fiatToBankTransferInitiated() — direkt aufgerufen, sobald der Bank-Transfer für eine geprüfte Sell-Transaktion initiiert wird.',
  },
  'sell-completed': {
    when: 'Sobald die Banküberweisung Ihres Verkaufserlöses an Ihre IBAN ausgeführt wurde, bestätigt diese Mail den abgeschlossenen Verkauf.',
    mailContext: 'BUY_FIAT_COMPLETED',
    transition: 'BuyFiat: amlCheck = PASS, isComplete = true, outputAmount gesetzt, mail3SendDate IS NULL — Cron BUY_FIAT_MAIL (1 Min.).',
  },
  'fiat-input': {
    when: 'Sobald Ihre Banküberweisung bei DFX eingetroffen und Ihrer Bestellung zugeordnet ist, bestätigen wir den Eingang.',
    mailContext: 'BUY_CRYPTO',
    transition: 'Transaction.mailSendDate IS NULL, Target (BuyCrypto/BuyFiat) hat comment oder amlCheck — Cron TX_MAIL (1 Min.).',
  },
  'fiat-input-currency-exchange': {
    when: 'Wie der Standard-Eingangsbestätigung — zusätzlich mit Hinweis, dass die eingezahlte Währung von der Bankkonto-Währung abweicht und automatisch getauscht wird.',
    mailContext: 'BUY_CRYPTO',
    transition: 'Wie fiat-input, zusätzlich BankTx.instructedCurrency !== BankTx.currency.',
  },
  'crypto-input': {
    when: 'Sobald Ihre RealUnit-Token (Verkauf) bzw. Ihre Krypto-Einzahlung (Crypto-zu-Crypto-Tausch) bei DFX angekommen sind, bestätigen wir den Eingang.',
    mailContext: 'BUY_FIAT (Verkauf) oder BUY_CRYPTO (Crypto-zu-Crypto)',
    transition: 'Wie fiat-input, aber Target ist BuyFiat (cryptoInput) oder BuyCrypto.isCryptoCryptoTransaction.',
  },
  'unassigned-transaction': {
    when: 'Wenn eine Banküberweisung bei uns eingeht, die wir keiner offenen Bestellung zuordnen können, bitten wir Sie um manuelle Zuordnung in der App.',
    mailContext: 'UNASSIGNED_TX',
    transition: 'BankTx mit Unassigned-Type, Credit-Indikator, jünger als 7 Tage, Transaction.mailSendDate IS NULL — Cron TX_MAIL (1 Min.).',
  },
  'pending-monthly-limit': {
    when: 'Wenn Ihr 30-Tage-Volumen die regulatorische Limite (CHF 1\'000) überschreitet, bei der unsere bisherigen Daten ausreichen, halten wir Ihre Transaktion bis zur Verifizierung an.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlCheck = PENDING, amlReason = MONTHLY_LIMIT, outputAmount IS NULL, kein Chargeback initiiert — Cron BUY_*_MAIL.',
  },
  'pending-annual-limit': {
    when: 'Wenn Ihr Jahresvolumen die regulatorische Limite (CHF 100\'000) überschreitet, ist eine erweiterte Verifizierung Ihrer Daten nötig, bevor die Transaktion fortgesetzt wird.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = ANNUAL_LIMIT, sonst wie pending-monthly-limit.',
  },
  'pending-annual-limit-without-kyc': {
    when: 'Wenn Ihr Jahresvolumen ohne Verifizierung die zulässige Grenze überschritten hat, ist eine vollständige KYC-Prüfung erforderlich.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = ANNUAL_LIMIT_WITHOUT_KYC, sonst wie pending-monthly-limit.',
  },
  'pending-manual-check': {
    when: 'Wenn unser System Ihre Einzahlung nicht automatisch verbuchen kann, prüfen wir den Eingang manuell. Das dauert in der Regel 1–2 Arbeitstage.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = MANUAL_CHECK oder MANUAL_CHECK_BANK_DATA, sonst wie pending-monthly-limit.',
  },
  'pending-high-risk-kyc': {
    when: 'Wenn Ihre Transaktion aus aufsichtsrechtlichen Gründen einer erweiterten Prüfung unterliegt, ist vor der Fortsetzung eine vollständige Verifizierung nötig.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = HIGH_RISK_KYC_NEEDED, sonst wie pending-monthly-limit.',
  },
  'pending-video-ident': {
    when: 'Wenn aus regulatorischen Gründen eine Video-Identifikation nötig ist, bitten wir Sie, diese durchzuführen, bevor die Transaktion weitergeht.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = VIDEO_IDENT_NEEDED, sonst wie pending-monthly-limit.',
  },
  'pending-kyc-data': {
    when: 'Wenn für Ihre Transaktion zusätzliche persönliche Daten nötig sind, bitten wir Sie, diese in der RealUnit App zu ergänzen.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = KYC_DATA_NEEDED, sonst wie pending-monthly-limit.',
  },
  'pending-name-check-no-kyc': {
    when: 'Wenn der angegebene Name eine vollständige Verifizierung erfordert, bevor die Transaktion fortgesetzt werden kann.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = NAME_CHECK_WITHOUT_KYC, sonst wie pending-monthly-limit.',
  },
  'pending-asset-kyc': {
    when: 'Wenn das von Ihnen verwendete Asset eine spezifische KYC-Prüfung erfordert, bitten wir Sie um Ergänzung Ihrer Daten.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = ASSET_KYC_NEEDED, sonst wie pending-monthly-limit.',
  },
  'pending-merge-incomplete': {
    when: 'Wenn Sie zwei Accounts mit derselben E-Mail-Adresse haben und die Bestätigungs-Mail zur Zusammenlegung noch nicht akzeptiert wurde, kann die Transaktion erst danach fortgesetzt werden.',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = MERGE_INCOMPLETE, sonst wie pending-monthly-limit.',
  },
  'pending-bank-release': {
    when: 'Wenn Ihre Banküberweisung bei uns eingegangen, von der Bank aber noch nicht freigegeben ist. Sie müssen nichts tun — die Bank gibt die Transaktion automatisch frei.',
    mailContext: 'BUY_CRYPTO_PENDING (nur Kauf-Seite)',
    transition: 'amlReason = BANK_RELEASE_PENDING, sonst wie pending-monthly-limit. Trigger nur auf BuyCrypto definiert.',
  },
  'pending-olky-no-kyc': {
    when: 'Wenn Sie das Olky-Bankkonto verwenden, ist immer eine vollständige Verifizierung erforderlich.',
    mailContext: 'BUY_CRYPTO_PENDING (nur Kauf-Seite)',
    transition: 'amlReason = OLKY_NO_KYC, sonst wie pending-monthly-limit. Trigger nur auf BuyCrypto definiert.',
  },
  'pending-bank-tx-needed': {
    when: 'Wenn vor Ihrer Transaktion zuerst eine Banküberweisung erforderlich ist (z. B. zur Validierung Ihrer Konto-Inhaberschaft).',
    mailContext: 'BUY_CRYPTO_PENDING / BUY_FIAT_PENDING',
    transition: 'amlReason = BANK_TX_NEEDED, sonst wie pending-monthly-limit.',
  },
  'chargeback-crypto': {
    when: 'Wenn ein begonnener Verkauf nicht ausgeführt werden kann (z. B. wegen einer überschrittenen regulatorischen Grenze), erstatten wir Ihre RealUnit-Token an Ihr Wallet zurück.',
    mailContext: 'BUY_FIAT_RETURN (Verkauf zurückgewiesen) bzw. CRYPTO_INPUT_RETURN (Crypto-Eingang zurück)',
    transition: 'BuyFiat: amlCheck = FAIL, chargebackTxId/Date/AllowedDate gesetzt — Cron BUY_FIAT_MAIL. Oder CryptoInput.action = RETURN, returnTxId gesetzt — Cron PAY_IN_MAIL.',
  },
  'chargeback-fiat': {
    when: 'Wenn ein begonnener Kauf nicht ausgeführt werden kann (z. B. weil die Bank die Transaktion nicht zulässt), erstatten wir Ihre Banküberweisung zurück.',
    mailContext: 'BUY_CRYPTO_RETURN (Kauf zurückgewiesen) bzw. BANK_TX_RETURN (Bank-Tx zurück)',
    transition: 'BuyCrypto: amlCheck = FAIL, chargebackBankTx + chargebackIban + chargebackDate gesetzt. Oder BankTxReturn: chargebackAmount/Date/AllowedDate/BankTx/Iban gesetzt — Cron BANK_TX_RETURN_MAIL.',
  },
  'chargeback-unconfirmed': {
    when: 'Wenn eine Rückerstattung initiiert wurde, aber von Ihnen noch nicht in der App bestätigt ist (z. B. mit Angabe der korrekten IBAN), bevor sie ausgeführt werden kann.',
    mailContext: 'BUY_CRYPTO_CHARGEBACK_UNCONFIRMED / BUY_FIAT_CHARGEBACK_UNCONFIRMED',
    transition: 'amlCheck = FAIL, amlReason gesetzt, alle chargeback*-Felder (Iban/AllowedDate/Date/Address/Amount) IS NULL — Cron BUY_*_MAIL.',
  },
  'kyc-success': {
    when: 'Sobald Ihre Verifizierung (KYC) bei der DFX AG abgeschlossen ist und Sie die volle Funktionalität von RealUnit nutzen können.',
    mailContext: 'KYC_CHANGED',
    transition: 'KycNotificationService.kycChanged(userData, KycLevel.LEVEL_50) — direkt aufgerufen bei KYC-Stufenwechsel auf Level 50.',
  },
  'kyc-failed': {
    when: 'Wenn ein Schritt Ihrer Verifizierung nicht erfolgreich war (z. B. weil Daten nicht zusammenpassen), bitten wir Sie um Wiederholung.',
    mailContext: 'KYC_FAILED',
    transition: 'KycNotificationService.kycStepFailed(userData, stepName, reason) — direkt aufgerufen, wenn ein KycStep mit Status FAIL endet.',
  },
  'kyc-missing-data': {
    when: 'Wenn bei einem Verifizierungs-Schritt Daten fehlen, die Sie noch ergänzen müssen.',
    mailContext: 'KYC_MISSING_DATA',
    transition: 'KycNotificationService.kycStepMissingData(userData, stepName) — direkt aufgerufen, wenn ein KycStep wegen unvollständiger Daten nicht abgeschlossen werden kann.',
  },
  'kyc-reminder': {
    when: 'Erinnerung, falls Sie einen Verifizierungs-Schritt vor einigen Tagen begonnen, aber noch nicht abgeschlossen haben.',
    mailContext: 'KYC_REMINDER',
    transition: 'KycStep.status = IN_PROGRESS, updated < heute - Config.kyc.reminderAfterDays, userData.kycLevel zwischen 0 und 50, reminderSentDate IS NULL — Cron KYC_MAIL (stündlich).',
  },
  login: {
    when: 'Wenn Sie sich per E-Mail-Login (Magic-Link) anmelden, schicken wir Ihnen den Anmeldelink an Ihre registrierte Adresse.',
    mailContext: 'LOGIN',
    transition: 'AuthService — direkt nach erfolgreicher Login-Anfrage versendet, Link gültig für Config.auth.mailLoginExpiresIn Minuten.',
  },
  'verification-code-2fa': {
    when: 'Wenn Sie eine sicherheitsrelevante Aktion durchführen (z. B. von einem neuen Gerät), schickt die App einen Verifizierungscode per Mail.',
    mailContext: 'VERIFICATION_MAIL',
    transition: 'TfaService.sendVerificationMail(userData, code, expirationMinutes, VERIFICATION_MAIL) — direkt aufgerufen aus dem 2FA-Flow.',
  },
  'email-verification-code': {
    when: 'Wenn Sie Ihre E-Mail-Adresse ändern, schicken wir an die neue Adresse einen Code zur Bestätigung.',
    mailContext: 'EMAIL_VERIFICATION',
    transition: 'TfaService.sendVerificationMail(userData, code, expirationMinutes, EMAIL_VERIFICATION) — direkt aufgerufen beim Ändern der E-Mail.',
  },
  'account-merge-request': {
    when: 'Wenn Sie zwei Accounts mit derselben E-Mail-Adresse haben, schicken wir einen Bestätigungslink, damit beide zusammengelegt werden können.',
    mailContext: 'ACCOUNT_MERGE_REQUEST',
    transition: 'AccountMergeService.sendMergeRequest(master, slave, reason) — direkt aufgerufen, wenn ein neuer Merge-Request angelegt wird (Debounce 60 s).',
  },
  'added-address': {
    when: 'Sobald durch eine Account-Zusammenlegung eine zusätzliche Wallet-Adresse zu Ihrem Account hinzugefügt wurde.',
    mailContext: 'ADDED_ADDRESS',
    transition: 'UserDataNotificationService.userDataAddedAddressInfo(master, slave) — direkt aufgerufen nach erfolgreichem Account-Merge mit `notifyUser = true`.',
  },
  'changed-mail': {
    when: 'Sobald durch eine Account-Zusammenlegung die für Ihren Account verwendete E-Mail-Adresse geändert wurde.',
    mailContext: 'CHANGED_MAIL',
    transition: 'UserDataNotificationService.userDataChangedMailInfo(master, slave) — direkt aufgerufen, wenn beim Merge die Master-Mail durch die Slave-Mail überschrieben wird (Master und Slave erhalten je eine Mail).',
  },
  'account-deactivation': {
    when: 'Sobald Sie Ihren Account deaktiviert haben — als Bestätigung, dass die Deaktivierung durchgeführt wurde.',
    mailContext: 'ACCOUNT_DEACTIVATION',
    transition: 'UserDataNotificationService.deactivateAccountMail(userData) — direkt aufgerufen aus UserDataService, sobald der Account-Status auf DEACTIVATED wechselt.',
  },
  'recommendation-mail': {
    when: 'Wenn ein bestehender RealUnit-Nutzer Sie zur Nutzung der App eingeladen hat, schicken wir Ihnen den Registrierungslink.',
    mailContext: 'RECOMMENDATION_MAIL',
    transition: 'RecommendationService.sendInvitationMail(entity) — direkt aufgerufen, wenn eine neue Recommendation angelegt und der Eingeladene noch keinen Account hat.',
  },
  'ref-reward': {
    when: 'Sobald eine Empfehlungsprämie für eine erfolgreiche Empfehlung von Ihnen ausbezahlt wurde.',
    mailContext: 'REF_REWARD',
    transition: 'RefReward: status = COMPLETE, outputAmount gesetzt, recipientMail IS NULL, targetAddress + targetBlockchain gesetzt, mailSendDate IS NULL — Cron REF_REWARD_MAIL.',
  },
  'support-message': {
    when: 'Wenn Sie zu einer Ihrer Support-Anfragen eine neue Antwort erhalten haben.',
    mailContext: 'SUPPORT_MESSAGE',
    transition: 'SupportIssueNotificationService.newSupportMessage(entity) — direkt aufgerufen, wenn eine neue SupportMessage zu einem bestehenden Issue eingeht.',
  },
  'limit-request': {
    when: 'Sobald Ihr Antrag auf höhere Transaktionslimiten manuell genehmigt wurde.',
    mailContext: 'LIMIT_REQUEST',
    transition: 'LimitRequest: decision IN (ACCEPTED, PARTIALLY_ACCEPTED), clerk + edited gesetzt, mailSendDate IS NULL — Cron LIMIT_REQUEST_MAIL (5 Min.).',
  },
};

function wrapWithTrigger(mail) {
  const mailHtml = buildMail(mail.salutation, mail.texts);
  const stem = mail.file.replace(/^\d+-/, '');
  const t = triggers[stem];
  if (!t) {
    console.warn(`[trigger] Missing explanation for ${mail.file}`);
    return mailHtml;
  }
  const infoBox = `<div class="trigger-info" style="max-width:520px;margin:0 auto 8px;padding:16px 20px;background:#FFF8E6;border:1px solid #F2D27A;border-radius:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#3B3322;">
    <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8A6914;margin-bottom:6px;">Wann wird diese Mail versendet?</div>
    <div style="font-size:13px;line-height:1.55;margin-bottom:10px;">${t.when}</div>
    <div style="font-size:11px;color:#7A6A3A;line-height:1.5;border-top:1px solid #F2D27A;padding-top:8px;">
      <div><strong>Technischer Trigger (MailContext):</strong> <code style="background:#F5EBC8;padding:1px 5px;border-radius:3px;font-family:ui-monospace,Menlo,monospace;">${t.mailContext}</code></div>
      <div style="margin-top:3px;"><strong>Auslöser:</strong> ${t.transition}</div>
    </div>
  </div>
  <style>body.preview-mode .trigger-info{display:none}</style>
  <script>if(window!==window.parent){document.body.classList.add('preview-mode')}</script>`;
  return mailHtml.replace(/(<body[^>]*>)/, `$1${infoBox}`);
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
  const html = wrapWithTrigger(mail);
  fs.writeFileSync(path.join(OUTPUT_DIR, `${mail.file}.html`), html);
}

// Index — fixed category order (customer journey: incoming money first, then completion, sell, holds, refunds, account/auth admin)
const categoryOrder = ['Eingang', 'Kauf', 'Verkauf', 'Ausstehend', 'Rückerstattung', 'KYC', 'Authentifizierung', 'Account', 'Sonstiges'];
const categories = {};
for (const cat of categoryOrder) categories[cat] = [];
for (const m of mails) {
  if (!categories[m.category]) categories[m.category] = [];
  categories[m.category].push(m);
}
for (const cat of Object.keys(categories)) {
  if (categories[cat].length === 0) delete categories[cat];
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
    .card-body .template { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
    .card-body .when { font-size: 12px; color: #4A5568; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
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
    (m) => {
      const stem = m.file.replace(/^\d+-/, '');
      const when = (triggers[stem] && triggers[stem].when) || '';
      return `        <a class="card" href="${m.file}.html" target="_blank">
          <div class="card-preview"><iframe src="${m.file}.html" loading="lazy"></iframe></div>
          <div class="card-body">
            <div class="subject">${m.subject}</div>
            <div class="template">${m.file}</div>
            <div class="when">${when}</div>
          </div>
        </a>`;
    },
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
