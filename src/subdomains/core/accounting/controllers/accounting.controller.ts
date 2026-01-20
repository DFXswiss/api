import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AccountingService } from '../services/accounting.service';
import { BankBalanceSheetDto, DetailedBalanceSheetDto } from '../dto/accounting-report.dto';

@ApiTags('Accounting')
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('balance-sheet/:iban/:year')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  @ApiOkResponse({ type: BankBalanceSheetDto })
  async getBankBalanceSheet(@Param('iban') iban: string, @Param('year') year: string): Promise<BankBalanceSheetDto> {
    return this.accountingService.getBankBalanceSheet(iban, parseInt(year, 10));
  }

  @Get('balance-sheet/:iban/:year/detailed')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  @ApiOkResponse({ type: DetailedBalanceSheetDto })
  async getDetailedBalanceSheet(
    @Param('iban') iban: string,
    @Param('year') year: string,
  ): Promise<DetailedBalanceSheetDto> {
    return this.accountingService.getDetailedBalanceSheet(iban, parseInt(year, 10));
  }
}
