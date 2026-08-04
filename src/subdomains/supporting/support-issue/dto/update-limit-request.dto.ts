import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsString, Min } from 'class-validator';
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

  /**
   * The customer's new annual deposit limit, written to user_data.depositLimit in the same call — only
   * allowed on a granting decision. Kept off the limit_request row.
   */
  @IsOptionalButNotNull()
  @IsInt()
  @Min(1)
  grantedDepositLimit?: number;
}
