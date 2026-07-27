import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { CustodyAccessLevel } from '../../enums/custody';

export class CreateCustodyAccountAccessDto {
  @ApiProperty({ description: 'E-mail of the user to grant access to' })
  @IsNotEmpty()
  @IsEmail()
  @Transform(Util.toLowerCaseTrim)
  mail: string;

  @ApiProperty({ enum: CustodyAccessLevel, description: 'Access level to grant' })
  @IsEnum(CustodyAccessLevel)
  accessLevel: CustodyAccessLevel;
}
