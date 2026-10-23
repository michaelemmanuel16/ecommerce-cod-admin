/**
 * Orders this tab is moving to a new status. The server also sends `order:status_changed` for them; the screen has
 * already said "#21515 is now Confirmed", so the socket toast skips them. Entries expire after 15 seconds.
 */
const TTL_MS = 15000;
const moves = new Map<number, number>();

export const markOwnMoves = (ids: number[]): void => {
  const until = Date.now() + TTL_MS;
  ids.forEach((id) => moves.set(id, until));
};

export const isOwnMove = (id: number): boolean => {
  const until = moves.get(id);
  if (until === undefined) return false;
  if (until < Date.now()) {
    moves.delete(id);
    return false;
  }
  return true;
};
