// "YYYY-MM-DD" for a date in the viewer's LOCAL timezone.
// `toISOString().split("T")[0]` returns the UTC date, which is still "yesterday"
// in IST (UTC+5:30) until 5:30 AM — so never use it for "today".
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
