import { ApiProperty } from '@nestjs/swagger';

export class CountryDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  symbol: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Allowed to access DFX API (current IP location)' })
  locationAllowed: boolean;

  @ApiProperty({ description: 'Allowed for KYC' })
  kycAllowed: boolean;

  @ApiProperty({ description: 'Allowed for bank transactions' })
  bankAllowed: boolean;

  @ApiProperty({ description: 'Allowed for card transactions' })
  cardAllowed: boolean;
}
