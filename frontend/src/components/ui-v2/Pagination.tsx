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
}

/** The list footer (.pfoot): "Showing 11 of 1,445 orders" and Previous / Next. */
export function Pagination({ page, pageSize, total, noun, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const shown = Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
  return (
    <nav className="pfoot" aria-label="Pagination">
      <span>
        Showing {shown.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')} {noun}
      </span>
      <div className="pgbtns">
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
