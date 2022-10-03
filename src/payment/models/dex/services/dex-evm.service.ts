import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/blockchain/shared/evm/evm.service';
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

  async checkCoinAvailability(amount: number): Promise<number> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.#client.getNativeCryptoBalance();

    this.checkLiquidity(amount, pendingAmount, availableAmount, this.nativeCoin);

    return amount;
  }

  async checkTokenAvailability(token: string, amount: number): Promise<number> {
    const pendingAmount = await this.getPendingAmount(token);
    const availableAmount = await this.#client.getTokenBalance(token);

    this.checkLiquidity(amount, pendingAmount, availableAmount, token);

    return amount;
  }

  get _nativeCoin(): string {
    return this.nativeCoin;
  }

  //*** HELPER METHODS ***//

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
