import { IsDateString, IsEnum, IsString } from 'class-validator';
import { IsOptionalButNotNull } from 'src/shared/validators/is-not-null.validator';
import { MrosStatus } from '../mros-status.enum';

export class UpdateMrosDto {
  @IsOptionalButNotNull()
  @IsEnum(MrosStatus)
  status?: MrosStatus;

  @IsOptionalButNotNull()
  @IsDateString()
  submissionDate?: Date;

  @IsOptionalButNotNull()
  @IsString()
  authorityReference?: string;

  @IsOptionalButNotNull()
  @IsString()
  caseManager?: string;
}
