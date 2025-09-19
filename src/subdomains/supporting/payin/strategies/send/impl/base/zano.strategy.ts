import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { LogLevel } from 'src/shared/services/dfx-logger';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInZanoService } from 'src/subdomains/supporting/payin/services/payin-zano.service';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { BitcoinBasedStrategy } from './bitcoin-based.strategy';
import { SendType } from './send.strategy';

export abstract class ZanoStrategy extends BitcoinBasedStrategy {
  constructor(readonly payInZanoService: PayInZanoService, readonly payInRepo: PayInRepository) {
    super(payInZanoService, payInRepo);
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented.');
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    if (type === SendType.FORWARD) {
      // no forwarding required
      throw new Error('Zano inputs not required to forward');
    } else {
      this.logger.verbose(`Returning ${payIns.length} Zano input(s): ${payIns.map((p) => p.id)}`);

      await this.payInZanoService.checkHealthOrThrow();

      for (const payIn of payIns) {
        try {
          this.designateSend(payIn, type);

          const { feeInputAsset: fee, maxFeeInputAsset: maxFee } = await this.getEstimatedForwardFee(
            payIn.asset,
            payIn.amount,
            payIn.destinationAddress.address,
          );

          CryptoInput.verifyForwardFee(fee, payIn.maxForwardFee, maxFee, payIn.amount);

          const { outTxId, feeAmount } = await this.payInZanoService.sendTransfer(payIn);
          await this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

          await this.payInRepo.save(payIn);
        } catch (e) {
          if (e.message.includes('No maximum fee provided')) continue;

          const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

          this.logger.log(logLevel, `Failed to send Zano input ${payIn.id} of type ${type}:`, e);
        }
      }
    }
  }

  async checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean> {
    return this.payInZanoService.checkTransactionCompletion(txId, minConfirmations);
  }
}
