import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class GetBalancesDto {
  @ApiProperty({ description: 'Wallet address to query balances for' })
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty({ enum: Blockchain, description: 'Blockchain to query' })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiPropertyOptional({ description: 'Asset IDs to query balances for', type: [Number] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  assetIds?: number[];
}

export class BalanceDto {
  @ApiProperty({ description: 'Asset ID' })
  assetId: number;

  @ApiPropertyOptional({ description: 'Contract address / Chain ID of the asset' })
  chainId?: string;

  @ApiProperty({ description: 'Balance amount (formatted with decimals)' })
  balance: number;
}

export class GetBalancesResponseDto {
  @ApiProperty({ type: [BalanceDto], description: 'List of balances' })
  balances: BalanceDto[];
}
