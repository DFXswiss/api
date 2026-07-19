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
    // A keysend (LN_NID) payment carries no invoice payment_hash, so LND cannot deduplicate a
    // re-broadcast - a self-healing retry could double-pay. Every keysend outcome that is not a
    // confirmed send is therefore treated as ambiguous (fail-closed).
    //
    // Invoice payouts (LN_URL / LND_HUB) still self-heal on in-band payment_error ("no route"),
    // because that proves the payment was not routed. Empty/missing payment hashes after the send
    // are fail-closed for ALL address types: invoice retries fetch a NEW invoice with a different
    // payment_hash, so LND dedup of the original invoice does not protect a second payment.
    const isKeysend = address.startsWith(LightningAddressType.LN_NID);

    try {
      const txId = await this.lightningService.sendTransfer(address, amount);

      // Defence in depth: empty id after send is always ambiguous (all address types).
      if (!txId) throw new PayoutBroadcastException('Lightning payment returned an empty payment hash');

      return txId;
    } catch (e) {
      if (e instanceof PayoutBroadcastException) throw e;
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      if (isKeysend) throw new PayoutBroadcastException(e instanceof Error ? e.message : String(e), { cause: e });

      throw e;
    }
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.lightningService.getTransferCompletionData(payoutTxId);
  }
}
