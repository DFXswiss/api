import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityBalance } from 'src/subdomains/core/liquidity-management/entities/liquidity-balance.entity';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { AccountType } from '../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBootstrapService } from '../ledger-bootstrap.service';

describe('LedgerBootstrapService', () => {
  let service: LedgerBootstrapService;

  let ledgerAccountService: LedgerAccountService;
  let assetService: AssetService;
  let liquidityManagementBalanceService: LiquidityManagementBalanceService;

  let created: { name: string; type: AccountType; currency: string; assetId?: number; active?: boolean }[];

  beforeEach(async () => {
    created = [];

    ledgerAccountService = createMock<LedgerAccountService>();
    assetService = createMock<AssetService>();
    liquidityManagementBalanceService = createMock<LiquidityManagementBalanceService>();

    jest
      .spyOn(ledgerAccountService, 'findOrCreate')
      .mockImplementation(async (name, type, currency, assetId, active) => {
        created.push({ name, type, currency, assetId, active });
        return createCustomLedgerAccount({ name, type, currency });
      });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerBootstrapService,
        { provide: LedgerAccountService, useValue: ledgerAccountService },
        { provide: AssetService, useValue: assetService },
        { provide: LiquidityManagementBalanceService, useValue: liquidityManagementBalanceService },
      ],
    }).compile();

    service = module.get<LedgerBootstrapService>(LedgerBootstrapService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates ASSET accounts from custody asset rows with name=uniqueName, currency=dexName, assetId set', async () => {
    const custody = createCustomAsset({
      id: 100,
      uniqueName: 'Kraken/EUR',
      name: 'EUR',
      dexName: 'EUR',
      type: AssetType.CUSTODY,
    });
    jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([custody]);
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);

    await service.bootstrap();

    const asset = created.find((c) => c.name === 'Kraken/EUR');
    expect(asset).toMatchObject({ type: AccountType.ASSET, currency: 'EUR', assetId: 100 });
  });

  it('falls back to asset.name when dexName is null (currency is NOT NULL, Minor R7-8)', async () => {
    const custody = createCustomAsset({
      id: 101,
      uniqueName: 'Sumixx/FOO',
      name: 'FOO',
      dexName: null,
      type: AssetType.CUSTODY,
    });
    jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([custody]);
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);

    await service.bootstrap();

    expect(created.find((c) => c.name === 'Sumixx/FOO')?.currency).toBe('FOO');
  });

  it('includes on-chain wallet assets present in liquidity_balance and excludes CUSTOM/PRESALE', async () => {
    const walletToken = createCustomAsset({
      id: 200,
      uniqueName: 'Ethereum/USDT',
      name: 'USDT',
      dexName: 'USDT',
      type: AssetType.TOKEN,
    });
    const customAsset = createCustomAsset({
      id: 201,
      uniqueName: 'Custom/X',
      name: 'X',
      dexName: 'X',
      type: AssetType.CUSTOM,
    });
    const presaleAsset = createCustomAsset({
      id: 202,
      uniqueName: 'Presale/Y',
      name: 'Y',
      dexName: 'Y',
      type: AssetType.PRESALE,
    });

    jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([walletToken, customAsset, presaleAsset]);
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([
      Object.assign(new LiquidityBalance(), { asset: walletToken, amount: 5 }),
      Object.assign(new LiquidityBalance(), { asset: customAsset, amount: 0 }), // CUSTOM excluded even with feed
    ]);

    await service.bootstrap();

    const assetNames = created.filter((c) => c.type === AccountType.ASSET).map((c) => c.name);
    expect(assetNames).toContain('Ethereum/USDT');
    expect(assetNames).not.toContain('Custom/X');
    expect(assetNames).not.toContain('Presale/Y');
  });

  it('creates the full §3.4 named CoA including INCOME venue-spread symmetry', async () => {
    jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([]);
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);

    await service.bootstrap();

    const names = created.map((c) => c.name);

    // LIABILITY -owed/-received split, no generic LIABILITY/buyCrypto|buyFiat
    expect(names).toContain('LIABILITY/buyFiat-received');
    expect(names).toContain('LIABILITY/buyFiat-owed');
    expect(names).toContain('LIABILITY/buyCrypto-received');
    expect(names).toContain('LIABILITY/buyCrypto-owed');
    expect(names).toContain('LIABILITY/paymentLink');
    expect(names).toContain('LIABILITY/manual-debt');
    expect(names).not.toContain('LIABILITY/buyCrypto');
    expect(names).not.toContain('LIABILITY/buyFiat');

    // INCOME venue-spread accounts symmetric to EXPENSE (Major R12-2)
    for (const venue of ['Binance', 'Scrypt', 'MEXC', 'XT', 'Kraken']) {
      expect(names).toContain(`INCOME/spread-${venue}`);
      expect(names).toContain(`EXPENSE/spread-${venue}`);
    }
    expect(names).toContain('INCOME/fx-revaluation');
    expect(names).toContain('EXPENSE/fx-revaluation'); // 're-', not fx-valuation (Minor R3-4)
    expect(names).toContain('EXPENSE/refReward'); // camelCase (Minor R2-4)
    expect(names).toContain('EXPENSE/spread-arbitrage');

    // EQUITY + single ROUNDING + SUSPENSE
    expect(names).toContain('EQUITY/opening-balance');
    expect(names).toContain('EQUITY/retained-earnings');
    expect(names.filter((n) => n === 'ROUNDING')).toHaveLength(1);
    expect(names).not.toContain('INCOME/rounding');
    expect(names).not.toContain('EXPENSE/rounding');
    expect(names).toContain('SUSPENSE');
    expect(names).toContain('SUSPENSE/untracked-bank-Raiffeisen-EUR');
  });

  it('creates direction-neutral TRANSIT accounts (↔, never →)', async () => {
    jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([]);
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);

    await service.bootstrap();

    const transitNames = created.filter((c) => c.type === AccountType.TRANSIT).map((c) => c.name);
    expect(transitNames).toContain('TRANSIT/bank↔Scrypt/EUR');
    expect(transitNames).toContain('TRANSIT/bank↔bank/CHF');
    expect(transitNames).toContain('TRANSIT/wallet↔Binance/USDT');
    expect(transitNames).toContain('TRANSIT/payout/CHF');
    expect(transitNames).toContain('TRANSIT/internal-fx/EUR');
    expect(transitNames.some((n) => n.includes('→'))).toBe(false);

    // currency is the native ticker
    expect(created.find((c) => c.name === 'TRANSIT/wallet↔Binance/USDT')?.currency).toBe('USDT');
  });

  it('is idempotent — findOrCreate per account (re-run no-op via UNIQUE(name))', async () => {
    jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([]);
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);

    await service.bootstrap();
    const firstRunCount = (ledgerAccountService.findOrCreate as jest.Mock).mock.calls.length;

    // findOrCreate guarantees no duplicate names; a re-run resolves existing accounts
    expect(firstRunCount).toBeGreaterThan(0);
    expect(new Set(created.map((c) => c.name)).size).toBe(created.length); // no duplicate names
  });
});
