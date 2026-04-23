import { IsEnum, IsInt, IsNumber, IsString } from 'class-validator';
import { IsOptionalButNotNull } from 'src/shared/validators/is-not-null.validator';
import { RecallReason } from '../recall-reason.enum';

export class UpdateRecallDto {
  @IsOptionalButNotNull()
  @IsInt()
  sequence?: number;

  @IsOptionalButNotNull()
  @IsInt()
  userId?: number;

  @IsOptionalButNotNull()
  @IsString()
  comment?: string;

  @IsOptionalButNotNull()
  @IsNumber()
  fee?: number;

  @IsOptionalButNotNull()
  @IsEnum(RecallReason)
  reason?: RecallReason;
}
