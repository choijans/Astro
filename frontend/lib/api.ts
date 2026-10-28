import { useUiStore } from '../store/ui-store';

export interface ShowSlot {
  title: string;
  start: string;
  end: string;
}

export interface ChannelListItem {
  id: number;
  title: string;
  subtitle: string;
  stbNumber: number;
  imageUrl: string;
  category: string;
  genres: string[];
  languages: string[];
  rangeKey: string;
  ranking: number;
  scheduleUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  now: ShowSlot | null;
  next: ShowSlot | null;
}

export interface PaginatedChannels {
  data: ChannelListItem[];
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

export interface ScheduleEntry {
  title: string;
  eventStartMyt: string;
  eventEndMyt: string;
}

export interface ChannelDetail {
  id: number;
  title: string;
  subtitle: string;
  stbNumber: number;
  imageUrl: string;
  category: string;
  genres: string[];
  languages: string[];
  rangeKey: string;
  ranking: number;
  schedule: ScheduleEntry[];
  scheduleUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type CommandStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface CommandResponse {
  id: string;
  seq: string;
  userId: string;
  type: 'ADD_FAVORITE' | 'REMOVE_FAVORITE' | 'REFRESH_CHANNEL';
  channelId: number;
  status: CommandStatus;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

export type SortField = 'stbNumber' | 'title' | 'ranking';
export type SortOrder = 'asc' | 'desc';

export interface GetChannelsParams {
  q?: string;
  sort?: SortField;
  order?: SortOrder;
  category?: string;
  language?: string;
  genre?: string;
  page?: number;
  limit?: number;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, statusCode: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The server gave no answer at all — `fetch` itself rejected (offline, DNS,
 * connection refused) or the request was aborted by the timeout below. This
 * is distinct from ApiError (the server answered, just with an error): a
 * NetworkError is the signal the offline outbox queues on, never ApiError. */
export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The backend sends `message` as a string for most errors, but as an array
 * of strings for ValidationPipe failures — both are handled here. */
function extractErrorMessage(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return 'Something went wrong. Please try again.';
}

function getBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not set');
  }
  return baseUrl;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

function getRequestTimeoutMs(): number {
  const raw = process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  // AbortSignal.timeout() throws synchronously on a non-finite value, which
  // would otherwise crash every request instead of just falling back.
  return Number.isFinite(parsed) ? parsed : DEFAULT_REQUEST_TIMEOUT_MS;
}

/** AbortSignal.timeout isn't available in every environment this could run
 * in, so this falls back to a plain AbortController + setTimeout. `cancel()`
 * clears that fallback timer once the request settles either way — without
 * it, a request that finishes well under the timeout would still leave a
 * dangling timer running until it fires. */
function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cancel: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { signal, cancel } = createTimeoutSignal(getRequestTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      ...init,
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': useUiStore.getState().userId,
        ...init?.headers,
      },
    });
  } catch (err) {
    // A rejected fetch — offline, DNS failure, connection refused, or the
    // timeout above aborting the request — means the server never answered.
    throw new NetworkError(err instanceof Error ? err.message : undefined);
  } finally {
    cancel();
  }

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds =
        retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))
          ? Number(retryAfterHeader)
          : undefined;
      throw new ApiError(
        'Too many requests. Please wait a moment and try again.',
        429,
        retryAfterSeconds,
      );
    }
    const body = await response.json().catch(() => null);
    throw new ApiError(extractErrorMessage(body), response.status);
  }

  return response.json() as Promise<T>;
}

export function getChannels(params: GetChannelsParams): Promise<PaginatedChannels> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }
  return apiFetch<PaginatedChannels>(`/channels?${query.toString()}`);
}

export function getChannelFilters(): Promise<ChannelFilters> {
  return apiFetch<ChannelFilters>('/channels/filters');
}

export function getChannel(id: number): Promise<ChannelDetail> {
  return apiFetch<ChannelDetail>(`/channels/${id}`);
}

export function getFavourites(): Promise<ChannelListItem[]> {
  return apiFetch<ChannelListItem[]>('/favourites');
}

export function addFavourite(channelId: number, commandId: string): Promise<CommandResponse> {
  return apiFetch<CommandResponse>('/favourites', {
    method: 'POST',
    headers: { 'X-Command-Id': commandId },
    body: JSON.stringify({ channelId }),
  });
}

export function removeFavourite(channelId: number, commandId: string): Promise<CommandResponse> {
  return apiFetch<CommandResponse>(`/favourites/${channelId}`, {
    method: 'DELETE',
    headers: { 'X-Command-Id': commandId },
  });
}

export function getCommand(id: string): Promise<CommandResponse> {
  return apiFetch<CommandResponse>(`/commands/${id}`);
}

export interface CreateCommandParams {
  id: string;
  type: CommandResponse['type'];
  channelId: number;
}

export function createCommand(params: CreateCommandParams): Promise<CommandResponse> {
  return apiFetch<CommandResponse>('/commands', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
