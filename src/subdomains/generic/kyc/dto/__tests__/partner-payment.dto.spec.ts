import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { Util } from 'src/shared/utils/util';
import {
  TransactionDetailDto,
  TransactionState,
  TransactionType,
} from 'src/subdomains/supporting/payment/dto/transaction.dto';
import { PaymentWebhookData } from '../../../user/services/webhook/dto/payment-webhook.dto';
import { PARTNER_PAYMENT_OMITTED_FIELDS, PartnerPaymentDto, toPartnerPaymentDto } from '../partner-payment.dto';

/**
 * Fields intentionally exposed on the partner pull response (PaymentWebhookData minus denylist).
 * A new property on TransactionDetailDto / PaymentWebhookData must land here or in
 * PARTNER_PAYMENT_OMITTED_FIELDS — otherwise the classification test fails.
 */
const PARTNER_PAYMENT_ALLOWED_FIELDS = [
  'id',
  'uid',
  'orderUid',
  'type',
  'state',
  'inputAmount',
  'inputAsset',
  'inputAssetId',
  'inputChainId',
  'inputBlockchain',
  'inputEvmChainId',
  'inputPaymentMethod',
  'chargebackAmount',
  'chargebackAsset',
  'chargebackAssetId',
  'chargebackDate',
  'date',
  'reason',
  'exchangeRate',
  'rate',
  'outputAmount',
  'outputAsset',
  'outputAssetId',
  'outputChainId',
  'outputBlockchain',
  'outputEvmChainId',
  'outputPaymentMethod',
  'outputDate',
  'priceSteps',
  'feeAmount',
  'feeAsset',
  'fees',
  'externalTransactionId',
  'dfxReference',
] as const;

/** Swagger-declared property names on a DTO class, walking the prototype chain for inheritance. */
function swaggerDeclaredProperties(cls: new () => object): string[] {
  const names = new Set<string>();
  let current: object | null = cls.prototype;
  while (current && current !== Object.prototype) {
    const meta: unknown = Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES_ARRAY, current) ?? [];
    for (const entry of Array.isArray(meta) ? meta : []) {
      if (typeof entry === 'string' && entry.startsWith(':')) names.add(entry.slice(1));
    }
    current = Object.getPrototypeOf(current);
  }
  return [...names].sort();
}

