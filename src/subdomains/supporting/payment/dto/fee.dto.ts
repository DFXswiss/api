import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Fee } from '../entities/fee.entity';
import { TxSpec } from './transaction-helper/tx-spec.dto';

export class FeeDto {
  @ApiProperty({ description: 'Minimum fee amount' })
  min: number;

  @ApiProperty({ description: 'Fee rate' })
  rate: number; // final fee rate

  @ApiProperty({ description: 'Fixed fee amount' })
  fixed: number; // final fixed fee

  @ApiProperty({ description: 'DFX fee amount' })
  dfx: number;

  @ApiProperty({ description: 'Network fee amount' })
  network: number; // final network fee

  @ApiPropertyOptional({ description: 'Network start fee' })
  networkStart?: number;

  @ApiProperty({ description: 'Platform fee amount' })
  platform: number;

  @ApiProperty({ description: 'Bank fee amount' })
  bank: number; // final bank fee addition

  @ApiProperty({ description: 'Total fee amount (DFX + bank + network fee)' })
  total: number;
}

export interface InternalFeeDto {
  fees: Fee[];
  min: number;
  rate: number;
  fixed: number;
  bank: number;
  partner: number;
  network: number;
  networkStart?: number;
  total: number;
  payoutRefBonus: boolean;
}

export interface FeeAmountsDto {
  dfx: number;
  bank: number;
  partner: number;
  total: number;
}

export interface FeeInfo {
  fees: Fee[];
  dfx: FeeSpec;
  bank: FeeSpec;
  partner: FeeSpec;
  network: number;
  payoutRefBonus: boolean;
}

export interface FeeSpec {
  rate: number;
  fixed: number;
}

export function toFeeDto(amounts: FeeAmountsDto, spec: TxSpec): FeeDto {
  return Object.assign(new FeeDto(), {
    min: spec.fee.min,
    rate: spec.fee.dfx.rate,
    fixed: spec.fee.dfx.fixed,
    network: spec.fee.network,
    networkStart: spec.fee.networkStart,
    dfx: amounts.dfx,
    platform: amounts.partner,
    bank: amounts.bank,
    total: amounts.total,
  });
}
