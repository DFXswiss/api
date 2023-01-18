import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { EvmStrategy, SendGroup } from './base/evm.strategy';

@Injectable()
export class OptimismTokenStrategy extends EvmStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payoutService: PayoutService,
    protected readonly optimismService: PayInOptimismService,
    payInRepo: PayInRepository,
  ) {
    super(pricingService, payoutService, optimismService, payInRepo, Blockchain.OPTIMISM);
  }

  protected dispatchSend(payInGroup: SendGroup): Promise<string> {
    return this.optimismService.sendToken(
      payInGroup.destinationAddress,
      payInGroup.asset,
      this.getTotalGroupAmount(payInGroup),
    );
  }
}
