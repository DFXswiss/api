import { ApiProperty } from '@nestjs/swagger';

export class ValidationFormatDto {
  @ApiProperty({
    description: 'JavaScript RegExp source pattern. Compile with the accompanying flags to validate a value.',
    example: '^[\\x20-\\x7E]*$',
  })
  pattern: string;

  @ApiProperty({
    description: 'JavaScript RegExp flags belonging to the pattern (may be empty).',
    example: 'u',
  })
  flags: string;
}

export class FormatsDto {
  @ApiProperty({
    type: ValidationFormatDto,
    description:
      'Allowed character set for user-supplied name and address fields (SIX SIG IG QR-Bill v2.3): printable ASCII ' +
      'plus the Latin diacritics required for the four Swiss national languages. Authoritative mirror of the ' +
      'server-side @IsSwissPaymentText() validator — clients should validate against this instead of hardcoding a copy.',
  })
  swissPaymentText: ValidationFormatDto;
}

export class ConfigDto {
  @ApiProperty({
    type: FormatsDto,
    description:
      'Authoritative input validation patterns. Clients fetch these once and validate user input against them at ' +
      'runtime instead of re-encoding the rules. The server keeps re-validating authoritatively.',
  })
  formats: FormatsDto;
}
