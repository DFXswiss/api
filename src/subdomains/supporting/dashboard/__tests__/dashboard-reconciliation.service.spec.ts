import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { Repository } from 'typeorm';
import { BankTx } from '../../bank-tx/bank-tx/entities/bank-tx.entity';
import { Bank } from '../../bank/bank/bank.entity';
import { Log } from '../../log/log.entity';
import { LogService } from '../../log/log.service';
import { CryptoInput } from '../../payin/entities/crypto-input.entity';
import { PayoutOrder } from '../../payout/entities/payout-order.entity';
import { DashboardReconciliationService } from '../dashboard-reconciliation.service';

describe('DashboardReconciliationService', () => {
  let service: DashboardReconciliationService;
  let logService: LogService;
  let assetRepo: Repository<Asset>;
  let bankTxRepo: Repository<BankTx>;

  beforeEach(async () => {
    logService = createMock<LogService>();
    assetRepo = createMock<Repository<Asset>>();
    bankTxRepo = createMock<Repository<BankTx>>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardReconciliationService,
        { provide: LogService, useValue: logService },
        { provide: getRepositoryToken(Asset), useValue: assetRepo },
        {
          provide: getRepositoryToken(LiquidityManagementOrder),
          useValue: createMock<Repository<LiquidityManagementOrder>>(),
        },
        { provide: getRepositoryToken(PayoutOrder), useValue: createMock<Repository<PayoutOrder>>() },
        { provide: getRepositoryToken(ExchangeTx), useValue: createMock<Repository<ExchangeTx>>() },
        { provide: getRepositoryToken(BankTx), useValue: bankTxRepo },
        { provide: getRepositoryToken(CryptoInput), useValue: createMock<Repository<CryptoInput>>() },
      ],
    }).compile();

    service = module.get<DashboardReconciliationService>(DashboardReconciliationService);
  });

  describe('categorizeAsset', () => {
    // load-bearing case: a bank CUSTODY asset (bank relation set) whose blockchain is not a bank blockchain must
    // still classify as 'bank' — before the fix it fell through to 'blockchain'.
    it('classifies an asset with a bank relation as bank even when its blockchain is not a bank blockchain', () => {
      const asset = { blockchain: Blockchain.ETHEREUM, bank: {} as Bank } as Asset;

      expect(service['categorizeAsset'](asset)).toBe('bank');
    });

    it('classifies an exchange-blockchain asset without a bank relation as exchange', () => {
      const asset = { blockchain: Blockchain.KRAKEN } as Asset;

      expect(service['categorizeAsset'](asset)).toBe('exchange');
    });

    it('classifies an unlisted-blockchain asset without a bank relation as blockchain', () => {
      const asset = { blockchain: Blockchain.ETHEREUM } as Asset;

      expect(service['categorizeAsset'](asset)).toBe('blockchain');
    });
  });

  describe('getOverview', () => {
    // Asset.bank is NOT eager: getReconciliation loads relations ['bank'] on its asset fetch, and the overview asset
    // fetch must too — otherwise the bank-relation check in categorizeAsset is dead on every overview position
    // (precedent: the m3 relations assertion in ledger-reconciliation.service.spec.ts).
    it('loads the bank relation on the overview asset fetch and categorizes a bank-custody asset as bank', async () => {
      const financialLog = Object.assign(new Log(), {
        id: 1,
        created: new Date('2026-07-01T00:00:00Z'),
        message: JSON.stringify({
          assets: { '269': { plusBalance: { liquidity: { liquidityBalance: { total: 100 } } } } },
        }),
      });
      jest.spyOn(logService, 'getFinancialLogAt').mockResolvedValue(financialLog);
      const findSpy = jest.spyOn(assetRepo, 'find').mockResolvedValue([
        {
          id: 269,
          uniqueName: 'Frick/EUR',
          blockchain: Blockchain.ETHEREUM, // NOT a bank blockchain — only the loaded bank relation classifies it
          bank: { id: 1, iban: 'EUR-IBAN' } as Bank,
        } as Asset,
      ]);
      jest.spyOn(bankTxRepo, 'find').mockResolvedValue([]);

      const overview = await service.getOverview({ from: new Date('2026-07-01'), to: new Date('2026-07-10') });

      // the relation on the find IS the fix — without it asset.bank is undefined on every overview asset
      expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({ relations: ['bank'] }));
      // and the full run proves it drives the categorization (bank flows queried via the loaded bank.iban)
      expect(overview.positions).toHaveLength(1);
      expect(overview.positions[0].category).toBe('bank');
      expect(overview.positions[0].startBalance).toBe(100);
    });
  });
});
