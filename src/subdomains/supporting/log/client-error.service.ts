import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

// Anything shaped like a URL or a path is cut down to the part before its parameters. This is what
// carries the redaction: the query and the fragment are dropped whole, so it makes no difference
// how a parameter is named, spelled or encoded. Matching parameter names instead loses a round to
// every new encoding — percent-encoded, double-encoded, an encoded character inside the name.
//
// Anchored on the slash rather than on a scheme, which also covers the shapes that carry no
// scheme: a relative path — the normal shape for an app calling its own API — and a
// protocol-relative one. Anchoring matters for cost too: a scheme pattern has to be retried at
// every position of a long word, and this endpoint takes input from anyone.
const URL_LIKE_REGEX = /(?:\/|%2f)[^\s"'<>]*/gi;

// Where the meaningful part of a URL ends, percent-encoded or not: ? # ;
const PARAMETER_START = /[?#;]|%3[fb]|%23/i;

// A credential in the authority (//user:secret@host) has no separator in front of it and would
// survive the cut above.
const USERINFO_REGEX = /^(\/\/)[^/\s@]*@/;

// A bare assignment outside a URL is still worth masking — but only for names that are
// unambiguously secret. A broad list fails the other way round: `code` would redact statusCode and
// countryCode, `key` would redact keyboardLayout, and the diagnostic value this endpoint exists
// for would go with them.
// `auth` is deliberately absent and spelled out instead: as a name part it means authentication,
// not a credential, and would take `authMethod` with it — while `Unauthorized` is not a name part
// at all.
const SECRET_NAMES = [
  'session',
  'signature',
  'password',
  'secret',
  'token',
  'otp',
  'jwt',
  'authorization',
  'mail',
  'email',
  'apikey',
];

// Anchored on the separator, with the name read from the text in front of it. A name pattern
// placed before the separator has to be retried at every position of a long word, which is
// quadratic on input this endpoint accepts from anyone.
// The scheme of an `authorization: Bearer <token>` is matched separately, so that the credential
// after it is redacted rather than just the word naming the scheme.
//
// A value ends at any joiner, not only at whitespace. Letting it run to the next space would make
// a harmless assignment swallow the one behind it — `a=1;password=secret` matches at `a=`, the
// value eats the rest, and because a global replace never re-reads what a match consumed, the
// password is never examined. Stopping early costs the tail of a value that legitimately contains
// a comma; that leaves part of it masked instead of none of it.
const ASSIGNMENT_REGEX = /(=|%3D|:|%3A)(\s*)(["']?)((?:bearer|basic|digest|token)\s+)?([^\s"'=:,&;]*)/gi;
const NAME_BEFORE_REGEX = /([\w-]+)(["']?)\s*$/;

// Splits a name into its parts: accessToken, session_id and api-key all yield their components.
const NAME_SEGMENT_REGEX = /[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g;

// How far back to look for the name of an assignment. Longer than any realistic parameter name.
const NAME_LOOKBEHIND = 64;

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
    // Checked before the fields are built, so a flood cannot buy sanitizing work it never uses.
    if (!this.isWithinBudget()) return;

    const { message, type, stack, route, version, accountId } = dto;

    // Context first, free text last and quoted: message, type and stack are attacker-controlled
    // and would otherwise be indistinguishable from the key=value context a log query parses.
    //
    // The account is a correlation hint and nothing else. This endpoint takes no session (see the
    // controller), so the id is whatever the request carried: it lets a support case be matched
    // against the reports carrying the same id, and says nothing about who sent them.
    const fields = [
      `client=${ClientErrorService.quote(client)}`,
      `accountId=${ClientErrorService.quote(accountId?.toString())}`,
      `route=${ClientErrorService.quote(ClientErrorService.toPath(route))}`,
      `version=${ClientErrorService.quote(version)}`,
      `userAgent=${ClientErrorService.quote(userAgent)}`,
      `type=${ClientErrorService.quote(type)}`,
      `message=${ClientErrorService.quote(message)}`,
    ];
    if (stack) fields.push(`stack=${ClientErrorService.quote(stack)}`);

    this.logger.error(`Client error: ${fields.join(' ')}`);
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

  // A colon appears all over ordinary prose, so there a secret name only counts as a part of the
  // name in its own right: `accessToken:` and `sessionId:` are matched, while `Unauthorized:` and
  // `Gmail:` are not — and those sentences are what a frontend error usually consists of. In front
  // of an equals sign, or quoted as a JSON key, no sentence collides, so a plain substring is the
  // safer choice there: it also catches spellings that have no parts to split, such as SESSIONID.
  private static isSecretName(name: string, quoted: boolean, separator: string): boolean {
    const isProseSeparator = !quoted && (separator === ':' || separator.toLowerCase() === '%3a');
    if (!isProseSeparator) return SECRET_NAMES.some((secret) => name.toLowerCase().includes(secret));

    const segments: string[] = name.match(NAME_SEGMENT_REGEX) ?? [];

    return segments.some((segment) => SECRET_NAMES.includes(segment.toLowerCase()));
  }

  // Strips URL parameters, masks bare secret assignments, then embeds the value as a JSON string.
  // The quoting is what makes the line unforgeable: line breaks, control characters and ANSI
  // escapes come out as escape sequences, so a payload can neither open a log line of its own nor
  // repaint a terminal that is tailing the log.
  //
  // What is guaranteed: a credential carried the way this app carries one — as a parameter of a URL
  // or a path — cannot reach the log, whatever it is called and however it is encoded, because the
  // parameters are dropped rather than inspected.
  //
  // What is not: outside a URL, masking depends on recognising the name in front of the value, so
  // a secret under an unknown name, or under no name at all, is indistinguishable from an ordinary
  // diagnostic string and is logged. Even under a known name the masking ends where the value
  // ends — a value that itself contains a comma or an equals sign keeps its tail.
  private static quote(value?: string): string {
    if (value == null) return '""';

    const redacted = value
      .replace(URL_LIKE_REGEX, (match) => ClientErrorService.toPath(match) ?? match)
      .replace(ASSIGNMENT_REGEX, (match, separator, space, quote, scheme, assigned, offset: number, whole: string) => {
        if (!assigned) return match;

        const name = NAME_BEFORE_REGEX.exec(whole.slice(Math.max(0, offset - NAME_LOOKBEHIND), offset));

        return name && ClientErrorService.isSecretName(name[1], Boolean(name[2]), separator)
          ? `${separator}${space}${quote}${scheme ?? ''}<redacted>`
          : match;
      })
      .replace(EXOTIC_LINE_BREAKS, ' ');

    return JSON.stringify(redacted);
  }
}
