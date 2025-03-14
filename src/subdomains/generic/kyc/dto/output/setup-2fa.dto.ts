import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TfaType {
  APP = 'App',
  MAIL = 'Mail',
  PASSKEY = 'Passkey',
  UNDEFINED = "Undefined"
}

export class Setup2faDto {
  @ApiProperty({ enum: TfaType })
  type: TfaType;

  @ApiPropertyOptional({ description: 'Used as secret for 2FA or challenge for passkey authentication' })
  secret?: string;

  @ApiPropertyOptional()
  uri?: string;
}
