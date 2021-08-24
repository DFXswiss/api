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

  @ApiProperty()
  @IsNotEmpty()
  // @IsIBAN()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  asset: any;

  user: User;

  @IsOptional()
  @IsString()
  bankUsage: string;
}
