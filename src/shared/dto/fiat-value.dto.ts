import { ApiProperty } from '@nestjs/swagger';

export class FiatValueDto {
  @ApiProperty({ description: 'Value in Swiss Franc' })
  chf: number;

  @ApiProperty({ description: 'Value in Euro' })
  eur: number;

  @ApiProperty({ description: 'Value in US Dollar' })
  usd: number;
}