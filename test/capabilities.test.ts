import { describe, expect, it } from 'vitest';

import { toWireCapabilities } from '../src/domain/capabilities.js';

describe('toWireCapabilities', () => {
  it('drops backend-only pagination conventions', () => {
    // The wire contract is 1-indexed whatever the backend does, so publishing
    // this would only invite a client to convert a second time.
    const wire = toWireCapabilities({
      'pagination.oneIndexed': true,
      'orderBy.sentAt': false,
      'stringLookups.includes': true,
    });

    expect(wire).toEqual({
      'orderBy.sentAt': false,
      'stringLookups.includes': true,
    });
  });

  it('keeps every capability a client can act on', () => {
    const capabilities = {
      'logical.and': true,
      'fields.tenant': false,
      'stringLookups.caseSensitive': false,
      'stringLookups.caseInsensitive': true,
      'orderBy.readAt': false,
    };

    expect(toWireCapabilities(capabilities)).toEqual(capabilities);
  });

  it('passes new field capabilities through without needing to know them', () => {
    // The filter is a denylist of backend-facing namespaces, so vocabulary added
    // to the library — `fields.readAtRange` and its negation, for instance —
    // reaches consumers with no change here.
    const capabilities = {
      'fields.readAtRange': false,
      'negation.readAtRange': false,
      'fields.sentAtRange': true,
      'pagination.oneIndexed': true,
    };

    expect(toWireCapabilities(capabilities)).toEqual({
      'fields.readAtRange': false,
      'negation.readAtRange': false,
      'fields.sentAtRange': true,
    });
  });
});
