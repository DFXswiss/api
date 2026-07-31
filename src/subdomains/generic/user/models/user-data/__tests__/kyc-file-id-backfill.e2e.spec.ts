import { Controller, INestApplication, Post, Query, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GetConfig } from 'src/config/config';
import { isDryRun, KycFileIdBackfillQuery } from '../dto/kyc-file-id-backfill.dto';

// `dryRun` decides whether this endpoint writes to a compliance table, and there is no undo. The
// previous implementation failed *open*: a `@Transform` mapped every value except the exact string
// `'true'` to `false`, and `@IsBoolean` then validated the post-transform boolean, so `?dryRun=TRUE`
// or a bare `?dryRun` silently started a live write and nothing was ever rejected.
//
// Driven through the real global `ValidationPipe` rather than the handler in isolation, because the
// transform/validate ordering is exactly where that bug lived — a handler-level unit test calling
// the method directly would have passed against the broken version.
// Calls the same `isDryRun` the production controller does, not a copy of the expression. The
// guards on the real controller are factory-returned instances that `overrideGuard()` cannot
// cleanly stub (see gs.controller.e2e.spec.ts), so the route is re-declared here; the decision
// under test is not.
@Controller('userData')
class TestController {
  @Post('backfillKycFileIds')
  backfill(@Query() query: KycFileIdBackfillQuery): { dryRun: boolean } {
    return { dryRun: isDryRun(query) };
  }
}

describe('KycFileIdBackfill dryRun parsing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [TestController] }).compile();

    app = moduleRef.createNestApplication();
    // Matches main.ts: URI versioning plus the global pipe. Versioning is included because the
    // reference harness documents it as load-bearing for how NestJS builds route paths.
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: [GetConfig().defaultVersion] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (query: string) =>
    request(app.getHttpServer()).post(`/v${GetConfig().defaultVersion}/userData/backfillKycFileIds${query}`);

  it('dry-runs when the parameter is omitted', async () => {
    await post('').expect(201).expect({ dryRun: true });
  });

  it('dry-runs on an explicit true', async () => {
    await post('?dryRun=true').expect(201).expect({ dryRun: true });
  });

  it('writes only on an exact false', async () => {
    await post('?dryRun=false').expect(201).expect({ dryRun: false });
  });

  // Each of these previously fell through to a live write.
  it.each(['?dryRun=TRUE', '?dryRun=False', '?dryRun=1', '?dryRun=0', '?dryRun=', '?dryRun=nonsense'])(
    'rejects %s rather than falling through to a write',
    async (query) => {
      await post(query).expect(400);
    },
  );
});
