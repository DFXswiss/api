import { ethers } from 'ethers';
import { Config } from 'src/config/config';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
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

  constructor(
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
  ) {
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
          // Reset individual stale pay-ins whose prepare tx was never mined
          for (const payIn of payInGroup.payIns) {
            if (payIn.updated < Util.hoursBefore(1)) {
              this.logger.warn(`Resetting stale Preparing input ${payIn.id} — prepare tx not found after 1h`);
              payIn.resetPreparation();
              await this.payInRepo.save(payIn);
            }
          }

          // Re-check: if any pay-ins were reset, skip this group (they'll be re-grouped next cycle)
          if (payInGroup.payIns.some((p) => p.status === PayInStatus.ACKNOWLEDGED)) continue;

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
          await this.payInRepo.update(...payIn.confirm(direction, this.forwardRequired));
        } else if (direction === PayInConfirmationType.OUTPUT && Util.minutesDiff(payIn.updated) > 30) {
          await this.resetForward(payIn, 'timed out');
        }
      } catch (e) {
        if (direction === PayInConfirmationType.OUTPUT && e.message.includes('has failed')) {
          await this.resetForward(payIn, 'failed:', e);
        } else if (
          direction === PayInConfirmationType.INPUT &&
          (e.code === ethers.errors.INVALID_ARGUMENT || e.message.includes('has failed'))
        ) {
          this.logger.error(
            `Permanent error on input TX ${payIn.inTxId} of ${this.blockchain} pay-in ${payIn.id}, marking as failed:`,
            e,
          );
          await this.payInRepo.update(...payIn.fail());
        } else {
          this.logger.error(`Failed to check confirmations of ${this.blockchain} pay-in ${payIn.id}:`, e);
        }
      }
    }
  }

  //*** HELPER METHODS ***//

  private logInput(payIns: CryptoInput[], type: SendType): void {
    const newPayIns = payIns.filter((p) => p.status !== PayInStatus.PREPARING);

    if (newPayIns.length > 0)
      this.logger.verbose(
        `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${newPayIns.length} ${this.blockchain} ${
          payIns[0].asset.type
        } input(s): ${newPayIns.map((p) => p.id)}`,
      );
  }

  protected groupPayIns(payIns: CryptoInput[], type: SendType): Map<SendGroupKey, SendGroup> {
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

  protected getPayInsIdentityKey(payInGroup: SendGroup): string {
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
    // Persist the in-flight marker before broadcasting: a crash after the send but before the
    // transaction ID is saved must not leave the group re-selectable by the minute cron.
    const previousStatuses = new Map(payInGroup.payIns.map((payIn) => [payIn.id, payIn.status]));
    for (const payIn of payInGroup.payIns) {
      payIn.designateSending();
      await this.payInRepo.save(payIn);
    }

    let outTxId: string | undefined;
    try {
      outTxId = await this.dispatchSend(payInGroup, type, estimatedNativeFee);

      const updatedPayIns = await this.updatePayInsWithSendData(payInGroup, outTxId, type);

      await this.saveUpdatedPayIns(updatedPayIns);
    } catch (e) {
      if (e instanceof TxBroadcastError || outTxId !== undefined) {
        // The broadcast boundary was reached and the transaction may be in flight. Fail closed by
        // keeping SENDING; the cron escalation moves the group to SEND_UNCERTAIN for investigation.
        if (outTxId !== undefined) {
          this.logger.error(
            `Failed to persist EVM send transaction ${outTxId} for pay-ins ${payInGroup.payIns
              .map((payIn) => payIn.id)
              .join(', ')}:`,
            e,
          );
        }
        throw e;
      }

      // A plain error before a transaction ID was obtained is provably pre-broadcast. Restore each
      // member's captured status so the next cron run can retry it.
      for (const payIn of payInGroup.payIns) {
        payIn.status = previousStatuses.get(payIn.id);
        await this.payInRepo.save(payIn);
      }

      throw e;
    }
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

  private async resetForward(payIn: CryptoInput, msg: string, error?: Error): Promise<void> {
    this.logger.warn(`Out TX ${payIn.outTxId} of pay-in ${payIn.id} has ${msg}`, error);

    payIn.resetForward();
    await this.payInRepo.save(payIn);
  }
}
