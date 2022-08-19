import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class UpdateCryptoStakingDto {
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputMailSendDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  inputMailSendDate: Date;
}
