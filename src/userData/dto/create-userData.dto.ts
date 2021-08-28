import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsEnum } from 'class-validator';
import { UserDataNameCheck } from '../userData.entity';

export class CreateUserDataDto {
  
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiProperty()
  @IsOptional()
  country: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(UserDataNameCheck)
  nameCheck: UserDataNameCheck;
}
