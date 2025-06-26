import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CreatePaymentAccessLevel } from '../enums';

export const GetCreatePaymentLinkAccessLevel = createParamDecorator(
  (_data, ctx: ExecutionContext): CreatePaymentAccessLevel => {
    const req = ctx.switchToHttp().getRequest();
    return req.accessLevel;
  },
);
