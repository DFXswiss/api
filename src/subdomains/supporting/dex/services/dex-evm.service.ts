import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
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
    const availableAmount = await this.getTokenAvailableAmount(targetAsset);

    return [targetAmount, availableAmount];
  }

  get _nativeCoin(): string {
    return this.nativeCoin;
  }

  //*** HELPER METHODS ***//

  private async getTargetAmount(sourceAsset: Asset, sourceAmount: number, targetAsset: Asset): Promise<number> {
    if (sourceAsset.dexName === targetAsset.dexName) return sourceAmount;
    if (sourceAsset.dexName !== this._nativeCoin) {
      // only native coin is enabled as a sourceAsset
      throw new Error(
        `Only native coin reference is supported by EVM test swap. Provided source asset: ${sourceAsset.dexName}. Target asset: ${targetAsset.dexName}. Blockchain: ${targetAsset.blockchain}`,
      );
    }

    return this.#client.nativeCryptoTestSwap(sourceAmount, targetAsset);
  }

  private async getTokenAvailableAmount(asset: Asset): Promise<number> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount = await this.#client.getTokenBalance(asset);

    return availableAmount - pendingAmount;
  }

  private async getPendingAmount(assetName: string): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === assetName && o.targetAsset.blockchain === this.blockchain,
    );

    return Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');
  }
}
