declare module 'lnurl' {
  export function encode(str: string): string;
  export function decode(lnurl: string): string;
}
