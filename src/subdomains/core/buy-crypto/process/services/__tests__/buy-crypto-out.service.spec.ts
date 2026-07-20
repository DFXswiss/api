import { mock } from 'jest-mock-extended';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { CustodyOrderService } from 'src/subdomains/core/custody/services/custody-order.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PayoutOrderContext } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { createCustomBuyCryptoBatch } from '../../entities/__mocks__/buy-crypto-batch.entity.mock';
import { createCustomBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCrypto } from '../../entities/buy-crypto.entity';
import { BuyCryptoBatchRepository } from '../../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoOutService } from '../buy-crypto-out.service';
import { BuyCryptoPricingService } from '../buy-crypto-pricing.service';
import { BuyCryptoWebhookService } from '../buy-crypto-webhook.service';

/**
 * Wiring guard for BuyCryptoOutService.checkCompletion (§2.3 native-first exactness, #4287 stage 4): the EXACT
 * on-chain base units the payout order broadcast (a decimal STRING from PayoutService.checkOrderCompletion) must be
 * propagated verbatim as a bigint into the buy-crypto — for the delivered output (into complete(), :239) and for the
 * network-start fee (tx.networkStartAmountBaseUnits, :246-258) — with a fail-open null when the chain/row did not
 * capture it. These base-unit magnitudes exceed 2^53 and carry >8 fractional digits, so a float/≤8-dp path would lose
 * them; the test fails the moment either propagation is dropped.
 */
describe('BuyCryptoOutService - base-unit exactness wiring (#4287)', () => {
  let service: BuyCryptoOutService;

  let buyCryptoRepo: BuyCryptoRepository;
  let payoutService: PayoutService;
  let buyCryptoPricingService: BuyCryptoPricingService;
  let custodyOrderService: CustodyOrderService;

  // exact on-chain integers that no ≤8-dp float path could round-trip (both > Number.MAX_SAFE_INTEGER)
  const outputWei = 12345678901234567890n; // delivered output base units
  const networkStartWei = 987654321098765432n; // network-start fee base units

  beforeEach(() => {
    buyCryptoRepo = mock<BuyCryptoRepository>();
    payoutService = mock<PayoutService>();
    buyCryptoPricingService = mock<BuyCryptoPricingService>();
    custodyOrderService = mock<CustodyOrderService>();

    jest.spyOn(buyCryptoPricingService, 'getFeeAmountInRefAsset').mockResolvedValue(0.001);
    jest.spyOn(custodyOrderService, 'getCustodyOrderByTx').mockResolvedValue(null);

    service = new BuyCryptoOutService(
      buyCryptoRepo,
      mock<BuyCryptoBatchRepository>(),
      buyCryptoPricingService,
      mock<DexService>(),
      payoutService,
      mock<BuyCryptoWebhookService>(),
      mock<SiftService>(),
      mock<AssetService>(),
      mock<PricingService>(),
      mock<FiatService>(),
      custodyOrderService,
      mock<FeeService>(),
      mock<TransactionService>(),
      mock<TransactionAmlCheckService>(),
    );
  });

  function createTx(): BuyCrypto {
    // user/userData resolve through the default transaction mock (non-blocked defaults) and are getter-only on the
    // entity, so they are not overridden here.
    return createCustomBuyCrypto({
      id: 42,
      isComplete: false,
      txId: 'PAYOUT_TX',
      networkStartFeeAmount: 0.0001, // truthy -> exercises the network-start branch
    });
  }

  async function runCheckCompletion(tx: BuyCrypto): Promise<void> {
    const batch = createCustomBuyCryptoBatch({ id: 7, transactions: [tx] });
    await (service as any).checkCompletion(batch);
  }

  it('propagates the exact output + network-start base units verbatim (no ≤8-dp loss)', async () => {
    jest
      .spyOn(payoutService, 'checkOrderCompletion')
      .mockResolvedValueOnce({
        isComplete: true,
        payoutTxId: 'PAYOUT_TX',
        payoutFee: {} as any,
        payoutAmount: 1.5,
        payoutAsset: { name: 'ETH' } as any,
        payoutAmountBaseUnits: outputWei.toString(),
      } as any)
      .mockResolvedValueOnce({
        isComplete: true,
        payoutTxId: 'NETWORK_START_TX',
        payoutFee: {} as any,
        payoutAmount: 0.0001,
        payoutAsset: { name: 'ETH' } as any,
        payoutAmountBaseUnits: networkStartWei.toString(),
      } as any);

    const tx = createTx();
    await runCheckCompletion(tx);

    // delivered output base units captured verbatim through complete() (:239)
    expect(tx.outputAmountBaseUnits).toBe(outputWei);
    // network-start fee base units captured verbatim (:246-258)
    expect(tx.networkStartAmountBaseUnits).toBe(networkStartWei);
    expect(tx.networkStartTxId).toBe('NETWORK_START_TX');

    expect(payoutService.checkOrderCompletion).toHaveBeenNthCalledWith(1, PayoutOrderContext.BUY_CRYPTO, '42');
    expect(payoutService.checkOrderCompletion).toHaveBeenNthCalledWith(
      2,
      PayoutOrderContext.BUY_CRYPTO,
      '42-network-start-fee',
    );
  });

  it('fails open to null when the payout order did not capture base units', async () => {
    jest
      .spyOn(payoutService, 'checkOrderCompletion')
      .mockResolvedValueOnce({
        isComplete: true,
        payoutTxId: 'PAYOUT_TX',
        payoutFee: {} as any,
        payoutAmount: 1.5,
        payoutAsset: { name: 'ETH' } as any,
        payoutAmountBaseUnits: null,
      } as any)
      .mockResolvedValueOnce({
        isComplete: true,
        payoutTxId: 'NETWORK_START_TX',
        payoutFee: {} as any,
        payoutAmount: 0.0001,
        payoutAsset: { name: 'ETH' } as any,
        payoutAmountBaseUnits: null,
      } as any);

    const tx = createTx();
    await runCheckCompletion(tx);

    expect(tx.outputAmountBaseUnits).toBeNull();
    expect(tx.networkStartAmountBaseUnits).toBeNull();
  });
});
