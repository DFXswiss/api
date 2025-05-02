import { ApiProperty } from '@nestjs/swagger';

export class ReceiptDto {
  @ApiProperty({ description: 'Base64 encoded file' })
  receiptPdf: string;
}
