import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DebugQueryMaxWhereDepth, DebugQueryMaxWhereNodes, walkWhereTreeIteratively } from '../dto/debug-query.dto';

// Preflight guard for `POST /gs/debug`. In the NestJS request lifecycle guards run BEFORE pipes
// (middleware → guards → interceptors → pipes), so this inspects the raw, parsed-but-not-yet-
// transformed body before the global `ValidationPipe`'s `plainToInstance` step. That step is
// recursive (`@Type(() => DebugWhereNode)` walks the WHERE tree), so a malicious
// `not → child → not → …` chain of any depth would stack-overflow it — and the audit
// serializer's `JSON.stringify` — before the DTO validator or the service walker ever run.
//
// The guard walks the WHERE tree iteratively (recursion here would defeat the point) and rejects
// anything exceeding the depth or node caps. The DTO-level `@MaxWhereTreeSize` validator and the
// service walker re-check the same caps as defense in depth, but only this guard runs early
// enough to prevent the overflow.
@Injectable()
export class DebugWhereTreeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const body = context.switchToHttp().getRequest().body;
    if (!body || typeof body !== 'object') return true;

    const where = (body as Record<string, unknown>).where;
    if (where == null) return true;

    const { depth, nodes } = walkWhereTreeIteratively(where);
    if (depth > DebugQueryMaxWhereDepth || nodes > DebugQueryMaxWhereNodes) {
      throw new BadRequestException(
        `WHERE tree exceeds caps (max depth ${DebugQueryMaxWhereDepth}, max ${DebugQueryMaxWhereNodes} nodes)`,
      );
    }

    return true;
  }
}
