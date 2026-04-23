import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MrosStatus } from '../mros-status.enum';

export class CreateMrosDto {
  @IsNotEmpty()
  @IsInt()
  userDataId: number;

  @IsNotEmpty()
  @IsEnum(MrosStatus)
  status: MrosStatus;

  @IsOptional()
  @IsDateString()
  submissionDate?: Date;

  @IsOptional()
  @IsString()
  authorityReference?: string;

  @IsNotEmpty()
  @IsString()
  caseManager: string;
}
