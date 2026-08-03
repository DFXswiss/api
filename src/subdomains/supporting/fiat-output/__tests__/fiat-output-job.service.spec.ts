// generateReports resolves a per-merchant EP2 container at runtime via createStorageService();
// mock the factory so the WORM sink (uploadWormBlob) is a spy and no real storage backend is touched.
const ep2UploadBlobMock = jest.fn();
jest.mock('src/integration/infrastructure/storage/storage.factory', () => ({
  createStorageService: jest.fn(() => ({
    uploadWormBlob: (...args: any[]) => ep2UploadBlobMock(...args),
  })),
}));

import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { In, IsNull, Like, Not } from 'typeorm';
import { FrickPaymentState } from 'src/integration/bank/dto/frick.dto';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { IbanService } from 'src/integration/bank/services/iban.service';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { ScryptTransactionStatus } from 'src/integration/exchange/dto/scrypt.dto';
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
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { createCustomLiquidityBalance } from 'src/subdomains/core/liquidity-management/__mocks__/liquidity-balance.entity.mock';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { createCustomBuyFiat } from 'src/subdomains/core/sell-crypto/process/__mocks__/buy-fiat.entity.mock';
import { createCustomSell } from 'src/subdomains/core/sell-crypto/route/__mocks__/sell.entity.mock';
import { SellRepository } from 'src/subdomains/core/sell-crypto/route/sell.repository';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankTxOutgoingMatchService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-outgoing-match.service';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { BankTxRepeatService } from '../../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx/bank-tx-return/bank-tx-return.service';
import { createCustomBankTx } from '../../bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { BankTxType } from '../../bank-tx/bank-tx/entities/bank-tx.entity';
import { createCustomBank, olkyEUR, yapealEUR } from '../../bank/bank/__mocks__/bank.entity.mock';
import { BankService } from '../../bank/bank/bank.service';
import { IbanBankName } from '../../bank/bank/dto/bank.dto';
import { createCustomVirtualIban } from '../../bank/virtual-iban/__mocks__/virtual-iban.entity.mock';
import { VirtualIbanService } from '../../bank/virtual-iban/virtual-iban.service';
import { createCustomLog } from '../../log/__mocks__/log.entity.mock';
import { LogService } from '../../log/log.service';
import { createCustomCryptoInput } from '../../payin/entities/__mocks__/crypto-input.entity.mock';
import { createCustomFiatOutput } from '../__mocks__/fiat-output.entity.mock';
import { Ep2ReportService } from '../ep2-report.service';
import { FiatOutputFrickService } from '../fiat-output-frick.service';
import { FiatOutputJobService, SCRYPT_DEPOSIT_NAME_MARKER } from '../fiat-output-job.service';
import { FiatOutputType } from '../fiat-output.entity';
import { FiatOutputRepository } from '../fiat-output.repository';

