import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { EvmStrategy } from './base/evm.strategy';
import { SendGroup } from './base/send.strategy';

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
    const { sourceAddress, privateKey, destinationAddress } = payInGroup;

    return this.arbitrumService.sendNativeCoin(
      sourceAddress,
      privateKey,
      destinationAddress,
      this.getTotalGroupAmount(payInGroup),
    );
  }

  protected topUpCoin(payInGroup: SendGroup, amount: number): Promise<string> {
    const { sourceAddress } = payInGroup;

    return this.arbitrumService.sendNativeCoinFromDex(sourceAddress, amount);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.arbitrum.arbitrumWalletAddress, Blockchain.ARBITRUM);
  }
}
