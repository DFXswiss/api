import { Body, Controller, UseGuards, Post, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Balances } from 'ccxt';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { OrderResponse } from './dto/order-response.dto';
import { Order } from './dto/order.dto';
import { KrakenService } from './kraken.service';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  constructor(private readonly krakenService: KrakenService) { }

  @Get('kraken/balances')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  getBalance(): Promise<Balances> {
    return this.krakenService.fetchBalances();
  }

  @Post('kraken/swap')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  swap(@Body() orderDto: Order): Promise<OrderResponse> {
    return this.krakenService.swap(orderDto.from, orderDto.to, orderDto.amount);
  }
}
