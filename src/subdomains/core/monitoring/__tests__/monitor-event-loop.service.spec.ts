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

    it('keeps the ELU reference and histogram untouched when logging throws, then recovers on the next run', () => {
      // Fresh fixtures for this test's two runs, distinct from the 0.7 / 0.873 / 0.65 used
      // above, still satisfying utilization = active / (idle + active).
      const failingCurrent = { idle: 200, active: 800, utilization: 0.8 };
      const failingDelta = { idle: 100, active: 700, utilization: 0.875 };
      const recoveringCurrent = { idle: 500, active: 1500, utilization: 0.75 };
      const recoveringDelta = { idle: 300, active: 500, utilization: 0.625 };

      // `service` (built in the outer beforeEach) already consumed the shared default queue's
      // first snapshot for the field initializer. Override the mock for this test's own two
      // monitorEventLoop() runs so each eventLoopUtilization() call site — the no-arg call for
      // currentElu and the two-arg call for intervalElu — is served explicitly, in call order.
      // A trailing implementation throws instead of silently returning undefined for any call
      // beyond the four expected ones (no stale value is invented for an unaccounted call).
      mockEventLoopUtilization
        .mockReset()
        .mockImplementationOnce(() => failingCurrent)
        .mockImplementationOnce(() => failingDelta)
        .mockImplementationOnce(() => recoveringCurrent)
        .mockImplementationOnce(() => recoveringDelta)
        .mockImplementation(() => {
          throw new Error('Unexpected eventLoopUtilization call in monitor-event-loop error-path test');
        });

      infoSpy.mockImplementationOnce(() => {
        throw new Error('log failed');
      });

      expect(() => service.monitorEventLoop()).toThrow('log failed');
      expect(mockHistogram.reset).not.toHaveBeenCalled();

      service.monitorEventLoop();

      expect(mockEventLoopUtilization).toHaveBeenCalledWith(recoveringCurrent, initialElu);
    });
  });
});
