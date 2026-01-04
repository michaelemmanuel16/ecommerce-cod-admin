-- E-Commerce COD Admin Dashboard - Initial Database Schema
-- Migration: 001_initial_schema.sql
-- Created: 2025-10-07

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types (enums)
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'customer_rep', 'delivery_agent', 'accountant');
CREATE TYPE availability_status AS ENUM ('available', 'busy', 'offline');
CREATE TYPE order_status AS ENUM (
    'new',
    'confirmation_pending',
    'confirmed',
    'being_prepared',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'returned',
    'cancelled'
);
CREATE TYPE priority_level AS ENUM ('high', 'medium', 'low');
CREATE TYPE payment_status AS ENUM ('pending', 'collected', 'refunded');
CREATE TYPE payment_method AS ENUM ('COD', 'bank_transfer', 'cash');
CREATE TYPE order_source AS ENUM ('manual', 'webhook', 'csv', 'api');
CREATE TYPE transaction_type AS ENUM ('revenue', 'expense', 'refund');
CREATE TYPE workflow_trigger AS ENUM ('webhook', 'order_status', 'customer_tag', 'time_based', 'manual');
CREATE TYPE execution_status AS ENUM ('running', 'completed', 'failed');
CREATE TYPE webhook_source AS ENUM ('shopify', 'woocommerce', 'custom', 'other');
CREATE TYPE notification_type AS ENUM ('order', 'delivery', 'system', 'workflow', 'alert');

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role user_role NOT NULL,
    permissions JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    availability_status availability_status DEFAULT 'offline',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users table
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_availability ON users(availability_status);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================================
-- CUSTOMERS TABLE
-- ============================================================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    area VARCHAR(100),
    postal_code VARCHAR(20),
    tags JSONB DEFAULT '[]'::jsonb,
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(12, 2) DEFAULT 0.00,
    return_rate DECIMAL(5, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for customers table
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_area ON customers(area);
CREATE INDEX idx_customers_city ON customers(city);
CREATE INDEX idx_customers_tags ON customers USING GIN(tags);
CREATE INDEX idx_customers_created_at ON customers(created_at DESC);
CREATE INDEX idx_customers_total_orders ON customers(total_orders DESC);
CREATE INDEX idx_customers_total_spent ON customers(total_spent DESC);

-- ============================================================================
-- PRODUCTS TABLE
-- ============================================================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    category VARCHAR(100),
    price DECIMAL(12, 2) NOT NULL,
    cogs DECIMAL(12, 2),
    stock_quantity INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 10,
    variants JSONB DEFAULT '[]'::jsonb,
    images JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for products table
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_is_active ON products(is_active);
CREATE INDEX idx_products_stock_quantity ON products(stock_quantity);
CREATE INDEX idx_products_name ON products USING GIN(to_tsvector('english', name));
CREATE INDEX idx_products_variants ON products USING GIN(variants);

-- ============================================================================
-- ORDERS TABLE
-- ============================================================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    assigned_rep_id UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status order_status DEFAULT 'new',
    priority priority_level DEFAULT 'medium',
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    subtotal DECIMAL(12, 2) NOT NULL,
    delivery_fee DECIMAL(12, 2) DEFAULT 0.00,
    total_amount DECIMAL(12, 2) NOT NULL,
    payment_status payment_status DEFAULT 'pending',
    payment_method payment_method DEFAULT 'COD',
    customer_notes TEXT,
    internal_notes TEXT,
    delivery_address TEXT NOT NULL,
    delivery_area VARCHAR(100),
    source order_source DEFAULT 'manual',
    webhook_source VARCHAR(100),
    delivery_proof JSONB DEFAULT '{}'::jsonb,
    return_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for orders table
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_assigned_rep_id ON orders(assigned_rep_id);
CREATE INDEX idx_orders_assigned_agent_id ON orders(assigned_agent_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_priority ON orders(priority);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_delivery_area ON orders(delivery_area);
CREATE INDEX idx_orders_source ON orders(source);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_delivered_at ON orders(delivered_at DESC);
CREATE INDEX idx_orders_items ON orders USING GIN(items);
-- Composite indexes for common queries
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX idx_orders_agent_status ON orders(assigned_agent_id, status) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX idx_orders_rep_status ON orders(assigned_rep_id, status) WHERE assigned_rep_id IS NOT NULL;
CREATE INDEX idx_orders_area_status ON orders(delivery_area, status);

-- ============================================================================
-- ORDER_HISTORY TABLE
-- ============================================================================
CREATE TABLE order_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    old_status order_status,
    new_status order_status NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for order_history table
CREATE INDEX idx_order_history_order_id ON order_history(order_id);
CREATE INDEX idx_order_history_user_id ON order_history(changed_by_user_id);
CREATE INDEX idx_order_history_created_at ON order_history(created_at DESC);
CREATE INDEX idx_order_history_new_status ON order_history(new_status);

-- ============================================================================
-- DELIVERIES TABLE
-- ============================================================================
CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    pickup_time TIMESTAMP WITH TIME ZONE,
    delivery_time TIMESTAMP WITH TIME ZONE,
    route_data JSONB DEFAULT '{}'::jsonb,
    proof_of_delivery JSONB DEFAULT '{}'::jsonb,
    signature_url VARCHAR(500),
    photo_url VARCHAR(500),
    customer_feedback TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for deliveries table
CREATE INDEX idx_deliveries_order_id ON deliveries(order_id);
CREATE INDEX idx_deliveries_agent_id ON deliveries(agent_id);
CREATE INDEX idx_deliveries_pickup_time ON deliveries(pickup_time);
CREATE INDEX idx_deliveries_delivery_time ON deliveries(delivery_time);
CREATE INDEX idx_deliveries_rating ON deliveries(rating);
CREATE INDEX idx_deliveries_agent_delivery_time ON deliveries(agent_id, delivery_time DESC);

-- ============================================================================
-- EXPENSES TABLE
-- ============================================================================
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(100) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    description TEXT,
    receipt_url VARCHAR(500),
    recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for expenses table
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_date ON expenses(date DESC);
CREATE INDEX idx_expenses_recorded_by ON expenses(recorded_by_user_id);
CREATE INDEX idx_expenses_created_at ON expenses(created_at DESC);

-- ============================================================================
-- FINANCIAL_TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE financial_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    type transaction_type NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    method payment_method DEFAULT 'COD',
    recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for financial_transactions table
CREATE INDEX idx_financial_transactions_order_id ON financial_transactions(order_id);
CREATE INDEX idx_financial_transactions_type ON financial_transactions(type);
CREATE INDEX idx_financial_transactions_date ON financial_transactions(date DESC);
CREATE INDEX idx_financial_transactions_recorded_by ON financial_transactions(recorded_by_user_id);
CREATE INDEX idx_financial_transactions_method ON financial_transactions(method);
CREATE INDEX idx_financial_transactions_created_at ON financial_transactions(created_at DESC);

-- ============================================================================
-- WORKFLOWS TABLE
-- ============================================================================
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_type workflow_trigger NOT NULL,
    trigger_config JSONB DEFAULT '{}'::jsonb,
    workflow_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for workflows table
CREATE INDEX idx_workflows_trigger_type ON workflows(trigger_type);
CREATE INDEX idx_workflows_is_active ON workflows(is_active);
CREATE INDEX idx_workflows_created_by ON workflows(created_by_user_id);
CREATE INDEX idx_workflows_trigger_config ON workflows USING GIN(trigger_config);

-- ============================================================================
-- WORKFLOW_EXECUTIONS TABLE
-- ============================================================================
CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    status execution_status DEFAULT 'running',
    steps_completed JSONB DEFAULT '[]'::jsonb,
    error_log JSONB DEFAULT '[]'::jsonb,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for workflow_executions table
CREATE INDEX idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);
CREATE INDEX idx_workflow_executions_order_id ON workflow_executions(order_id);
CREATE INDEX idx_workflow_executions_customer_id ON workflow_executions(customer_id);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX idx_workflow_executions_started_at ON workflow_executions(started_at DESC);

-- ============================================================================
-- WEBHOOKS TABLE
-- ============================================================================
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    source webhook_source NOT NULL,
    api_key VARCHAR(255),
    secret_key VARCHAR(255),
    endpoint_url VARCHAR(500) NOT NULL,
    field_mapping JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for webhooks table
CREATE INDEX idx_webhooks_source ON webhooks(source);
CREATE INDEX idx_webhooks_is_active ON webhooks(is_active);
CREATE INDEX idx_webhooks_endpoint_url ON webhooks(endpoint_url);

-- ============================================================================
-- WEBHOOK_LOGS TABLE
-- ============================================================================
CREATE TABLE webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    webhook_id UUID REFERENCES webhooks(id) ON DELETE SET NULL,
    request_payload JSONB NOT NULL,
    response_status INTEGER,
    order_created_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for webhook_logs table
CREATE INDEX idx_webhook_logs_webhook_id ON webhook_logs(webhook_id);
CREATE INDEX idx_webhook_logs_order_created_id ON webhook_logs(order_created_id);
CREATE INDEX idx_webhook_logs_created_at ON webhook_logs(created_at DESC);
CREATE INDEX idx_webhook_logs_response_status ON webhook_logs(response_status);
CREATE INDEX idx_webhook_logs_payload ON webhook_logs USING GIN(request_payload);

-- ============================================================================
-- NOTIFICATIONS TABLE
-- ============================================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for notifications table
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);

