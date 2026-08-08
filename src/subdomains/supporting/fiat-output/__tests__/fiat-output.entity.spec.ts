import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { getMetadataArgsStorage } from 'typeorm';
import { BankTxReturn } from '../../bank-tx/bank-tx-return/bank-tx-return.entity';
import { Bank } from '../../bank/bank/bank.entity';
import { createCustomFiatOutput } from '../__mocks__/fiat-output.entity.mock';
import { FiatOutput } from '../fiat-output.entity';

function buyCrypto(values: Partial<BuyCrypto>): BuyCrypto {
  return Object.assign(new BuyCrypto(), values);
}

function buyFiat(values: Partial<BuyFiat>): BuyFiat {
  return Object.assign(new BuyFiat(), values);
}

function bankTxReturn(values: Partial<BankTxReturn>): BankTxReturn {
  return Object.assign(new BankTxReturn(), values);
}

describe('FiatOutput', () => {
  describe('setBatch', () => {
    it('assigns the batch and returns the update tuple', () => {
      const output = createCustomFiatOutput({ id: 7 });

      expect(output.setBatch(3, 1234.6)).toEqual([7, { batchId: 3, batchAmount: 1235 }]);
      expect(output.batchId).toBe(3);
      expect(output.batchAmount).toBe(1235);
    });

    it('clears the batch when called without one', () => {
      const output = createCustomFiatOutput({ id: 7, batchId: 3, batchAmount: 100 });

      expect(output.setBatch()).toEqual([7, { batchId: undefined, batchAmount: NaN }]);
      expect(output.batchId).toBeUndefined();
    });
  });

  describe('sourceIban', () => {
    it('prefers the bank of the row', () => {
      const bank = Object.assign(new Bank(), { iban: 'BANK-IBAN' });

      expect(createCustomFiatOutput({ bank, accountIban: 'ACCOUNT-IBAN' }).sourceIban).toBe('BANK-IBAN');
    });

    it('falls back to the explicitly assigned account IBAN', () => {
      expect(createCustomFiatOutput({ accountIban: 'ACCOUNT-IBAN' }).sourceIban).toBe('ACCOUNT-IBAN');
    });
  });

  describe('ibanCountry', () => {
    it('reads the chargeback IBAN of a buy-crypto refund', () => {
      const output = createCustomFiatOutput({ buyCrypto: buyCrypto({ chargebackIban: 'DE89370400440532013000' }) });

      expect(output.ibanCountry).toBe('DE');
    });

    it('reads the sell IBAN of a buy-fiat payout', () => {
      const output = createCustomFiatOutput({
        buyFiats: [buyFiat({ sell: { iban: 'LU116060002000005040' } as never })],
      });

      expect(output.ibanCountry).toBe('LU');
    });

    it('reads the chargeback IBAN of a bank-tx return', () => {
      const output = createCustomFiatOutput({
        buyFiats: [],
        bankTxReturn: bankTxReturn({ chargebackIban: 'CH9300762011623852957' }),
      });

      expect(output.ibanCountry).toBe('CH');
    });

    it('is undefined when no origin carries an IBAN', () => {
      expect(createCustomFiatOutput({ buyFiats: [] }).ibanCountry).toBeUndefined();
    });
  });

  describe('bankAccountCurrency', () => {
    it('reads the currency of the buy-crypto bank transaction', () => {
      const output = createCustomFiatOutput({
        buyCrypto: buyCrypto({ bankTx: { currency: 'EUR' } as never }),
        currency: 'CHF',
      });

      expect(output.bankAccountCurrency).toBe('EUR');
    });

    it('reads the fiat of the buy-fiat sell route', () => {
      const output = createCustomFiatOutput({
        buyFiats: [buyFiat({ sell: { fiat: { name: 'EUR' } } as never })],
        currency: 'CHF',
      });

      expect(output.bankAccountCurrency).toBe('EUR');
    });

    it('reads the currency of the returned bank transaction', () => {
      const output = createCustomFiatOutput({
        buyFiats: [],
        bankTxReturn: bankTxReturn({ bankTx: { currency: 'EUR' } as never }),
        currency: 'CHF',
      });

      expect(output.bankAccountCurrency).toBe('EUR');
    });

    it('falls back to the currency of the output itself', () => {
      expect(createCustomFiatOutput({ buyFiats: [], currency: 'CHF' }).bankAccountCurrency).toBe('CHF');
    });
  });

  describe('bankAmount', () => {
    it('is the plain amount when the bank account holds the output currency', () => {
      const output = createCustomFiatOutput({ buyFiats: [], currency: 'CHF', amount: 100 });

      expect(output.bankAmount).toBe(100);
    });

    it('is the plain amount when there is no origin to convert from', () => {
      const output = createCustomFiatOutput({
        buyFiats: [],
        bankTxReturn: bankTxReturn({ bankTx: { currency: 'EUR' } as never }),
        currency: 'CHF',
        amount: 100,
      });

      // The origin (the return) has no amountInChf/amountInEur set, so the conversion branch reads
      // undefined — the guard above is what keeps a plain amount from being silently replaced.
      expect(output.bankAmount).toBeUndefined();
    });

    it('converts to CHF when the bank account is a CHF one', () => {
      const output = createCustomFiatOutput({
        buyCrypto: buyCrypto({ bankTx: { currency: 'CHF' } as never, amountInChf: 90, amountInEur: 95 }),
        currency: 'EUR',
        amount: 100,
      });

      expect(output.bankAmount).toBe(90);
    });

    it('converts to EUR for any other bank account currency', () => {
      const output = createCustomFiatOutput({
        buyCrypto: buyCrypto({ bankTx: { currency: 'EUR' } as never, amountInChf: 90, amountInEur: 95 }),
        currency: 'CHF',
        amount: 100,
      });

      expect(output.bankAmount).toBe(95);
    });
  });

  describe('originEntity', () => {
    it.each([
      ['the buy-crypto refund', { buyCrypto: buyCrypto({ id: 1 }) }, 1],
      ['the first buy-fiat payout', { buyFiats: [buyFiat({ id: 2 })] }, 2],
      ['the bank-tx return', { buyFiats: [], bankTxReturn: bankTxReturn({ id: 3 }) }, 3],
    ])('prefers %s', (_name, values, expected) => {
      expect(createCustomFiatOutput(values).originEntity?.id).toBe(expected);
    });

    it('is undefined for a manual output with no origin', () => {
      expect(createCustomFiatOutput({ buyFiats: [] }).originEntity).toBeUndefined();
    });
  });

  // `user`/`userData` are getters on both origins, reading through to their transaction — set the
  // transaction rather than the derived property, which cannot be assigned.
  describe('user', () => {
    it('prefers the buy-crypto user', () => {
      const user = Object.assign(new User(), { id: 1 });
      const output = createCustomFiatOutput({ buyCrypto: buyCrypto({ transaction: { user } as never }) });

      expect(output.user?.id).toBe(1);
    });

    it('falls back to the buy-fiat user', () => {
      const user = Object.assign(new User(), { id: 2 });
      const output = createCustomFiatOutput({ buyFiats: [buyFiat({ transaction: { user } as never })] });

      expect(output.user?.id).toBe(2);
    });

    it('is undefined without either', () => {
      expect(createCustomFiatOutput({ buyFiats: [] }).user).toBeUndefined();
    });
  });

  describe('userData', () => {
    it('reads the account of whichever origin the row has', () => {
      const userData = Object.assign(new UserData(), { id: 5 });
      const output = createCustomFiatOutput({ buyCrypto: buyCrypto({ transaction: { userData } as never }) });

      expect(output.userData?.id).toBe(5);
    });

    it('is undefined without an origin', () => {
      expect(createCustomFiatOutput({ buyFiats: [] }).userData).toBeUndefined();
    });
  });

  // The decorator arguments below are lazy thunks TypeORM only calls when it builds its metadata. A
  // broken (circular) import makes one resolve to undefined, which surfaces as an opaque boot failure —
  // resolving them here turns that into a failing test instead.
  describe('decorator metadata', () => {
    it('resolves every relation target, and every inverse side that declares one', () => {
      const relations = getMetadataArgsStorage().relations.filter((relation) => relation.target === FiatOutput);
      expect(relations.length).toBeGreaterThan(0);

      for (const relation of relations) {
        expect((relation.type as () => unknown)()).toBeDefined();

        // bankTx / bank are owning sides without an inverse property.
        if (typeof relation.inverseSideProperty !== 'function') continue;

        const inverseSide = relation.inverseSideProperty as (object: Record<string, unknown>) => unknown;
        expect(inverseSide({ fiatOutput: 'sentinel', chargebackOutput: 'sentinel' })).toBe('sentinel');
      }
    });
  });
});
