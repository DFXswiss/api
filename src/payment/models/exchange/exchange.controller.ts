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
import { TradeOrder } from './dto/trade-order.dto';
import { Price } from './dto/price.dto';
import { TradeResult, TradeStatus } from './dto/trade-result.dto';
import { WithdrawalOrder } from './dto/withdrawal-order.dto';
import { ExchangeService } from './exchange.service';
import { KrakenService } from './kraken.service';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  private trades: { [key: number]: TradeResult } = {};

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
  async trade(@Param('exchange') exchange: string, @Body() orderDto: TradeOrder): Promise<number> {
    // register trade
    const tradeId = Math.round(Math.random() * 1000000000);
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

  @Get('trade/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getTrade(@Param('id') tradeId: string): Promise<TradeResult> {
    const trade = this.trades[+tradeId];
    if (!trade) throw new NotFoundException(`No trade found for id ${tradeId}`);
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

    return this.getExchange(exchange).withdrawFunds(token, amount, withdrawalDto.address, withdrawalDto.key);
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

  private updateTrade(tradeId: number, result: Partial<TradeResult>): TradeResult {
    return (this.trades[tradeId] = { ...this.trades[tradeId], ...result });
  }
}
