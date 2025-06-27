import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtUserActiveGuard } from '../../../../shared/auth/jwt-user-active.guard';
import { CreatePaymentAccessLevel } from '../enums';
import { PaymentLinkService } from '../services/payment-link.service';

@Injectable()
export class CreatePaymentAccessLevelGuard implements CanActivate {
  constructor(private readonly paymentLinkService: PaymentLinkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = request.query['key'];

    if (key) {
      request.accessLevel = CreatePaymentAccessLevel.ACCESS_KEY;
      return true;
    }

    const isUserActive = await JwtUserActiveGuard().canActivate(context);
    if (isUserActive) {
      request.accessLevel = CreatePaymentAccessLevel.USER;
      return true;
    }

    const isPublicAccess = await this.validatePublicAccess(context);
    if (isPublicAccess) {
      request.accessLevel = CreatePaymentAccessLevel.PUBLIC;
      return true;
    }

    return false;
  }

  private async validatePublicAccess(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { route, externalLinkId } = request.query;

    if (!route || !externalLinkId) return false;
    return this.paymentLinkService.isPaymentLinkPublicAccess(route as string, externalLinkId as string);
  }
}
