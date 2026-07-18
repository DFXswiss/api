import { NodeNotReadyError } from 'src/integration/blockchain/bitcoin/node/rpc';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { NODE_WARMUP_ESCALATE_MS, PollingStrategy } from '../polling.strategy';

class TestPollingStrategy extends PollingStrategy {
  getBlockHeight = jest.fn();
  processNewPayInEntries = jest.fn().mockResolvedValue(undefined);

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }
}

describe('PollingStrategy', () => {
  let strategy: TestPollingStrategy;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    strategy = new TestPollingStrategy();
    warn = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('processes new pay-ins when the block height advances', async () => {
    strategy.getBlockHeight.mockResolvedValue(100);

    await strategy.checkPayInEntries();

    expect(strategy.processNewPayInEntries).toHaveBeenCalledTimes(1);
  });

  it('skips the cycle without throwing while the node is warming up', async () => {
    strategy.getBlockHeight.mockRejectedValue(new NodeNotReadyError('getblockcount', 'Verifying blocks...'));

    await expect(strategy.checkPayInEntries()).resolves.toBeUndefined();
    expect(strategy.processNewPayInEntries).not.toHaveBeenCalled();
  });

  it('skips the cycle without throwing when the node warms up mid-cycle (processNewPayInEntries)', async () => {
    strategy.getBlockHeight.mockResolvedValue(100);
    strategy.processNewPayInEntries.mockRejectedValueOnce(
      new NodeNotReadyError('getblockchaininfo', 'Verifying blocks...'),
    );

    await expect(strategy.checkPayInEntries()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    // blockHeight did not advance, so the next ready cycle reprocesses the same height
    await strategy.checkPayInEntries();
    expect(strategy.processNewPayInEntries).toHaveBeenCalledTimes(2);
  });

  it('logs the warmup warning only once across consecutive warming cycles', async () => {
    strategy.getBlockHeight.mockRejectedValue(new NodeNotReadyError('getblockcount', 'Loading wallet...'));

    await strategy.checkPayInEntries();
    await strategy.checkPayInEntries();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('re-arms the warning after the node recovers', async () => {
    strategy.getBlockHeight.mockRejectedValueOnce(new NodeNotReadyError('getblockcount', 'Loading block index...'));
    await strategy.checkPayInEntries();

    strategy.getBlockHeight.mockResolvedValueOnce(100);
    await strategy.checkPayInEntries();

    strategy.getBlockHeight.mockRejectedValueOnce(new NodeNotReadyError('getblockcount', 'Verifying blocks...'));
    await strategy.checkPayInEntries();

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('escalates to an error if the node stays in warmup past the threshold', async () => {
    const t0 = 1_000_000_000;
    const now = jest.spyOn(Date, 'now');
    strategy.getBlockHeight.mockRejectedValue(new NodeNotReadyError('getblockcount', 'Verifying blocks...'));

    now.mockReturnValue(t0);
    await strategy.checkPayInEntries();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();

    now.mockReturnValue(t0 + NODE_WARMUP_ESCALATE_MS + 1);
    await strategy.checkPayInEntries();
    expect(error).toHaveBeenCalledTimes(1);

    await strategy.checkPayInEntries();
    expect(error).toHaveBeenCalledTimes(1); // escalated only once, not every tick

    now.mockRestore();
  });

  it('re-throws non-warmup errors so they still surface', async () => {
    const realError = Object.assign(new Error('Bitcoin RPC getblockcount failed: boom'), { code: -5 });
    strategy.getBlockHeight.mockRejectedValue(realError);

    await expect(strategy.checkPayInEntries()).rejects.toBe(realError);
    expect(strategy.processNewPayInEntries).not.toHaveBeenCalled();
  });

  // A wedged/restarting node produces one connection failure per polling cycle for the
  // whole outage; the strategy must log the outage edges, not every cycle.
  describe('node outage (connection failures)', () => {
    let info: jest.SpyInstance;
    let verbose: jest.SpyInstance;

    const refused = () => new Error('Bitcoin RPC getblockcount failed: connect ECONNREFUSED 192.168.107.4:8888');

    beforeEach(() => {
      info = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation();
      verbose = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation();
    });

    it('logs a single error for consecutive connection failures', async () => {
      strategy.getBlockHeight.mockRejectedValue(refused());

      await expect(strategy.checkPayInEntries()).resolves.toBeUndefined();
      await strategy.checkPayInEntries();
      await strategy.checkPayInEntries();

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('suppressing repeats until recovery');
      expect(verbose).toHaveBeenCalledTimes(2);
    });

    it('logs recovery with failure count once the node is back', async () => {
      strategy.getBlockHeight.mockRejectedValueOnce(refused()).mockRejectedValueOnce(refused());
      await strategy.checkPayInEntries();
      await strategy.checkPayInEntries();

      strategy.getBlockHeight.mockResolvedValue(100);
      await strategy.checkPayInEntries();

      expect(info).toHaveBeenCalledTimes(1);
      expect(info.mock.calls[0][0]).toMatch(/recovered after \d+ min \(2 failed checks\)/);
    });

    it('re-arms the outage error after a recovery', async () => {
      strategy.getBlockHeight.mockRejectedValueOnce(refused());
      await strategy.checkPayInEntries();

      strategy.getBlockHeight.mockResolvedValueOnce(100);
      await strategy.checkPayInEntries();

      strategy.getBlockHeight.mockRejectedValueOnce(refused());
      await strategy.checkPayInEntries();

      expect(error).toHaveBeenCalledTimes(2);
    });

    it('stays silent on success when there was no outage', async () => {
      strategy.getBlockHeight.mockResolvedValue(100);

      await strategy.checkPayInEntries();

      expect(info).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it('covers DNS loss during a container restart (ENOTFOUND)', async () => {
      strategy.getBlockHeight.mockRejectedValue(
        new Error('Bitcoin RPC getblockcount failed: getaddrinfo ENOTFOUND firod'),
      );

      await expect(strategy.checkPayInEntries()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('rethrows processNewPayInEntries failures instead of misattributing them to a node outage', async () => {
      // The node itself is healthy (getBlockHeight succeeds) — this is a DB write failure
      // inside processNewPayInEntries, which happens to have a connection-shaped message.
      strategy.getBlockHeight.mockResolvedValue(100);
      const dbError = new Error('insert into pay_in failed: Connection terminated unexpectedly ECONNRESET');
      strategy.processNewPayInEntries.mockRejectedValueOnce(dbError);

      await expect(strategy.checkPayInEntries()).rejects.toBe(dbError);
      expect(error).not.toHaveBeenCalled();
      expect(verbose).not.toHaveBeenCalled();
    });
  });
});
