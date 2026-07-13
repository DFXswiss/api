import { Injectable } from '@nestjs/common';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningAddressType, LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';

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
    try {
      return await this.lightningService.sendTransfer(address, amount);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });

      // A keysend (LN_NID) payment carries no invoice payment_hash, so LND cannot deduplicate a
      // re-broadcast - a self-healing retry could double-pay. Unlike an invoice payment (LN_URL /
      // LND_HUB), we therefore treat every keysend failure as ambiguous (fail-closed): keep the
      // order PAYOUT_DESIGNATED for escalation instead of rolling it back for retry.
      if (address.startsWith(LightningAddressType.LN_NID))
        throw new PayoutBroadcastException(e instanceof Error ? e.message : String(e), { cause: e });

      throw e;
    }
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.lightningService.getTransferCompletionData(payoutTxId);
  }
}
