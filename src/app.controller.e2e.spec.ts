import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService, GetConfig } from 'src/config/config';
import { AppController } from './app.controller';
import { SettingService } from './shared/models/setting/setting.service';
import { RefService } from './subdomains/core/referral/process/ref.service';

// E2E-style coverage for `GET /v1/app/:app/:code` through the **actual NestJS routing
// pipeline** (URI versioning → route matching → param binding → handler). A direct unit
// call of the controller method cannot prove that two path segments are matched and
// bound correctly, nor that `app/settings/flags` still wins over `app/:app/:code`.
//
// No `Config` jest.mock: AppController reads the live `Config` export in `getRef`. That
// binding is assigned when `ConfigService` is constructed — provide it so the real
// `formats.ref` from `GetConfig()` is used (no hand-copied regex that can drift).

describe('AppController e2e (referral path code)', () => {
  let app: INestApplication;
  let addOrUpdate: jest.Mock;
  let getObj: jest.Mock;

  beforeAll(async () => {
    addOrUpdate = jest.fn().mockResolvedValue(undefined);
    getObj = jest.fn().mockImplementation(async (key: string, fallback?: unknown) => {
      if (key === 'ref-keys') return {};
      if (key === 'flags') return [];
      return fallback;
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        ConfigService,
        { provide: RefService, useValue: { addOrUpdate } },
        { provide: SettingService, useValue: { getObj } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Match production `main.ts` URI versioning so requests hit `/v1/...` like the live API.
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: [GetConfig().defaultVersion] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches path code to the same redirect as the query form and stores the same ref', async () => {
    const queryRes = await request(app.getHttpServer()).get('/v1/app/services?code=170-097');
    const queryCall = addOrUpdate.mock.calls[0];

    addOrUpdate.mockClear();

    const pathRes = await request(app.getHttpServer()).get('/v1/app/services/170-097');
    const pathCall = addOrUpdate.mock.calls[0];

    expect(pathRes.status).toBe(queryRes.status);
    expect(pathRes.headers.location).toBe(queryRes.headers.location);
    expect(queryRes.status).toBe(303);
    expect(queryRes.headers.location).toBe('https://app.dfx.swiss/');

    expect(queryCall).toEqual([expect.any(String), '170-097', undefined]);
    expect(pathCall).toEqual(queryCall);
  });

  it('prefers path code over a conflicting ?code= query', async () => {
    await request(app.getHttpServer()).get('/v1/app/services/170-097?code=999-999').expect(303);

    expect(addOrUpdate).toHaveBeenCalledTimes(1);
    expect(addOrUpdate).toHaveBeenCalledWith(expect.any(String), '170-097', undefined);
    expect(addOrUpdate).not.toHaveBeenCalledWith(expect.any(String), '999-999', expect.anything());
  });

  it('forwards ?orig= on the path-code route to addOrUpdate', async () => {
    await request(app.getHttpServer()).get('/v1/app/services/170-097?orig=partnerX').expect(303);

    expect(addOrUpdate).toHaveBeenCalledTimes(1);
    expect(addOrUpdate).toHaveBeenCalledWith(expect.any(String), '170-097', 'partnerX');
  });

  it('keeps GET /v1/app/settings/flags on the flags handler (not app/:app/:code)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/app/settings/flags');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(addOrUpdate).not.toHaveBeenCalled();
    expect(getObj).toHaveBeenCalledWith('flags', []);
    expect(getObj).not.toHaveBeenCalledWith('ref-keys', {});
  });
});
