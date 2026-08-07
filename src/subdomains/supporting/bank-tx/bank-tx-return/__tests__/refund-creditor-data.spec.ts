import { createMock } from '@golevelup/ts-jest';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { FiatOutputType } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EntityManager, IsNull } from 'typeorm';
import { BankTx } from '../../bank-tx/entities/bank-tx.entity';
import { BankTxReturn } from '../bank-tx-return.entity';
import { BankTxReturnRepository } from '../bank-tx-return.repository';
import { BankTxReturnService } from '../bank-tx-return.service';

/**
 * BankTxReturnService.refundBankTx()
 *
 * - creditor data comes from bankTxReturn.creditorData, with the DTO only as a fallback
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
    // The claim pins chargebackOutput to IsNull(), so creating the output first would make the
    // claim match nothing — state-first is required, not stylistic.
    it('writes the chargeback state and creates the output in one transaction, state first', async () => {
      const chargebackAllowedDate = new Date();

      await service.refundBankTx(mockBankTxReturn, { chargebackAllowedDate, chargebackAllowedBy: 'BatchJob' });

      expect(bankTxReturnRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(bankTxReturnRepo.update).not.toHaveBeenCalled();
      // Removing the chargebackOutput parameter closed the gap between chargebackAllowedBy and
      // chargebackRemittanceInfo, which are both string and now adjacent, so a swap there would
      // type-check silently. The two Date parameters carry the same risk between themselves. Pin
      // the payload so either swap fails.
      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        BankTxReturn,
        {
          id: 1,
          chargebackOutput: IsNull(),
          chargebackAllowedDate: IsNull(),
          chargebackAllowedDateUser: IsNull(),
          chargebackDate: IsNull(),
          chargebackBankTx: IsNull(),
        },
        expect.objectContaining({
          chargebackIban: 'CH9300762011623852957',
          chargebackAmount: 50,
          chargebackAsset: 'CHF',
          chargebackAllowedDate,
          chargebackAllowedDateUser: undefined,
          chargebackAllowedBy: 'BatchJob',
          chargebackRemittanceInfo: mockBankTxReturn.chargebackBankRemittanceInfo,
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

    it('creates no chargeback output when a concurrent refund wins the claim', async () => {
      manager.update.mockResolvedValueOnce({ affected: 0 });

      await expect(
        service.refundBankTx(mockBankTxReturn, {
          chargebackAllowedDate: new Date(),
          chargebackAllowedBy: 'BatchJob',
        }),
      ).rejects.toThrow(ConflictException);

      // Without the claim, the cron and an admin refund would each pass validateRefund on their own
      // stale read and each mint a FiatOutput. Only one can own chargebackOutputId; the other is
      // stuck forever, since the payout job skips outputs with no origin entity.
      expect(fiatOutputService.createInternal).not.toHaveBeenCalled();
    });

    it('claims the approval leg against the marker the user leg already wrote', async () => {
      // The approval legs only ever run on rows carrying chargebackAllowedDateUser — chargebackTx
      // selects on it. Pinning that column to IsNull() would make every automatic chargeback claim
      // nothing, which is why it is pinned to the stored value instead.
      const chargebackAllowedDateUser = new Date('2026-08-01T10:00:00.000Z');
      const requested = createBankTxReturn({ chargebackAllowedDateUser });

      await service.refundBankTx(requested, { chargebackAllowedDate: new Date(), chargebackAllowedBy: 'API' });

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        BankTxReturn,
        expect.objectContaining({ id: 1, chargebackAllowedDateUser }),
        expect.anything(),
      );
      expect(fiatOutputService.createInternal).toHaveBeenCalledTimes(1);
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
        expect.objectContaining({ id: 1, chargebackAllowedDateUser: IsNull() }),
        expect.objectContaining({ chargebackAllowedBy: 'User' }),
      );
      expect(fiatOutputService.createInternal).not.toHaveBeenCalled();
      expect(mockBankTxReturn.chargebackOutput).toBeUndefined();
    });
  });

  describe('chargebackTx — name mismatch else branch', () => {
    it('logs a warning and does not promote when creditor name mismatches', async () => {
      const entity = createBankTxReturn({
        id: 42,
        chargebackCreditorData: JSON.stringify({ name: 'Someone Else' }),
        userData: createCustomUserData({
          verifiedName: 'Max Mustermann',
          firstname: 'Max',
          surname: 'Mustermann',
        }),
      });
      jest.spyOn(bankTxReturnRepo, 'find').mockResolvedValueOnce([entity]);
      const refundSpy = jest.spyOn(service, 'refundBankTx');
      const warn = jest.spyOn((service as any).logger, 'warn');

      await service.chargebackTx();

      expect(refundSpy).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'BankTxReturn 42 waiting for manual chargeback approval due to creditor name mismatch',
        ),
      );
      expect(warn.mock.calls[0][0]).not.toMatch(/Max Mustermann|Someone Else/);
    });
  });
});
