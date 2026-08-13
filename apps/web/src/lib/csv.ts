/**
 * CSV export, as a pure function plus a thin download.
 *
 * Every report and the audit trail export through here, so a row that reads one
 * way on screen reads the same way in a spreadsheet. The serialiser is pure and
 * unit-tested; the download is the only part that touches the browser, and it
 * reports whether it could run rather than throwing where a browser API is
 * missing (jsdom, a print worker, a server render).
 */

export interface CsvColumn<T> {
  /** The header cell. Sentence case, same wording as the on-screen column. */
  header: string;
  /** Already formatted for a human: dates as "12 Aug 2026", money with a sign. */
  value: (row: T) => string | number;
}

function escapeCell(value: string | number): string {
  const text = String(value);
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsv<T>(columns: Array<CsvColumn<T>>, rows: readonly T[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCell(column.value(row))).join(','));
  return [header, ...body].join('\r\n');
}

/**
 * Hands the CSV to the browser as a download. Returns false when the browser
 * APIs are not available, so a caller can say "export is not available here"
 * instead of failing silently.
 */
export function downloadCsv(filename: string, csv: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
