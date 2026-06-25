import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserDataStatus } from '../../user/models/user-data/user-data.enum';

export class PartnerUserInfoDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: UserDataStatus })
  status: UserDataStatus;

  @ApiPropertyOptional()
  mail?: string;

  @ApiPropertyOptional()
  firstname?: string;

  @ApiPropertyOptional()
  surname?: string;

  @ApiProperty()
  usedRef: string;

  @ApiProperty({ type: Number, isArray: true })
  feeIds: number[];

  @ApiProperty()
  canModify: boolean;
}
