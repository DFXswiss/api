import { createMock, DeepMocked } from '@golevelup/ts-jest';
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  INestApplication,
  MiddlewareConsumer,
  Module,
  Post,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as bodyParser from 'body-parser';
import request from 'supertest';
import { GetConfig } from 'src/config/config';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import * as processServiceModule from 'src/shared/services/process.service';
import { DbQueryDto, DbReturnData } from 'src/subdomains/generic/gs/dto/db-query.dto';
import { GsTriggerType } from 'src/subdomains/generic/gs/dto/gs-trigger-type.enum';
import { GsController } from 'src/subdomains/generic/gs/gs.controller';
import { GsService } from 'src/subdomains/generic/gs/gs.service';
import { DebugQueryDto, DebugQueryResult } from '../dto/debug-query.dto';
import { DebugQueryTreeSizeMiddleware } from '../middleware/debug-query-tree-size.middleware';

// E2E-style coverage for the `POST /gs/debug` request pipeline exercised through the
// **actual NestJS pipeline**: Express body parser → middleware → global ValidationPipe →
// controller → handler.
//
// The previous attempt at this used unit-level tests that called the (then-) preflight
// `pipe.transform()` directly. That was insufficient — the production wiring registered
// the preflight as a parameter-level pipe (`@Body(Pipe) dto: DebugQueryDto`), which
// NestJS runs AFTER the global ValidationPipe
// (`@nestjs/core/router/router-execution-context.js:147` does `pipes.concat(paramPipes)`).
// On a malicious linear `not → child → not → …` body, class-transformer's `plainToInstance`
// in the global pipe recursed through `@Type(() => DebugWhereNode)` and stack-overflowed
// before the preflight ran, turning the request into an uncaught 500 and dropping the
// audit line. The middleware version is wired in `GsModule.configure` so it runs BEFORE
// pipes; this file fires the same pathological body via supertest to pin that order.
//
// The test does NOT bootstrap the production `GsController` (whose guards are factory-
// returned instances that NestJS' `overrideGuard()` can't cleanly stub). The pipeline-
// ordering question is independent of the guards, so the test uses a stripped-down
// controller declared inline below. The middleware is wired by route path
// (`gs/debug`), identical to the production `GsModule.configure` binding.

// Tracks the DTO the handler receives so success-path tests can confirm the body that
// passed the middleware + ValidationPipe matches what the handler observed. Module-scope
// because the test controller is decorated and reads `lastDto` directly.
const handlerState: { lastDto: unknown } = { lastDto: undefined };

@Controller('gs')
class GsDebugTestController {
  @Post('debug')
  async executeDebugQuery(@Body() dto: DebugQueryDto): Promise<DebugQueryResult> {
    handlerState.lastDto = dto;
    return { keys: ['id'], rows: [[1]] };
  }
}

@Module({
  controllers: [GsDebugTestController],
})
class GsControllerTestModule {
  // Mirrors the production binding in `GsModule.configure` — including the use of
  // `GetConfig().defaultVersion` for the route version. If those two diverge, the test
  // and the prod binding can drift; reading both from the same source keeps them in sync.
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(DebugQueryTreeSizeMiddleware)
      .forRoutes({ path: 'gs/debug', method: RequestMethod.POST, version: GetConfig().defaultVersion });
  }
}

// Test-only route that isolates the `DbQueryDto` / ValidationPipe surface from controller
// behavior. It proves the real DTO decorators (`@IsEnum(GsTriggerType)`, `@MaxLength(256)` on
// `table`/`identifier`, control-character rejection, etc.) are wired into the global pipe and
// deliberately leaves trigger enforcement to the real-controller HTTP suite below.
@Controller('gs')
class GsDbQueryDtoTestController {
  @Post('db')
  async getDbData(@Body() _query: DbQueryDto): Promise<DbReturnData> {
    return { keys: ['id'], values: [] };
  }
}

@Module({
  controllers: [GsDbQueryDtoTestController],
})
class GsDbQueryDtoTestModule {}

