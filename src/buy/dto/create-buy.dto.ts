import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  equals,
  IsBoolean,
  IsEmail,
  IsIBAN,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
} from 'class-validator';
import { Asset } from 'src/asset/asset.entity';
import { User } from 'src/user/user.entity';

export class CreateBuyDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  // @IsIBAN()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  asset: any;

  user: User;

  @Length(14, 14)
  @IsOptional()
  @IsString()
  bankUsage: string;

  @IsString()
  @IsOptional()
  created: Date;
}
