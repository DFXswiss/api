import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/blockchain/ain/node/node.service';
import { DeFiChainUtil } from 'src/blockchain/ain/utils/defichain.util';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Util } from 'src/shared/util';
import { ChainSwapId, LiquidityOrder } from '../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexDeFiChainService {
  #dexClient: DeFiClient;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly deFiChainUtil: DeFiChainUtil,
    private readonly settingService: SettingService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.#dexClient = client));
  }

  // *** PUBLIC API *** //

  async getAndCheckAvailableTargetLiquidity(
    sourceAsset: string,
    sourceAmount: number,
    targetAsset: string,
    maxSlippage: number,
  ): Promise<{
    targetAmount: number;
    availableAmount: number;
    maxPurchasableAmount: number;
    isSlippageDetected: boolean;
    feeAmount: number;
  }> {
    const targetAmount =
      targetAsset === sourceAsset
        ? sourceAmount
        : await this.#dexClient.testCompositeSwap(sourceAsset, targetAsset, sourceAmount);

    const [availableAmount, pendingAmount] = await this.getAssetAvailability(targetAsset);
    const maxPurchasableAmount = await this.getMaxPurchasableAmount(targetAsset);
    const isSlippageDetected = await this.checkTestSwapPriceSlippage(
      sourceAsset,
      sourceAmount,
      targetAsset,
      targetAmount,
      maxSlippage,
    );

    return {
      targetAmount,
      availableAmount: availableAmount - pendingAmount,
      maxPurchasableAmount,
      isSlippageDetected,
      feeAmount: 0,
    };
  }

  async purchaseLiquidity(
    swapAsset: string,
    swapAmount: number,
    targetAsset: string,
    maxSlippage: number,
  ): Promise<ChainSwapId> {
    const maxPrice =
      (await this.settingService.get('slippage-protection')) === 'on'
        ? await this.calculateMaxTargetAssetPrice(swapAsset, targetAsset, maxSlippage)
        : undefined;

    try {
      return await this.#dexClient.compositeSwap(
        Config.blockchain.default.dexWalletAddress,
        swapAsset,
        Config.blockchain.default.dexWalletAddress,
        targetAsset,
        swapAmount,
        [],
        maxPrice,
      );
    } catch (e) {
      if (this.isCompositeSwapSlippageError(e)) {
        throw new PriceSlippageException(
          `Price is higher than indicated. Composite swap ${swapAmount} ${swapAsset} to ${targetAsset}. Maximum price for asset ${targetAsset} is ${maxPrice} ${swapAsset}.`,
        );
      }

      throw e;
    }
  }

  async addPoolLiquidity(poolPair: [string, string]): Promise<string> {
    return this.#dexClient.addPoolLiquidity(Config.blockchain.default.dexWalletAddress, poolPair);
  }

  async transferLiquidity(addressTo: string, asset: string, amount: number): Promise<string> {
    return this.#dexClient.sendToken(Config.blockchain.default.dexWalletAddress, addressTo, asset, amount);
  }

  async transferMinimalUtxo(address: string): Promise<string> {
    return this.#dexClient.sendToken(
      Config.blockchain.default.dexWalletAddress,
      address,
      'DFI',
      Config.blockchain.default.minDeposit.DeFiChain.DFI / 2,
    );
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    const transaction = await this.#dexClient.getTx(transferTxId);

    return transaction && transaction.blockhash && transaction.confirmations > 0;
  }

  async getPurchasedAmount(txId: string, asset: string): Promise<number> {
    const historyEntry = await this.deFiChainUtil.getHistoryEntryForTx(txId, this.#dexClient);

    if (!historyEntry) {
      throw new Error(`Could not find transaction with ID: ${txId} while trying to extract purchased liquidity`);
    }

    const amounts = historyEntry.amounts.map((a) => this.#dexClient.parseAmount(a));

    const { amount: purchasedAmount } = amounts.find((a) => a.asset === asset);

    if (!purchasedAmount) {
      throw new Error(`Failed to get amount for TX: ${txId} while trying to extract purchased liquidity`);
    }

    return purchasedAmount;
  }

  async getSwapAmountForPurchase(
    referenceAsset: string,
    referenceAmount: number,
    targetAsset: string,
    swapAsset: string,
  ): Promise<number> {
    const swapAmount = await this.calculateSwapAmountForPurchase(
      referenceAsset,
      referenceAmount,
      targetAsset,
      swapAsset,
    );

    await this.checkAssetAvailability(swapAsset, swapAmount);

    return swapAmount;
  }

  // *** HELPER METHODS *** //

  private async checkAssetAvailability(asset: string, amount: number): Promise<void> {
    const [availableAmount, pendingAmount] = await this.getAssetAvailability(asset);

    // 5% cap for unexpected meantime swaps
    if (amount * 1.05 > availableAmount - pendingAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${asset}. Trying to use ${amount} ${asset} worth liquidity. Available amount: ${availableAmount}. Pending amount: ${pendingAmount}`,
      );
    }
  }

  private async getAssetAvailability(asset: string): Promise<[number, number]> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === asset && o.targetAsset.blockchain === Blockchain.DEFICHAIN,
    );
    const pendingAmount = Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');
    const availableAmount = await this.deFiChainUtil.getAvailableTokenAmount(asset, this.#dexClient);

    return [availableAmount, pendingAmount];
  }

  private async getMaxPurchasableAmount(targetAsset: string): Promise<number> {
    const [availableAmount, pendingAmount] = await this.getAssetAvailability('DFI');
    return this.#dexClient.testCompositeSwap('DFI', targetAsset, Util.round(availableAmount - pendingAmount, 8));
  }

  private async calculateSwapAmountForPurchase(
    referenceAsset: string,
    referenceAmount: number,
    targetAsset: string,
    swapAsset: string,
  ): Promise<number> {
    if (referenceAsset === targetAsset) {
      const swapAssetPrice = await this.calculatePrice(swapAsset, referenceAsset);

      const swapAmount = referenceAmount * swapAssetPrice;

      // adding 5% cap to liquidity swap to cover meantime referenceAmount price difference (initially taken from Kraken/Binance)
      return Util.round(swapAmount + swapAmount * 0.05, 8);
    }

    return this.#dexClient.testCompositeSwap(referenceAsset, swapAsset, referenceAmount);
  }

  private async checkTestSwapPriceSlippage(
    sourceAsset: string,
    sourceAmount: number,
    targetAsset: string,
    targetAmount: number,
    maxSlippage: number,
  ): Promise<boolean> {
    // how much sourceAsset we are willing to pay for 1 unit of targetAsset max
    const maxPrice = await this.calculateMaxTargetAssetPrice(sourceAsset, targetAsset, maxSlippage);

    const minimalAllowedTargetAmount = Util.round(sourceAmount / maxPrice, 8);

    return targetAmount > 0.000001 && targetAmount < minimalAllowedTargetAmount;
  }

  private async calculateMaxTargetAssetPrice(
    sourceAsset: string,
    targetAsset: string,
    maxSlippage: number,
  ): Promise<number> {
    // how much of sourceAsset you get for 1 unit of targetAsset
    const targetAssetPrice = await this.calculatePrice(sourceAsset, targetAsset);

    return Util.round(targetAssetPrice * (1 + maxSlippage), 8);
  }

  private async calculatePrice(sourceAsset: string, targetAsset: string): Promise<number> {
    // how much of sourceAsset you going to pay for 1 unit of targetAsset, caution - only indicative calculation
    return (
      1 /
      ((await this.#dexClient.testCompositeSwap(
        sourceAsset,
        targetAsset,
        this.getMinimalPriceReferenceAmount(sourceAsset),
      )) /
        this.getMinimalPriceReferenceAmount(sourceAsset))
    );
  }

  private isCompositeSwapSlippageError(e: Error): boolean {
    return e.message && e.message.includes('Price is higher than indicated');
  }

  private getMinimalPriceReferenceAmount(sourceAsset: string): number {
    return sourceAsset === 'BTC' ? 0.001 : 1;
  }
}
