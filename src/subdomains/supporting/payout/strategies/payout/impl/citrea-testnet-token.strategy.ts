import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { PayoutOrderContext } from '../../../entities/payout-order.entity';
import { PayoutCitreaTestnetService } from '../../../services/payout-citrea-testnet.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class CitreaTestnetTokenStrategy extends EvmTokenStrategy {
  constructor(citreaTestnetService: PayoutCitreaTestnetService) {
    super(citreaTestnetService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  async doPayoutForContext(context: PayoutOrderContext): Promise<void> {
    const { payoutOrder, payoutRequest } = context;

    const txId = await this.evmService.sendTokenFromDex(
      payoutRequest.destinationAddress,
      payoutRequest.asset,
      +payoutOrder.amount,
    );

    await this.updatePayoutOrder(payoutOrder, txId);
  }
}