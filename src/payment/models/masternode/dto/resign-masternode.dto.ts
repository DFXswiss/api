import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsString } from 'class-validator';

export class ResignMasternodeDto {
  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  resignDate: Date;

  @IsNotEmpty()
  @IsString()
  resignHash: string;
}
