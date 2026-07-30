import { DfxLogger } from 'src/shared/services/dfx-logger';

const mockHistogram = {
  enable: jest.fn(),
  disable: jest.fn(),
  reset: jest.fn(),
  mean: 28_000_000,
  max: 202_000_000,
  percentile: jest.fn().mockReturnValue(46_000_000),
};

const mockEventLoopUtilization = jest.fn();

jest.mock('perf_hooks', () => ({
  monitorEventLoopDelay: jest.fn(() => mockHistogram),
  performance: {
    eventLoopUtilization: (...args: unknown[]) => mockEventLoopUtilization(...args),
  },
}));

import { MonitorEventLoopService } from '../monitor-event-loop.service';

describe('MonitorEventLoopService', () => {
  let service: MonitorEventLoopService;
  let infoSpy: jest.SpyInstance;

  const initialElu = { idle: 0, active: 0, utilization: 0 };
  const firstCurrent = { idle: 100, active: 700, utilization: 0.873 };
  const firstDelta = { idle: 100, active: 700, utilization: 0.873 };
  const secondCurrent = { idle: 200, active: 1400, utilization: 0.9 };
  const secondDelta = { idle: 100, active: 700, utilization: 0.85 };

  beforeEach(() => {
    mockHistogram.enable.mockClear();
    mockHistogram.disable.mockClear();
    mockHistogram.reset.mockClear();
    mockHistogram.mean = 28_000_000;
    mockHistogram.max = 202_000_000;
    mockHistogram.percentile.mockReset().mockReturnValue(46_000_000);

    mockEventLoopUtilization.mockReset();
    mockEventLoopUtilization
      .mockReturnValueOnce(initialElu)
      .mockReturnValueOnce(firstCurrent)
      .mockReturnValueOnce(firstDelta)
      .mockReturnValueOnce(secondCurrent)
      .mockReturnValueOnce(secondDelta);

    infoSpy = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation();

    service = new MonitorEventLoopService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('monitorEventLoop', () => {
    it('logs delay metrics unchanged and utilization with one decimal place', () => {
      service.monitorEventLoop();

      expect(infoSpy).toHaveBeenCalledWith('EventLoop delay: mean 28ms / p95 46ms / max 202ms / utilization 87.3%');
      expect(mockHistogram.reset).toHaveBeenCalled();
    });

    it('advances the ELU reference so the second run uses the first current sample', () => {
      service.monitorEventLoop();
      service.monitorEventLoop();

      // Field init: mock.calls[0] (no args)
      // First monitorEventLoop: [1] current, [2] delta(current, lastElu=initial)
      // Second monitorEventLoop: [3] current, [4] delta(current, lastElu=firstCurrent)
      expect(mockEventLoopUtilization.mock.calls[2][1]).toBe(initialElu);
      expect(mockEventLoopUtilization.mock.calls[4][1]).toBe(firstCurrent);
      expect(mockEventLoopUtilization).toHaveBeenNthCalledWith(5, secondCurrent, firstCurrent);
    });
  });
});
