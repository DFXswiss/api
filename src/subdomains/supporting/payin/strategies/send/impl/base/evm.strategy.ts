import { v4 as uuid } from 'uuid';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { SendGroup, SendGroupKey, SendStrategy, SendType } from './send.strategy';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { FeeRequest, FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { Config } from 'src/config/config';
import { CheckLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';

export abstract class EvmStrategy extends SendStrategy {
  constructor(
    protected readonly dexService: DexService,
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
  protected abstract getAssetRepresentationForFee(asset: Asset): Promise<Asset>;

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

        if ([PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(payInGroup.status)) {
          const { nativeFee, targetFee } = await this.getEstimatedFee(payInGroup);

          /**
           * @note
           * setting to some default minimal amount in case estimated fees go very low.
           */
          const effectivePreparationFee =
            nativeFee > Config.blockchain.evm.minimalPreparationFee
              ? nativeFee
              : Config.blockchain.evm.minimalPreparationFee;

          CryptoInput.verifyEstimatedFee(targetFee, this.getTotalGroupAmount(payInGroup));

          await this.prepareSend(payInGroup, effectivePreparationFee);

          continue;
        }

        if (payInGroup.status === PayInStatus.PREPARED) {
          await this.dispatch(payInGroup, type, this.getTotalSendFee(payInGroup));

          continue;
        }
      } catch (e) {
        console.error(
          `Failed to send ${this.blockchain} input(s) ${this.getPayInsIdentityKey(payInGroup)} of type ${type}`,
          e,
        );

        continue;
      }
    }
  }

  //*** HELPER METHODS ***//

  private logInput(payIns: CryptoInput[], type: SendType): void {
    const newPayIns = payIns.filter((p) => p.status !== PayInStatus.PREPARING);

    newPayIns.length > 0 &&
      console.log(
        `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${newPayIns.length} ${this.blockchain} ${
          payIns[0].asset.type
        } input(s).`,
        newPayIns.map((p) => p.id),
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
    const errorMessage = `Could not get fee in target asset. Ignoring fee estimate. Native fee asset: ${nativeFee.asset.dexName}, pay-in asset: ${payInGroup.asset.dexName}`;

    return this.getFeeAmountInPayInAsset(payInGroup.asset, nativeFee, errorMessage);
  }

  private getPayInsIdentityKey(payInGroup: SendGroup): string {
    return payInGroup.payIns.reduce((acc, t) => acc + `|${t.id}|`, '');
  }

  private async getFeeAmountInPayInAsset(
    asset: Asset,
    nativeFee: FeeResult,
    errorMessage: string,
  ): Promise<number | null> {
    try {
      return nativeFee.amount ? await this.convertToTargetAsset(nativeFee.asset, nativeFee.amount, asset) : 0;
    } catch (e) {
      console.error(errorMessage, e);

      return null;
    }
  }

  private async convertToTargetAsset(sourceAsset: Asset, sourceAmount: number, targetAsset: Asset): Promise<number> {
    const sourceAssetRepresentation = await this.getAssetRepresentationForFee(sourceAsset);
    const targetAssetRepresentation = await this.getAssetRepresentationForFee(targetAsset);

    if (!sourceAssetRepresentation)
      throw new Error(
        `Cannot proceed with fee conversion, could not find source asset representation for asset ${sourceAsset.dexName} ${sourceAsset.blockchain}`,
      );

    if (!targetAssetRepresentation)
      throw new Error(
        `Cannot proceed with fee conversion, could not find target asset representation for asset ${targetAsset.dexName} ${targetAsset.blockchain}`,
      );

    return await this.getFeeReferenceAmount(sourceAsset, sourceAmount, targetAssetRepresentation);
  }

  private async getFeeReferenceAmount(fromAsset: Asset, fromAmount: number, toAsset: Asset): Promise<number> {
    const request = this.createLiquidityRequest(fromAsset, fromAmount, toAsset);
    const liquidity = await this.dexService.checkLiquidity(request);

    return liquidity.target.amount;
  }

  private createLiquidityRequest(
    referenceAsset: Asset,
    referenceAmount: number,
    targetAsset: Asset,
  ): CheckLiquidityRequest {
    return {
      context: LiquidityOrderContext.PAY_IN,
      correlationId: uuid(),
      referenceAsset,
      referenceAmount,
      targetAsset,
    };
  }

  protected getTotalGroupAmount(payInGroup: SendGroup): number {
    return Util.sumObj<CryptoInput>(payInGroup.payIns, 'amount');
  }

  protected getTotalSendFee(payInGroup: SendGroup): number {
    return Util.sumObj<CryptoInput>(payInGroup.payIns, 'forwardFeeAmount');
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
