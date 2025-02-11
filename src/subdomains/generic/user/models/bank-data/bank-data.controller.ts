import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserGuard } from 'src/shared/auth/user.guard';
import { RiskStatus } from 'src/subdomains/generic/kyc/entities/name-check-log.entity';
import { NameCheckService } from 'src/subdomains/generic/kyc/services/name-check.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { BankData } from './bank-data.entity';
import { UpdateBankDataDto } from './dto/update-bank-data.dto';

@ApiTags('bankData')
@Controller('bankData')
export class BankDataController {
  constructor(private readonly bankDataService: BankDataService, private readonly nameCheckService: NameCheckService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async updateBankData(@Param('id') id: string, @Body() dto: UpdateBankDataDto): Promise<BankData> {
    return this.bankDataService.updateBankData(+id, dto);
  }

  @Put(':id/nameCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async doNameCheck(@Param('id') id: string): Promise<RiskStatus> {
    const bankData = await this.bankDataService.getBankData(+id);
    return this.nameCheckService.refreshRiskStatus(bankData);
  }
}
