const timeFormatter = new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function formatTime(isoString: string): string {
  return timeFormatter.format(new Date(isoString));
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} - ${formatTime(endIso)}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function formatDateTime(isoString: string): string {
  return dateTimeFormatter.format(new Date(isoString));
}
