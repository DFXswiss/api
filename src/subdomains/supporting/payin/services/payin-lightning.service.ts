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
    const outTxId = await this.service.sendTransfer(payIn.destinationAddress.address, payIn.sendingAmount);
    const [isComplete, feeAmount] = await this.service.getTransferCompletionData(outTxId);
    if (!isComplete) this.logger.error(`Lightning transfer for pay-in ${payIn.id} was not complete`);

    return { outTxId, feeAmount };
  }
}
