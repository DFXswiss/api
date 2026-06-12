import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import {
  LiquidityManagementOrderStatus,
  LiquidityManagementSystem,
} from 'src/subdomains/core/liquidity-management/enums';
import { Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { LiquidityMgmtConsumer } from '../liquidity-mgmt.consumer';

const ZCHF_ASSET_ID = 401; // target asset (stable, mark ≈ 1)

function account(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency, assetId } as any);
}

// builds a Complete LM order with an eager action (system/command) + pipeline.rule.targetAsset (bridge target)
function lmOrder(values: {
  id: number;
  system: LiquidityManagementSystem;
  command: string;
  outputAmount?: number;
  targetAssetId?: number;
  targetDexName?: string;
}): LiquidityManagementOrder {
  return Object.assign(new LiquidityManagementOrder(), {
    id: values.id,
    updated: new Date('2026-06-07T00:00:00Z'),
    status: LiquidityManagementOrderStatus.COMPLETE,
    outputAmount: values.outputAmount,
    action: { system: values.system, command: values.command },
    pipeline: {
      rule: {
        targetAsset:
          values.targetAssetId != null
            ? { id: values.targetAssetId, name: 'ZCHF', dexName: values.targetDexName ?? 'ZCHF' }
            : undefined,
      },
    },
  }) as LiquidityManagementOrder;
}

