import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
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

  protected abstract isConfirmed(payIn: CryptoInput): Promise<boolean>;

  async checkConfirmations(payIns: CryptoInput[]): Promise<void> {
    await this.jellyfishService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        const isConfirmed = await this.isConfirmed(payIn);
        if (isConfirmed) {
          payIn.confirm();

          await this.payInRepo.save(payIn);
        }
      } catch (e) {
        this.logger.error(`Failed to check confirmations of ${this.blockchain} input ${payIn.id}:`, e);
      }
    }
  }
}
