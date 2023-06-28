import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { FeeLimitExceededException } from 'src/shared/payment/exceptions/fee-limit-exceeded.exception';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { JellyfishStrategy } from './base/jellyfish.strategy';
import { SendType } from './base/send.strategy';

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  protected readonly logger = new DfxLogger(BitcoinStrategy);

  constructor(protected readonly bitcoinService: PayInBitcoinService, protected readonly payInRepo: PayInRepository) {
    super(bitcoinService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    if (payIns.length === 0) return;

    this.logger.verbose(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} Bitcoin input(s): ${payIns.map(
        (p) => p.id,
      )}`,
    );

    await this.bitcoinService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        const { targetFee } = await this.getEstimatedFee(payIn.asset, payIn.amount);
        const minInputFee = await this.getMinInputFee(payIn.asset);

        CryptoInput.verifyEstimatedFee(targetFee, minInputFee, payIn.amount);

        this.designateSend(payIn, type);
        const { outTxId, feeAmount } = await this.bitcoinService.sendUtxo(payIn);
        this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

        this.logger.log(logLevel, `Failed to send Bitcoin input ${payIn.id} of type ${type}:`, e);
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.btcOutput.address, Blockchain.BITCOIN);
  }

  protected async isConfirmed(payIn: CryptoInput): Promise<boolean> {
    const { confirmations } = await this.jellyfishService.getTx(payIn.inTxId);
    return confirmations >= 1;
  }
}
