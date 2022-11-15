import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementBalanceService } from '../services/liquidity-management-balance.service';

@ApiTags('liquidity-management')
@Controller('liquidity-management/balance')
export class LiquidityBalanceController {
  constructor(private readonly service: LiquidityManagementBalanceService) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBalances(): Promise<LiquidityBalance[]> {
    return this.service.getBalances();
  }
}
