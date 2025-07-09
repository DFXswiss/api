import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtOrPaymentLinkKeyGuard } from './jwt-or-payment-link-key.guard';

@Injectable()
export class OptionalJwtOrPaymentLinkKeyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await new JwtOrPaymentLinkKeyGuard().canActivate(context);
    return true;
  }
}
