import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { EvmStrategy } from './evm.strategy';
import { SendGroup, SendType } from './send.strategy';

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
      const feeAmount = Util.round(nativeFee / payInGroup.payIns.length, 16);
      const feeAsset = await this.assetService.getNativeAsset(payIn.asset.blockchain);
      const feeAmountChf = feeAmount
        ? await this.pricingService
            .getPrice(feeAsset, this.chf, true)
            .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
        : null;

      payIn.preparing(null, feeAmount, feeAmountChf);
      await this.payInRepo.save(payIn);
    }
  }

  protected dispatchSend(payInGroup: SendGroup, type: SendType, estimatedNativeFee: number): Promise<string> {
    const { account, destinationAddress } = payInGroup;

    const groupAmount = this.getTotalGroupAmount(payInGroup, type);
    // subtract fee for forwarding
    const amount = type === SendType.FORWARD ? Util.round(groupAmount - estimatedNativeFee * 1.00001, 12) : groupAmount;

    return this.payInEvmService.sendNativeCoin(account, destinationAddress, amount);
  }
}
