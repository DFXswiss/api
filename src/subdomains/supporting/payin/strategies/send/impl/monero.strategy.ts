import { Injectable } from '@nestjs/common';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInMoneroService } from '../../../services/payin-monero.service';
import { SendStrategy, SendType } from './base/send.strategy';

@Injectable()
export class MoneroStrategy extends SendStrategy {
  protected readonly logger = new DfxLogger(MoneroStrategy);

  constructor(private readonly payInMoneroService: PayInMoneroService, private readonly payInRepo: PayInRepository) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    const isHealthy = await this.payInMoneroService.isHealthy();
    if (!isHealthy) throw new Error('Monero Node is unhealthy');

    for (const payIn of payIns) {
      try {
        this.designateSend(payIn, type);

        const { txid, fee } = await this.payInMoneroService.sendTransfer(payIn, type);
        this.updatePayInWithSendData(payIn, type, txid, fee);

        await this.payInRepo.save(payIn);
      } catch (e) {
        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;
        this.logger.log(logLevel, `Failed to send Monero input ${payIn.id} of type ${type}:`, e);
      }
    }
  }

  async checkConfirmations(payIns: CryptoInput[]): Promise<void> {
    const isHealthy = await this.payInMoneroService.isHealthy();
    if (!isHealthy) throw new Error('Monero Node is unhealthy');

    for (const payIn of payIns) {
      try {
        const transaction = await this.payInMoneroService.getTransaction(payIn.inTxId);

        if (MoneroHelper.isTransactionComplete(transaction)) {
          payIn.confirm();
          await this.payInRepo.save(payIn);
        }
      } catch (e) {
        this.logger.error(`Failed to check confirmations of ${this.blockchain} input ${payIn.id}:`, e);
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented.');
  }
}
