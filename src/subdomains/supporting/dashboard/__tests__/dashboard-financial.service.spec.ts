import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { Log } from '../../log/log.entity';
import { LogService } from '../../log/log.service';
import { DashboardFinancialService } from '../dashboard-financial.service';

describe('DashboardFinancialService', () => {
  let service: DashboardFinancialService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardFinancialService,
        { provide: LogService, useValue: createMock<LogService>() },
        { provide: AssetService, useValue: createMock<AssetService>() },
        { provide: RefRewardService, useValue: createMock<RefRewardService>() },
      ],
    }).compile();

    service = module.get<DashboardFinancialService>(DashboardFinancialService);
  });

  function mapEntry(changes: unknown) {
    const log = { created: new Date(), message: JSON.stringify({ changes }) } as Log;
    return (service as any).mapChangesLogToEntry(log);
  }

  it('maps the Scrypt and MEXC minus blocks from a new change log', () => {
    const entry = mapEntry({
      minus: {
        scrypt: { total: 229.67, withdraw: 0, trading: 229.67 },
        mexc: { total: 23.22, withdraw: 5, trading: 18.22 },
      },
    });

    expect(entry.minus.scrypt).toEqual({ total: 229.67, withdraw: 0, trading: 229.67 });
    expect(entry.minus.mexc).toEqual({ total: 23.22, withdraw: 5, trading: 18.22 });
  });

  it('defaults Scrypt and MEXC to zero for a historical log without those keys (backward compatibility)', () => {
    const entry = mapEntry({
      minus: {
        bank: 10,
        kraken: { total: 5, withdraw: 2, trading: 3 },
        binance: { total: 7, withdraw: 1, trading: 6 },
      },
    });

    expect(entry.minus.scrypt).toEqual({ total: 0, withdraw: 0, trading: 0 });
    expect(entry.minus.mexc).toEqual({ total: 0, withdraw: 0, trading: 0 });
    expect(entry.minus.binance).toEqual({ total: 7, withdraw: 1, trading: 6 });
  });
});
