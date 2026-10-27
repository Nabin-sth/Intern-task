export const SMS_LIMITS = {
  gsm7: { single: 160, concat: 153 },
  unicode: { single: 70, concat: 67 },
};

const GSM_BASIC = new Set([
  '@',
  '£',
  '$',
  '¥',
  'è',
  'é',
  'ù',
  'ì',
  'ò',
  'Ç',
  '\n',
  'Ø',
  'ø',
  '\r',
  'Å',
  'å',
  'Δ',
  '_',
  'Φ',
  'Γ',
  'Λ',
  'Ω',
  'Π',
  'Ψ',
  'Σ',
  'Θ',
  'Ξ',
  'Æ',
  'æ',
  'ß',
  'É',
  ' ',
  '!',
  '"',
  '#',
  '¤',
  '%',
  '&',
  "'",
  '(',
  ')',
  '*',
  '+',
  ',',
  '-',
  '.',
  '/',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  ':',
  ';',
  '<',
  '=',
  '>',
  '?',
  '¡',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'Ä',
  'Ö',
  'Ñ',
  'Ü',
  '§',
  '¿',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  'ä',
  'ö',
  'ñ',
  'ü',
  'à',
]);

const GSM_EXTENSION = new Set(['\f', '^', '{', '}', '\\', '[', '~', ']', '|', '€']);

function isGsm7Char(char) {
  return GSM_BASIC.has(char) || GSM_EXTENSION.has(char);
}

function septetsForChar(char) {
  if (GSM_EXTENSION.has(char)) {
    return 2;
  }
  if (GSM_BASIC.has(char)) {
    return 1;
  }
  return null;
}

export function detectSmsEncoding(message) {
  for (const char of message) {
    if (!isGsm7Char(char)) {
      return 'unicode';
    }
  }
  return 'gsm7';
}

export function countGsm7Septets(message) {
  let septets = 0;
  for (const char of message) {
    const cost = septetsForChar(char);
    if (cost === null) {
      throw new Error('countGsm7Septets requires a GSM-7-only message');
    }
    septets += cost;
  }
  return septets;
}

function partCount(units, singleLimit, concatLimit) {
  if (units <= singleLimit) {
    return 1;
  }
  return Math.ceil(units / concatLimit);
}

/**
 * Count SMS parts using PDF rules.
 * GSM-7 uses septets (extension-table characters cost 2).
 * Unicode uses Unicode code points (one emoji = one character).
 * An empty message is one GSM-7 part.
 * @param {unknown} message
 */
export function analyzeSms(message) {
  if (typeof message !== 'string') {
    throw new TypeError('message must be a string');
  }

  const encoding = detectSmsEncoding(message);
  const limits = SMS_LIMITS[encoding];
  const unitCount = encoding === 'gsm7' ? countGsm7Septets(message) : [...message].length;
  const parts = partCount(unitCount, limits.single, limits.concat);

  return {
    encoding,
    unitCount,
    parts,
    singleLimit: limits.single,
    concatLimit: limits.concat,
  };
}
