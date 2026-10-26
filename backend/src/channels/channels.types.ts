export interface PaginatedChannels<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
}

export interface ChannelFilters {
  categories: string[];
  languages: string[];
  genres: string[];
}
