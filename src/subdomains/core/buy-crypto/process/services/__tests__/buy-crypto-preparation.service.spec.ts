import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config, ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { CountryService } from 'src/shared/models/country/country.service';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { AmlSourceType } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { ScorechainOutcome } from 'src/subdomains/core/aml/enums/scorechain-outcome.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { ScorechainDocumentService } from 'src/subdomains/generic/kyc/services/scorechain-document.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { createCustomBankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxOutgoingMatchService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-outgoing-match.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { InternalFeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EntityManager, IsNull } from 'typeorm';
import { createCustomBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCrypto, BuyCryptoStatus } from '../../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from '../buy-crypto-notification.service';
import { BuyCryptoPreparationService } from '../buy-crypto-preparation.service';
import { BuyCryptoWebhookService } from '../buy-crypto-webhook.service';
import { BuyCryptoService } from '../buy-crypto.service';

describe('BuyCryptoPreparationService', () => {
  let service: BuyCryptoPreparationService;

  let buyCryptoRepo: BuyCryptoRepository;
  let transactionHelper: TransactionHelper;
  let pricingService: PricingService;
  let fiatService: FiatService;
  let buyCryptoService: BuyCryptoService;
  let amlService: AmlService;
  let siftService: SiftService;
  let countryService: CountryService;
  let bankService: BankService;
  let buyCryptoWebhookService: BuyCryptoWebhookService;
  let buyCryptoNotificationService: BuyCryptoNotificationService;
  let virtualIbanService: VirtualIbanService;
  let transactionService: TransactionService;
  let scorechainScreeningService: ScorechainScreeningService;
  let scorechainDocumentService: ScorechainDocumentService;
  let transactionAmlCheckService: TransactionAmlCheckService;
  let bankTxService: BankTxService;
  let bankTxOutgoingMatchService: BankTxOutgoingMatchService;

  beforeEach(async () => {
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    transactionHelper = createMock<TransactionHelper>();
    pricingService = createMock<PricingService>();
    fiatService = createMock<FiatService>();
    buyCryptoService = createMock<BuyCryptoService>();
    amlService = createMock<AmlService>();
    siftService = createMock<SiftService>();
    countryService = createMock<CountryService>();
    bankService = createMock<BankService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();
    buyCryptoNotificationService = createMock<BuyCryptoNotificationService>();
    virtualIbanService = createMock<VirtualIbanService>();
    transactionService = createMock<TransactionService>();
    scorechainScreeningService = createMock<ScorechainScreeningService>();
    scorechainDocumentService = createMock<ScorechainDocumentService>();
    transactionAmlCheckService = createMock<TransactionAmlCheckService>();
    bankTxService = createMock<BankTxService>();
    bankTxOutgoingMatchService = createMock<BankTxOutgoingMatchService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyCryptoPreparationService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: PricingService, useValue: pricingService },
        { provide: FiatService, useValue: fiatService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: AmlService, useValue: amlService },
        { provide: SiftService, useValue: siftService },
        { provide: CountryService, useValue: countryService },
        { provide: BankService, useValue: bankService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: BuyCryptoNotificationService, useValue: buyCryptoNotificationService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        { provide: TransactionService, useValue: transactionService },
        { provide: ScorechainScreeningService, useValue: scorechainScreeningService },
        { provide: ScorechainDocumentService, useValue: scorechainDocumentService },
        { provide: TransactionAmlCheckService, useValue: transactionAmlCheckService },
        { provide: BankTxService, useValue: bankTxService },
        { provide: BankTxOutgoingMatchService, useValue: bankTxOutgoingMatchService },
      ],
    }).compile();

    service = module.get<BuyCryptoPreparationService>(BuyCryptoPreparationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('refreshFee', () => {
    it('does not recreate fee data when AML was reset after the transaction search', async () => {
      new ConfigService();
      const entity = createCustomBuyCrypto({
        amlCheck: CheckStatus.PASS,
        batch: null,
        fee: undefined,
        status: BuyCryptoStatus.MISSING_LIQUIDITY,
        version: 5,
      });
      const fiat = createCustomFiat({ name: 'EUR' });
      const fee: InternalFeeDto = {
        fees: [],
        min: 0,
        rate: 0.01,
        fixed: 0,
        bank: 0,
        bankFixed: 0,
        bankPercent: 0,
        partner: 0,
        network: 0,
        total: 1,
        payoutRefBonus: false,
      };
      const manager = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce({ id: entity.id })
          .mockResolvedValueOnce({
            ...entity,
            amlCheck: null,
          }),
        save: jest.fn(),
        update: jest.fn(),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(fiat);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue(Price.create('EUR', 'CHF', 1));
      jest.spyOn(transactionHelper, 'getTxFeeInfos').mockResolvedValue(fee);

      await service.refreshFee();

      expect(manager.findOne).toHaveBeenCalledTimes(2);
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });
  });

  function arrangeAmlCheck(entity: ReturnType<typeof createCustomBuyCrypto>) {
    jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity]);
    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue({} as any);
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
      banks: [],
      ipLogCountries: [],
      multiAccountBankNames: [],
    } as any);
    // bypass the heavy getAmlResult/getAmlErrors internals; we only test the persistence guard
    jest.spyOn(entity, 'amlCheckAndFillUp').mockReturnValue([entity.id, { amlCheck: CheckStatus.PASS }] as any);
    jest
      .spyOn(service as any, 'postProcessAmlVerdict')
      .mockImplementation(async (current: BuyCrypto, last30dVolume: number, isFirstRun: boolean) => {
        await amlService.postProcessing(current, last30dVolume, isFirstRun);
        if (current.amlCheck === CheckStatus.PASS) {
          await buyCryptoRepo.update(current.id, { amlPostProcessed: true });
          current.amlPostProcessed = true;
        }
        return true;
      });
    jest
      .spyOn(service as any, 'persistAmlDecision')
      .mockImplementation(
        async (
          current: BuyCrypto,
          id: number,
          update: Partial<BuyCrypto>,
          versionBefore: number,
          statusBefore: BuyCryptoStatus,
          amlCheckBefore: CheckStatus | undefined,
          amlReasonBefore: BuyCrypto['amlReason'],
        ) => {
          const result = await buyCryptoRepo.update(
            {
              id,
              version: versionBefore,
              status: statusBefore,
              isComplete: false,
              amlCheck: amlCheckBefore == null ? IsNull() : amlCheckBefore,
            },
            update,
          );
          if (!result.affected) return false;
          await transactionAmlCheckService.createFromEntity(
            current,
            'BuyCrypto',
            AmlSourceType.AML_CHECK_CRON,
            amlCheckBefore,
            amlReasonBefore,
          );
          return true;
        },
      );
  }

  describe('screenScorechain (Scorechain AML gate)', () => {
    const call = (entity: any): Promise<ScorechainOutcome> => (service as any).screenScorechain(entity);

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

    it('screens the withdrawal target address for a fiat-funded buy on a supported chain', async () => {
      const entity = createCustomBuyCrypto({
        cryptoInput: null,
        outputAsset: createCustomAsset({ blockchain: Blockchain.ETHEREUM }),
      });
      jest.spyOn(entity, 'targetAddress', 'get').mockReturnValue('0xabc');
      jest.spyOn(scorechainScreeningService, 'screenWithdrawalAddress').mockResolvedValue({} as any);
      jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(true);

      await expect(call(entity)).resolves.toBe(ScorechainOutcome.HIGH_RISK);
      expect(scorechainScreeningService.screenWithdrawalAddress).toHaveBeenCalledWith(Blockchain.ETHEREUM, '0xabc');
      expect(scorechainScreeningService.screenDepositTransaction).not.toHaveBeenCalled();
    });

    it('screens the deposit tx for a swap (crypto-in)', async () => {
      const entity = createCustomBuyCrypto({
        cryptoInput: { asset: { blockchain: Blockchain.BITCOIN }, inTxId: 'txhash' } as any,
      });
      jest.spyOn(scorechainScreeningService, 'screenDepositTransaction').mockResolvedValue({} as any);
      jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(false);

      await expect(call(entity)).resolves.toBe(ScorechainOutcome.PASS);
      expect(scorechainScreeningService.screenDepositTransaction).toHaveBeenCalledWith(Blockchain.BITCOIN, 'txhash');
      expect(scorechainScreeningService.screenWithdrawalAddress).not.toHaveBeenCalled();
    });

    it('yields no signal (false) and skips the provider for an unsupported chain', async () => {
      const entity = createCustomBuyCrypto({
        cryptoInput: null,
        outputAsset: createCustomAsset({ blockchain: Blockchain.MONERO }),
      });
      jest.spyOn(entity, 'targetAddress', 'get').mockReturnValue('addr');

      await expect(call(entity)).resolves.toBe(ScorechainOutcome.PASS);
      expect(scorechainScreeningService.screenWithdrawalAddress).not.toHaveBeenCalled();
    });

    it('yields no signal when the screening target id is missing', async () => {
      const entity = createCustomBuyCrypto({
        cryptoInput: null,
        outputAsset: createCustomAsset({ blockchain: Blockchain.ETHEREUM }),
      });
      jest.spyOn(entity, 'targetAddress', 'get').mockReturnValue(undefined);

      await expect(call(entity)).resolves.toBe(ScorechainOutcome.PASS);
      expect(scorechainScreeningService.screenWithdrawalAddress).not.toHaveBeenCalled();
    });

    it('yields no signal (false) and skips the provider when the Scorechain process is disabled', async () => {
      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);
      const entity = createCustomBuyCrypto({
        cryptoInput: null,
        outputAsset: createCustomAsset({ blockchain: Blockchain.ETHEREUM }),
      });
      jest.spyOn(entity, 'targetAddress', 'get').mockReturnValue('0xabc');

      await expect(call(entity)).resolves.toBe(ScorechainOutcome.PASS);
      expect(scorechainScreeningService.screenWithdrawalAddress).not.toHaveBeenCalled();
    });

    it('yields no signal (false) and skips the provider when no API key is configured', async () => {
      Config.scorechain.apiKey = undefined;
      const entity = createCustomBuyCrypto({
        cryptoInput: null,
        outputAsset: createCustomAsset({ blockchain: Blockchain.ETHEREUM }),
      });
      jest.spyOn(entity, 'targetAddress', 'get').mockReturnValue('0xabc');

      await expect(call(entity)).resolves.toBe(ScorechainOutcome.PASS);
      expect(scorechainScreeningService.screenWithdrawalAddress).not.toHaveBeenCalled();
    });

    it('fails closed to manual review (UNAVAILABLE) when the provider throws (outage / quota reached)', async () => {
      const entity = createCustomBuyCrypto({
        cryptoInput: { asset: { blockchain: Blockchain.BITCOIN }, inTxId: 'txhash' } as any,
      });
      jest
        .spyOn(scorechainScreeningService, 'screenDepositTransaction')
        .mockRejectedValue(new Error('scorechain unavailable'));

      await expect(call(entity)).resolves.toBe(ScorechainOutcome.UNAVAILABLE);
    });

    it('fails closed to UNAVAILABLE when isHighRisk throws (misconfigured risk threshold)', async () => {
      const entity = createCustomBuyCrypto({
        cryptoInput: { asset: { blockchain: Blockchain.BITCOIN }, inTxId: 'txhash' } as any,
      });
      jest.spyOn(scorechainScreeningService, 'screenDepositTransaction').mockResolvedValue({} as any);
      jest.spyOn(scorechainScreeningService, 'isHighRisk').mockImplementation(() => {
        throw new Error('SCORECHAIN_RISK_THRESHOLD is not configured');
      });

      await expect(call(entity)).resolves.toBe(ScorechainOutcome.UNAVAILABLE);
    });

    it('stores a compliance report for a freshly-screened tx tied to a customer', async () => {
      const entity = createCustomBuyCrypto({
        cryptoInput: null,
        outputAsset: createCustomAsset({ blockchain: Blockchain.ETHEREUM }),
      });
      jest.spyOn(entity, 'targetAddress', 'get').mockReturnValue('0xabc');
      const screening = { isNewlyScreened: true } as any;
      jest.spyOn(scorechainScreeningService, 'screenWithdrawalAddress').mockResolvedValue(screening);
      jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(false);

      await call(entity);

      expect(scorechainDocumentService.createScreeningReport).toHaveBeenCalledWith(entity.userData, screening);
    });

    it('does NOT store a report for a cache-hit screening (isNewlyScreened falsy)', async () => {
      const entity = createCustomBuyCrypto({
        cryptoInput: null,
        outputAsset: createCustomAsset({ blockchain: Blockchain.ETHEREUM }),
      });
      jest.spyOn(entity, 'targetAddress', 'get').mockReturnValue('0xabc');
      jest
        .spyOn(scorechainScreeningService, 'screenWithdrawalAddress')
        .mockResolvedValue({ isNewlyScreened: false } as any);
      jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(false);

      await call(entity);

      expect(scorechainDocumentService.createScreeningReport).not.toHaveBeenCalled();
    });
  });

  describe('chargebackFillUp', () => {
    it('should complete an order whose chargebackOutput is complete and take the chargebackBankTx from it', async () => {
      const chargebackBankTx = { id: 42 } as any;

      const entity = createCustomBuyCrypto({
        id: 1,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        outputAmount: null, // mirrors production shape of a refunded chargeback (no crypto output)
        chargebackOutput: { isComplete: true, bankTx: chargebackBankTx } as any,
      });

      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity]);

      await service.chargebackFillUp();

      expect(buyCryptoRepo.update).toHaveBeenCalledTimes(1);
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(entity.id, {
        chargebackBankTx,
        isComplete: true,
        status: BuyCryptoStatus.COMPLETE,
      });
      expect(buyCryptoWebhookService.triggerWebhook).toHaveBeenCalledTimes(1);
      expect(buyCryptoWebhookService.triggerWebhook).toHaveBeenCalledWith(entity);
    });

    it('should query with the chargebackOutput-complete filter and load the bankTx relation', async () => {
      const findSpy = jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([]);

      await service.chargebackFillUp();

      // assert the filter selects only refunded-and-settled orders, incl. operator direction
      const where = findSpy.mock.calls[0][0].where as any;
      expect(where.amlCheck).toBe(CheckStatus.FAIL);
      expect(where.isComplete).toBe(false);
      expect(where.chargebackBankTx.type).toBe('isNull'); // IsNull(): not yet linked
      expect(where.chargebackOutput.isComplete).toBe(true);
      expect(where.chargebackOutput.bankTx.id.type).toBe('not'); // Not(...): outer operator
      expect(where.chargebackOutput.bankTx.id.child.type).toBe('isNull'); // Not(IsNull()): refund already settled

      // the fix reads entity.chargebackOutput.bankTx, so that relation must be loaded
      const relations = findSpy.mock.calls[0][0].relations as any;
      expect(relations.chargebackOutput.bankTx).toBe(true);

      // empty result set → nothing is completed
      expect(buyCryptoRepo.update).not.toHaveBeenCalled();
      expect(buyCryptoWebhookService.triggerWebhook).not.toHaveBeenCalled();
    });

    it('should continue completing remaining orders even if a webhook fails for one of them', async () => {
      const entity1 = createCustomBuyCrypto({
        id: 1,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        outputAmount: null,
        chargebackOutput: { isComplete: true, bankTx: { id: 42 } } as any,
      });

      const entity2 = createCustomBuyCrypto({
        id: 2,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        outputAmount: null,
        chargebackOutput: { isComplete: true, bankTx: { id: 43 } } as any,
      });

      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity1, entity2]);
      jest
        .spyOn(buyCryptoWebhookService, 'triggerWebhook')
        .mockRejectedValueOnce(new Error('webhook down'))
        .mockResolvedValue(undefined);

      await service.chargebackFillUp();

      expect(buyCryptoRepo.update).toHaveBeenCalledTimes(2);
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(entity1.id, expect.objectContaining({ isComplete: true }));
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(entity2.id, expect.objectContaining({ isComplete: true }));
      expect(buyCryptoWebhookService.triggerWebhook).toHaveBeenCalledTimes(2);
    });
  });

  describe('doAmlCheck — concurrent decision guard', () => {
    it('excludes operator and user refund claims from every AML selection branch', async () => {
      const findSpy = jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([]);

      await service.doAmlCheck();

      const where = findSpy.mock.calls[0][0].where as Array<Record<string, unknown>>;
      expect(where).toHaveLength(3);
      for (const branch of where) {
        expect(branch).toEqual(
          expect.objectContaining({
            chargebackAllowedDate: IsNull(),
            chargebackAllowedDateUser: IsNull(),
          }),
        );
      }
    });

    it('skips post-processing (no overwrite) when the conditional update affects 0 rows', async () => {
      // first-run tx (amlCheck=null) that a reviewer concurrently changed → cron write must not win
      const entity = createCustomBuyCrypto({ id: 1, amlCheck: null, cryptoInput: undefined, bankTx: undefined });
      arrangeAmlCheck(entity);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 0 } as any);

      await service.doAmlCheck();

      // guarded write: criteria carries the amlCheck guard (NULL first-run), not a bare id
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, amlCheck: IsNull() }),
        expect.objectContaining({ amlCheck: CheckStatus.PASS }),
      );
      expect(amlService.postProcessing).not.toHaveBeenCalled();
    });

    it('runs post-processing when the conditional update affects the row', async () => {
      const entity = createCustomBuyCrypto({ id: 1, amlCheck: null, cryptoInput: undefined, bankTx: undefined });
      arrangeAmlCheck(entity);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(amlService.postProcessing).toHaveBeenCalledTimes(1);
    });
  });

  describe('doAmlCheck — post-processing retry guard', () => {
    it('re-selects a PASS whose post-processing did not complete (retry branch)', async () => {
      const findSpy = jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([]);

      await service.doAmlCheck();

      const where = findSpy.mock.calls[0][0].where as any[];
      expect(where).toEqual(
        expect.arrayContaining([expect.objectContaining({ amlCheck: CheckStatus.PASS, amlPostProcessed: false })]),
      );
    });

    it('retries post-processing for an unprocessed PASS WITHOUT recomputing the verdict, so a committed PASS is never reverted', async () => {
      const entity = createCustomBuyCrypto({
        id: 1,
        amlCheck: CheckStatus.PASS,
        amlPostProcessed: false,
        cryptoInput: undefined,
        bankTx: undefined,
      });
      arrangeAmlCheck(entity); // amlCheckAndFillUp would recompute the verdict if it were called
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(entity.amlCheckAndFillUp).not.toHaveBeenCalled(); // no recompute → cannot revert a manual PASS
      expect(amlService.postProcessing).toHaveBeenCalledTimes(1); // side-effects are retried
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(1, { amlPostProcessed: true });
      // the verdict-guarded update {id, amlCheck: PASS} must never be issued on the retry path
      expect(buyCryptoRepo.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ amlCheck: CheckStatus.PASS }),
        expect.anything(),
      );
    });

    it('leaves amlPostProcessed unset when the retry post-processing throws, so the next run retries again', async () => {
      const entity = createCustomBuyCrypto({
        id: 1,
        amlCheck: CheckStatus.PASS,
        amlPostProcessed: false,
        cryptoInput: undefined,
        bankTx: undefined,
      });
      arrangeAmlCheck(entity);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1 } as any);
      jest.spyOn(amlService, 'postProcessing').mockRejectedValue(new Error('transient db failure'));

      await service.doAmlCheck();

      expect(buyCryptoRepo.update).not.toHaveBeenCalledWith(1, { amlPostProcessed: true });
    });

    it('skips PASS post-processing when the transaction changed before the retry acquired its lock', async () => {
      const entity = createCustomBuyCrypto({
        id: 1,
        version: 5,
        status: BuyCryptoStatus.MISSING_LIQUIDITY,
        amlCheck: CheckStatus.PASS,
        amlPostProcessed: false,
      });
      const manager = {
        findOne: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });

      await expect((service as any).postProcessAmlVerdict(entity, 100, false)).resolves.toBe(false);

      expect(manager.findOne).toHaveBeenCalledWith(
        BuyCrypto,
        expect.objectContaining({
          where: expect.objectContaining({ id: 1, version: 5, amlCheck: CheckStatus.PASS }),
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(amlService.postProcessing).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('marks amlPostProcessed=true after a first-time PASS is post-processed (normal path)', async () => {
      const entity = createCustomBuyCrypto({ id: 1, amlCheck: null, cryptoInput: undefined, bankTx: undefined });
      arrangeAmlCheck(entity);
      // mirror the real amlCheckAndFillUp, which applies the computed verdict onto the entity
      jest.spyOn(entity, 'amlCheckAndFillUp').mockImplementation((async () => {
        entity.amlCheck = CheckStatus.PASS;
        return [entity.id, { amlCheck: CheckStatus.PASS }];
      }) as any);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(entity.amlCheckAndFillUp).toHaveBeenCalledTimes(1); // normal path computes the verdict
      expect(amlService.postProcessing).toHaveBeenCalledTimes(1);
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(1, { amlPostProcessed: true });
    });
  });

  describe('doAmlCheck — amlCheck audit trail', () => {
    it('records an AML_CHECK_CRON history row with the correct entity / source / previous verdict when the cron changes it', async () => {
      const entity = createCustomBuyCrypto({ id: 1, amlCheck: null, cryptoInput: undefined, bankTx: undefined });
      arrangeAmlCheck(entity);
      jest.spyOn(entity, 'amlCheckAndFillUp').mockImplementation((async () => {
        entity.amlCheck = CheckStatus.PASS;
        return [entity.id, { amlCheck: CheckStatus.PASS }];
      }) as any);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalledTimes(1);
      const [entityArg, entityType, source, previousAmlCheck] = (
        transactionAmlCheckService.createFromEntity as jest.Mock
      ).mock.calls[0];
      expect(entityArg).toEqual(expect.objectContaining({ id: 1, amlCheck: CheckStatus.PASS }));
      expect(entityType).toBe('BuyCrypto');
      expect(source).toBe(AmlSourceType.AML_CHECK_CRON);
      expect(previousAmlCheck).toBeNull();
    });

    it('does NOT record a history row when the guarded update is not applied (affected 0)', async () => {
      const entity = createCustomBuyCrypto({ id: 1, amlCheck: null, cryptoInput: undefined, bankTx: undefined });
      arrangeAmlCheck(entity);
      jest.spyOn(entity, 'amlCheckAndFillUp').mockImplementation((async () => {
        entity.amlCheck = CheckStatus.PASS; // a verdict was computed locally...
        return [entity.id, { amlCheck: CheckStatus.PASS }];
      }) as any);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 0 } as any); // ...but the guard rejects it

      await service.doAmlCheck();

      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });
  });

  describe('chargebackTx — user refund claim promotion', () => {
    it.each([
      { source: 'Checkout', relation: { checkoutTx: { id: 88 } as any }, method: 'refundCheckoutTx' },
      { source: 'CryptoInput', relation: { cryptoInput: { id: 89 } as any }, method: 'refundCryptoInput' },
      {
        source: 'BankTx',
        relation: { bankTx: { id: 90 } as any },
        method: 'refundBankTx',
        refundData: {
          chargebackIban: 'CH9300762011623852957',
          chargebackCreditorData: JSON.stringify({ name: 'Refund Recipient' }),
        },
      },
    ])(
      'promotes a $source user refund claim without discarding its timestamp',
      async ({ relation, method, refundData = {} }) => {
        const chargebackAllowedDateUser = new Date('2026-08-01T12:00:00.000Z');
        const entity = createCustomBuyCrypto({
          id: 78,
          ...relation,
          ...refundData,
          chargebackAllowedDate: undefined,
          chargebackAllowedDateUser,
          chargebackAmount: 1,
          isComplete: false,
        });
        jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([entity]);

        await service.chargebackTx();

        const refund = buyCryptoService[method as 'refundCheckoutTx' | 'refundCryptoInput' | 'refundBankTx'];
        expect(refund).toHaveBeenCalledWith(entity, expect.objectContaining({ chargebackAllowedDateUser }));
      },
    );

    it('never promotes a refund whose chargeback already left the bank', async () => {
      const find = jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([]);

      await service.chargebackTx();

      const { where } = find.mock.calls[0][0];
      expect(where).toHaveLength(3);
      for (const branch of where as object[]) {
        expect(branch).toMatchObject({ chargebackDate: IsNull(), chargebackBankTx: IsNull() });
      }
    });
  });

  describe('matchExternalChargebacks', () => {
    const incomingBankTx = createCustomBankTx({
      id: 100,
      iban: 'DE12500105170648489890',
      accountIban: 'LU116060002000005040',
      amount: 83.39,
      currency: 'EUR',
      created: new Date('2026-07-22T11:00:00.000Z'),
    });
    const chargebackBankTx = createCustomBankTx({
      id: 200,
      iban: 'DE12500105170648489890',
      amount: 83.39,
      currency: 'EUR',
      created: new Date('2026-07-29T09:05:00.000Z'),
    });

    function createFailedEntity(): BuyCrypto {
      // mirrors the candidate query invariants (no batch/output, no chargeback fields yet)
      return createCustomBuyCrypto({
        id: 7,
        amlCheck: CheckStatus.FAIL,
        bankTx: incomingBankTx,
        batch: null,
        outputAmount: null,
        chargebackAmount: null,
        transaction: { user: { id: 11 } } as never,
      });
    }

    it('claims the matched bank TX, completes the entity and types it as BuyCryptoReturn', async () => {
      const entity = createFailedEntity();
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([entity]).mockResolvedValueOnce([]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueExternalChargebackBankTx').mockResolvedValue(chargebackBankTx);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1 } as never);

      await service.matchExternalChargebacks();

      expect(bankTxOutgoingMatchService.getUniqueExternalChargebackBankTx).toHaveBeenCalledWith({
        counterpartyIban: incomingBankTx.iban,
        accountIban: incomingBankTx.accountIban,
        amount: incomingBankTx.amount,
        currency: incomingBankTx.currency,
        earliestDate: incomingBankTx.created,
      });
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: entity.id,
          amlCheck: CheckStatus.FAIL,
          isComplete: false,
          batch: IsNull(),
          outputAmount: IsNull(),
          chargebackOutput: IsNull(),
          chargebackAllowedDate: IsNull(),
          chargebackAllowedDateUser: IsNull(),
          chargebackDate: IsNull(),
          chargebackCryptoTxId: IsNull(),
          chargebackBankTx: IsNull(),
        }),
        expect.objectContaining({
          chargebackBankTx: chargebackBankTx,
          chargebackDate: chargebackBankTx.created,
          chargebackAllowedDate: chargebackBankTx.created,
          chargebackAmount: incomingBankTx.amount,
          chargebackAsset: chargebackBankTx.currency,
          chargebackIban: chargebackBankTx.iban,
          mailSendDate: null,
          isComplete: true,
          status: BuyCryptoStatus.COMPLETE,
        }),
      );
      expect(bankTxService.updateInternal).toHaveBeenCalledWith(
        chargebackBankTx,
        { type: BankTxType.BUY_CRYPTO_RETURN },
        entity.transaction.user,
      );
      expect(buyCryptoWebhookService.triggerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ id: entity.id, isComplete: true, status: BuyCryptoStatus.COMPLETE }),
      );
    });

    it('matches on the deposit amount when a prepared chargeback amount is denominated in another currency', async () => {
      const entity = createFailedEntity();
      entity.chargebackAmount = 90;
      entity.chargebackAsset = 'CHF';
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([entity]).mockResolvedValueOnce([]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueExternalChargebackBankTx').mockResolvedValue(undefined);

      await service.matchExternalChargebacks();

      expect(bankTxOutgoingMatchService.getUniqueExternalChargebackBankTx).toHaveBeenCalledWith(
        expect.objectContaining({ amount: incomingBankTx.amount }),
      );
    });

    it('matches on a prepared chargeback amount denominated in the deposit currency', async () => {
      const entity = createFailedEntity();
      entity.chargebackAmount = 80;
      entity.chargebackAsset = incomingBankTx.currency;
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([entity]).mockResolvedValueOnce([]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueExternalChargebackBankTx').mockResolvedValue(undefined);

      await service.matchExternalChargebacks();

      expect(bankTxOutgoingMatchService.getUniqueExternalChargebackBankTx).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 80 }),
      );
    });

    it('claims nothing when one bank TX fits several failed buy-cryptos', async () => {
      const first = createFailedEntity();
      const second = createCustomBuyCrypto({
        id: 9,
        amlCheck: CheckStatus.FAIL,
        bankTx: incomingBankTx,
        chargebackAmount: null,
        transaction: { user: { id: 13 } } as never,
      });
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([first, second]).mockResolvedValueOnce([]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueExternalChargebackBankTx').mockResolvedValue(chargebackBankTx);
      const update = jest.spyOn(buyCryptoRepo, 'update');

      await service.matchExternalChargebacks();

      expect(update).not.toHaveBeenCalled();
      expect(bankTxService.updateInternal).not.toHaveBeenCalled();
    });

    it('never types the bank TX when the claim is lost to a concurrent chargeback', async () => {
      const entity = createFailedEntity();
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([entity]).mockResolvedValueOnce([]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueExternalChargebackBankTx').mockResolvedValue(chargebackBankTx);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 0 } as never);

      await service.matchExternalChargebacks();

      expect(bankTxService.updateInternal).not.toHaveBeenCalled();
      expect(buyCryptoWebhookService.triggerWebhook).not.toHaveBeenCalled();
    });

    it('does nothing without a unique bank TX match', async () => {
      const entity = createFailedEntity();
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([entity]).mockResolvedValueOnce([]);
      jest.spyOn(bankTxOutgoingMatchService, 'getUniqueExternalChargebackBankTx').mockResolvedValue(undefined);
      const update = jest.spyOn(buyCryptoRepo, 'update');

      await service.matchExternalChargebacks();

      expect(update).not.toHaveBeenCalled();
      expect(bankTxService.updateInternal).not.toHaveBeenCalled();
    });

    it('heals a linked but untyped chargeback bank TX', async () => {
      const linkedEntity = createCustomBuyCrypto({
        id: 8,
        chargebackBankTx: createCustomBankTx({ id: 300, type: BankTxType.PENDING }),
        transaction: { user: { id: 12 } } as never,
      });
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValueOnce([]).mockResolvedValueOnce([linkedEntity]);

      await service.matchExternalChargebacks();

      expect(bankTxService.updateInternal).toHaveBeenCalledWith(
        linkedEntity.chargebackBankTx,
        { type: BankTxType.BUY_CRYPTO_RETURN },
        linkedEntity.transaction.user,
      );
    });
  });
});
