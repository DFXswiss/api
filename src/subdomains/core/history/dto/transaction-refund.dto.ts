import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class CreditorDataDto {
  @ApiProperty({ description: 'Creditor name for bank transfer' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Creditor street address' })
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiPropertyOptional({ description: 'Creditor house number' })
  @IsOptional()
  @IsString()
  houseNumber?: string;

  @ApiProperty({ description: 'Creditor ZIP code' })
  @IsNotEmpty()
  @IsString()
  zip: string;

  @ApiProperty({ description: 'Creditor city' })
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiProperty({ description: 'Creditor country code (e.g. CH, DE)' })
  @IsNotEmpty()
  @IsString()
  country: string;
}

export class TransactionRefundDto {
  @ApiProperty({ description: 'Refund address or refund IBAN' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trimAll)
  @Transform(Util.sanitize)
  refundTarget: string;

  @ApiPropertyOptional({ description: 'Creditor data (required for bank refunds)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreditorDataDto)
  creditorData?: CreditorDataDto;
}

export class BankRefundDto extends TransactionRefundDto {
  @ApiProperty({ description: 'Creditor name for bank transfer' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Creditor street address' })
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiPropertyOptional({ description: 'Creditor house number' })
  @IsOptional()
  @IsString()
  houseNumber?: string;

  @ApiProperty({ description: 'Creditor ZIP code' })
  @IsNotEmpty()
  @IsString()
  zip: string;

  @ApiProperty({ description: 'Creditor city' })
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiProperty({ description: 'Creditor country code (e.g. CH, DE)' })
  @IsNotEmpty()
  @IsString()
  country: string;
}
