import { describe, expect, it } from 'vitest';

import { downloadCsv, toCsv } from '@/lib/csv';
import type { CsvColumn } from '@/lib/csv';

interface Row {
  name: string;
  amount: number;
  note: string;
}

const COLUMNS: Array<CsvColumn<Row>> = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Amount', value: (row) => row.amount },
  { header: 'Note', value: (row) => row.note },
];

describe('toCsv', () => {
  it('writes a header row even when there are no rows', () => {
    expect(toCsv(COLUMNS, [])).toBe('Name,Amount,Note');
  });

  it('quotes cells containing a comma, a quote or a newline', () => {
    const csv = toCsv(COLUMNS, [
      { name: 'Patientsson, Testina', amount: 38, note: 'Said "fine"' },
      { name: 'Testperson', amount: -12.5, note: 'Two\nlines' },
    ]);

    expect(csv).toContain('"Patientsson, Testina"');
    expect(csv).toContain('"Said ""fine"""');
    expect(csv).toContain('"Two\nlines"');
  });

  it('neutralises a cell a spreadsheet would run as a formula', () => {
    // A negative money cell starts with "-", and "=" is the injection case.
    const csv = toCsv(COLUMNS, [{ name: '=SUM(A1:A9)', amount: -5, note: '@here' }]);
    expect(csv).toContain("'=SUM(A1:A9)");
    expect(csv).toContain("'-5");
    expect(csv).toContain("'@here");
  });

  it('separates rows with CRLF, which every spreadsheet reads', () => {
    const csv = toCsv(COLUMNS, [{ name: 'A', amount: 1, note: 'x' }]);
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});

describe('downloadCsv', () => {
  it('reports whether it ran, and leaves no anchor behind when it does', () => {
    const before = document.body.childElementCount;
    const ran = downloadCsv('audit.csv', 'Name\r\nA');

    // Screens branch on the return value: a browser without the file APIs is
    // told to copy the table instead of being left with a dead button.
    expect(typeof ran).toBe('boolean');
    expect(document.body.childElementCount).toBe(before);
  });
});
