import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { User } from 'src/user/user.entity';

export class CreateSellDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  fiat: number;

  user: User;

  @IsOptional()
  deposit: number;

  @IsString()
  @IsOptional()
  created: Date;
}
