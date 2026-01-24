import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LayoutGrid, List, Filter, Plus, Edit2, Eye, Trash2, ArrowUp, ArrowDown, Phone, Download, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { SearchBar } from '../components/common/SearchBar';
import { FilterPanel } from '../components/common/FilterPanel';
import { Button } from '../components/ui/Button';
import { Pagination } from '../components/ui/Pagination';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { OrderForm } from '../components/forms/OrderForm';
import { LogCallModal } from '../components/calls/LogCallModal';
import { BulkImportModal } from '../components/orders/BulkImportModal';
import { useOrdersStore } from '../stores/ordersStore';
import { useAuthStore } from '../stores/authStore';
import { usePermissions } from '../hooks/usePermissions';
import { Order, OrderStatus } from '../types';
import { ordersService } from '../services/orders.service';
import toast from 'react-hot-toast';
import { formatCurrency } from '../utils/format';
import { getSocket } from '../services/socket';

type ViewMode = 'kanban' | 'list';
type SortField = 'id' | 'customerName' | 'totalAmount' | 'createdAt' | 'status';
type SortDirection = 'asc' | 'desc';

const statusLabels: Record<OrderStatus, string> = {
  pending_confirmation: 'Pending Confirmation',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready for Pickup',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  failed_delivery: 'Failed Delivery',
};

const statusColors: Record<OrderStatus, string> = {
  pending_confirmation: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  preparing: 'bg-purple-100 text-purple-800',
  ready_for_pickup: 'bg-cyan-100 text-cyan-800',
  out_for_delivery: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  returned: 'bg-orange-100 text-orange-800',
  failed_delivery: 'bg-red-100 text-red-800',
};

