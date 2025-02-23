import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { UserData } from '../../user-data/user-data.entity';
import { UpdateUserDataRelationDto } from './update-user-data-relation.dto';
import { UserDataRelationState } from './user-data-relation.enum';

export class CreateUserDataRelationDto extends UpdateUserDataRelationDto {
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
}
