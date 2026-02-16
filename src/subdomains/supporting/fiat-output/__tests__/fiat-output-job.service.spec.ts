import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { CountryService } from 'src/shared/models/country/country.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomBuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/__mocks__/buy-crypto.entity.mock';
import { createCustomLiquidityBalance } from 'src/subdomains/core/liquidity-management/__mocks__/liquidity-balance.entity.mock';
import { createCustomBuyFiat } from 'src/subdomains/core/sell-crypto/process/__mocks__/buy-fiat.entity.mock';
import { createCustomSell } from 'src/subdomains/core/sell-crypto/route/__mocks__/sell.entity.mock';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankTxRepeatService } from '../../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx/bank-tx-return/bank-tx-return.service';
import { createCustomBankTx } from '../../bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { createCustomBank, yapealEUR } from '../../bank/bank/__mocks__/bank.entity.mock';
import { BankService } from '../../bank/bank/bank.service';
import { createCustomVirtualIban } from '../../bank/virtual-iban/__mocks__/virtual-iban.entity.mock';
import { VirtualIbanService } from '../../bank/virtual-iban/virtual-iban.service';
import { createCustomLog } from '../../log/__mocks__/log.entity.mock';
import { LogService } from '../../log/log.service';
import { createCustomCryptoInput } from '../../payin/entities/__mocks__/crypto-input.entity.mock';
import { createCustomFiatOutput } from '../__mocks__/fiat-output.entity.mock';
import { Ep2ReportService } from '../ep2-report.service';
import { FiatOutputJobService } from '../fiat-output-job.service';
import { FiatOutputType } from '../fiat-output.entity';
import { FiatOutputRepository } from '../fiat-output.repository';

