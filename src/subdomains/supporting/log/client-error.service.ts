import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

// Every URL in the text is cut down to its origin and path. This is what carries the redaction:
// the query and the fragment are dropped whole, so it makes no difference how a parameter is
// named, spelled or encoded. Matching parameter names instead loses a round to every new
// encoding — percent-encoded, double-encoded, an encoded character inside the name itself.
const URL_REGEX = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

// Outside a URL, a bare assignment is still worth masking — but only for names that are
// unambiguously secret. A broad substring list fails the other way round: `code` would redact
// statusCode and countryCode, `key` would redact monkey and keyboardLayout, and the diagnostic
// value this endpoint exists for would go with them. Names are matched as substrings so compound
// spellings (accessToken, refreshToken, emailAddress) are covered.
const SECRET_NAMES = 'session|signature|password|secret|token|otp|jwt|auth|mail|apikey|api_key';

// Accepts = or : as the separator, percent-encoded or not, with optional quotes around it, so
// `session: x`, `{"token":"x"}` and `session=x` are all caught.
const SECRET_ASSIGNMENT_REGEX = new RegExp(
  `\\b([\\w-]*(?:${SECRET_NAMES})[\\w-]*)\\s*["']?\\s*(=|:|%3D|%3A)\\s*["']?[^\\s,&#;"']*`,
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

  // Strips URL parameters, masks bare secret assignments, then embeds the value as a JSON string.
  // The quoting is what makes the line unforgeable: line breaks, control characters and ANSI
  // escapes come out as escape sequences, so a payload can neither open a log line of its own nor
  // repaint a terminal that is tailing the log.
  //
  // What this does NOT promise: a secret that carries no recognisable name and sits outside a URL
  // is indistinguishable from an ordinary diagnostic string, and is logged. The guarantee is that
  // the way this app actually carries credentials — as URL parameters — cannot reach the log.
  private static quote(value?: string): string {
    if (value == null) return '""';

    const redacted = value
      .replace(URL_REGEX, (match) => ClientErrorService.toPath(match) ?? match)
      .replace(SECRET_ASSIGNMENT_REGEX, '$1$2<redacted>')
      .replace(EXOTIC_LINE_BREAKS, ' ');

    return JSON.stringify(redacted);
  }
}
