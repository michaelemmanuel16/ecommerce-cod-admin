import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { OrdersKanban } from './pages/OrdersKanban';
import { OrdersList } from './pages/OrdersList';
import { OrderDetails } from './pages/OrderDetails';
import { Products } from './pages/Products';
import { ProductForm } from './pages/ProductForm';
import { Customers } from './pages/Customers';
import { CustomerDetails } from './pages/CustomerDetails';
import { DeliveryAgents } from './pages/DeliveryAgents';
import { CustomerReps } from './pages/CustomerReps';
import { Financial } from './pages/Financial';
import { Analytics } from './pages/Analytics';
import { Workflows } from './pages/Workflows';
import { WorkflowEditor } from './pages/WorkflowEditor';
import { Settings } from './pages/Settings';
import { Toast } from './components/ui/Toast';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
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
            <Route index element={<Dashboard />} />
            <Route path="orders" element={<OrdersKanban />} />
            <Route path="orders/list" element={<OrdersList />} />
            <Route path="orders/:id" element={<OrderDetails />} />
            <Route path="products" element={<Products />} />
            <Route path="products/new" element={<ProductForm />} />
            <Route path="products/:id/edit" element={<ProductForm />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerDetails />} />
            <Route path="delivery-agents" element={<DeliveryAgents />} />
            <Route path="customer-reps" element={<CustomerReps />} />
            <Route path="financial" element={<Financial />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="workflows" element={<Workflows />} />
            <Route path="workflows/:id" element={<WorkflowEditor />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toast />
    </>
  );
}

export default App;
