import { Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TradingOrderOutputDto } from '../dto/output/trading-order-output.dto';
import { TradingOrderService } from '../services/trading-order.service';

@ApiTags('Trading')
@Controller('trading/order')
export class TradingOrderController {
  constructor(private tradingOrderService: TradingOrderService) {}

  @Patch(':id/process')
  //  @ApiBearerAuth()
  //  @ApiExcludeEndpoint()
  //  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async processNewOrder(@Param('id') id: number): Promise<TradingOrderOutputDto> {
    return this.tradingOrderService.processNewOrder(id);
  }

  @Get('in-progress')
  //  @ApiBearerAuth()
  //  @ApiExcludeEndpoint()
  //  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getProcessingOrders(): Promise<TradingOrderOutputDto[]> {
    return this.tradingOrderService.getProcessingOrders();
  }
}
