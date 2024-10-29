import { Injectable } from '@nestjs/common';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { CryptoInput, PayInConfirmationType } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInMoneroService } from '../../../services/payin-monero.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';
import { SendType } from './base/send.strategy';

@Injectable()
export class MoneroStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(MoneroStrategy);

  constructor(private readonly moneroService: PayInMoneroService, readonly payInRepo: PayInRepository) {
    super(moneroService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get forwardRequired(): boolean {
    return false;
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    if (type === SendType.FORWARD) {
      // no forwarding required
      throw new Error('Monero inputs not required to forward');
    } else {
      this.logger.verbose(`Returning ${payIns.length} Monero input(s): ${payIns.map((p) => p.id)}`);

      await this.moneroService.checkHealthOrThrow();

      for (const payIn of payIns) {
        try {
          this.designateSend(payIn, type);

          const { targetFee } = await this.getEstimatedFee(payIn.asset, payIn.amount, payIn.destinationAddress.address);
          const minInputFee = await this.getMinInputFee(payIn.asset);

          CryptoInput.verifyEstimatedFee(targetFee, minInputFee, payIn.amount);

          const { outTxId, feeAmount } = await this.moneroService.sendTransfer(payIn);
          this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

          await this.payInRepo.save(payIn);
        } catch (e) {
          const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

          this.logger.log(logLevel, `Failed to send Monero input ${payIn.id} of type ${type}:`, e);
        }
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented.');
  }

  protected async isConfirmed(payIn: CryptoInput, direction: PayInConfirmationType): Promise<boolean> {
    const transaction = await this.moneroService.getTransaction(payIn.confirmationTxId(direction));
    return MoneroHelper.isTransactionComplete(transaction);
  }
}
