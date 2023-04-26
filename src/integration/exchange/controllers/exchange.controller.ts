import {
  Body,
  Controller,
  UseGuards,
  Post,
  Get,
  Query,
  Param,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Balances, ExchangeError, Order, Trade, Transaction, WithdrawalResponse } from 'ccxt';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { TradeOrder } from '../dto/trade-order.dto';
import { Price } from '../../../subdomains/supporting/pricing/domain/entities/price';
import { TradeResult, TradeStatus } from '../dto/trade-result.dto';
import { WithdrawalOrder } from '../dto/withdrawal-order.dto';
import { Util } from 'src/shared/utils/util';
import { ExchangeRegistryService } from '../services/exchange-registry.service';
import { ExchangeService, OrderSide } from '../services/exchange.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TradeChangedException } from '../exceptions/trade-changed.exception';
import { PartialTradeResponse, TradeResponse } from '../dto/trade-response.dto';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  private trades: { [key: number]: TradeResult } = {};

  constructor(private readonly registryService: ExchangeRegistryService) {}

  @Get(':exchange/balances')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBalance(@Param('exchange') exchange: string): Promise<Balances> {
    return this.call(exchange, (e) => e.getBalances());
  }

  @Get(':exchange/price')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  getPrice(@Param('exchange') exchange: string, @Query('from') from: string, @Query('to') to: string): Promise<Price> {
    return this.call(exchange, (e) => e.getPrice(from.toUpperCase(), to.toUpperCase()));
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
    return this.call(exchange, (e) => e.getOpenTrades(from?.toUpperCase(), to?.toUpperCase()));
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
    return this.call(exchange, (e) => e.getTrades(undefined, from?.toUpperCase(), to?.toUpperCase()));
  }

  @Post(':exchange/trade')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async trade(@Param('exchange') exchange: string, @Body() { from, to, amount }: TradeOrder): Promise<number> {
    // start and register trade
    const orderId = await this.call(exchange, (e) => e.sell(from.toUpperCase(), to.toUpperCase(), amount));

    const tradeId = Util.randomId();
    this.trades[tradeId] = { exchange, status: TradeStatus.OPEN, orders: [orderId] };

    return tradeId;
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
    const amount = withdrawalDto.amount ? withdrawalDto.amount : await this.call(exchange, (e) => e.getBalance(token));

    return this.registryService
      .getExchange(exchange)
      .withdrawFunds(token, amount, withdrawalDto.address, withdrawalDto.key, withdrawalDto.network);
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
    const withdrawal = await this.call(exchange, (e) => e.getWithdraw(id, token));
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');

    return withdrawal;
  }

  private async call<T>(exchange: string, call: (e: ExchangeService) => Promise<T>): Promise<T> {
    const exchangeService = this.registryService.getExchange(exchange);
    return call(exchangeService).catch((e: ExchangeError) => {
      throw new ServiceUnavailableException(e.message);
    });
  }

  // --- JOBS --- //
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkTrades() {
    const openTrades = Object.values(this.trades).filter(({ status }) => status === TradeStatus.OPEN);
    for (const trade of openTrades) {
      const { exchange, orders } = trade;

      const currentOrder = orders[orders.length - 1];
      try {
        const isComplete = await this.registryService.getExchange(exchange).checkTrade(currentOrder);
        if (isComplete) {
          trade.status = TradeStatus.CLOSED;
          trade.trade = await this.getTradeResponse(exchange, orders);
        }
      } catch (e) {
        if (e instanceof TradeChangedException) {
          orders.push(e.id);
          continue;
        }

        trade.status = TradeStatus.FAILED;
        trade.trade = await this.getTradeResponse(exchange, orders);
        trade.error = e;
      }
    }
  }

  private async getTradeResponse(exchange: string, orders: string[]): Promise<TradeResponse | undefined> {
    const recentTrades = await this.registryService.getExchange(exchange).getTrades();
    const trades = recentTrades.filter((t) => orders.includes(t.order));

    if (trades.length === 0) return undefined;

    const orderList = trades.map((t) => ({
      id: t.id,
      order: t.order,
      price: t.price,
      fromAmount: t.side === OrderSide.BUY ? t.amount * t.price : t.amount,
      toAmount: t.side === OrderSide.BUY ? t.amount : t.amount * t.price,
      timestamp: new Date(t.timestamp),
      fee: t.fee,
    }));

    const avg = this.getWeightedAveragePrice(orderList);

    return {
      orderList,
      orderSummary: {
        currencyPair: trades[0].symbol,
        orderSide: trades[0].side,
        price: avg.price,
        amount: avg.amountSum,
        fees: avg.feeSum,
      },
    };
  }

  private getWeightedAveragePrice(list: PartialTradeResponse[]): { price: number; amountSum: number; feeSum: number } {
    const priceSum = list.reduce((a, b) => a + b.price * b.toAmount, 0);
    const amountSum = Util.round(
      list.reduce((a, b) => a + b.toAmount, 0),
      8,
    );
    const price = Util.round(priceSum / amountSum, 8);
    const feeSum = Util.round(
      list.reduce((a, b) => a + b.fee.cost, 0),
      8,
    );

    return { price, amountSum, feeSum };
  }
}