-- ============================================================================
-- ACTIVITY_LOGS TABLE
-- ============================================================================
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for activity_logs table
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_user_created ON activity_logs(user_id, created_at DESC);

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token VARCHAR(500) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for sessions table
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_refresh_token ON sessions(refresh_token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- ============================================================================

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at column
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deliveries_updated_at BEFORE UPDATE ON deliveries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TRIGGER TO AUTO-UPDATE CUSTOMER STATISTICS
-- ============================================================================

-- Function to update customer statistics when orders change
CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE customers
        SET
            total_orders = (
                SELECT COUNT(*)
                FROM orders
                WHERE customer_id = NEW.customer_id
                AND status != 'cancelled'
            ),
            total_spent = (
                SELECT COALESCE(SUM(total_amount), 0)
                FROM orders
                WHERE customer_id = NEW.customer_id
                AND status = 'delivered'
                AND payment_status = 'collected'
            ),
            return_rate = (
                SELECT CASE
                    WHEN COUNT(*) = 0 THEN 0
                    ELSE (COUNT(*) FILTER (WHERE status = 'returned')::DECIMAL / COUNT(*)::DECIMAL * 100)
                END
                FROM orders
                WHERE customer_id = NEW.customer_id
            )
        WHERE id = NEW.customer_id;
    END IF;

    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_customer_stats_trigger
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION update_customer_stats();

-- ============================================================================
-- TRIGGER TO AUTO-CREATE ORDER HISTORY
-- ============================================================================

-- Function to log order status changes
CREATE OR REPLACE FUNCTION log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_history (order_id, old_status, new_status, notes)
        VALUES (NEW.id, OLD.status, NEW.status, 'Status changed automatically');
    END IF;

    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER log_order_status_change_trigger
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION log_order_status_change();

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View for order details with customer and assigned user information
CREATE VIEW order_details_view AS
SELECT
    o.id,
    o.order_number,
    o.status,
    o.priority,
    o.total_amount,
    o.payment_status,
    o.delivery_area,
    o.created_at,
    o.delivered_at,
    c.full_name AS customer_name,
    c.phone AS customer_phone,
    c.email AS customer_email,
    rep.full_name AS assigned_rep_name,
    agent.full_name AS assigned_agent_name,
    agent.availability_status AS agent_availability
FROM orders o
LEFT JOIN customers c ON o.customer_id = c.id
LEFT JOIN users rep ON o.assigned_rep_id = rep.id
LEFT JOIN users agent ON o.assigned_agent_id = agent.id;

-- View for delivery agent performance metrics
CREATE VIEW agent_performance_view AS
SELECT
    u.id AS agent_id,
    u.full_name,
    u.availability_status,
    COUNT(d.id) AS total_deliveries,
    AVG(d.rating) AS average_rating,
    COUNT(d.id) FILTER (WHERE d.delivery_time IS NOT NULL) AS completed_deliveries,
    COUNT(o.id) FILTER (WHERE o.status = 'delivered') AS successful_orders
FROM users u
LEFT JOIN deliveries d ON u.id = d.agent_id
LEFT JOIN orders o ON u.id = o.assigned_agent_id
WHERE u.role = 'delivery_agent'
GROUP BY u.id, u.full_name, u.availability_status;

-- View for daily financial summary
CREATE VIEW daily_financial_summary AS
SELECT
    date,
    SUM(CASE WHEN type = 'revenue' THEN amount ELSE 0 END) AS total_revenue,
    SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expenses,
    SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) AS total_refunds,
    SUM(CASE WHEN type = 'revenue' THEN amount ELSE 0 END) -
    SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) -
    SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) AS net_profit
