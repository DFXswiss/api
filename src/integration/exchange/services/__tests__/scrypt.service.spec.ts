import { ScryptBalanceTransaction, ScryptTransactionStatus, ScryptTransactionType } from '../../dto/scrypt.dto';
import { ScryptMessageType } from '../scrypt-websocket-connection';
import { ScryptService } from '../scrypt.service';

function createWithdrawalTx(overrides: Partial<ScryptBalanceTransaction> = {}): ScryptBalanceTransaction {
  const now = new Date();
  return {
    TransactionID: 'wtx-1',
    ClReqID: 'cl-req-1',
    Currency: 'ETH',
    TransactionType: ScryptTransactionType.WITHDRAWAL,
    Status: ScryptTransactionStatus.COMPLETED,
    Quantity: '1.5',
    TxHash: '0xhash-1',
    Timestamp: now.toISOString(),
    TransactTime: now.toISOString(),
    ...overrides,
  };
}

describe('ScryptService', () => {
  let service: ScryptService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    service = Object.create(ScryptService.prototype) as ScryptService;
    const mutable = service as unknown as {
      balanceTransactions: Map<string, ScryptBalanceTransaction>;
      connection: { fetch: jest.Mock };
    };
    mutable.balanceTransactions = new Map();
    mutable.connection = { fetch: fetchMock };
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getWithdrawalStatus', () => {
    it('returns a cached withdrawal without calling connection.fetch', async () => {
      const cached = createWithdrawalTx({ ClReqID: 'cl-cached' });
      service['balanceTransactions'].set('cl-cached', cached);

      const result = await service.getWithdrawalStatus('cl-cached');

      expect(result).toEqual({
        id: 'wtx-1',
        status: ScryptTransactionStatus.COMPLETED,
        txHash: '0xhash-1',
        amount: 1.5,
        rejectReason: undefined,
        rejectText: undefined,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches on cache miss, returns the match, and caches it for subsequent calls', async () => {
      const fetched = createWithdrawalTx({ ClReqID: 'cl-miss', TransactionID: 'wtx-miss' });
      fetchMock.mockResolvedValue([fetched]);

      const first = await service.getWithdrawalStatus('cl-miss');
      expect(first).toEqual(
        expect.objectContaining({
          id: 'wtx-miss',
          status: ScryptTransactionStatus.COMPLETED,
          txHash: '0xhash-1',
          amount: 1.5,
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        ScryptMessageType.BALANCE_TRANSACTION,
        expect.objectContaining({ StartDate: expect.any(String) }),
      );

      const second = await service.getWithdrawalStatus('cl-miss');
      expect(second).toEqual(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns null when cache miss and fetch has no matching transaction', async () => {
      fetchMock.mockResolvedValue([createWithdrawalTx({ ClReqID: 'other-id' })]);

      const result = await service.getWithdrawalStatus('missing-id');

      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls through to fetch when the cached entry is a DEPOSIT and uses the fetched withdrawal', async () => {
      const deposit = createWithdrawalTx({
        ClReqID: 'cl-wrong-type',
        TransactionType: ScryptTransactionType.DEPOSIT,
        TransactionID: 'dep-1',
        TxHash: '0xdep',
      });
      service['balanceTransactions'].set('cl-wrong-type', deposit);

      const withdrawal = createWithdrawalTx({
        ClReqID: 'cl-wrong-type',
        TransactionID: 'wtx-real',
        TxHash: '0xwd',
        Quantity: '2.25',
      });
      fetchMock.mockResolvedValue([withdrawal]);

      const result = await service.getWithdrawalStatus('cl-wrong-type');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          id: 'wtx-real',
          status: ScryptTransactionStatus.COMPLETED,
          txHash: '0xwd',
          amount: 2.25,
        }),
      );
    });
  });

  describe('getAllTransactions', () => {
    it('fetches fresh via connection.fetch, caches all results, and applies the since filter on the return value', async () => {
      const since = new Date('2024-06-15T00:00:00.000Z');
      const oldTx = createWithdrawalTx({
        ClReqID: 'old',
        TransactionID: 'old-1',
        TransactTime: '2024-06-01T00:00:00.000Z',
      });
      const newTx = createWithdrawalTx({
        ClReqID: 'new',
        TransactionID: 'new-1',
        TransactTime: '2024-06-20T00:00:00.000Z',
      });
      fetchMock.mockResolvedValue([oldTx, newTx]);

      const result = await service.getAllTransactions(since);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(ScryptMessageType.BALANCE_TRANSACTION, {
        StartDate: since.toISOString(),
      });
      expect(result).toEqual([newTx]);
      expect(service['balanceTransactions'].get('old')).toBe(oldTx);
      expect(service['balanceTransactions'].get('new')).toBe(newTx);
    });
  });
});
