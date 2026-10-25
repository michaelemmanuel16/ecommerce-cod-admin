/** The template the Import modal offers (F-319): the columns the importer reads, and one example row. */
const TEMPLATE_COLUMNS = ['customer_name', 'phone', 'address', 'state', 'product', 'quantity', 'price', 'status'] as const;
const TEMPLATE_ROW = 'Abena Owusu,0245550182,14 Adum Road Kumasi,Ashanti,Magic Groove copybook set,1,249,pending_confirmation';
export const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(`${TEMPLATE_COLUMNS.join(',')}\n${TEMPLATE_ROW}\n`)}`;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
export const rowsPhrase = (n: number) => plural(n, 'row', 'rows');
export const ordersPhrase = (n: number) => plural(n, 'order', 'orders');

/** "Row 17: phone has 9 digits." The server's problems for one row, as one line. */
export const problemLine = (p: { row: number; problems: string[] }) => `Row ${p.row}: ${p.problems.join('; ')}`;

/** Saves text as a file in the browser. */
export function saveText(text: string, name: string, type = 'text/csv;charset=utf-8') {
  saveBlob(new Blob([text], { type }), name);
}

/** Saves a file the server built (a blob answer) in the browser. */
export function saveBlob(blob: Blob, name: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/** The server's sentence from a failed call. A blob answer (the export) is read as text first. */
export async function apiMessage(err: unknown, fallback: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  try {
    const body = data instanceof Blob ? JSON.parse(await data.text()) : data;
    const msg = (body as { message?: unknown } | undefined)?.message;
    return typeof msg === 'string' && msg ? msg : fallback;
  } catch {
    return fallback;
  }
}
