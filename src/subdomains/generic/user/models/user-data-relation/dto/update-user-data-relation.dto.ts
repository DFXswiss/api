import { IsEnum, IsOptional } from 'class-validator';
import { SignatoryState } from './user-data-relation.enum';

export class UpdateUserDataRelationDto {
  @IsOptional()
  @IsEnum(SignatoryState)
  signatory?: SignatoryState;
}
