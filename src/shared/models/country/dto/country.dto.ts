import { ApiProperty } from '@nestjs/swagger';

export class CountryDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  symbol: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  foreignName: string;

  @ApiProperty({ description: 'Allowed to access DFX API (current IP location)' })
  locationAllowed: boolean;

  @ApiProperty({ description: 'Allowed for KYC' })
  kycAllowed: boolean;

  @ApiProperty({ description: 'Allowed for organization KYC' })
  kycOrganizationAllowed: boolean;

  @ApiProperty({ description: 'Allowed nationality for KYC' })
  nationalityAllowed: boolean;

  @ApiProperty({ description: 'Allowed for bank transactions' })
  bankAllowed: boolean;

  @ApiProperty({ description: 'Allowed for card transactions' })
  cardAllowed: boolean;

  @ApiProperty({ description: 'Allowed for crypto transactions' })
  cryptoAllowed: boolean;
}
