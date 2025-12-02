import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Util } from 'src/shared/utils/util';
import { GetBalancePdfDto } from '../dto/input/get-balance-pdf.dto';
import { BalancePdfService } from '../services/balance-pdf.service';

@ApiTags('Balance')
@Controller('balance')
export class BalanceController {
  constructor(private readonly balancePdfService: BalancePdfService) {}

  @Get('pdf')
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'Balance PDF report' })
  async getBalancePdf(
    @Query() dto: GetBalancePdfDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdfBuffer = await this.balancePdfService.generateBalancePdf(dto);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="DFX_Balance_${dto.blockchain}_${Util.filenameDate(dto.date)}.pdf"`,
    });

    return new StreamableFile(pdfBuffer);
  }
}
