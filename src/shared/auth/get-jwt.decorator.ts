import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';

export const GetJwt = createParamDecorator(
  (_data, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
