import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { UserData } from '../../user-data/user-data.entity';
import { SignatoryState, UserDataRelationState } from './user-data-relation.enum';

export class CreateUserDataRelationDto {
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => EntityDto)
  account: UserData;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => EntityDto)
  relatedAccount: UserData;

  @IsNotEmpty()
  @IsEnum(UserDataRelationState)
  relation: UserDataRelationState;

  @IsNotEmpty()
  @IsEnum(SignatoryState)
  signatory: SignatoryState;
}
