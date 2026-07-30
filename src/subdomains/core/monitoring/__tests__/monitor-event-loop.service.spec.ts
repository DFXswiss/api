import { performance } from 'perf_hooks';
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

// Spread keeps real performance intact; spyOn avoids Object.create ERR_INVALID_THIS and process-wide mutation.
jest.mock('perf_hooks', () => {
  const actual = jest.requireActual<typeof import('perf_hooks')>('perf_hooks');
  return {
    ...actual,
    monitorEventLoopDelay: jest.fn(() => mockHistogram),
  };
});

import { MonitorEventLoopService } from '../monitor-event-loop.service';

describe('MonitorEventLoopService', () => {
  let service: MonitorEventLoopService;
  let infoSpy: jest.SpyInstance;

  // idle-only rather than all-zero: 0/(0+0) is NaN, so an all-zero fixture would be the
  // one value in this set that does not satisfy utilization = active / (idle + active).
  const initialElu = { idle: 100, active: 0, utilization: 0 };
  const firstCurrent = { idle: 300, active: 700, utilization: 0.7 };
  const firstDelta = { idle: 127, active: 873, utilization: 0.873 };
  const secondCurrent = { idle: 600, active: 1400, utilization: 0.7 };
  const secondDelta = { idle: 350, active: 650, utilization: 0.65 };

  beforeEach(() => {
    mockHistogram.enable.mockClear();
    mockHistogram.disable.mockClear();
    mockHistogram.reset.mockClear();
    mockHistogram.mean = 28_000_000;
    mockHistogram.max = 202_000_000;
    mockHistogram.percentile.mockReset().mockReturnValue(46_000_000);

    const snapshots = [initialElu, firstCurrent, secondCurrent];
    let snapshotIndex = 0;

    mockEventLoopUtilization.mockReset();
    mockEventLoopUtilization.mockImplementation((...args: unknown[]) => {
      if (args.length === 0) {
        if (snapshotIndex >= snapshots.length) {
          throw new Error(`Unexpected eventLoopUtilization() snapshot call #${snapshotIndex + 1}`);
        }
        return snapshots[snapshotIndex++];
      }
      if (args.length === 2) {
        const current = args[0];
        if (current === firstCurrent) return firstDelta;
        if (current === secondCurrent) return secondDelta;
        throw new Error('Unexpected eventLoopUtilization(current, previous) with unknown current sample');
      }
      throw new Error(`Unexpected eventLoopUtilization arity: ${args.length}`);
    });

    jest
      .spyOn(performance, 'eventLoopUtilization')
      .mockImplementation((...args: unknown[]) => mockEventLoopUtilization(...args));

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

      expect(mockEventLoopUtilization).toHaveBeenCalledWith(firstCurrent, initialElu);
      expect(mockEventLoopUtilization).toHaveBeenCalledWith(secondCurrent, firstCurrent);
      expect(infoSpy).toHaveBeenNthCalledWith(
        2,
        'EventLoop delay: mean 28ms / p95 46ms / max 202ms / utilization 65.0%',
      );
    });
  });
});
