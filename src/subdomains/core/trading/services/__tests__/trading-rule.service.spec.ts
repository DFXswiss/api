import { createMock } from '@golevelup/ts-jest';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { PriceUnavailableException } from '../../../../supporting/pricing/domain/exceptions/price-unavailable.exception';
import { TradingRule } from '../../entities/trading-rule.entity';
import { TradingRuleStatus } from '../../enums';
import { TradingRuleService } from '../trading-rule.service';
import { TradingService } from '../trading.service';

describe('TradingRuleService', () => {
  let service: TradingRuleService;
  let tradingService: jest.Mocked<TradingService>;
  let loggerLog: jest.SpyInstance;

  const rule = {
    id: 7,
    status: TradingRuleStatus.ACTIVE,
    leftAsset: { blockchain: Blockchain.ETHEREUM },
    rightAsset: { blockchain: Blockchain.ETHEREUM },
  } as unknown as TradingRule;

  beforeEach(() => {
    loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

    tradingService = createMock<TradingService>();
    service = new TradingRuleService(tradingService);
    (service as any).ruleRepo = { findBy: jest.fn().mockResolvedValue([rule]) };
    (service as any).orderRepo = { save: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs a price-source outage at warn', async () => {
    tradingService.createTradingInfo.mockRejectedValue(
      new PriceUnavailableException(
        'Failed to get price',
        new Error('connect ETIMEDOUT 203.0.113.10:443'),
      ),
    );

    await service.processRules();

    expect(loggerLog).toHaveBeenCalledWith(
      LogLevel.WARN,
      expect.stringContaining('trading rule 7'),
      expect.any(PriceUnavailableException),
    );
  });

  it('keeps unexpected failures at error', async () => {
    tradingService.createTradingInfo.mockRejectedValue(new Error('unexpected'));

    await service.processRules();

    expect(loggerLog).toHaveBeenCalledWith(
      LogLevel.ERROR,
      expect.stringContaining('trading rule 7'),
      expect.any(Error),
    );
  });
});
