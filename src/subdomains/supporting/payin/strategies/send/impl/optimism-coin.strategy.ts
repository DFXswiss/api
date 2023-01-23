import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { EvmStrategy } from './base/evm.strategy';
import { SendGroup } from './base/send.strategy';

@Injectable()
export class OptimismCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payoutService: PayoutService,
    protected readonly optimismService: PayInOptimismService,
    payInRepo: PayInRepository,
  ) {
    super(pricingService, payoutService, optimismService, payInRepo, Blockchain.OPTIMISM);
  }

  protected dispatchSend(payInGroup: SendGroup): Promise<string> {
    const { sourceAddress, privateKey, destinationAddress } = payInGroup;

    return this.optimismService.sendNativeCoin(
      sourceAddress,
      privateKey,
      destinationAddress,
      this.getTotalGroupAmount(payInGroup),
    );
  }

  protected topUpCoin(payInGroup: SendGroup, amount: number): Promise<string> {
    const { sourceAddress } = payInGroup;

    return this.optimismService.sendNativeCoinFromDex(sourceAddress, amount);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.optimism.optimismWalletAddress, Blockchain.OPTIMISM);
  }
}
