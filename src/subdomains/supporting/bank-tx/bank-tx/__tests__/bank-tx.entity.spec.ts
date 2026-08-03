import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createCustomSpecialExternalAccount } from 'src/subdomains/supporting/payment/__mocks__/special-external-account.entity.mock';
import { createCustomBankTx } from '../__mocks__/bank-tx.entity.mock';
import { BankTx, BankTxIndicator, BankTxType } from '../entities/bank-tx.entity';

describe('BankTx', () => {
  const multiAccount = createCustomSpecialExternalAccount({ value: 'MULTI-ACCOUNT-IBAN', name: 'MULTI-ACCOUNT-IBAN' });

  describe('#pendingInputAmount(...)', () => {
    const frickIban = 'LI75088110105923K000E';

    beforeEach(() => {
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.clear();
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.set(
        `${IbanBankName.FRICK}-EUR`,
        frickIban,
      );
    });

    it('returns the credit amount for a matching Frick custody asset', () => {
      const entity = createCustomBankTx({
        type: BankTxType.PENDING,
        amount: 250,
        accountIban: frickIban,
      });
      const asset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR' });

      expect(entity.pendingInputAmount(asset)).toBe(250);
    });

    it('returns 0 for a Frick asset when the account IBAN does not match', () => {
      const entity = createCustomBankTx({
        type: BankTxType.PENDING,
        amount: 250,
        accountIban: 'OTHER-IBAN',
      });
      const asset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR' });

      expect(entity.pendingInputAmount(asset)).toBe(0);
    });
  });

  describe('#pendingBankAmount(...) for internal transfers', () => {
    const olkyIban = 'LU116060002000005040';
    const frickIban = 'LI75088110105923K000E';
    const frickChfIban = 'LI75088110105923K000C';
    const olkyAsset = createCustomAsset({
      blockchain: Blockchain.OLKYPAY,
      dexName: 'EUR',
      bank: Object.assign(new Bank(), { name: IbanBankName.OLKY, currency: 'EUR', iban: olkyIban }),
    });
    const frickAsset = createCustomAsset({
      blockchain: Blockchain.FRICK,
      dexName: 'EUR',
      bank: Object.assign(new Bank(), { name: IbanBankName.FRICK, currency: 'EUR', iban: frickIban }),
    });
    const frickChfAsset = createCustomAsset({
      blockchain: Blockchain.FRICK,
      dexName: 'CHF',
      bank: Object.assign(new Bank(), { name: IbanBankName.FRICK, currency: 'CHF', iban: frickChfIban }),
    });

    it('keeps a debit in the source plus balance while it is in transit', () => {
      const entity = createCustomBankTx({
        accountIban: olkyIban,
        iban: frickIban,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 280000,
        currency: 'EUR',
        instructedAmount: undefined,
        instructedCurrency: undefined,
      });

      expect(entity.pendingBankAmount(olkyAsset, BankTxType.INTERNAL)).toBe(280000);
      expect(entity.pendingBankAmount(frickAsset, BankTxType.INTERNAL)).toBe(0);
    });

    it('does not count a destination credit as an independent negative plus balance', () => {
      const entity = createCustomBankTx({
        accountIban: frickIban,
        iban: olkyIban,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        instructedAmount: 280000,
        instructedCurrency: 'EUR',
      });

      expect(entity.pendingBankAmount(frickAsset, BankTxType.INTERNAL)).toBe(0);
    });

    it('attributes both legs of a cross-currency transfer to their account currencies', () => {
      const debit = createCustomBankTx({
        accountIban: olkyIban,
        iban: frickChfIban,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 280000,
        currency: 'EUR',
        instructedAmount: 268000,
        instructedCurrency: 'CHF',
      });
      expect(debit.pendingBankAmount(olkyAsset, BankTxType.INTERNAL)).toBe(280000);
      expect(debit.pendingBankAmount(frickChfAsset, BankTxType.INTERNAL)).toBe(0);
    });

    it('keeps only the transferred principal when the booked debit includes a bank charge', () => {
      const entity = createCustomBankTx({
        accountIban: olkyIban,
        iban: frickIban,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 1005,
        currency: 'EUR',
        chargeAmount: 5,
      });

      expect(entity.pendingBankAmount(olkyAsset, BankTxType.INTERNAL)).toBe(1000);
    });

    it('does not subtract a bank charge denominated in another currency', () => {
      const entity = createCustomBankTx({
        accountIban: olkyIban,
        iban: frickIban,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 1005,
        currency: 'EUR',
        chargeAmount: 5,
        chargeCurrency: 'CHF',
      });

      expect(entity.pendingBankAmount(olkyAsset, BankTxType.INTERNAL)).toBe(1005);
    });
  });

  describe('#senderAccount(...)', () => {
    it('should return the IBAN', () => {
      const entity = Object.assign(new BankTx(), { iban: 'RANDOM-IBAN' });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe('RANDOM-IBAN');
    });

    it('should add the name, if multi-account IBAN', () => {
      const entity = Object.assign(new BankTx(), { iban: multiAccount.value, name: 'John Doe' });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe(`${multiAccount.value};JohnDoe`);
    });

    it('should add the name and ultimate name, if multi-account IBAN', () => {
      const entity = Object.assign(new BankTx(), { iban: multiAccount.value, name: 'John Doe', ultimateName: 'Doe' });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe(`${multiAccount.value};JohnDoeDoe`);
    });

    it('should return NOIBAN for account numbers', () => {
      const entity = Object.assign(new BankTx(), { iban: '2345', name: 'John Doe' });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe('NOIBAN2345;JohnDoe');
    });

    it('should use IBAN from name', () => {
      const entity = Object.assign(new BankTx(), { name: '/C/RANDOM-IBAN' });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe('RANDOM-IBAN');
    });

    it('should use Schaltereinzahlung', () => {
      const entity = Object.assign(new BankTx(), { name: 'Schaltereinzahlung', ultimateName: 'John Doe' });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe('Schaltereinzahlung;JohnDoe');
    });

    it('should use the name, if no IBAN', () => {
      const entity = Object.assign(new BankTx(), { name: 'John Doe ' });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe('John:Doe');
    });

    it('should use the name and ultimate name, if no IBAN', () => {
      const entity = Object.assign(new BankTx(), { name: 'John Doe ', ultimateName: ' Doe ' });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe('John:Doe:Doe');
    });

    it('should return undefined if no IBAN and name', () => {
      const entity = Object.assign(new BankTx(), { name: null, ultimateName: null });

      const sender = entity.getSenderAccount([multiAccount]);

      expect(sender).toBe(undefined);
    });
  });
});
