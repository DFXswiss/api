import { OmitType } from '@nestjs/swagger';
import { PaymentWebhookData } from '../../user/services/webhook/dto/payment-webhook.dto';

/**
 * Identifying fields stripped from partner payment *pull* responses
 * (GET /kyc/client/payments, GET /kyc/client/users/:id/payments).
 *
 * Webhook payloads still use the full PaymentWebhookData / TransactionDetailDto.
 * Keep this list the single source of truth for the pull redaction — strip + DTO + tests.
 */
export const PARTNER_PAYMENT_OMITTED_FIELDS = [
  // Customer IBAN / wallet address (TransactionDetailDto)
  'sourceAccount',
  'targetAccount',
  // On-chain / bank transfer identifiers and explorer links
  'inputTxId',
  'inputTxUrl',
  'outputTxId',
  'outputTxUrl',
  // Crypto deposit address (user- or route-bound)
  'depositAddress',
  // Chargeback destination and on-chain / transfer identifiers
  'chargebackTarget',
  'chargebackTxId',
  'chargebackTxUrl',
  // Nested object whose purpose is the network-start tx hash + explorer URL
  'networkStartTx',
] as const;

/**
 * Reduced payment DTO for the partner pull endpoints.
 * Same row set as before the payments-API gate PR; identifying account/tx fields removed.
 */
export class PartnerPaymentDto extends OmitType(PaymentWebhookData, [...PARTNER_PAYMENT_OMITTED_FIELDS]) {}

/** Drop identifying fields from a full payment payload. Does not mutate the input. */
export function toPartnerPaymentDto(full: PaymentWebhookData): PartnerPaymentDto {
  const reduced = { ...full } as PaymentWebhookData & Record<string, unknown>;
  for (const key of PARTNER_PAYMENT_OMITTED_FIELDS) {
    delete reduced[key];
  }
  return reduced as PartnerPaymentDto;
}
