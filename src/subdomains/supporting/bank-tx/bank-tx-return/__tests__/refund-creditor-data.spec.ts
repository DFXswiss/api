import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { FiatOutputType } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EntityManager } from 'typeorm';
import { BankTxReturn } from '../bank-tx-return.entity';
import { BankTxReturnRepository } from '../bank-tx-return.repository';
import { BankTxReturnService } from '../bank-tx-return.service';

/**
 * Test: Creditor-Daten Fallback in BankTxReturnService.refundBankTx()
 *
 * Dieser Test verifiziert den Fix für den Bug:
 * - Wenn refundBankTx() aufgerufen wird OHNE Creditor-Daten im DTO
 * - Sollten die Creditor-Daten aus bankTxReturn.creditorData als Fallback verwendet werden
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

  const mockBankTxReturn = {
    id: 1,
    chargebackIban: 'CH9300762011623852957',
    chargebackAmount: 50,
    chargebackAsset: 'CHF',
    chargebackCreditorData: JSON.stringify(mockCreditorData),
    amlCheck: CheckStatus.FAIL,
    outputAmount: null,
    bankTx: {
      id: 1,
      currency: { id: 1, name: 'CHF' },
      iban: 'CH0000000000000000000',
      amount: 52,
    },
    get creditorData() {
      return this.chargebackCreditorData ? JSON.parse(this.chargebackCreditorData) : undefined;
    },
    chargebackFillUp: jest.fn().mockReturnValue([{ id: 1 }, {}]),
    chargebackBankRemittanceInfo: 'Test remittance info',
  } as unknown as BankTxReturn;

  beforeEach(async () => {
    bankTxReturnRepo = createMock<BankTxReturnRepository>();
    fiatOutputService = createMock<FiatOutputService>();
    transactionUtilService = createMock<TransactionUtilService>();

    transactionUtilService.validateChargebackIban.mockResolvedValue(true);
    fiatOutputService.createInternal.mockResolvedValue({ id: 1 } as any);
    bankTxReturnRepo.update.mockResolvedValue(undefined);

    (mockBankTxReturn.chargebackFillUp as jest.Mock).mockClear();
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
      const bankTxReturnWithoutCreditor = {
        ...mockBankTxReturn,
        chargebackCreditorData: null,
        amlCheck: CheckStatus.FAIL,
        outputAmount: null,
        get creditorData() {
          return undefined;
        },
      } as unknown as BankTxReturn;

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
    // FiatOutput.bankTxReturn is the inverse side of BankTxReturn.chargebackOutput, so saving the
    // output writes chargebackOutputId onto the row. Committing that ahead of the state write, in
    // its own transaction, left a window where a failure in between stranded the return: the FK is
    // set while chargebackAllowedDate is still null, which drops it out of chargebackTx's
    // `chargebackOutput: IsNull()` selection and makes every manual retry fail validateRefund.
    it('writes the chargeback state and creates the output in one transaction, state first', async () => {
      await service.refundBankTx(mockBankTxReturn, {
        chargebackAllowedDate: new Date(),
        chargebackAllowedBy: 'BatchJob',
      });

      expect(bankTxReturnRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(bankTxReturnRepo.update).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(BankTxReturn, { id: 1 }, {});
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

      // The output must reach the row through the FiatOutput save's inverse-side FK write, never
      // through chargebackFillUp — chargebackTx selects on that column being NULL.
      const fillUpArgs = (mockBankTxReturn.chargebackFillUp as jest.Mock).mock.calls[0];
      expect(fillUpArgs).toHaveLength(9);
      expect(fillUpArgs).not.toContainEqual(expect.objectContaining({ id: expect.anything() }));
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

    it('skips the output on the user-initiated leg but still writes the chargeback state', async () => {
      await service.refundBankTx(mockBankTxReturn, {
        chargebackAllowedDateUser: new Date(),
        chargebackAllowedBy: 'User',
      });

      expect(manager.update).toHaveBeenCalledWith(BankTxReturn, { id: 1 }, {});
      expect(fiatOutputService.createInternal).not.toHaveBeenCalled();
    });
  });
});
