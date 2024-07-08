import { ApiProperty } from '@nestjs/swagger';

export class InvoiceDto {
  @ApiProperty({ description: 'Base64 encoded file' })
  invoicePdf: string;
}
