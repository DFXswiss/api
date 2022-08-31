import { Injectable } from '@nestjs/common';
import { BSCClient } from 'src/blockchain/bsc/bsc-client';
import { BSCService } from 'src/blockchain/bsc/bsc.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexBSCService {
  #bscClient: BSCClient;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, bscService: BSCService) {
    this.#bscClient = bscService.getClient();
  }

  async getBalance(): Promise<number> {
    return this.#bscClient.getBalance();
  }

  async checkETHAvailability(amount: number): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === 'BNB' && o.targetAsset.blockchain === Blockchain.BINANCE_SMART_CHAIN,
    );
    const pendingAmount = Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');

    const availableAmount = await this.getBalance();

    // 5% cap for unexpected meantime swaps
    if (amount * 1.05 > availableAmount - pendingAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset BNB. Trying to use ${amount} BNB worth liquidity. Available amount: ${availableAmount}. Pending amount: ${pendingAmount}`,
      );
    }

    return amount;
  }
}
