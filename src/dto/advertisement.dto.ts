import { IsDate, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class AdvertisementDto {
  @IsOptional()
  @IsString()
  id: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  date: Date;

  @IsOptional()
  @IsString()
  lang: string;
}