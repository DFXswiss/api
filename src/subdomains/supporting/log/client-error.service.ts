import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

// Anything shaped like a URL or a path is cut down to the part before its parameters. This is what
// carries the redaction: the query and the fragment are dropped whole, so it makes no difference
// how a parameter is named, spelled or encoded. Matching parameter names instead loses a round to
// every new encoding — percent-encoded, double-encoded, an encoded character inside the name.
//
// A scheme is not required. A relative path is the normal shape for an app calling its own API,
// and a protocol-relative or fully percent-encoded one carries a credential just as well.
const URL_LIKE_REGEX = /(?:[a-z][a-z0-9+.-]*:\/\/|\/|%2f)[^\s"'<>]*/gi;

// Where the meaningful part of a URL ends, percent-encoded or not: ? # ;
const PARAMETER_START = /[?#;]|%3[fb]|%23/i;

// A credential in the authority (scheme://user:secret@host) has no separator in front of it and
// would survive the cut above.
const USERINFO_REGEX = /(:\/\/)[^/\s@]*@/g;

// Outside a URL, a bare assignment is still worth masking — but only for names that are
// unambiguously secret. A broad list fails the other way round: `code` would redact statusCode and
// countryCode, `key` would redact keyboardLayout, and the diagnostic value this endpoint exists
// for would go with them.
const SECRET_NAMES = 'session|signature|password|secret|token|otp|jwt|auth|mail|apikey|api_key';

// `name=value`. The name may be a compound (accessToken), because ordinary prose does not put a
// word in front of an equals sign.
const SECRET_EQUALS_REGEX = new RegExp(`\\b([\\w-]*(?:${SECRET_NAMES})[\\w-]*)\\s*(=|%3D)\\s*["']?[^\\s,&#;"']*`, 'gi');

// `"name": "value"`. Quoted, so a compound name is safe to match here too.
const SECRET_JSON_REGEX = new RegExp(`(["'])([\\w-]*(?:${SECRET_NAMES})[\\w-]*)\\1\\s*:\\s*["']?[^\\s,&#;"']*`, 'gi');

// `name: value`. Here the name must stand on its own word boundaries: as a substring it would fire
// on ordinary prose, and the sentences it would eat are the ones worth reading —
// `Unauthorized: invalid credentials` contains `auth`, `Gmail: no app found` contains `mail`.
const SECRET_COLON_REGEX = new RegExp(`\\b(${SECRET_NAMES})\\b\\s*(:|%3A)\\s*["']?[^\\s,&#;"']*`, 'gi');

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

  // Reduces a URL or path to the part in front of its parameters, and drops any credential embedded
  // in the authority. The query carries the session and the signature the frontend authenticates
  // with; a matrix parameter (;key=value) and a percent-encoded separator carry them just as well.
  private static toPath(value?: string): string | undefined {
    return value?.split(PARAMETER_START)[0].replace(USERINFO_REGEX, '$1');
  }

  // Strips URL parameters, masks bare secret assignments, then embeds the value as a JSON string.
  // The quoting is what makes the line unforgeable: line breaks, control characters and ANSI
  // escapes come out as escape sequences, so a payload can neither open a log line of its own nor
  // repaint a terminal that is tailing the log.
  //
  // What this does NOT promise: a secret that carries no recognisable name and sits outside a URL
  // or path is indistinguishable from an ordinary diagnostic string, and is logged. The guarantee
  // is that the way this app carries credentials — as parameters of a URL or path — cannot reach
  // the log, whatever those parameters are called and however they are encoded.
  private static quote(value?: string): string {
    if (value == null) return '""';

    const redacted = value
      .replace(URL_LIKE_REGEX, (match) => ClientErrorService.toPath(match) ?? match)
      .replace(SECRET_EQUALS_REGEX, '$1$2<redacted>')
      .replace(SECRET_JSON_REGEX, '$1$2$1:<redacted>')
      .replace(SECRET_COLON_REGEX, '$1$2<redacted>')
      .replace(EXOTIC_LINE_BREAKS, ' ');

    return JSON.stringify(redacted);
  }
}
