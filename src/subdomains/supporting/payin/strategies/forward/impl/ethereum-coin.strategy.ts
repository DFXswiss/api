import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmStrategy, SendGroup } from './base/evm.strategy';

@Injectable()
export class EthereumCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payoutService: PayoutService,
    protected readonly ethereumService: PayInEthereumService,
    payInRepo: PayInRepository,
  ) {
    super(pricingService, payoutService, ethereumService, payInRepo, Blockchain.ETHEREUM);
  }

  protected dispatchSend(payInGroup: SendGroup): Promise<string> {
    return this.ethereumService.sendNativeCoin(payInGroup.destinationAddress, this.getTotalGroupAmount(payInGroup));
  }
}
