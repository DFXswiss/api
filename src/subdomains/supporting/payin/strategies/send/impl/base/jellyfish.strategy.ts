import { CryptoInput, PayInConfirmationType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInJellyfishService } from 'src/subdomains/supporting/payin/services/base/payin-jellyfish.service';
import { SendStrategy } from './send.strategy';

export abstract class JellyfishStrategy extends SendStrategy {
  constructor(
    protected readonly jellyfishService: PayInJellyfishService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super();
  }

  protected abstract isConfirmed(payIn: CryptoInput, direction: PayInConfirmationType): Promise<boolean>;

  async checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void> {
    await this.jellyfishService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        if (!payIn.confirmationTxId(direction)) continue;

        const isConfirmed = await this.isConfirmed(payIn, direction);
        if (isConfirmed) {
          payIn.confirm(direction);

          await this.payInRepo.save(payIn);
        }
      } catch (e) {
        this.logger.error(`Failed to check confirmations of ${this.blockchain} input ${payIn.id}:`, e);
      }
    }
  }
}
