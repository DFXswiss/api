import { Config } from 'src/config/config';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import {
  CryptoInput,
  PayInConfirmationType,
  PayInStatus,
} from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { SendGroup, SendGroupKey, SendStrategy, SendType } from './send.strategy';

export abstract class EvmStrategy extends SendStrategy {
  protected readonly logger = new DfxLogger(EvmStrategy);

  constructor(protected readonly payInEvmService: PayInEvmService, protected readonly payInRepo: PayInRepository) {
    super();
  }

  protected abstract dispatchSend(payInGroup: SendGroup, type: SendType, estimatedNativeFee: number): Promise<string>;
  protected abstract prepareSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<void>;
  protected abstract checkPreparation(payInGroup: SendGroup): Promise<boolean>;

  get forwardRequired(): boolean {
    return true;
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    this.logInput(payIns, type);

    const groups = this.groupPayIns(payIns, type);

    for (const payInGroup of [...groups.values()]) {
      try {
        if (payInGroup.status === PayInStatus.PREPARING) {
          const isReady = await this.checkPreparation(payInGroup);

          if (isReady) {
            payInGroup.status = PayInStatus.PREPARED;
          }
        }

        if ([PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(payInGroup.status)) {
          const totalAmount = this.getTotalGroupAmount(payInGroup, type);
          const blockchainFee = this.getTotalGroupFeeAmount(payInGroup);

          const { feeNativeAsset, feeInputAsset, maxFeeInputAsset } = await this.getEstimatedForwardFee(
            payInGroup.asset,
            totalAmount,
            this.getForwardAddress().address,
          );

          CryptoInput.verifyForwardFee(feeInputAsset, blockchainFee, maxFeeInputAsset, totalAmount);

          /**
           * @note
           * setting to some default minimal amount in case estimated fees go very low.
           */
          const effectivePreparationFee = Math.max(feeNativeAsset, Config.blockchain.evm.minimalPreparationFee);

          await this.prepareSend(payInGroup, effectivePreparationFee);
        }

        if (payInGroup.status === PayInStatus.PREPARED) {
          await this.dispatch(payInGroup, type, this.getTotalSendFee(payInGroup));
        }
      } catch (e) {
        if (e.message.includes('No maximum fee provided')) continue;

        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

        this.logger.log(
          logLevel,
          `Failed to send ${this.blockchain} input(s) ${this.getPayInsIdentityKey(payInGroup)} of type ${type}:`,
          e,
        );
      }
    }
  }

  async checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void> {
    for (const payIn of payIns) {
      try {
        if (!payIn.confirmationTxId(direction)) continue;

        const minConfirmations = await this.getMinConfirmations(payIn, direction);

        const isConfirmed = await this.payInEvmService.checkTransactionCompletion(
          payIn.confirmationTxId(direction),
          minConfirmations,
        );
        if (isConfirmed) {
          payIn.confirm(direction, this.forwardRequired);
          await this.payInRepo.save(payIn);
        }
      } catch (e) {
        this.logger.error(`Failed to check confirmations of ${this.blockchain} input ${payIn.id}:`, e);
      }
    }
  }

  //*** HELPER METHODS ***//

  private logInput(payIns: CryptoInput[], type: SendType): void {
    const newPayIns = payIns.filter((p) => p.status !== PayInStatus.PREPARING);

    newPayIns.length > 0 &&
      this.logger.verbose(
        `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${newPayIns.length} ${this.blockchain} ${
          payIns[0].asset.type
        } input(s): ${newPayIns.map((p) => p.id)}`,
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
          account: Config.blockchain.evm.walletAccount(payIn.route.deposit.accountIndex),
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

  private getPayInsIdentityKey(payInGroup: SendGroup): string {
    return payInGroup.payIns.reduce((acc, t) => acc + `|${t.id}|`, '');
  }

  protected getTotalGroupAmount(payInGroup: SendGroup, type = SendType.FORWARD): number {
    return Util.sumObjValue<CryptoInput>(payInGroup.payIns, type === SendType.RETURN ? 'chargebackAmount' : 'amount');
  }

  protected getTotalSendFee(payInGroup: SendGroup): number {
    return Util.sumObjValue<CryptoInput>(payInGroup.payIns, 'forwardFeeAmount');
  }

  protected topUpCoin(payInGroup: SendGroup, amount: number): Promise<string> {
    const { sourceAddress } = payInGroup;

    return this.payInEvmService.sendNativeCoinFromDex(sourceAddress, amount);
  }

  private async dispatch(payInGroup: SendGroup, type: SendType, estimatedNativeFee: number): Promise<void> {
    const outTxId = await this.dispatchSend(payInGroup, type, estimatedNativeFee);

    const updatedPayIns = await this.updatePayInsWithSendData(payInGroup, outTxId, type);

    await this.saveUpdatedPayIns(updatedPayIns);
  }

  private async updatePayInsWithSendData(
    payInGroup: SendGroup,
    outTxId: string,
    type: SendType,
  ): Promise<CryptoInput[]> {
    return Promise.all(payInGroup.payIns.map((p) => this.updatePayInWithSendData(p, type, outTxId))).then((p) =>
      p.filter((p) => p != null),
    );
  }

  private async saveUpdatedPayIns(payIns: CryptoInput[]): Promise<void> {
    for (const payIn of payIns) {
      await this.payInRepo.save(payIn);
    }
  }

  private getTotalGroupFeeAmount(payInGroup: SendGroup): number {
    return Util.sum(payInGroup.payIns.map((p) => p.maxForwardFee));
  }
}
