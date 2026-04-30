import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementPipelineService } from '../services/liquidity-management-pipeline.service';

@ApiTags('liquidityManagement')
@Controller('liquidityManagement/order')
export class LiquidityManagementOrderController {
  constructor(private readonly service: LiquidityManagementPipelineService) {}

  @Get('in-progress')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getProcessingOrders(): Promise<LiquidityManagementOrder[]> {
    return this.service.getProcessingOrders();
  }
}