describe('LiquidityMgmtConsumer', () => {
  let consumer: LiquidityMgmtConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let settingService: SettingService;
  let orderRepo: Repository<LiquidityManagementOrder>;

  let booked: LedgerTxInput[];
  let accounts: Map<string, LedgerAccount>;
  let nextSeqValue: number;

  const zchfWallet = account('Frankencoin/ZCHF', AccountType.ASSET, 'ZCHF', ZCHF_ASSET_ID);

  const markMap = new Map([[ZCHF_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 1 }]]]);

  beforeEach(async () => {
    booked = [];
    nextSeqValue = 0;
    accounts = new Map();

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    settingService = createMock<SettingService>();
    orderRepo = createMock<Repository<LiquidityManagementOrder>>();

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockImplementation(() => Promise.resolve(nextSeqValue));

    jest.spyOn(accountService, 'findByAssetId').mockResolvedValue(zchfWallet);
    jest
      .spyOn(accountService, 'findOrCreate')
      .mockImplementation((name: string, type: AccountType, currency: string) => {
        const existing = accounts.get(name);
        if (existing) return Promise.resolve(existing);
        const acc = account(name, type, currency);
        accounts.set(name, acc);
        return Promise.resolve(acc);
      });

    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(markMap));
    jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);
    jest.spyOn(settingService, 'set').mockResolvedValue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        LiquidityMgmtConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(LiquidityManagementOrder), useValue: orderRepo },
      ],
    }).compile();

    consumer = module.get<LiquidityMgmtConsumer>(LiquidityMgmtConsumer);
  });

  const cents = (legs: LedgerLegInput[]) => legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
  const mockBatch = (rows: LiquidityManagementOrder[]) => jest.spyOn(orderRepo, 'find').mockResolvedValue(rows);
  const leg = (tx: LedgerTxInput, name: string) => tx.legs.find((l) => l.account.name === name);

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  // §4.8 Zweig 4 — bridge: Dr ASSET/wallet-target / Cr TRANSIT/bridge/{ccy}, both same mark → Σ CHF = 0, no plug
  it('books a *Bridge order as a TRANSIT/bridge movement (Zweig 4)', async () => {
    mockBatch([
      lmOrder({
        id: 10,
        system: LiquidityManagementSystem.ARBITRUM_L2_BRIDGE,
        command: 'deposit',
        outputAmount: 1000,
        targetAssetId: ZCHF_ASSET_ID,
      }),
    ]);
    await consumer.process();

    expect(booked).toHaveLength(1);
    const tx = booked[0];
    expect(tx.sourceType).toBe('liquidity_management_order');
    expect(tx.sourceId).toBe('10'); // stable entity PK, NOT correlationId (Minor R8-5)
    const wallet = leg(tx, 'Frankencoin/ZCHF');
    const transit = leg(tx, 'TRANSIT/bridge/ZCHF');
    expect(wallet.amount).toBe(1000);
    expect(wallet.amountChf).toBe(1000); // mark 1 × 1000
    expect(transit.amount).toBe(-1000);
    expect(transit.amountChf).toBe(-1000);
    expect(cents(tx.legs)).toBe(0); // single currency, same mark → no spread plug needed
  });

  // §4.8 Zweig 4 — dEURO bridge-in: system=dEURO (otherwise exchange) + command='bridge-in' → BOOK (not skip)
  it('books a dEURO bridge-in order (Zweig 4, NOT skipped as exchange)', async () => {
    mockBatch([
      lmOrder({
        id: 11,
        system: LiquidityManagementSystem.DEURO,
        command: 'bridge-in',
        outputAmount: 500,
        targetAssetId: ZCHF_ASSET_ID,
      }),
    ]);
    await consumer.process();
    expect(booked).toHaveLength(1);
    expect(leg(booked[0], 'TRANSIT/bridge/ZCHF')).toBeDefined();
  });

  // §4.8 Zweig 1 DEDUP: exchange-routed → SKIP (exchange_tx authoritative). The same transfer must NOT be booked
  // by the LM consumer — the exchange_tx consumer owns it (no double booking across the matrix).
  it.each([
    LiquidityManagementSystem.BINANCE,
    LiquidityManagementSystem.MEXC,
    LiquidityManagementSystem.SCRYPT,
    LiquidityManagementSystem.KRAKEN,
    LiquidityManagementSystem.XT,
    LiquidityManagementSystem.FRANKENCOIN,
    LiquidityManagementSystem.DEURO,
    LiquidityManagementSystem.JUICE,
  ])('skips %s exchange-routed orders (Zweig 1, exchange_tx authoritative)', async (system) => {
    mockBatch([lmOrder({ id: 20, system, command: 'withdraw', outputAmount: 100, targetAssetId: ZCHF_ASSET_ID })]);
    await consumer.process();
    expect(booked).toHaveLength(0); // dedup: exchange_tx books this movement, not the LM consumer
  });

  // §4.8 Zweig 2 DEDUP: DfxDex purchase/sell → SKIP (liquidity_order dex authoritative, §4.8a). The same on-chain
  // swap must NOT be booked by both the LM consumer AND the LiquidityOrderDex consumer.
  it.each(['purchase', 'sell'])('skips DfxDex %s orders (Zweig 2, liquidity_order dex authoritative)', async (cmd) => {
    mockBatch([
      lmOrder({
        id: 21,
        system: LiquidityManagementSystem.DFX_DEX,
        command: cmd,
        outputAmount: 100,
        targetAssetId: ZCHF_ASSET_ID,
      }),
    ]);
    await consumer.process();
    expect(booked).toHaveLength(0); // dedup: §4.8a books this swap, not the LM consumer
  });

  // §4.8 Zweig 3 DEDUP: DfxDex withdraw → SKIP (target deposit exchange_tx authoritative)
  it('skips DfxDex withdraw orders (Zweig 3, target deposit exchange_tx authoritative)', async () => {
    mockBatch([
      lmOrder({
        id: 22,
        system: LiquidityManagementSystem.DFX_DEX,
        command: 'withdraw',
        outputAmount: 100,
        targetAssetId: ZCHF_ASSET_ID,
      }),
    ]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // §4.8 idempotency: an already-booked bridge order (nextSeq > 0) is not re-booked
  it('is idempotent: skips an already-booked bridge order (re-run, nextSeq > 0)', async () => {
    nextSeqValue = 1;
    mockBatch([
      lmOrder({
        id: 23,
        system: LiquidityManagementSystem.BASE_L2_BRIDGE,
        command: 'deposit',
        outputAmount: 100,
        targetAssetId: ZCHF_ASSET_ID,
      }),
    ]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // §4.8 missing target mark → needsMark on both legs, no silent priceChf=0
  it('flags both bridge legs needsMark when the target mark is missing', async () => {
    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map()));
    mockBatch([
      lmOrder({
        id: 24,
        system: LiquidityManagementSystem.LAYERZERO_BRIDGE,
        command: 'deposit',
        outputAmount: 100,
        targetAssetId: ZCHF_ASSET_ID,
      }),
    ]);
    await consumer.process();
    const tx = booked[0];
    expect(leg(tx, 'Frankencoin/ZCHF').needsMark).toBe(true);
    expect(leg(tx, 'Frankencoin/ZCHF').amountChf).toBeUndefined();
    expect(leg(tx, 'TRANSIT/bridge/ZCHF').needsMark).toBe(true);
  });

  // §4.8 bridge with no target/amount → skip + log, no booking
  it('skips a bridge order without a target asset or output amount', async () => {
    mockBatch([
      lmOrder({ id: 25, system: LiquidityManagementSystem.BOLTZ, command: 'deposit', outputAmount: undefined }),
    ]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  it('advances the watermark after a successful batch', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      lmOrder({
        id: 26,
        system: LiquidityManagementSystem.POLYGON_L2_BRIDGE,
        command: 'deposit',
        outputAmount: 100,
        targetAssetId: ZCHF_ASSET_ID,
      }),
    ]);
    await consumer.process();
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(26);
  });

  // a skipped (non-booking) batch still advances the watermark so skipped rows are not re-scanned forever
  it('advances the watermark even when the batch only contains skipped (non-bridge) orders', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([lmOrder({ id: 27, system: LiquidityManagementSystem.BINANCE, command: 'withdraw', outputAmount: 100 })]);
    await consumer.process();
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(27);
  });

  it('no-ops on an empty batch', async () => {
    mockBatch([]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });
});
