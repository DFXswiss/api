import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { BankTxReturnService } from '../bank-tx-return.service';
import { BankTxReturnRepository } from '../bank-tx-return.repository';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { BankTxReturn } from '../bank-tx-return.entity';
import { FiatOutputType } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';

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
      );
    });

    it('should use dto creditor data when provided (override)', async () => {
      const dto = {
        chargebackAllowedDate: new Date(),
        chargebackAllowedBy: 'Admin',
        name: 'Override Name',
        address: 'Override Address',
        houseNumber: '99',
        zip: '9999',
        city: 'Override City',
        country: 'DE',
      };

      await service.refundBankTx(mockBankTxReturn, dto);

      expect(fiatOutputService.createInternal).toHaveBeenCalledWith(
        FiatOutputType.BANK_TX_RETURN,
        { bankTxReturn: mockBankTxReturn },
        mockBankTxReturn.id,
        false,
        expect.objectContaining({
          name: 'Override Name',
          address: 'Override Address',
          houseNumber: '99',
          zip: '9999',
          city: 'Override City',
          country: 'DE',
        }),
      );
    });

    it('should handle missing creditorData in entity gracefully', async () => {
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

      await service.refundBankTx(bankTxReturnWithoutCreditor, dto);

      expect(fiatOutputService.createInternal).toHaveBeenCalledWith(
        FiatOutputType.BANK_TX_RETURN,
        { bankTxReturn: bankTxReturnWithoutCreditor },
        bankTxReturnWithoutCreditor.id,
        false,
        expect.objectContaining({
          name: undefined,
          address: undefined,
          houseNumber: undefined,
          zip: undefined,
          city: undefined,
          country: undefined,
        }),
      );
    });
  });
});
