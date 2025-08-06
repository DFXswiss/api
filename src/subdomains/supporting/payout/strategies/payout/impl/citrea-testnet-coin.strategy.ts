import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutCitreaTestnetService } from '../../services/payout-citrea-testnet.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class CitreaTestnetCoinStrategy extends EvmCoinStrategy {
  constructor(citreaTestnetService: PayoutCitreaTestnetService) {
    super(citreaTestnetService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  async doPayoutForContext(context: PayoutOrderContext): Promise<void> {
    const { payoutOrder, payoutRequest } = context;

    const txId = await this.evmService.sendNativeCoinFromDex(
      payoutRequest.destinationAddress,
      +payoutOrder.amount,
    );

    await this.updatePayoutOrder(payoutOrder, txId);
  }
}