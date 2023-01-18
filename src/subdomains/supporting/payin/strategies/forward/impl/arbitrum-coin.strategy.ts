import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { EvmStrategy, SendGroup } from './base/evm.strategy';

@Injectable()
export class ArbitrumCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payoutService: PayoutService,
    protected readonly arbitrumService: PayInArbitrumService,
    payInRepo: PayInRepository,
  ) {
    super(pricingService, payoutService, arbitrumService, payInRepo, Blockchain.ARBITRUM);
  }

  protected dispatchSend(payInGroup: SendGroup): Promise<string> {
    return this.arbitrumService.sendNativeCoin(payInGroup.destinationAddress, this.getTotalGroupAmount(payInGroup));
  }
}
