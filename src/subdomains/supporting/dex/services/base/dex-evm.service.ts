import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { PriceSlippageException } from '../../exceptions/price-slippage.exception';
import { LiquidityResult } from '../../interfaces';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { CheckLiquidityUtil } from '../../strategies/check-liquidity/utils/check-liquidity.util';

export abstract class DexEvmService {
  private readonly logger = new DfxLogger(DexEvmService);

  #client: EvmClient;

  constructor(
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly service: EvmService,
    protected readonly blockchain: Blockchain,
  ) {
    this.#client = service.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.#client.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, tokenName: Asset, amount: number): Promise<string> {
    return this.#client.sendTokenFromDex(address, tokenName, amount);
  }

  async checkTransactionCompletion(txHash: string): Promise<boolean> {
    return this.#client.isTxComplete(txHash);
  }

  async getAndCheckAvailableTargetLiquidity(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    maxSlippage: number,
    purchaseAssets: Asset[],
  ): Promise<LiquidityResult> {
    // amounts
    const { targetAmount, feeAmount } = await this.#client.testSwap(
      sourceAsset,
      sourceAmount,
      targetAsset,
      maxSlippage,
    );
    const availableAmount = await this.getAssetAvailability(targetAsset);
    const maxPurchasableAmount = await this.getMaxPurchasableAmount(purchaseAssets, targetAsset, maxSlippage);

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
      feeAmount,
    };
  }

  async getDexHistory(): Promise<[EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]]> {
    const address = this.#client.dfxAddress;
    const currentBlock = await this.#client.getCurrentBlock();
    const startBlock = Util.round(currentBlock - 100, 0);
    const allCoinTransactions = await this.#client.getNativeCoinTransactions(address, startBlock);
    const allTokenTransactions = await this.#client.getERC20Transactions(address, startBlock);

    return [allCoinTransactions, allTokenTransactions];
  }

  async fromWeiAmount(amountWeiLike: string, asset: Asset): Promise<number> {
    const token = await this.#client.getToken(asset);
    return this.#client.fromWeiAmount(amountWeiLike, token.decimals);
  }

  async calculatePrice(sourceAsset: Asset, targetAsset: Asset): Promise<number> {
    const sourceAmount = sourceAsset.minimalPriceReferenceAmount;
    const targetAmount = await this.getTargetAmount(sourceAsset, sourceAmount, targetAsset);

    // how much of sourceAsset you going to pay for 1 unit of targetAsset, caution - only indicative calculation
    return sourceAmount / targetAmount;
  }

  async getTargetAmount(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    maxSlippage = 0.2,
  ): Promise<number> {
    if (sourceAsset.id === targetAsset.id) return sourceAmount;

    return this.#client.testSwap(sourceAsset, sourceAmount, targetAsset, maxSlippage).then((r) => r.targetAmount);
  }

  async getAssetAvailability(asset: Asset): Promise<number> {
    const pendingAmount = await this.getPendingAmount(asset);
    const availableAmount =
      asset.type === AssetType.COIN
        ? await this.#client.getNativeCoinBalance()
        : await this.#client.getTokenBalance(asset);

    // adding a small cap to pendingAmount in case testSwap results got slightly outdated by the moment current check is done
    return availableAmount - pendingAmount * 1.05;
  }

  async swap(swapAsset: Asset, swapAmount: number, targetAsset: Asset, maxSlippage: number): Promise<string> {
    try {
      return await this.#client.swap(swapAsset, swapAmount, targetAsset, maxSlippage);
    } catch (e) {
      if (e.error?.reason?.includes('Too little received')) {
        throw new PriceSlippageException(
          `Price is higher than indicated. Composite swap ${swapAmount} ${swapAsset.dexName} to ${targetAsset.dexName}.`,
        );
      }

      throw e;
    }
  }

  async getSwapResult(txId: string, asset: Asset): Promise<{ targetAmount: number; feeAmount: number }> {
    const receipt = await this.#client.getTxReceipt(txId);

    const swapLog = receipt.logs.find((l) => l.address.toLowerCase() === asset.chainId);

    if (!swapLog) {
      throw new Error(`Failed to get swap amount for TX: ${txId} while trying to extract purchased liquidity`);
    }

    return {
      targetAmount: await this.fromWeiAmount(swapLog.data, asset),
      feeAmount: await this.#client.getTxActualFee(txId),
    };
  }

  //*** HELPER METHODS ***//

  private async getPendingAmount(asset: Asset): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: asset.dexName, blockchain: asset.blockchain },
    });

    return Util.sumObj<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }

  private async getMaxPurchasableAmount(swapAssets: Asset[], targetAsset: Asset, maxSlippage: number): Promise<number> {
    let maxPurchasableAmount = 0;

    for (const swapAsset of swapAssets) {
      const purchasableAmount = await this.getPurchasableAmount(swapAsset, targetAsset, maxSlippage);
      maxPurchasableAmount = purchasableAmount > maxPurchasableAmount ? purchasableAmount : maxPurchasableAmount;
    }

    return maxPurchasableAmount;
  }

  private async getPurchasableAmount(swapAsset: Asset, targetAsset: Asset, maxSlippage: number): Promise<number> {
    try {
      const availableAmount = await this.getAssetAvailability(swapAsset);
      if (availableAmount === 0) return 0;

      return await this.getTargetAmount(swapAsset, availableAmount, targetAsset, maxSlippage);
    } catch (e) {
      this.logger.warn(`Could not find purchasable amount for swap ${swapAsset.dexName} -> ${targetAsset.dexName}:`, e);

      return 0;
    }
  }
}
