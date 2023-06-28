import { Util } from 'src/shared/utils/util';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { EvmStrategy } from './evm.strategy';
import { SendGroup } from './send.strategy';

export abstract class EvmCoinStrategy extends EvmStrategy {
  constructor(protected readonly payInEvmService: PayInEvmService, protected readonly payInRepo: PayInRepository) {
    super(payInEvmService, payInRepo);
  }

  protected async checkPreparation(_: SendGroup): Promise<boolean> {
    /**
     * @note
     * prepared by default, because fee is subtracted from sent amount
     */
    return true;
  }

  protected async prepareSend(payInGroup: SendGroup, nativeFee: number): Promise<void> {
    for (const payIn of payInGroup.payIns) {
      payIn.preparing(null, Util.round(nativeFee / payInGroup.payIns.length, 16));
      await this.payInRepo.save(payIn);
    }
  }

  protected dispatchSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<string> {
    const { account, destinationAddress } = payInGroup;

    return this.payInEvmService.sendNativeCoin(
      account,
      destinationAddress,
      /**
       * @note
       * subtracting a fraction more from sent amount to compensate possible rounding issues.
       * */
      Util.round(this.getTotalGroupAmount(payInGroup) - estimatedNativeFee * 1.00001, 12),
      estimatedNativeFee,
    );
  }
}
