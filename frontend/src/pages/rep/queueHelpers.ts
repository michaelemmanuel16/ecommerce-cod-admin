export function formatWaitDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 1) return '< 1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

export function formatCallbackTime(callbackAt: string | null, now: number): { text: string; overdue: boolean } {
  if (!callbackAt) return { text: '', overdue: false };
  const cb = new Date(callbackAt).getTime();
  const diffMins = Math.round((cb - now) / 60000);
  if (diffMins <= 0) {
    const overdueMins = Math.abs(diffMins);
    return {
      text: overdueMins > 0 ? `Overdue ${formatWaitDuration(overdueMins)}` : 'Due now',
      overdue: true,
    };
  }
  return {
    text: `In ${formatWaitDuration(diffMins)}`,
    overdue: false,
  };
}
