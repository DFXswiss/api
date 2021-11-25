import {
  Body,
  Controller,
  UseGuards,
  Post,
  Get,
  Query,
  BadRequestException,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Balances, WithdrawalResponse } from 'ccxt';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BinanceService } from './binance.service';
import { Order } from './dto/order.dto';
import { Price } from './dto/price.dto';
import { Trade, TradeStatus } from './dto/trade.dto';
import { Withdraw } from './dto/withdraw.dto';
import { ExchangeService } from './exchange.service';
import { KrakenService } from './kraken.service';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  private trades: { [key: number]: Trade } = {};

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
  async trade(@Param('exchange') exchange: string, @Body() orderDto: Order): Promise<number> {
    // register trade
    const tradeId = Math.round(Math.random() * 1000000000);
    this.trades[tradeId] = { status: TradeStatus.OPEN, result: undefined };

    // run trade (without waiting)
    this.getExchange(exchange)
      .trade(orderDto.from.toUpperCase(), orderDto.to.toUpperCase(), orderDto.amount)
      .then((r) => (this.trades[tradeId] = { status: TradeStatus.CLOSED, result: r }))
      .catch((e) => {
        console.error(`Exception during trade:`, e);
        this.trades[tradeId] = { status: TradeStatus.FAILED, result: e };
      });

    return tradeId;
  }

  @Get('trade/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getTrade(@Param('id') tradeId: string): Promise<Trade> {
    const trade = this.trades[+tradeId];
    if (!trade) throw new NotFoundException(`No trade found for id ${tradeId}`);
    if (trade.status !== TradeStatus.OPEN) delete this.trades[+tradeId];
    
    return trade;
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
