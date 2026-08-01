import { ConfigService } from 'src/config/config';
import { ApiKeyService } from 'src/shared/services/api-key.service';
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
 * The endpoint read a whole `UserData` row — 253 columns across eight eager joins — to check
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
   */
  async function apiKeyOf(id: number, fields = API_KEY_PROJECTION.fields) {
    const userData = await userDataRepo.getForApiKey(id, fields);
    if (userData.apiKeyCT) return { conflict: true as const };

    userData.apiKeyCT = ApiKeyService.createKey(userData.id);

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

  it('level 3 — the creation date is required to derive the secret', async () => {
    const userData = await seedAccount({ apiKeyCT: null });

    await expectEveryFieldRequired(['userData.created'], (omitted) =>
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

  // --- LEVEL 4: consistency against a second source --- //

  it('level 4 — the projected answer equals the one from a full load', async () => {
    const userData = await seedAccount({ apiKeyCT: null });

    const projected = await userDataRepo.getForApiKey(userData.id);
    // The unprojected load is the second source: every column of the row, which is what the
    // endpoint fetched before.
    const full = await dataSource.getRepository(UserData).findOneBy({ id: userData.id });

    // The key itself is random, so the two rows are given the same one; what has to agree is the
    // secret derived from it, which is where the creation date enters.
    const key = ApiKeyService.createKey(full.id);
    projected.apiKeyCT = key;
    full.apiKeyCT = key;

    expect(ApiKeyService.getSecret(projected)).toEqual(ApiKeyService.getSecret(full));
  }, 120000);
});
