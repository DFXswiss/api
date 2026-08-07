import { getMetadataArgsStorage } from 'typeorm';
import { WebhookType } from '../../../services/webhook/dto/webhook.dto';
import { Wallet, WebhookConfigOption } from '../wallet.entity';

describe('Wallet', () => {
  const paymentConfig = (payment: WebhookConfigOption) => JSON.stringify({ payment, kyc: WebhookConfigOption.TRUE });

  const walletWith = (overrides: Partial<Wallet>): Wallet => Object.assign(new Wallet(), overrides);

  describe('paymentsApiEnabled column metadata', () => {
    it('defaults paymentsApiEnabled to false (fail-closed; same as sibling wallet booleans)', () => {
      const column = getMetadataArgsStorage().columns.find(
        (c) => c.target === Wallet && c.propertyName === 'paymentsApiEnabled',
      );
      const sibling = getMetadataArgsStorage().columns.find(
        (c) => c.target === Wallet && c.propertyName === 'isKycClient',
      );

      // Fail-closed: missing / unset rows must not open the payments API.
      expect(column?.options.default).toBe(false);
      // Decorator style matches siblings — no explicit type/nullable options required.
      expect(column?.options.default).toBe(sibling?.options.default);
    });
  });

  describe('#isPaymentsApiEnabled', () => {
    it('is true only for an explicit true', () => {
      expect(walletWith({ paymentsApiEnabled: true }).isPaymentsApiEnabled).toBe(true);
      expect(walletWith({ paymentsApiEnabled: false }).isPaymentsApiEnabled).toBe(false);
      expect(walletWith({}).isPaymentsApiEnabled).toBe(false);
    });
  });

  describe('#isValidForWebhook', () => {
    it('requires paymentsApiEnabled for PAYMENT but not for KYC types', () => {
      const base = {
        apiUrl: 'https://partner.example.com/hook',
        webhookConfig: JSON.stringify({
          payment: WebhookConfigOption.TRUE,
          kyc: WebhookConfigOption.TRUE,
        }),
      };

      const disabled = walletWith({ ...base, paymentsApiEnabled: false });
      expect(disabled.isValidForWebhook(WebhookType.PAYMENT, false)).toBe(false);
      expect(disabled.isValidForWebhook(WebhookType.KYC_CHANGED, false)).toBe(true);
      expect(disabled.isValidForWebhook(WebhookType.KYC_FAILED, true)).toBe(true);
      expect(disabled.isValidForWebhook(WebhookType.ACCOUNT_CHANGED, false)).toBe(true);

      const enabled = walletWith({ ...base, paymentsApiEnabled: true });
      expect(enabled.isValidForWebhook(WebhookType.PAYMENT, false)).toBe(true);
      expect(enabled.isValidForWebhook(WebhookType.KYC_CHANGED, false)).toBe(true);
    });

    it('still requires apiUrl and payment option for PAYMENT when the flag is on', () => {
      const enabled = walletWith({
        paymentsApiEnabled: true,
        webhookConfig: paymentConfig(WebhookConfigOption.TRUE),
      });
      expect(enabled.isValidForWebhook(WebhookType.PAYMENT, false)).toBe(false);

      const noOption = walletWith({
        apiUrl: 'https://partner.example.com/hook',
        paymentsApiEnabled: true,
      });
      expect(noOption.isValidForWebhook(WebhookType.PAYMENT, false)).toBe(false);
    });

    it('respects payment option for PAYMENT when flag and apiUrl are set', () => {
      const wallet = walletWith({
        apiUrl: 'https://partner.example.com/hook',
        paymentsApiEnabled: true,
        webhookConfig: paymentConfig(WebhookConfigOption.CONSENT_ONLY),
      });
      expect(wallet.isValidForWebhook(WebhookType.PAYMENT, false)).toBe(false);
      expect(wallet.isValidForWebhook(WebhookType.PAYMENT, true)).toBe(true);
    });
  });

  describe('#isPaymentWebhookSuppressedOnlyByApiGate', () => {
    const apiUrl = 'https://partner.example.com/hook';

    it.each([
      // option, consented, expected when flag false + apiUrl set
      [WebhookConfigOption.TRUE, false, true],
      [WebhookConfigOption.TRUE, true, true],
      [WebhookConfigOption.FALSE, false, false],
      [WebhookConfigOption.FALSE, true, false],
      [WebhookConfigOption.CONSENT_ONLY, false, false],
      [WebhookConfigOption.CONSENT_ONLY, true, true],
      [WebhookConfigOption.WALLET_ONLY, false, true],
      [WebhookConfigOption.WALLET_ONLY, true, false],
    ] as const)('option %s, consented=%s → suppressed=%s (flag off, apiUrl set)', (option, consented, expected) => {
      const wallet = walletWith({
        apiUrl,
        paymentsApiEnabled: false,
        webhookConfig: paymentConfig(option),
      });
      expect(wallet.isPaymentWebhookSuppressedOnlyByApiGate(consented)).toBe(expected);
    });

    it('is false when paymentsApiEnabled is true (gate not the reason)', () => {
      const wallet = walletWith({
        apiUrl,
        paymentsApiEnabled: true,
        webhookConfig: paymentConfig(WebhookConfigOption.TRUE),
      });
      expect(wallet.isPaymentWebhookSuppressedOnlyByApiGate(false)).toBe(false);
      expect(wallet.isPaymentWebhookSuppressedOnlyByApiGate(true)).toBe(false);
    });

    it('is false when apiUrl is missing (would not deliver anyway)', () => {
      const wallet = walletWith({
        paymentsApiEnabled: false,
        webhookConfig: paymentConfig(WebhookConfigOption.TRUE),
      });
      expect(wallet.isPaymentWebhookSuppressedOnlyByApiGate(false)).toBe(false);
    });
  });
});
