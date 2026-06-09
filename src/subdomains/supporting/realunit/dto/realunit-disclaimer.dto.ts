import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';
import { RealUnitDisclaimerTopic } from '../enums/realunit-disclaimer-topic.enum';

export class RealUnitDisclaimerStatusDto {
  @ApiProperty({
    enum: RealUnitDisclaimerTopic,
    isArray: true,
    description:
      'Legal-disclaimer steps whose current version the user has not accepted yet, in the order the wizard must show them. Empty = nothing to confirm, the client skips the disclaimer. The backend is the single source of truth for required steps/versions.',
  })
  requiredSteps: RealUnitDisclaimerTopic[];
}

export class ConfirmDisclaimerDto {
  @ApiProperty({
    enum: RealUnitDisclaimerTopic,
    isArray: true,
    description:
      'Disclaimer steps the user accepted in this session. The server stamps each with the current required version — the client does not send versions.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(RealUnitDisclaimerTopic, { each: true })
  steps: RealUnitDisclaimerTopic[];
}
