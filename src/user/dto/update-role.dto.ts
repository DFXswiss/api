import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsInt } from 'class-validator';
import { UserRole } from 'src/user/user.entity';

export class UpdateRoleDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  role: UserRole;
}