describe('GsController e2e (NestJS pipeline)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GsControllerTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Match the production `main.ts` setup faithfully: URI versioning, 20 MB JSON body
    // parser, global ValidationPipe with `whitelist: true`. Versioning matters — NestJS
    // prepends the version segment to middleware paths only when `version` is set on the
    // route info; getting that wrong is the bug this file caught the first time around.
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: [GetConfig().defaultVersion] });
    app.use(bodyParser.json({ limit: '20mb' }));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transformOptions: { exposeUnsetFields: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handlerState.lastDto = undefined;
  });

  it('accepts a minimal valid query and reaches the handler', async () => {
    await request(app.getHttpServer())
      .post('/v1/gs/debug')
      .send({
        table: 'asset',
        select: [{ kind: 'column', column: 'id' }],
        limit: 1,
      })
      .expect(201)
      .expect((res: request.Response) => {
        expect(res.body).toEqual({ keys: ['id'], rows: [[1]] });
      });

    expect(handlerState.lastDto).toMatchObject({ table: 'asset', limit: 1 });
  });

  it('rejects a malformed DTO (limit out of range) via the global ValidationPipe', async () => {
    await request(app.getHttpServer())
      .post('/v1/gs/debug')
      .send({
        table: 'asset',
        select: [{ kind: 'column', column: 'id' }],
        limit: 0, // @Min(1) violation
      })
      .expect(400);

    expect(handlerState.lastDto).toBeUndefined();
  });

  it('rejects a 10000-deep NOT chain BEFORE the global ValidationPipe can stack-overflow on it', async () => {
    // Build the body as a JSON string so we sidestep `JSON.stringify`'s own recursion (V8
    // recurses on stringify but parses iteratively, so a stringified chain reaches the
    // server intact). This is the exact attack shape that hit a `RangeError: Maximum call
    // stack size exceeded` 500 on dev when the preflight was registered as a parameter
    // pipe; with middleware wiring it returns a clean 400.
    let s = '{"kind":"leaf","column":"id","op":"=","value":1}';
    for (let i = 0; i < 10000; i++) s = '{"kind":"not","child":' + s + '}';
    const body = '{"table":"asset","select":[{"kind":"column","column":"id"}],"where":' + s + ',"limit":1}';

    await request(app.getHttpServer())
      .post('/v1/gs/debug')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(400)
      .expect((res: request.Response) => {
        expect(res.body.message).toMatch(/WHERE tree exceeds caps/);
      });

    expect(handlerState.lastDto).toBeUndefined();
  });

  it('rejects a tree over the node-count cap (200 nodes)', async () => {
    // 5-level wide-and-deep tree: 1 + 5 + 25 + 125 + 625 + 3125 = 3906 nodes; well above 200.
    const wide = (n: number) => ({
      kind: 'and',
      children: Array.from({ length: n }, (_, i) => ({ kind: 'leaf', column: 'id', op: '=', value: i })),
    });
    let tree: unknown = wide(5);
    for (let d = 0; d < 4; d++) tree = { kind: 'and', children: Array.from({ length: 5 }, () => tree) };

    await request(app.getHttpServer())
      .post('/v1/gs/debug')
      .send({
        table: 'asset',
        select: [{ kind: 'column', column: 'id' }],
        where: tree,
        limit: 1,
      })
      .expect(400)
      .expect((res: request.Response) => {
        expect(res.body.message).toMatch(/WHERE tree exceeds caps/);
      });

    expect(handlerState.lastDto).toBeUndefined();
  });

  it('lets a small benign tree through to the handler', async () => {
    await request(app.getHttpServer())
      .post('/v1/gs/debug')
      .send({
        table: 'asset',
        select: [{ kind: 'column', column: 'id' }],
        where: {
          kind: 'and',
          children: [
            { kind: 'leaf', column: 'id', op: '=', value: 1 },
            { kind: 'leaf', column: 'id', op: '=', value: 2 },
          ],
        },
        limit: 1,
      })
      .expect(201);

    expect((handlerState.lastDto as { where: unknown }).where).toBeDefined();
  });
});

