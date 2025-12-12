import { ApiPropertyOptional } from '@nestjs/swagger';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { AccountType } from '../../user-data/account-type.enum';

export class UserAddressInfoDto {
  @ApiPropertyOptional()
  street?: string;

  @ApiPropertyOptional()
  houseNumber?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  zip?: string;

  @ApiPropertyOptional({ type: CountryDto })
  country?: CountryDto;
}

export class UserProfileDto {
  @ApiPropertyOptional({ enum: AccountType })
  accountType?: AccountType;

  @ApiPropertyOptional()
  firstName?: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  mail?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional({ type: UserAddressInfoDto, description: 'Primary address based on account type' })
  address?: UserAddressInfoDto;

  @ApiPropertyOptional({ description: 'Organization name (only for business accounts)' })
  organizationName?: string;
}
