import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Wallet } from '../../wallet/wallet.entity';
import { KycType } from '../user-data.enum';
import { UpdateUserDataDto } from './update-user-data.dto';

export class CreateUserDataDto extends UpdateUserDataDto {
  @IsNotEmpty()
  @IsEnum(KycType)
  kycType: KycType;

  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  wallet?: Wallet;
}
