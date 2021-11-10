import { Body, Controller, UseGuards, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { OrderResponse } from './dto/order-response.dto';
import { Order } from './dto/order.dto';
import { KrakenService } from './kraken.service';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  constructor(private readonly krakenService: KrakenService) {}

  @Post('kraken')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createBlockchainPayment(@Body() orderDto: Order): Promise<OrderResponse> {
    return this.krakenService.createOrder(orderDto.from, orderDto.to, orderDto.amount);
  }
}
