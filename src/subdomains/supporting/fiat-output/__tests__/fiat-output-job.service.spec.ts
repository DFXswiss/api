import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
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
import { createDefaultBankTx } from '../../bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { createCustomBank, maerkiEUR } from '../../bank/bank/__mocks__/bank.entity.mock';
import { BankService } from '../../bank/bank/bank.service';
import { VirtualIbanService } from '../../bank/virtual-iban/virtual-iban.service';
import { createCustomLog } from '../../log/__mocks__/log.entity.mock';
import { LogService } from '../../log/log.service';
import { createCustomCryptoInput } from '../../payin/entities/__mocks__/crypto-input.entity.mock';
import { createCustomFiatOutput } from '../__mocks__/fiat-output.entity.mock';
import { Ep2ReportService } from '../ep2-report.service';
import { FiatOutputJobService } from '../fiat-output-job.service';
import { FiatOutputType } from '../fiat-output.entity';
import { FiatOutputRepository } from '../fiat-output.repository';
import { YapealService } from 'src/integration/bank/services/yapeal.service';

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
    virtualIbanService = createMock<VirtualIbanService>();
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    // Default mock: no virtual IBANs
    jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
    jest.spyOn(virtualIbanService, 'getAllActiveVirtualIbans').mockResolvedValue([]);
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
          bankTx: createDefaultBankTx(),
        }),
        createCustomFiatOutput({
          id: 3,
          type: FiatOutputType.BUY_CRYPTO_FAIL,
          isComplete: false,
          buyCrypto: createCustomBuyCrypto({ id: 102 }),
        }),
      ]);

      jest
        .spyOn(countryService, 'getCountryWithSymbol')
        .mockResolvedValue(createCustomCountry({ maerkiBaumannEnable: true }));

      jest.spyOn(bankService, 'getSenderBank').mockResolvedValue(maerkiEUR);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toBe(1);
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, accountIban: maerkiEUR.iban });

      expect(updateCalls[1][0]).toBe(3);
      expect(updateCalls[1][1]).toMatchObject({ originEntityId: 102, accountIban: maerkiEUR.iban });
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

      jest
        .spyOn(countryService, 'getCountryWithSymbol')
        .mockResolvedValue(createCustomCountry({ maerkiBaumannEnable: true }));

      jest.spyOn(bankService, 'getSenderBank').mockResolvedValue(maerkiEUR);

      // Mock virtual IBAN for user
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue({ iban: virtualIban } as any);

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

      jest
        .spyOn(countryService, 'getCountryWithSymbol')
        .mockResolvedValue(createCustomCountry({ maerkiBaumannEnable: true }));

      jest.spyOn(bankService, 'getSenderBank').mockResolvedValue(maerkiEUR);

      // Mock virtual IBAN for user
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue({ iban: virtualIban } as any);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toBe(1);
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, accountIban: virtualIban });
    });
  });

  describe('setReadyDate', () => {
    it('should set ready date when balance is available and cryptoInput is confirmed', async () => {
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          accountIban: 'DE123456789',
          iban: 'CH123456789',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
          amount: 15000,
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
          amount: 5000,
          currency: 'CHF',
          type: FiatOutputType.BUY_FIAT,
        }),
        createCustomFiatOutput({
          id: 3,
          accountIban: 'DE123456789',
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
          id: 4,
          accountIban: 'DE123456789',
          iban: 'CH123456789',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
          amount: 300,
          currency: 'EUR',
          type: FiatOutputType.BUY_FIAT,
        }),
        createCustomFiatOutput({
          id: 5,
          accountIban: 'DE123456789',
          isReadyDate: null,
          amount: 9500,
          currency: 'EUR',
          type: FiatOutputType.LIQ_MANAGEMENT,
        }),
        createCustomFiatOutput({
          id: 6,
          accountIban: 'DE123456789',
          iban: 'DE123459876',
          isReadyDate: new Date(),
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
          amount: 1200,
          currency: 'EUR',
          type: FiatOutputType.BUY_FIAT,
        }),
        createCustomFiatOutput({
          id: 7,
          accountIban: 'DE123456789',
          iban: 'CH123456789',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
              amountInChf: 4000,
              amountInEur: 4500,
            }),
          ],
          amount: 20000,
          currency: 'AED',
          type: FiatOutputType.BUY_FIAT,
        }),
        createCustomFiatOutput({
          id: 8,
          accountIban: 'DE123456789',
          iban: 'CH123456789',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
              amountInChf: 20000,
              amountInEur: 22000,
            }),
          ],
          amount: 400,
          currency: 'XYZ',
          type: FiatOutputType.BUY_FIAT,
        }),
      ]);
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([
        createCustomAsset({
          id: 1,
          type: AssetType.CUSTODY,
          bank: createCustomBank({ iban: 'DE123456789' }),
          name: 'EUR',
          balance: createCustomLiquidityBalance({ amount: 13000 }),
        }),
        createCustomAsset({
          id: 2,
          type: AssetType.CUSTODY,
          bank: createCustomBank({ iban: 'CH123456789' }),
          name: 'CHF',
          balance: createCustomLiquidityBalance({ amount: 9000 }),
        }),
      ]);

      await service['setReadyDate']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toBe(3);
      expect(updateCalls[1][0]).toBe(4);
      expect(updateCalls[2][0]).toBe(7);
      expect(updateCalls[3][0]).toBe(2);
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
});
