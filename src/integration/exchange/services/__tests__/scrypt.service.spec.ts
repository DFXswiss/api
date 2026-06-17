import { ScryptBalanceTransaction, ScryptTransactionStatus, ScryptTransactionType } from '../../dto/scrypt.dto';
import { ScryptService } from '../scrypt.service';

// The ScryptService constructor eagerly instantiates a ScryptWebSocketConnection and kicks off
// fetchAll(...) / subscribeToStream(...) calls, which would otherwise open a real WebSocket. Mock the
// connection module so construction has no network side effects; the actual connection used in the
// assertions is injected per-test via service['connection'].
jest.mock('../scrypt-websocket-connection', () => {
  const actual = jest.requireActual('../scrypt-websocket-connection');
  return {
    ...actual,
    ScryptWebSocketConnection: jest.fn().mockImplementation(() => ({
      fetchAll: jest.fn().mockResolvedValue([]),
      fetch: jest.fn().mockResolvedValue([]),
      subscribeToStream: jest.fn(),
    })),
  };
});

describe('ScryptService - getWithdrawalStatus fallback', () => {
  let service: ScryptService;

  let connection: { fetchAll: jest.Mock };

  const CL_REQ_ID = 'cl-req-id-42';

  function withdrawalTx(overrides: Partial<ScryptBalanceTransaction> = {}): ScryptBalanceTransaction {
    return {
      TransactionID: 'tx-id-1',
      ClReqID: CL_REQ_ID,
      Currency: 'ETH',
      TransactionType: ScryptTransactionType.WITHDRAWAL,
      Status: ScryptTransactionStatus.COMPLETED,
      Quantity: '5',
      TxHash: '0xsettled',
      ...overrides,
    };
  }

  beforeEach(() => {
    service = new ScryptService();

    connection = { fetchAll: jest.fn() };

    // Override the (mocked) connection and start from an empty in-memory cache.
    (service as any).connection = connection;
    (service['balanceTransactions'] as Map<string, ScryptBalanceTransaction>).clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the cached transaction without re-fetching when it already has a TxHash', async () => {
    service['balanceTransactions'].set(CL_REQ_ID, withdrawalTx({ TxHash: '0xcached' }));

    const result = await service.getWithdrawalStatus(CL_REQ_ID);

    expect(connection.fetchAll).not.toHaveBeenCalled();
    expect(result).toMatchObject({ txHash: '0xcached', status: ScryptTransactionStatus.COMPLETED, amount: 5 });
  });

  it('should re-fetch on a cache miss and match a withdrawal by ClReqID, caching the result', async () => {
    connection.fetchAll.mockResolvedValue([withdrawalTx({ ClReqID: 'other-id' }), withdrawalTx()]);

    const result = await service.getWithdrawalStatus(CL_REQ_ID);

    expect(connection.fetchAll).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ txHash: '0xsettled', amount: 5 });
    // cached for next time
    expect(service['balanceTransactions'].get(CL_REQ_ID)?.TxHash).toBe('0xsettled');
  });

  it('should re-fetch when the cached transaction has no TxHash and replace it with the settled record', async () => {
    service['balanceTransactions'].set(CL_REQ_ID, withdrawalTx({ TxHash: undefined }));
    connection.fetchAll.mockResolvedValue([withdrawalTx({ TxHash: '0xnowsettled' })]);

    const result = await service.getWithdrawalStatus(CL_REQ_ID);

    expect(connection.fetchAll).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ txHash: '0xnowsettled' });
    expect(service['balanceTransactions'].get(CL_REQ_ID)?.TxHash).toBe('0xnowsettled');
  });

  it('should return null when the re-fetch yields no matching ClReqID', async () => {
    connection.fetchAll.mockResolvedValue([withdrawalTx({ ClReqID: 'other-id' })]);

    const result = await service.getWithdrawalStatus(CL_REQ_ID);

    expect(connection.fetchAll).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('should return null when a matching ClReqID record is not a WITHDRAWAL', async () => {
    connection.fetchAll.mockResolvedValue([withdrawalTx({ TransactionType: ScryptTransactionType.DEPOSIT })]);

    const result = await service.getWithdrawalStatus(CL_REQ_ID);

    expect(connection.fetchAll).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
