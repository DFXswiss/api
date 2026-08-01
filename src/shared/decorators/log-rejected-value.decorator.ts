// The set of properties a class allows into a log line, kept on the class itself. Shared between
// the decorator and its reader so the marker and its reader can never drift.
const LOG_REJECTED_VALUE = Symbol('logRejectedValue');

type Marked = { [LOG_REJECTED_VALUE]?: Set<string | symbol> };

const NOTHING: ReadonlySet<string | symbol> = new Set();

/**
 * Marks a DTO property whose rejected value may be written to a log line as it arrived.
 *
 * A rejection names the field and the values it accepts, never the one that came - so a client
 * sending a wrong constant produces the same line as one sending nothing, and the fix cannot be
 * named from the logs. The value closes that, but only the field itself can say that showing it is
 * safe: a constraint bounds what is accepted, not what a client sends, and a rejected value is by
 * definition outside it. A field constrained to three payment methods rejects an account number
 * exactly as it rejects a typo.
 *
 * So this is an opt-in rather than a rule read off the validators. Put it on a field whose wrong
 * values are constants of the program - an enum, a code, a mode - and leave it off anything a
 * person could type into. Without it the field still appears in the line, by shape.
 */
export function LogRejectedValue(): PropertyDecorator {
  return (target: object, property: string | symbol) => {
    const type = target.constructor as Marked;

    // A subclass starts from what it inherits and grows its own set, so marking a property on it
    // never reaches back into the class it extends.
    const marked = Object.prototype.hasOwnProperty.call(type, LOG_REJECTED_VALUE)
      ? (type[LOG_REJECTED_VALUE] as Set<string | symbol>)
      : new Set(type[LOG_REJECTED_VALUE] ?? []);

    marked.add(property);
    Object.defineProperty(type, LOG_REJECTED_VALUE, { value: marked, configurable: true });
  };
}

export function logsRejectedValues(type: unknown): ReadonlySet<string | symbol> {
  if (typeof type !== 'function') return NOTHING;

  return (type as Marked)[LOG_REJECTED_VALUE] ?? NOTHING;
}