describe('FiatOutputJobService', () => {
  let service: FiatOutputJobService;

  let fiatOutputRepo: FiatOutputRepository;
  let bankTxService: BankTxService;
  let ep2ReportService: Ep2ReportService;
  let bankService: BankService;
  let countryService: CountryService;
  let assetService: AssetService;
  let logService: LogService;
  let bankTxReturnService: BankTxReturnService;
  let bankTxRepeatService: BankTxRepeatService;
  let yapealService: YapealService;
  let olkypayService: OlkypayService;
  let virtualIbanService: VirtualIbanService;

  beforeEach(async () => {
    fiatOutputRepo = createMock<FiatOutputRepository>();
    bankTxService = createMock<BankTxService>();
    ep2ReportService = createMock<Ep2ReportService>();
    countryService = createMock<CountryService>();
    bankService = createMock<BankService>();
    assetService = createMock<AssetService>();
    logService = createMock<LogService>();
    bankTxReturnService = createMock<BankTxReturnService>();
    bankTxRepeatService = createMock<BankTxRepeatService>();
    yapealService = createMock<YapealService>();
    olkypayService = createMock<OlkypayService>();
    virtualIbanService = createMock<VirtualIbanService>();
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    // Default mock: no virtual IBANs
    jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
    jest.spyOn(virtualIbanService, 'getBaseAccountIban').mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatOutputJobService,
        { provide: FiatOutputRepository, useValue: fiatOutputRepo },
        { provide: BankTxService, useValue: bankTxService },
        { provide: Ep2ReportService, useValue: ep2ReportService },
        { provide: CountryService, useValue: countryService },
        { provide: BankService, useValue: bankService },
        { provide: AssetService, useValue: assetService },
        { provide: LogService, useValue: logService },
        { provide: BankTxReturnService, useValue: bankTxReturnService },
        { provide: BankTxRepeatService, useValue: bankTxRepeatService },
        { provide: YapealService, useValue: yapealService },
        { provide: OlkypayService, useValue: olkypayService },
        { provide: VirtualIbanService, useValue: virtualIbanService },

        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<FiatOutputJobService>(FiatOutputJobService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assignBankAccount', () => {
    it('should assign bank account if buyFiats or buyCrypto present', async () => {
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          type: FiatOutputType.BUY_FIAT,
          isComplete: false,
          buyFiats: [
            createCustomBuyFiat({ id: 100, sell: createCustomSell({ iban: 'DE123456789' }) }),
            createCustomBuyFiat({ id: 102, sell: createCustomSell({ iban: 'DE123456789' }) }),
          ],
        }),
        createCustomFiatOutput({
          id: 2,
          type: FiatOutputType.BANK_TX_REPEAT,
          isComplete: false,
          bankTx: createCustomBankTx({}),
        }),
        createCustomFiatOutput({
          id: 3,
          type: FiatOutputType.BUY_CRYPTO_FAIL,
          isComplete: false,
          buyCrypto: createCustomBuyCrypto({ id: 102 }),
        }),
      ]);

      jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createCustomCountry({ yapealEnable: true }));

      jest.spyOn(bankService, 'getSenderBank').mockResolvedValue(yapealEUR);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toBe(1);
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, accountIban: yapealEUR.iban });

      expect(updateCalls[1][0]).toBe(3);
      expect(updateCalls[1][1]).toMatchObject({ originEntityId: 102, accountIban: yapealEUR.iban });
    });

    it('should use virtual IBAN when user has one for BuyFiat', async () => {
      const virtualIban = 'CH1234567890VIBAN';

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          type: FiatOutputType.BUY_FIAT,
          isComplete: false,
          buyFiats: [createCustomBuyFiat({ id: 100, sell: createCustomSell({ iban: 'DE123456789' }) })],
        }),
      ]);

      jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createCustomCountry({ yapealEnable: true }));

      // Mock virtual IBAN for user
      jest
        .spyOn(virtualIbanService, 'getActiveForUserAndCurrency')
        .mockResolvedValue(createCustomVirtualIban({ iban: virtualIban, bank: yapealEUR }));

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toBe(1);
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, accountIban: virtualIban });
    });

    it('should use virtual IBAN for BuyCrypto refund when user has one', async () => {
      const virtualIban = 'CH1234567890VIBAN';

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          type: FiatOutputType.BUY_CRYPTO_FAIL,
          isComplete: false,
          buyCrypto: createCustomBuyCrypto({ id: 100 }),
        }),
      ]);

      jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createCustomCountry({ yapealEnable: true }));

      // Mock virtual IBAN for user
      jest
        .spyOn(virtualIbanService, 'getActiveForUserAndCurrency')
        .mockResolvedValue(createCustomVirtualIban({ iban: virtualIban, bank: yapealEUR }));

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toBe(1);
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, accountIban: virtualIban });
    });
  });

  describe('setReadyDate', () => {
    it('should set ready date for non-EUR transactions and skip EUR transactions', async () => {
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          accountIban: 'CH123456789',
          iban: 'CH123456789',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
          amount: 100,
          currency: 'EUR',
          type: FiatOutputType.BUY_FIAT,
        }),
        createCustomFiatOutput({
          id: 2,
          accountIban: 'CH123456789',
          iban: 'CH123456789',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
          amount: 100,
          currency: 'CHF',
          type: FiatOutputType.BUY_FIAT,
        }),
        createCustomFiatOutput({
          id: 3,
          accountIban: 'CH123456789',
          iban: 'CH123456789',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
          amount: 200,
          currency: 'EUR',
          type: FiatOutputType.BUY_FIAT,
        }),
        createCustomFiatOutput({
          id: 4,
          accountIban: 'CH123456789',
          iban: 'CH123456789',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
          amount: 150,
          currency: 'USD',
          type: FiatOutputType.BUY_FIAT,
        }),
      ]);
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([
        createCustomAsset({
          id: 1,
          type: AssetType.CUSTODY,
          bank: createCustomBank({ iban: 'CH123456789' }),
          name: 'CHF',
          balance: createCustomLiquidityBalance({ amount: 9000 }),
        }),
      ]);

      await service['setReadyDate']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      const updatedIds = updateCalls.map((call) => call[0]);

      // EUR transactions (id 1 and 3) should NOT be updated
      expect(updatedIds).not.toContain(1);
      expect(updatedIds).not.toContain(3);

      // Non-EUR transactions (id 2 CHF and id 4 USD) should be updated
      expect(updatedIds).toContain(2);
      expect(updatedIds).toContain(4);
    });
  });

  describe('createBatches', () => {
    it('should create 3 batches', async () => {
      const entities = [
        createCustomFiatOutput({ id: 1, accountIban: 'DE123456789', amount: 100, isComplete: false }),
        createCustomFiatOutput({ id: 2, accountIban: 'CH123456789', amount: 200, isComplete: false }),
        createCustomFiatOutput({ id: 3, accountIban: 'DE123456789', amount: 500, isComplete: false }),
        createCustomFiatOutput({ id: 4, accountIban: 'CH123456789', amount: 900, isComplete: false }),
        createCustomFiatOutput({ id: 5, accountIban: 'DE123456789', amount: 1100, isComplete: false }),
        createCustomFiatOutput({ id: 6, accountIban: 'CH975632135', amount: 22000, isComplete: false }),
      ];
      jest.spyOn(fiatOutputRepo, 'findBy').mockResolvedValue(entities);
      jest.spyOn(fiatOutputRepo, 'findOne').mockResolvedValue(createCustomFiatOutput({ batchId: 0 }));

      await service['createBatches']();

      const updateCalls = (fiatOutputRepo.save as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toMatchObject([
        createCustomFiatOutput({
          id: 1,
          accountIban: 'DE123456789',
          amount: 100,
          isComplete: false,
          batchId: 1,
          batchAmount: 280000,
        }),
        createCustomFiatOutput({
          id: 2,
          accountIban: 'CH123456789',
          amount: 200,
          isComplete: false,
          batchId: 1,
          batchAmount: 280000,
        }),
        createCustomFiatOutput({
          id: 3,
          accountIban: 'DE123456789',
          amount: 500,
          isComplete: false,
          batchId: 1,
          batchAmount: 280000,
        }),
        createCustomFiatOutput({
          id: 4,
          accountIban: 'CH123456789',
          amount: 900,
          isComplete: false,
          batchId: 1,
          batchAmount: 280000,
        }),
        createCustomFiatOutput({
          id: 5,
          accountIban: 'DE123456789',
          amount: 1100,
          isComplete: false,
          batchId: 1,
          batchAmount: 280000,
        }),
        createCustomFiatOutput({
          id: 6,
          accountIban: 'CH975632135',
          amount: 22000,
          isComplete: false,
          batchId: 2,
          batchAmount: 2200000,
        }),
      ]);
    });

    it('should create 1 batch', async () => {
      const entities = [createCustomFiatOutput({ id: 1, accountIban: 'CH123456789', amount: 200, isComplete: false })];
      jest.spyOn(fiatOutputRepo, 'findBy').mockResolvedValue(entities);
      jest.spyOn(fiatOutputRepo, 'findOne').mockResolvedValue(createCustomFiatOutput({ batchId: 0 }));

      await service['createBatches']();

      const updateCalls = (fiatOutputRepo.save as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toMatchObject([
        createCustomFiatOutput({
          id: 1,
          accountIban: 'CH123456789',
          amount: 200,
          isComplete: false,
          batchId: 1,
          batchAmount: 20000,
        }),
      ]);
    });
  });

  describe('checkTransmission', () => {
    it('should update transmission status if matching logs found', async () => {
      const entity = [
        createCustomFiatOutput({ id: 1, batchId: 101, isComplete: false }),
        createCustomFiatOutput({ id: 2, batchId: 101, isComplete: false }),
        createCustomFiatOutput({ id: 3, batchId: 103, isComplete: false }),
      ];

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue(entity);
      jest.spyOn(logService, 'getBankLog').mockResolvedValue(
        createCustomLog({
          message: '2025-06-27 15:35:04;/Users/dfx/Downloads/MSG-100-27.6.2025 13-20-46.xml;OK;',
          subsystem: 'UploadBank',
        }),
      );

      await service['checkTransmission']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toBe(1);
      expect(updateCalls[1][0]).toBe(2);
    });
  });

  describe('searchOutgoingBankTx', () => {
    it('should match FiatOutput via remittanceInfo', async () => {
      const bankTx = createCustomBankTx({ id: 100, created: new Date('2024-01-01') });
      const fiatOutput = createCustomFiatOutput({
        id: 1,
        remittanceInfo: 'DFX-123',
        isComplete: false,
        isReadyDate: new Date('2024-01-01'),
      });

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxService, 'getBankTxByRemittanceInfo').mockResolvedValue(bankTx);

      await service['searchOutgoingBankTx']();

      expect(bankTxService.getBankTxByRemittanceInfo).toHaveBeenCalledWith('DFX-123');
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ isComplete: true, bankTx }));
    });

    it('should match FiatOutput via endToEndId when remittanceInfo is not set', async () => {
      const bankTx = createCustomBankTx({ id: 200, created: new Date('2024-01-01') });
      const fiatOutput = createCustomFiatOutput({
        id: 2,
        endToEndId: 'E2E-79057',
        remittanceInfo: undefined,
        isComplete: false,
        isReadyDate: new Date('2024-01-01'),
        type: FiatOutputType.LIQ_MANAGEMENT,
      });

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxService, 'getBankTxByRemittanceInfo').mockResolvedValue(null);
      jest.spyOn(bankTxService, 'getBankTxByEndToEndId').mockResolvedValue(bankTx);

      await service['searchOutgoingBankTx']();

      expect(bankTxService.getBankTxByEndToEndId).toHaveBeenCalledWith('E2E-79057');
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(2, expect.objectContaining({ isComplete: true, bankTx }));
    });

    it('should not match if BankTx created before FiatOutput isReadyDate', async () => {
      const bankTx = createCustomBankTx({ id: 300, created: new Date('2024-01-01') });
      const fiatOutput = createCustomFiatOutput({
        id: 3,
        endToEndId: 'E2E-79058',
        isComplete: false,
        isReadyDate: new Date('2024-01-02'), // after BankTx.created
      });

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxService, 'getBankTxByEndToEndId').mockResolvedValue(bankTx);

      await service['searchOutgoingBankTx']();

      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });
  });
});
