import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsInt, IsEnum, IsString, Length, IsOptional } from 'class-validator';
import { UserStatus } from 'src/user/models/user/user.entity';

export class UpdateStatusDto {
  @ApiProperty()
  @IsOptional()
  @IsInt()
  id: number;

  @IsOptional()
  @Length(34, 42)
  @IsString()
  address: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsEnum(UserStatus)
  status: UserStatus;
}
