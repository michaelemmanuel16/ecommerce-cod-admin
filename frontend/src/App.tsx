import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/layout/Layout';
import { Toast } from './components/ui/Toast';
import { Loading } from './components/ui/Loading';
import { UpdatePrompt } from './components/pwa/UpdatePrompt';
import { OnboardingProvider } from './components/onboarding';
import { CustomerRepOnboarding, OnboardingWelcomeModal } from './components/onboarding';
import { useIsMobile } from './hooks/useIsMobile';
import { DESKTOP_FLAG, MOBILE_OPT_IN } from './constants/mobile';
import { useConfigStore } from './stores/configStore';

// Eager load authentication pages (critical path)
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Onboarding } from './pages/Onboarding';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
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
const PaymentCallback = lazy(() => import('./pages/PaymentCallback').then(m => ({ default: m.PaymentCallback })));
const EarningsHistory = lazy(() => import('./pages/EarningsHistory'));
const AgentMyInventory = lazy(() => import('./pages/AgentMyInventory'));
const AgentInventoryManagement = lazy(() => import('./pages/AgentInventoryManagement'));
const Communications = lazy(() => import('./pages/Communications'));
const Billing = lazy(() => import('./pages/Billing').then(m => ({ default: m.Billing })));
const PlatformDashboard = lazy(() => import('./pages/PlatformDashboard').then(m => ({ default: m.PlatformDashboard })));
const PlatformTenants = lazy(() => import('./pages/PlatformTenants').then(m => ({ default: m.PlatformTenants })));
const PlatformTenantDetail = lazy(() => import('./pages/PlatformTenantDetail').then(m => ({ default: m.PlatformTenantDetail })));
const PlatformAnnouncements = lazy(() => import('./pages/PlatformAnnouncements').then(m => ({ default: m.PlatformAnnouncements })));

// Mobile pages
const MobileLayout = lazy(() => import('./components/layout/MobileLayout').then(m => ({ default: m.MobileLayout })));
const MobileDeliveries = lazy(() => import('./pages/mobile/MobileDeliveries'));
const MobileDeliveryDetail = lazy(() => import('./pages/mobile/MobileDeliveryDetail'));
const MobileCollections = lazy(() => import('./pages/mobile/MobileCollections'));

const AgentInventoryRoute: React.FC = () => {
  const { user } = useAuthStore();
  if (user?.role === 'delivery_agent') {
    return <AgentMyInventory />;
  }
  return <AgentInventoryManagement />;
};

const ProtectedRoute: React.FC<{ children: React.ReactNode; skipOnboardingCheck?: boolean }> = ({ children, skipOnboardingCheck }) => {
  const { isAuthenticated, needsOnboarding } = useAuthStore();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!skipOnboardingCheck && needsOnboarding() && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
};

const RoleGuard: React.FC<{ children: React.ReactNode; allowedRoles: string[] }> = ({ children, allowedRoles }) => {
  const { user } = useAuthStore();

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const MobileRedirect: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const location = useLocation();

  // Only auto-redirect when the user has explicitly opted in via the "Mobile View"
  // sidebar button (which sets MOBILE_OPT_IN). Without opt-in, mobile agents stay on
  // the desktop view because key mobile pages (Deliveries) are still stubs.
  if (
    user?.role === 'delivery_agent' &&
    isMobile &&
    !location.pathname.startsWith('/m') &&
    localStorage.getItem(DESKTOP_FLAG) !== 'true' &&
    localStorage.getItem(MOBILE_OPT_IN) === 'true'
  ) {
    return <Navigate to="/m/" replace />;
  }

  return <>{children}</>;
};

