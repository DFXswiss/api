import { Injectable } from '@nestjs/common';
import { LndPaymentDto, LndPaymentStatus, LndSendPaymentResponseDto } from 'src/integration/lightning/dto/lnd.dto';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningAddressType, LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { Util } from 'src/shared/utils/util';

@Injectable()
export class PayoutLightningService {
  private static MAX_HOURS = 24;

  private readonly client: LightningClient;

  constructor(private lightningService: LightningService) {
    this.client = lightningService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    try {
      const info = await this.client.getLndInfo();

      return 0 < info.num_active_channels && info.synced_to_chain;
    } catch {
      return false;
    }
  }

  async getEstimatedFee(address: string, amount: number): Promise<number> {
    const publicKey = await this.lightningService.getPublicKeyOfAddress(address);

    const routes = await this.client.getLndRoutes(publicKey, amount);

    const maxFeeMsat = Math.max(...routes.map((r) => r.total_fees_msat), 0);

    return LightningHelper.msatToBtc(maxFeeMsat);
  }

  async sendPayment(address: string, amount: number): Promise<string> {
    const addressType = LightningHelper.getAddressType(address);

    let paymentResponse: LndSendPaymentResponseDto;

    switch (addressType) {
      case LightningAddressType.LN_URL: {
        const invoice = await this.lightningService.getInvoiceByLnurlp(address, amount);
        paymentResponse = await this.client.sendPaymentByInvoice(invoice);
        break;
      }

      case LightningAddressType.LN_NID: {
        const publicKey = await this.lightningService.getPublicKeyOfAddress(address);
        paymentResponse = await this.client.sendPaymentByPublicKey(publicKey, amount);
        break;
      }

      case LightningAddressType.LND_HUB: {
        const invoice = await this.lightningService.getInvoiceByLndhub(address, amount);
        paymentResponse = await this.client.sendPaymentByInvoice(invoice);
        break;
      }

      default:
        throw new Error(`Unknown address type ${addressType} in send payment`);
    }

    if (paymentResponse.payment_error) {
      throw new Error(`Error while sending payment by LNURL ${address}: ${paymentResponse.payment_error}`);
    }

    return Buffer.from(paymentResponse.payment_hash, 'base64').toString('hex');
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    const foundPayment = await this.findPayment(new Date(), payoutTxId);

    let isComplete = false;
    let payoutFee = 0;

    if (foundPayment) {
      isComplete = foundPayment.status === LndPaymentStatus.SUCCEEDED;
      payoutFee = LightningHelper.satToBtc(foundPayment.fee_sat);
    }

    return [isComplete, payoutFee];
  }

  private async findPayment(toDate: Date, payoutTxId: string): Promise<LndPaymentDto> {
    let loopToDate = toDate;
    let loopFromDate = Util.hourBefore(1, loopToDate);

    for (let hour = 0; hour < PayoutLightningService.MAX_HOURS; hour++) {
      const payments = await this.client.listPayments(loopFromDate, loopToDate);
      const foundPayment = payments.find((p) => p.payment_hash === payoutTxId);

      if (foundPayment) return foundPayment;

      loopToDate = Util.hourBefore(1, loopToDate);
      loopFromDate = Util.hourBefore(1, loopToDate);
    }

    return null;
  }
}
