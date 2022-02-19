import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateUserDto {
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
  @IsString()
  @Matches(/^(\w{1,3}-\w{1,3})$/)
  usedRef: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  walletId: number;
}
