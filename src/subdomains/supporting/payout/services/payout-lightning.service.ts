import { Injectable } from '@nestjs/common';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';

@Injectable()
export class PayoutLightningService {
  private readonly client: LightningClient;

  constructor(private readonly lightningService: LightningService) {
    this.client = lightningService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  async getEstimatedFee(address: string, amount: number): Promise<number> {
    const publicKey = await this.lightningService.getPublicKeyOfAddress(address);

    const routes = await this.client.getLndRoutes(publicKey, amount);

    const maxFeeMsat = Math.max(...routes.map((r) => r.total_fees_msat), 0);

    return LightningHelper.msatToBtc(maxFeeMsat);
  }

  async sendPayment(address: string, amount: number): Promise<string> {
    return this.lightningService.sendTransfer(address, amount);
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.lightningService.getTransferCompletionData(payoutTxId);
  }
}
