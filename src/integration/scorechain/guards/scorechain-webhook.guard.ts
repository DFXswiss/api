import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ScorechainService } from '../services/scorechain.service';

// Authenticates the TMS ScenarioAlertCallback the same way API responses are verified:
// an X-Signature (proof of authenticity) over the request body + X-Server-Time. Fail-closed.
@Injectable()
export class ScorechainWebhookGuard implements CanActivate {
  constructor(private readonly scorechainService: ScorechainService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    return this.scorechainService.isValidSignature(
      request.body,
      request.headers['x-signature'],
      request.headers['x-server-time'],
    );
  }
}
