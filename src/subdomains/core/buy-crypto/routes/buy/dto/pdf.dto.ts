import { ApiProperty } from '@nestjs/swagger';

export class PdfDto {
  @ApiProperty({ description: 'Base64 encoded PDF' })
  pdfData: string;
}
