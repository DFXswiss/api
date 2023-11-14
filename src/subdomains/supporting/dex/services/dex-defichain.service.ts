import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { DeFiChainUtil } from 'src/integration/blockchain/ain/utils/defichain.util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { ChainSwapId, LiquidityOrder } from '../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { TransactionNotFoundException } from '../exceptions/transaction-not-found.exception';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

export interface DexDeFiChainLiquidityResult {
  targetAmount: number;
  availableAmount: number;
  maxPurchasableAmount: number;
  isSlippageDetected: boolean;
  slippageMessage: string;
  feeAmount: number;
}

@Injectable()
export class DexDeFiChainService {
  private readonly logger = new DfxLogger(DexDeFiChainService);

  #dexClient: DeFiClient;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly deFiChainUtil: DeFiChainUtil,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.#dexClient = client));
  }

  // *** PUBLIC API *** //

  async getAndCheckAvailableTargetLiquidity(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    maxSlippage: number,
    purchaseAssets: Asset[],
  ): Promise<DexDeFiChainLiquidityResult> {
    const targetAmount = await this.getTargetAmount(sourceAsset, sourceAmount, targetAsset);

    const availableAmount = await this.getAssetAvailability(targetAsset);
    const maxPurchasableAmount = await this.getMaxPurchasableAmount(purchaseAssets, targetAsset);
    const [isSlippageDetected, slippageMessage] = await this.checkTestSwapPriceSlippage(
      sourceAsset,
      sourceAmount,
      targetAsset,
      targetAmount,
      maxSlippage,
    );

    return {
      targetAmount,
      availableAmount: availableAmount,
      maxPurchasableAmount,
      isSlippageDetected,
      slippageMessage,
      feeAmount: 0,
    };
  }

  async swapLiquidity(
    swapAsset: Asset,
    swapAmount: number,
    targetAsset: Asset,
    maxSlippage: number,
  ): Promise<ChainSwapId> {
    const maxPrice = await this.getMaxPriceForPurchaseLiquidity(swapAsset, targetAsset, maxSlippage);

    try {
      return await this.#dexClient.compositeSwap(
        Config.blockchain.default.dex.address,
        swapAsset.dexName,
        Config.blockchain.default.dex.address,
        targetAsset.dexName,
        swapAmount,
        [],
        maxPrice,
      );
    } catch (e) {
      if (this.isCompositeSwapSlippageError(e)) {
        throw new PriceSlippageException(
          `Price is higher than indicated. Composite swap ${swapAmount} ${swapAsset.dexName} to ${targetAsset.dexName}. Maximum price for asset ${targetAsset.dexName} is ${maxPrice} ${swapAsset.dexName}.`,
        );
      }

      throw e;
    }
  }

  async sellDfiCoin(amount: number): Promise<string> {
    return this.#dexClient.toToken(Config.blockchain.default.dex.address, amount);
  }

  async addPoolLiquidity(poolPair: [string, string]): Promise<string> {
    return this.#dexClient.addPoolLiquidity(Config.blockchain.default.dex.address, poolPair);
  }

  async transferLiquidity(addressTo: string, asset: string, amount: number): Promise<string> {
    return this.#dexClient.sendToken(this.dexWalletAddress, addressTo, asset, amount);
  }

  async transferMinimalUtxo(address: string): Promise<string> {
    return this.#dexClient.sendToken(
      Config.blockchain.default.dex.address,
      address,
      'DFI',
      Config.payIn.minDeposit.DeFiChain.DFI / 2,
    );
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    const transaction = await this.#dexClient.getTx(transferTxId);

    return transaction && transaction.blockhash && transaction.confirmations > 0;
  }

  async getSwapAmount(txId: string, asset: string): Promise<number> {
    const historyEntry = await this.deFiChainUtil.getHistoryEntryForTx(txId, this.#dexClient);
    if (!historyEntry) throw new TransactionNotFoundException(`Transaction ${txId} not found on blockchain`);

    const amounts = historyEntry.amounts.map((a) => this.#dexClient.parseAmount(a));

    const { amount: purchasedAmount } = amounts.find((a) => a.asset === asset);

    if (!purchasedAmount) {
      throw new Error(`Failed to get amount for TX: ${txId} while trying to extract purchased liquidity`);
    }

    return purchasedAmount;
  }

  async getSwapAmountForPurchase(
    referenceAsset: Asset,
    referenceAmount: number,
    targetAsset: Asset,
    swapAsset: Asset,
  ): Promise<number> {
    const swapAmount = await this.calculateSwapAmountForPurchase(
      referenceAsset,
      referenceAmount,
      swapAsset,
      targetAsset,
    );

    await this.checkAssetAvailability(swapAsset, swapAmount);

    return swapAmount;
  }

  async calculateSwapAmountForPurchase(
    referenceAsset: Asset,
    referenceAmount: number,
    swapAsset: Asset,
    targetAsset?: Asset,
  ): Promise<number> {
    if (referenceAsset.id === targetAsset?.id) {
      const swapAssetPrice = await this.calculatePrice(swapAsset, referenceAsset);

      const swapAmount = referenceAmount * swapAssetPrice;

      // adding 5% cap to liquidity swap to cover meantime referenceAmount price difference (initially taken from Kraken/Binance)
      return Util.round(swapAmount + swapAmount * 0.05, 8);
    }

    return this.testSwap(referenceAsset, swapAsset, referenceAmount);
  }

  async getAssetAvailability(asset: Asset): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.findBy({ isComplete: false })).filter(
      (o) => o.targetAsset.dexName === asset.dexName && o.targetAsset.blockchain === Blockchain.DEFICHAIN,
    );
    const pendingAmount = Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
    const availableAmount = await this.deFiChainUtil.getAvailableTokenAmount(asset.dexName, this.#dexClient);

    // adding a small cap to pendingAmount in case testSwap results got slightly outdated by the moment current check is done
    return Util.round(availableAmount - pendingAmount * 1.05, 8);
  }

  async testSwap(sourceAsset: Asset, targetAsset: Asset, amount: number): Promise<number> {
    if (sourceAsset.category !== targetAsset.category) {
      const intermediateAsset = targetAsset.category === AssetCategory.CRYPTO ? 'DFI' : 'DUSD';

      const dfiAmount = await this.#dexClient.testCompositeSwap(sourceAsset.dexName, intermediateAsset, amount);
      return this.#dexClient.testCompositeSwap(intermediateAsset, targetAsset.dexName, dfiAmount);
    } else {
      return this.#dexClient.testCompositeSwap(sourceAsset.dexName, targetAsset.dexName, amount);
    }
  }

  async getRecentHistory(depth: number): Promise<AccountHistory[]> {
    return this.#dexClient.getRecentHistory(depth, Config.blockchain.default.dex.address);
  }

  parseAmounts(amounts: string[]): { asset: string; amount: number }[] {
    return amounts.map((a) => this.getClient().parseAmount(a));
  }

  //*** GETTERS ***//

  get dexWalletAddress(): string {
    return Config.blockchain.default.dex.address;
  }

  // *** HELPER METHODS *** //

  protected getClient(): DeFiClient {
    return this.#dexClient;
  }

  private async getTargetAmount(sourceAsset: Asset, sourceAmount: number, targetAsset: Asset): Promise<number> {
    return targetAsset.id === sourceAsset.id ? sourceAmount : this.testSwap(sourceAsset, targetAsset, sourceAmount);
  }

  private async checkAssetAvailability(asset: Asset, requiredAmount: number): Promise<void> {
    const availableAmount = await this.getAssetAvailability(asset);

    if (requiredAmount > availableAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${asset.dexName}. Trying to use ${requiredAmount} ${asset.dexName} worth liquidity. Available amount: ${availableAmount}.`,
      );
    }
  }

  private async getMaxPurchasableAmount(swapAssets: Asset[], targetAsset: Asset): Promise<number> {
    let maxPurchasableAmount = 0;

    for (const swapAsset of swapAssets) {
      const purchasableAmount = await this.getPurchasableAmount(swapAsset, targetAsset);
      maxPurchasableAmount = purchasableAmount > maxPurchasableAmount ? purchasableAmount : maxPurchasableAmount;
    }

    return maxPurchasableAmount;
  }

  private async getPurchasableAmount(swapAsset: Asset, targetAsset: Asset): Promise<number> {
    try {
      const availableAmount = await this.getAssetAvailability(swapAsset);
      if (availableAmount === 0) return 0;

      return await this.testSwap(swapAsset, targetAsset, availableAmount);
    } catch (e) {
      this.logger.warn(`Could not find purchasable amount for swap ${swapAsset.dexName} -> ${targetAsset.dexName}:`, e);

      return 0;
    }
  }

  private async checkTestSwapPriceSlippage(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    targetAmount: number,
    maxSlippage: number,
  ): Promise<[boolean, string]> {
    // how much sourceAsset we are willing to pay for 1 unit of targetAsset max
    const maxPrice = await this.getMaxPriceForPurchaseLiquidity(sourceAsset, targetAsset, maxSlippage);

    const minimalAllowedTargetAmount = Util.round(sourceAmount / maxPrice, 8);

    const isSlippageDetected = targetAmount > 0.000001 && targetAmount < minimalAllowedTargetAmount;
    const slippageMessage = isSlippageDetected
      ? this.generateSlippageMessage(sourceAsset, sourceAmount, targetAsset, targetAmount, maxPrice)
      : 'no slippage detected';

    return [isSlippageDetected, slippageMessage];
  }

  private generateSlippageMessage(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    targetAmount: number,
    maxPrice: number,
  ): string {
    const actualPrice = Util.round(sourceAmount / targetAmount, 8);

    return `Price is higher than indicated. Test swap ${sourceAmount} ${sourceAsset.dexName} to ${targetAmount} ${targetAsset.dexName}. Maximum price for asset ${targetAsset.dexName} is ${maxPrice} ${sourceAsset.dexName}. Actual price is ${actualPrice} ${sourceAsset.dexName}`;
  }

  private async getMaxPriceForPurchaseLiquidity(
    sourceAsset: Asset,
    targetAsset: Asset,
    maxSlippage: number,
  ): Promise<number> {
    // how much of sourceAsset you get for 1 unit of targetAsset
    const targetAssetPrice = await this.calculatePrice(sourceAsset, targetAsset);

    return Util.round(targetAssetPrice * (1 + maxSlippage), 8);
  }

  private async calculatePrice(sourceAsset: Asset, targetAsset: Asset): Promise<number> {
    // how much of sourceAsset you going to pay for 1 unit of targetAsset, caution - only indicative calculation
    return (
      1 /
      ((await this.testSwap(sourceAsset, targetAsset, this.getMinimalPriceReferenceAmount(sourceAsset.dexName))) /
        this.getMinimalPriceReferenceAmount(sourceAsset.dexName))
    );
  }

  private isCompositeSwapSlippageError(e: Error): boolean {
    return e.message && e.message.includes('Price is higher than indicated');
  }

  private getMinimalPriceReferenceAmount(sourceAsset: string): number {
    return sourceAsset === 'BTC' ? 0.001 : 1;
  }
}
