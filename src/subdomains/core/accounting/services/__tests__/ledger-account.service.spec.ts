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

  // findOrCreate is NOT atomic (find→create→save). Two consumer crons lazily creating the SAME account race: the
  // loser's save hits UNIQUE(name) (SQLSTATE 23505). It must catch exactly that, reload the winner's row and return
  // it (true idempotent no-op) — the old code let the 23505 bubble up and crash the loser's booking run.
  it('returns the concurrent winner’s row when save races into a UNIQUE(name) violation (23505)', async () => {
    const winner = createCustomLedgerAccount({ name: 'TRANSIT/paymentLink', type: AccountType.TRANSIT });
    jest
      .spyOn(ledgerAccountRepository, 'findOneBy')
      .mockResolvedValueOnce(null) // initial lookup: not there yet → proceed to create/save
      .mockResolvedValueOnce(winner); // reload after the race: the winner committed it
    jest.spyOn(ledgerAccountRepository, 'create').mockImplementation((dto: any) => dto);
    jest
      .spyOn(ledgerAccountRepository, 'save')
      .mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));

    const result = await service.findOrCreate('TRANSIT/paymentLink', AccountType.TRANSIT, 'CHF');

    expect(result).toBe(winner);
    expect(ledgerAccountRepository.findOneBy).toHaveBeenCalledTimes(2); // initial miss + post-race reload
  });

  // only 23505 is swallowed: any OTHER save error (no code / different code) propagates unchanged (no broad catch).
  it('propagates a non-unique-violation save error unchanged (no broad catch)', async () => {
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null);
    jest.spyOn(ledgerAccountRepository, 'create').mockImplementation((dto: any) => dto);
    jest
      .spyOn(ledgerAccountRepository, 'save')
      .mockRejectedValue(Object.assign(new Error('connection terminated'), { code: '08006' }));

    await expect(service.findOrCreate('LIABILITY/x', AccountType.LIABILITY, 'CHF')).rejects.toThrow(
      /connection terminated/,
    );
    expect(ledgerAccountRepository.findOneBy).toHaveBeenCalledTimes(1); // no post-error reload for a non-race error
  });

  // defensive fail-loud: a 23505 whose row is still not findable (not the expected name race) surfaces the original
  // error instead of returning undefined (which would violate the non-nullable return type).
  it('re-throws the original 23505 when the row is still not findable after the race', async () => {
    const boom = Object.assign(new Error('duplicate key'), { code: '23505' });
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null); // never resolves the row
    jest.spyOn(ledgerAccountRepository, 'create').mockImplementation((dto: any) => dto);
    jest.spyOn(ledgerAccountRepository, 'save').mockRejectedValue(boom);

    await expect(service.findOrCreate('LIABILITY/ghost', AccountType.LIABILITY, 'CHF')).rejects.toBe(boom);
  });

  it('creates a new ASSET account with assetId relation when missing', async () => {
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null);
    jest.spyOn(ledgerAccountRepository, 'create').mockImplementation((dto: any) => dto);
    jest.spyOn(ledgerAccountRepository, 'save').mockImplementation((a: any) => Promise.resolve(a));

    const result = await service.findOrCreate('Kraken/EUR', AccountType.ASSET, 'EUR', 100);

    expect(result).toMatchObject({ name: 'Kraken/EUR', type: AccountType.ASSET, currency: 'EUR' });
    expect((result as any).asset).toEqual({ id: 100 });
    expect((result as any).active).toBe(true); // regression: the bootstrap bug created ASSET accounts inactive
  });

  it('looks up an ASSET account by assetId via the relation', async () => {
    const account = createCustomLedgerAccount({ name: 'Kraken/EUR', type: AccountType.ASSET });
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(account);

    await expect(service.findByAssetId(100)).resolves.toBe(account);
    expect(ledgerAccountRepository.findOneBy).toHaveBeenCalledWith({ asset: { id: 100 } });
  });

  // findByAssetId normalises a repository null to undefined (the `?? undefined` branch, line 16) — callers branch on
  // `if (!account)` to throw a CoA-bootstrap-missing error, so the null→undefined mapping must hold.
  it('returns undefined (not null) from findByAssetId when no account exists for the assetId', async () => {
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null);

    await expect(service.findByAssetId(404)).resolves.toBeUndefined();
  });

  // findByName mirrors the same null→undefined normalisation (the `?? undefined` branch of findByName)
  it('returns undefined (not null) from findByName when the account does not exist', async () => {
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null);

    await expect(service.findByName('LIABILITY/does-not-exist')).resolves.toBeUndefined();
  });

  // findOrCreate creates a non-ASSET account WITHOUT an assetId relation (the `assetId != null ? … : undefined`
  // false branch, line 35) — a CHF LIABILITY bucket carries no asset relation.
  it('creates a LIABILITY account with NO asset relation when assetId is omitted (undefined branch)', async () => {
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null);
    jest.spyOn(ledgerAccountRepository, 'create').mockImplementation((dto: any) => dto);
    jest.spyOn(ledgerAccountRepository, 'save').mockImplementation((a: any) => Promise.resolve(a));

    const result = await service.findOrCreate('LIABILITY/unattributed', AccountType.LIABILITY, 'CHF');

    expect(result).toMatchObject({ name: 'LIABILITY/unattributed', type: AccountType.LIABILITY, currency: 'CHF' });
    expect((result as any).asset).toBeUndefined(); // no assetId → no asset relation
    expect((result as any).active).toBe(true); // default active=true
  });
});
