import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { LimitRequestDecision } from '../limit-request.entity';

export class UpdateLimitRequestDto {
  @IsOptional()
  @IsString()
  clerk: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  edited: Date;

  @IsOptional()
  @IsEnum(LimitRequestDecision)
  decision: LimitRequestDecision;
}