describe('GsController e2e (db query DTO validation)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GsDbQueryDtoTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: [GetConfig().defaultVersion] });
    app.use(bodyParser.json({ limit: '20mb' }));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transformOptions: { exposeUnsetFields: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an invalid trigger value via the global ValidationPipe', async () => {
    await request(app.getHttpServer()).post('/v1/gs/db').send({ table: 'asset', trigger: 'Cron' }).expect(400);
  });

  it('accepts trigger=Manual', async () => {
    await request(app.getHttpServer())
      .post('/v1/gs/db')
      .send({ table: 'asset', trigger: GsTriggerType.MANUAL })
      .expect(201);
  });

  it('accepts a request without trigger — the ValidationPipe alone does not enforce it', async () => {
    await request(app.getHttpServer()).post('/v1/gs/db').send({ table: 'asset' }).expect(201);
  });

  it('rejects an identifier over the 256-char limit via the global ValidationPipe', async () => {
    await request(app.getHttpServer())
      .post('/v1/gs/db')
      .send({ table: 'asset', identifier: 'a'.repeat(257) })
      .expect(400);
  });

  it('rejects a table name over the 256-char limit via the global ValidationPipe', async () => {
    await request(app.getHttpServer())
      .post('/v1/gs/db')
      .send({ table: 'a'.repeat(257) })
      .expect(400);
  });

  it('rejects a table name with an embedded control character via the global ValidationPipe', async () => {
    await request(app.getHttpServer()).post('/v1/gs/db').send({ table: 'user\ndata' }).expect(400);
  });

  it('rejects an identifier with an embedded control character via the global ValidationPipe', async () => {
    await request(app.getHttpServer()).post('/v1/gs/db').send({ table: 'asset', identifier: 'x\nforged' }).expect(400);
  });

  it('accepts a valid identifier with hyphen and underscore via the global ValidationPipe', async () => {
    await request(app.getHttpServer())
      .post('/v1/gs/db')
      .send({ table: 'asset', identifier: 'valid-identifier_123' })
      .expect(201);
  });
});

describe('GsController e2e (missing trigger enforcement)', () => {
  let app: INestApplication;
  let service: DeepMocked<GsService>;
  let verboseSpy: jest.SpyInstance;

  const jwt: JwtPayload = { role: UserRole.ADMIN, ip: '1.2.3.4' };
  const allowAdminGuard: CanActivate = {
    canActivate(context: ExecutionContext): boolean {
      context.switchToHttp().getRequest<{ user?: JwtPayload }>().user = jwt;
      return true;
    },
  };

  beforeAll(async () => {
    service = createMock<GsService>();
    verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation();
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    const builder = Test.createTestingModule({
      controllers: [GsController],
      providers: [{ provide: GsService, useValue: service }],
    });
    const handlers = [GsController.prototype.getDbData, GsController.prototype.getExtendedData];
    const guards = handlers.flatMap((handler) => Reflect.getMetadata(GUARDS_METADATA, handler) as CanActivate[]);

    for (const guard of guards) {
      if (typeof guard === 'function') {
        builder.overrideGuard(guard).useValue(allowAdminGuard);
      } else {
        jest.spyOn(guard, 'canActivate').mockImplementation(allowAdminGuard.canActivate.bind(allowAdminGuard));
      }
    }

    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: [GetConfig().defaultVersion] });
    app.use(bodyParser.json({ limit: '20mb' }));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transformOptions: { exposeUnsetFields: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      jest.restoreAllMocks();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['/v1/gs/db', '/v1/gs/db/custom'])(
    'rejects a missing trigger on %s before calling either GS service',
    async (path) => {
      const response = await request(app.getHttpServer()).post(path).send({ table: 'asset' }).expect(400);

      expect(response.body.message).toBe('Trigger type is required');
      expect(verboseSpy).toHaveBeenCalledTimes(1);
      expect(verboseSpy).toHaveBeenCalledWith(
        'GS db call: table=asset, identifier=missing, trigger=missing, role=Admin',
      );
      expect(service.getDbData).not.toHaveBeenCalled();
      expect(service.getExtendedDbData).not.toHaveBeenCalled();
    },
  );

  it('routes a valid /gs/db request to getDbData only', async () => {
    const result: DbReturnData = { keys: ['standard'], values: [{ id: 1 }] };
    service.getDbData.mockResolvedValue(result);

    const response = await request(app.getHttpServer())
      .post('/v1/gs/db')
      .send({ table: 'asset', trigger: GsTriggerType.MANUAL })
      .expect(201);

    expect(response.body).toEqual(result);
    expect(service.getDbData).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'asset', trigger: GsTriggerType.MANUAL }),
      UserRole.ADMIN,
    );
    expect(service.getExtendedDbData).not.toHaveBeenCalled();
  });

  it('routes a valid /gs/db/custom request to getExtendedDbData only', async () => {
    const result: DbReturnData = { keys: ['custom'], values: [{ id: 2 }] };
    service.getExtendedDbData.mockResolvedValue(result);

    const response = await request(app.getHttpServer())
      .post('/v1/gs/db/custom')
      .send({ table: 'asset', trigger: GsTriggerType.AUTO })
      .expect(201);

    expect(response.body).toEqual(result);
    expect(service.getExtendedDbData).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'asset', trigger: GsTriggerType.AUTO }),
      UserRole.ADMIN,
    );
    expect(service.getDbData).not.toHaveBeenCalled();
  });
});
