// class-validator's decorators on ListChannelsQueryDto call Reflect.getMetadata;
// other specs only exercise this DTO indirectly through a bootstrapped Nest
// app (which imports this as a side effect via main.ts), so a standalone
// unit test of this file needs the same polyfill explicitly.
import 'reflect-metadata';
import {
  buildChannelDetailCacheKey,
  buildChannelListCacheKey,
} from './channels-cache-key';
import { ListChannelsQueryDto } from './dto/list-channels-query.dto';

function makeQuery(
  overrides: Partial<ListChannelsQueryDto> = {},
): ListChannelsQueryDto {
  const query = new ListChannelsQueryDto();
  Object.assign(query, overrides);
  return query;
}

describe('buildChannelListCacheKey', () => {
  it('gives the same key for the same filters regardless of property order', () => {
    const a = makeQuery({
      q: '100',
      sort: 'title',
      order: 'desc',
      category: 'News',
      page: 2,
      limit: 24,
    });
    const b = makeQuery({
      limit: 24,
      page: 2,
      category: 'News',
      order: 'desc',
      sort: 'title',
      q: '100',
    });

    expect(buildChannelListCacheKey(a)).toBe(buildChannelListCacheKey(b));
  });

  it('gives different keys for different filter values', () => {
    const a = makeQuery({ q: '100' });
    const b = makeQuery({ q: '200' });

    expect(buildChannelListCacheKey(a)).not.toBe(buildChannelListCacheKey(b));
  });

  it('gives different keys for different pages', () => {
    const a = makeQuery({ page: 1 });
    const b = makeQuery({ page: 2 });

    expect(buildChannelListCacheKey(a)).not.toBe(buildChannelListCacheKey(b));
  });

  it('treats an absent optional filter consistently (not undefined vs. missing)', () => {
    const withUndefinedCategory = makeQuery({ category: undefined });
    const withNoCategoryAtAll = makeQuery();

    expect(buildChannelListCacheKey(withUndefinedCategory)).toBe(
      buildChannelListCacheKey(withNoCategoryAtAll),
    );
  });
});

describe('buildChannelDetailCacheKey', () => {
  it('gives different keys for different channel ids', () => {
    expect(buildChannelDetailCacheKey(1)).not.toBe(
      buildChannelDetailCacheKey(2),
    );
  });

  it('is stable for the same id', () => {
    expect(buildChannelDetailCacheKey(42)).toBe(buildChannelDetailCacheKey(42));
  });
});
