import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export enum FiatCurrency {
  CHF = 'CHF',
  EUR = 'EUR',
  USD = 'USD',
}

export class GetBalancePdfDto {
  @ApiProperty({ description: 'Blockchain address' })
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty({ description: 'Blockchain', enum: Blockchain })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty({ description: 'Fiat currency for the report', enum: FiatCurrency })
  @IsNotEmpty()
  @IsEnum(FiatCurrency)
  currency: FiatCurrency;

  @ApiProperty({ description: 'Date for the portfolio report' })
  @IsDate()
  @Type(() => Date)
  date: Date;
}
