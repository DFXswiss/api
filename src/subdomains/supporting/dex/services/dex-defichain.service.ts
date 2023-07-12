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
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { TransactionNotFoundException } from '../exceptions/transaction-not-found.exception';
import { LiquidityResult } from '../interfaces';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { CheckLiquidityUtil } from '../strategies/check-liquidity/utils/check-liquidity.util';

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
  ): Promise<LiquidityResult> {
    // get amounts
    const targetAmount = await this.getTargetAmount(sourceAsset, sourceAmount, targetAsset);
    const availableAmount = await this.getAssetAvailability(targetAsset);
    const maxPurchasableAmount = await this.getMaxPurchasableAmount(purchaseAssets, targetAsset);

    // slippage check
    const price = await this.calculatePrice(sourceAsset, targetAsset);
    const [isSlippageDetected, slippageMessage] = CheckLiquidityUtil.checkSlippage(
      price,
      maxSlippage,
      sourceAmount,
      targetAmount,
      sourceAsset,
      targetAsset,
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

  async swap(swapAsset: Asset, swapAmount: number, targetAsset: Asset, maxSlippage: number): Promise<ChainSwapId> {
    const price = await this.calculatePrice(swapAsset, targetAsset);
    const maxPrice = CheckLiquidityUtil.getMaxPrice(price, maxSlippage);

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
      if (e.message?.includes('Price is higher than indicated')) {
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

  async getSwapResult(txId: string, asset: Asset): Promise<{ targetAmount: number; feeAmount: number }> {
    const historyEntry = await this.deFiChainUtil.getHistoryEntryForTx(txId, this.#dexClient);
    if (!historyEntry) throw new TransactionNotFoundException(`Transaction ${txId} not found on blockchain`);

    const amounts = historyEntry.amounts.map((a) => this.#dexClient.parseAmount(a));

    const { amount: targetAmount } = amounts.find((a) => a.asset === asset.dexName);

    if (!targetAmount) {
      throw new Error(`Failed to get amount for TX: ${txId} while trying to extract purchased liquidity`);
    }

    return { targetAmount, feeAmount: historyEntry.fee };
  }

  async getTargetAmount(sourceAsset: Asset, sourceAmount: number, targetAsset: Asset): Promise<number> {
    return targetAsset.id === sourceAsset.id ? sourceAmount : this.testSwap(sourceAsset, targetAsset, sourceAmount);
  }

  async getAssetAvailability(asset: Asset): Promise<number> {
    const pendingAmount = await this.getPendingAmount(asset);
    const availableAmount = await this.deFiChainUtil.getAvailableTokenAmount(asset.dexName, this.#dexClient);

    // adding a small cap to pendingAmount in case testSwap results got slightly outdated by the moment current check is done
    return Util.round(availableAmount - pendingAmount * 1.05, 8);
  }

  async getRecentHistory(depth: number): Promise<AccountHistory[]> {
    return this.#dexClient.getRecentHistory(depth, Config.blockchain.default.dex.address);
  }

  parseAmounts(amounts: string[]): { asset: string; amount: number }[] {
    return amounts.map((a) => this.getClient().parseAmount(a));
  }

  async calculatePrice(sourceAsset: Asset, targetAsset: Asset): Promise<number> {
    const sourceAmount = sourceAsset.minimalPriceReferenceAmount;
    const targetAmount = await this.getTargetAmount(sourceAsset, sourceAmount, targetAsset);

    // how much of sourceAsset you going to pay for 1 unit of targetAsset, caution - only indicative calculation
    return sourceAmount / targetAmount;
  }

  //*** GETTERS ***//

  get dexWalletAddress(): string {
    return Config.blockchain.default.dex.address;
  }

  // *** HELPER METHODS *** //

  protected getClient(): DeFiClient {
    return this.#dexClient;
  }

  private async getPendingAmount(asset: Asset) {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: asset.dexName, blockchain: Blockchain.DEFICHAIN },
    });

    return Util.sumObj<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }

  private async testSwap(sourceAsset: Asset, targetAsset: Asset, amount: number): Promise<number> {
    if (sourceAsset.category !== targetAsset.category) {
      const intermediateAsset = targetAsset.category === AssetCategory.CRYPTO ? 'DFI' : 'DUSD';

      const dfiAmount = await this.#dexClient.testCompositeSwap(sourceAsset.dexName, intermediateAsset, amount);
      return this.#dexClient.testCompositeSwap(intermediateAsset, targetAsset.dexName, dfiAmount);
    } else {
      return this.#dexClient.testCompositeSwap(sourceAsset.dexName, targetAsset.dexName, amount);
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

      return await this.getTargetAmount(swapAsset, availableAmount, targetAsset);
    } catch (e) {
      this.logger.warn(`Could not find purchasable amount for swap ${swapAsset.dexName} -> ${targetAsset.dexName}:`, e);

      return 0;
    }
  }
}
