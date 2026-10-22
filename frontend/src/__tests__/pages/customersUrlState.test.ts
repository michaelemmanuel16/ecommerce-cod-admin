import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW, filterParams, listParams, parseView, writeView } from '../../pages/customers/urlState';

const parse = (qs: string) => parseView(new URLSearchParams(qs));

describe('Customers URL state (M3-T49, F-353)', () => {
  it('the plain page has a plain URL and the defaults', () => {
    expect(writeView(DEFAULT_VIEW).toString()).toBe('');
    expect(parse('')).toEqual(DEFAULT_VIEW);
  });

  it('round-trips segment, search, filters, sort, page and size', () => {
    const view = parse('segment=repeat&q=abena&town=Kumasi&region=Ashanti&risk=high&blocked=1&flagged=1&sort=deliveredValue&dir=asc&page=3&size=50');
    expect(view).toMatchObject({
      segment: 'repeat', q: 'abena', town: 'Kumasi', region: 'Ashanti', risk: 'high', blocked: true, flagged: true,
      sort: { by: 'deliveredValue', dir: 'asc' }, page: 3, size: 50,
    });
    expect(parse(writeView(view).toString())).toEqual(view);
  });

  it('ignores values it does not know', () => {
    expect(parse('segment=nonsense&risk=x&sort=password&size=7&page=-2')).toEqual(DEFAULT_VIEW);
  });

  it('sends the API names: area for the town, sortBy and sortOrder, no segment for All', () => {
    const view = parse('town=Kumasi&sort=lastOrder&dir=desc&blocked=1');
    expect(listParams(view, 25)).toEqual({ area: 'Kumasi', blocked: true, page: 1, limit: 25, sortBy: 'lastOrder', sortOrder: 'desc' });
    expect(listParams(parse('segment=not_reachable'), 25)).toMatchObject({ segment: 'not_reachable' });
  });

  it('one character of search waits for more input', () => {
    expect(filterParams(parse('q=a'))).toEqual({});
    expect(filterParams(parse('q=ab'))).toEqual({ search: 'ab' });
  });
});
