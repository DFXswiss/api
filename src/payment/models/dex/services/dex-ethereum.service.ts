import { Injectable } from '@nestjs/common';
import { EthereumClient } from 'src/blockchain/ethereum/ethereum-client';
import { EthereumService } from 'src/blockchain/ethereum/ethereum.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexEthereumService {
  #ethereumClient: EthereumClient;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, ethereumService: EthereumService) {
    this.#ethereumClient = ethereumService.getClient();
  }

  async getBalance(): Promise<number> {
    return this.#ethereumClient.getBalance();
  }

  async checkETHAvailability(amount: number): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === 'ETH' && o.targetAsset.blockchain === Blockchain.ETHEREUM,
    );
    const pendingAmount = Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');

    const availableAmount = await this.getBalance();

    // 5% cap for unexpected meantime swaps
    if (amount * 1.05 > availableAmount - pendingAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ETH. Trying to use ${amount} ETH worth liquidity. Available amount: ${availableAmount}. Pending amount: ${pendingAmount}`,
      );
    }

    return amount;
  }
}
