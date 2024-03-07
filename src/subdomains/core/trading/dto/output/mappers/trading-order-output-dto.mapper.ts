import { TradingOrder } from '../../../entities/trading-order.entity';
import { TradingOrderOutputDto } from '../trading-order-output.dto';

export class TradingOrderOutputDtoMapper {
  static entityToDto(order: TradingOrder): TradingOrderOutputDto {
    const dto = new TradingOrderOutputDto();

    dto.status = order.status;
    dto.tradingRuleId = order.tradingRule.id;
    dto.price1 = order.price1;
    dto.price2 = order.price2;
    dto.priceImpact = order.priceImpact;
    dto.assetInId = order.assetIn.id;
    dto.assetOutId = order.assetOut.id;
    dto.amountIn = order.amountIn;
    dto.txId = order.txId;
    dto.errorMessage = order.errorMessage;

    return dto;
  }

  static entitiesToDtos(orders: TradingOrder[]): TradingOrderOutputDto[] {
    return orders.map(TradingOrderOutputDtoMapper.entityToDto);
  }
}
