import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { ForwardStrategy } from './forward.strategy';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { FeeRequest, FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Util } from 'src/shared/utils/util';
import { PriceRequest, PriceResult } from 'src/subdomains/supporting/pricing/interfaces';
import { PriceRequestContext } from 'src/subdomains/supporting/pricing/enums';

export interface SendGroup {
  destinationAddress: string;
  asset: Asset;
  payIns: CryptoInput[];
}
export abstract class EvmStrategy extends ForwardStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payoutService: PayoutService,
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
    protected readonly blockchain: Blockchain,
  ) {
    super();
  }

  protected abstract dispatchSend(payInGroup: SendGroup): Promise<string>;

  async doForward(payIns: CryptoInput[]): Promise<void> {
    const groups = this.groupPayInsByAddressAndAsset(payIns);

    for (const payInGroup of [...groups.values()]) {
      try {
        const estimatedFee = await this.getEstimatedFee(payInGroup);
        const totalGroupAmount = this.getTotalGroupAmount(payInGroup);

        CryptoInput.verifyEstimatedFee(estimatedFee, totalGroupAmount);

        const outTxId = await this.dispatchSend(payInGroup);

        const updatedPayIns = this.updatePayInsWithForwardData(payInGroup, outTxId);

        await this.saveUpdatedPayIns(updatedPayIns);
      } catch (e) {
        console.error(`Failed to forward ${this.blockchain} input(s) ${this.getPayInsIdentityKey(payInGroup)}:`, e);
      }
    }
  }

  //*** HELPER METHODS ***//

  private groupPayInsByAddressAndAsset(payIns: CryptoInput[]): Map<string, SendGroup> {
    const groups = new Map<string, SendGroup>();

    for (const payIn of payIns) {
      const { address, asset } = payIn;

      const group = groups.get(this.getPayInGroupKey(payIn));

      if (!group) {
        groups.set(this.getPayInGroupKey(payIn), {
          destinationAddress: address.address,
          asset: asset,
          payIns: [payIn],
        });

        continue;
      }

      group.payIns.push(payIn);
    }

    return groups;
  }

  private getPayInGroupKey(payIn: CryptoInput): string {
    return `${payIn.address.address}&${payIn.asset.dexName}&${payIn.asset.type}`;
  }

  private async getEstimatedFee(payInGroup: SendGroup): Promise<number> {
    const feeRequest = await this.createFeeRequest(payInGroup.asset);

    const nativeCoinFee = await this.payoutService.estimateFee(feeRequest);
    return this.getFeeAmountForInPayInGroup(payInGroup, nativeCoinFee);
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

  private updatePayInsWithForwardData(payInGroup: SendGroup, outTxId: string): CryptoInput[] {
    return payInGroup.payIns.map((p) => p.forward(outTxId));
  }

  private async saveUpdatedPayIns(payIns: CryptoInput[]): Promise<void> {
    for (const payIn of payIns) {
      await this.payInRepo.save(payIn);
    }
  }
}
