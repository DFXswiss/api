import { Config } from 'src/config/config';
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { LogLevel } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EvmStrategy } from './evm.strategy';
import { SendGroup, SendType } from './send.strategy';

export abstract class EvmTokenStrategy extends EvmStrategy {
  constructor(
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
    protected readonly delegationService?: Eip7702DelegationService,
  ) {
    super(payInEvmService, payInRepo);
  }

  /**
   * Check if EIP-7702 delegation is supported for this blockchain
   */
  protected isDelegationSupported(): boolean {
    return this.delegationService?.isDelegationSupported(this.blockchain) ?? false;
  }

  /**
   * Override doSend to use delegation when supported
   * With delegation: 1 TX (direct transfer via delegator)
   * Without delegation: 2 TX (gas top-up + token transfer)
   */
  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    if (!this.isDelegationSupported()) {
      return super.doSend(payIns, type);
    }

    // Split pay-ins: legacy flow for PREPARING/PREPARED (already have gas), delegation for new ones
    const legacyPayIns = payIns.filter((p) => [PayInStatus.PREPARING, PayInStatus.PREPARED].includes(p.status));
    const delegationPayIns = payIns.filter((p) => [PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(p.status));

    // Complete legacy flow for pay-ins that already started preparation
    if (legacyPayIns.length > 0) {
      await super.doSend(legacyPayIns, type);
    }

    // Delegation flow for new pay-ins
    const groups = this.groupPayIns(delegationPayIns, type);

    for (const payInGroup of [...groups.values()]) {
      try {
        await this.dispatchViaDelegation(payInGroup, type);
      } catch (e) {
        if (e.message?.includes('No maximum fee provided')) continue;

        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

        this.logger.log(
          logLevel,
          `Failed to send ${this.blockchain} input(s) via delegation ${this.getPayInsIdentityKey(payInGroup)} of type ${type}:`,
          e,
        );
      }
    }
  }

  /**
   * Dispatch token transfer via EIP-7702 delegation (single TX)
   */
  private async dispatchViaDelegation(payInGroup: SendGroup, type: SendType): Promise<void> {
    const { account, destinationAddress, asset } = payInGroup;
    const amount = this.getTotalGroupAmount(payInGroup, type);

    this.logger.verbose(
      `Sending ${amount} ${asset.name} from ${payInGroup.sourceAddress} to ${destinationAddress} via EIP-7702 delegation`,
    );

    const txHash = await this.delegationService.transferTokenViaDelegation(account, asset, destinationAddress, amount);

    // Update pay-ins with transaction data (fee is paid by relayer, not deducted from amount)
    for (const payIn of payInGroup.payIns) {
      const updatedPayIn = await this.updatePayInWithSendData(payIn, type, txHash);
      if (updatedPayIn) {
        await this.payInRepo.save(updatedPayIn);
      }
    }
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
