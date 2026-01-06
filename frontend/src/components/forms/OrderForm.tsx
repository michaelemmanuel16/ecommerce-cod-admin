import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Order, OrderStatus, Product } from '../../types';
import { ordersService } from '../../services/orders.service';
import { productsService } from '../../services/products.service';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfigStore } from '../../stores/configStore';
import { getCountryByCurrency, getRegionsForCountry } from '../../utils/countries';

interface OrderFormProps {
  isOpen: boolean;
  onClose: () => void;
  order?: Order | null;
  onSuccess?: () => void;
}

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

interface OrderItemForm {
  productId: number;
  productName: string;
  quantity: number;
  price: number;
}

export const OrderForm: React.FC<OrderFormProps> = ({
  isOpen,
  onClose,
  order,
  onSuccess,
}) => {
  const { currency } = useConfigStore();
  const countryName = getCountryByCurrency(currency);
  const states = getRegionsForCountry(countryName);

  const stateOptions = states.map(state => ({
    value: state,
    label: state
  }));

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemForm[]>([]);
  const [formData, setFormData] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    alternatePhone: '',
    status: 'pending_confirmation' as OrderStatus,
    street: '',
    state: '',
  });

  useEffect(() => {
    const loadProducts = async () => {
      try {
        const data = await productsService.getProducts();
        setProducts(data);
      } catch (error) {
        console.error('Failed to load products:', error);
        toast.error('Failed to load products');
      }
    };

    if (isOpen) {
      loadProducts();
    }
  }, [isOpen]);

  useEffect(() => {
    if (order) {
      setFormData({
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        alternatePhone: order.shippingAddress?.phone !== order.customerPhone ? (order.shippingAddress?.phone || '') : '',
        status: order.status,
        street: order.shippingAddress?.street || '',
        state: order.shippingAddress?.state || '',
      });

      setOrderItems(order.items.map(item => ({
        productId: item.productId,
        productName: item.metadata?.upsellName || item.productName,
        quantity: item.quantity,
        price: item.price,
      })));
    } else {
      setFormData({
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        alternatePhone: '',
        status: 'pending_confirmation' as OrderStatus,
        street: '',
        state: '',
      });
      setOrderItems([]);
    }
  }, [order]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (orderItems.length === 0) {
      toast.error('Please add at least one order item');
      return;
    }

    setIsSubmitting(true);
    console.log('=== Order Form Submit Started ===');
    console.log('Order exists:', !!order);
    console.log('Order ID:', order?.id);

    try {
      const totalAmount = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      if (order) {
        // For updates, send complete order data including items and customer details
        const updateData = {
          // Customer details
          customerName: formData.customerName,
          customerEmail: formData.customerEmail,
          customerPhone: formData.customerPhone,
          alternatePhone: formData.alternatePhone,
          // Order details
          status: formData.status,
          deliveryAddress: formData.street,
          deliveryState: formData.state,
          deliveryArea: formData.state, // Use state as area fallback
          totalAmount,
          subtotal: totalAmount,
          // Include order items to ensure complete update
          orderItems: orderItems.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.price,
          })),
        };

        console.log('Sending update request with data:', updateData);
        console.log('About to call ordersService.updateOrder with ID:', order.id);

        try {
          const result = await ordersService.updateOrder(order.id, updateData);
          console.log('Update successful:', result);
          toast.success('Order updated successfully');
        } catch (updateError: any) {
          console.error('Update error caught:', updateError);
          throw updateError; // Re-throw to be caught by outer catch
        }
      } else {
        // For creation, send data that matches backend CreateOrderData interface
        const orderData = {
          customerName: formData.customerName,
          customerEmail: formData.customerEmail,
          customerPhone: formData.customerPhone,
          alternatePhone: formData.alternatePhone,
          orderItems: orderItems.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.price,
          })),
          subtotal: totalAmount,
          totalAmount,
          deliveryAddress: formData.street,
          deliveryState: formData.state,
          deliveryArea: formData.state,
        };

        await ordersService.createOrder(orderData);
        toast.success('Order created successfully');
      }

      onSuccess?.();
      onClose();
    } catch (error: any) {
      console.error('=== Order Form Submit Error ===');
      console.error('Error saving order:', error);
      console.error('Error response:', error.response);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to save order';
      toast.error(errorMessage);
    } finally {
      console.log('=== Order Form Submit Ended - Resetting isSubmitting ===');
      setIsSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddItem = () => {
    setOrderItems([...orderItems, { productId: 0, productName: '', quantity: 1, price: 0 }]);
  };

  const handleRemoveItem = (index: number) => {
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof OrderItemForm, value: any) => {
    const newItems = [...orderItems];

    if (field === 'productId') {
      const product = products.find(p => p.id === value);
      if (product) {
        newItems[index] = {
          ...newItems[index],
          productId: value,
          productName: product.name,
          price: product.price,
        };
      }
    } else {
      newItems[index] = { ...newItems[index], [field]: value };
    }

    setOrderItems(newItems);
  };

  const calculateTotal = () => {
    return orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={order ? 'Edit Order' : 'Create New Order'}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Customer Information */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Customer Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Customer Name"
              name="customerName"
              value={formData.customerName}
              onChange={handleChange}
              required
            />
            <Input
              label="Customer Email"
              name="customerEmail"
              type="email"
              value={formData.customerEmail}
              onChange={handleChange}
            />
            <Input
              label="Customer Phone"
              name="customerPhone"
              type="tel"
              value={formData.customerPhone}
              onChange={handleChange}
              required
            />
            <Input
              label="Alternative Phone"
              name="alternatePhone"
              type="tel"
              value={formData.alternatePhone}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* Order Details */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Order Details</h3>
          <Select
            label="Status"
            name="status"
            value={formData.status}
            onChange={handleChange}
            options={statusOptions}
          />
        </div>

        {/* Order Items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Order Items</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleAddItem}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Item
            </Button>
          </div>

          {orderItems.length === 0 ? (
            <div className="text-center py-6 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-500">No items added. Click "Add Item" to start.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orderItems.map((item, index) => (
                <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Product
                      </label>
                      <select
                        value={item.productId}
                        onChange={(e) => handleItemChange(index, 'productId', parseInt(e.target.value, 10))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      >
                        <option value="">Select product...</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} (${product.price})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Quantity
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Price
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.price}
                        onChange={(e) => handleItemChange(index, 'price', parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    className="mt-7 text-red-600 hover:text-red-800"
                    title="Remove item"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}

              <div className="flex justify-end pt-3 border-t">
                <div className="text-right">
                  <p className="text-sm text-gray-600">Total Amount</p>
                  <p className="text-xl font-bold text-gray-900">${calculateTotal().toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Shipping Address */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Shipping Address</h3>
          <div className="grid grid-cols-1 gap-4">
            <Input
              label="Street Address"
              name="street"
              value={formData.street}
              onChange={handleChange}
              required
            />
            <Select
              label="State"
              name="state"
              value={formData.state}
              onChange={handleChange}
              options={stateOptions}
              required
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : order ? 'Update Order' : 'Create Order'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
