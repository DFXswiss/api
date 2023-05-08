import { Injectable } from '@nestjs/common';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { SendType } from './base/send.strategy';
import { CryptoInput, PayInStatus } from '../../../entities/crypto-input.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { JellyfishStrategy } from './base/jellyfish.strategy';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class DeFiChainTokenStrategy extends JellyfishStrategy {
  constructor(
    protected readonly deFiChainService: PayInDeFiChainService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super(deFiChainService, payInRepo, Blockchain.DEFICHAIN);
  }
  logger = new DfxLogger(DeFiChainTokenStrategy);

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    this.logger.info(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} DeFiChain Token input(s): ${payIns
        .map((p) => p.id)
        .join(', ')}`,
    );

    await this.deFiChainService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        if (payIn.status === PayInStatus.PREPARING) {
          const isReady = await this.checkPreparation(payIn);

          if (isReady) {
            payIn.status = PayInStatus.PREPARED;
          } else {
            continue;
          }
        }

        if ([PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(payIn.status)) {
          await this.prepareSend(payIn);
        }

        if (payIn.status === PayInStatus.PREPARED) {
          await this.dispatch(payIn, type);
        }
      } catch (e) {
        this.logger.error(`Failed to send DeFiChain token input ${payIn.id} of type ${type}`, e);
      }
    }
  }

  protected async prepareSend(payIn: CryptoInput): Promise<void> {
    const feeUtxo = await this.deFiChainService.getFeeUtxo(payIn.address.address);

    if (!feeUtxo) {
      const fee = Config.payIn.minDeposit.DeFiChain.DFI / 2;
      const prepareTxId = await this.deFiChainService.sendFeeUtxo(payIn.address.address, fee);

      payIn.preparing(prepareTxId, fee);
      await this.payInRepo.save(payIn);
    } else {
      payIn.status = PayInStatus.PREPARED;
    }
  }

  protected async checkPreparation(payIn: CryptoInput): Promise<boolean> {
    const { blockhash, confirmations } = await this.deFiChainService.getTx(payIn.prepareTxId);

    return blockhash && confirmations > 0;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.dexWalletAddress, Blockchain.DEFICHAIN);
  }

  protected async isConfirmed(payIn: CryptoInput): Promise<boolean> {
    const { confirmations } = await this.jellyfishService.getTx(payIn.outTxId);
    return confirmations >= 60;
  }

  private async dispatch(payIn: CryptoInput, type: SendType): Promise<void> {
    this.designateSend(payIn, type);

    const utxo = await this.getFeeUtxo(payIn);
    if (!utxo) throw new Error(`Tried to send token from ${payIn.address.address} without UTXO`);

    const outTxId = await this.deFiChainService.sendToken(payIn, utxo);

    this.updatePayInWithSendData(payIn, type, outTxId);

    await this.payInRepo.save(payIn);
    this.logger.info(`Token pay-in ${payIn.id} sent: ${payIn}`);
  }

  private async getFeeUtxo(payIn: CryptoInput): Promise<UTXO> {
    return (
      (await this.deFiChainService.getFeeUtxoByTransaction(payIn.address.address, payIn.prepareTxId)) ??
      (await this.deFiChainService.getFeeUtxo(payIn.address.address))
    );
  }
}
