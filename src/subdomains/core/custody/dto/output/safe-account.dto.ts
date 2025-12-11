import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SafeAccessLevel } from '../../enums/custody';

export class SafeAccountOwnerDto {
  @ApiProperty()
  id: number;
}

export class SafeAccountDto {
  @ApiPropertyOptional({ description: 'ID of the SafeAccount (null for legacy)' })
  id: number | null;

  @ApiProperty({ description: 'Title of the SafeAccount' })
  title: string;

  @ApiPropertyOptional({ description: 'Description of the SafeAccount' })
  description?: string;

  @ApiProperty({ description: 'Whether this is a legacy account (aggregated custody users)' })
  isLegacy: boolean;

  @ApiProperty({ enum: SafeAccessLevel, description: 'Access level for current user' })
  accessLevel: SafeAccessLevel;

  @ApiPropertyOptional({ type: SafeAccountOwnerDto })
  owner?: SafeAccountOwnerDto;
}

export class SafeAccountAccessDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  userDataId: number;

  @ApiProperty({ enum: SafeAccessLevel })
  accessLevel: SafeAccessLevel;
}
