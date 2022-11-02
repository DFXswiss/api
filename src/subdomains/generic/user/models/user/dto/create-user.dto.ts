import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { GetConfig } from 'src/config/config';

export class CreateUserDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().addressFormat)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().signatureFormat)
  signature: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^(\w{1,3}-\w{1,3})$/)
  usedRef: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  walletId: number;
}
