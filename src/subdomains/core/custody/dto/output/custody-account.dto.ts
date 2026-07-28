import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustodyAccessLevel } from '../../enums/custody';

export class CustodyUserDto {
  @ApiProperty()
  id: number;
}

export class CustodyAccountDto {
  @ApiPropertyOptional({ description: 'ID of the custody account (null for legacy)' })
  id: number | null;

  @ApiProperty({ description: 'Title of the custody account' })
  title: string;

  @ApiPropertyOptional({ description: 'Description of the custody account' })
  description?: string;

  @ApiProperty({ description: 'Whether this is a legacy account (aggregated custody users)' })
  isLegacy: boolean;

  @ApiProperty({ enum: CustodyAccessLevel, description: 'Access level for current user' })
  accessLevel: CustodyAccessLevel;

  @ApiProperty({ description: 'Whether the current user owns this account rather than being granted access to it' })
  isOwner: boolean;

  @ApiPropertyOptional({ type: CustodyUserDto })
  owner?: CustodyUserDto;
}

export class CustodyAccountAccessDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ type: CustodyUserDto })
  user: CustodyUserDto;

  @ApiProperty({ enum: CustodyAccessLevel })
  accessLevel: CustodyAccessLevel;
}
