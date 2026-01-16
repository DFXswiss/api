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

  constructor(
    private readonly lightningService: PayInLightningService,
    private readonly payInRepo: PayInRepository,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.LIGHTNING;
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
      throw new Error('Lightning inputs not required to forward');
    } else {
      this.logger.verbose(`Returning ${payIns.length} Lightning input(s): ${payIns.map((p) => p.id)}`);

      await this.lightningService.checkHealthOrThrow();

      for (const payIn of payIns) {
        try {
          this.designateSend(payIn, type);

          const { feeInputAsset: fee, maxFeeInputAsset: maxFee } = await this.getEstimatedForwardFee(
            payIn.asset,
            payIn.amount,
            payIn.destinationAddress.address,
          );

          CryptoInput.verifyForwardFee(fee, payIn.maxForwardFee, maxFee, payIn.amount);

          const { outTxId, feeAmount } = await this.lightningService.sendTransfer(payIn);
          await this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

          await this.payInRepo.save(payIn);
        } catch (e) {
          if (e.message.includes('No maximum fee provided')) continue;

          const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

          this.logger.log(logLevel, `Failed to send Lightning input ${payIn.id} of type ${type}:`, e);
        }
      }
    }
  }

  async checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void> {
    for (const payIn of payIns) {
      await this.payInRepo.update(...payIn.confirm(direction, this.forwardRequired));
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented.');
  }
}
