import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EvmStrategy } from './evm.strategy';
import { SendGroup } from './send.strategy';

export abstract class EvmCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payoutService: PayoutService,
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
    protected readonly blockchain: Blockchain,
  ) {
    super(pricingService, payoutService, payInEvmService, payInRepo, blockchain);
  }

  protected async checkPreparation(_: SendGroup): Promise<boolean> {
    /**
     * @note
     * prepared by default, because fee is subtracted from sent amount
     */
    return true;
  }

  protected async prepareSend(payInGroup: SendGroup, _: number): Promise<void> {
    for (const payIn of payInGroup.payIns) {
      payIn.preparing(null);
      await this.payInRepo.save(payIn);
    }
  }

  protected dispatchSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<string> {
    const { sourceAddress, privateKey, destinationAddress } = payInGroup;

    return this.payInEvmService.sendNativeCoin(
      sourceAddress,
      privateKey,
      destinationAddress,
      Util.round(this.getTotalGroupAmount(payInGroup) - estimatedNativeFee, 12),
      estimatedNativeFee,
    );
  }
}
