import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({ description: 'Server time the response was assembled' })
  generatedAt?: Date;
}

// --- VOLUME / COUNTS --- //

export class PartnerVolumeByTypeDto {
  @ApiProperty({ description: 'CHF' })
  buy: number;

  @ApiProperty({ description: 'CHF' })
  sell: number;

  @ApiProperty({ description: 'CHF' })
  swap: number;

  @ApiProperty({ description: 'CHF' })
  total: number;
}

export class PartnerVolumeBuySellDto {
  @ApiProperty({ description: 'CHF' })
  buy: number;

  @ApiProperty({ description: 'CHF' })
  sell: number;

  @ApiProperty({ description: 'CHF' })
  total: number;
}

export class PartnerTransactionsByTypeDto {
  @ApiProperty()
  buy: number;

  @ApiProperty()
  sell: number;

  @ApiProperty()
  swap: number;

  @ApiProperty()
  total: number;
}

export class PartnerTotalsDto {
  @ApiProperty({
    type: PartnerVolumeByTypeDto,
    description: 'Volume in CHF, by trade direction',
  })
  volume: PartnerVolumeByTypeDto;

  @ApiProperty({ type: PartnerTransactionsByTypeDto })
  transactions: PartnerTransactionsByTypeDto;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Average volume per transaction in CHF; null when there were no transactions',
  })
  averageTransactionVolume: number | null;

  @ApiProperty({
    type: Number,
    description: 'Distinct users with ≥1 counted transaction in the period',
  })
  activeUsers: number;

  @ApiProperty({
    type: Number,
    description: 'Users of this wallet created in the period',
  })
  newUsers: number;
}

export class PartnerAllTimeDto {
  @ApiProperty({
    type: PartnerVolumeBuySellDto,
    description: 'Lifetime volume in CHF',
  })
  volume: PartnerVolumeBuySellDto;

  @ApiProperty({ description: 'Installation count; no transaction linkage' })
  registeredUsers: number;

  @ApiProperty({
    type: Number,
    description: 'Users of this wallet with buyVolume > 0 or sellVolume > 0',
  })
  tradingUsers: number;
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
    description: 'Partner referral volume in EUR on the wallet owner’s account (all wallets of that owner)',
  })
  volume: number;

  @ApiProperty({
    description: 'Partner referral credit earned (owner.partnerRefCredit only) in EUR, account-wide',
  })
  creditEarned: number;

  @ApiProperty({
    description:
      'Referral credit already paid out (owner.paidRefCredit) in EUR, account-wide across both ' +
      'personal and partner pots',
  })
  creditPaid: number;

  @ApiProperty({
    description:
      'Open referral credit in EUR: owner.refCredit + owner.partnerRefCredit − owner.paidRefCredit ' + '(account-wide)',
  })
  creditOpen: number;

  @ApiProperty({ enum: ['EUR'], description: 'Native currency of the referral system' })
  currency: 'EUR';
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
    description: 'Volume in CHF, by trade direction',
  })
  volume: PartnerTimelineByDirectionDto;

  @ApiProperty({
    type: PartnerTimelineByDirectionDto,
    description: 'Transaction counts, by trade direction',
  })
  transactions: PartnerTimelineByDirectionDto;

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