function App() {
  const { isAuthenticated, refreshPermissions, setupPermissionListener } = useAuthStore();
  const { fetchConfig } = useConfigStore();

  // Refresh permissions and setup socket listener on mount
  useEffect(() => {
    // Always fetch public config (includes business name and currency)
    fetchConfig();

    if (isAuthenticated) {
      // Refresh permissions to ensure they're up to date
      refreshPermissions();

      // Initialize socket connection and listeners
      useAuthStore.getState().initSocket();
    }
  }, [isAuthenticated, refreshPermissions, setupPermissionListener, fetchConfig]);

  return (
    <ErrorBoundary>
      <OnboardingProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes - no authentication required */}
            <Route path="/form/:slug" element={
              <Suspense fallback={<Loading />}>
                <PublicCheckout />
              </Suspense>
            } />
            <Route path="/checkout/payment/callback" element={
              <Suspense fallback={<Loading />}>
                <PaymentCallback />
              </Suspense>
            } />
            {/* Auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={
              <ProtectedRoute skipOnboardingCheck>
                <Onboarding />
              </ProtectedRoute>
            } />
            {/* Mobile routes for delivery agents */}
            <Route
              path="/m"
              element={
                <ProtectedRoute>
                  <RoleGuard allowedRoles={['delivery_agent']}>
                    <Suspense fallback={<Loading />}>
                      <MobileLayout />
                    </Suspense>
                  </RoleGuard>
                </ProtectedRoute>
              }
            >
              <Route index element={<DynamicDashboard />} />
              <Route path="deliveries" element={
                <Suspense fallback={<Loading />}><MobileDeliveries /></Suspense>
              } />
              <Route path="deliveries/:id" element={
                <Suspense fallback={<Loading />}><MobileDeliveryDetail /></Suspense>
              } />
              <Route path="deliveries/order/:orderId" element={
                <Suspense fallback={<Loading />}><MobileDeliveryDetail /></Suspense>
              } />
              <Route path="inventory" element={
                <Suspense fallback={<Loading />}><AgentMyInventory /></Suspense>
              } />
              <Route path="collections" element={
                <Suspense fallback={<Loading />}><MobileCollections /></Suspense>
              } />
              {/* TODO: replace with mobile-optimized Settings */}
              <Route path="settings" element={
                <Suspense fallback={<Loading />}><Settings /></Suspense>
              } />
            </Route>

            {/* Desktop routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <MobileRedirect>
                    <Layout />
                  </MobileRedirect>
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
              <Route path="communications" element={
                <RoleGuard allowedRoles={['super_admin', 'admin', 'manager']}>
                  <Suspense fallback={<Loading />}>
                    <Communications />
                  </Suspense>
                </RoleGuard>
              } />
              <Route path="settings" element={
                <Suspense fallback={<Loading />}>
                  <Settings />
                </Suspense>
              } />
              <Route path="settings/billing" element={
                <Suspense fallback={<Loading />}>
                  <Billing />
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
              <Route path="agent-inventory" element={
                <RoleGuard allowedRoles={['super_admin', 'admin', 'manager', 'inventory_manager', 'delivery_agent']}>
                  <Suspense fallback={<Loading />}>
                    <AgentInventoryRoute />
                  </Suspense>
                </RoleGuard>
              } />
              <Route path="earnings-history" element={
                <RoleGuard allowedRoles={['sales_rep']}>
                  <Suspense fallback={<Loading />}>
                    <EarningsHistory />
                  </Suspense>
                </RoleGuard>
              } />
              <Route path="platform" element={
                <RoleGuard allowedRoles={['super_admin']}>
                  <Suspense fallback={<Loading />}>
                    <PlatformDashboard />
                  </Suspense>
                </RoleGuard>
              } />
              <Route path="platform/tenants" element={
                <RoleGuard allowedRoles={['super_admin']}>
                  <Suspense fallback={<Loading />}>
                    <PlatformTenants />
                  </Suspense>
                </RoleGuard>
              } />
              <Route path="platform/tenants/:id" element={
                <RoleGuard allowedRoles={['super_admin']}>
                  <Suspense fallback={<Loading />}>
                    <PlatformTenantDetail />
                  </Suspense>
                </RoleGuard>
              } />
              <Route path="platform/announcements" element={
                <RoleGuard allowedRoles={['super_admin']}>
                  <Suspense fallback={<Loading />}>
                    <PlatformAnnouncements />
                  </Suspense>
                </RoleGuard>
              } />
            </Route>
          </Routes>
          {/* Onboarding Tour Components - Only visible for sales_rep role */}
          <CustomerRepOnboarding />
          <OnboardingWelcomeModal />
        </BrowserRouter>
        <Toast />
        <UpdatePrompt />
      </OnboardingProvider>
    </ErrorBoundary>
  );
}

export default App;
