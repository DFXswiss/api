import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MonitoringService } from './monitoring.service';
import { BalanceStatus } from './dto/monitoring.dto';

@ApiTags('monitoring')
@Controller('monitoring')
export class MonitoringController {
  constructor(private monitoringService: MonitoringService) {}

  @Get('balanceStatus')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBalanceStatus(): Promise<BalanceStatus> {
    return this.monitoringService.getBalanceStatus();
  }

  @Get('data')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getMonitoringData(): Promise<any> {
    return {
      kycStatus: await this.monitoringService.getKycStatusData(),
      bankTxWithoutType: await this.monitoringService.getBankTxWithoutType(),
      incompleteTransactions: await this.monitoringService.getIncompleteTransactions(),
      lastPayoutDates: await this.monitoringService.getLatestPayoutDates(),
      nodeBalances: await this.monitoringService.getNodeBalances(),
    };
  }
}
