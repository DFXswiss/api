import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

// Parameter names that carry credentials or personal data. Matched as a substring of the name, so
// compound spellings (accessToken, walletAddress, refreshToken) are covered too — an exact-name
// list silently stops protecting the moment the frontend renames a parameter.
const SENSITIVE_NAMES = 'session|signature|address|mail|token|key|secret|otp|code|auth|jwt';

// Deliberately not anchored on a leading ? or &: message and stack are free text, not URLs, so a
// sensitive assignment can sit at the start of the string, behind a #, behind a ; or inside a
// percent-encoded URL. Over-redacting a harmless value is the cheaper mistake here.
const SENSITIVE_ASSIGNMENT_REGEX = new RegExp(
  `\\b([\\w-]*(?:${SENSITIVE_NAMES})[\\w-]*)\\s*(=|%3D)\\s*[^\\s&#;]*`,
  'gi',
);

// JSON string escaping covers everything below U+0020, where the ordinary line breaks and the
// ANSI escape live. These sit above it, survive the escaping, and still break a line or move a
// cursor in terminals and log viewers.
const EXOTIC_LINE_BREAKS = /[\u0085\u007f\u2028\u2029]/g;

// Budget for one process and one minute. The endpoint is unauthenticated, and per-IP throttling
// only bounds a single client: without a ceiling across all of them, a distributed flood would
// bury genuine incidents in the same ERROR stream that alerting reads.
const LOG_BUDGET_PER_MINUTE = 120;
const BUDGET_WINDOW = 60000;

@Injectable()
export class ClientErrorService {
  private readonly logger = new DfxLogger(ClientErrorService);

  private windowStart = 0;
  private windowCount = 0;
  private suppressedCount = 0;

  logError(dto: CreateClientErrorDto, client?: string, userAgent?: string): void {
    const { message, type, stack, route, version } = dto;

    // Context first, free text last and quoted: message, type and stack are attacker-controlled
    // and would otherwise be indistinguishable from the key=value context a log query parses.
    const fields = [
      `client=${ClientErrorService.quote(client)}`,
      `route=${ClientErrorService.quote(ClientErrorService.toPath(route))}`,
      `version=${ClientErrorService.quote(version)}`,
      `userAgent=${ClientErrorService.quote(userAgent)}`,
      `type=${ClientErrorService.quote(type)}`,
      `message=${ClientErrorService.quote(message)}`,
    ];
    if (stack) fields.push(`stack=${ClientErrorService.quote(stack)}`);

    if (this.isWithinBudget()) this.logger.error(`Client error: ${fields.join(' ')}`);
  }

  // --- BUDGET --- //

  private isWithinBudget(): boolean {
    const now = Date.now();

    if (now - this.windowStart >= BUDGET_WINDOW) {
      const suppressed = this.suppressedCount;

      this.windowStart = now;
      this.windowCount = 0;
      this.suppressedCount = 0;

      // Report the gap rather than leaving a silent hole in the record.
      if (suppressed) this.logger.error(`Client error reporting over budget: ${suppressed} reports dropped`);
    }

    if (this.windowCount >= LOG_BUDGET_PER_MINUTE) {
      this.suppressedCount++;
      return false;
    }

    this.windowCount++;
    return true;
  }

  // --- SANITIZING --- //

  // A route is only ever logged as its path: the query carries the session and the signature the
  // frontend authenticates with, and a matrix parameter (;key=value) would carry them just as well.
  private static toPath(route?: string): string | undefined {
    return route?.split(/[?#;]/)[0];
  }

  // Redacts sensitive assignments, then embeds the value as a JSON string. The quoting is what
  // makes the line unforgeable: line breaks, control characters and ANSI escapes come out as
  // escape sequences, so a payload can neither open a log line of its own nor repaint a terminal
  // that is tailing the log.
  private static quote(value?: string): string {
    if (value == null) return '""';

    return JSON.stringify(value.replace(SENSITIVE_ASSIGNMENT_REGEX, '$1$2<redacted>').replace(EXOTIC_LINE_BREAKS, ' '));
  }
}
