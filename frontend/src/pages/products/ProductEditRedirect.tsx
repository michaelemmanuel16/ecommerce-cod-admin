import { Navigate, useParams } from 'react-router-dom';

/** /products/:id/edit was the full-page form. The form is now a drawer on /products, so the old link opens it there. */
export function ProductEditRedirect() {
  const { id } = useParams();
  return <Navigate to={Number.isInteger(Number(id)) && Number(id) > 0 ? `/products?edit=${id}` : '/products'} replace />;
}
