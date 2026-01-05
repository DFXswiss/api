import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

// Base DTO for crypto refunds (address only)
export class TransactionRefundDto {
  @ApiProperty({ description: 'Refund address or refund IBAN' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trimAll)
  @Transform(Util.sanitize)
  refundTarget: string;
}

// Extended DTO for bank refunds (requires creditor data)
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
