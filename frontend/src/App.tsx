import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Shell } from './components/shell/Shell';
import { Toast } from './components/ui/Toast';
import { Loading } from './components/ui/Loading';
import { ToastProvider } from './components/ui-v2';
import { UpdatePrompt } from './components/pwa/UpdatePrompt';
import { AccessGate } from './components/shell/AccessGate';
import { canOpenPath, isManagerUp } from './components/shell/navModel';
import { useConfigStore } from './stores/configStore';
import { isPlatformDomain, platformLoginPath } from './utils/platformDomain';
import { SaasRoute } from './components/auth/SaasRoute';
import { NotFound } from './pages/NotFound';

// Eager load authentication pages (critical path)
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Onboarding } from './pages/Onboarding';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { DynamicDashboard } from './pages/DynamicDashboard';
import { Dashboard } from './pages/Dashboard';
import { SettingsTabRedirect } from './pages/settings/SettingsTabRedirect';
// Lazy load all other pages for better initial load performance
const Pricing = lazy(() => import('./pages/Pricing').then(m => ({ default: m.Pricing })));
const OrdersRoute = lazy(() => import('./pages/orders/OrdersRoute').then(m => ({ default: m.OrdersRoute })));
const Products = lazy(() => import('./pages/Products').then(m => ({ default: m.Products })));
const ProductForm = lazy(() => import('./pages/ProductForm').then(m => ({ default: m.ProductForm })));
const Customers = lazy(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const CustomerDetails = lazy(() => import('./pages/CustomerDetails').then(m => ({ default: m.CustomerDetails })));
const Deliveries = lazy(() => import('./pages/Deliveries').then(m => ({ default: m.Deliveries })));
const CustomerReps = lazy(() => import('./pages/CustomerReps').then(m => ({ default: m.CustomerReps })));
const Financial = lazy(() => import('./pages/Financial').then(m => ({ default: m.Financial })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const Workflows = lazy(() => import('./pages/Workflows').then(m => ({ default: m.Workflows })));
const WorkflowWizard = lazy(() => import('./pages/WorkflowWizard').then(m => ({ default: m.WorkflowWizard })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const CheckoutForms = lazy(() => import('./pages/CheckoutForms').then(m => ({ default: m.CheckoutForms })));
const CheckoutFormEditor = lazy(() => import('./pages/CheckoutFormEditor').then(m => ({ default: m.CheckoutFormEditor })));
const CheckoutFormPreview = lazy(() => import('./pages/CheckoutFormPreview').then(m => ({ default: m.CheckoutFormPreview })));
const Webhooks = lazy(() => import('./pages/Webhooks').then(m => ({ default: m.Webhooks })));
const PublicCheckout = lazy(() => import('./pages/PublicCheckout').then(m => ({ default: m.PublicCheckout })));
const PaymentCallback = lazy(() => import('./pages/PaymentCallback').then(m => ({ default: m.PaymentCallback })));
// Dev-only design-system gallery. The DEV flag is replaced at build time, so production bundles drop the import.
const UiGallery = import.meta.env.DEV ? lazy(() => import('./pages/dev/UiGallery')) : null;
const EarningsHistory = lazy(() => import('./pages/EarningsHistory'));
const AgentMyInventory = lazy(() => import('./pages/AgentMyInventory'));
const AgentInventoryManagement = lazy(() => import('./pages/AgentInventoryManagement'));
const Communications = lazy(() => import('./pages/Communications'));
const SubscriptionCallback = lazy(() => import('./pages/SubscriptionCallback').then(m => ({ default: m.SubscriptionCallback })));
const PlatformLogin = lazy(() => import('./pages/PlatformLogin').then(m => ({ default: m.PlatformLogin })));
const PlatformDashboard = lazy(() => import('./pages/PlatformDashboard').then(m => ({ default: m.PlatformDashboard })));
const PlatformTenants = lazy(() => import('./pages/PlatformTenants').then(m => ({ default: m.PlatformTenants })));
const PlatformTenantDetail = lazy(() => import('./pages/PlatformTenantDetail').then(m => ({ default: m.PlatformTenantDetail })));
const PlatformAnnouncements = lazy(() => import('./pages/PlatformAnnouncements').then(m => ({ default: m.PlatformAnnouncements })));
const PlatformBilling = lazy(() => import('./pages/PlatformBilling').then(m => ({ default: m.PlatformBilling })));

// Platform admin layout (sidebar + outlet for the platform subdomain tree)
const PlatformLayout = lazy(() => import('./components/layout/PlatformLayout').then(m => ({ default: m.PlatformLayout })));

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

// Legacy /m pages (retired in M10-T08). They need the same access as the agent stock page, which the menu decides.
const MobileGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, menu, homeRoute } = useAuthStore();
  if (!user || !menu || !canOpenPath('/agent-inventory', menu, user.role, homeRoute)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

// Wraps a platform admin page with guard + suspense for use in the tenant domain tree
const platformRoute = (Component: React.ComponentType) => (
  <PlatformGuard>
    <Suspense fallback={<Loading />}><Component /></Suspense>
  </PlatformGuard>
);

const PlatformGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated || !user?.isPlatformAdmin) {
    return <Navigate to={platformLoginPath()} replace />;
  }

  return <>{children}</>;
};

// Owner, admin and manager see the owner Dashboard (M3-T41, F-210); the API trims the blocks a manager may not see.
// Finance clerk and stock keeper never get here: AccessGate sends "/" to their home. Call reps and delivery agents keep the
// old per-role dashboard (DynamicDashboard with salesRepConfig / deliveryAgentConfig) until the rep app (M7) and the agent
// app (M10) ship; the plan never leaves them on a placeholder.

// Platform admins have no tenant store — land them on the platform tree instead of
// the tenant dashboard. On the platform subdomain this never fires (separate router);
// on the main domain it keeps their landing consistent with their (platform-only) menu.
const DashboardIndex: React.FC = () => {
  const { user } = useAuthStore();
  if (user?.isPlatformAdmin) return <Navigate to="/platform" replace />;
  if (user && isManagerUp(user.role)) return <Dashboard />;
  return <DynamicDashboard />;
};

// "/m" is the delivery agent's mobile home. Owner roles that open it by hand go to their Dashboard.
const MobileIndex: React.FC = () => {
  const { user } = useAuthStore();
  if (user && isManagerUp(user.role)) return <Navigate to="/" replace />;
  return <DynamicDashboard />;
};

function App() {
  const { isAuthenticated, refreshPermissions } = useAuthStore();
  const { fetchConfig } = useConfigStore();

  useEffect(() => {
    fetchConfig();

    if (isAuthenticated) {
      refreshPermissions();
      useAuthStore.getState().initSocket();
    }
  }, [isAuthenticated, refreshPermissions, fetchConfig]);

  // Platform subdomain — show only platform admin routes, wrapped in PlatformLayout
  if (isPlatformDomain()) {
    return (
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={
              <Suspense fallback={<Loading />}><PlatformLogin /></Suspense>
            } />
            <Route
              path="/"
              element={
                <PlatformGuard>
                  <Suspense fallback={<Loading />}><PlatformLayout /></Suspense>
                </PlatformGuard>
              }
            >
              <Route index element={<Suspense fallback={<Loading />}><PlatformDashboard /></Suspense>} />
              <Route path="tenants" element={<Suspense fallback={<Loading />}><PlatformTenants /></Suspense>} />
              <Route path="tenants/:id" element={<Suspense fallback={<Loading />}><PlatformTenantDetail /></Suspense>} />
              <Route path="announcements" element={<Suspense fallback={<Loading />}><PlatformAnnouncements /></Suspense>} />
              <Route path="billing" element={<Suspense fallback={<Loading />}><PlatformBilling /></Suspense>} />
            </Route>
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          <Toast />
        </BrowserRouter>
      </ErrorBoundary>
    );
  }

  // Main tenant domain — full app
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Public routes - no authentication required */}
          <Route path="/form/:slug" element={
            <Suspense fallback={<Loading />}>
              <PublicCheckout />
            </Suspense>
          } />
          <Route path="/pricing" element={
            <SaasRoute>
              <Suspense fallback={<Loading />}>
                <Pricing />
              </Suspense>
            </SaasRoute>
          } />
          {/* The slug path is what the checkout gives the provider; the bare path stays for older payment links. */}
          {['/checkout/payment/callback', '/checkout/payment/callback/:formSlug'].map((path) => (
            <Route key={path} path={path} element={
              <Suspense fallback={<Loading />}>
                <PaymentCallback />
              </Suspense>
            } />
          ))}
          {UiGallery && (
            <Route path="/dev/ui-v2" element={<Suspense fallback={<Loading />}><UiGallery /></Suspense>} />
          )}
          {/* Auth routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<SaasRoute><Register /></SaasRoute>} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* Platform login on main domain — used by PlatformGuard redirect in local dev */}
          <Route path="/platform/login" element={
            <Suspense fallback={<Loading />}><PlatformLogin /></Suspense>
          } />
          <Route path="/onboarding" element={
            <ProtectedRoute skipOnboardingCheck>
              <Onboarding />
            </ProtectedRoute>
          } />
          {/* Admin-only preview route — bare shell so the editor iframe
              doesn't render the sidebar/header inside itself. Auth is
              enforced by the backend /preview-config endpoint. */}
          <Route element={<ProtectedRoute><AccessGate as="/checkout-forms" /></ProtectedRoute>}>
            <Route path="/checkout-forms/:id/preview" element={
              <Suspense fallback={<Loading />}><CheckoutFormPreview /></Suspense>
            } />
          </Route>
          {/* Mobile routes for delivery agents */}
          <Route
            path="/m"
            element={
              <ProtectedRoute>
                <MobileGate>
                  <Suspense fallback={<Loading />}>
                    <MobileLayout />
                  </Suspense>
                </MobileGate>
              </ProtectedRoute>
            }
          >
            <Route index element={<MobileIndex />} />
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
            {/* TODO: replace with mobile-optimized Settings. The new Settings is a v2 page, so it brings the v2 scope and toasts with it. */}
            <Route path="settings" element={
              <Suspense fallback={<Loading />}><ToastProvider><div className="v2"><Settings /></div></ToastProvider></Suspense>
            } />
          </Route>

          {/* Desktop routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Shell />
              </ProtectedRoute>
            }
          >
            <Route path="financial" element={<Navigate to="/finance" replace />} />
            {/* The old Analytics page is gone (M3-T60): old links and bookmarks land on Reports. */}
            <Route path="analytics" element={<Navigate to="/reports" replace />} />
            {/* /connections is the future Connections page (M9); until then it opens Integrations with its query (M3-T66). */}
            <Route path="connections" element={<SettingsTabRedirect tab="integrations" />} />
            {/* Every page below needs its menu item (F-102); platform pages use PlatformGuard instead. */}
            <Route element={<AccessGate />}>
            <Route index element={<DashboardIndex />} />
            <Route path="orders/:id?" element={
              <Suspense fallback={<Loading />}><OrdersRoute /></Suspense>
            } />
            <Route path="products" element={
              <Suspense fallback={<Loading />}><Products /></Suspense>
            } />
            <Route path="products/new" element={
              <Suspense fallback={<Loading />}><ProductForm /></Suspense>
            } />
            <Route path="products/:id/edit" element={
              <Suspense fallback={<Loading />}><ProductForm /></Suspense>
            } />
            <Route path="customers" element={
              <Suspense fallback={<Loading />}><Customers /></Suspense>
            } />
            <Route path="customers/:id" element={
              <Suspense fallback={<Loading />}><CustomerDetails /></Suspense>
            } />
            <Route path="delivery-agents" element={
              <Suspense fallback={<Loading />}><Deliveries /></Suspense>
            } />
            <Route path="customer-reps" element={
              <Suspense fallback={<Loading />}><CustomerReps /></Suspense>
            } />
            <Route path="finance" element={
              <Suspense fallback={<Loading />}><Financial /></Suspense>
            } />
            <Route path="reports" element={
              <Suspense fallback={<Loading />}><Reports /></Suspense>
            } />
            <Route path="workflows" element={
              <Suspense fallback={<Loading />}><Workflows /></Suspense>
            } />
            <Route path="workflows/new" element={
              <Suspense fallback={<Loading />}><WorkflowWizard /></Suspense>
            } />
            <Route path="workflows/:id" element={
              <Suspense fallback={<Loading />}><WorkflowWizard /></Suspense>
            } />
            <Route path="communications" element={
              <Suspense fallback={<Loading />}><Communications /></Suspense>
            } />
            <Route path="settings" element={
              <Suspense fallback={<Loading />}><Settings /></Suspense>
            } />
            {/* Billing is a Settings tab now (M3-T65); old links and the Paystack return land there. */}
            <Route path="settings/billing" element={<SettingsTabRedirect tab="billing" />} />
            <Route path="settings/billing/callback" element={
              <SaasRoute><Suspense fallback={<Loading />}><SubscriptionCallback /></Suspense></SaasRoute>
            } />
            <Route path="checkout-forms" element={
              <Suspense fallback={<Loading />}><CheckoutForms /></Suspense>
            } />
            <Route path="checkout-forms/new" element={
              <Suspense fallback={<Loading />}><CheckoutFormEditor /></Suspense>
            } />
            <Route path="checkout-forms/:id/edit" element={
              <Suspense fallback={<Loading />}><CheckoutFormEditor /></Suspense>
            } />
            <Route path="webhooks" element={
              <Suspense fallback={<Loading />}><Webhooks /></Suspense>
            } />
            <Route path="agent-inventory" element={
              <Suspense fallback={<Loading />}><AgentInventoryRoute /></Suspense>
            } />
            <Route path="earnings-history" element={
              <Suspense fallback={<Loading />}><EarningsHistory /></Suspense>
            } />
            </Route>
            <Route path="platform" element={platformRoute(PlatformDashboard)} />
            <Route path="platform/tenants" element={platformRoute(PlatformTenants)} />
            <Route path="platform/tenants/:id" element={platformRoute(PlatformTenantDetail)} />
            <Route path="platform/announcements" element={platformRoute(PlatformAnnouncements)} />
            <Route path="platform/billing" element={platformRoute(PlatformBilling)} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toast />
      <UpdatePrompt />
    </ErrorBoundary>
  );
}

export default App;
