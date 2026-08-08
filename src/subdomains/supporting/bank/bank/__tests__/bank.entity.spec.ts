import { getMetadataArgsStorage } from 'typeorm';
import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { Bank } from '../bank.entity';
import { IbanBankName } from '../dto/bank.dto';

function bank(overrides: Partial<Bank> = {}): Bank {
  return Object.assign(new Bank(), overrides);
}

describe('Bank', () => {
  describe('isCountryEnabled', () => {
    // The rails that share the country allowlist. Fiat Republic is in the group because its Acceptable
    // Use Policy commits DFX to keeping segments outside its risk appetite off the platform entirely.
    it.each([IbanBankName.FRICK, IbanBankName.YAPEAL, IbanBankName.OLKY, IbanBankName.FIAT_REPUBLIC])(
      '%s follows the country allowlist',
      (name) => {
        expect(bank({ name }).isCountryEnabled(createCustomCountry({ yapealEnable: true }))).toBe(true);
        expect(bank({ name }).isCountryEnabled(createCustomCountry({ yapealEnable: false }))).toBe(false);
      },
    );

    it.each([IbanBankName.MAERKI, IbanBankName.RAIFFEISEN])('%s is open to every country', (name) => {
      expect(bank({ name }).isCountryEnabled(createCustomCountry({ yapealEnable: false }))).toBe(true);
    });
  });

  describe('isReconcilable', () => {
    // A Frick row that sends but never receives can never see its own booked debit come back, so its
    // reserved liquidity would never be released — that is the one combination this guard exists for.
    it('reports a send-only Bank Frick row as not reconcilable', () => {
      expect(bank({ name: IbanBankName.FRICK, send: true, receive: false }).isReconcilable).toBe(false);
    });

    it.each([
      ['it also receives', { send: true, receive: true }],
      ['it does not send', { send: false, receive: false }],
    ])('reports a Bank Frick row as reconcilable when %s', (_name, flags) => {
      expect(bank({ name: IbanBankName.FRICK, ...flags }).isReconcilable).toBe(true);
    });

    it('reports every other bank as reconcilable, even send-only', () => {
      expect(bank({ name: IbanBankName.FIAT_REPUBLIC, send: true, receive: false }).isReconcilable).toBe(true);
      expect(bank({ name: IbanBankName.OLKY, send: true, receive: false }).isReconcilable).toBe(true);
    });
  });

  it('defaults sendPriority so an unset row never wins a tie by accident', () => {
    expect(new Bank().sendPriority).toBe(1000);
  });

  // The decorator arguments below are lazy thunks TypeORM only calls when it builds its metadata. A
  // broken (circular) import makes one resolve to undefined, which surfaces as an opaque boot failure —
  // resolving them here turns that into a failing test instead.
  describe('decorator metadata', () => {
    it('resolves every relation target and its inverse side', () => {
      const relations = getMetadataArgsStorage().relations.filter((relation) => relation.target === Bank);
      expect(relations.length).toBeGreaterThan(0);

      for (const relation of relations) {
        const target = (relation.type as () => unknown)();
        expect(target).toBeDefined();

        const inverseSide = relation.inverseSideProperty as (object: Record<string, unknown>) => unknown;
        expect(inverseSide({ bank: 'sentinel' })).toBe('sentinel');
      }
    });

    it('resolves the unique index columns', () => {
      const indices = getMetadataArgsStorage().indices.filter((index) => index.target === Bank);
      expect(indices.length).toBeGreaterThan(0);

      for (const index of indices) {
        const columns = (index.columns as (entity: Record<string, unknown>) => unknown[])({
          iban: 'iban',
          bic: 'bic',
        });
        expect(columns).toEqual(['iban', 'bic']);
      }
    });
  });
});
