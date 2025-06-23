import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

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

export interface AdSettings {
  displayInterval: number;
  displayTime: number;
  ads: { id: string; url: string }[];
  specialAd: { id: string; from: string; to: string; url: string };
}

export interface AdDto {
  id: string;
  url: string;
  displayTime: number;
}
