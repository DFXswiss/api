import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestUtil } from 'src/shared/utils/test.util';
import { AmlSourceType } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { createCustomBuy } from 'src/subdomains/core/buy-crypto/routes/buy/__mocks__/buy.entity.mock';
import { LiquidityManagementPipeline } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRuleStatus } from 'src/subdomains/core/liquidity-management/enums';
import { LiquidityManagementService } from 'src/subdomains/core/liquidity-management/services/liquidity-management.service';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { RiskStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { CheckLiquidityResult } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EntityManager, IsNull } from 'typeorm';
import { createCustomBuyCryptoBatch } from '../../entities/__mocks__/buy-crypto-batch.entity.mock';
import { createCustomBuyCryptoFee } from '../../entities/__mocks__/buy-crypto-fee.entity.mock';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCryptoBatch } from '../../entities/buy-crypto-batch.entity';
import { BuyCrypto, BuyCryptoStatus } from '../../entities/buy-crypto.entity';
import { BuyCryptoBatchRepository } from '../../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from '../buy-crypto-batch.service';
import { BuyCryptoNotificationService } from '../buy-crypto-notification.service';
import { BuyCryptoPricingService } from '../buy-crypto-pricing.service';

describe('BuyCryptoBatchService', () => {
  let service: BuyCryptoBatchService;

  /*** Dependencies ***/

  let buyCryptoRepo: BuyCryptoRepository;
  let buyCryptoBatchRepo: BuyCryptoBatchRepository;
  let pricingService: PricingService;
  let buyCryptoPricingService: BuyCryptoPricingService;
  let assetService: AssetService;
  let fiatService: FiatService;
  let dexService: DexService;
  let payoutService: PayoutService;
  let buyCryptoNotificationService: BuyCryptoNotificationService;
  let liquidityManagementService: LiquidityManagementService;
  let feeService: FeeService;
  let transactionAmlCheckService: TransactionAmlCheckService;
  let buyCryptoRepoManager: { findOne: jest.Mock; update: jest.Mock };

  /*** Spies ***/

  let exchangeUtilityServiceGetMatchingPrice: jest.SpyInstance;
  let dexServiceCheckLiquidity: jest.SpyInstance;

  beforeEach(async () => {
    await setupMocks();
    setupSpies();
  });

  describe('#batchAndOptimizeTransactions(...)', () => {
    it('returns early when there is no input transactions', async () => {
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => []);

      const result = await service.batchAndOptimizeTransactions();

      expect(result).toBeUndefined();
      expect(dexServiceCheckLiquidity).toBeCalledTimes(0);
    });

    it('excludes operator and user refund claims from every batching branch', async () => {
      const findSpy = jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([]);

      await service.batchAndOptimizeTransactions();

      const where = findSpy.mock.calls[0][0].where as Array<Record<string, unknown>>;
      expect(where).toHaveLength(2);
      for (const branch of where) {
        expect(branch).toEqual(
          expect.objectContaining({
            chargebackAllowedDate: IsNull(),
            chargebackAllowedDateUser: IsNull(),
          }),
        );
      }
    });

    it('defines output reference amounts', async () => {
      const transactions = [
        createCustomBuyCrypto({
          outputAsset: createDefaultAsset(),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
          outputReferenceAmount: null,
          inputReferenceAmountMinusFee: 10000,
        }),
      ];
      const calculateOutputReferenceAmountSpy = jest.spyOn(transactions[0], 'calculateOutputReferenceAmount');

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAmount).toBe(null);

      await service.batchAndOptimizeTransactions();

      expect(exchangeUtilityServiceGetMatchingPrice).toBeCalledTimes(1);
      expect(calculateOutputReferenceAmountSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAmount).toBe(1000);
      expect(dexServiceCheckLiquidity).toBeCalledTimes(1);
    });

    it('moves on normally if there is no blocked assets', async () => {
      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(1);
    });

    it('does not save a batch when the transaction changed after the batch calculations', async () => {
      const transaction = createCustomBuyCrypto({ version: 5 });
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([transaction]);
      (buyCryptoBatchRepo.manager.findOne as jest.Mock).mockResolvedValueOnce(null);

      await service.batchAndOptimizeTransactions();

      expect(buyCryptoBatchRepo.manager.findOne).toHaveBeenCalledWith(
        BuyCrypto,
        expect.objectContaining({ where: expect.objectContaining({ id: transaction.id, version: 5 }) }),
      );
      expect(buyCryptoBatchRepo.manager.save).not.toHaveBeenCalled();
    });

    it('blocks creating a batch if there already existing batch for an asset', async () => {
      const transactions = [createCustomBuyCrypto({ outputAsset: createCustomAsset({ dexName: 'dDOGE' }) })];

      jest
        .spyOn(buyCryptoBatchRepo, 'findOneBy')
        .mockImplementation(async () =>
          createCustomBuyCryptoBatch({ outputAsset: createCustomAsset({ dexName: 'dDOGE' }) }),
        );

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(0);
    });

    it('creates separate batches for separate asset pairs', async () => {
      const transactions = [
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'dGOOGL' }) }),
          outputAsset: createCustomAsset({ dexName: 'dGOOGL' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
          fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'dTSLA' }) }),
          outputAsset: createCustomAsset({ dexName: 'dTSLA' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
          fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'USDT' }) }),
          outputAsset: createCustomAsset({ dexName: 'USDT' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'USDT' }),
          fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
        }),
      ];

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      jest
        .spyOn(buyCryptoBatchRepo, 'create')
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 1, dexName: 'dGOOGL' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 2, dexName: 'dTSLA' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'USDT' }),
            outputAsset: createCustomAsset({ id: 3, dexName: 'USDT' }),
          }),
        );

      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(3);
    });

    it('groups transactions with same asset pair into one batch', async () => {
      const transactions = [
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'dTSLA' }) }),
          outputAsset: createCustomAsset({ dexName: 'dTSLA' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
          fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'dTSLA' }) }),
          outputAsset: createCustomAsset({ dexName: 'dTSLA' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
          fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'USDT' }) }),
          outputAsset: createCustomAsset({ dexName: 'USDT' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
          fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
        }),
      ];

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      jest
        .spyOn(buyCryptoBatchRepo, 'create')
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 1, dexName: 'dTSLA' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'USDT' }),
            outputAsset: createCustomAsset({ id: 2, dexName: 'USDT' }),
          }),
        );

      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(2);
    });
  });

  describe('risk-block reset — amlCheck audit trail', () => {
    it('records a RISK_BLOCK_RESET history row (previous verdict captured) for a risk-blocked tx', async () => {
      const entity = createCustomBuyCrypto({ id: 2, amlCheck: CheckStatus.PASS });
      entity.transaction.userData.riskStatus = RiskStatus.BLOCKED;

      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.batchAndOptimizeTransactions();

      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalledTimes(1);
      const [entityArg, entityType, source, previousAmlCheck] = (
        transactionAmlCheckService.createFromEntity as jest.Mock
      ).mock.calls[0];
      expect(entityArg).toEqual(expect.objectContaining({ id: 2 }));
      expect(entityType).toBe('BuyCrypto');
      expect(source).toBe(AmlSourceType.RISK_BLOCK_RESET);
      expect(previousAmlCheck).toBe(CheckStatus.PASS);
    });

    it('does not reactivate or audit a risk-blocked transaction that changed after the search', async () => {
      const entity = createCustomBuyCrypto({
        id: 2,
        amlCheck: CheckStatus.PASS,
        status: BuyCryptoStatus.MISSING_LIQUIDITY,
        version: 5,
      });
      entity.transaction.userData.riskStatus = RiskStatus.BLOCKED;
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

      await service.batchAndOptimizeTransactions();

      expect(buyCryptoRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, version: 5, status: BuyCryptoStatus.MISSING_LIQUIDITY }),
        expect.objectContaining({ status: BuyCryptoStatus.CREATED }),
      );
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });
  });

  describe('deferred transactions — liquidity covers only a part of the batch', () => {
    // batch of 150 reference (10 + 40 + 100) against 12 available: only the 10 fits, 40 and 100 are deferred.
    // Reference and target amounts are 1:1, so the deficit is readable directly: the kept sub-batch consumes
    // 10 of the 12 available, which leaves 2 for the deferred set of 140 (min 40).
    const deferredIds = [12, 13];
    const pipeline = { id: 77 } as LiquidityManagementPipeline;
    const outputAsset = createCustomAsset({ id: 42, dexName: 'dTSLA' });
    const outputReferenceAsset = createCustomAsset({ dexName: 'BTC' });

    function setupPartialLiquidity(status = BuyCryptoStatus.CREATED): void {
      const transactions = [
        createCustomBuyCrypto({ id: 11, outputReferenceAmount: 10, version: 5, status }),
        createCustomBuyCrypto({ id: 12, outputReferenceAmount: 40, version: 7, status }),
        createCustomBuyCrypto({ id: 13, outputReferenceAmount: 100, version: 9, status }),
      ].map((tx) =>
        Object.assign(tx, {
          outputAsset,
          outputReferenceAsset,
          fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
          // own userData per transaction: the buy-crypto mock shares one instance across all fixtures, and the
          // risk-block tests above set a risk status on it that would filter these transactions out of batching
          transaction: createCustomTransaction({ userData: createCustomUserData({ riskStatus: RiskStatus.NA }) }),
        }),
      );

      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue(transactions);
      jest.spyOn(buyCryptoBatchRepo, 'create').mockImplementation(() =>
        createCustomBuyCryptoBatch({
          id: undefined,
          created: undefined,
          transactions: [],
          outputReferenceAmount: undefined,
          outputAsset,
          outputReferenceAsset,
        }),
      );
      dexServiceCheckLiquidity.mockResolvedValue({
        purchaseFee: { amount: 0, asset: outputAsset },
        reference: { availableAmount: 12, maxPurchasableAmount: 1000000 },
        target: { amount: 150, availableAmount: 12, maxPurchasableAmount: 1000000 },
      } as unknown as CheckLiquidityResult);
      jest.spyOn(liquidityManagementService, 'buyLiquidity').mockResolvedValue(pipeline);
    }

    function savedBatchTransactionIds(): number[] {
      const [, savedBatch] = (buyCryptoBatchRepo.manager.save as jest.Mock).mock.calls[0];
      return (savedBatch as BuyCryptoBatch).transactions.map((t) => t.id);
    }

    // the logger is a prototype spy and would outlive the test, so it is restored in afterEach
    let loggerInfoSpy: jest.SpyInstance;

    function captureInfoLogs(): () => string[] {
      loggerInfoSpy = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation(() => undefined);
      return () => loggerInfoSpy.mock.calls.map(([message]) => message as string);
    }

    afterEach(() => loggerInfoSpy?.mockRestore());

    it('sets MissingLiquidity on every deferred transaction, guarded by its version', async () => {
      setupPartialLiquidity();

      await service.batchAndOptimizeTransactions();

      expect(buyCryptoRepo.update).toHaveBeenCalledTimes(2);
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(
        { id: 12, version: 7, amlCheck: CheckStatus.PASS, status: BuyCryptoStatus.CREATED },
        expect.objectContaining({ status: BuyCryptoStatus.MISSING_LIQUIDITY }),
      );
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(
        { id: 13, version: 9, amlCheck: CheckStatus.PASS, status: BuyCryptoStatus.CREATED },
        expect.objectContaining({ status: BuyCryptoStatus.MISSING_LIQUIDITY }),
      );
    });

    it('orders the deficit of the deferred set against the liquidity left after the kept sub-batch', async () => {
      setupPartialLiquidity();

      await service.batchAndOptimizeTransactions();

      // min 40 - 2 residual, total 140 - 2 residual — not the whole batch (150 - 12) and not the smallest
      // transaction of the whole batch (10)
      expect(liquidityManagementService.buyLiquidity).toHaveBeenCalledWith(outputAsset.id, 38, 138, true);
    });

    it('assigns the liquidity pipeline to the deferred transactions only', async () => {
      setupPartialLiquidity();

      await service.batchAndOptimizeTransactions();

      expect(buyCryptoRepoManager.update).toHaveBeenCalledTimes(1);
      const [entityType, criteria, update] = buyCryptoRepoManager.update.mock.calls[0];
      expect(entityType).toBe(BuyCrypto);
      expect(criteria.id.value).toEqual(deferredIds);
      expect(criteria.status).toBe(BuyCryptoStatus.MISSING_LIQUIDITY);
      expect(update).toEqual({ liquidityPipeline: pipeline });
    });

    it('saves the affordable sub-batch in the same cycle in which it defers the rest', async () => {
      setupPartialLiquidity();

      await service.batchAndOptimizeTransactions();

      expect(buyCryptoBatchRepo.manager.save).toHaveBeenCalledTimes(1);
      expect(savedBatchTransactionIds()).toEqual([11]);
      // deferring must not hold up the sub-batch, and the sub-batch must not swallow the deferred transactions
      expect(buyCryptoRepoManager.update).toHaveBeenCalledTimes(1);
      expect(buyCryptoRepoManager.update.mock.calls[0][1].id.value).toEqual(deferredIds);
    });

    it('keeps the sub-batch and reports the deferred ids when the liquidity order fails', async () => {
      setupPartialLiquidity();
      jest.spyOn(liquidityManagementService, 'buyLiquidity').mockRejectedValue(new Error('Rule not found'));

      await service.batchAndOptimizeTransactions();

      expect(buyCryptoNotificationService.sendMissingLiquidityError).toHaveBeenCalledTimes(1);
      const [dexName, blockchain, type, txIds, messages] = (
        buyCryptoNotificationService.sendMissingLiquidityError as jest.Mock
      ).mock.calls[0];
      expect(dexName).toBe(outputAsset.dexName);
      expect(blockchain).toBe(outputAsset.blockchain);
      expect(type).toBe(outputAsset.type);
      expect(txIds).toEqual(deferredIds);
      expect((messages as string[]).join(' ')).toContain('Rule not found');

      expect(buyCryptoBatchRepo.manager.save).toHaveBeenCalledTimes(1);
      expect(savedBatchTransactionIds()).toEqual([11]);
    });

    it('reports the amounts of the deferred order, not those of the whole batch, when the order fails', async () => {
      setupPartialLiquidity();
      jest.spyOn(liquidityManagementService, 'buyLiquidity').mockRejectedValue(new Error('Rule not found'));

      await service.batchAndOptimizeTransactions();

      const [, , , , messages] = (buyCryptoNotificationService.sendMissingLiquidityError as jest.Mock).mock
        .calls[0] as [string, string, string, number[], string[]];
      const [, targetLine, referenceLine] = messages;

      // one order, one set of numbers: the deferred set needs 140, 2 are left after the kept sub-batch, so the
      // ordered deficit is 138 on both sides. The whole-batch availability of 12 belongs to a demand this order
      // does not carry, and would make the line read 140 - 12 next to an order placed for 138
      const [, orderedMinAmount, orderedAmount] = (liquidityManagementService.buyLiquidity as jest.Mock).mock
        .calls[0] as [number, number, number, boolean];
      expect([orderedMinAmount, orderedAmount]).toEqual([38, 138]);

      expect(targetLine).toMatch(/^Target: 138 .* \(required 140, available: 2, purchasable: 1000000\)$/);
      expect(referenceLine).toMatch(/^Reference: 138 .* \(required 140, available: 2, purchasable: 1000000\)$/);
    });

    it('sends no notification when the liquidity rule is already processing', async () => {
      setupPartialLiquidity();
      jest
        .spyOn(liquidityManagementService, 'buyLiquidity')
        .mockRejectedValue(new ConflictException(`Rule 1 is ${LiquidityManagementRuleStatus.PROCESSING}`));

      await service.batchAndOptimizeTransactions();

      // the deferred set is still put into MissingLiquidity and the order is still attempted — only the mail
      // is suppressed, because a rule already running is the throttle, not a failure
      expect(buyCryptoRepo.update).toHaveBeenCalledTimes(2);
      expect(liquidityManagementService.buyLiquidity).toHaveBeenCalledTimes(1);
      expect(buyCryptoNotificationService.sendMissingLiquidityError).not.toHaveBeenCalled();
      expect(savedBatchTransactionIds()).toEqual([11]);
    });

    it('sends no notification while the rule is paused after a failed pipeline', async () => {
      setupPartialLiquidity();
      jest
        .spyOn(liquidityManagementService, 'buyLiquidity')
        .mockRejectedValue(
          new ConflictException(
            `Pipeline for rule 1 cannot be started (status ${LiquidityManagementRuleStatus.PAUSED})`,
          ),
        );

      await service.batchAndOptimizeTransactions();

      // Paused is the state every failed pipeline leaves behind, and it lasts for the whole reactivation
      // window. The deferred path re-orders for its set on every cycle, so a mail here is a mail per minute
      expect(buyCryptoNotificationService.sendMissingLiquidityError).not.toHaveBeenCalled();
      expect(savedBatchTransactionIds()).toEqual([11]);
    });

    it('names the deferred set in the log when the claim for the liquidity order is lost', async () => {
      setupPartialLiquidity();
      buyCryptoRepoManager.findOne.mockResolvedValue(null);
      const infoLogs = captureInfoLogs();

      await service.batchAndOptimizeTransactions();

      // no order, no pipeline, no mail — so the log is the only trace this path leaves
      expect(liquidityManagementService.buyLiquidity).not.toHaveBeenCalled();
      expect(buyCryptoNotificationService.sendMissingLiquidityError).not.toHaveBeenCalled();
      expect(infoLogs()).toContainEqual(
        expect.stringContaining(`transaction 12 changed before it could be claimed. Transaction ID(s): 12,13`),
      );
    });

    it('names the transaction that lost the version race, and keeps the sub-batch', async () => {
      setupPartialLiquidity();
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      const infoLogs = captureInfoLogs();

      await service.batchAndOptimizeTransactions();

      // one lost race abandons the whole set for this cycle, which self-heals on the next one — but the ids
      // have to say so, otherwise the deferred set is invisible again for exactly one cycle
      expect(liquidityManagementService.buyLiquidity).not.toHaveBeenCalled();
      expect(infoLogs()).toContainEqual(
        expect.stringContaining(`transaction 12 changed before its status could be set. Transaction ID(s): 12,13`),
      );
      expect(savedBatchTransactionIds()).toEqual([11]);
    });

    it('does not rewrite the status of a transaction that is already in MissingLiquidity', async () => {
      setupPartialLiquidity(BuyCryptoStatus.MISSING_LIQUIDITY);

      await service.batchAndOptimizeTransactions();

      expect(buyCryptoRepo.update).not.toHaveBeenCalled();
      // the deficit is still ordered for the same set
      expect(liquidityManagementService.buyLiquidity).toHaveBeenCalledWith(outputAsset.id, 38, 138, true);
    });
  });

  // --- HELPER FUNCTIONS --- //

  async function setupMocks() {
    buyCryptoRepo = mock<BuyCryptoRepository>();
    buyCryptoBatchRepo = mock<BuyCryptoBatchRepository>();
    pricingService = mock<PricingService>();
    buyCryptoPricingService = mock<BuyCryptoPricingService>();
    assetService = mock<AssetService>();
    fiatService = mock<FiatService>();
    dexService = mock<DexService>();
    payoutService = mock<PayoutService>();
    buyCryptoNotificationService = mock<BuyCryptoNotificationService>();
    liquidityManagementService = mock<LiquidityManagementService>();
    feeService = mock<FeeService>();
    transactionAmlCheckService = mock<TransactionAmlCheckService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuyCryptoBatchService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: BuyCryptoBatchRepository, useValue: buyCryptoBatchRepo },
        { provide: PricingService, useValue: pricingService },
        { provide: BuyCryptoPricingService, useValue: buyCryptoPricingService },
        { provide: AssetService, useValue: assetService },
        { provide: FiatService, useValue: fiatService },
        { provide: DexService, useValue: dexService },
        { provide: PayoutService, useValue: payoutService },
        { provide: BuyCryptoNotificationService, useValue: buyCryptoNotificationService },
        { provide: LiquidityManagementService, useValue: liquidityManagementService },
        { provide: FeeService, useValue: feeService },
        { provide: TransactionAmlCheckService, useValue: transactionAmlCheckService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BuyCryptoBatchService>(BuyCryptoBatchService);
  }

  function setupSpies() {
    jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => [createDefaultBuyCrypto()]);

    jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    jest.spyOn(buyCryptoBatchRepo, 'findOneBy').mockImplementation(async () => null);

    jest.spyOn(buyCryptoBatchRepo, 'create').mockImplementation(() => createCustomBuyCryptoBatch({ id: undefined }));

    jest.spyOn(buyCryptoBatchRepo, 'save').mockImplementation(async (e) => e as BuyCryptoBatch);
    const manager = {
      findOne: jest.fn().mockResolvedValue({ id: 1 }),
      save: jest.fn(async (_type: unknown, entity: unknown) => entity),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    Object.defineProperty(buyCryptoBatchRepo, 'manager', {
      configurable: true,
      value: {
        ...manager,
        transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
          run(manager as unknown as EntityManager),
        ),
      },
    });

    // the liquidity pipeline is claimed and assigned through the buyCrypto repo manager; affected mirrors the
    // number of ids the update is scoped to, so a pipeline assignment for the wrong set fails the same way as
    // it would in the database
    buyCryptoRepoManager = {
      findOne: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn(async (_type: unknown, criteria: { id: { value: number[] } }) => ({
        affected: criteria.id.value.length,
      })),
    };
    Object.defineProperty(buyCryptoRepo, 'manager', {
      configurable: true,
      value: {
        ...buyCryptoRepoManager,
        transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
          run(buyCryptoRepoManager as unknown as EntityManager),
        ),
      },
    });

    exchangeUtilityServiceGetMatchingPrice = jest
      .spyOn(pricingService, 'getPrice')
      .mockImplementationOnce(async () => {
        const price = new Price();
        price.price = 10;
        price.source = 'EUR';
        price.target = 'BTC';
        return price;
      })
      .mockImplementationOnce(async () => {
        const price = new Price();
        price.price = 10;
        price.source = 'EUR';
        price.target = 'USDT';
        return price;
      });

    jest.spyOn(buyCryptoPricingService, 'getFeeAmountInRefAsset').mockImplementation(async () => 0.001);

    dexServiceCheckLiquidity = jest.spyOn(dexService, 'checkLiquidity').mockImplementation(
      async () =>
        ({
          purchaseFee: { amount: 0, asset: createDefaultAsset() },
          reference: { availableAmount: 10000, maxPurchasableAmount: 1000000 },
        }) as unknown as CheckLiquidityResult,
    );

    jest.spyOn(payoutService, 'estimateFee').mockImplementation(async () => ({
      asset: createCustomAsset({}),
      amount: 0.0000001,
    }));

    jest.spyOn(assetService, 'getAssetByQuery').mockImplementation(async () => createDefaultAsset());
  }
});
