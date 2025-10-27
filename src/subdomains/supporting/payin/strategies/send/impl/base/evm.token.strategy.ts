import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EvmStrategy } from './evm.strategy';
import { SendGroup, SendType } from './send.strategy';

export abstract class EvmTokenStrategy extends EvmStrategy {
  constructor(protected readonly payInEvmService: PayInEvmService, protected readonly payInRepo: PayInRepository) {
    super(payInEvmService, payInRepo);
  }

  protected async checkPreparation(payInGroup: SendGroup): Promise<boolean> {
    const result = [];
    /**
     * @note
     * should be only one transaction for group, but with very low probability can be more
     */
    const prepareTxIds = [...new Set(payInGroup.payIns.map((p) => p.prepareTxId))];

    for (const txId of prepareTxIds) {
      result.push(await this.payInEvmService.checkTransactionCompletion(txId, 0));
    }

    return result.every((tsStatus) => !!tsStatus);
  }

  protected async prepareSend(payInGroup: SendGroup, nativeFee: number): Promise<void> {
    const prepareTxId = await this.topUpCoin(payInGroup, Util.round(nativeFee, 12));

    for (const payIn of payInGroup.payIns) {
      const feeAmount = Util.round(nativeFee / payInGroup.payIns.length, 16);
      const feeAsset = await this.assetService.getNativeAsset(payIn.asset.blockchain);
      const feeAmountChf = feeAmount
        ? await this.pricingService
            .getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY)
            .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
        : null;

      payIn.preparing(prepareTxId, feeAmount, feeAmountChf);
      await this.payInRepo.save(payIn);
    }
  }

  protected dispatchSend(payInGroup: SendGroup, type: SendType): Promise<string> {
    const { account, destinationAddress, asset } = payInGroup;

    return this.payInEvmService.sendToken(
      account,
      destinationAddress,
      asset,
      this.getTotalGroupAmount(payInGroup, type),
    );
  }
}
