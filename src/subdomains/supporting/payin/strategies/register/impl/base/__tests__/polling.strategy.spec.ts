import { NodeNotReadyError } from 'src/integration/blockchain/bitcoin/node/rpc';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
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
    warn = jest.spyOn((strategy as any).logger, 'warn').mockImplementation();
    error = jest.spyOn((strategy as any).logger, 'error').mockImplementation();
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
});
