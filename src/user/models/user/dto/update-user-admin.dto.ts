import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsEnum, IsNumber, IsOptional } from 'class-validator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserStatus } from 'src/user/models/user/user.entity';

export class UpdateUserAdminDto {
  @ApiProperty()
  @IsOptional()
  @IsEnum(UserStatus)
  status: UserStatus;

  @ApiProperty()
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
  stakingFee: number;
}
