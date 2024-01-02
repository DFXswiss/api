import { IsEnum, IsNotEmpty } from 'class-validator';
import { KycType } from '../user-data.entity';
import { UpdateUserDataDto } from './update-user-data.dto';

export class CreateUserDataDto extends UpdateUserDataDto {
  @IsNotEmpty()
  @IsEnum(KycType)
  kycType: KycType;
}
