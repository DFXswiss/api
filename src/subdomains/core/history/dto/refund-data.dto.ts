import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { ActiveDto } from 'src/shared/models/active';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export class RefundFeeDto {
  @ApiProperty()
  network: number;

  @ApiProperty()
  bank: number;
}

export class RefundDataDto {
  @ApiProperty()
  expiryDate: Date;

  @ApiProperty({ type: RefundFeeDto })
  fee: RefundFeeDto;

  @ApiProperty()
  refundAmount: number;

  @ApiProperty({ oneOf: [{ $ref: getSchemaPath(AssetDto) }, { $ref: getSchemaPath(FiatDto) }] })
  refundAsset: ActiveDto;

  @ApiPropertyOptional()
  refundTarget: string;
}