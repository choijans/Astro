const DEFAULT_RATE_LIMIT_MAX = 60;
const DEFAULT_RATE_LIMIT_TTL_MS = 60000;

export function getRateLimitMax(): number {
  const raw = process.env.RATE_LIMIT_MAX;
  return raw ? Number(raw) : DEFAULT_RATE_LIMIT_MAX;
}

export function getRateLimitTtlMs(): number {
  const raw = process.env.RATE_LIMIT_TTL_MS;
  return raw ? Number(raw) : DEFAULT_RATE_LIMIT_TTL_MS;
}
