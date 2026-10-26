import { Navigate, useParams } from 'react-router-dom';
import { DEFAULT_VIEW, writeView } from './urlState';

/** /products/:id/edit was the full-page form. The form is now a drawer on /products, so the old link opens it there. */
export function ProductEditRedirect() {
  const id = Number(useParams().id);
  const edit = Number.isInteger(id) && id > 0 ? id : null;
  return <Navigate to={`/products?${writeView({ ...DEFAULT_VIEW, edit })}`} replace />;
}
