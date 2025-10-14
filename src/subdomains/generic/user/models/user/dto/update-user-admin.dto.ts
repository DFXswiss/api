import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsOptional, IsString } from 'class-validator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserAddressType, UserStatus, WalletType } from 'src/subdomains/generic/user/models/user/user.entity';
import { Moderator } from '../../user-data/user-data.enum';

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
}
