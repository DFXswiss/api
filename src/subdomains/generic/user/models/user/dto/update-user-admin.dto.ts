import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Moderator } from '../../user-data/user-data.enum';
import { Wallet } from '../../wallet/wallet.entity';
import { UserAddressType, UserStatus, WalletType } from '../user.enum';

export class UpdateUserInternalDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  usedRef?: string;

  @IsOptional()
  @IsBoolean()
  setRef?: boolean;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @IsOptional()
  @IsEnum(UserAddressType)
  addressType?: UserAddressType;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  travelRulePdfDate?: Date;

  @IsOptional()
  @IsEnum(WalletType)
  walletType?: WalletType;

  @IsOptional()
  @IsEnum(Moderator)
  moderator?: Moderator;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  wallet?: Wallet;
}
