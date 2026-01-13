import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustodyAccessLevel } from '../../enums/custody';

export class CustodyAccountOwnerDto {
  @ApiProperty()
  id: number;
}

export class CustodyAccountDto {
  @ApiPropertyOptional({ description: 'ID of the CustodyAccount (null for legacy)' })
  id: number | null;

  @ApiProperty({ description: 'Title of the CustodyAccount' })
  title: string;

  @ApiPropertyOptional({ description: 'Description of the CustodyAccount' })
  description?: string;

  @ApiProperty({ description: 'Whether this is a legacy account (aggregated custody users)' })
  isLegacy: boolean;

  @ApiProperty({ enum: CustodyAccessLevel, description: 'Access level for current user' })
  accessLevel: CustodyAccessLevel;

  @ApiPropertyOptional({ type: CustodyAccountOwnerDto })
  owner?: CustodyAccountOwnerDto;
}

export class CustodyAccountAccessDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  userDataId: number;

  @ApiProperty({ enum: CustodyAccessLevel })
  accessLevel: CustodyAccessLevel;
}
