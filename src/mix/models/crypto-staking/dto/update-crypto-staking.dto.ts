import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional } from 'class-validator';

export class UpdateCryptoStakingDto {
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @IsOptional()
  @IsNumber()
  outputMailSendDate: number;

  @IsOptional()
  @IsNumber()
  inputMailSendDate: number;
}
