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
import { Balances, Order, Trade, Transaction, WithdrawalResponse } from 'ccxt';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { TradeOrder } from './dto/trade-order.dto';
import { Price } from './dto/price.dto';
import { TradeResult, TradeStatus } from './dto/trade-result.dto';
import { WithdrawalOrder } from './dto/withdrawal-order.dto';

import { Util } from 'src/shared/utils/util';
import { BinanceService } from './services/binance.service';
import { BitpandaService } from './services/bitpanda.service';
import { BitstampService } from './services/bitstamp.service';
import { ExchangeService } from './services/exchange.service';
import { KrakenService } from './services/kraken.service';
import { KucoinService } from './services/kucoin.service';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  private trades: { [key: number]: TradeResult } = {};

  constructor(
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
    private readonly bitpandaService: BitpandaService,
    private readonly kucoinService: KucoinService,
  ) {}

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
  async trade(@Param('exchange') exchange: string, @Body() orderDto: TradeOrder): Promise<number> {
    // register trade
    const tradeId = Util.randomId();
    this.trades[tradeId] = { status: TradeStatus.OPEN };

    // run trade (without waiting)
    this.getExchange(exchange)
      // trade
      .trade(orderDto.from.toUpperCase(), orderDto.to.toUpperCase(), orderDto.amount)
      .then((r) => this.updateTrade(tradeId, { status: TradeStatus.WITHDRAWING, trade: r }))
      // withdraw
      .then((r) =>
        orderDto.withdrawal
          ? this.withdrawFunds(exchange, {
              token: orderDto.to,
              amount: orderDto.withdrawal.withdrawAll ? undefined : r.trade.orderSummary.amount,
              ...orderDto.withdrawal,
            })
          : undefined,
      )
      .then((r) => this.updateTrade(tradeId, { status: TradeStatus.CLOSED, withdraw: r }))
      // error
      .catch((e) => {
        console.error(`Exception during trade:`, e);
        this.updateTrade(tradeId, { status: TradeStatus.FAILED, error: e });
      });

    return tradeId;
  }

  @Get(':exchange/trade')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getTrades(
    @Param('exchange') exchange: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<Order[]> {
    return this.getExchange(exchange).getOpenTrades(from?.toUpperCase(), to?.toUpperCase());
  }

  @Get(':exchange/trade/history')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getTradeHistory(
    @Param('exchange') exchange: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<Trade[]> {
    return this.getExchange(exchange).getTrades(from?.toUpperCase(), to?.toUpperCase());
  }

  @Get('trade/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getTrade(@Param('id') tradeId: string): Promise<TradeResult> {
    const trade = this.trades[+tradeId];
    if (!trade) throw new NotFoundException('Trade not found');
    if ([TradeStatus.CLOSED, TradeStatus.FAILED].includes(trade.status)) delete this.trades[+tradeId];

    return trade;
  }

  @Post(':exchange/withdraw')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async withdrawFunds(
    @Param('exchange') exchange: string,
    @Body() withdrawalDto: WithdrawalOrder,
  ): Promise<WithdrawalResponse> {
    const token = withdrawalDto.token.toUpperCase();
    const amount = withdrawalDto.amount ? withdrawalDto.amount : await this.getExchange(exchange).getBalance(token);

    return this.getExchange(exchange).withdrawFunds(
      token,
      amount,
      withdrawalDto.address,
      withdrawalDto.key,
      withdrawalDto.network,
    );
  }

  @Get(':exchange/withdraw/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getWithdraw(
    @Param('exchange') exchange: string,
    @Param('id') id: string,
    @Query('token') token: string,
  ): Promise<Transaction> {
    return this.getExchange(exchange).getWithdraw(id, token);
  }

  private getExchange(exchange: string): ExchangeService {
    switch (exchange) {
      case 'kraken':
        return this.krakenService;
      case 'binance':
        return this.binanceService;
      case 'bitstamp':
        return this.bitstampService;
      case 'bitpanda':
        return this.bitpandaService;
      case 'kucoin':
        return this.kucoinService;
      default:
        throw new BadRequestException(`No service for exchange '${exchange}'`);
    }
  }

  private updateTrade(tradeId: number, result: Partial<TradeResult>): TradeResult {
    return (this.trades[tradeId] = { ...this.trades[tradeId], ...result });
  }
}
