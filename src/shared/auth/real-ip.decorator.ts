import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const RealIP = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  return req.realIp ?? req.socket?.remoteAddress ?? 'unknown';
});
