import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';

export class UpdateUserAdminDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status: UserStatus;

  @IsOptional()
  @IsString()
  comment: string;

  @IsOptional()
  @IsEnum(UserRole)
  role: UserRole;

  @IsOptional()
  @IsNumber()
  buyFee: number;

  @IsOptional()
  @IsNumber()
  sellFee: number;

  @IsOptional()
  @IsNumber()
  cryptoFee: number;

  @IsOptional()
  @IsBoolean()
  approved: boolean;
}
