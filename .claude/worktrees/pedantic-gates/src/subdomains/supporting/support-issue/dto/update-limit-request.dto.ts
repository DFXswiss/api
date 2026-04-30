import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsString } from 'class-validator';
import { IsOptionalButNotNull } from 'src/shared/validators/is-not-null.validator';
import { LimitRequestDecision } from '../entities/limit-request.entity';

export class UpdateLimitRequestDto {
  @IsOptionalButNotNull()
  @IsString()
  clerk: string;

  @IsOptionalButNotNull()
  @IsDate()
  @Type(() => Date)
  edited: Date;

  @IsOptionalButNotNull()
  @IsEnum(LimitRequestDecision)
  decision: LimitRequestDecision;

  @IsOptionalButNotNull()
  @IsInt()
  acceptedLimit: number;
}
