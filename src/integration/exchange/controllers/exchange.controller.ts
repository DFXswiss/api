import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CronExpression } from '@nestjs/schedule';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Balances, ExchangeError, Order, Trade, Transaction, WithdrawalResponse } from 'ccxt';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../../subdomains/supporting/pricing/domain/entities/price';
import { TradeOrder } from '../dto/trade-order.dto';
import { PartialTradeResponse, TradeResponse } from '../dto/trade-response.dto';
import { TradeResult, TradeStatus } from '../dto/trade-result.dto';
import { WithdrawalOrder } from '../dto/withdrawal-order.dto';
import { TradeChangedException } from '../exceptions/trade-changed.exception';
import { ExchangeRegistryService } from '../services/exchange-registry.service';
import { ExchangeService, OrderSide } from '../services/exchange.service';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  private readonly logger = new DfxLogger(ExchangeController);

  private trades: { [key: number]: TradeResult } = {};

  constructor(private readonly exchangeRegistry: ExchangeRegistryService) {}

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
    return this.call(exchange, (e) => e.getTrades(from?.toUpperCase(), to?.toUpperCase()));
  }

  @Post(':exchange/trade')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async trade(@Param('exchange') exchange: string, @Body() { from, to, amount }: TradeOrder): Promise<number> {
    // start and register trade
    const orderId = await this.call(exchange, (e) => e.sell(from.toUpperCase(), to.toUpperCase(), amount));

    const tradeId = Util.randomId();
    this.trades[tradeId] = {
      exchange,
      status: TradeStatus.OPEN,
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      orders: [orderId],
    };

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

    return this.exchangeRegistry
      .get(exchange)
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
    const exchangeService = this.exchangeRegistry.get(exchange);
    return call(exchangeService).catch((e: ExchangeError) => {
      throw new ServiceUnavailableException(e.message);
    });
  }

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_30_SECONDS, { timeout: 1800 })
  async checkTrades() {
    const openTrades = Object.values(this.trades).filter(({ status }) => status === TradeStatus.OPEN);
    for (const trade of openTrades) {
      const { exchange, from, to, orders } = trade;

      const currentOrder = orders[orders.length - 1];
      try {
        const isComplete = await this.exchangeRegistry.get(exchange).checkTrade(currentOrder, from, to);
        if (isComplete) {
          trade.status = TradeStatus.CLOSED;
          trade.trade = await this.getTradeResponse(exchange, from, to, orders);
        }
      } catch (e) {
        if (e instanceof TradeChangedException) {
          orders.push(e.id);
          continue;
        }

        this.logger.warn(`Trade on ${exchange} failed:`, e);

        trade.status = TradeStatus.FAILED;
        trade.trade = await this.getTradeResponse(exchange, from, to, orders);
        trade.error = e;
      }
    }
  }

  private async getTradeResponse(
    exchange: string,
    from: string,
    to: string,
    orders: string[],
  ): Promise<TradeResponse | undefined> {
    try {
      const recentTrades = await this.exchangeRegistry.get(exchange).getTrades(from, to);
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
    } catch (e) {
      this.logger.error(`Failed to get trade result on ${exchange}:`, e);
      return undefined;
    }
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
