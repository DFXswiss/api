import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmStrategy } from './base/evm.strategy';
import { SendGroup } from './base/send.strategy';

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
    const { sourceAddress, privateKey, destinationAddress, asset } = payInGroup;

    return this.bscService.sendToken(
      sourceAddress,
      privateKey,
      destinationAddress,
      asset,
      this.getTotalGroupAmount(payInGroup),
    );
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.bsc.bscWalletAddress, Blockchain.BINANCE_SMART_CHAIN);
  }
}
