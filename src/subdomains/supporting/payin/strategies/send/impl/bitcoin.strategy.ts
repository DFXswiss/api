import { Injectable } from '@nestjs/common';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { SendType } from './base/send.strategy';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { JellyfishStrategy } from './base/jellyfish.strategy';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  constructor(protected readonly bitcoinService: PayInBitcoinService, protected readonly payInRepo: PayInRepository) {
    super(bitcoinService, payInRepo, Blockchain.BITCOIN);
  }
  logger = new DfxLogger(BitcoinStrategy);

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    this.logger.info(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} Bitcoin input(s): ${payIns.map(
        (p) => p.id,
      )}`,
    );

    await this.bitcoinService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        this.designateSend(payIn, type);
        const { outTxId, feeAmount } = await this.bitcoinService.sendUtxo(payIn);
        this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        this.logger.error(`Failed to send Bitcoin input ${payIn.id} of type ${type}`, e);
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.btcOutWalletAddress, Blockchain.BITCOIN);
  }

  protected async isConfirmed(payIn: CryptoInput): Promise<boolean> {
    const { confirmations } = await this.jellyfishService.getTx(payIn.inTxId);
    return confirmations >= 1;
  }
}
