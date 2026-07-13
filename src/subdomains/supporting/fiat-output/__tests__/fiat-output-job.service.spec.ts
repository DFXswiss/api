import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { FrickPaymentCharge, FrickPaymentState, FrickPaymentType } from 'src/integration/bank/dto/frick.dto';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
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
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { createCustomBuyFiat } from 'src/subdomains/core/sell-crypto/process/__mocks__/buy-fiat.entity.mock';
import { createCustomSell } from 'src/subdomains/core/sell-crypto/route/__mocks__/sell.entity.mock';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankTxRepeatService } from '../../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx/bank-tx-return/bank-tx-return.service';
import { createCustomBankTx } from '../../bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { createCustomBank, yapealEUR } from '../../bank/bank/__mocks__/bank.entity.mock';
import { BankService } from '../../bank/bank/bank.service';
import { IbanBankName } from '../../bank/bank/dto/bank.dto';
import { createCustomVirtualIban } from '../../bank/virtual-iban/__mocks__/virtual-iban.entity.mock';
import { VirtualIbanService } from '../../bank/virtual-iban/virtual-iban.service';
import { createCustomLog } from '../../log/__mocks__/log.entity.mock';
import { LogService } from '../../log/log.service';
import { createCustomCryptoInput } from '../../payin/entities/__mocks__/crypto-input.entity.mock';
import { createCustomFiatOutput } from '../__mocks__/fiat-output.entity.mock';
import { Ep2ReportService } from '../ep2-report.service';
import { FiatOutputJobService } from '../fiat-output-job.service';
import { FiatOutputType, TransactionCharge } from '../fiat-output.entity';
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
  let frickService: BankFrickService;
  let virtualIbanService: VirtualIbanService;
  let scryptService: ScryptService;

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
    frickService = createMock<BankFrickService>();
    virtualIbanService = createMock<VirtualIbanService>();
    scryptService = createMock<ScryptService>();
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    // Default mock: no virtual IBANs
    jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
    jest.spyOn(virtualIbanService, 'getBaseAccountIban').mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatOutputJobService,
        { provide: FiatOutputRepository, useValue: fiatOutputRepo },
        { provide: BuyFiatRepository, useValue: createMock<BuyFiatRepository>() },
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
        { provide: BankFrickService, useValue: frickService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        { provide: ScryptService, useValue: scryptService },

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

    it('allows EUR transactions routed through Bank Frick to become ready', async () => {
      const bank = createCustomBank({ name: IbanBankName.FRICK, iban: 'SYNTHETIC-FRICK-ACCOUNT' });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 5,
          bank,
          iban: 'SYNTHETIC-CREDITOR-ACCOUNT',
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
      ]);
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([
        createCustomAsset({
          id: 1,
          type: AssetType.CUSTODY,
          bank,
          name: 'EUR',
          balance: createCustomLiquidityBalance({ amount: 9000 }),
        }),
      ]);

      await service['setReadyDate']();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(5, { isReadyDate: expect.any(Date) });
    });

    it('reserves liquidity for transmitted Bank Frick orders awaiting completion', async () => {
      const bank = createCustomBank({ name: IbanBankName.FRICK, iban: 'SYNTHETIC-FRICK-ACCOUNT' });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 5,
          bank,
          amount: 5000,
          currency: 'EUR',
          isReadyDate: new Date('2026-07-01'),
          isTransmittedDate: new Date('2026-07-01'),
          frickTxId: 'DFX-FO-5',
        }),
        createCustomFiatOutput({
          id: 6,
          bank,
          iban: 'SYNTHETIC-CREDITOR-ACCOUNT',
          amount: 4000,
          currency: 'EUR',
          isReadyDate: null,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
          type: FiatOutputType.BUY_FIAT,
        }),
      ]);
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([
        createCustomAsset({
          id: 1,
          type: AssetType.CUSTODY,
          bank,
          name: 'EUR',
          balance: createCustomLiquidityBalance({ amount: 9000 }),
        }),
      ]);

      await service['setReadyDate']();

      expect(fiatOutputRepo.update).not.toHaveBeenCalledWith(6, { isReadyDate: expect.any(Date) });
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

    it('never includes a Bank Frick payout in a payment-file batch', async () => {
      const regular = createCustomFiatOutput({
        id: 1,
        accountIban: 'CH123456789',
        amount: 200,
        isComplete: false,
        bank: createCustomBank({ name: IbanBankName.RAIFFEISEN }),
      });
      const frick = createCustomFiatOutput({
        id: 2,
        accountIban: 'LI123456789',
        amount: 300,
        isComplete: false,
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      });
      jest.spyOn(fiatOutputRepo, 'findBy').mockResolvedValue([regular, frick]);
      jest.spyOn(fiatOutputRepo, 'findOne').mockResolvedValue(createCustomFiatOutput({ batchId: 0 }));

      await service['createBatches']();

      expect(fiatOutputRepo.save).toHaveBeenCalledWith([expect.objectContaining({ id: 1, batchId: 1 })]);
      expect(frick.batchId).toBeUndefined();
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

    it('marks a reconciled Bank Frick payout approved and confirmed', async () => {
      const bankTx = createCustomBankTx({ id: 400, created: new Date('2026-07-02') });
      const fiatOutput = createCustomFiatOutput({
        id: 4,
        frickTxId: 'DFX-FO-4',
        remittanceInfo: 'Synthetic Frick payout',
        isComplete: false,
        isReadyDate: new Date('2026-07-01'),
      });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxService, 'getBankTxByRemittanceInfo').mockResolvedValue(bankTx);

      await service['searchOutgoingBankTx']();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        4,
        expect.objectContaining({
          isComplete: true,
          isApprovedDate: bankTx.created,
          isConfirmedDate: bankTx.created,
        }),
      );
    });
  });

  describe('Bank Frick payouts', () => {
    const order = {
      orderId: 4242,
      customId: 'DFX-FO-42',
      type: FrickPaymentType.SEPA,
      state: FrickPaymentState.PREPARED,
      amount: 10,
      currency: 'EUR',
      reference: 'Synthetic payout',
      debitor: { iban: 'SYNTHETIC-DEBTOR' },
      creditor: { name: 'Synthetic Recipient', iban: 'SYNTHETIC-CREDITOR' },
    };

    it('keeps transmission disabled unless the explicit payout flag is true', async () => {
      Config.bank.frick.payoutEnabled = false;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);

      await service['transmitFrickPayments']();

      expect(fiatOutputRepo.find).not.toHaveBeenCalled();
      expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
    });

    it('honors the dedicated DisabledProcess kill-switch even when payout configuration is enabled', async () => {
      Config.bank.frick.payoutEnabled = true;
      jest
        .spyOn(processServiceModule, 'DisabledProcess')
        .mockImplementation((process) => process === processServiceModule.Process.FIAT_OUTPUT_FRICK_TRANSMISSION);
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);

      await service['transmitFrickPayments']();

      expect(fiatOutputRepo.find).not.toHaveBeenCalled();
      expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
    });

    it('honors the dedicated status-check kill-switch', async () => {
      jest
        .spyOn(processServiceModule, 'DisabledProcess')
        .mockImplementation((process) => process === processServiceModule.Process.FIAT_OUTPUT_FRICK_STATUS_CHECK);

      await service.checkFrickOrderStatus();

      expect(frickService.isAvailable).not.toHaveBeenCalled();
      expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    });

    it('skips status polling while Bank Frick is unavailable', async () => {
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(false);

      await service.checkFrickOrderStatus();

      expect(fiatOutputRepo.find).not.toHaveBeenCalled();
      expect(frickService.getPaymentOrder).not.toHaveBeenCalled();
    });

    it('uses a stable customId and persists it before any optional approval', async () => {
      Config.bank.frick.payoutEnabled = true;
      Config.bank.frick.approveWithoutTan = true;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
      jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue('4242');
      jest
        .spyOn(frickService, 'approvePaymentWithoutTan')
        .mockResolvedValue({ ...order, state: FrickPaymentState.IN_PROGRESS });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 42,
          amount: 10,
          currency: 'EUR',
          isInstant: false,
          accountIban: 'SYNTHETIC-DEBTOR',
          name: 'Synthetic Recipient',
          iban: 'SYNTHETIC-CREDITOR',
          remittanceInfo: 'Synthetic payout',
          bank: createCustomBank({ name: IbanBankName.FRICK }),
        }),
      ]);

      await service['transmitFrickPayments']();

      expect(frickService.createPaymentOrder).toHaveBeenCalledWith(
        expect.objectContaining({ customId: 'DFX-FO-42', reference: 'Synthetic payout' }),
      );
      expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(
        1,
        42,
        expect.objectContaining({
          frickTxId: 'DFX-FO-42',
          frickOrderId: '4242',
          isTransmittedDate: expect.any(Date),
        }),
      );
      expect((fiatOutputRepo.update as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (frickService.approvePaymentWithoutTan as jest.Mock).mock.invocationCallOrder[0],
      );
      expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(
        2,
        42,
        expect.objectContaining({ isApprovedDate: expect.any(Date) }),
      );
    });

    it.each([
      [TransactionCharge.BEN, FrickPaymentCharge.BENEFICIARY],
      [TransactionCharge.OUR, FrickPaymentCharge.OUR],
      [TransactionCharge.SHA, FrickPaymentCharge.SHARED],
    ])('maps fiat-output charge %s to Bank Frick charge %s', async (charge, expectedCharge) => {
      Config.bank.frick.payoutEnabled = true;
      Config.bank.frick.approveWithoutTan = false;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
      jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue(undefined);
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 42,
          amount: 10,
          currency: 'CHF',
          charge,
          accountIban: 'SYNTHETIC-DEBTOR',
          name: 'Synthetic Recipient',
          iban: 'SYNTHETIC-CREDITOR',
          bic: 'TESTLI22',
          bank: createCustomBank({ name: IbanBankName.FRICK }),
        }),
      ]);

      await service['transmitFrickPayments']();

      expect(frickService.createPaymentOrder).toHaveBeenCalledWith(expect.objectContaining({ charge: expectedCharge }));
    });

    it('polls existing orders while payout creation is disabled and leaves PREPARED manual', async () => {
      Config.bank.frick.payoutEnabled = false;
      Config.bank.frick.approveWithoutTan = false;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue(order);
      jest
        .spyOn(fiatOutputRepo, 'find')
        .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

      await service.checkFrickOrderStatus();

      expect(frickService.getPaymentOrder).toHaveBeenCalledWith('DFX-FO-42');
      expect(frickService.approvePaymentWithoutTan).not.toHaveBeenCalled();
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        info: 'FRICK order PREPARED: manual approval required',
      });
    });

    it('automatically approves a PREPARED order during status polling', async () => {
      Config.bank.frick.payoutEnabled = true;
      Config.bank.frick.approveWithoutTan = true;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue(order);
      jest
        .spyOn(frickService, 'approvePaymentWithoutTan')
        .mockResolvedValue({ ...order, state: FrickPaymentState.BOOKED });
      jest
        .spyOn(fiatOutputRepo, 'find')
        .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

      await service.checkFrickOrderStatus();

      expect(frickService.approvePaymentWithoutTan).toHaveBeenCalledWith('DFX-FO-42');
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          isApprovedDate: expect.any(Date),
          isConfirmedDate: expect.any(Date),
        }),
      );
    });

    it.each([
      [FrickPaymentState.IN_PROGRESS, false],
      [FrickPaymentState.EXECUTED, false],
      [FrickPaymentState.BOOKED, true],
    ])('persists the %s status transition', async (state, confirms) => {
      Config.bank.frick.payoutEnabled = false;
      Config.bank.frick.approveWithoutTan = false;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({ ...order, state });
      jest
        .spyOn(fiatOutputRepo, 'find')
        .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

      await service.checkFrickOrderStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          isApprovedDate: expect.any(Date),
          ...(confirms && { isConfirmedDate: expect.any(Date) }),
        }),
      );
      if (!confirms)
        expect(fiatOutputRepo.update).not.toHaveBeenCalledWith(
          42,
          expect.objectContaining({ isConfirmedDate: expect.any(Date) }),
        );
    });

    it('polls an already-approved IN_PROGRESS order without issuing an empty update', async () => {
      Config.bank.frick.payoutEnabled = false;
      Config.bank.frick.approveWithoutTan = false;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({
        ...order,
        state: FrickPaymentState.IN_PROGRESS,
      });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 42,
          frickTxId: 'DFX-FO-42',
          isApprovedDate: new Date('2026-07-01'),
          isComplete: false,
          info: undefined,
        }),
      ]);

      await service.checkFrickOrderStatus();

      expect(frickService.getPaymentOrder).toHaveBeenCalledWith('DFX-FO-42');
      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });

    it('preserves an operations note when a status request fails', async () => {
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue(new Error('synthetic status failure'));
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 42,
          frickTxId: 'DFX-FO-42',
          isComplete: false,
          info: 'Manual operations note',
        }),
      ]);

      await service.checkFrickOrderStatus();

      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });

    it('records a bounded Bank Frick status error when no operations note exists', async () => {
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue(new Error('synthetic status failure'));
      jest
        .spyOn(fiatOutputRepo, 'find')
        .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

      await service.checkFrickOrderStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        info: 'FRICK status error: synthetic status failure',
      });
    });

    it('does not use a lone house number as the creditor address', async () => {
      Config.bank.frick.payoutEnabled = true;
      Config.bank.frick.approveWithoutTan = false;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
      jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue('4242');
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 42,
          amount: 10,
          currency: 'EUR',
          accountIban: 'SYNTHETIC-DEBTOR',
          name: 'Synthetic Recipient',
          iban: 'SYNTHETIC-CREDITOR',
          address: undefined,
          houseNumber: '12',
          bank: createCustomBank({ name: IbanBankName.FRICK }),
        }),
      ]);

      await service['transmitFrickPayments']();

      expect(frickService.createPaymentOrder).toHaveBeenCalledWith(
        expect.objectContaining({ creditor: expect.objectContaining({ address: undefined }) }),
      );
    });

    it('preserves an operations note when transmission fails', async () => {
      Config.bank.frick.payoutEnabled = true;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'createPaymentOrder').mockRejectedValue(new Error('synthetic transmission failure'));
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 42,
          bank: createCustomBank({ name: IbanBankName.FRICK }),
          info: 'Manual operations note',
        }),
      ]);

      await service['transmitFrickPayments']();

      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });

    it('records a bounded Bank Frick transmission error when no operations note exists', async () => {
      Config.bank.frick.payoutEnabled = true;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'createPaymentOrder').mockRejectedValue(new Error('synthetic transmission failure'));
      jest
        .spyOn(fiatOutputRepo, 'find')
        .mockResolvedValue([createCustomFiatOutput({ id: 42, bank: createCustomBank({ name: IbanBankName.FRICK }) })]);

      await service['transmitFrickPayments']();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        info: 'FRICK error: synthetic transmission failure',
      });
    });

    it('does not recreate a rejected order and records the terminal state', async () => {
      Config.bank.frick.payoutEnabled = true;
      Config.bank.frick.approveWithoutTan = false;
      jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({
        ...order,
        state: FrickPaymentState.REJECTED,
      });
      jest
        .spyOn(fiatOutputRepo, 'find')
        .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

      await service.checkFrickOrderStatus();

      expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, { info: 'FRICK order REJECTED' });
    });

    it.each([
      FrickPaymentState.REJECTED,
      FrickPaymentState.EXPIRED,
      FrickPaymentState.DELETED,
      FrickPaymentState.DELETION_REQUESTED,
      FrickPaymentState.ERROR,
    ])('maps terminal state %s to an operations status', (state) => {
      expect(
        service['getFrickStatusUpdate'](
          { ...order, state },
          createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42' }),
        ),
      ).toEqual({ info: `FRICK order ${state}` });
    });

    it('rejects an unsupported Bank Frick status instead of guessing', () => {
      expect(() =>
        service['getFrickStatusUpdate'](
          { ...order, state: 'UNKNOWN' as FrickPaymentState },
          createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42' }),
        ),
      ).toThrow('Unsupported Bank Frick payment state');
    });
  });
});
