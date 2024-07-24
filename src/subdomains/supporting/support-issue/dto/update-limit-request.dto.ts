import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';
import { LimitRequestDecision } from '../entities/limit-request.entity';

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
