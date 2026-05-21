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

  @ApiProperty({ description: 'Allowed for IBANs' })
  ibanAllowed: boolean;

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

  @ApiProperty({
    description:
      'Display order for country pickers — lower is higher in the list. Default 999. Clients should sort their picker by this field instead of hardcoded priority sets.',
  })
  displayOrder: number;
}
