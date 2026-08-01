// Per class, the values each property may contribute to a log line, keyed by property and held on
// the class itself. Shared between the decorator and its reader so the two can never drift.
const LOG_REJECTED_VALUE = Symbol('logRejectedValue');

type Loggable = { [LOG_REJECTED_VALUE]?: Map<string | symbol, Map<string, string>> };

/** The values a field may render, as an enum object or a plain list. */
export type LoggableValues = Record<string, string | number> | readonly (string | number | boolean)[];

/**
 * Declares which values of a DTO property may be written to a log line when the property is
 * rejected.
 *
 * A rejection names the field and the values it accepts, never the one that came - so a client
 * sending a wrong constant produces the same line as one sending nothing, and the fix, usually one
 * constant in one client, cannot be named from the logs. Naming it needs the value; logging the
 * value as it arrived does not work, because a constraint bounds what is accepted and a rejected
 * value is by definition outside it. A field constrained to three payment methods rejects an
 * account number exactly as readily as it rejects a typo.
 *
 * So the field declares a set instead, and only a value in that set is rendered - matched without
 * regard to case, and rendered from the set rather than from the request, so what reaches the log
 * is a constant of this program either way. Everything else keeps its shape and loses its content.
 *
 * The set to pass is the one a wrong value plausibly comes from and the field does not accept: for
 * a field taking the fiat payment methods, the full payment-method union, whose crypto members are
 * exactly what a client sends there by mistake.
 */
export function LogRejectedValue(values: LoggableValues): PropertyDecorator {
  const loggable = new Map((Array.isArray(values) ? values : Object.values(values)).map(canonical));

  return (target: object, property: string | symbol) => {
    const type = target.constructor as Loggable;

    // A subclass starts from what it inherits and grows its own map, so declaring a property on it
    // never reaches back into the class it extends.
    const declared = Object.prototype.hasOwnProperty.call(type, LOG_REJECTED_VALUE)
      ? (type[LOG_REJECTED_VALUE] as Map<string | symbol, Map<string, string>>)
      : new Map(type[LOG_REJECTED_VALUE] ?? []);

    declared.set(property, loggable);
    Object.defineProperty(type, LOG_REJECTED_VALUE, { value: declared, configurable: true });
  };
}

/**
 * What the given property of the given class may render, or undefined if it declared nothing. The
 * keys are lower-cased; the values are the constants as they are written in the code.
 */
export function loggableRejectedValues(
  type: unknown,
  property: string | symbol,
): ReadonlyMap<string, string> | undefined {
  if (typeof type !== 'function') return undefined;

  return (type as Loggable)[LOG_REJECTED_VALUE]?.get(property);
}

function canonical(value: string | number | boolean): [string, string] {
  return [`${value}`.toLowerCase(), `${value}`];
}
