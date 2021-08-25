import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, IsNumber, IsNotEmpty } from 'class-validator';
import { UserDataNameCheck } from '../userData.entity';

export class UpdateUserDataDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameCheck: UserDataNameCheck;
}
