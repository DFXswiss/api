import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { walkWhereTreeIteratively, DebugQueryMaxWhereDepth, DebugQueryMaxWhereNodes } from '../dto/debug-query.dto';

// Preflight pipe for `POST /gs/debug`. Runs BEFORE the global `ValidationPipe`'s
// `plainToInstance` step (which is recursive — `@Type(() => DebugWhereNode)` walks the WHERE
// tree, and a malicious `not → child → not → …` chain of any depth would stack-overflow it
// AND then crash the audit serializer's `JSON.stringify`).
//
// The pipe inspects the raw plain-object body, walks the WHERE tree iteratively, and rejects
// anything exceeding the depth or total node caps. By the time the structured DTO and the
// service see the request, the tree is small enough that the rest of the pipeline can
// recurse safely.
@Injectable()
export class DebugQueryTreeSizePipe implements PipeTransform {
  transform(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const where = (value as Record<string, unknown>).where;
    if (where === undefined || where === null) return value;
    const { depth, nodes } = walkWhereTreeIteratively(where);
    if (depth > DebugQueryMaxWhereDepth || nodes > DebugQueryMaxWhereNodes) {
      throw new BadRequestException(
        `WHERE tree exceeds caps (max depth ${DebugQueryMaxWhereDepth}, ` + `max ${DebugQueryMaxWhereNodes} nodes)`,
      );
    }
    return value;
  }
}
