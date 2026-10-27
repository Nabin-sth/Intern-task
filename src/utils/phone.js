export class PhoneValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PhoneValidationError';
  }
}

const LOCAL_MOBILE = /^(97|98)\d{8}$/;
const PREFIXED_MOBILE = /^(?:\+977|977)(97|98)\d{8}$/;

function reject(reason) {
  throw new PhoneValidationError(
    `${reason}. Use a 10-digit Nepali mobile number starting with 97 or 98, optionally prefixed by +977 or 977.`,
  );
}

/**
 * Normalise a Nepali mobile number to 10 digits (97xxxxxxxx / 98xxxxxxxx).
 * Accepts an optional +977 or 977 country prefix.
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeNepaliMobile(input) {
  if (typeof input !== 'string') {
    reject('Phone number is required');
  }

  const raw = input.trim();
  if (raw === '') {
    reject('Phone number is required');
  }

  if (LOCAL_MOBILE.test(raw)) {
    return raw;
  }

  if (PREFIXED_MOBILE.test(raw)) {
    return raw.startsWith('+977') ? raw.slice(4) : raw.slice(3);
  }

  reject('Invalid phone number');
}

export function isValidNepaliMobile(input) {
  try {
    normalizeNepaliMobile(input);
    return true;
  } catch (err) {
    if (err instanceof PhoneValidationError) {
      return false;
    }
    throw err;
  }
}
