import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { DebugQueryMaxWhereDepth, DebugQueryMaxWhereNodes, walkWhereTreeIteratively } from '../dto/debug-query.dto';

// NestJS execution order (verified against @nestjs/core/router/router-execution-context:147
// `pipes.concat(paramPipes)`): middleware → guards → interceptors → pipes (global → controller
// → route → param). The global `ValidationPipe` recurses through the WHERE tree via
// class-transformer's `@Type(() => DebugWhereNode)`, so a malicious linear
// `not → child → not → …` chain stack-overflows it before any pipe-level guard can run. A
// previous attempt that registered the cap as a `@Body(...)` parameter pipe DID NOT WORK in
// production for this reason — the parameter pipe runs after the global pipe.
//
// Middleware is the right hook: it sees `req.body` (already JSON-parsed by Express
// `body-parser`, which is iterative in V8) before any NestJS layer runs. Walk the tree
// iteratively here and short-circuit with a clean 400; everything downstream then operates
// on a body small enough to recurse safely.
@Injectable()
export class DebugQueryTreeSizeMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const where = (req.body as Record<string, unknown> | undefined)?.where;
    if (where !== undefined && where !== null) {
      const { depth, nodes } = walkWhereTreeIteratively(where);
      if (depth > DebugQueryMaxWhereDepth || nodes > DebugQueryMaxWhereNodes) {
        throw new BadRequestException(
          `WHERE tree exceeds caps (max depth ${DebugQueryMaxWhereDepth}, max ${DebugQueryMaxWhereNodes} nodes)`,
        );
      }
    }
    next();
  }
}
