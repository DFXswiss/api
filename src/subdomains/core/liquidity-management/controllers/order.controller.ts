import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { ResolveUncertainOrderDto } from '../dto/resolve-uncertain-order.dto';
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

  @Put(':id/resolveUncertain')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async resolveUncertainOrder(
    @GetJwt() jwt: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveUncertainOrderDto,
  ): Promise<void> {
    return this.service.resolveUncertainOrderManually(id, dto, jwt.account);
  }
}
