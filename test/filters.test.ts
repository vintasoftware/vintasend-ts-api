/**
 * String-filter negotiation. `caseSensitive` and `caseInsensitive` are separate
 * backend capabilities, so declining one must not cost a backend the other.
 */

import { describe, expect, it } from 'vitest';

import { buildStringFilter } from '../src/domain/filters.js';

describe('buildStringFilter', () => {
  it('asks for a case-insensitive contains match when the backend does both', () => {
    expect(
      buildStringFilter('welcome', {
        'stringLookups.includes': true,
        'stringLookups.caseInsensitive': true,
        'stringLookups.caseSensitive': true,
      }),
    ).toEqual({ lookup: 'includes', value: 'welcome', caseSensitive: false });
  });

  it('still asks for a case-insensitive match from a backend that cannot do case-sensitive', () => {
    // A case-insensitive collation (MySQL *_ci): the one lookup it supports is
    // exactly the one being requested.
    expect(
      buildStringFilter('welcome', {
        'stringLookups.includes': true,
        'stringLookups.caseInsensitive': true,
        'stringLookups.caseSensitive': false,
      }),
    ).toEqual({ lookup: 'includes', value: 'welcome', caseSensitive: false });
  });

  it('omits the case flag for a backend that cannot fold case', () => {
    // LIKE without ILIKE: it matches case-sensitively and is not asked otherwise.
    expect(
      buildStringFilter('welcome', {
        'stringLookups.includes': true,
        'stringLookups.caseInsensitive': false,
        'stringLookups.caseSensitive': true,
      }),
    ).toEqual({ lookup: 'includes', value: 'welcome' });
  });

  it('falls back to a case-insensitive exact match without contains support', () => {
    expect(
      buildStringFilter('welcome', {
        'stringLookups.includes': false,
        'stringLookups.caseInsensitive': true,
      }),
    ).toEqual({ lookup: 'exact', value: 'welcome', caseSensitive: false });
  });

  it('falls back to a plain value when the backend supports neither', () => {
    expect(
      buildStringFilter('welcome', {
        'stringLookups.includes': false,
        'stringLookups.caseInsensitive': false,
      }),
    ).toBe('welcome');
  });
});
