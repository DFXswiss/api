import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PdfBrand } from 'src/shared/utils/pdf.util';
import { PdfDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/pdf.dto';
import { GetBalancePdfDto } from '../dto/input/get-balance-pdf.dto';
import { BalancePdfService } from '../services/balance-pdf.service';

@ApiTags('Balance')
@Controller('balance')
export class BalanceController {
  constructor(private readonly balancePdfService: BalancePdfService) {}

  @Get('pdf')
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: PdfDto, description: 'Balance PDF report (base64 encoded)' })
  async getBalancePdf(@Query() dto: GetBalancePdfDto): Promise<PdfDto> {
    const pdfData = await this.balancePdfService.generateBalancePdf(dto, PdfBrand.DFX);
    return { pdfData };
  }
}
