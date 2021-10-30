import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateWalletDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(/^(8\w{33}|d\w{33}|d\w{41})$/)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(/^.{87}=$/)
  signature: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description: string;
}
