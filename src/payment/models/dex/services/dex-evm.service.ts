import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

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

  async checkNativeCryptoAvailability(amount: number): Promise<number> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.#client.getNativeCryptoBalance();

    this.checkLiquidity(amount, pendingAmount, availableAmount, this.nativeCoin);

    return amount;
  }

  async getAndCheckTokenAvailability(sourceAsset: string, sourceAmount: number, targetAsset: Asset): Promise<number> {
    const amount = await this.getTargetAmount(sourceAsset, sourceAmount, targetAsset);

    await this.checkTokenAvailability(targetAsset, amount);

    return amount;
  }

  get _nativeCoin(): string {
    return this.nativeCoin;
  }

  //*** HELPER METHODS ***//

  private async getTargetAmount(sourceAsset: string, sourceAmount: number, targetAsset: Asset): Promise<number> {
    if (sourceAsset === targetAsset.dexName) return sourceAmount;
    if (sourceAsset !== this._nativeCoin) {
      // only native coin is enabled as a sourceAsset
      throw new Error(
        `Only native coin reference is supported by EVM test swap. Provided source asset: ${sourceAsset}. Target asset: ${targetAsset.dexName}. Blockchain: ${targetAsset.blockchain}`,
      );
    }

    return this.#client.nativeCryptoTestSwap(sourceAmount, targetAsset);
  }

  private async checkTokenAvailability(asset: Asset, amount: number): Promise<void> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount = await this.#client.getTokenBalance(asset);

    this.checkLiquidity(amount, pendingAmount, availableAmount, asset.dexName);
  }

  private async getPendingAmount(assetName: string): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === assetName && o.targetAsset.blockchain === this.blockchain,
    );

    return Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');
  }

  private checkLiquidity(
    requiredAmount: number,
    pendingAmount: number,
    availableAmount: number,
    assetName: string,
  ): void {
    // 5% cap for unexpected meantime swaps
    if (requiredAmount * 1.05 > availableAmount - pendingAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${this.nativeCoin}. Trying to use ${requiredAmount} ${assetName} worth liquidity. Available amount: ${availableAmount}. Pending amount: ${pendingAmount}`,
      );
    }
  }
}
