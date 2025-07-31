import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInZanoService } from '../../../services/payin-zano.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';
import { SendType } from './base/send.strategy';

@Injectable()
export class ZanoStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(ZanoStrategy);

  constructor(private readonly payInZanoService: PayInZanoService, readonly payInRepo: PayInRepository) {
    super(payInZanoService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
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

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented.');
  }

  async checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean> {
    return this.payInZanoService.checkTransactionCompletion(txId, minConfirmations);
  }
}
