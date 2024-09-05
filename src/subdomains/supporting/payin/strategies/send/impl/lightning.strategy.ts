import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { CryptoInput, PayInConfirmationType } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInLightningService } from '../../../services/payin-lightning.service';
import { SendStrategy, SendType } from './base/send.strategy';

@Injectable()
export class LightningStrategy extends SendStrategy {
  protected readonly logger = new DfxLogger(LightningStrategy);

  constructor(private readonly lightningService: PayInLightningService, private readonly payInRepo: PayInRepository) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.LIGHTNING;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    if (type === SendType.FORWARD) {
      // no forwarding required
      for (const payIn of payIns) {
        payIn.completed();
        await this.payInRepo.save(payIn);
      }
    } else {
      this.logger.verbose(`Returning ${payIns.length} Lightning input(s): ${payIns.map((p) => p.id)}`);

      await this.lightningService.checkHealthOrThrow();

      for (const payIn of payIns) {
        try {
          this.designateSend(payIn, type);

          const { targetFee } = await this.getEstimatedFee(payIn.asset, payIn.amount, payIn.destinationAddress.address);
          const minInputFee = await this.getMinInputFee(payIn.asset);

          CryptoInput.verifyEstimatedFee(targetFee, minInputFee, payIn.amount);

          const { outTxId, feeAmount } = await this.lightningService.sendTransfer(payIn);
          this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

          await this.payInRepo.save(payIn);
        } catch (e) {
          const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

          this.logger.log(logLevel, `Failed to send Lightning input ${payIn.id} of type ${type}:`, e);
        }
      }
    }
  }

  async checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void> {
    for (const payIn of payIns) {
      payIn.confirm(direction);

      await this.payInRepo.save(payIn);
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented.');
  }
}
