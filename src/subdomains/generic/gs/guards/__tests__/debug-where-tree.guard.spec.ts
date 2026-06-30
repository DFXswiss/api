import { Body, Controller, INestApplication, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import request from 'supertest';
import { DebugQueryDto } from '../../dto/debug-query.dto';
import { GsController } from '../../gs.controller';
import { DebugWhereTreeGuard } from '../debug-where-tree.guard';

// Probe controllers: the real DebugWhereTreeGuard in front of the real DebugQueryDto, behind the
// real global ValidationPipe — the exact pipeline that matters, minus the (ordering-irrelevant)
// auth stack. This proves the guard runs BEFORE the ValidationPipe's recursive plainToInstance,
// which is the whole point of the fix and cannot be shown by unit-testing the guard in isolation.
@Controller('probe')
class GuardOrderProbeController {
  @Post('with-guard')
  @UseGuards(DebugWhereTreeGuard)
  withGuard(@Body() _dto: DebugQueryDto): { ok: true } {
    return { ok: true };
  }

  // Same DTO + global ValidationPipe, but no guard — the negative control.
  @Post('without-guard')
  withoutGuard(@Body() _dto: DebugQueryDto): { ok: true } {
    return { ok: true };
  }
}

// Build the JSON wire payload by string concatenation so the deep tree never passes through the
// test client's own (recursive) JSON.stringify — only the server should attempt to walk it.
function deepNotChainPayload(depth: number): string {
  const open = '{"kind":"not","child":'.repeat(depth);
  const leaf = '{"kind":"leaf","column":"id","op":"=","value":1}';
  const close = '}'.repeat(depth);
  return `{"table":"asset","select":[{"kind":"column","column":"id"}],"where":${open}${leaf}${close},"limit":10}`;
}

// Deep enough that plainToInstance's recursion overflows V8's default stack (~11k frames) with
// margin, but small enough to stay well under the body-size limit.
const OVERFLOW_DEPTH = 4000;

describe('DebugWhereTreeGuard - ordering (runs before the ValidationPipe)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [GuardOrderProbeController] }).compile();
    // logger: false silences the expected RangeError stack trace from the negative-control test.
    app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    app.use(json({ limit: '5mb' })); // mirror main.ts and leave headroom for the deep payload
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a deep WHERE tree with a clean 400 before plainToInstance can recurse', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/with-guard')
      .set('Content-Type', 'application/json')
      .send(deepNotChainPayload(OVERFLOW_DEPTH));

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/WHERE tree exceeds caps/);
  });

  it('negative control: without the guard the same tree overflows the ValidationPipe (500)', async () => {
    // plainToInstance recurses through `@Type(() => DebugWhereNode)` before any class-validator
    // constraint runs, so a deep chain stack-overflows into a 500 — exactly the failure the guard
    // prevents by running one phase earlier. If this ever stops being a 500, the premise is gone.
    const res = await request(app.getHttpServer())
      .post('/probe/without-guard')
      .set('Content-Type', 'application/json')
      .send(deepNotChainPayload(OVERFLOW_DEPTH));

    expect(res.status).toBe(500);
  });

  it('lets a valid in-cap query through the guard and the ValidationPipe', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/with-guard')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'and', children: [{ kind: 'leaf', column: 'id', op: '=', value: 1 }] },
          limit: 10,
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('DebugWhereTreeGuard - wiring (real controller keeps the guard)', () => {
  it('GsController.executeDebugQuery registers the guard (regression guard against reverting to a param pipe)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, GsController.prototype.executeDebugQuery) ?? [];
    expect(guards).toContain(DebugWhereTreeGuard);
  });
});
