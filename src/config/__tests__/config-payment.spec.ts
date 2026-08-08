import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { PaymentStandard } from 'src/subdomains/core/payment-link/enums';

/**
 * The payment-link section of the config is not plain data: confirmation depths, payout floors,
 * forex surcharges and quote lifetimes are computed by small closures whose fallback arm decides
 * what happens for every blockchain / payment standard that is not listed explicitly. Those
 * fallbacks are the money-relevant part, so they are pinned alongside the explicit entries.
 */
describe('Config.payment', () => {
  const config = GetConfig();

  const fiat = (name: string) => ({ name }) as Fiat;
  const asset = (name: string) => ({ name }) as Asset;

  describe('minConfirmations', () => {
    // A UTXO/privacy chain needs a real confirmation depth; ICP finalizes in one block.
    it.each([
      [Blockchain.ETHEREUM, 6],
      [Blockchain.BITCOIN, 6],
      [Blockchain.FIRO, 6],
      [Blockchain.MONERO, 6],
      [Blockchain.ZANO, 6],
      [Blockchain.INTERNET_COMPUTER, 1],
    ] as [Blockchain, number][])('credits %s only after %s confirmations', (blockchain, expected) => {
      expect(config.payment.minConfirmations(blockchain)).toBe(expected);
    });

    // Fail-safe fallback: an unlisted chain is treated as needing effectively unreachable
    // confirmation, so a newly added chain can never be credited by accident before it is
    // configured deliberately.
    it.each([Blockchain.POLYGON, Blockchain.BASE, Blockchain.LIGHTNING])(
      'falls back to 100 confirmations for the unlisted chain %s',
      (blockchain) => {
        expect(config.payment.minConfirmations(blockchain)).toBe(100);
      },
    );
  });

  describe('cryptoPayoutMinAmount', () => {
    const envBackup = process.env.PAYMENT_CRYPTO_PAYOUT_MIN;

    afterEach(() => {
      if (envBackup === undefined) delete process.env.PAYMENT_CRYPTO_PAYOUT_MIN;
      else process.env.PAYMENT_CRYPTO_PAYOUT_MIN = envBackup;
    });

    // Lightning has no economic floor (its fees do not scale with the amount), so it is the one
    // chain with an explicit 0 — which must survive the `??` fallback rather than being replaced.
    it('allows any amount on Lightning', () => {
      delete process.env.PAYMENT_CRYPTO_PAYOUT_MIN;

      expect(GetConfig().payment.cryptoPayoutMinAmount(Blockchain.LIGHTNING)).toBe(0);
    });

    it('defaults every other chain to 1000 CHF', () => {
      delete process.env.PAYMENT_CRYPTO_PAYOUT_MIN;

      expect(GetConfig().payment.cryptoPayoutMinAmount(Blockchain.ETHEREUM)).toBe(1000);
    });

    it('takes the floor from PAYMENT_CRYPTO_PAYOUT_MIN when set', () => {
      process.env.PAYMENT_CRYPTO_PAYOUT_MIN = '250';

      const cfg = GetConfig();

      expect(cfg.payment.cryptoPayoutMinAmount(Blockchain.ETHEREUM)).toBe(250);
      // The explicit Lightning entry stays untouched by the env override.
      expect(cfg.payment.cryptoPayoutMinAmount(Blockchain.LIGHTNING)).toBe(0);
    });
  });

  describe('forexFee', () => {
    // No currency conversion happens when a CHF invoice is settled in a CHF stablecoin, so charging
    // a forex fee there would be charging for nothing.
    it.each(['ZCHF', 'VCHF'])('charges nothing for a CHF invoice paid in %s', (paymentAsset) => {
      expect(config.payment.forexFee(PaymentStandard.PAY_TO_ADDRESS, fiat('CHF'), asset(paymentAsset))).toBe(0);
      expect(config.payment.forexFee(PaymentStandard.OPEN_CRYPTO_PAY, fiat('CHF'), asset(paymentAsset))).toBe(0);
    });

    it('charges the standard fee for a CHF invoice paid in a non-CHF asset', () => {
      expect(config.payment.forexFee(PaymentStandard.OPEN_CRYPTO_PAY, fiat('CHF'), asset('USDT'))).toBe(
        config.payment.defaultForexFee,
      );
    });

    it('charges the standard fee for a non-CHF invoice even when paid in ZCHF', () => {
      expect(config.payment.forexFee(PaymentStandard.OPEN_CRYPTO_PAY, fiat('EUR'), asset('ZCHF'))).toBe(
        config.payment.defaultForexFee,
      );
    });

    // Pay-to-address carries the higher rate because the quote has to be held far longer (see
    // quoteTimeout below) and therefore absorbs more exchange-rate movement.
    it('charges the higher address rate for pay-to-address and the default rate otherwise', () => {
      expect(config.payment.forexFee(PaymentStandard.PAY_TO_ADDRESS, fiat('EUR'), asset('USDT'))).toBe(
        config.payment.addressForexFee,
      );
      expect(config.payment.forexFee(PaymentStandard.OPEN_CRYPTO_PAY, fiat('EUR'), asset('USDT'))).toBe(
        config.payment.defaultForexFee,
      );
      expect(config.payment.forexFee(PaymentStandard.LIGHTNING_BOLT11, fiat('EUR'), asset('USDT'))).toBe(
        config.payment.defaultForexFee,
      );

      expect(config.payment.addressForexFee).toBeGreaterThan(config.payment.defaultForexFee);
    });
  });

  describe('quoteTimeout', () => {
    it('holds a pay-to-address quote far longer than an interactive one', () => {
      expect(config.payment.quoteTimeout(PaymentStandard.PAY_TO_ADDRESS)).toBe(config.payment.addressQuoteTimeout);
      expect(config.payment.quoteTimeout(PaymentStandard.OPEN_CRYPTO_PAY)).toBe(config.payment.defaultQuoteTimeout);
      expect(config.payment.quoteTimeout(PaymentStandard.LIGHTNING_BOLT11)).toBe(config.payment.defaultQuoteTimeout);

      expect(config.payment.addressQuoteTimeout).toBeGreaterThan(config.payment.defaultQuoteTimeout);
    });
  });

  describe('standards', () => {
    // The list is what the payment-link API offers to a client, so a PaymentStandard without an
    // entry would be selectable by the backend but undescribable to the frontend.
    it('describes every payment standard exactly once', () => {
      expect(config.payment.standards.map((s) => s.id).sort()).toEqual(Object.values(PaymentStandard).sort());
      expect(config.payment.standards.every((s) => s.label && s.description && s.paymentIdentifierLabel)).toBe(true);
    });

    it('templates the blockchain name into the pay-to-address labels', () => {
      const standard = config.payment.standards.find((s) => s.id === PaymentStandard.PAY_TO_ADDRESS);

      expect(standard?.label).toContain('{{blockchain}}');
      expect(standard?.description).toContain('{{blockchain}}');
    });
  });
});
