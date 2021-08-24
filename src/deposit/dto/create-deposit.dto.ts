import { ApiProperty,  } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateDepositDto {

  @ApiProperty()
  @IsNotEmpty()
  @Length(34, 42)
  @IsString()
  address: string;
}
