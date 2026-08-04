import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { FiatOutputType } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EntityManager } from 'typeorm';
import { BankTx } from '../../bank-tx/entities/bank-tx.entity';
import { BankTxReturn } from '../bank-tx-return.entity';
import { BankTxReturnRepository } from '../bank-tx-return.repository';
import { BankTxReturnService } from '../bank-tx-return.service';

/**
 * BankTxReturnService.refundBankTx()
 *
 * - creditor data falls back to bankTxReturn.creditorData when the DTO carries none
 * - the chargeback state write and its FiatOutput are one transaction, so neither can commit alone
 */
describe('BankTxReturnService - refundBankTx Creditor Data', () => {
  let service: BankTxReturnService;
  let bankTxReturnRepo: jest.Mocked<BankTxReturnRepository>;
  let fiatOutputService: jest.Mocked<FiatOutputService>;
  let transactionUtilService: jest.Mocked<TransactionUtilService>;
  let manager: { update: jest.Mock };

  const mockCreditorData = {
    name: 'Max Mustermann',
    address: 'Hauptstrasse',
    houseNumber: '42',
    zip: '3000',
    city: 'Bern',
    country: 'CH',
  };

  // A real BankTxReturn, not an object literal: TransactionUtilService.validateRefund branches on
  // `entity instanceof BankTxReturn`, so a cast literal silently skips the whole BankTxReturn
  // validation path — including the "Transaction is already returned" guard on chargebackOutput.
  // Keeping chargebackFillUp real also lets the tests assert the actual update payload.
  function createBankTxReturn(overrides: Partial<BankTxReturn> = {}): BankTxReturn {
    return Object.assign(new BankTxReturn(), {
      id: 1,
      chargebackIban: 'CH9300762011623852957',
      chargebackAmount: 50,
      chargebackAsset: 'CHF',
      chargebackCreditorData: JSON.stringify(mockCreditorData),
      inputAsset: 'CHF',
      // refundAmount is a getter over amount + chargebackBankFee (itself a getter over chargeAmount),
      // so the cap validateRefund enforces has to be set through those.
      bankTx: Object.assign(new BankTx(), {
        id: 1,
        currency: 'CHF',
        iban: 'CH0000000000000000000',
        amount: 52,
        chargeAmount: 0,
      }),
      ...overrides,
    });
  }

  let mockBankTxReturn: BankTxReturn;

  beforeEach(async () => {
    mockBankTxReturn = createBankTxReturn();
    bankTxReturnRepo = createMock<BankTxReturnRepository>();
    fiatOutputService = createMock<FiatOutputService>();
    transactionUtilService = createMock<TransactionUtilService>();

    transactionUtilService.validateChargebackIban.mockResolvedValue(true);
    fiatOutputService.createInternal.mockResolvedValue({ id: 1 } as any);

    manager = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    Object.defineProperty(bankTxReturnRepo, 'manager', {
      configurable: true,
      value: {
        transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
          run(manager as unknown as EntityManager),
        ),
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankTxReturnService,
        { provide: BankTxReturnRepository, useValue: bankTxReturnRepo },
        { provide: FiatOutputService, useValue: fiatOutputService },
        { provide: TransactionUtilService, useValue: transactionUtilService },
        { provide: TransactionService, useValue: createMock() },
        { provide: PricingService, useValue: createMock() },
        { provide: FiatService, useValue: createMock() },
      ],
    }).compile();

    service = module.get<BankTxReturnService>(BankTxReturnService);
  });

  describe('refundBankTx - Creditor Data Fallback', () => {
    it('should use creditorData from entity when dto has no creditor data', async () => {
      const dto = {
        chargebackAllowedDate: new Date(),
        chargebackAllowedBy: 'BatchJob',
      };

      await service.refundBankTx(mockBankTxReturn, dto);

      expect(fiatOutputService.createInternal).toHaveBeenCalledWith(
        FiatOutputType.BANK_TX_RETURN,
        { bankTxReturn: mockBankTxReturn },
        mockBankTxReturn.id,
        false,
        expect.objectContaining({
          iban: mockBankTxReturn.chargebackIban,
          amount: mockBankTxReturn.chargebackAmount,
          name: mockCreditorData.name,
          address: mockCreditorData.address,
          houseNumber: mockCreditorData.houseNumber,
          zip: mockCreditorData.zip,
          city: mockCreditorData.city,
          country: mockCreditorData.country,
        }),
        manager,
      );
    });

    it('should use chargeback creditor if set', async () => {
      const dto = {
        chargebackAllowedDate: new Date(),
        chargebackAllowedBy: 'Admin',
        creditorData: {
          name: 'Override Name',
          address: 'Override Address',
          houseNumber: '99',
          zip: '9999',
          city: 'Override City',
          country: 'DE',
        },
      };

      await service.refundBankTx(mockBankTxReturn, dto);

      expect(fiatOutputService.createInternal).toHaveBeenCalledWith(
        FiatOutputType.BANK_TX_RETURN,
        { bankTxReturn: mockBankTxReturn },
        mockBankTxReturn.id,
        false,
        expect.objectContaining({
          name: 'Max Mustermann',
          address: 'Hauptstrasse',
          houseNumber: '42',
          zip: '3000',
          city: 'Bern',
          country: 'CH',
        }),
        manager,
      );
    });

    it('should throw error when creditorData is missing and chargebackAllowedDate is set', async () => {
      const bankTxReturnWithoutCreditor = createBankTxReturn({ chargebackCreditorData: null });

      const dto = {
        chargebackAllowedDate: new Date(),
        chargebackAllowedBy: 'BatchJob',
      };

      await expect(service.refundBankTx(bankTxReturnWithoutCreditor, dto)).rejects.toThrow(
        'Creditor data is required for chargeback',
      );
    });
  });

  describe('refundBankTx - chargeback output atomicity', () => {
    // Why this matters is documented at the hazard site, in BankTxReturnService.refundBankTx.
    // State-first is a convention rather than a requirement here; see the comment there.
    it('writes the chargeback state and creates the output in one transaction, state first', async () => {
      const chargebackAllowedDate = new Date();

      await service.refundBankTx(mockBankTxReturn, { chargebackAllowedDate, chargebackAllowedBy: 'BatchJob' });

      expect(bankTxReturnRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(bankTxReturnRepo.update).not.toHaveBeenCalled();
      // Pin every slot that shifted when the chargebackOutput parameter was removed. The two dates
      // sit either side of it and are both Date, so a swap would type-check silently.
      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        BankTxReturn,
        1,
        expect.objectContaining({
          chargebackIban: 'CH9300762011623852957',
          chargebackAmount: 50,
          chargebackAsset: 'CHF',
          chargebackAllowedDate,
          chargebackAllowedDateUser: undefined,
          chargebackAllowedBy: 'BatchJob',
          chargebackCreditorData: JSON.stringify(mockCreditorData),
        }),
      );
      expect(fiatOutputService.createInternal).toHaveBeenCalledWith(
        FiatOutputType.BANK_TX_RETURN,
        { bankTxReturn: mockBankTxReturn },
        mockBankTxReturn.id,
        false,
        expect.anything(),
        manager,
      );
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
        fiatOutputService.createInternal.mock.invocationCallOrder[0],
      );
    });

    it('does not carry the chargeback output into the state write', async () => {
      await service.refundBankTx(mockBankTxReturn, {
        chargebackAllowedDate: new Date(),
        chargebackAllowedBy: 'BatchJob',
      });

      // The output reaches the row through the FiatOutput save's inverse-side FK write, so carrying
      // it in the state write too would be a redundant second write of the same column.
      expect(manager.update.mock.calls[0][2]).not.toHaveProperty('chargebackOutput');
      expect(mockBankTxReturn.chargebackOutput).toEqual({ id: 1 });
    });

    it('creates no chargeback output when the state write fails', async () => {
      manager.update.mockRejectedValueOnce(new Error('deadlock detected'));

      await expect(
        service.refundBankTx(mockBankTxReturn, {
          chargebackAllowedDate: new Date(),
          chargebackAllowedBy: 'BatchJob',
        }),
      ).rejects.toThrow('deadlock detected');

      expect(fiatOutputService.createInternal).not.toHaveBeenCalled();
    });

    it('propagates a failed output creation so the state write rolls back with it', async () => {
      fiatOutputService.createInternal.mockRejectedValueOnce(
        new Error('Failed to create fiat output for BankTxReturn 1: Missing required creditor fields: iban'),
      );

      await expect(
        service.refundBankTx(mockBankTxReturn, {
          chargebackAllowedDate: new Date(),
          chargebackAllowedBy: 'BatchJob',
        }),
      ).rejects.toThrow('Missing required creditor fields');

      // The state write already ran, so the rejection has to escape the transaction callback for
      // TypeORM to roll it back — swallowing it here would commit a chargeback with no output.
      expect(manager.update).toHaveBeenCalledTimes(1);
    });

    it('skips the output on the user-initiated leg but still writes the chargeback state', async () => {
      await service.refundBankTx(mockBankTxReturn, {
        chargebackAllowedDateUser: new Date(),
        chargebackAllowedBy: 'User',
      });

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        BankTxReturn,
        1,
        expect.objectContaining({ chargebackAllowedBy: 'User' }),
      );
      expect(fiatOutputService.createInternal).not.toHaveBeenCalled();
      expect(mockBankTxReturn.chargebackOutput).toBeUndefined();
    });
  });
});
