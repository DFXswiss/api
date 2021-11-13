import { Body, Controller, UseGuards, Post, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Balances, WithdrawalResponse } from 'ccxt';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { OrderResponse } from './dto/order-response.dto';
import { Order } from './dto/order.dto';
import { Withdraw } from './dto/withdraw.dto';
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

  @Post('kraken/trade')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  trade(@Body() orderDto: Order): Promise<OrderResponse> {
    return this.krakenService.trade(orderDto.from, orderDto.to, orderDto.amount);
  }

  @Post('kraken/withdraw')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  withdrawFunds(@Body() withdrawDto: Withdraw): Promise<WithdrawalResponse> {
    return this.krakenService.withdrawFunds(withdrawDto.token, withdrawDto.amount, withdrawDto.address, withdrawDto.key);
  }
}
