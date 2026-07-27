import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { CustodyAccessLevel } from '../../enums/custody';

export class UpdateCustodyAccountAccessDto {
  @ApiProperty({ enum: CustodyAccessLevel, description: 'New access level' })
  @IsEnum(CustodyAccessLevel)
  accessLevel: CustodyAccessLevel;
}
