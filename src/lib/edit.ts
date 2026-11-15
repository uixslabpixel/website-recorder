/**
 * Edit model: the trim keeps [in, out] of the recording, and cuts remove ranges
 * inside it. Everything is in source (recording) seconds; the output is the kept
 * segments played back to back.
 */
export interface Range {
  start: number;
  end: number;
}
export type Trim = { in: number; out: number };

/** Kept parts of the recording, in order. */
export function keptSegments(trim: Trim, cuts: Range[]): Range[] {
  const segments: Range[] = [];
  let cursor = trim.in;
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    if (c.end <= cursor || c.start >= trim.out) continue;
    if (c.start > cursor) segments.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < trim.out) segments.push({ start: cursor, end: trim.out });
  return segments;
}

export function keptLength(trim: Trim, cuts: Range[]) {
  return keptSegments(trim, cuts).reduce((sum, s) => sum + s.end - s.start, 0);
}

/** Maps a time in the edited output to the recording time it shows. */
export function outputToSource(t: number, segments: Range[]) {
  for (const s of segments) {
    const len = s.end - s.start;
    if (t < len) return s.start + t;
    t -= len;
  }
  const last = segments[segments.length - 1];
  return last ? last.end : 0;
}

/** If `time` falls inside a cut, the time playback should jump to; otherwise null. */
export function skipCut(time: number, cuts: Range[]): number | null {
  for (const c of cuts) if (time >= c.start && time < c.end - 0.001) return c.end;
  return null;
}
