import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CoinTrackingApiHistoryDto } from './coin-tracking-history.dto';

export enum ChainReportTransactionType {
  TRADE = 'Trade',
  WITHDRAWAL = 'Withdrawal',
  DEPOSIT = 'Deposit',
  STAKING = 'Staking',
  LM = 'Lm',
  FEE = 'Fee',
  REFERRAL_REWARD = 'Referral_Rewards',
}

export enum ChainReportTarget {
  STAKING = 'Staking',
  YM = 'YM',
  WALLET = 'Wallet',
  EXTERNAL = 'External',
}

export class ChainReportCsvHistoryDto {
  @ApiProperty()
  timestamp: Date;

  @ApiProperty({ enum: ChainReportTransactionType })
  transactionType: ChainReportTransactionType;

  @ApiPropertyOptional()
  inputAmount: number;

  @ApiPropertyOptional()
  inputAsset: string;

  @ApiPropertyOptional()
  outputAmount: number;

  @ApiPropertyOptional()
  outputAsset: string;

  @ApiPropertyOptional()
  feeAmount: number;

  @ApiPropertyOptional()
  feeAsset: string;

  @ApiProperty()
  txid: string;

  @ApiPropertyOptional()
  description: string;

  @ApiPropertyOptional()
  isReinvest?: boolean;

  @ApiPropertyOptional({ enum: ChainReportTarget })
  target?: ChainReportTarget;
}

export class ChainReportApiHistoryDto extends CoinTrackingApiHistoryDto {
  @ApiPropertyOptional({ enum: Blockchain })
  inputBlockchain?: Blockchain;

  @ApiPropertyOptional({ enum: Blockchain })
  outputBlockchain?: Blockchain;
}
