import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInJellyfishService } from 'src/subdomains/supporting/payin/services/base/payin-jellyfish.service';
import { SendStrategy } from './send.strategy';

export abstract class JellyfishStrategy extends SendStrategy {
  constructor(
    protected readonly jellyfishService: PayInJellyfishService,
    protected readonly payInRepo: PayInRepository,
    protected readonly confirmationBlocksCount: number,
    protected readonly blockchain: Blockchain,
  ) {
    super();
  }

  async checkConfirmations(payIns: CryptoInput[]): Promise<void> {
    await this.jellyfishService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        const txToConfirm = this.blockchain === Blockchain.BITCOIN ? payIn.inTxId : payIn.outTxId;
        const { confirmations } = await this.jellyfishService.getTx(txToConfirm);
        if (confirmations > this.confirmationBlocksCount) {
          payIn.confirm();

          await this.payInRepo.save(payIn);
        }
      } catch (e) {
        console.error(`Failed to check confirmations of ${this.blockchain} input ${payIn.id}:`, e);
      }
    }
  }
}
