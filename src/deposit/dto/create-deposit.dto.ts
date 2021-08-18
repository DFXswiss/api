import { ApiProperty,  } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateDepositDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @Length(34, 34)
  @IsString()
  address: string;

  @IsString()
  @IsOptional()
  created: Date;
}
