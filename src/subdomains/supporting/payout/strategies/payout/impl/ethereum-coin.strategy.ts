import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutEthereumService } from '../../../services/payout-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly ethereumService: PayoutEthereumService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(ethereumService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    const nonce = await this.getOrderNonce(order);

    return this.ethereumService.sendNativeCoin(order.destinationAddress, order.amount, nonce);
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return this.ethereumService.getCurrentGasForCoinTransaction();
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getEthCoin();
  }
}
