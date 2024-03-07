import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { PriceSlippageException } from '../../exceptions/price-slippage.exception';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';

export abstract class DexEvmService {
  #client: EvmClient;

  constructor(
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly service: EvmService,
    protected readonly nativeCoin: string,
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

  async checkNativeCoinAvailability(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.#client.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async getAndCheckTokenAvailability(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
  ): Promise<[number, number]> {
    const targetAmount = await this.getTargetAmount(sourceAsset, sourceAmount, targetAsset);
    const availableAmount = await this.getAssetAvailability(targetAsset);

    return [targetAmount, availableAmount];
  }

  async getDexHistory(): Promise<[EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]]> {
    const address = this.#client.dfxAddress;
    const currentBlock = await this.#client.getCurrentBlock();
    const startBlock = Util.round(currentBlock - 100, 0);
    const allCoinTransactions = await this.#client.getNativeCoinTransactions(address, startBlock);
    const allTokenTransactions = await this.#client.getERC20Transactions(address, startBlock);

    return [allCoinTransactions, allTokenTransactions];
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

  async fromWeiAmount(amountWeiLike: string, asset: Asset): Promise<number> {
    const token = await this.#client.getToken(asset);
    return EvmUtil.fromWeiAmount(amountWeiLike, token.decimals);
  }

  get _nativeCoin(): string {
    return this.nativeCoin;
  }

  //*** HELPER METHODS ***//

  async getAssetAvailability(asset: Asset): Promise<number> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount =
      asset.type === AssetType.COIN
        ? await this.#client.getNativeCoinBalance()
        : await this.#client.getTokenBalance(asset);

    // adding a small cap to pendingAmount in case testSwap results got slightly outdated by the moment current check is done
    return availableAmount - pendingAmount * 1.05;
  }

  private async getPendingAmount(asset: string): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: asset, blockchain: this.blockchain },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
