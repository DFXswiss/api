import { ConfigService } from 'src/config/config';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { HistoryFilter } from 'src/subdomains/core/history/dto/history-filter.dto';
import { ApiKeyDto } from 'src/subdomains/generic/user/models/user/dto/api-key.dto';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import {
  API_KEY_PROJECTION,
  UserDataRepository,
} from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { DataSource } from 'typeorm';

const SCHEMA = 'api_key_projection_spec';

/**
 * `POST /user/apiKey/CT` — the four levels from `docs/read-path-projections.md`.
 *
 * The endpoint read a whole `UserData` row, eager joins included, to check
 * whether a key exists and to derive a new one from the account id and its creation date.
 *
 * It writes as well as reads, but through `update(id, …)` rather than by saving the row it read, so
 * a projected read cannot blank a column it did not load.
 */
describeProjection('API key — read-path projection', () => {
  let dataSource: DataSource;
  let userDataRepo: UserDataRepository;

  beforeAll(async () => {
    // `createKey` reads the key version off the module-level Config.
    new ConfigService();
    dataSource = await createProjectionDataSource(SCHEMA);
    userDataRepo = new UserDataRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  const seedAccount = (values: Partial<UserData> = {}): Promise<UserData> =>
    seedEntity<UserData>(dataSource, UserData, { values });

  /**
   * What the endpoint answers, through the projected query.
   *
   * The key is assigned in memory before the secret is derived from it, which is what makes
   * `created` part of the read: `getSecret` hashes the two together.
   *
   * The production key mixes in the current time, so two calls a millisecond apart differ. Comparing
   * whole responses across runs would then report every field as required — true of the timestamp,
   * and evidence about nothing. The fixture keeps the dependency that matters, the account id, and
   * leaves the timestamp out.
   */
  async function apiKeyOf(
    id: number,
    fields = API_KEY_PROJECTION.fields,
  ): Promise<{ conflict: true } | { key: string; secret: string }> {
    const userData = await userDataRepo.getForApiKey(id, fields);
    if (userData.apiKeyCT) return { conflict: true as const };

    userData.apiKeyCT = `KEY-FOR-ACCOUNT-${userData.id}`;

    return { key: userData.apiKeyCT, secret: ApiKeyService.getSecret(userData) };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a fresh account answers with a key and a secret', async () => {
    const userData = await seedAccount({ apiKeyCT: null });

    expectNoEmptyFields(await apiKeyOf(userData.id));
  }, 120000);

  // --- LEVEL 2: variants --- //

  it('level 2 — an account that already has a key is refused', async () => {
    // The existing key is the whole conflict check, so a projection that dropped the column would
    // hand out a second key and overwrite the first.
    const userData = await seedAccount({ apiKeyCT: 'existing-key-refused' });

    expect(await apiKeyOf(userData.id)).toEqual({ conflict: true });
  }, 120000);

  it('level 2 — two accounts get different keys and different secrets', async () => {
    const first = await apiKeyOf((await seedAccount({ apiKeyCT: null })).id);
    const second = await apiKeyOf((await seedAccount({ apiKeyCT: null })).id);

    expect(first).not.toEqual(second);
  }, 120000);

  it('level 2 — an unknown id resolves to nothing, so the endpoint can refuse', async () => {
    const userData = await seedAccount({ apiKeyCT: null });

    expect(await userDataRepo.getForApiKey(userData.id + 1_000_000)).toBeNull();
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it('level 3 — the account id and the creation date are required', async () => {
    const userData = await seedAccount({ apiKeyCT: null });

    // The id feeds the key, the creation date the secret derived from it.
    await expectEveryFieldRequired(['userData.id', 'userData.created'], (omitted) =>
      apiKeyOf(userData.id, projectionFieldsWithout(API_KEY_PROJECTION.fields, omitted)),
    );
  }, 300000);

  it('level 3 — the existing key is required to refuse a second one', async () => {
    // On an account without a key, dropping the column produces the same answer as reading it — the
    // conflict branch is only reachable where a key is actually stored.
    const userData = await seedAccount({ apiKeyCT: 'existing-key-required' });

    await expectEveryFieldRequired(['userData.apiKeyCT'], (omitted) =>
      apiKeyOf(userData.id, projectionFieldsWithout(API_KEY_PROJECTION.fields, omitted)),
    );
  }, 300000);

  // --- the claim that makes this endpoint convertible at all --- //

  it('writing after a projected read leaves every column the query did not load untouched', async () => {
    // This is the whole reason a write endpoint can be converted: the update names its columns, so
    // it cannot blank the ones the projection left out. Saving the loaded row back would.
    const account = await seedAccount({ apiKeyCT: null });
    // Read at the storage level, so the comparison covers every column of the table rather than the
    // ones some load happens to materialise.
    const rowOf = async (): Promise<Record<string, unknown>> =>
      (await dataSource.query(`SELECT * FROM "${SCHEMA}"."user_data" WHERE id = $1`, [account.id]))[0];
    const before = await rowOf();

    // Through the production method rather than a write of the spec's own: a test that issues the
    // update itself proves the update is safe, not that the endpoint uses it.
    const answer = await createApiKey(account.id, { buy: true });

    const after = await rowOf();
    expect(after.apiKeyCT).toEqual(answer.key);
    expect(after.apiFilterCT).toEqual(ApiKeyService.getFilterCode({ buy: true }));
    // Every other column - including the ones the projection never selected - has to be what it
    // was. `updated` is excluded because the write is what moves it.
    const ignored = ['apiKeyCT', 'apiFilterCT', 'updated'];
    const comparable = (row: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(row).filter(([column]) => !ignored.includes(column)));

    expect(comparable(after)).toEqual(comparable(before));
    expect(Object.keys(before).length).toBeGreaterThan(50);
  }, 120000);

  it('runs the production key derivation over the projected row', async () => {
    // The levels above pin the key so that responses are comparable across runs. That leaves the
    // real derivation unexercised, and it is what reads the projected id and creation date.
    const account = await seedAccount({ apiKeyCT: null });

    const loaded = await userDataRepo.getForApiKey(account.id);
    loaded.apiKeyCT = ApiKeyService.createKey(loaded.id);

    expect(loaded.apiKeyCT).toMatch(/^[0-9A-F]+$/);
    expect(ApiKeyService.getSecret(loaded)).toMatch(/^[0-9A-F]{64}$/);
    // The same account and the same key must produce the same secret through an independently
    // loaded row: comparing the projected row with itself would hold whatever the projection left
    // out. The creation date is the second input, and it comes out of the projection.
    const full = await dataSource.getRepository(UserData).findOneBy({ id: account.id });
    full.apiKeyCT = loaded.apiKeyCT;

    expect(ApiKeyService.getSecret(loaded)).toEqual(ApiKeyService.getSecret(full));
  }, 120000);

  it('derives the secret from the creation date as well as the key', async () => {
    // Two accounts inserted in the same millisecond share a creation date, so the secret is not
    // unique per account by construction. What has to hold is that the date is an input at all — a
    // projection that dropped it would answer the same secret for every date.
    const account = await seedAccount({ apiKeyCT: null });

    const loaded = await userDataRepo.getForApiKey(account.id);
    loaded.apiKeyCT = 'SHARED-KEY';
    // Built from the two columns `getSecret` reads rather than spread from the row: a spread touches
    // every property, including ones this query had no reason to select.
    const withOtherDate = {
      apiKeyCT: loaded.apiKeyCT,
      created: new Date('2001-02-03T04:05:06.000Z'),
    } as typeof loaded;

    expect(ApiKeyService.getSecret(loaded)).not.toEqual(ApiKeyService.getSecret(withOtherDate));
  }, 120000);

  // --- the production path, end to end --- //

  /**
   * `UserDataService.createApiKey`, bound to the real repository.
   *
   * The service takes twenty-seven collaborators and this method uses exactly one of them, so it is
   * called on a minimal receiver rather than through a constructed service — what matters is that
   * the production method runs against the projected read and its own write.
   */
  const createApiKey = (userDataId: number, filter: HistoryFilter): Promise<ApiKeyDto> =>
    UserDataService.prototype.createApiKey.call({ userDataRepo }, userDataId, filter);

  it('issues a key through the service and persists both columns', async () => {
    const account = await seedAccount({ apiKeyCT: null, apiFilterCT: null });

    const answer = await createApiKey(account.id, { buy: true });

    const stored = await dataSource.getRepository(UserData).findOneBy({ id: account.id });
    expect(stored.apiKeyCT).toEqual(answer.key);
    expect(stored.apiFilterCT).toEqual(ApiKeyService.getFilterCode({ buy: true }));
    // The secret is derived rather than stored, from the key and the creation date the projection
    // supplies.
    expect(answer.secret).toEqual(ApiKeyService.getSecret(stored));
  }, 120000);

  it('refuses a second key through the service, and writes nothing', async () => {
    const account = await seedAccount({ apiKeyCT: 'already-issued' });

    await expect(createApiKey(account.id, { buy: true })).rejects.toThrow('API key already exists');

    const stored = await dataSource.getRepository(UserData).findOneBy({ id: account.id });
    expect(stored.apiKeyCT).toEqual('already-issued');
  }, 120000);

  // --- LEVEL 4: consistency against a second source --- //

  it('level 4 — the projected answer equals the one from a full load', async () => {
    const userData = await seedAccount({ apiKeyCT: null });

    const projected = await userDataRepo.getForApiKey(userData.id);
    // The unprojected load is the second source: every column of the row.
    const full = await dataSource.getRepository(UserData).findOneBy({ id: userData.id });

    // Same key on both rows, so what has to agree is the secret derived from it — which is where
    // the creation date enters, and the only value the projection can get wrong here.
    const key = ApiKeyService.createKey(full.id);
    projected.apiKeyCT = key;
    full.apiKeyCT = key;

    expect(ApiKeyService.getSecret(projected)).toEqual(ApiKeyService.getSecret(full));
    expect(projected.id).toEqual(full.id);
  }, 120000);
});
