import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TfaType {
  APP = 'App',
  MAIL = 'Mail',
}

export class Setup2faDto {
  @ApiProperty({ enum: TfaType })
  type: TfaType;

  @ApiPropertyOptional()
  secret?: string;

  @ApiPropertyOptional()
  uri?: string;
}
