import { ApiProperty } from '@nestjs/swagger';

export class PdfDto {
  @ApiProperty({ description: 'Base64 encoded PDF' })
  pdfBase64: string;
}
