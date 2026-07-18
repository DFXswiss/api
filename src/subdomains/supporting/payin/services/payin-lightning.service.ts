import { Injectable } from '@nestjs/common';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput } from '../entities/crypto-input.entity';

@Injectable()
export class PayInLightningService {
  private readonly logger = new DfxLogger(PayInLightningService);

  private readonly client: LightningClient;

  constructor(private readonly service: LightningService) {
    this.client = service.getDefaultClient();
  }

  async checkHealthOrThrow(): Promise<void> {
    const isHealthy = await this.client.isHealthy();
    if (!isHealthy) throw new Error('Lightning node is unhealthy');
  }

  async sendTransfer(payIn: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    // Broadcast first; a genuine send failure throws TxBroadcastError from LightningService.
    const outTxId = await this.service.sendTransfer(payIn.destinationAddress.address, payIn.sendingAmount);

    // The completion lookup only supplies fee data. A failure here must NOT mask a completed broadcast:
    // dropping outTxId would let the cron re-send with a new invoice (LND dedup cannot catch it).
    let feeAmount = 0;
    try {
      const [isComplete, fee] = await this.service.getTransferCompletionData(outTxId);
      feeAmount = fee;
      if (!isComplete) this.logger.error(`Lightning transfer for pay-in ${payIn.id} was not complete`);
    } catch (e) {
      this.logger.error(
        `Lightning completion lookup failed after broadcast (tx ${outTxId}) for pay-in ${payIn.id}:`,
        e,
      );
    }

    return { outTxId, feeAmount };
  }
}
