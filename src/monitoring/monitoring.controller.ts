import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MonitoringService } from './monitoring.service';

@ApiTags('monitoring')
@Controller('monitoring')
export class MonitoringController {
  constructor(private monitoringService: MonitoringService) {}

  @Get('data')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getMonitoringData(): Promise<any> {
    return {
      kycStatus: await this.monitoringService.getKycStatusData(),
      bankTxWithoutType: await this.monitoringService.getBankTxWithoutType(),
      incompleteTransactions: await this.monitoringService.getIncompleteTransactions(),
      lastOutputDates: await this.monitoringService.getLastOutputDates(),
      nodeBalances: await this.monitoringService.getNodeBalances(),
      stakingBalance: await this.monitoringService.getStakingBalance(),
      userWithoutIpCountry: await this.monitoringService.getUserWithoutIpCountry(),
      wrongStakingRewards: await this.monitoringService.getWrongCryptoStaking(),
    };
  }
}
