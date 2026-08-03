import { ApiProperty } from '@nestjs/swagger';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { IsEnum, ValidateIf } from 'class-validator';

export class ResetBuyCryptoAmlReviewDto {
  @ApiProperty({ enum: CheckStatus })
  @IsEnum(CheckStatus)
  expectedAmlCheck: CheckStatus;

  @ApiProperty({ enum: AmlReason, nullable: true })
  @ValidateIf((_dto, value) => value !== null)
  @IsEnum(AmlReason)
  expectedAmlReason: AmlReason | null;
}
