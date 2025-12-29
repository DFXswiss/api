import { Config } from 'src/config/config';
import { LogLevel } from 'src/shared/services/dfx-logger';
import {
  CryptoInput,
  PayInConfirmationType,
  PayInStatus,
} from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInSolanaService } from 'src/subdomains/supporting/payin/services/payin-solana.service';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { SendStrategy, SendType } from './send.strategy';

export abstract class SolanaStrategy extends SendStrategy {
  constructor(
    protected readonly payInSolanaService: PayInSolanaService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super();
  }

  protected abstract checkPreparation(payIn: CryptoInput): Promise<boolean>;
  protected abstract prepareSend(payIn: CryptoInput, estimatedNativeFee: number): Promise<void>;
  protected abstract sendTransfer(payIn: CryptoInput, type: SendType): Promise<string>;

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    for (const payIn of payIns) {
      try {
        this.designateSend(payIn, type);

        if (payIn.status === PayInStatus.PREPARING) {
          const isReady = await this.checkPreparation(payIn);

          if (isReady) {
            payIn.status = PayInStatus.PREPARED;
          } else {
            continue;
          }
        }

        if ([PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(payIn.status)) {
          const { feeNativeAsset, feeInputAsset, maxFeeInputAsset } = await this.getEstimatedForwardFee(
            payIn.asset,
            payIn.amount,
            payIn.destinationAddress.address,
          );

          CryptoInput.verifyForwardFee(feeInputAsset, payIn.maxForwardFee, maxFeeInputAsset, payIn.amount);

          /**
           * @note
           * setting to some default minimal amount in case estimated fees go very low.
           */
          const effectivePreparationFee = Math.max(feeNativeAsset, Config.blockchain.solana.minimalPreparationFee);

          await this.prepareSend(payIn, effectivePreparationFee);

          continue;
        }

        if (payIn.status === PayInStatus.PREPARED) {
          const outTxId = await this.sendTransfer(payIn, type);
          await this.updatePayInWithSendData(payIn, type, outTxId, payIn.forwardFeeAmount);

          await this.payInRepo.save(payIn);
        }
      } catch (e) {
        if (e.message.includes('No maximum fee provided')) continue;

        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

        this.logger.log(logLevel, `Failed to send ${this.blockchain} input ${payIn.id} of type ${type}:`, e);
      }
    }
  }

  async checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void> {
    for (const payIn of payIns) {
      try {
        if (!payIn.confirmationTxId(direction)) continue;

        const minConfirmations = await this.getMinConfirmations(payIn, direction);

        const isConfirmed = await this.payInSolanaService.checkTransactionCompletion(
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

  protected topUpCoin(payIn: CryptoInput, amount: number): Promise<string> {
    return this.payInSolanaService.sendNativeCoinFromDex(payIn.address.address, amount);
  }
}
