import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { GetReferencePricesCommand } from '../commands/get-reference-prices.command';
import { BinanceService } from 'src/payment/models/exchange/binance.service';
import { BitstampService } from 'src/payment/models/exchange/bitstamp.service';
import { KrakenService } from 'src/payment/models/exchange/kraken.service';
import { PriceReceivedEvent } from '../events/price-ready.event';
import { Price } from 'src/payment/models/exchange/dto/price.dto';

type PriceSource = string;

@CommandHandler(GetReferencePricesCommand)
export class GetReferencePricesHandler implements ICommandHandler<GetReferencePricesCommand> {
  constructor(
    private readonly eventBus: EventBus,
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
  ) {}

  async execute(command: GetReferencePricesCommand) {
    // can be cached and updated periodically, only new pairs would results in direct call
    const price = await this.getMatchingPrice(command.payload.from, command.payload.to);
    this.eventBus.publish(new PriceReceivedEvent(command.correlationId, price));
  }

  private async getMatchingPrice(fromCurrency: string, toCurrency: string, matchThreshold = 0.02): Promise<Price> {
    const mainPrice = await this.krakenService.getPrice(fromCurrency, toCurrency);
    const [refPrice, refSource] = await this.getReferencePrice(fromCurrency, toCurrency);

    const { price: _mainPrice } = mainPrice;
    const { price: _refPrice } = refPrice;

    if (Math.abs(_refPrice - _mainPrice) / _mainPrice > matchThreshold)
      throw new Error(
        `${fromCurrency} to ${toCurrency} price mismatch (kraken: ${_mainPrice}, ${refSource}: ${_refPrice})`,
      );

    return mainPrice;
  }

  private async getReferencePrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceSource]> {
    try {
      return [await this.binanceService.getPrice(fromCurrency, toCurrency), 'binance'];
    } catch {}

    try {
      return [await this.bitstampService.getPrice(fromCurrency, toCurrency), 'bitstamp'];
    } catch {}

    throw new Error(
      `Could not find reference price at both Binance and Bitstamp. From ${fromCurrency} to ${toCurrency}`,
    );
  }
}
