import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class KycContactData {
  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  mail: string;
}
