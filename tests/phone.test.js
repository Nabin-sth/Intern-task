import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PhoneValidationError,
  isValidNepaliMobile,
  normalizeNepaliMobile,
} from '../src/utils/phone.js';

describe('normalizeNepaliMobile', () => {
  it('accepts a 10-digit number starting with 98 (PDF)', () => {
    assert.equal(normalizeNepaliMobile('9841234567'), '9841234567');
  });

  it('strips a +977 prefix (PDF)', () => {
    assert.equal(normalizeNepaliMobile('+9779801122334'), '9801122334');
  });

  it('strips a 977 prefix (PDF)', () => {
    assert.equal(normalizeNepaliMobile('9779761234567'), '9761234567');
  });

  it('accepts numbers starting with 97', () => {
    assert.equal(normalizeNepaliMobile('9700000000'), '9700000000');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(normalizeNepaliMobile('  9841234567  '), '9841234567');
  });

  it('rejects a 10-digit number that does not start with 97 or 98 (PDF)', () => {
    assert.throws(() => normalizeNepaliMobile('9612345678'), PhoneValidationError);
    assert.equal(isValidNepaliMobile('9612345678'), false);
  });

  it('rejects a 9-digit number (PDF)', () => {
    assert.throws(() => normalizeNepaliMobile('984123456'), PhoneValidationError);
    assert.equal(isValidNepaliMobile('984123456'), false);
  });

  it('rejects empty input', () => {
    assert.throws(() => normalizeNepaliMobile(''), PhoneValidationError);
    assert.throws(() => normalizeNepaliMobile('   '), PhoneValidationError);
    assert.throws(() => normalizeNepaliMobile(null), PhoneValidationError);
    assert.throws(() => normalizeNepaliMobile(undefined), PhoneValidationError);
    assert.equal(isValidNepaliMobile(''), false);
  });

  it('rejects numbers with internal spaces or extra digits', () => {
    assert.equal(isValidNepaliMobile('9841 234567'), false);
    assert.equal(isValidNepaliMobile('98412345670'), false);
    assert.equal(isValidNepaliMobile('+9779612345678'), false);
  });

  it('does not treat a 10-digit 977xxxxxxx number as a country prefix', () => {
    assert.equal(normalizeNepaliMobile('9771234567'), '9771234567');
  });
});
