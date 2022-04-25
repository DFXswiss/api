import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class ActiveRefUserQuery {
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
  @ValidateIf((o) => !o.origin && o.refCode)
  refCode: string;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((o) => !o.refCode || o.origin)
  origin: string;
}
