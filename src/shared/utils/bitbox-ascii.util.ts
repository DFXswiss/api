// Transliteration that mirrors realunit-app's `toBitboxSafeAscii` (Dart).
// Used to reconcile EIP-712 string fields that the BitBox firmware accepts
// (printable ASCII only) with the UTF-8 originals stored on the user_data
// row. Distinct from the npm `transliteration` package — that one maps
// `ü` to `u` (single char) while the BitBox-safe convention follows the
// German romanization (`ü` → `ue`, `ß` → `ss`).
//
// Same chained-replace idiom as `Util.removeSpecialChars`. Digraph rules
// must run before the single-char fallback, and the final catch-all
// replaces any leftover non-ASCII with `?` so the BitBox firmware never
// sees a non-printable byte.

export function toBitboxAscii(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;

  return (
    value
      // Digraph romanizations — must come before single-char fallbacks
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/Ä/g, 'Ae')
      .replace(/Ö/g, 'Oe')
      .replace(/Ü/g, 'Ue')
      .replace(/ẞ/g, 'SS')
      .replace(/æ/g, 'ae')
      .replace(/Æ/g, 'Ae')
      .replace(/œ/g, 'oe')
      .replace(/Œ/g, 'Oe')
      .replace(/ø/g, 'oe')
      .replace(/Ø/g, 'Oe')
      .replace(/þ/g, 'th')
      .replace(/Þ/g, 'Th')
      .replace(/ð/g, 'd')
      .replace(/Ð/g, 'D')
      // Single-char base-letter equivalents
      .replace(/[àáâãåāăą]/g, 'a')
      .replace(/[ÀÁÂÃÅĀĂĄ]/g, 'A')
      .replace(/[çćčĉċ]/g, 'c')
      .replace(/[ÇĆČĈĊ]/g, 'C')
      .replace(/[ďđ]/g, 'd')
      .replace(/[ĎĐ]/g, 'D')
      .replace(/[èéêëēėęě]/g, 'e')
      .replace(/[ÈÉÊËĒĖĘĚ]/g, 'E')
      .replace(/[ğġ]/g, 'g')
      .replace(/[ĞĠ]/g, 'G')
      .replace(/ħ/g, 'h')
      .replace(/Ħ/g, 'H')
      .replace(/[ìíîïīįı]/g, 'i')
      .replace(/[ÌÍÎÏĪĮİ]/g, 'I')
      .replace(/ĵ/g, 'j')
      .replace(/Ĵ/g, 'J')
      .replace(/ķ/g, 'k')
      .replace(/Ķ/g, 'K')
      .replace(/[łľĺļ]/g, 'l')
      .replace(/[ŁĽĹĻ]/g, 'L')
      .replace(/[ñńňņ]/g, 'n')
      .replace(/[ÑŃŇŅ]/g, 'N')
      .replace(/[òóôõōő]/g, 'o')
      .replace(/[ÒÓÔÕŌŐ]/g, 'O')
      .replace(/[ŕřŗ]/g, 'r')
      .replace(/[ŔŘŖ]/g, 'R')
      .replace(/[śšşŝș]/g, 's')
      .replace(/[ŚŠŞŜȘ]/g, 'S')
      .replace(/[ťţțŧ]/g, 't')
      .replace(/[ŤŢȚŦ]/g, 'T')
      .replace(/[ùúûūůűų]/g, 'u')
      .replace(/[ÙÚÛŪŮŰŲ]/g, 'U')
      .replace(/ŵ/g, 'w')
      .replace(/Ŵ/g, 'W')
      .replace(/[ýÿŷ]/g, 'y')
      .replace(/[ÝŸŶ]/g, 'Y')
      .replace(/[źżž]/g, 'z')
      .replace(/[ŹŻŽ]/g, 'Z')
      // Any remaining non-ASCII or non-printable rune
      .replace(/[^\x20-\x7E]/g, '?')
  );
}
