import { ApiProperty } from '@nestjs/swagger';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';

export class RealUnitStatsPeriod {
  @ApiProperty({ type: Number, description: 'Total count over all time' })
  total: number;

  @ApiProperty({ type: Number, description: 'Count within the last 30 days' })
  last30Days: number;

  @ApiProperty({ type: Number, description: 'Count within the last 7 days' })
  last7Days: number;
}

export class RealUnitGrowthStats {
  @ApiProperty({ type: RealUnitStatsPeriod, description: 'New accounts (user data) growth' })
  accounts: RealUnitStatsPeriod;

  @ApiProperty({ type: RealUnitStatsPeriod, description: 'New wallets (users) growth' })
  wallets: RealUnitStatsPeriod;
}

export class RealUnitKycFunnelStep {
  @ApiProperty({ enum: KycStepName, description: 'KYC step name' })
  step: KycStepName;

  @ApiProperty({ type: RealUnitStatsPeriod, description: 'Number of times the step was reached (created)' })
  reached: RealUnitStatsPeriod;

  @ApiProperty({ type: RealUnitStatsPeriod, description: 'Number of times the step was completed' })
  completed: RealUnitStatsPeriod;
}

export class RealUnitRegistrationStats {
  @ApiProperty({ type: RealUnitStatsPeriod, description: 'RealUnit registrations started' })
  started: RealUnitStatsPeriod;

  @ApiProperty({ type: RealUnitStatsPeriod, description: 'RealUnit registrations currently in review' })
  inReview: RealUnitStatsPeriod;

  @ApiProperty({ type: RealUnitStatsPeriod, description: 'RealUnit registrations completed' })
  completed: RealUnitStatsPeriod;
}

export class RealUnitTradingStats {
  @ApiProperty({ type: RealUnitStatsPeriod, description: 'Buy volume in CHF' })
  buyVolumeChf: RealUnitStatsPeriod;

  @ApiProperty({ type: RealUnitStatsPeriod, description: 'Number of buy transactions' })
  buyCount: RealUnitStatsPeriod;

  @ApiProperty({ type: RealUnitStatsPeriod, description: 'Sell volume in CHF' })
  sellVolumeChf: RealUnitStatsPeriod;

  @ApiProperty({ type: RealUnitStatsPeriod, description: 'Number of sell transactions' })
  sellCount: RealUnitStatsPeriod;
}

export class RealUnitStatsDto {
  @ApiProperty({ type: Date, description: 'Timestamp of the last cache update' })
  updated: Date;

  @ApiProperty({ type: RealUnitGrowthStats, description: 'Account and wallet growth KPIs' })
  growth: RealUnitGrowthStats;

  @ApiProperty({ type: RealUnitKycFunnelStep, isArray: true, description: 'KYC funnel step KPIs' })
  kycFunnel: RealUnitKycFunnelStep[];

  @ApiProperty({ type: RealUnitRegistrationStats, description: 'RealUnit registration KPIs' })
  registration: RealUnitRegistrationStats;

  @ApiProperty({ type: RealUnitTradingStats, description: 'RealUnit trading KPIs' })
  trading: RealUnitTradingStats;
}
