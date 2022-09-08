import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { EVMClient } from 'src/blockchain/shared/evm/evm-client';
import { EVMService } from 'src/blockchain/shared/evm/evm.service';
import { Util } from 'src/shared/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

export abstract class DexEVMService {
  #client: EVMClient;

  constructor(
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly service: EVMService,
    protected readonly nativeCoin: string,
    protected readonly blockchain: Blockchain,
  ) {
    this.#client = service.getDefaultClient();
  }

  async getBalance(): Promise<number> {
    return this.#client.getBalance();
  }

  async checkCoinAvailability(amount: number): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === this.nativeCoin && o.targetAsset.blockchain === this.blockchain,
    );
    const pendingAmount = Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');

    const availableAmount = await this.getBalance();

    // 5% cap for unexpected meantime swaps
    if (amount * 1.05 > availableAmount - pendingAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${this.nativeCoin}. Trying to use ${amount} ${this.nativeCoin} worth liquidity. Available amount: ${availableAmount}. Pending amount: ${pendingAmount}`,
      );
    }

    return amount;
  }

  get _nativeCoin(): string {
    return this.nativeCoin;
  }
}
