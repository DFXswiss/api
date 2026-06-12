import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType } from '../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountRepository } from '../../repositories/ledger-account.repository';
import { LedgerAccountService } from '../ledger-account.service';

describe('LedgerAccountService', () => {
  let service: LedgerAccountService;
  let ledgerAccountRepository: LedgerAccountRepository;

  beforeEach(async () => {
    ledgerAccountRepository = createMock<LedgerAccountRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LedgerAccountService, { provide: LedgerAccountRepository, useValue: ledgerAccountRepository }],
    }).compile();

    service = module.get<LedgerAccountService>(LedgerAccountService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('resolves an account character-exact by name', async () => {
    const account = createCustomLedgerAccount({ name: 'LIABILITY/paymentLink' });
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(account);

    await expect(service.findByName('LIABILITY/paymentLink')).resolves.toBe(account);
    expect(ledgerAccountRepository.findOneBy).toHaveBeenCalledWith({ name: 'LIABILITY/paymentLink' });
  });

  it('returns the existing account on findOrCreate without creating a duplicate (idempotent)', async () => {
    const existing = createCustomLedgerAccount({ name: 'ROUNDING', type: AccountType.ROUNDING });
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(existing);
    const saveSpy = jest.spyOn(ledgerAccountRepository, 'save');

    const result = await service.findOrCreate('ROUNDING', AccountType.ROUNDING, 'CHF');

    expect(result).toBe(existing);
    expect(saveSpy).not.toHaveBeenCalled(); // re-run no-op
  });

  it('creates a new ASSET account with assetId relation when missing', async () => {
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null);
    jest.spyOn(ledgerAccountRepository, 'create').mockImplementation((dto: any) => dto);
    jest.spyOn(ledgerAccountRepository, 'save').mockImplementation((a: any) => Promise.resolve(a));

    const result = await service.findOrCreate('Kraken/EUR', AccountType.ASSET, 'EUR', 100);

    expect(result).toMatchObject({ name: 'Kraken/EUR', type: AccountType.ASSET, currency: 'EUR' });
    expect((result as any).asset).toEqual({ id: 100 });
  });

  it('looks up an ASSET account by assetId via the relation', async () => {
    const account = createCustomLedgerAccount({ name: 'Kraken/EUR', type: AccountType.ASSET });
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(account);

    await expect(service.findByAssetId(100)).resolves.toBe(account);
    expect(ledgerAccountRepository.findOneBy).toHaveBeenCalledWith({ asset: { id: 100 } });
  });
});
