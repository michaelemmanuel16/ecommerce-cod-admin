import { writeCsv } from '../../services/reportExportService';

// Pins the CSV bytes: fixed decimals, quoting, and the formula guard on text cells only.
describe('writeCsv', () => {
  it('writes fixed decimals, quotes commas and quotes, and prefixes text formulas', async () => {
    const chunks: string[] = [];
    const res = { write: (c: string) => { chunks.push(c); return true; }, end: jest.fn() } as never;
    await writeCsv(res, [{
      title: '=Title',
      header: ['Name', 'Amount'],
      rows: [
        [{ v: 'a, "b"', t: 'text' }, { v: '12.5', t: 'money' }],
        [{ v: '-note', t: 'text' }, { v: '-3.456', t: 'percent' }],
        [{ v: null, t: 'text' }, { v: '2026-10-01', t: 'date' }],
      ],
    }]);
    expect(chunks.join('')).toBe(
      "﻿'=Title\r\n" +
      'Name,Amount\r\n' +
      '"a, ""b""",12.50\r\n' +
      "'-note,-3.5\r\n" +
      ',2026-10-01\r\n',
    );
  });
});
