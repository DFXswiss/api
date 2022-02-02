import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateMasternodeDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  enabled: boolean;
}
