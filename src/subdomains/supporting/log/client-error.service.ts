import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

// Query parameters that carry credentials or personal data. The frontend puts these in the
// URL, so they can reach us inside a route, a message or a stack frame.
const SENSITIVE_PARAMS = ['session', 'signature', 'address', 'mail', 'token', 'key', 'otp', 'code'];

const SENSITIVE_PARAM_REGEX = new RegExp(`([?&](?:${SENSITIVE_PARAMS.join('|')})=)[^&\\s#]*`, 'gi');

@Injectable()
export class ClientErrorService {
  private readonly logger = new DfxLogger(ClientErrorService);

  logError(dto: CreateClientErrorDto, client?: string, userAgent?: string): void {
    const { message, type, stack, route, version } = dto;

    const context = [
      `client=${ClientErrorService.sanitize(client) ?? 'unknown'}`,
      `route=${ClientErrorService.sanitize(ClientErrorService.toPath(route)) ?? 'unknown'}`,
      `version=${ClientErrorService.sanitize(version) ?? 'unknown'}`,
      `userAgent=${ClientErrorService.sanitize(userAgent) ?? 'unknown'}`,
    ].join(' ');

    const description = [type, message].filter((p) => p).join(': ');
    const trace = stack ? ` stack=${ClientErrorService.sanitize(stack)}` : '';

    this.logger.error(`Client error: ${ClientErrorService.sanitize(description)} ${context}${trace}`);
  }

  // --- HELPER METHODS --- //

  // A route is only ever logged as its path: the query string carries the session and the
  // signature the frontend authenticates with.
  private static toPath(route?: string): string | undefined {
    return route?.split(/[?#]/)[0];
  }

  // This endpoint is unauthenticated, so every field is attacker-controlled. Redacting the
  // sensitive parameters keeps credentials out of the log; collapsing the line breaks keeps a
  // forged payload from impersonating further log lines.
  private static sanitize(value?: string): string | undefined {
    return value?.replace(SENSITIVE_PARAM_REGEX, '$1<redacted>').replace(/\s*[\r\n]+\s*/g, ' | ');
  }
}
