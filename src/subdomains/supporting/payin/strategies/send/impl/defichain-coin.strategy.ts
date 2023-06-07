import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { JellyfishStrategy } from './base/jellyfish.strategy';
import { SendType } from './base/send.strategy';

@Injectable()
export class DeFiChainCoinStrategy extends JellyfishStrategy {
  protected readonly logger = new DfxLogger(DeFiChainCoinStrategy);

  blockchain = Blockchain.DEFICHAIN;
  assetType = AssetType.COIN;

  constructor(
    protected readonly deFiChainService: PayInDeFiChainService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super(deFiChainService, payInRepo);
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    this.logger.verbose(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} DeFiChain coin input(s): ${payIns.map(
        (p) => p.id,
      )}`,
    );

    const currentHeight = await this.deFiChainService.getCurrentHeight();

    for (const payIn of payIns) {
      try {
        // only forward block rewards, which are older than 100 blocks
        if (payIn.txType === 'blockReward' && currentHeight <= payIn.blockHeight + 100) continue;

        this.designateSend(payIn, type);

        const { outTxId, feeAmount } = await this.deFiChainService.sendUtxo(payIn);
        this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        this.logger.error(`Failed to send DeFiChain coin input ${payIn.id} of type ${type}:`, e);
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.dex.address, Blockchain.DEFICHAIN);
  }

  protected async isConfirmed(payIn: CryptoInput): Promise<boolean> {
    if (!payIn.outTxId) return false;

    const { confirmations } = await this.jellyfishService.getTx(payIn.outTxId);
    return confirmations >= 60;
  }
}
