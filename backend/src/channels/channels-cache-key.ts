import { ListChannelsQueryDto } from './dto/list-channels-query.dto';

/**
 * Built from the validated DTO's own fields, in a fixed order — not from the
 * raw query string — so the same filters given in a different parameter
 * order hit the same cache entry. By the time this runs, class-transformer
 * has already applied the DTO's defaults (sort, order, page, limit), so two
 * requests that mean the same thing always produce the same key.
 */
export function buildChannelListCacheKey(query: ListChannelsQueryDto): string {
  const parts: Array<[string, string]> = [
    ['q', query.q ?? ''],
    ['sort', query.sort],
    ['order', query.order],
    ['category', query.category ?? ''],
    ['language', query.language ?? ''],
    ['genre', query.genre ?? ''],
    ['page', String(query.page)],
    ['limit', String(query.limit)],
  ];
  return `list:${JSON.stringify(parts)}`;
}

export function buildChannelDetailCacheKey(id: number): string {
  return `detail:${id}`;
}
