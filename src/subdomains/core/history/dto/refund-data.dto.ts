import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { ActiveDto } from 'src/shared/models/active';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export class RefundFeeDto {
  @ApiProperty({ description: 'Network fee in refundAsset' })
  network: number;

  @ApiProperty({ description: 'Bank fee in refundAsset' })
  bank: number;

  @ApiProperty({ description: 'DFX fee in refundAsset' })
  dfx: number;
}

export class RefundDataDto {
  @ApiProperty({ description: 'Expiry date of the refund data' })
  expiryDate: Date;

  @ApiProperty({ type: RefundFeeDto, description: 'Refund fees' })
  fee: RefundFeeDto;

  @ApiProperty()
  inputAmount: number;

  @ApiProperty({ oneOf: [{ $ref: getSchemaPath(AssetDto) }, { $ref: getSchemaPath(FiatDto) }] })
  inputAsset: ActiveDto;

  @ApiProperty()
  refundAmount: number;

  @ApiProperty({ oneOf: [{ $ref: getSchemaPath(AssetDto) }, { $ref: getSchemaPath(FiatDto) }] })
  refundAsset: ActiveDto;

  @ApiPropertyOptional({ description: 'IBAN for bank tx or blockchain address for crypto tx' })
  refundTarget?: string;

  @ApiPropertyOptional({ description: 'Account holder name' })
  name?: string;

  @ApiPropertyOptional({ description: 'Street address' })
  address?: string;

  @ApiPropertyOptional({ description: 'House number' })
  houseNumber?: string;

  @ApiPropertyOptional({ description: 'Postal code' })
  zip?: string;

  @ApiPropertyOptional({ description: 'City' })
  city?: string;

  @ApiPropertyOptional({ description: 'Country code' })
  country?: string;

  @ApiPropertyOptional({ description: 'IBAN' })
  iban?: string;

  @ApiPropertyOptional({ description: 'BIC/SWIFT code' })
  bic?: string;
}
