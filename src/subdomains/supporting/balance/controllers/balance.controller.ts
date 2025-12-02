import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PdfDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/pdf.dto';
import { GetBalancePdfDto } from '../dto/input/get-balance-pdf.dto';
import { BalancePdfService } from '../services/balance-pdf.service';

@ApiTags('Balance')
@Controller('balance')
export class BalanceController {
  constructor(private readonly balancePdfService: BalancePdfService) {}

  @Get('pdf')
  @ApiOkResponse({ type: PdfDto, description: 'Balance PDF report (base64 encoded)' })
  async getBalancePdf(@Query() dto: GetBalancePdfDto): Promise<PdfDto> {
    const pdfData = await this.balancePdfService.generateBalancePdf(dto);
    return { pdfData };
  }
}
