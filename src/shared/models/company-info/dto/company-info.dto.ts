import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompanyInfoAddressDto {
  @ApiPropertyOptional()
  street?: string;

  @ApiPropertyOptional()
  zip?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code' })
  country?: string;
}

export class CompanyInfoDto {
  @ApiProperty()
  brand: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  website?: string;

  @ApiPropertyOptional({ type: CompanyInfoAddressDto })
  address?: CompanyInfoAddressDto;
}
