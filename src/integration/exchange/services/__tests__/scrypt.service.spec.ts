import { DfxLogger } from 'src/shared/services/dfx-logger';
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
  let fetchAllMock: jest.Mock;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchAllMock = jest.fn();
    service = Object.create(ScryptService.prototype) as ScryptService;
    const mutable = service as unknown as {
      balanceTransactions: Map<string, ScryptBalanceTransaction>;
      connection: { fetchAll: jest.Mock };
      logger: DfxLogger;
    };
    mutable.balanceTransactions = new Map();
    mutable.connection = { fetchAll: fetchAllMock };
    mutable.logger = new DfxLogger(ScryptService);
    warnSpy = jest.spyOn(mutable.logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getWithdrawalStatus', () => {
    it('returns a terminal cached withdrawal without calling fetchAll', async () => {
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
      expect(fetchAllMock).not.toHaveBeenCalled();
    });

    it('returns a non-terminal cached withdrawal as-is without calling fetchAll', async () => {
      const cached = createWithdrawalTx({
        ClReqID: 'cl-pending',
        Status: ScryptTransactionStatus.COMPLETED,
        TxHash: undefined,
      });
      service['balanceTransactions'].set('cl-pending', cached);

      const result = await service.getWithdrawalStatus('cl-pending');

      expect(result).toEqual({
        id: 'wtx-1',
        status: ScryptTransactionStatus.COMPLETED,
        txHash: undefined,
        amount: 1.5,
        rejectReason: undefined,
        rejectText: undefined,
      });
      expect(fetchAllMock).not.toHaveBeenCalled();
    });

    it('returns null when cache is absent or entry is the wrong TransactionType', async () => {
      expect(await service.getWithdrawalStatus('missing-id')).toBeNull();
      expect(fetchAllMock).not.toHaveBeenCalled();

      const deposit = createWithdrawalTx({
        ClReqID: 'cl-deposit',
        TransactionType: ScryptTransactionType.DEPOSIT,
        TransactionID: 'dep-1',
      });
      service['balanceTransactions'].set('cl-deposit', deposit);

      expect(await service.getWithdrawalStatus('cl-deposit')).toBeNull();
      expect(fetchAllMock).not.toHaveBeenCalled();
    });
  });

  describe('getAllTransactions', () => {
    it('calls connection.fetchAll with BALANCE_TRANSACTION and applies the since filter on the return value', async () => {
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
      fetchAllMock.mockResolvedValue([oldTx, newTx]);

      const result = await service.getAllTransactions(since);

      expect(fetchAllMock).toHaveBeenCalledTimes(1);
      expect(fetchAllMock).toHaveBeenCalledWith(ScryptMessageType.BALANCE_TRANSACTION, {
        StartDate: since.toISOString(),
      });
      expect(result).toEqual([newTx]);
    });

    it('does not let a non-terminal fetched record clobber a terminal cached one', async () => {
      const terminal = createWithdrawalTx({
        ClReqID: 'X',
        TransactionID: 'term-1',
        Status: ScryptTransactionStatus.COMPLETED,
        TxHash: '0xterminal',
      });
      service['balanceTransactions'].set('X', terminal);

      const nonTerminal = createWithdrawalTx({
        ClReqID: 'X',
        TransactionID: 'stale-1',
        Status: ScryptTransactionStatus.COMPLETED,
        TxHash: undefined,
      });
      fetchAllMock.mockResolvedValue([nonTerminal]);

      await service.getAllTransactions();

      expect(service['balanceTransactions'].get('X')).toBe(terminal);
      const status = await service.getWithdrawalStatus('X');
      expect(status).toEqual(
        expect.objectContaining({
          id: 'term-1',
          status: ScryptTransactionStatus.COMPLETED,
          txHash: '0xterminal',
        }),
      );
    });

    it('updates a non-terminal cache entry when fetchAll returns a terminal record', async () => {
      const nonTerminal = createWithdrawalTx({
        ClReqID: 'X',
        TransactionID: 'pending-1',
        Status: ScryptTransactionStatus.COMPLETED,
        TxHash: undefined,
      });
      service['balanceTransactions'].set('X', nonTerminal);

      const terminal = createWithdrawalTx({
        ClReqID: 'X',
        TransactionID: 'term-1',
        Status: ScryptTransactionStatus.COMPLETED,
        TxHash: '0xhealed',
      });
      fetchAllMock.mockResolvedValue([terminal]);

      await service.getAllTransactions();

      expect(service['balanceTransactions'].get('X')).toBe(terminal);
      const status = await service.getWithdrawalStatus('X');
      expect(status).toEqual(
        expect.objectContaining({
          id: 'term-1',
          status: ScryptTransactionStatus.COMPLETED,
          txHash: '0xhealed',
        }),
      );
    });

    it('logs a warning and falls back to last-known-good cache when fetchAll rejects', async () => {
      const since = new Date('2024-06-15T00:00:00.000Z');
      const oldCached = createWithdrawalTx({
        ClReqID: 'old',
        TransactionID: 'old-1',
        TransactTime: '2024-06-01T00:00:00.000Z',
      });
      const newCached = createWithdrawalTx({
        ClReqID: 'new',
        TransactionID: 'new-1',
        TransactTime: '2024-06-20T00:00:00.000Z',
      });
      service['balanceTransactions'].set('old', oldCached);
      service['balanceTransactions'].set('new', newCached);

      const error = new Error('ws down');
      fetchAllMock.mockRejectedValue(error);

      const result = await service.getAllTransactions(since);

      expect(result).toEqual([newCached]);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to fetch fresh Scrypt balance transactions; using last-known-good cache:',
        error,
      );
      expect(service['balanceTransactions'].get('old')).toBe(oldCached);
      expect(service['balanceTransactions'].get('new')).toBe(newCached);
    });
  });
});
