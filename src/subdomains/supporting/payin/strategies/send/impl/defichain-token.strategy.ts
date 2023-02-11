import { Injectable } from '@nestjs/common';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { SendType } from './base/send.strategy';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { JellyfishStrategy } from './base/jellyfish.strategy';

@Injectable()
export class DeFiChainTokenStrategy extends JellyfishStrategy {
  constructor(
    protected readonly deFiChainService: PayInDeFiChainService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super(deFiChainService, payInRepo, 60, Blockchain.DEFICHAIN);
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    console.log(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} DeFiChain Token input(s).`,
      payIns.map((p) => p.id),
    );

    await this.deFiChainService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        this.designateSend(payIn, type);

        const savedPayIn = await this.payInRepo.save(payIn);
        await this.deFiChainService.sendToken(savedPayIn, (outTxId: string) =>
          // TODO -> this have to be tested carefully
          this.updatePayInWithSendData(savedPayIn, type, outTxId),
        );
      } catch (e) {
        console.error(`Failed to send DeFiChain token input ${payIn.id} of type ${type}`, e);
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.dexWalletAddress, Blockchain.DEFICHAIN);
  }
}
