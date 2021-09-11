import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, IsEnum } from 'class-validator';
import { NameCheckStatus } from '../userData.entity';

export class UpdateUserDataDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsOptional()
  @IsString()
  name: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  location: string;

  @ApiProperty()
  @IsOptional()
  country: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(NameCheckStatus)
  nameCheck: NameCheckStatus;
}
