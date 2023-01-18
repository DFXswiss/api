import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmStrategy, SendGroup } from './base/evm.strategy';

@Injectable()
export class BscTokenStrategy extends EvmStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payoutService: PayoutService,
    protected readonly bscService: PayInBscService,
    payInRepo: PayInRepository,
  ) {
    super(pricingService, payoutService, bscService, payInRepo, Blockchain.BINANCE_SMART_CHAIN);
  }

  protected dispatchSend(payInGroup: SendGroup): Promise<string> {
    return this.bscService.sendToken(
      payInGroup.destinationAddress,
      payInGroup.asset,
      this.getTotalGroupAmount(payInGroup),
    );
  }
}
