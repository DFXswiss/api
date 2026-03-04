import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StructuredErrorDto {
  @ApiProperty({ description: 'Error code' })
  error: string;

  @ApiPropertyOptional({ description: 'Source amount limit' })
  sourceAmountLimit?: number;

  @ApiPropertyOptional({ description: 'Destination amount limit' })
  destinationAmountLimit?: number;
}
