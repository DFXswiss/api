import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ScorechainService } from '../services/scorechain.service';

// Authenticates the TMS ScenarioAlertCallback the same way API responses are verified:
// an X-Signature over the (raw) body + X-Server-Time, using Scorechain's public key.
// The raw body is provided by the `raw(...)` route registered in main.ts. Fail-closed.
@Injectable()
export class ScorechainWebhookGuard implements CanActivate {
  constructor(private readonly scorechainService: ScorechainService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const rawBody = Buffer.isBuffer(request.body) ? request.body.toString() : JSON.stringify(request.body);

    return this.scorechainService.isValidSignature(
      rawBody,
      request.headers['x-signature'],
      request.headers['x-server-time'],
    );
  }
}
