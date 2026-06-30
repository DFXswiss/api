import {
  Body,
  Controller,
  INestApplication,
  MiddlewareConsumer,
  Module,
  Post,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bodyParser from 'body-parser';
import request from 'supertest';
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
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(DebugQueryTreeSizeMiddleware).forRoutes({ path: 'gs/debug', method: RequestMethod.POST });
  }
}

describe('GsController e2e (NestJS pipeline)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GsControllerTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Match the production setup so the test is faithful to what runs in `main.ts`:
    // 20 MB JSON body parser + global ValidationPipe with `whitelist: true`. The
    // versioning prefix is intentionally NOT applied — the test posts to `/gs/debug`
    // directly so the URL stays decoupled from API versioning concerns.
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
      .post('/gs/debug')
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
      .post('/gs/debug')
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
      .post('/gs/debug')
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
      .post('/gs/debug')
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
      .post('/gs/debug')
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
