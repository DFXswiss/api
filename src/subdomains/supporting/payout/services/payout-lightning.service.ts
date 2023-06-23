import { Injectable } from '@nestjs/common';
import { LndPaymentDto, LndPaymentStatus } from 'src/integration/lightning/dto/lnd.dto';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';

@Injectable()
export class PayoutLightningService {
  private static HOUR_IN_MILLIS = 60 * 60 * 1000;
  private static MAX_HOURS = 24;

  constructor(private lightningService: LightningService) {}

  async isHealthy(): Promise<boolean> {
    try {
      const info = await this.lightningService.getLndInfo();

      return 0 < info.num_active_channels && info.synced_to_chain;
    } catch {
      return false;
    }
  }

  async getEstimatedFee(publicKey: string, amount: number): Promise<number> {
    const routes = await this.lightningService.getLndRoutes(publicKey, amount);

    const maxFeeMsat = Math.max(...routes.map((r) => r.total_fees_msat), 0);

    return LightningHelper.msatToBtc(maxFeeMsat);
  }

  async sendPaymentByLnurl(lnurlAddress: string, amount: number): Promise<string> {
    const invoice = await this.getInvoiceByLnurl(lnurlAddress, LightningHelper.btcToMsat(amount));

    const paymentResponse = await this.lightningService.sendPaymentByInvoice(invoice);

    if (paymentResponse.payment_error) {
      throw new Error(`Error while sending payment by LNURL ${lnurlAddress}: ${paymentResponse.payment_error}`);
    }

    return Buffer.from(paymentResponse.payment_hash, 'base64').toString('hex');
  }

  private async getInvoiceByLnurl(lnurlpAddress: string, amount: number): Promise<string> {
    const invoice = await this.lightningService.getInvoiceByLnurlp(lnurlpAddress, amount);
    return invoice.pr;
  }

  async sendPaymentByLnnid(lnnidAddress: string, amount: number): Promise<string> {
    const publicKey = await this.lightningService.getPublicKeyOfAddress(lnnidAddress);
    const paymentResponse = await this.lightningService.sendPaymentByPublicKey(
      publicKey,
      LightningHelper.btcToSat(amount),
    );

    if (paymentResponse.payment_error) {
      throw new Error(`Error while sending payment by LNNID ${lnnidAddress}: ${paymentResponse.payment_error}`);
    }

    return Buffer.from(paymentResponse.payment_hash, 'base64').toString('hex');
  }

  async sendPaymentByLndhub(lndhubAddress: string, amount: number): Promise<string> {
    const invoice = await this.getInvoiceByLndhub(lndhubAddress, amount);

    const paymentResponse = await this.lightningService.sendPaymentByInvoice(invoice);

    if (paymentResponse.payment_error) {
      throw new Error(`Error while sending payment by LNDHUB ${lndhubAddress}: ${paymentResponse.payment_error}`);
    }

    return Buffer.from(paymentResponse.payment_hash, 'base64').toString('hex');
  }

  private async getInvoiceByLndhub(lndHubAddress: string, amount: number): Promise<string> {
    const invoice = await this.lightningService.getInvoiceByLndhub(lndHubAddress, amount);
    return invoice.payment_request;
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    const foundPayment = await this.findPayment(Date.now(), payoutTxId);

    let isComplete = false;
    let payoutFee = 0;

    if (foundPayment) {
      isComplete = foundPayment.status === LndPaymentStatus.SUCCEEDED;
      payoutFee = LightningHelper.satToBtc(foundPayment.fee_sat);
    }

    return [isComplete, payoutFee];
  }

  private async findPayment(toDate: number, payoutTxId: string): Promise<LndPaymentDto> {
    let loopToDate = toDate;
    let loopFromDate = loopToDate - PayoutLightningService.HOUR_IN_MILLIS;

    for (let hour = 0; hour < PayoutLightningService.MAX_HOURS; hour++) {
      const payments = await this.lightningService.listPayments(loopFromDate, loopToDate);
      const foundPayments = payments.filter((p) => p.payment_hash === payoutTxId);

      if (foundPayments.length === 1) return foundPayments[0];

      loopToDate = loopToDate - PayoutLightningService.HOUR_IN_MILLIS;
      loopFromDate = loopToDate - PayoutLightningService.HOUR_IN_MILLIS;
    }

    return null;
  }
}
