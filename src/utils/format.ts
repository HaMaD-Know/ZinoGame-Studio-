export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 90) return 'a minute ago';
  if (diff < 3600) return `${Math.round(diff / 60)} minutes ago`;
  if (diff < 7200) return 'an hour ago';
  if (diff < 86400) return `${Math.round(diff / 3600)} hours ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 604800) return `${Math.round(diff / 86400)} days ago`;
  return new Date(t).toLocaleDateString();
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}
