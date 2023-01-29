import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { SendGroup, SendGroupKey, SendStrategy, SendType } from './send.strategy';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { FeeRequest, FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Util } from 'src/shared/utils/util';
import { PriceRequest, PriceResult } from 'src/subdomains/supporting/pricing/interfaces';
import { PriceRequestContext } from 'src/subdomains/supporting/pricing/enums';
import { Config } from 'src/config/config';

export abstract class EvmStrategy extends SendStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payoutService: PayoutService,
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
    protected readonly blockchain: Blockchain,
  ) {
    super();
  }

  protected abstract dispatchSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<string>;
  protected abstract prepareSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<void>;
  protected abstract checkPreparation(payInGroup: SendGroup): Promise<boolean>;

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    this.logInput(payIns, type);

    const groups = this.groupPayIns(payIns, type);

    for (const payInGroup of [...groups.values()]) {
      try {
        if (payInGroup.status === PayInStatus.PREPARING) {
          const isReady = await this.checkPreparation(payInGroup);

          if (isReady) {
            payInGroup.status = PayInStatus.PREPARED;
          } else {
            continue;
          }
        }

        const { nativeFee, targetFee } = await this.getEstimatedFee(payInGroup);

        const totalGroupAmount = this.getTotalGroupAmount(payInGroup);

        CryptoInput.verifyEstimatedFee(targetFee, totalGroupAmount);

        if ([PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(payInGroup.status)) {
          await this.prepareSend(payInGroup, nativeFee);

          continue;
        }

        if (payInGroup.status === PayInStatus.PREPARED) {
          await this.dispatch(payInGroup, type, nativeFee);

          continue;
        }
      } catch (e) {
        console.error(
          `Failed to send ${this.blockchain} input(s) ${this.getPayInsIdentityKey(payInGroup)} of type ${type}`,
          e,
        );
      }
    }
  }

  //*** HELPER METHODS ***//

  private logInput(payIns: CryptoInput[], type: SendType): void {
    payIns.length > 0 &&
      console.log(
        `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} ${this.blockchain} ${
          payIns[0].asset.type
        } input(s).`,
      );
  }

  private groupPayIns(payIns: CryptoInput[], type: SendType): Map<SendGroupKey, SendGroup> {
    const groups = new Map<SendGroupKey, SendGroup>();

    for (const payIn of payIns) {
      this.designateSend(payIn, type);

      const { address, destinationAddress, asset, status } = payIn;

      const group = groups.get(this.getPayInGroupKey(payIn));

      if (!group) {
        groups.set(this.getPayInGroupKey(payIn), {
          sourceAddress: address.address,
          privateKey: Util.decrypt(payIn.route.deposit.key, Config.blockchain.evm.encryptionKey),
          destinationAddress: destinationAddress.address,
          asset,
          status,
          payIns: [payIn],
        });

        continue;
      }

      group.payIns.push(payIn);
    }

    return groups;
  }

  private getPayInGroupKey(payIn: CryptoInput): SendGroupKey {
    return `${payIn.address.address}&${payIn.destinationAddress.address}&&${payIn.asset.dexName}&${payIn.asset.type}&${payIn.status}`;
  }

  private async getEstimatedFee(payInGroup: SendGroup): Promise<{ nativeFee: number; targetFee: number }> {
    const feeRequest = await this.createFeeRequest(payInGroup.asset);

    const nativeFee = await this.payoutService.estimateFee(feeRequest);
    const targetFee = await this.getFeeAmountForInPayInGroup(payInGroup, nativeFee);

    return { nativeFee: nativeFee.amount, targetFee };
  }

  private async createFeeRequest(asset: Asset): Promise<FeeRequest> {
    return {
      asset,
      quantityOfTransactions: 1,
    };
  }

  private async getFeeAmountForInPayInGroup(payInGroup: SendGroup, nativeFee: FeeResult): Promise<number> {
    const payInIdStrings = this.getPayInsIdentityKey(payInGroup);
    const priceRequestCorrelationId = `PayIn_ConvertEstimatedForwardFee_${payInIdStrings}`;
    const errorMessage = `Could not get price for pay-in forwarding fee calculation. Ignoring fee estimate. Native fee asset: ${nativeFee.asset.dexName}, pay-in asset: ${payInGroup.asset.dexName}`;

    return this.getFeeAmountInPayInAsset(payInGroup.asset, nativeFee, priceRequestCorrelationId, errorMessage);
  }

  private getPayInsIdentityKey(payInGroup: SendGroup): string {
    return payInGroup.payIns.reduce((acc, t) => acc + `|${t.id}|`, '');
  }

  private async getFeeAmountInPayInAsset(
    asset: Asset,
    nativeFee: FeeResult,
    priceRequestCorrelationId: string,
    errorMessage: string,
  ): Promise<number | null> {
    try {
      return nativeFee.amount
        ? await this.convertToTargetAsset(nativeFee.asset, nativeFee.amount, asset, priceRequestCorrelationId)
        : 0;
    } catch (e) {
      console.error(errorMessage, e);

      return null;
    }
  }

  private async convertToTargetAsset(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    correlationId: string,
  ): Promise<number> {
    const priceRequest = this.createPriceRequest([sourceAsset.dexName, targetAsset.dexName], correlationId);

    const result = (await this.pricingService.getPrice(priceRequest).catch((e) => {
      console.error('Failed to get price:', e);
      return undefined;
    })) as PriceResult | undefined;

    if (!result) {
      throw new Error(
        `Could not get price from source asset: ${sourceAsset.dexName} to target asset: ${targetAsset.dexName}`,
      );
    }

    return result.price.price ? Util.round(sourceAmount / result.price.price, 8) : 0;
  }

  private createPriceRequest(currencyPair: string[], correlationId: string): PriceRequest {
    return { context: PriceRequestContext.PAY_IN, correlationId, from: currencyPair[0], to: currencyPair[1] };
  }

  protected getTotalGroupAmount(payInGroup: SendGroup): number {
    return Util.sumObj<CryptoInput>(payInGroup.payIns, 'amount');
  }

  protected topUpCoin(payInGroup: SendGroup, amount: number): Promise<string> {
    const { sourceAddress } = payInGroup;

    return this.payInEvmService.sendNativeCoinFromDex(sourceAddress, amount);
  }

  private async dispatch(payInGroup: SendGroup, type: SendType, estimatedNativeFee: number): Promise<void> {
    const outTxId = await this.dispatchSend(payInGroup, estimatedNativeFee);

    const updatedPayIns = this.updatePayInsWithSendData(payInGroup, outTxId, type);

    await this.saveUpdatedPayIns(updatedPayIns);
  }

  private updatePayInsWithSendData(payInGroup: SendGroup, outTxId: string, type: SendType): CryptoInput[] {
    return payInGroup.payIns.map((p) => this.updatePayInWithSendData(p, type, outTxId)).filter((p) => p != null);
  }

  private async saveUpdatedPayIns(payIns: CryptoInput[]): Promise<void> {
    for (const payIn of payIns) {
      await this.payInRepo.save(payIn);
    }
  }
}
