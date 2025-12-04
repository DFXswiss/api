import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VirtualIbanStatus } from '../virtual-iban.entity';

export class VirtualIbanDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  iban: string;

  @ApiPropertyOptional()
  bban?: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  active: boolean;

  @ApiPropertyOptional()
  status?: VirtualIbanStatus;

  @ApiPropertyOptional()
  label?: string;

  @ApiPropertyOptional()
  activatedAt?: Date;
}
