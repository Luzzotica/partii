/** Thousand-foot marks crossed while climbing from `previous` to `next`. */
export function altitudeMarks(previous: number, next: number): number[] {
  const marks: number[] = [];
  const start = Math.floor(Math.max(0, previous) / 1000) + 1;
  const end = Math.floor(Math.max(0, next) / 1000);
  for (let step = start; step <= end; step += 1) marks.push(step * 1000);
  return marks;
}
