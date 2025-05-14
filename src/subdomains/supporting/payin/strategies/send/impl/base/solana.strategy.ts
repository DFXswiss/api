import { LogLevel } from 'src/shared/services/dfx-logger';
import { CryptoInput, PayInConfirmationType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
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

  protected abstract sendTransfer(payIn: CryptoInput): Promise<string>;

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    for (const payIn of payIns) {
      try {
        this.designateSend(payIn, type);

        const { feeInputAsset: fee, maxFeeInputAsset: maxFee } = await this.getEstimatedForwardFee(
          payIn.asset,
          payIn.amount,
          payIn.destinationAddress.address,
        );

        CryptoInput.verifyForwardFee(fee, payIn.maxForwardFee, maxFee, payIn.amount);

        const outTxId = await this.sendTransfer(payIn);
        await this.updatePayInWithSendData(payIn, type, outTxId);

        await this.payInRepo.save(payIn);
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
}