FROM financial_transactions
GROUP BY date
ORDER BY date DESC;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE users IS 'Admin users including managers, customer reps, delivery agents, and accountants';
COMMENT ON TABLE customers IS 'End customers who place orders';
COMMENT ON TABLE products IS 'Product catalog with variants and inventory tracking';
COMMENT ON TABLE orders IS 'Main orders table with comprehensive tracking';
COMMENT ON TABLE order_history IS 'Audit trail for all order status changes';
COMMENT ON TABLE deliveries IS 'Delivery tracking with proof and customer feedback';
COMMENT ON TABLE expenses IS 'Business expenses for financial tracking';
COMMENT ON TABLE financial_transactions IS 'All financial transactions including revenue, expenses, and refunds';
COMMENT ON TABLE workflows IS 'Automation workflow configurations';
COMMENT ON TABLE workflow_executions IS 'Logs of workflow executions';
COMMENT ON TABLE webhooks IS 'Webhook configurations for external integrations';
COMMENT ON TABLE webhook_logs IS 'Logs of incoming webhook requests';
COMMENT ON TABLE notifications IS 'In-app notifications for users';
COMMENT ON TABLE activity_logs IS 'User activity tracking for audit purposes';
COMMENT ON TABLE sessions IS 'JWT refresh token storage';

-- ============================================================================
-- SAMPLE DATA FOR TESTING (OPTIONAL - Comment out for production)
-- ============================================================================

-- Insert default admin user (password: 'admin123' - hashed with bcrypt)
INSERT INTO users (email, password_hash, full_name, phone, role, is_active, availability_status)
VALUES (
    'admin@example.com',
    '$2a$10$rZ1qVqYqVqYqVqYqVqYqVuZ1qVqYqVqYqVqYqVqYqVqYqVqYqVqY',
    'System Administrator',
    '+1234567890',
    'admin',
    true,
    'available'
);

-- End of migration
