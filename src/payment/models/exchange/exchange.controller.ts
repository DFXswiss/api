import { Body, Controller, UseGuards, Post, Get, Query, BadRequestException, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Balances, WithdrawalResponse } from 'ccxt';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BinanceService } from './binance.service';
import { OrderResponse } from './dto/order-response.dto';
import { Order } from './dto/order.dto';
import { Price } from './dto/price.dto';
import { Withdraw } from './dto/withdraw.dto';
import { ExchangeService } from './exchange.service';
import { KrakenService } from './kraken.service';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  constructor(private readonly krakenService: KrakenService, private readonly binanceService: BinanceService) {}

  @Get(':exchange/balances')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  getBalance(@Param('exchange') exchange: string): Promise<Balances> {
    return this.getExchange(exchange).getBalances();
  }

  @Get(':exchange/price')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  getPrice(@Param('exchange') exchange: string, @Query('from') from: string, @Query('to') to: string): Promise<Price> {
    return this.getExchange(exchange).getPrice(from.toUpperCase(), to.toUpperCase());
  }

  @Post(':exchange/trade')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  trade(@Param('exchange') exchange: string, @Body() orderDto: Order): Promise<OrderResponse> {
    return this.getExchange(exchange).trade(orderDto.from.toUpperCase(), orderDto.to.toUpperCase(), orderDto.amount);
  }

  @Post(':exchange/withdraw')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  withdrawFunds(@Param('exchange') exchange: string, @Body() withdrawDto: Withdraw): Promise<WithdrawalResponse> {
    return this.getExchange(exchange).withdrawFunds(
      withdrawDto.token.toUpperCase(),
      withdrawDto.amount,
      withdrawDto.address,
      withdrawDto.key,
    );
  }

  private getExchange(exchange: string): ExchangeService {
    switch (exchange) {
      case 'kraken':
        return this.krakenService;
      case 'binance':
        return this.binanceService;
      default:
        throw new BadRequestException(`No service for exchange '${exchange}'`);
    }
  }
}
