import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutCitreaTestnetService } from '../../../services/payout-citrea-testnet.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class CitreaTestnetCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly citreaTestnetService: PayoutCitreaTestnetService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(citreaTestnetService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    const nonce = await this.getOrderNonce(order);

    return this.citreaTestnetService.sendNativeCoin(order.destinationAddress, order.amount, nonce);
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return this.citreaTestnetService.getCurrentGasForCoinTransaction();
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getCitreaTestnetCoin();
  }
}
