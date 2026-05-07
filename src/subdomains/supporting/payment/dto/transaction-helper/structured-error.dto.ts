import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuoteError } from './quote-error.enum';

export class StructuredErrorDto {
  @ApiProperty({ enum: QuoteError, description: 'Error code' })
  error: QuoteError;

  @ApiPropertyOptional({ description: 'Volume limit in source asset/currency' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Volume limit in target asset/currency' })
  limitTarget?: number;
}
