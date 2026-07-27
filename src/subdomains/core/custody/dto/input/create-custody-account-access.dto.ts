import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { CustodyAccessLevel } from '../../enums/custody';

export class CreateCustodyAccountAccessDto {
  @ApiProperty({ description: 'E-mail of the user to grant access to' })
  @IsNotEmpty()
  @IsString()
  @IsEmail()
  // Leave non-strings untouched so IsString/IsEmail can reject with 400 instead of a 500 TypeError.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  mail: string;

  @ApiProperty({ enum: CustodyAccessLevel, description: 'Access level to grant' })
  @IsEnum(CustodyAccessLevel)
  accessLevel: CustodyAccessLevel;
}
