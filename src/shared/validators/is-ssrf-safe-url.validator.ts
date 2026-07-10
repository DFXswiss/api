import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isIP } from 'net';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

const DISALLOWED_HOSTNAMES = ['localhost'];

// loopback, private, CGNAT, link-local (incl. 169.254.169.254 cloud metadata), unspecified, multicast, reserved
const DISALLOWED_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10 (RFC 6598)
  /^169\.254\./,
  /^0\./, // "this network" 0.0.0.0/8
  /^(22[4-9]|23\d)\./, // multicast 224.0.0.0/4-239.255.255.255
  /^(24\d|25[0-5])\./, // reserved 240.0.0.0/4 + broadcast
];

const DISALLOWED_IPV6_RANGES = [/^::1$/, /^::$/, /^fc/i, /^fd/i, /^fe[89ab]/i, /^ff/i];

// URL parsing normalizes IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1) into pure hex groups
// (::ffff:7f00:1); extract the embedded IPv4 address from either serialization.
function ipv4MappedToV4(ipv6: string): string | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ipv6);
  if (dotted) return dotted[1];

  const hex = /^(?:0:0:0:0:0:ffff|::ffff):([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ipv6);
  if (!hex) return null;

  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isDisallowedIp(hostname: string): boolean {
  const unwrapped = hostname.replace(/^\[|\]$/g, '');
  const ipVersion = isIP(unwrapped);

  if (ipVersion === 4) return DISALLOWED_IPV4_RANGES.some((range) => range.test(unwrapped));
  if (ipVersion === 6) {
    const mappedV4 = ipv4MappedToV4(unwrapped);
    if (mappedV4) return DISALLOWED_IPV4_RANGES.some((range) => range.test(mappedV4));
    return DISALLOWED_IPV6_RANGES.some((range) => range.test(unwrapped));
  }

  return false;
}

export function isSsrfSafeUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) return false;
  if (DISALLOWED_HOSTNAMES.includes(url.hostname)) return false;

  return !isDisallowedIp(url.hostname);
}

// Registration-time check on merchant-supplied callback URLs (e.g. PaymentLink.webhookUrl). Not a
// per-request DNS re-verification, so a hostname resolving to a private/reserved IP only after
// registration is out of scope.
@ValidatorConstraint({ name: 'IsSsrfSafeUrl' })
export class IsSsrfSafeUrlValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return isSsrfSafeUrl(value);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be a public http(s) URL`;
  }
}

export function IsSsrfSafeUrl(validationOptions?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'IsSsrfSafeUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsSsrfSafeUrlValidator,
    });
  };
}
