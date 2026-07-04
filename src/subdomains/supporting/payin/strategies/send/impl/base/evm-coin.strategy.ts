import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EvmStrategy } from './evm.strategy';
import { SendGroup, SendType } from './send.strategy';

export abstract class EvmCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
  ) {
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
            .getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY)
            .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
        : null;

      payIn.preparing(null, feeAmount, feeAmountChf);
      payIn.status = PayInStatus.PREPARED;
      await this.payInRepo.save(payIn);
    }

    payInGroup.status = PayInStatus.PREPARED;
  }

  protected async dispatchSend(payInGroup: SendGroup, type: SendType, estimatedNativeFee: number): Promise<string> {
    const { account, destinationAddress } = payInGroup;

    if (type === SendType.RETURN) return this.dispatchReturn(payInGroup, estimatedNativeFee);

    const groupAmount = this.getTotalGroupAmount(payInGroup, type);
    // use fresh gas cost (not cached estimate) to avoid value + gas > balance
    const freshGasCost = await this.payInEvmService.getGasCostForCoinTransaction();
    const gasCost = Math.max(freshGasCost, estimatedNativeFee);
    const amount = Util.round(groupAmount - gasCost * 1.05, 12);

    return this.payInEvmService.sendNativeCoin(account, destinationAddress, amount);
  }

  private async dispatchReturn(payInGroup: SendGroup, estimatedNativeFee: number): Promise<string> {
    const { account, destinationAddress } = payInGroup;

    // use fresh gas cost (not cached estimate) to avoid value + gas > balance
    const freshGasCost = await this.payInEvmService.getGasCostForCoinTransaction();
    const gasCost = CryptoInput.calcEffectiveReturnGasCost(
      freshGasCost,
      estimatedNativeFee,
      Config.blockchainReturnFeeBuffer,
      12,
    );

    const grossAmount = Util.sumObjValue<CryptoInput>(payInGroup.payIns, 'amount');
    const authorizedAmount = Util.sumObjValue<CryptoInput>(payInGroup.payIns, 'chargebackAmount');
    // gas cost already carries the buffer, so no additional buffer is applied here
    const total = CryptoInput.calcReturnSendAmount(grossAmount, authorizedAmount, gasCost, 1, 12);

    if (!CryptoInput.isReturnEconomic(total))
      throw new FeeLimitExceededException(`Uneconomic return: gas cost ${gasCost} exceeds returnable amount`);

    const returnAmounts = CryptoInput.distributeReturnAmount(
      total,
      payInGroup.payIns.map((p) => p.chargebackAmount),
      12,
    );
    payInGroup.payIns.forEach((payIn, i) => (payIn.returnAmount = returnAmounts[i]));

    return this.payInEvmService.sendNativeCoin(account, destinationAddress, total);
  }
}