describe('PartnerPaymentDto redaction', () => {
  // Single clock anchor for this file; fixture dates stay ordered chargebackDate < date < outputDate.
  const FIXTURE_NOW = new Date();

  const fullPayload = (): PaymentWebhookData =>
    ({
      id: 1,
      uid: 'T1',
      orderUid: 'O1',
      type: TransactionType.BUY,
      state: TransactionState.COMPLETED,
      inputAmount: 10,
      inputAsset: 'EUR',
      inputAssetId: 1,
      inputTxId: 'in-tx',
      inputTxUrl: 'https://ex/in-tx',
      depositAddress: 'dep',
      chargebackTarget: 'cb-target',
      chargebackAmount: 1,
      chargebackAsset: 'EUR',
      chargebackAssetId: 1,
      chargebackTxId: 'cb-tx',
      chargebackTxUrl: 'https://ex/cb-tx',
      chargebackDate: Util.daysBefore(2, FIXTURE_NOW),
      date: Util.daysBefore(1, FIXTURE_NOW),
      exchangeRate: 1,
      rate: 1,
      outputAmount: 9,
      outputAsset: 'BTC',
      outputAssetId: 2,
      outputTxId: 'out-tx',
      outputTxUrl: 'https://ex/out-tx',
      outputDate: new Date(FIXTURE_NOW),
      externalTransactionId: 'ext',
      networkStartTx: {
        txId: 'net-tx',
        txUrl: 'https://ex/net-tx',
        amount: 0.01,
        exchangeRate: 1,
        asset: 'ETH',
      },
      sourceAccount: 'CH93…',
      targetAccount: '0xabc',
      dfxReference: 42,
    }) as PaymentWebhookData;

  it('every Swagger-declared PaymentWebhookData / TransactionDetailDto property is either omitted or explicitly allowed', () => {
    // New DTO fields must be classified: omit (sensitive) or allow (partner-visible). Untagged = fail.
    const declared = new Set([
      ...swaggerDeclaredProperties(TransactionDetailDto),
      ...swaggerDeclaredProperties(PaymentWebhookData),
    ]);
    expect(declared.size).toBeGreaterThan(0);

    const omitted = new Set<string>(PARTNER_PAYMENT_OMITTED_FIELDS);
    const allowed = new Set<string>(PARTNER_PAYMENT_ALLOWED_FIELDS);
    // No overlap: a field cannot be both redacted and free.
    for (const field of PARTNER_PAYMENT_OMITTED_FIELDS) {
      expect(allowed.has(field)).toBe(false);
    }

    const unclassified = [...declared].filter((p) => !omitted.has(p) && !allowed.has(p)).sort();
    expect(unclassified).toEqual([]);

    // Omitted and allowed entries that no longer exist on the DTO are stale — drop them deliberately.
    const staleOmitted = PARTNER_PAYMENT_OMITTED_FIELDS.filter((f) => !declared.has(f));
    const staleAllowed = PARTNER_PAYMENT_ALLOWED_FIELDS.filter((f) => !declared.has(f));
    expect(staleOmitted).toEqual([]);
    expect(staleAllowed).toEqual([]);
  });

  it('toPartnerPaymentDto drops every omitted field and keeps the rest', () => {
    const full = fullPayload();
    const reduced = toPartnerPaymentDto(full);
    const omitted = new Set<string>(PARTNER_PAYMENT_OMITTED_FIELDS);

    for (const key of Object.keys(full)) {
      if (omitted.has(key)) {
        expect(Object.prototype.hasOwnProperty.call(reduced, key)).toBe(false);
      } else {
        expect(Object.prototype.hasOwnProperty.call(reduced, key)).toBe(true);
        expect((reduced as any)[key]).toEqual((full as any)[key]);
      }
    }

    // Response must not expose any omitted field — iterate the denylist, not ad-hoc toBeUndefined.
    for (const field of PARTNER_PAYMENT_OMITTED_FIELDS) {
      expect(Object.keys(reduced)).not.toContain(field);
    }
  });

  it('does not mutate the full webhook payload', () => {
    const full = fullPayload();
    const before = { ...full };
    toPartnerPaymentDto(full);
    expect(full).toEqual(before);
    for (const field of PARTNER_PAYMENT_OMITTED_FIELDS) {
      expect(full).toHaveProperty(field);
    }
  });

  it('PartnerPaymentDto Swagger metadata excludes every omitted field', () => {
    const meta: Record<string, unknown> =
      Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES_ARRAY, PartnerPaymentDto.prototype) ?? [];
    // Nest stores ':propName' entries on the prototype array and per-property metadata on the class.
    const propNames = (Array.isArray(meta) ? meta : [])
      .map((entry) => (typeof entry === 'string' ? entry.replace(/^:/, '') : ''))
      .filter(Boolean);

    // Also collect keys from per-property decorator metadata when present.
    const ownProps = Object.getOwnPropertyNames(PartnerPaymentDto.prototype).filter((p) => p !== 'constructor');
    const declared = new Set([...propNames, ...ownProps]);

    // Prefer swagger plugin / omit-type cloned metadata when available.
    const swaggerProps = Object.keys(
      (Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, PartnerPaymentDto.prototype) as object) ?? {},
    );
    for (const name of swaggerProps) declared.add(name);

    // Walk the denylist against declared PartnerPaymentDto surface.
    for (const field of PARTNER_PAYMENT_OMITTED_FIELDS) {
      expect(declared.has(field)).toBe(false);
      // OmitType must not re-expose the property on the reduced class prototype chain for swagger clone.
      const propMeta = Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, PartnerPaymentDto.prototype, field);
      expect(propMeta).toBeUndefined();
    }
  });
});

describe('Webhook payment payload stays full (push path unchanged)', () => {
  it('PaymentWebhookData / mapper path still carries identifying fields', () => {
    // Construct the same shape WebhookDataMapper returns — full TransactionDetailDto + dfxReference.
    // We do not go through BuyCrypto entities here; the contract is that the *type* and strip boundary
    // keep webhook consumers on PaymentWebhookData while pull uses PartnerPaymentDto.
    const webhookPayload = {
      sourceAccount: 'CH9300762011623852957',
      targetAccount: '0xDEAD',
      inputTxId: 'abc',
      inputTxUrl: 'https://ex/abc',
      outputTxId: 'def',
      outputTxUrl: 'https://ex/def',
      depositAddress: 'bc1q…',
      chargebackTarget: 'CH…',
      chargebackTxId: 'cb',
      chargebackTxUrl: 'https://ex/cb',
      networkStartTx: { txId: 'n', txUrl: 'https://ex/n', amount: 1, exchangeRate: 1, asset: 'ETH' },
      dfxReference: 9,
      inputAmount: 100,
    } as PaymentWebhookData;

    // Snapshot before pull redaction so we can prove the input is not mutated by value.
    const before = { ...webhookPayload };
    const omitted = new Set<string>(PARTNER_PAYMENT_OMITTED_FIELDS);

    // Pull redaction is a separate function — webhook code never calls it.
    const reduced = toPartnerPaymentDto(webhookPayload);

    // Reduced response: every non-omitted field is value-equal to the full payload; omitted are gone.
    for (const key of Object.keys(before)) {
      if (omitted.has(key)) {
        expect(Object.keys(reduced)).not.toContain(key);
      } else {
        expect((reduced as any)[key]).toEqual((before as any)[key]);
        expect((reduced as any)[key]).toEqual((webhookPayload as any)[key]);
      }
    }

    // Full payload after the call: every omitted field still holds the pre-call value (not merely present).
    for (const field of PARTNER_PAYMENT_OMITTED_FIELDS) {
      expect((webhookPayload as any)[field]).toEqual((before as any)[field]);
    }
  });
});
