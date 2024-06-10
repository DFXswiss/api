import { ApiProperty } from '@nestjs/swagger';

export class SwissQRInvoiceDto {
  @ApiProperty()
  base64Enc: string;
}
