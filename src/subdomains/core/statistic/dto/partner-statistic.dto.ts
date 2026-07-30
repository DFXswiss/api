import { ApiProperty } from '@nestjs/swagger';
import { PartnerStatisticDirection, PartnerStatisticGranularity } from '../partner-statistic.enum';

// --- PERIOD / META --- //

export class PartnerStatisticPeriodDto {
  @ApiProperty({ description: 'Inclusive period start, snapped to UTC midnight' })
  from: Date;

  @ApiProperty({
    description: 'Exclusive period end, snapped to UTC midnight of the day after the last included day',
  })
  to: Date;
}

export class PartnerStatisticMetaDto {
  @ApiProperty({ description: 'Minimum effective count (min of transactions and distinct users) for disclosure' })
  suppressionThreshold: number;

  @ApiProperty({ description: 'Number of buckets/rows suppressed under the threshold' })
  suppressedBuckets: number;

  @ApiProperty({ nullable: true, required: false })
  generatedAt?: Date;
}

// --- VOLUME / COUNTS --- //

export class PartnerVolumeByTypeDto {
  @ApiProperty({ type: Number, nullable: true, description: 'CHF; null when the totals group is suppressed' })
  buy: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'CHF; null when the totals group is suppressed' })
  sell: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'CHF; null when the totals group is suppressed' })
  swap: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'CHF; null when the totals group is suppressed' })
  total: number | null;
}

export class PartnerVolumeBuySellDto {
  @ApiProperty({ type: Number, nullable: true, description: 'CHF; null when tradingUsers < k' })
  buy: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'CHF; null when tradingUsers < k' })
  sell: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'CHF; null when tradingUsers < k' })
  total: number | null;
}

export class PartnerTransactionsByTypeDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Null when the totals group is suppressed' })
  buy: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Null when the totals group is suppressed' })
  sell: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Null when the totals group is suppressed' })
  swap: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Null when the totals group is suppressed' })
  total: number | null;
}

export class PartnerTotalsDto {
  @ApiProperty({
    type: PartnerVolumeByTypeDto,
    description: 'Volume in CHF; entire group null when any direction is under the suppression threshold',
  })
  volume: PartnerVolumeByTypeDto;

  @ApiProperty({ type: PartnerTransactionsByTypeDto })
  transactions: PartnerTransactionsByTypeDto;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Average volume per transaction in CHF; null if no transactions or totals suppressed',
  })
  averageTransactionVolume: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Distinct users with ≥1 counted transaction in the period; null if 1..k-1',
  })
  activeUsers: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Users of this wallet created in the period; null if 1..k-1',
  })
  newUsers: number | null;
}

export class PartnerAllTimeDto {
  @ApiProperty({
    type: PartnerVolumeBuySellDto,
    description: 'Lifetime volume in CHF; null fields when tradingUsers < k',
  })
  volume: PartnerVolumeBuySellDto;

  @ApiProperty({ description: 'Always visible (installation count, no transaction linkage)' })
  registeredUsers: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Users of this wallet with buyVolume > 0 or sellVolume > 0; null if 1..k-1',
  })
  tradingUsers: number | null;
}

// --- BREAKDOWN --- //

export class PartnerAssetBreakdownDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  blockchain: string | null;

  @ApiProperty({ enum: PartnerStatisticDirection })
  direction: PartnerStatisticDirection;

  @ApiProperty({ description: 'Volume in CHF' })
  volume: number;

  @ApiProperty()
  transactions: number;
}

export class PartnerNamedBreakdownDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Volume in CHF' })
  volume: number;

  @ApiProperty()
  transactions: number;
}

export class PartnerBreakdownDto {
  @ApiProperty({ type: PartnerAssetBreakdownDto, isArray: true })
  assets: PartnerAssetBreakdownDto[];

  @ApiProperty({ type: PartnerNamedBreakdownDto, isArray: true })
  fiatCurrencies: PartnerNamedBreakdownDto[];

  @ApiProperty({ type: PartnerNamedBreakdownDto, isArray: true })
  blockchains: PartnerNamedBreakdownDto[];

  @ApiProperty({ type: PartnerNamedBreakdownDto, isArray: true })
  paymentMethods: PartnerNamedBreakdownDto[];
}

// --- REFERRAL --- //

export class PartnerReferralDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Partner referral volume in EUR on the wallet owner’s account (all wallets of that owner). ' +
      'Null when tradingUsers < k (moves with individual customer trades).',
  })
  volume: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Partner referral credit earned (owner.partnerRefCredit only) in EUR, account-wide. ' +
      'Null when tradingUsers < k.',
  })
  creditEarned: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Referral credit already paid out (owner.paidRefCredit) in EUR, account-wide across both ' +
      'personal and partner pots. Null when tradingUsers < k.',
  })
  creditPaid: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Open referral credit in EUR: owner.refCredit + owner.partnerRefCredit − owner.paidRefCredit ' +
      '(account-wide). Null when tradingUsers < k.',
  })
  creditOpen: number | null;

  @ApiProperty({ enum: ['EUR'], description: 'Native currency of the referral system' })
  currency: 'EUR';
}

// --- COMPLETION (funnels) --- //

/**
 * Stage A: payment-info quote requests → payment received.
 * Each UI amount change creates a new transaction_request — this is NOT a user conversion rate.
 */
export class PartnerPaymentInfoDirectionDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Count of payment-info quote requests (transaction_request rows) in the period. ' +
      'One row is created on every payment-info fetch (e.g. amount change in the UI), not once per purchase intent. ' +
      'Null when any funnel member is under the suppression threshold (block suppression).',
  })
  requested: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Requests that reached status Completed (a payment was linked).',
  })
  paymentReceived: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Requests still in status WaitingForPayment.',
  })
  waitingForPayment: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Requests left in status Created (quote shown, no payment followed).',
  })
  noPaymentReceived: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'paymentReceived / requested (0..1, 4 dp). Share of payment-info requests that got a payment — ' +
      'not a per-user conversion rate. Null if denominator is 0 or the funnel group was suppressed.',
  })
  receivedRate: number | null;
}

export class PartnerPaymentInfoRequestsDto {
  @ApiProperty({ type: PartnerPaymentInfoDirectionDto })
  buy: PartnerPaymentInfoDirectionDto;

  @ApiProperty({ type: PartnerPaymentInfoDirectionDto })
  sell: PartnerPaymentInfoDirectionDto;

  @ApiProperty({ type: PartnerPaymentInfoDirectionDto })
  swap: PartnerPaymentInfoDirectionDto;
}

/**
 * Stage B: payment received (buy_crypto / buy_fiat created) → delivered or rejected.
 * Note: `delivered` requires amlCheck=Pass AND isComplete=true, which is a subset of
 * `totals.transactions` (those only require amlCheck=Pass, including still-in-flight payouts).
 */
export class PartnerSettlementDirectionDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'All buy_crypto/buy_fiat rows in the period for this direction (no amlCheck filter). ' +
      'Null when any funnel member is under the suppression threshold (block suppression).',
  })
  received: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'amlCheck=Pass AND isComplete=true. Stricter than totals.transactions (which counts all Pass, ' +
      'including rows not yet fully paid out).',
  })
  delivered: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'amlCheck=Fail (regardless of isComplete).',
  })
  rejected: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'received − delivered − rejected (pending AML, in-flight payout, etc.).',
  })
  inProgress: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'delivered / received (0..1, 4 dp). Null if denominator is 0 or the funnel group was suppressed.',
  })
  deliveredRate: number | null;
}

export class PartnerSettlementDto {
  @ApiProperty({ type: PartnerSettlementDirectionDto })
  buy: PartnerSettlementDirectionDto;

  @ApiProperty({ type: PartnerSettlementDirectionDto })
  sell: PartnerSettlementDirectionDto;

  @ApiProperty({ type: PartnerSettlementDirectionDto })
  swap: PartnerSettlementDirectionDto;
}

export class PartnerCompletionDto {
  @ApiProperty({
    type: PartnerPaymentInfoRequestsDto,
    description: 'Stage A: payment-info requests → payment received (transaction_request funnel).',
  })
  paymentInfoRequests: PartnerPaymentInfoRequestsDto;

  @ApiProperty({
    type: PartnerSettlementDto,
    description: 'Stage B: payment entered the system → delivered / rejected / in progress.',
  })
  settlement: PartnerSettlementDto;
}

// --- SUMMARY RESPONSE --- //

export class PartnerStatisticDto {
  @ApiProperty({ type: PartnerStatisticPeriodDto })
  period: PartnerStatisticPeriodDto;

  @ApiProperty({ enum: ['CHF'] })
  currency: 'CHF';

  @ApiProperty({ type: PartnerTotalsDto })
  totals: PartnerTotalsDto;

  @ApiProperty({ type: PartnerAllTimeDto })
  allTime: PartnerAllTimeDto;

  @ApiProperty({ type: PartnerBreakdownDto })
  breakdown: PartnerBreakdownDto;

  @ApiProperty({ type: PartnerReferralDto })
  referral: PartnerReferralDto;

  @ApiProperty({ type: PartnerCompletionDto })
  completion: PartnerCompletionDto;

  @ApiProperty({ type: PartnerStatisticMetaDto })
  meta: PartnerStatisticMetaDto;
}

// --- TIMELINE --- //

/** Volume or transaction counts split by trade direction. */
export class PartnerTimelineByDirectionDto {
  @ApiProperty()
  buy: number;

  @ApiProperty()
  sell: number;

  @ApiProperty()
  swap: number;
}

export class PartnerTimelineBucketDto {
  @ApiProperty()
  date: Date;

  @ApiProperty({
    type: PartnerTimelineByDirectionDto,
    nullable: true,
    description: 'Volume in CHF; null when suppressed',
  })
  volume: PartnerTimelineByDirectionDto | null;

  @ApiProperty({
    type: PartnerTimelineByDirectionDto,
    nullable: true,
    description: 'Transaction counts; null when suppressed',
  })
  transactions: PartnerTimelineByDirectionDto | null;

  @ApiProperty({ description: 'True when values are withheld under the suppression threshold' })
  suppressed: boolean;

  @ApiProperty({
    description:
      'True when the bucket’s natural range extends outside the requested period (edge week/month truncated by from/to)',
  })
  partial: boolean;
}

export class PartnerTimelineDto {
  @ApiProperty({ type: PartnerStatisticPeriodDto })
  period: PartnerStatisticPeriodDto;

  @ApiProperty({ enum: ['CHF'] })
  currency: 'CHF';

  @ApiProperty({ enum: PartnerStatisticGranularity })
  granularity: PartnerStatisticGranularity;

  @ApiProperty({ type: PartnerTimelineBucketDto, isArray: true })
  buckets: PartnerTimelineBucketDto[];

  @ApiProperty({ type: PartnerStatisticMetaDto })
  meta: PartnerStatisticMetaDto;
}
