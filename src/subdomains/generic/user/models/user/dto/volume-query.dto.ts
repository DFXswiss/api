import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VolumeQuery {
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  from: Date = new Date(0);

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  to: Date = new Date();

  @IsNotEmpty()
  @IsString()
  userId: string;
}
