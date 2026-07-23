import { ScryptMessageType, ScryptWebSocketConnection } from '../scrypt-websocket-connection';
import { ScryptService } from '../scrypt.service';

jest.mock('src/config/config', () => {
  const mockConfig = {
    scrypt: {
      apiKey: 'k',
      apiSecret: 's',
      wsUrl: 'wss://x',
    },
  };
  return {
    Config: mockConfig,
    GetConfig: () => mockConfig,
  };
});

jest.mock('../scrypt-websocket-connection', () => {
  const actual = jest.requireActual('../scrypt-websocket-connection');
  return {
    ...actual,
    ScryptWebSocketConnection: jest.fn().mockImplementation(() => ({
      fetchAll: jest.fn().mockResolvedValue([]),
      fetch: jest.fn().mockResolvedValue([]),
      subscribeToStream: jest.fn().mockReturnValue(() => undefined),
      onReconnect: jest.fn(),
      send: jest.fn(),
      requestAndWaitForUpdate: jest.fn(),
    })),
  };
});

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

describe('ScryptService', () => {
  let service: ScryptService;
  let instance: {
    fetchAll: jest.Mock;
    onReconnect: jest.Mock;
    subscribeToStream: jest.Mock;
  };

  beforeEach(async () => {
    (ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>).mockClear();
    service = new ScryptService();
    instance = (ScryptWebSocketConnection as jest.MockedClass<typeof ScryptWebSocketConnection>).mock.results[0]
      .value as any;
    // Constructor warm-up fetchAll calls settle on empty arrays before tests reconfigure.
    await flushPromises();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('catchUpAfterReconnect fetches fresh state and applies terminal-aware balance-tx cache writes', async () => {
    const now = new Date().toISOString();

    const existingNonTerminal = {
      ClReqID: 'a',
      TransactionID: 'tx-a-old',
      Status: 'Completed',
      Timestamp: now,
    };
    const existingTerminal = {
      ClReqID: 'b',
      TransactionID: 'tx-b-terminal',
      Status: 'Rejected',
      Timestamp: now,
    };
    (service as any).balanceTransactions.set('a', existingNonTerminal);
    (service as any).balanceTransactions.set('b', existingTerminal);
    const terminalBBefore = (service as any).balanceTransactions.get('b');

    const freshTerminalA = {
      ClReqID: 'a',
      TransactionID: 'tx-a-new',
      Status: 'Completed',
      TxHash: 'hash1',
      Timestamp: now,
    };
    const freshNonTerminalB = {
      ClReqID: 'b',
      TransactionID: 'tx-b-nonterminal',
      Status: 'Completed',
      Timestamp: now,
    };
    const freshReport = {
      ClOrdID: 'ord-1',
      SubmitTime: now,
      OrderID: 'oid-1',
    };

    instance.fetchAll.mockImplementation(async (streamName: string) => {
      if (streamName === ScryptMessageType.BALANCE_TRANSACTION || streamName === 'BalanceTransaction') {
        return [freshTerminalA, freshNonTerminalB];
      }
      if (streamName === ScryptMessageType.EXECUTION_REPORT || streamName === 'ExecutionReport') {
        return [freshReport];
      }
      return [];
    });

    await (service as any).catchUpAfterReconnect();

    expect((service as any).balanceTransactions.get('a')).toEqual(freshTerminalA);
    expect((service as any).balanceTransactions.get('b')).toBe(terminalBBefore);
    expect((service as any).balanceTransactions.get('b')).toEqual(existingTerminal);
    expect((service as any).executionReports.get('ord-1')).toEqual(freshReport);
  });

  it('registers catch-up via connection.onReconnect in the constructor', () => {
    expect(instance.onReconnect).toHaveBeenCalledTimes(1);
    expect(instance.onReconnect).toHaveBeenCalledWith(expect.any(Function));
  });
});
