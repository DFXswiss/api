import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Observable, Subject } from 'rxjs';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import {
  FiatRepublicPaymentDirection,
  FiatRepublicPaymentResponse,
  FiatRepublicWebhookPayload,
  FiatRepublicWebhookSignatureHeaders,
} from '../dto/fiat-republic.dto';

/** Prefix Fiat Republic uses for its signature label in both the input and the signature header. */
const SIGNATURE_LABEL = 'fr1=';

@Injectable()
export class FiatRepublicWebhookService {
  private readonly logger = new DfxLogger(FiatRepublicWebhookService);

  private readonly paymentSubject = new Subject<FiatRepublicPaymentResponse>();

  /**
   * Verifies a webhook against the draft HTTP Message Signatures scheme Fiat Republic implements:
   * a `sha1` digest of the raw body, folded into a fixed signature base together with the
   * `signature-input` recipe, then HMAC-SHA256'd with the endpoint's secret key.
   *
   * The digest is always recomputed from the raw body rather than trusted from the header, so a
   * tampered body cannot be paired with a matching header pair. Fails closed on every missing part,
   * including a missing local secret: an unconfigured endpoint must reject, never accept.
   */
  isValidSignature(rawBody: Buffer | string, headers: FiatRepublicWebhookSignatureHeaders): boolean {
    const { webhookSecret } = Config.bank.fiatRepublic;
    if (!webhookSecret) return false;

    const { signatureInput, signature } = headers;
    if (!signatureInput?.startsWith(SIGNATURE_LABEL) || !signature?.startsWith(SIGNATURE_LABEL)) return false;

    const receivedSignature = signature.slice(SIGNATURE_LABEL.length).replace(/^:|:$/g, '');
    if (!receivedSignature) return false;

    const digest = Util.createHash(rawBody, 'sha1', 'hex');
    // The header digest is optional evidence only; when present it must agree with what we computed.
    if (headers.digest && headers.digest !== digest) return false;

    const signatureParams = signatureInput.slice(SIGNATURE_LABEL.length);
    const signatureBase = `"digest": "${digest}"\n@signature-params: ${signatureParams}`;
    const expectedSignature = Util.createHmac(webhookSecret, signatureBase, 'sha256', 'hex');

    return this.isEqual(receivedSignature, expectedSignature);
  }

  /**
   * Accepts a verified webhook. Only completed payins are forwarded — every other event is a state
   * change we either do not act on or learn about through our own polling. Deliberately silent
   * (not an error) for those: Fiat Republic sends the full event catalogue to one endpoint.
   */
  processWebhook(payload: FiatRepublicWebhookPayload<FiatRepublicPaymentResponse>): void {
    try {
      if (!payload?.event?.startsWith('PAYMENT.')) return;

      const payment = payload.data;
      if (!payment?.id) {
        this.logger.error(`Received Fiat Republic payment event ${payload.event} without a payment id`);
        return;
      }

      if (payment.direction !== FiatRepublicPaymentDirection.PAYIN) return;

      this.paymentSubject.next(payment);
    } catch (e) {
      // Never echo the payload: it carries payer names and bank details.
      this.logger.error(`Failed to process Fiat Republic webhook event ${payload?.event}:`, e);
      throw new InternalServerErrorException('Failed to process webhook');
    }
  }

  getPaymentObservable(): Observable<FiatRepublicPaymentResponse> {
    return this.paymentSubject.asObservable();
  }

  private isEqual(received: string, expected: string): boolean {
    const receivedBuffer = Buffer.from(received, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    // timingSafeEqual throws on differing lengths, which would itself leak the length — compare the
    // lengths first and only then run the constant-time comparison.
    return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  }
}
