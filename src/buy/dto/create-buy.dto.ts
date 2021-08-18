import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
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
