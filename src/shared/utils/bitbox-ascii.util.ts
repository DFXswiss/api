// Transliteration that mirrors realunit-app's `toBitboxSafeAscii` (Dart).
// Used to reconcile EIP-712 string fields that the BitBox firmware accepts
// (printable ASCII only) with the UTF-8 originals stored on the user_data
// row. Distinct from the npm `transliteration` package — that one maps
// `ü` to `u` (single char) while the BitBox-safe convention follows the
// German romanization (`ü` → `ue`, `ß` → `ss`).

const MULTI_CHAR_REPLACEMENTS: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ẞ: 'SS',
  æ: 'ae',
  Æ: 'Ae',
  œ: 'oe',
  Œ: 'Oe',
  ø: 'oe',
  Ø: 'Oe',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'Th',
};

const SINGLE_CHAR_REPLACEMENTS: Record<string, string> = {
  à: 'a',
  á: 'a',
  â: 'a',
  ã: 'a',
  å: 'a',
  ā: 'a',
  ă: 'a',
  ą: 'a',
  À: 'A',
  Á: 'A',
  Â: 'A',
  Ã: 'A',
  Å: 'A',
  Ā: 'A',
  Ă: 'A',
  Ą: 'A',
  ç: 'c',
  ć: 'c',
  č: 'c',
  ĉ: 'c',
  ċ: 'c',
  Ç: 'C',
  Ć: 'C',
  Č: 'C',
  Ĉ: 'C',
  Ċ: 'C',
  ď: 'd',
  đ: 'd',
  Ď: 'D',
  Đ: 'D',
  è: 'e',
  é: 'e',
  ê: 'e',
  ë: 'e',
  ē: 'e',
  ė: 'e',
  ę: 'e',
  ě: 'e',
  È: 'E',
  É: 'E',
  Ê: 'E',
  Ë: 'E',
  Ē: 'E',
  Ė: 'E',
  Ę: 'E',
  Ě: 'E',
  ğ: 'g',
  ġ: 'g',
  Ğ: 'G',
  Ġ: 'G',
  ħ: 'h',
  Ħ: 'H',
  ì: 'i',
  í: 'i',
  î: 'i',
  ï: 'i',
  ī: 'i',
  į: 'i',
  ı: 'i',
  Ì: 'I',
  Í: 'I',
  Î: 'I',
  Ï: 'I',
  Ī: 'I',
  Į: 'I',
  İ: 'I',
  ĵ: 'j',
  Ĵ: 'J',
  ķ: 'k',
  Ķ: 'K',
  ł: 'l',
  ľ: 'l',
  ĺ: 'l',
  ļ: 'l',
  Ł: 'L',
  Ľ: 'L',
  Ĺ: 'L',
  Ļ: 'L',
  ñ: 'n',
  ń: 'n',
  ň: 'n',
  ņ: 'n',
  Ñ: 'N',
  Ń: 'N',
  Ň: 'N',
  Ņ: 'N',
  ò: 'o',
  ó: 'o',
  ô: 'o',
  õ: 'o',
  ō: 'o',
  ő: 'o',
  Ò: 'O',
  Ó: 'O',
  Ô: 'O',
  Õ: 'O',
  Ō: 'O',
  Ő: 'O',
  ŕ: 'r',
  ř: 'r',
  ŗ: 'r',
  Ŕ: 'R',
  Ř: 'R',
  Ŗ: 'R',
  ś: 's',
  š: 's',
  ş: 's',
  ŝ: 's',
  ș: 's',
  Ś: 'S',
  Š: 'S',
  Ş: 'S',
  Ŝ: 'S',
  Ș: 'S',
  ť: 't',
  ţ: 't',
  ț: 't',
  ŧ: 't',
  Ť: 'T',
  Ţ: 'T',
  Ț: 'T',
  Ŧ: 'T',
  ù: 'u',
  ú: 'u',
  û: 'u',
  ū: 'u',
  ů: 'u',
  ű: 'u',
  ų: 'u',
  Ù: 'U',
  Ú: 'U',
  Û: 'U',
  Ū: 'U',
  Ů: 'U',
  Ű: 'U',
  Ų: 'U',
  ŵ: 'w',
  Ŵ: 'W',
  ý: 'y',
  ÿ: 'y',
  ŷ: 'y',
  Ý: 'Y',
  Ÿ: 'Y',
  Ŷ: 'Y',
  ź: 'z',
  ż: 'z',
  ž: 'z',
  Ź: 'Z',
  Ż: 'Z',
  Ž: 'Z',
};

function isPrintableAscii(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x20 || c >= 0x7f) return false;
  }
  return true;
}

export function toBitboxAscii(input: string): string {
  if (isPrintableAscii(input)) return input;

  let out = '';
  for (const char of input) {
    const multi = MULTI_CHAR_REPLACEMENTS[char];
    if (multi !== undefined) {
      out += multi;
      continue;
    }
    const single = SINGLE_CHAR_REPLACEMENTS[char];
    if (single !== undefined) {
      out += single;
      continue;
    }
    if (isPrintableAscii(char)) {
      out += char;
      continue;
    }
    out += '?';
  }
  return out;
}
