import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

interface PaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  /** Plural noun for the footer text, for example "orders". */
  noun: string;
  onPageChange: (page: number) => void;
  /** With `onPageSizeChange`: a "Rows per page" select (.psel) before the buttons, for example [25, 50, 75, 100]. */
  pageSizes?: readonly number[];
  onPageSizeChange?: (size: number) => void;
}

/** The list footer (.pfoot): "Showing 11 of 1,445 orders" and Previous / Next. */
export function Pagination({ page, pageSize, total, noun, onPageChange, pageSizes, onPageSizeChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const shown = Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
  return (
    <nav className="pfoot" aria-label="Pagination">
      <span>
        Showing {shown.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')} {noun}
      </span>
      <div className="pgbtns">
        {pageSizes && onPageSizeChange && (
          <select className="psel" aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {pageSizes.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        )}
        <Button size="mini" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft style={{ width: 15, height: 15, verticalAlign: -3 }} />
        </Button>
        <span aria-current="page">
          Page {page} of {pages}
        </span>
        <Button size="mini" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight style={{ width: 15, height: 15, verticalAlign: -3 }} />
        </Button>
      </div>
    </nav>
  );
}
