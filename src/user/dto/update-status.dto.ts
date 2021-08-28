import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsInt, IsEnum } from 'class-validator';
import { UserStatus } from 'src/user/user.entity';

export class UpdateStatusDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsEnum(UserStatus)
  status: UserStatus;
}
