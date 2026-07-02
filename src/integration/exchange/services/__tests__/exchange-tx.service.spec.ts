import { createMock } from '@golevelup/ts-jest';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { ScryptBalanceTransaction, ScryptTransactionStatus, ScryptTransactionType } from '../../dto/scrypt.dto';
import { ExchangeTx, ExchangeTxType } from '../../entities/exchange-tx.entity';
import { ExchangeName } from '../../enums/exchange.enum';
import { ExchangeTxRepository } from '../../repositories/exchange-tx.repository';
import { ExchangeRegistryService } from '../exchange-registry.service';
import { ExchangeTxService } from '../exchange-tx.service';
import { ScryptService } from '../scrypt.service';

function createDepositTx(overrides: Partial<ScryptBalanceTransaction> = {}): ScryptBalanceTransaction {
  const now = new Date();
  return {
    TransactionID: 'tx-1',
    Currency: 'CHF',
    TransactionType: ScryptTransactionType.DEPOSIT,
    Status: ScryptTransactionStatus.COMPLETED,
    Quantity: '100.5',
    TxHash: 'hash-1',
    Timestamp: now.toISOString(),
    TransactTime: now.toISOString(),
    ...overrides,
  };
}

describe('ExchangeTxService', () => {
  let service: ExchangeTxService;

  let exchangeTxRepo: ExchangeTxRepository;
  let registryService: ExchangeRegistryService;
  let assetService: AssetService;
  let pricingService: PricingService;
  let fiatService: FiatService;

  beforeEach(() => {
    exchangeTxRepo = createMock<ExchangeTxRepository>();
    registryService = createMock<ExchangeRegistryService>();
    assetService = createMock<AssetService>();
    pricingService = createMock<PricingService>();
    fiatService = createMock<FiatService>();

    jest.spyOn(exchangeTxRepo, 'create').mockImplementation((dto) => dto as ExchangeTx);
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    service = new ExchangeTxService(exchangeTxRepo, registryService, assetService, pricingService, fiatService);
  });

  afterEach(() => jest.restoreAllMocks());

  // helper: drain the serialized event queue
  const flushQueue = () => service['scryptTxQueue'];

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('event-driven Scrypt deposits', () => {
    it('creates a new exchange_tx row for a COMPLETED deposit event', async () => {
      jest.spyOn(exchangeTxRepo, 'findOneBy').mockResolvedValue(null);

      service['handleScryptTransactions']([createDepositTx()]);
      await flushQueue();

      expect(exchangeTxRepo.save).toHaveBeenCalledTimes(1);
      expect(exchangeTxRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          exchange: ExchangeName.SCRYPT,
          type: ExchangeTxType.DEPOSIT,
          externalId: 'tx-1',
          status: 'ok',
          currency: 'CHF',
          txId: 'hash-1',
          amount: 100.5,
        }),
      );
    });

    it('updates an existing pending row to ok', async () => {
      const existing = {
        id: 7,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.DEPOSIT,
        externalId: 'tx-1',
        status: 'pending',
        externalUpdated: new Date(Date.now() - 60_000),
        amount: 100.5,
      } as ExchangeTx;
      jest.spyOn(exchangeTxRepo, 'findOneBy').mockResolvedValue(existing);

      service['handleScryptTransactions']([createDepositTx()]);
      await flushQueue();

      expect(exchangeTxRepo.create).not.toHaveBeenCalled();
      expect(exchangeTxRepo.save).toHaveBeenCalledTimes(1);
      expect(exchangeTxRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 7, status: 'ok' }));
    });

    it('does not save when the existing row is fresher than the event (stale guard)', async () => {
      const existing = { id: 7, externalUpdated: new Date(), status: 'ok' } as ExchangeTx;
      jest.spyOn(exchangeTxRepo, 'findOneBy').mockResolvedValue(existing);

      // two hours old: within the 1-day recency bound but older than the DB row
      const olderTx = createDepositTx({ Timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });
      service['handleScryptTransactions']([olderTx]);
      await flushQueue();

      expect(exchangeTxRepo.save).not.toHaveBeenCalled();
    });

    it('ignores withdrawal and unknown transaction types', async () => {
      const withdrawal = createDepositTx({ TransactionType: ScryptTransactionType.WITHDRAWAL, TransactionID: 'w-1' });
      const unknown = createDepositTx({ TransactionType: 'Fee' as ScryptTransactionType, TransactionID: 'f-1' });

      service['handleScryptTransactions']([withdrawal, unknown]);
      await flushQueue();

      expect(exchangeTxRepo.findOneBy).not.toHaveBeenCalled();
      expect(exchangeTxRepo.save).not.toHaveBeenCalled();
    });

    it('ignores deposits older than one day', async () => {
      const oldTx = createDepositTx({ Timestamp: Util.daysBefore(2).toISOString() });

      service['handleScryptTransactions']([oldTx]);
      await flushQueue();

      expect(exchangeTxRepo.findOneBy).not.toHaveBeenCalled();
      expect(exchangeTxRepo.save).not.toHaveBeenCalled();
    });

    it('catches a save rejection and continues with the rest of the batch', async () => {
      jest.spyOn(exchangeTxRepo, 'findOneBy').mockResolvedValue(null);
      jest
        .spyOn(exchangeTxRepo, 'save')
        .mockRejectedValueOnce(new Error('unique constraint'))
        .mockResolvedValueOnce({} as ExchangeTx);

      const depA = createDepositTx({ TransactionID: 'a', TxHash: 'ha' });
      const depB = createDepositTx({ TransactionID: 'b', TxHash: 'hb' });

      service['handleScryptTransactions']([depA, depB]);
      await expect(flushQueue()).resolves.toBeUndefined();

      expect(exchangeTxRepo.save).toHaveBeenCalledTimes(2);
    });

    it('skips event-driven writes while the sync process is disabled', async () => {
      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);
      jest.spyOn(exchangeTxRepo, 'findOneBy').mockResolvedValue(null);

      service['handleScryptTransactions']([createDepositTx()]);
      await flushQueue();

      expect(exchangeTxRepo.findOneBy).not.toHaveBeenCalled();
      expect(exchangeTxRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('syncExchanges stale guard', () => {
    let scryptService: ScryptService;

    // pass an explicit `from` so getSyncSinceDate (which reads global Config) is bypassed
    const syncFrom = Util.daysBefore(1);

    beforeEach(() => {
      scryptService = Object.create(ScryptService.prototype);
      (scryptService as unknown as { getAllTransactions: jest.Mock }).getAllTransactions = jest.fn();
      (scryptService as unknown as { getTrades: jest.Mock }).getTrades = jest.fn().mockResolvedValue([]);

      jest.spyOn(registryService, 'getExchange').mockReturnValue(scryptService);
    });

    it('skips overwriting a row the event path already updated with fresher data', async () => {
      const snapshotTs = new Date(Date.now() - 60_000).toISOString(); // run-start snapshot is 1 min stale
      const snapshot = createDepositTx({
        TransactionID: 'tx-sync',
        TxHash: 'hash-sync',
        Timestamp: snapshotTs,
        TransactTime: snapshotTs,
      });
      (scryptService as unknown as { getAllTransactions: jest.Mock }).getAllTransactions.mockResolvedValue([snapshot]);

      const fresher = {
        id: 9,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.DEPOSIT,
        externalId: 'tx-sync',
        externalUpdated: new Date(),
        amount: 100.5,
        amountChf: 100.5,
        status: 'ok',
      } as ExchangeTx;
      jest.spyOn(exchangeTxRepo, 'findOneBy').mockResolvedValue(fresher);

      await service.syncExchanges(syncFrom, ExchangeName.SCRYPT);

      expect(exchangeTxRepo.save).not.toHaveBeenCalled();
    });

    it('still saves when the snapshot is not older than the row', async () => {
      const ts = new Date();
      const snapshot = createDepositTx({
        TransactionID: 'tx-sync-2',
        TxHash: 'hash-sync-2',
        Timestamp: ts.toISOString(),
        TransactTime: ts.toISOString(),
      });
      (scryptService as unknown as { getAllTransactions: jest.Mock }).getAllTransactions.mockResolvedValue([snapshot]);

      const existing = {
        id: 10,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.DEPOSIT,
        externalId: 'tx-sync-2',
        externalUpdated: new Date(ts), // equal timestamp → guard does not skip
        amount: 100.5,
        amountChf: 100.5, // already priced → no pricing calls needed
        status: 'ok',
      } as ExchangeTx;
      jest.spyOn(exchangeTxRepo, 'findOneBy').mockResolvedValue(existing);

      await service.syncExchanges(syncFrom, ExchangeName.SCRYPT);

      expect(exchangeTxRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});
