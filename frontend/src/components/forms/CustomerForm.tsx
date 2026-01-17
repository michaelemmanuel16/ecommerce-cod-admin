import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Customer } from '../../types';
import { customersService } from '../../services/customers.service';

interface CustomerFormProps {
  isOpen: boolean;
  onClose: () => void;
  customer?: Customer | null;
  onSuccess?: () => void;
}

export const CustomerForm: React.FC<CustomerFormProps> = ({
  isOpen,
  onClose,
  customer,
  onSuccess,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    alternatePhone: '',
    street: '',
    state: '',
    notes: '',
  });

  useEffect(() => {
    if (customer) {
      setFormData({
        name: `${customer.firstName} ${customer.lastName}`.trim() || '',
        email: customer.email || '',
        phone: customer.phone || '',
        alternatePhone: customer.alternatePhone || '',
        street: customer.address?.street || '',
        state: customer.address?.state || '',
        notes: '',
      });
    } else {
      // Reset form for new customer
      setFormData({
        name: '',
        email: '',
        phone: '',
        alternatePhone: '',
        street: '',
        state: '',
        notes: '',
      });
    }
  }, [customer, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Split name into firstName and lastName
      const nameParts = formData.name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const customerData = {
        firstName,
        lastName,
        email: formData.email.trim(),
        phoneNumber: formData.phone.trim(),
        alternatePhone: formData.alternatePhone.trim() || undefined,
        address: formData.street.trim(),
        state: formData.state.trim(),
        area: formData.state.trim(),
      };

      if (customer) {
        await customersService.updateCustomer(customer.id, customerData);
      } else {
        await customersService.createCustomer(customerData);
      }

      onSuccess?.();
      onClose();
    } catch (error: any) {
      console.error('Error saving customer:', error);
      alert(error.response?.data?.message || 'Failed to save customer');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={customer ? 'Edit Customer' : 'Add New Customer'}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Personal Information */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Personal Information</h3>
          <Input
            label="Name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            placeholder="John Doe"
          />
        </div>

        {/* Contact Information */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Contact Information</h3>
          <div className="grid grid-cols-1 gap-4">
            <Input
              label="Email Address"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="john.doe@example.com"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Phone Number"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                required
                placeholder="+1 (555) 123-4567"
              />
              <Input
                label="Alternate Phone (Optional)"
                name="alternatePhone"
                type="tel"
                value={formData.alternatePhone}
                onChange={handleChange}
                placeholder="+1 (555) 987-6543"
              />
            </div>
          </div>
        </div>

        {/* Address Information */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Address</h3>
          <div className="grid grid-cols-1 gap-4">
            <Input
              label="Street Address"
              name="street"
              value={formData.street}
              onChange={handleChange}
              placeholder="789 Pine Rd"
            />
            <Input
              label="State/Region"
              name="state"
              value={formData.state}
              onChange={handleChange}
              placeholder="Greater Accra"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Internal Notes (Optional)
          </label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={3}
            placeholder="Add any internal notes about this customer..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
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
            {isSubmitting ? 'Saving...' : customer ? 'Update Customer' : 'Add Customer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
