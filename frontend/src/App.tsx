import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/layout/Layout';
import { Toast } from './components/ui/Toast';
import { Loading } from './components/ui/Loading';

// Eager load authentication pages (critical path)
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { DynamicDashboard } from './pages/DynamicDashboard';

// Lazy load all other pages for better initial load performance
const Orders = lazy(() => import('./pages/Orders').then(m => ({ default: m.Orders })));
const OrderDetails = lazy(() => import('./pages/OrderDetails').then(m => ({ default: m.OrderDetails })));
const Products = lazy(() => import('./pages/Products').then(m => ({ default: m.Products })));
const ProductForm = lazy(() => import('./pages/ProductForm').then(m => ({ default: m.ProductForm })));
const Customers = lazy(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const CustomerDetails = lazy(() => import('./pages/CustomerDetails').then(m => ({ default: m.CustomerDetails })));
const DeliveryAgents = lazy(() => import('./pages/DeliveryAgents').then(m => ({ default: m.DeliveryAgents })));
const CustomerReps = lazy(() => import('./pages/CustomerReps').then(m => ({ default: m.CustomerReps })));
const Financial = lazy(() => import('./pages/Financial').then(m => ({ default: m.Financial })));
const Analytics = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const Workflows = lazy(() => import('./pages/Workflows').then(m => ({ default: m.Workflows })));
const WorkflowWizard = lazy(() => import('./pages/WorkflowWizard').then(m => ({ default: m.WorkflowWizard })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const CheckoutForms = lazy(() => import('./pages/CheckoutForms').then(m => ({ default: m.CheckoutForms })));
const Webhooks = lazy(() => import('./pages/Webhooks').then(m => ({ default: m.Webhooks })));
const PublicCheckout = lazy(() => import('./pages/PublicCheckout').then(m => ({ default: m.PublicCheckout })));

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const RoleGuard: React.FC<{ children: React.ReactNode; allowedRoles: string[] }> = ({ children, allowedRoles }) => {
  const { user } = useAuthStore();

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

function App() {
  const { isAuthenticated, refreshPermissions, setupPermissionListener } = useAuthStore();

  // Refresh permissions and setup socket listener on mount
  useEffect(() => {
    if (isAuthenticated) {
      // Refresh permissions to ensure they're up to date
      refreshPermissions();

      // Setup all socket listeners
      const { initSocket } = useAuthStore.getState();
      initSocket();
    }
  }, [isAuthenticated, refreshPermissions, setupPermissionListener]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Public routes - no authentication required */}
          <Route path="/order/:slug" element={
            <Suspense fallback={<Loading />}>
              <PublicCheckout />
            </Suspense>
          } />

          {/* Auth routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DynamicDashboard />} />
            <Route path="orders" element={
              <Suspense fallback={<Loading />}>
                <Orders />
              </Suspense>
            } />
            <Route path="orders/:id" element={
              <Suspense fallback={<Loading />}>
                <OrderDetails />
              </Suspense>
            } />
            <Route path="products" element={
              <Suspense fallback={<Loading />}>
                <Products />
              </Suspense>
            } />
            <Route path="products/new" element={
              <Suspense fallback={<Loading />}>
                <ProductForm />
              </Suspense>
            } />
            <Route path="products/:id/edit" element={
              <Suspense fallback={<Loading />}>
                <ProductForm />
              </Suspense>
            } />
            <Route path="customers" element={
              <Suspense fallback={<Loading />}>
                <Customers />
              </Suspense>
            } />
            <Route path="customers/:id" element={
              <Suspense fallback={<Loading />}>
                <CustomerDetails />
              </Suspense>
            } />
            <Route path="delivery-agents" element={
              <Suspense fallback={<Loading />}>
                <DeliveryAgents />
              </Suspense>
            } />
            <Route path="customer-reps" element={
              <Suspense fallback={<Loading />}>
                <CustomerReps />
              </Suspense>
            } />
            <Route path="financial" element={
              <Suspense fallback={<Loading />}>
                <Financial />
              </Suspense>
            } />
            <Route path="analytics" element={
              <RoleGuard allowedRoles={['super_admin', 'admin', 'manager', 'accountant']}>
                <Suspense fallback={<Loading />}>
                  <Analytics />
                </Suspense>
              </RoleGuard>
            } />
            <Route path="workflows" element={
              <Suspense fallback={<Loading />}>
                <Workflows />
              </Suspense>
            } />
            <Route path="workflows/new" element={
              <Suspense fallback={<Loading />}>
                <WorkflowWizard />
              </Suspense>
            } />
            <Route path="workflows/:id" element={
              <Suspense fallback={<Loading />}>
                <WorkflowWizard />
              </Suspense>
            } />
            <Route path="settings" element={
              <Suspense fallback={<Loading />}>
                <Settings />
              </Suspense>
            } />
            <Route path="checkout-forms" element={
              <Suspense fallback={<Loading />}>
                <CheckoutForms />
              </Suspense>
            } />
            <Route path="webhooks" element={
              <RoleGuard allowedRoles={['super_admin', 'admin']}>
                <Suspense fallback={<Loading />}>
                  <Webhooks />
                </Suspense>
              </RoleGuard>
            } />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toast />
    </ErrorBoundary>
  );
}

export default App;