const statusOptions: { value: OrderStatus; label: string }[] = [
  { value: 'pending_confirmation', label: 'Pending Confirmation' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready_for_pickup', label: 'Ready for Pickup' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'returned', label: 'Returned' },
  { value: 'failed_delivery', label: 'Failed Delivery' },
];

export const Orders: React.FC = () => {
  const navigate = useNavigate();
  const { user, updatePreferences } = useAuthStore();
  const { can } = usePermissions();
  const [viewMode, setViewMode] = useState<ViewMode>(user?.preferences?.ordersDefaultView || 'list');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isOrderFormOpen, setIsOrderFormOpen] = useState(false);
  const [selectedOrderForEdit, setSelectedOrderForEdit] = useState<Order | null>(null);
  const [isLogCallModalOpen, setIsLogCallModalOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedOrderForCall, setSelectedOrderForCall] = useState<Order | null>(null);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());

  // Load column widths from localStorage or use defaults
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: number }>(() => {
    const saved = localStorage.getItem('orders-column-widths');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fall through to defaults
      }
    }
    return {
      checkbox: 48,
      id: 120,
      customerName: 150,
      phone: 120,
      altPhone: 120,
      address: 250,
      products: 250,
      amount: 100,
      status: 220,
      date: 120,
      actions: 120,
    };
  });
  const resizingColumn = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);
  const { orders, pagination, filters, fetchOrders, updateOrderStatus, setPage, setPageSize, setFilters } = useOrdersStore();

  useEffect(() => {
    fetchOrders();

    // Setup real-time listeners
    const socket = getSocket();
    if (socket) {
      const handleOrderCreated = (newOrder: any) => {
        console.log('Real-time order created:', newOrder);
        // We could either refresh everything or add the new order to the top
        // For simplicity and correctness with filters, let's refresh
        fetchOrders();
      };

      const handleOrderStatusChanged = (data: any) => {
        console.log('Real-time status changed:', data);
        fetchOrders();
      };

      const handleOrderUpdated = (data: any) => {
        console.log('Real-time order updated:', data);
        fetchOrders();
      };

      socket.on('order:created', handleOrderCreated);
      socket.on('order:status_changed', handleOrderStatusChanged);
      socket.on('order:updated', handleOrderUpdated);

      return () => {
        socket.off('order:created', handleOrderCreated);
        socket.off('order:status_changed', handleOrderStatusChanged);
        socket.off('order:updated', handleOrderUpdated);
      };
    }
  }, [fetchOrders]);

  // Save column widths to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('orders-column-widths', JSON.stringify(columnWidths));
  }, [columnWidths]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedOrders = useMemo(() => {
    const sorted = [...orders].sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'totalAmount') {
        aVal = Number(a.totalAmount);
        bVal = Number(b.totalAmount);
      } else if (sortField === 'createdAt') {
        aVal = new Date(a.createdAt).getTime();
        bVal = new Date(b.createdAt).getTime();
      } else if (sortField === 'id' || sortField === 'customerName' || sortField === 'status') {
        aVal = sortField === 'id' ? a.id : String(aVal).toLowerCase();
        bVal = sortField === 'id' ? b.id : String(bVal).toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [orders, sortField, sortDirection]);

  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-4 h-4 inline ml-1" />
    ) : (
      <ArrowDown className="w-4 h-4 inline ml-1" />
    );
  };

  const ResizableHeader: React.FC<{
    columnKey: string;
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }> = ({ columnKey, children, onClick, className }) => (
    <th
      className={className}
      style={{ width: columnWidths[columnKey], minWidth: columnWidths[columnKey], maxWidth: columnWidths[columnKey], position: 'relative', userSelect: 'none' }}
    >
      <div onClick={onClick} className="flex items-center">
        {children}
      </div>
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 active:bg-blue-600 transition-colors"
        style={{ marginRight: '-2px' }}
        onMouseDown={(e) => handleMouseDown(columnKey, e)}
        onClick={(e) => e.stopPropagation()}
      />
    </th>
  );

  const handleSearch = (query: string) => {
    setFilters({
      ...filters,
      search: query,
    });
  };

  const handleDateRangeChange = (startDate: string | undefined, endDate: string | undefined) => {
    console.log('[Orders] Date range changed:', { startDate, endDate, currentFilters: filters });
    setFilters({
      ...filters,
      startDate,
      endDate,
    });
  };

  const handleNewOrder = () => {
    setSelectedOrderForEdit(null);
    setIsOrderFormOpen(true);
  };

  const handleEditOrder = (order: Order) => {
    setSelectedOrderForEdit(order);
    setIsOrderFormOpen(true);
  };

  const handleViewOrder = (orderId: number) => {
    navigate(`/orders/${orderId}`);
  };

  const handleLogCall = (order: Order) => {
    setSelectedOrderForCall(order);
    setIsLogCallModalOpen(true);
  };

  const handleStatusChange = async (orderId: number, newStatus: OrderStatus) => {
    try {
      await updateOrderStatus(orderId, newStatus);
      toast.success('Order status updated successfully');
    } catch (error: any) {
      console.error('Error updating order status:', error);

      // Handle different error types
      if (error.code === 'ECONNABORTED') {
        toast.error('Request timeout. The server took too long to respond. Please try again.');
      } else if (error.response?.status === 401) {
        toast.error('Authentication failed. Please log in again.');
      } else if (error.response?.status === 403) {
        toast.error('You do not have permission to update this order.');
      } else if (error.response?.status === 404) {
        toast.error('Order not found. It may have been deleted.');
      } else if (error.response?.data?.message) {
        toast.error(error.response.data.message);
      } else if (error.message) {
        toast.error(`Failed to update order: ${error.message}`);
      } else {
        toast.error('Failed to update order status. Please try again.');
      }
    }
  };

  const handleDeleteOrder = async (order: Order) => {
    if (!confirm(`Are you sure you want to delete order #${order.id}? This action cannot be undone.`)) {
      return;
    }

    try {
      await ordersService.deleteOrder(order.id);
      toast.success('Order deleted successfully');
      fetchOrders();
    } catch (error: any) {
      console.error('Failed to delete order:', error);
      toast.error(error.response?.data?.message || 'Failed to delete order');
    }
  };

  const handleFormSuccess = () => {
    fetchOrders();
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await ordersService.exportOrders(filters);
      toast.success('Orders exported successfully');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export orders');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedOrderIds(new Set(sortedOrders.map(o => o.id)));
    } else {
      setSelectedOrderIds(new Set());
    }
  };

  const handleSelectOrder = (orderId: number, checked: boolean) => {
    const newSelected = new Set(selectedOrderIds);
    if (checked) {
      newSelected.add(orderId);
    } else {
      newSelected.delete(orderId);
    }
    setSelectedOrderIds(newSelected);
  };

  const handleBulkDelete = async () => {
    if (selectedOrderIds.size === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedOrderIds.size} order(s)? This action cannot be undone.`)) {
      return;
    }

    const loadingToast = toast.loading(`Deleting ${selectedOrderIds.size} order(s)...`);
    try {
      const response = await ordersService.bulkDeleteOrders(Array.from(selectedOrderIds));
      toast.success(response.message || `Successfully deleted ${selectedOrderIds.size} order(s)`, { id: loadingToast });
      setSelectedOrderIds(new Set());
      fetchOrders();
    } catch (error: any) {
      console.error('Failed to bulk delete orders:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to delete orders';
      toast.error(errorMessage, { id: loadingToast });
    }
  };

  const handleBulkStatusChange = async (newStatus: OrderStatus) => {
    if (selectedOrderIds.size === 0) return;

    try {
      const updatePromises = Array.from(selectedOrderIds).map(id =>
        updateOrderStatus(id, newStatus)
      );
      await Promise.all(updatePromises);
      toast.success(`Successfully updated ${selectedOrderIds.size} order(s)`);
      setSelectedOrderIds(new Set());
    } catch (error: any) {
      console.error('Failed to bulk update orders:', error);
      toast.error('Failed to update some orders');
    }
  };

  const handleMouseDown = (columnKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColumn.current = columnKey;
    startX.current = e.clientX;
    startWidth.current = columnWidths[columnKey];

    const handleMouseMove = (e: MouseEvent) => {
      if (resizingColumn.current) {
        const diff = e.clientX - startX.current;
        const newWidth = Math.max(50, startWidth.current + diff);
        setColumnWidths(prev => ({
          ...prev,
          [resizingColumn.current!]: newWidth,
        }));
      }
    };

    const handleMouseUp = () => {
      resizingColumn.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Fixed Header - prevents horizontal scrolling */}
      <div className="flex-shrink-0 bg-gray-50 pb-4 mb-2">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => setIsFilterOpen(true)}>
              <Filter className="w-4 h-4 mr-2" />
              Filters
            </Button>
            {can('orders', 'bulk_import') && (
              <Button variant="ghost" onClick={() => setIsBulkImportOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
            )}
            <Button variant="ghost" onClick={handleExport} isLoading={isExporting}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button variant="primary" onClick={handleNewOrder} className="onboarding-new-order-btn">
              <Plus className="w-4 h-4 mr-2" />
              New Order
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-4 justify-between">
          {/* View Toggle - Hidden by default. Uncomment to enable Kanban view toggle */}
          {/* <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => {
                setViewMode('kanban');
                updatePreferences({ ordersDefaultView: 'kanban' }).catch(console.error);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="text-sm font-medium">Kanban</span>
            </button>
            <button
              onClick={() => {
                setViewMode('list');
                updatePreferences({ ordersDefaultView: 'list' }).catch(console.error);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <List className="w-4 h-4" />
              <span className="text-sm font-medium">List</span>
            </button>
          </div> */}

          <div className="flex items-center gap-3 flex-1">
            <div className="flex-1 max-w-md onboarding-search-bar">
              <SearchBar onSearch={handleSearch} placeholder="Search orders..." />
            </div>
            <DateRangePicker
              startDate={filters.startDate}
              endDate={filters.endDate}
              onChange={handleDateRangeChange}
              placeholder="Filter by date range"
            />
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedOrderIds.size > 0 && viewMode === 'list' && (
        <div className="flex-shrink-0 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900">
              {selectedOrderIds.size} order(s) selected
            </span>
            <div className="flex items-center gap-2">
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkStatusChange(e.target.value as OrderStatus);
                    e.target.value = '';
                  }
                }}
                className="px-3 py-1.5 text-sm border border-blue-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Change Status...</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {can('orders', 'delete') && (
                <Button variant="ghost" size="sm" onClick={handleBulkDelete}>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete Selected
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setSelectedOrderIds(new Set())}>
                Clear Selection
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View Content - Only this section scrolls */}
      <div className="flex-1 min-h-0">
        {viewMode === 'kanban' ? (
          <div className="h-full overflow-x-auto overflow-y-hidden">
            <KanbanBoard />
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <div className="bg-white rounded-lg shadow onboarding-orders-table">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 onboarding-orders-table-header">
                    <tr>
                      <ResizableHeader
                        columnKey="checkbox"
                        className="px-4 py-3 text-left sticky top-0 bg-gray-50 z-10"
                      >
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.size === sortedOrders.length && sortedOrders.length > 0}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="id"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('id')}
                      >
                        Order ID <SortIcon field="id" />
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="customerName"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('customerName')}
                      >
                        Customer <SortIcon field="customerName" />
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="phone"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10"
                      >
                        Phone
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="altPhone"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10"
                      >
                        Alt. Phone
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="address"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10"
                      >
                        Address
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="products"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10"
                      >
                        Products
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="amount"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('totalAmount')}
                      >
                        Amount <SortIcon field="totalAmount" />
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="status"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('status')}
                      >
                        Status <SortIcon field="status" />
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="date"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('createdAt')}
                      >
                        Date <SortIcon field="createdAt" />
                      </ResizableHeader>
                      <ResizableHeader
                        columnKey="actions"
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10"
                      >
                        Actions
                      </ResizableHeader>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedOrders.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-6 py-12 text-center text-gray-500">
                          No orders found. Create your first order to get started.
                        </td>
                      </tr>
                    ) : (
                      sortedOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap" style={{ width: columnWidths.checkbox, minWidth: columnWidths.checkbox, maxWidth: columnWidths.checkbox }}>
                            <input
                              type="checkbox"
                              checked={selectedOrderIds.has(order.id)}
                              onChange={(e) => handleSelectOrder(order.id, e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900" style={{ width: columnWidths.id, minWidth: columnWidths.id, maxWidth: columnWidths.id }}>
                            {order.id}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900" style={{ width: columnWidths.customerName, minWidth: columnWidths.customerName, maxWidth: columnWidths.customerName }}>
                            <div className="truncate" title={order.customerName}>
                              {order.customerName}
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600" style={{ width: columnWidths.phone, minWidth: columnWidths.phone, maxWidth: columnWidths.phone }}>
                            {order.customerPhone || '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600" style={{ width: columnWidths.altPhone, minWidth: columnWidths.altPhone, maxWidth: columnWidths.altPhone }}>
                            {order.shippingAddress?.phone && order.shippingAddress.phone !== order.customerPhone
                              ? order.shippingAddress.phone
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600" style={{ width: columnWidths.address, minWidth: columnWidths.address, maxWidth: columnWidths.address }}>
                            <div className="truncate">
                              {order.shippingAddress
                                ? `${order.shippingAddress.street}, ${order.shippingAddress.state}`
                                : '—'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600" style={{ width: columnWidths.products, minWidth: columnWidths.products, maxWidth: columnWidths.products }}>
                            <div className="truncate">
                              {order.items.map(item => {
                                // Show upsell name from metadata for upsell items
                                if (item.itemType === 'upsell' && item.metadata?.upsellName) {
                                  return item.metadata.upsellName;
                                }
                                return item.productName;
                              }).join(', ')}
                            </div>
                            <div className="text-xs text-gray-500">
                              {order.items.length} item{order.items.length > 1 ? 's' : ''}
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900" style={{ width: columnWidths.amount, minWidth: columnWidths.amount, maxWidth: columnWidths.amount }}>
                            {formatCurrency(order.totalAmount)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap" style={{ width: columnWidths.status, minWidth: columnWidths.status, maxWidth: columnWidths.status }}>
                            <select
                              value={order.status}
                              onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                              className={`onboarding-status-dropdown w-full px-2 py-1.5 text-xs font-medium rounded-md border-0 focus:ring-2 focus:ring-blue-500 ${statusColors[order.status]}`}
                            >
                              {statusOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500" style={{ width: columnWidths.date, minWidth: columnWidths.date, maxWidth: columnWidths.date }}>
                            {new Date(order.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500" style={{ width: columnWidths.actions, minWidth: columnWidths.actions, maxWidth: columnWidths.actions }}>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleViewOrder(order.id)}
                                className="text-blue-600 hover:text-blue-800"
                                title="View Details"
                              >
                                <Eye className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => handleEditOrder(order)}
                                className="text-blue-600 hover:text-blue-800"
                                title="Edit Order"
                              >
                                <Edit2 className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => handleLogCall(order)}
                                className="text-green-600 hover:text-green-800"
                                title="Log Call"
                              >
                                <Phone className="w-5 h-5" />
                              </button>
                              {can('orders', 'delete') && (
                                <button
                                  onClick={() => handleDeleteOrder(order)}
                                  className="text-red-600 hover:text-red-800"
                                  title="Delete Order"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {pagination.pages > 0 && (
                <Pagination
                  currentPage={pagination.page}
                  totalPages={pagination.pages}
                  onPageChange={setPage}
                  pageSize={pagination.limit}
                  pageSizeOptions={[25, 50, 75, 100]}
                  onPageSizeChange={setPageSize}
                  totalItems={pagination.total}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <FilterPanel isOpen={isFilterOpen} onClose={() => setIsFilterOpen(false)} />
      <OrderForm
        isOpen={isOrderFormOpen}
        onClose={() => {
          setIsOrderFormOpen(false);
          setSelectedOrderForEdit(null);
        }}
        order={selectedOrderForEdit}
        onSuccess={handleFormSuccess}
      />
      {selectedOrderForCall && (
        <LogCallModal
          isOpen={isLogCallModalOpen}
          onClose={() => {
            setIsLogCallModalOpen(false);
            setSelectedOrderForCall(null);
          }}
          customerId={selectedOrderForCall.customerId}
          customerName={selectedOrderForCall.customerName}
          orderId={selectedOrderForCall.id}
        />
      )}
      <BulkImportModal
        isOpen={isBulkImportOpen}
        onClose={() => setIsBulkImportOpen(false)}
        onSuccess={fetchOrders}
      />
    </div>
  );
};
