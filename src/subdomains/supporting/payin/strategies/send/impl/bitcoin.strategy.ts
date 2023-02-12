import { Injectable } from '@nestjs/common';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { SendType } from './base/send.strategy';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { JellyfishStrategy } from './base/jellyfish.strategy';

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  constructor(protected readonly bitcoinService: PayInBitcoinService, protected readonly payInRepo: PayInRepository) {
    super(bitcoinService, payInRepo, 1, Blockchain.BITCOIN);
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    console.log(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} Bitcoin input(s).`,
      payIns.map((p) => p.id),
    );

    await this.bitcoinService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        this.designateSend(payIn, type);
        const { outTxId, feeAmount } = await this.bitcoinService.sendUtxo(payIn);
        this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        console.error(`Failed to send Bitcoin input ${payIn.id} of type ${type}`, e);
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.btcOutWalletAddress, Blockchain.BITCOIN);
  }
}
