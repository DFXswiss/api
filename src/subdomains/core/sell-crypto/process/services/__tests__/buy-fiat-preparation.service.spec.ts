import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config, ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { CountryService } from 'src/shared/models/country/country.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { CustodyOrderService } from 'src/subdomains/core/custody/services/custody-order.service';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { IsNull } from 'typeorm';
import { createCustomBuyFiat } from '../../__mocks__/buy-fiat.entity.mock';
import { BuyFiatRepository } from '../../buy-fiat.repository';
import { BuyFiatNotificationService } from '../buy-fiat-notification.service';
import { BuyFiatPreparationService } from '../buy-fiat-preparation.service';
import { BuyFiatService } from '../buy-fiat.service';

describe('BuyFiatPreparationService', () => {
  let service: BuyFiatPreparationService;

  let buyFiatRepo: BuyFiatRepository;
  let transactionHelper: TransactionHelper;
  let pricingService: PricingService;
  let feeService: FeeService;
  let buyFiatService: BuyFiatService;
  let amlService: AmlService;
  let countryService: CountryService;
  let buyFiatNotificationService: BuyFiatNotificationService;
  let fiatOutputService: FiatOutputService;
  let transactionService: TransactionService;
  let custodyOrderService: CustodyOrderService;
  let scorechainScreeningService: ScorechainScreeningService;

  beforeEach(async () => {
    buyFiatRepo = createMock<BuyFiatRepository>();
    transactionHelper = createMock<TransactionHelper>();
    pricingService = createMock<PricingService>();
    feeService = createMock<FeeService>();
    buyFiatService = createMock<BuyFiatService>();
    amlService = createMock<AmlService>();
    countryService = createMock<CountryService>();
    buyFiatNotificationService = createMock<BuyFiatNotificationService>();
    fiatOutputService = createMock<FiatOutputService>();
    transactionService = createMock<TransactionService>();
    custodyOrderService = createMock<CustodyOrderService>();
    scorechainScreeningService = createMock<ScorechainScreeningService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyFiatPreparationService,
        { provide: BuyFiatRepository, useValue: buyFiatRepo },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: PricingService, useValue: pricingService },
        { provide: FeeService, useValue: feeService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: AmlService, useValue: amlService },
        { provide: CountryService, useValue: countryService },
        { provide: BuyFiatNotificationService, useValue: buyFiatNotificationService },
        { provide: FiatOutputService, useValue: fiatOutputService },
        { provide: TransactionService, useValue: transactionService },
        { provide: CustodyOrderService, useValue: custodyOrderService },
        { provide: ScorechainScreeningService, useValue: scorechainScreeningService },
      ],
    }).compile();

    service = module.get<BuyFiatPreparationService>(BuyFiatPreparationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  function arrangeAmlCheck(entity: ReturnType<typeof createCustomBuyFiat>) {
    entity.cryptoInput.isConfirmed = true;
    jest.spyOn(buyFiatRepo, 'find').mockResolvedValue([entity]);
    jest.spyOn(transactionHelper, 'getMinVolume').mockResolvedValue(0);
    jest.spyOn(transactionHelper, 'getVolumeChfSince').mockResolvedValue(0);
    jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: () => 100 } as any);
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(undefined);
    jest.spyOn(amlService, 'getAmlCheckInput').mockResolvedValue({
      users: [{} as any],
      refUser: undefined,
      recommender: undefined,
      bankData: undefined,
      blacklist: [],
      phoneCallList: [],
    } as any);
    // bypass the heavy getAmlResult/getAmlErrors internals; we only test the persistence guard
    jest.spyOn(entity, 'amlCheckAndFillUp').mockReturnValue([entity.id, { amlCheck: CheckStatus.PASS }] as any);
  }

  describe('screenScorechain (Scorechain AML gate)', () => {
    const call = (entity: any): Promise<boolean> => (service as any).screenScorechain(entity);

    let apiKeyBackup: string | undefined;

    beforeAll(() => {
      // Config is an uninitialized `export let` until a ConfigService is constructed; the gate reads
      // Config.scorechain.apiKey, so prime it (mirrors scorechain.service.spec)
      new ConfigService();
    });

    beforeEach(() => {
      // enable the feature so the screening path is exercised: DisabledProcess is fail-closed
      // (disabled) by default in tests and no API key is configured
      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
      apiKeyBackup = Config.scorechain.apiKey;
      Config.scorechain.apiKey = 'test-key';
    });

    afterEach(() => {
      Config.scorechain.apiKey = apiKeyBackup;
      jest.restoreAllMocks();
    });

    it('screens the incoming deposit tx on a supported chain', async () => {
      const entity = createCustomBuyFiat({
        cryptoInput: { asset: { blockchain: Blockchain.BITCOIN }, inTxId: 'txhash' } as any,
      });
      jest.spyOn(scorechainScreeningService, 'screenDepositTransaction').mockResolvedValue({} as any);
      jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(true);

      await expect(call(entity)).resolves.toBe(true);
      expect(scorechainScreeningService.screenDepositTransaction).toHaveBeenCalledWith(Blockchain.BITCOIN, 'txhash');
    });

    it('yields no signal (false) and skips the provider for an unsupported chain', async () => {
      const entity = createCustomBuyFiat({
        cryptoInput: { asset: { blockchain: Blockchain.MONERO }, inTxId: 'txhash' } as any,
      });

      await expect(call(entity)).resolves.toBe(false);
      expect(scorechainScreeningService.screenDepositTransaction).not.toHaveBeenCalled();
    });

    it('yields no signal when the deposit tx id is missing', async () => {
      const entity = createCustomBuyFiat({
        cryptoInput: { asset: { blockchain: Blockchain.BITCOIN }, inTxId: undefined } as any,
      });

      await expect(call(entity)).resolves.toBe(false);
      expect(scorechainScreeningService.screenDepositTransaction).not.toHaveBeenCalled();
    });

    it('yields no signal (false) and skips the provider when the Scorechain process is disabled', async () => {
      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);
      const entity = createCustomBuyFiat({
        cryptoInput: { asset: { blockchain: Blockchain.BITCOIN }, inTxId: 'txhash' } as any,
      });

      await expect(call(entity)).resolves.toBe(false);
      expect(scorechainScreeningService.screenDepositTransaction).not.toHaveBeenCalled();
    });

    it('yields no signal (false) and skips the provider when no API key is configured', async () => {
      Config.scorechain.apiKey = undefined;
      const entity = createCustomBuyFiat({
        cryptoInput: { asset: { blockchain: Blockchain.BITCOIN }, inTxId: 'txhash' } as any,
      });

      await expect(call(entity)).resolves.toBe(false);
      expect(scorechainScreeningService.screenDepositTransaction).not.toHaveBeenCalled();
    });

    it('fails closed to manual review (true) when the provider throws (outage / quota reached)', async () => {
      const entity = createCustomBuyFiat({
        cryptoInput: { asset: { blockchain: Blockchain.BITCOIN }, inTxId: 'txhash' } as any,
      });
      jest
        .spyOn(scorechainScreeningService, 'screenDepositTransaction')
        .mockRejectedValue(new Error('scorechain unavailable'));

      await expect(call(entity)).resolves.toBe(true);
    });
  });

  describe('doAmlCheck — concurrent decision guard', () => {
    it('skips post-processing (no overwrite) when the conditional update affects 0 rows', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: null });
      arrangeAmlCheck(entity);
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 0 } as any);

      await service.doAmlCheck();

      // guarded write: criteria carries the amlCheck guard (NULL first-run), not a bare id
      expect(buyFiatRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, amlCheck: IsNull() }),
        expect.objectContaining({ amlCheck: CheckStatus.PASS }),
      );
      expect(amlService.postProcessing).not.toHaveBeenCalled();
    });

    it('runs post-processing when the conditional update affects the row', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: null });
      arrangeAmlCheck(entity);
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(amlService.postProcessing).toHaveBeenCalledTimes(1);
    });
  });

  describe('doAmlCheck — post-processing retry guard', () => {
    it('re-selects a PASS whose post-processing did not complete (retry branch)', async () => {
      const findSpy = jest.spyOn(buyFiatRepo, 'find').mockResolvedValue([]);

      await service.doAmlCheck();

      const where = findSpy.mock.calls[0][0].where as any[];
      expect(where).toEqual(
        expect.arrayContaining([expect.objectContaining({ amlCheck: CheckStatus.PASS, amlPostProcessed: false })]),
      );
    });

    it('retries post-processing for an unprocessed PASS WITHOUT recomputing the verdict, so a committed PASS is never reverted', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: CheckStatus.PASS, amlPostProcessed: false });
      arrangeAmlCheck(entity); // amlCheckAndFillUp would recompute the verdict if it were called
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(entity.amlCheckAndFillUp).not.toHaveBeenCalled(); // no recompute → cannot revert a manual PASS
      expect(amlService.postProcessing).toHaveBeenCalledTimes(1); // side-effects are retried
      expect(buyFiatRepo.update).toHaveBeenCalledWith(1, { amlPostProcessed: true });
      expect(buyFiatRepo.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ amlCheck: CheckStatus.PASS }),
        expect.anything(),
      );
    });

    it('leaves amlPostProcessed unset when the retry post-processing throws, so the next run retries again', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: CheckStatus.PASS, amlPostProcessed: false });
      arrangeAmlCheck(entity);
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 1 } as any);
      jest.spyOn(amlService, 'postProcessing').mockRejectedValue(new Error('transient db failure'));

      await service.doAmlCheck();

      expect(buyFiatRepo.update).not.toHaveBeenCalledWith(1, { amlPostProcessed: true });
    });

    it('marks amlPostProcessed=true after a first-time PASS is post-processed (normal path)', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: null });
      arrangeAmlCheck(entity);
      // mirror the real amlCheckAndFillUp, which applies the computed verdict onto the entity
      jest.spyOn(entity, 'amlCheckAndFillUp').mockImplementation((async () => {
        entity.amlCheck = CheckStatus.PASS;
        return [entity.id, { amlCheck: CheckStatus.PASS }];
      }) as any);
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(entity.amlCheckAndFillUp).toHaveBeenCalledTimes(1); // normal path computes the verdict
      expect(amlService.postProcessing).toHaveBeenCalledTimes(1);
      expect(buyFiatRepo.update).toHaveBeenCalledWith(1, { amlPostProcessed: true });
    });
  });
});
