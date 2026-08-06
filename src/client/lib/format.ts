const rtf = new Intl.RelativeTimeFormat('zh-HK', { numeric: 'auto' });
const dateTime = new Intl.DateTimeFormat('zh-HK', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatRelativeTime(value: string): string {
  const diffSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return rtf.format(diffSeconds, 'second');
  if (abs < 3_600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSeconds / 3_600), 'hour');
  return rtf.format(Math.round(diffSeconds / 86_400), 'day');
}

export function formatDateTime(value: string): string {
  return dateTime.format(new Date(value));
}