describe('FiatOutputJobService', () => {
  let service: FiatOutputJobService;

  let fiatOutputRepo: FiatOutputRepository;
  let bankTxService: BankTxService;
  let bankTxOutgoingMatchService: BankTxOutgoingMatchService;
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
  let scryptService: ScryptService;
  let frickPayoutService: FiatOutputFrickService;

  beforeEach(async () => {
    ep2UploadBlobMock.mockReset();
    fiatOutputRepo = createMock<FiatOutputRepository>();
    bankTxService = createMock<BankTxService>();
    bankTxOutgoingMatchService = createMock<BankTxOutgoingMatchService>();
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
    scryptService = createMock<ScryptService>();
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    // Default mock: no virtual IBANs
    jest.spyOn(virtualIbanService, 'getActiveSendingCandidatesForUserAndCurrency').mockResolvedValue([]);
    jest.spyOn(virtualIbanService, 'getBaseAccountIban').mockResolvedValue(undefined);
    jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatOutputJobService,
        // Real FiatOutputService instance so getPayoutAccount exercises the shared payout-bank selector
        // used by fee prediction instead of a hand-duplicated mock.
        FiatOutputService,
        { provide: FiatOutputRepository, useValue: fiatOutputRepo },
        { provide: BuyFiatRepository, useValue: createMock<BuyFiatRepository>() },
        { provide: BuyCryptoRepository, useValue: createMock<BuyCryptoRepository>() },
        { provide: SellRepository, useValue: createMock<SellRepository>() },
        { provide: BankTxService, useValue: bankTxService },
        { provide: BankTxOutgoingMatchService, useValue: bankTxOutgoingMatchService },
        { provide: Ep2ReportService, useValue: ep2ReportService },
        { provide: CountryService, useValue: countryService },
        { provide: BankService, useValue: bankService },
        { provide: AssetService, useValue: assetService },
        { provide: LogService, useValue: logService },
        { provide: BankTxReturnService, useValue: bankTxReturnService },
        { provide: BankTxRepeatService, useValue: bankTxRepeatService },
        { provide: YapealService, useValue: yapealService },
        { provide: OlkypayService, useValue: olkypayService },
        // Real FiatOutputFrickService instance so setReadyDate's pending-liquidity filter exercises the
        // actual isFrickTerminalState logic instead of a hand-duplicated mock.
        FiatOutputFrickService,
        { provide: BankFrickService, useValue: createMock<BankFrickService>() },
        { provide: IbanService, useValue: createMock<IbanService>() },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        { provide: ScryptService, useValue: scryptService },

        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<FiatOutputJobService>(FiatOutputJobService);
    frickPayoutService = module.get<FiatOutputFrickService>(FiatOutputFrickService);
    jest.spyOn(frickPayoutService, 'canCreatePayments').mockReturnValue(true);
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

      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([yapealEUR]);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toEqual({ id: 1, accountIban: IsNull() });
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, accountIban: yapealEUR.iban });

      expect(updateCalls[1][0]).toEqual({ id: 3, accountIban: IsNull() });
      expect(updateCalls[1][1]).toMatchObject({ originEntityId: 102, accountIban: yapealEUR.iban });
    });

    it('should assign bank account when accountIban is an empty string (legacy rows)', async () => {
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          accountIban: '',
          bank: undefined,
          type: FiatOutputType.BUY_FIAT,
          isComplete: false,
          buyFiats: [createCustomBuyFiat({ id: 100, sell: createCustomSell({ iban: 'DE123456789' }) })],
        }),
      ]);

      jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createCustomCountry({ yapealEnable: true }));

      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([yapealEUR]);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toEqual({ id: 1, accountIban: '' });
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, accountIban: yapealEUR.iban });
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
        .spyOn(virtualIbanService, 'getActiveSendingCandidatesForUserAndCurrency')
        .mockResolvedValue([createCustomVirtualIban({ iban: virtualIban, bank: yapealEUR })]);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toEqual({ id: 1, accountIban: IsNull() });
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
        .spyOn(virtualIbanService, 'getActiveSendingCandidatesForUserAndCurrency')
        .mockResolvedValue([createCustomVirtualIban({ iban: virtualIban, bank: yapealEUR })]);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls[0][0]).toEqual({ id: 1, accountIban: IsNull() });
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, accountIban: virtualIban });
    });

    it('excludes Bank Frick from automatic sender selection regardless of payout-creation availability', async () => {
      const frick = createCustomBank({
        name: IbanBankName.FRICK,
        currency: 'EUR',
        iban: 'SYNTHETIC-FRICK-ACCOUNT',
        send: true,
      });
      jest.spyOn(frickPayoutService, 'canCreatePayments').mockReturnValue(false);
      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([frick, yapealEUR]);

      const result = await service['getPayoutAccount'](
        createCustomFiatOutput({ currency: 'EUR', buyFiats: [] }),
        createCustomCountry({ yapealEnable: true }),
      );

      expect(result).toEqual({ accountIban: yapealEUR.iban, bank: yapealEUR });
    });

    it('excludes Bank Frick from automatic sender selection regardless of its instant-payment capability', async () => {
      const frick = createCustomBank({
        name: IbanBankName.FRICK,
        currency: 'EUR',
        iban: 'SYNTHETIC-FRICK-ACCOUNT',
        send: true,
        sctInst: false,
      });
      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([frick, olkyEUR]);

      const result = await service['getPayoutAccount'](
        createCustomFiatOutput({ currency: 'EUR', isInstant: true, buyFiats: [] }),
        createCustomCountry({ yapealEnable: true }),
      );

      expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
    });

    it('excludes Bank Frick from automatic sender selection even when its sender priority is worse', async () => {
      const frick = createCustomBank({
        name: IbanBankName.FRICK,
        currency: 'EUR',
        iban: 'SYNTHETIC-FRICK-ACCOUNT',
        send: true,
        sendPriority: 2000,
      });
      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([frick, olkyEUR]);

      const result = await service['getPayoutAccount'](
        createCustomFiatOutput({ currency: 'EUR', buyFiats: [] }),
        createCustomCountry({ yapealEnable: true }),
      );

      expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
    });

    it('never auto-selects Bank Frick even when it has better sender priority than the incumbent', async () => {
      const frick = createCustomBank({
        name: IbanBankName.FRICK,
        currency: 'EUR',
        iban: 'SYNTHETIC-FRICK-ACCOUNT',
        send: true,
        sendPriority: 500,
      });
      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([frick, yapealEUR]);

      const result = await service['getPayoutAccount'](
        createCustomFiatOutput({ currency: 'EUR', buyFiats: [] }),
        createCustomCountry({ yapealEnable: true }),
      );

      expect(result).toEqual({ accountIban: yapealEUR.iban, bank: yapealEUR });
    });

    it('never throws on a priority tie with Bank Frick - Frick is filtered out before the tie can even occur', async () => {
      const frick = createCustomBank({
        name: IbanBankName.FRICK,
        currency: 'EUR',
        iban: 'SYNTHETIC-FRICK-ACCOUNT',
        send: true,
        sendPriority: 1000,
      });
      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([frick, yapealEUR]);

      const result = await service['getPayoutAccount'](
        createCustomFiatOutput({ currency: 'EUR', buyFiats: [] }),
        createCustomCountry({ yapealEnable: true }),
      );

      expect(result).toEqual({ accountIban: yapealEUR.iban, bank: yapealEUR });
    });

    it('routes to the highest-priority (lowest number) sender when multiple non-Frick banks are eligible', async () => {
      const highPriorityOlky = createCustomBank({ ...olkyEUR, sendPriority: 500 });
      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([yapealEUR, highPriorityOlky]);

      const result = await service['getPayoutAccount'](
        createCustomFiatOutput({ currency: 'EUR', buyFiats: [] }),
        createCustomCountry({ yapealEnable: true }),
      );

      expect(result).toEqual({ accountIban: highPriorityOlky.iban, bank: highPriorityOlky });
    });

    it('routes an EUR payout to the first eligible non-Frick sender when Olkypay EUR and Yapeal EUR are both send=true at the default priority (no throw)', async () => {
      // Regression: a tie between two non-Frick incumbents at the shared default priority (1000) must
      // never throw - only a tie that involves Frick itself is a genuine ambiguity. Throwing here would
      // silently strand every EUR payout the moment a second non-Frick sender is enabled for EUR.
      jest.spyOn(bankService, 'getSenderBanks').mockResolvedValue([olkyEUR, yapealEUR]);

      const result = await service['getPayoutAccount'](
        createCustomFiatOutput({ currency: 'EUR', buyFiats: [] }),
        createCustomCountry({ yapealEnable: true }),
      );

      expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
    });

    it('excludes an unavailable Bank Frick virtual IBAN from automatic selection unconditionally', async () => {
      const frick = createCustomBank({ name: IbanBankName.FRICK, send: true });
      jest.spyOn(frickPayoutService, 'canCreatePayments').mockReturnValue(false);
      jest
        .spyOn(virtualIbanService, 'getActiveSendingCandidatesForUserAndCurrency')
        .mockResolvedValue([createCustomVirtualIban({ iban: 'SYNTHETIC-FRICK-VIBAN', bank: frick })]);

      const result = await service['getPayoutAccount'](
        createCustomFiatOutput({
          currency: 'EUR',
          type: FiatOutputType.BUY_FIAT,
          buyFiats: [createCustomBuyFiat({})],
        }),
        createCustomCountry({ yapealEnable: true }),
      );

      expect(result).toEqual({ accountIban: undefined, bank: undefined });
    });

    it('keeps an already-assigned account IBAN and bank relation without re-resolving or auto-selecting', async () => {
      const accountIban = 'LI75088110103524';
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          accountIban,
          bank: olkyEUR,
          type: FiatOutputType.BUY_FIAT,
          isComplete: false,
          buyFiats: [createCustomBuyFiat({ id: 100, sell: createCustomSell({ iban: 'DE123456789' }) })],
        }),
      ]);
      jest.spyOn(bankService, 'getBankByIban').mockResolvedValue(olkyEUR);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][0]).toEqual({ id: 1, accountIban });
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, bank: olkyEUR });
      expect(bankService.getBankByIban).not.toHaveBeenCalled();
      expect(bankService.getSenderBanks).not.toHaveBeenCalled();
    });

    it('repairs a missing bank relation from an already-assigned account IBAN without auto-selecting', async () => {
      const accountIban = 'LI75088110103524';
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          accountIban,
          bank: undefined,
          type: FiatOutputType.BUY_FIAT,
          isComplete: false,
          buyFiats: [createCustomBuyFiat({ id: 100, sell: createCustomSell({ iban: 'DE123456789' }) })],
        }),
      ]);
      jest.spyOn(bankService, 'getBankByIban').mockResolvedValue(olkyEUR);

      await service['assignBankAccount']();

      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][0]).toEqual({ id: 1, accountIban });
      expect(updateCalls[0][1]).toMatchObject({ originEntityId: 100, bank: olkyEUR });
      expect(bankService.getBankByIban).toHaveBeenCalledWith(accountIban);
      expect(bankService.getSenderBanks).not.toHaveBeenCalled();
    });

    it('logs a bank lookup miss and continues to repair the next entity in the same run', async () => {
      const accountIban = 'LI75088110103524';
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 1,
          originEntityId: 123,
          accountIban,
          bank: undefined,
          type: FiatOutputType.BUY_FIAT,
          isComplete: false,
          buyFiats: [createCustomBuyFiat({ id: 100, sell: createCustomSell({ iban: 'DE123456789' }) })],
        }),
        createCustomFiatOutput({
          id: 2,
          originEntityId: 123,
          accountIban,
          bank: undefined,
          type: FiatOutputType.BUY_FIAT,
          isComplete: false,
          buyFiats: [createCustomBuyFiat({ id: 200, sell: createCustomSell({ iban: 'DE123456789' }) })],
        }),
      ]);
      jest.spyOn(bankService, 'getBankByIban').mockResolvedValueOnce(undefined).mockResolvedValueOnce(olkyEUR);
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service['assignBankAccount']();

      const findArgs = (fiatOutputRepo.find as jest.Mock).mock.calls[0][0];
      expect(findArgs.where).toHaveLength(3);
      expect(findArgs.where[2]).toEqual({
        valutaDate: IsNull(),
        isComplete: false,
        type: In([FiatOutputType.BUY_CRYPTO_FAIL, FiatOutputType.BUY_FIAT, FiatOutputType.BANK_TX_RETURN]),
        accountIban: Not(IsNull()),
        bank: IsNull(),
      });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error in fillPreValutaDate fiatOutput: 1:',
        expect.objectContaining({ message: `No bank found for account IBAN ${accountIban} (fiat output 1)` }),
      );
      const updateCalls = (fiatOutputRepo.update as jest.Mock).mock.calls;
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][0]).toEqual({ id: 2, accountIban });
      expect(updateCalls[0][1]).toMatchObject({ bank: olkyEUR });
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

    it('does not make an assigned Bank Frick payout ready while creation is disabled', async () => {
      const bank = createCustomBank({ name: IbanBankName.FRICK, iban: 'SYNTHETIC-FRICK-ACCOUNT' });
      jest.spyOn(frickPayoutService, 'canCreatePayments').mockReturnValue(false);
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 5,
          bank,
          iban: 'SYNTHETIC-CREDITOR-ACCOUNT',
          amount: 100,
          currency: 'EUR',
          type: FiatOutputType.BUY_FIAT,
          buyFiats: [
            createCustomBuyFiat({
              cryptoInput: createCustomCryptoInput({ isConfirmed: true, asset: createDefaultAsset() }),
            }),
          ],
        }),
      ]);
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([
        createCustomAsset({
          type: AssetType.CUSTODY,
          bank,
          balance: createCustomLiquidityBalance({ amount: 9000 }),
        }),
      ]);

      await service['setReadyDate']();

      expect(fiatOutputRepo.update).not.toHaveBeenCalledWith(5, { isReadyDate: expect.any(Date) });
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
          frickCustomId: 'DFX-FO-5',
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

    it('releases Bank Frick liquidity from a terminal status regardless of the operations note', async () => {
      const bank = createCustomBank({ name: IbanBankName.FRICK, iban: 'SYNTHETIC-FRICK-ACCOUNT' });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 5,
          bank,
          amount: 5000,
          currency: 'EUR',
          isReadyDate: new Date('2026-07-01'),
          isTransmittedDate: new Date('2026-07-01'),
          frickCustomId: 'DFX-FO-5',
          frickOrderStatus: FrickPaymentState.REJECTED,
          info: 'Manual operations follow-up',
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

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(6, { isReadyDate: expect.any(Date) });
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
    it('does not attempt reconciliation before an output is ready', async () => {
      jest
        .spyOn(fiatOutputRepo, 'find')
        .mockResolvedValue([createCustomFiatOutput({ id: 99, isReadyDate: undefined, isComplete: false })]);

      await service['searchOutgoingBankTx']();

      expect(bankTxOutgoingMatchService.getUniqueOutgoingBankTx).not.toHaveBeenCalled();
      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });

    it('should match FiatOutput via remittanceInfo', async () => {
      const bankTx = createCustomBankTx({ id: 100, created: new Date('2024-01-01') });
      const fiatOutput = createCustomFiatOutput({
        id: 1,
        remittanceInfo: 'DFX-123',
        isComplete: false,
        isReadyDate: new Date('2024-01-01'),
      });

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueOutgoingBankTx').mockResolvedValue(bankTx);

      await service['searchOutgoingBankTx']();

      expect(bankTxOutgoingMatchService.getUniqueOutgoingBankTx).toHaveBeenCalledWith(
        expect.objectContaining({ remittanceInfo: 'DFX-123', earliestDate: new Date('2024-01-01') }),
      );
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ isComplete: true, bankTx }));
    });

    it('matches a Bank Frick payout via frickReference (the bank-echoed reference), not the untouched customer remittanceInfo', async () => {
      const bankTx = createCustomBankTx({ id: 101, created: new Date('2024-01-01') });
      const fiatOutput = createCustomFiatOutput({
        id: 3,
        remittanceInfo: 'Original customer text',
        frickReference: 'DFX-FO-3 Original customer text',
        isComplete: false,
        isReadyDate: new Date('2024-01-01'),
      });

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueOutgoingBankTx').mockResolvedValue(bankTx);

      await service['searchOutgoingBankTx']();

      expect(bankTxOutgoingMatchService.getUniqueOutgoingBankTx).toHaveBeenCalledWith(
        expect.objectContaining({ remittanceInfo: 'DFX-FO-3 Original customer text' }),
      );
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
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueOutgoingBankTx').mockResolvedValue(bankTx);

      await service['searchOutgoingBankTx']();

      expect(bankTxOutgoingMatchService.getUniqueOutgoingBankTx).toHaveBeenCalledWith(
        expect.objectContaining({ remittanceInfo: undefined, endToEndId: 'E2E-79057' }),
      );
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(2, expect.objectContaining({ isComplete: true, bankTx }));
    });

    it('should not match if BankTx created before FiatOutput isReadyDate', async () => {
      const fiatOutput = createCustomFiatOutput({
        id: 3,
        endToEndId: 'E2E-79058',
        isComplete: false,
        isReadyDate: new Date('2024-01-02'), // after BankTx.created
      });

      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueOutgoingBankTx').mockResolvedValue(undefined);

      await service['searchOutgoingBankTx']();

      expect(bankTxOutgoingMatchService.getUniqueOutgoingBankTx).toHaveBeenCalledWith(
        expect.objectContaining({ earliestDate: new Date('2024-01-02') }),
      );
      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });

    it('marks a reconciled Bank Frick payout approved and confirmed', async () => {
      const bankTx = createCustomBankTx({ id: 400, created: new Date('2026-07-02') });
      const fiatOutput = createCustomFiatOutput({
        id: 4,
        frickCustomId: 'DFX-FO-4',
        remittanceInfo: 'Synthetic Frick payout',
        isComplete: false,
        isReadyDate: new Date('2026-07-01'),
      });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueOutgoingBankTx').mockResolvedValue(bankTx);

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

    it('classifies a matched internal liquidity-management transfer', async () => {
      const bankTx = createCustomBankTx({ id: 401, created: new Date('2026-07-02'), type: BankTxType.GSHEET });
      const fiatOutput = createCustomFiatOutput({
        id: 5,
        endToEndId: 'E2E-79059',
        isComplete: false,
        isReadyDate: new Date('2026-07-01'),
        type: FiatOutputType.LIQ_MANAGEMENT,
      });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([fiatOutput]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueOutgoingBankTx').mockResolvedValue(bankTx);
      jest.spyOn(bankTxService, 'getType').mockResolvedValue(BankTxType.INTERNAL);

      await service['searchOutgoingBankTx']();

      expect(bankTxService.updateInternal).toHaveBeenCalledWith(bankTx, { type: BankTxType.INTERNAL });
    });
  });

  describe('Bank Frick liquidity', () => {
    it('reserves liquidity for a Bank Frick order stuck in DELETION_REQUESTED', async () => {
      const bank = createCustomBank({ name: IbanBankName.FRICK, iban: 'SYNTHETIC-FRICK-ACCOUNT' });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
        createCustomFiatOutput({
          id: 5,
          bank,
          amount: 5000,
          currency: 'EUR',
          isReadyDate: new Date('2026-07-01'),
          isTransmittedDate: new Date('2026-07-01'),
          frickCustomId: 'DFX-FO-5',
          frickOrderStatus: FrickPaymentState.DELETION_REQUESTED,
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

  describe('notifyScryptDeposits', () => {
    function createScryptDepositEntity(overrides: Parameters<typeof createCustomFiatOutput>[0] = {}) {
      return createCustomFiatOutput({
        id: 10,
        type: FiatOutputType.LIQ_MANAGEMENT,
        name: `Payout ${SCRYPT_DEPOSIT_NAME_MARKER}`,
        isComplete: true,
        currency: 'CHF',
        amount: 1500,
        endToEndId: 'E2E-SCRYPT-10',
        scryptDepositNotifiedDate: null,
        ...overrides,
      });
    }

    it('does not query when the Scrypt deposit notify process is disabled', async () => {
      jest
        .spyOn(processServiceModule, 'DisabledProcess')
        .mockImplementation((process) => process === processServiceModule.Process.FIAT_OUTPUT_SCRYPT_DEPOSIT_NOTIFY);

      await service['notifyScryptDeposits']();

      expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    });

    it('loads completed LiqManagement Scrypt deposits that are not yet notified', async () => {
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([]);

      await service['notifyScryptDeposits']();

      expect(fiatOutputRepo.find).toHaveBeenCalledWith({
        where: {
          type: FiatOutputType.LIQ_MANAGEMENT,
          name: Like(`%${SCRYPT_DEPOSIT_NAME_MARKER}%`),
          isComplete: true,
          scryptDepositNotifiedDate: IsNull(),
        },
      });
    });

    it('marks a COMPLETED deposit as notified without re-sending the deposit request', async () => {
      const entity = createScryptDepositEntity();
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue({
        id: 'tx-completed',
        status: ScryptTransactionStatus.COMPLETED,
      });

      await service['notifyScryptDeposits']();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(entity.id, {
        scryptDepositNotifiedDate: expect.any(Date),
      });
      expect(scryptService.sendDepositRequest).not.toHaveBeenCalled();
    });

    it.each([
      {
        status: ScryptTransactionStatus.REJECTED,
        depositStatus: {
          id: 'tx-rejected',
          status: ScryptTransactionStatus.REJECTED,
          rejectText: 'Broker rejected deposit',
        },
        expectedReason: 'Broker rejected deposit',
      },
      {
        status: ScryptTransactionStatus.FAILED,
        depositStatus: {
          id: 'tx-failed',
          status: ScryptTransactionStatus.FAILED,
          rejectReason: 'Insufficient details',
        },
        expectedReason: 'Insufficient details',
      },
      {
        status: ScryptTransactionStatus.REJECTED,
        depositStatus: {
          id: 'tx-unknown',
          status: ScryptTransactionStatus.REJECTED,
        },
        expectedReason: 'unknown reason',
      },
    ])(
      'logs $status deposits with reason "$expectedReason" and does not update or re-send',
      async ({ depositStatus, expectedReason }) => {
        const entity = createScryptDepositEntity();
        jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
        jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue(depositStatus);
        const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

        await service['notifyScryptDeposits']();

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            `Scrypt deposit request for fiat output ${entity.id} was ${depositStatus.status}: ${expectedReason}`,
          ),
        );
        expect(fiatOutputRepo.update).not.toHaveBeenCalled();
        expect(scryptService.sendDepositRequest).not.toHaveBeenCalled();
      },
    );

    it('throttles the Rejected/Failed alert log to once per retry interval, then re-alerts after it elapses', async () => {
      const entity = createScryptDepositEntity({ id: 66 });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue({
        id: 'tx-rejected-throttle',
        status: ScryptTransactionStatus.REJECTED,
        rejectText: 'Broker rejected deposit',
      });
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service['notifyScryptDeposits']();
      await service['notifyScryptDeposits']();

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);

      (service as any).scryptDepositAlerts.set(entity.id, new Date(Date.now() - 61 * 60 * 1000));

      await service['notifyScryptDeposits']();

      expect(loggerErrorSpy).toHaveBeenCalledTimes(2);
    });

    it('alerts immediately when a rejection arrives right after a send attempt', async () => {
      const entity = createScryptDepositEntity({ id: 99 });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue(null);
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service['notifyScryptDeposits']();
      expect(scryptService.sendDepositRequest).toHaveBeenCalledTimes(1);
      expect(loggerErrorSpy).not.toHaveBeenCalled();

      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue({
        id: 'tx-rejected-after-send',
        status: ScryptTransactionStatus.REJECTED,
        rejectText: 'Broker rejected deposit',
      });

      await service['notifyScryptDeposits']();

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('sends a deposit request using endToEndId as reqId when no status is known yet', async () => {
      const entity = createScryptDepositEntity({ endToEndId: 'E2E-CUSTOM-42', id: 42 });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue(null);

      await service['notifyScryptDeposits']();

      expect(scryptService.sendDepositRequest).toHaveBeenCalledWith({
        currency: entity.currency,
        amount: entity.amount,
        reqId: 'E2E-CUSTOM-42',
        timeStamp: expect.any(Date),
      });
    });

    it('sends a deposit request using DEPOSIT-{id} when endToEndId is missing', async () => {
      const entity = createScryptDepositEntity({ endToEndId: undefined, id: 77 });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue(null);

      await service['notifyScryptDeposits']();

      expect(scryptService.sendDepositRequest).toHaveBeenCalledWith({
        currency: entity.currency,
        amount: entity.amount,
        reqId: 'DEPOSIT-77',
        timeStamp: expect.any(Date),
      });
    });

    it('deduplicates send attempts within the retry interval and re-sends after it elapses', async () => {
      const entity = createScryptDepositEntity({ id: 55 });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue(null);

      await service['notifyScryptDeposits']();
      await service['notifyScryptDeposits']();

      expect(scryptService.sendDepositRequest).toHaveBeenCalledTimes(1);

      (service as any).scryptDepositSendAttempts.set(entity.id, new Date(Date.now() - 61 * 60 * 1000));

      await service['notifyScryptDeposits']();

      expect(scryptService.sendDepositRequest).toHaveBeenCalledTimes(2);
    });

    it('clears the local send and alert entries after a successful COMPLETED status update', async () => {
      const entity = createScryptDepositEntity({ id: 88 });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue(null);

      await service['notifyScryptDeposits']();
      expect((service as any).scryptDepositSendAttempts.has(entity.id)).toBe(true);
      (service as any).scryptDepositAlerts.set(entity.id, new Date());

      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue({
        id: 'tx-done',
        status: ScryptTransactionStatus.COMPLETED,
      });

      await service['notifyScryptDeposits']();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(entity.id, {
        scryptDepositNotifiedDate: expect.any(Date),
      });
      expect((service as any).scryptDepositSendAttempts.has(entity.id)).toBe(false);
      expect((service as any).scryptDepositAlerts.has(entity.id)).toBe(false);
    });

    it('isolates errors so a failure on one entity does not block the rest of the sweep', async () => {
      const entity1 = createScryptDepositEntity({ id: 1, endToEndId: 'E2E-1' });
      const entity2 = createScryptDepositEntity({ id: 2, endToEndId: 'E2E-2' });
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity1, entity2]);
      jest.spyOn(scryptService, 'getDepositStatus').mockImplementation((reqId: string) => {
        if (reqId === 'E2E-1') throw new Error('status lookup failed');
        return null;
      });
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service['notifyScryptDeposits']();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Failed to process Scrypt deposit notification for fiat output ${entity1.id}:`,
        expect.any(Error),
      );
      expect(scryptService.sendDepositRequest).toHaveBeenCalledWith(expect.objectContaining({ reqId: 'E2E-2' }));
    });

    it('waits on an intermediate status without marking or re-sending', async () => {
      const entity = createScryptDepositEntity();
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue({
        id: 'tx-pending',
        status: 'PendingApproval' as ScryptTransactionStatus,
      });
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service['notifyScryptDeposits']();

      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
      expect(scryptService.sendDepositRequest).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('retries the send on the next sweep when sendDepositRequest fails', async () => {
      const entity = createScryptDepositEntity();
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue(null);
      jest
        .spyOn(scryptService, 'sendDepositRequest')
        .mockRejectedValueOnce(new Error('send failed'))
        .mockResolvedValue(undefined as any);
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service['notifyScryptDeposits']();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Failed to process Scrypt deposit notification for fiat output ${entity.id}:`,
        expect.any(Error),
      );
      expect((service as any).scryptDepositSendAttempts.has(entity.id)).toBe(false);

      await service['notifyScryptDeposits']();

      expect(scryptService.sendDepositRequest).toHaveBeenCalledTimes(2);
    });

    it('re-alerts a rejected deposit after the interval without ever re-sending', async () => {
      const entity = createScryptDepositEntity();
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(scryptService, 'getDepositStatus').mockReturnValue({
        id: 'tx-rejected',
        status: ScryptTransactionStatus.REJECTED,
        rejectText: 'Broker rejected deposit',
      });
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service['notifyScryptDeposits']();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Scrypt deposit request for fiat output ${entity.id} was Rejected`),
      );

      (service as any).scryptDepositAlerts.set(entity.id, new Date(Date.now() - 61 * 60 * 1000));

      await service['notifyScryptDeposits']();

      expect(loggerErrorSpy).toHaveBeenCalledTimes(2);
      expect(loggerErrorSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`Scrypt deposit request for fiat output ${entity.id} was Rejected`),
      );
      expect(scryptService.sendDepositRequest).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: 'wrong type',
        entity: createCustomFiatOutput({
          id: 1,
          type: FiatOutputType.BUY_FIAT,
          name: `Payout ${SCRYPT_DEPOSIT_NAME_MARKER}`,
          isComplete: true,
          currency: 'CHF',
          amount: 100,
        }),
      },
      {
        label: 'name without marker',
        entity: createCustomFiatOutput({
          id: 2,
          type: FiatOutputType.LIQ_MANAGEMENT,
          name: 'Unrelated counterparty',
          isComplete: true,
          currency: 'CHF',
          amount: 100,
        }),
      },
      {
        label: 'undefined name',
        entity: createCustomFiatOutput({
          id: 3,
          type: FiatOutputType.LIQ_MANAGEMENT,
          name: undefined,
          isComplete: true,
          currency: 'CHF',
          amount: 100,
        }),
      },
      {
        label: 'isComplete false',
        entity: createScryptDepositEntity({ isComplete: false }),
      },
      {
        label: 'already notified',
        entity: createScryptDepositEntity({ scryptDepositNotifiedDate: new Date() }),
      },
    ])('fail-closed: skips notifyScryptDeposit when $label', async ({ entity }) => {
      await service['notifyScryptDeposit'](entity);

      expect(scryptService.getDepositStatus).not.toHaveBeenCalled();
      expect(scryptService.sendDepositRequest).not.toHaveBeenCalled();
      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('generateReports', () => {
    // A FiatOutput whose buyFiat resolves the container, route id and userData the method needs.
    // The getter chain (paymentLinkPayment.link.linkConfigObj, paymentLinksConfigObj) is stubbed
    // directly on plain objects so we don't have to assemble the full entity graph.
    function reportableEntity() {
      const buyFiat: any = {
        sell: { id: 555 },
        userData: { paymentLinksConfigObj: { ep2ReportContainer: 'ep2-merchant-bucket' } },
        paymentLinkPayment: { link: { linkConfigObj: { payoutRouteId: 777 } } },
      };

      return {
        id: 1,
        created: new Date('2024-03-01T10:00:00Z'),
        buyFiats: [buyFiat],
      } as any;
    }

    beforeEach(() => {
      ep2UploadBlobMock.mockResolvedValue(undefined);
      (ep2ReportService.generateReport as jest.Mock).mockReturnValue('<ep2/>');
    });

    it('uploads the report, then sets reportCreated', async () => {
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([reportableEntity()]);

      await service['generateReports']();

      const fileName = ep2UploadBlobMock.mock.calls[0][0];
      expect(ep2UploadBlobMock).toHaveBeenCalledTimes(1);
      expect(fileName).toMatch(/^settlement_.*_777\.ep2$/);

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(1, { reportCreated: true });

      // Load-bearing ordering: uploadBlob (WORM PUT) < update(reportCreated=true).
      // reportCreated MUST be persisted after a successful upload, otherwise a later failure
      // would leave reportCreated=false and the next run would re-PUT the same fileName
      // into the immutable WORM bucket and deadlock.
      const uploadOrder = ep2UploadBlobMock.mock.invocationCallOrder[0];
      const updateOrder = (fiatOutputRepo.update as jest.Mock).mock.invocationCallOrder[0];
      expect(uploadOrder).toBeLessThan(updateOrder);
    });

    it('does not set reportCreated when the upload itself fails', async () => {
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([reportableEntity()]);
      ep2UploadBlobMock.mockRejectedValue(new Error('WORM bucket unreachable'));

      await service['generateReports']();

      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });

    it('falls back to the sell route id for the file name when no payoutRouteId is configured', async () => {
      // linkConfigObj has no payoutRouteId => the `routeId ?? buyFiat.sell.id` fallback kicks in
      // and the file name must carry the sell id (555) instead of a payout route id.
      const entity = reportableEntity();
      entity.buyFiats[0].paymentLinkPayment.link.linkConfigObj = {};
      jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([entity]);

      await service['generateReports']();

      const fileName = ep2UploadBlobMock.mock.calls[0][0];
      expect(fileName).toMatch(/^settlement_.*_555\.ep2$/);
    });
  });
});
