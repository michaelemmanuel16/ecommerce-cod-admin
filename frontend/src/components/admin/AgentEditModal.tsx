import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { DeliveryAgent } from '../../services/delivery-agents.service';
import { useDeliveryAgentsStore } from '../../stores/deliveryAgentsStore';

interface AgentEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: DeliveryAgent;
}

export const AgentEditModal: React.FC<AgentEditModalProps> = ({
  isOpen,
  onClose,
  agent
}) => {
  const { updateAgent } = useDeliveryAgentsStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    firstName: agent.firstName,
    lastName: agent.lastName,
    email: agent.email,
    phoneNumber: agent.phoneNumber || '',
    vehicleType: agent.vehicleType || '',
    vehicleId: agent.vehicleId || '',
    deliveryRate: agent.deliveryRate?.toString() || '',
    location: agent.location || '',
    isActive: agent.isActive
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setFormData({
      firstName: agent.firstName,
      lastName: agent.lastName,
      email: agent.email,
      phoneNumber: agent.phoneNumber || '',
      vehicleType: agent.vehicleType || '',
      vehicleId: agent.vehicleId || '',
      deliveryRate: agent.deliveryRate?.toString() || '',
      location: agent.location || '',
      isActive: agent.isActive
    });
  }, [agent]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
    // Clear error for this field
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    }
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }
    if (formData.deliveryRate && isNaN(Number(formData.deliveryRate))) {
      newErrors.deliveryRate = 'Delivery rate must be a number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const updateData: any = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phoneNumber: formData.phoneNumber || undefined,
        vehicleType: formData.vehicleType || undefined,
        vehicleId: formData.vehicleId || undefined,
        deliveryRate: formData.deliveryRate ? Number(formData.deliveryRate) : undefined,
        location: formData.location || undefined,
        isActive: formData.isActive
      };

      await updateAgent(agent.id, updateData);
      onClose();
    } catch (error) {
      console.error('Failed to update agent:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Edit Delivery Agent</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Input
            label="First Name"
            name="firstName"
            value={formData.firstName}
            onChange={handleChange}
            error={errors.firstName}
            required
          />
          <Input
            label="Last Name"
            name="lastName"
            value={formData.lastName}
            onChange={handleChange}
            error={errors.lastName}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <Input
            label="Email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            error={errors.email}
            required
          />
          <Input
            label="Phone Number"
            name="phoneNumber"
            type="tel"
            value={formData.phoneNumber}
            onChange={handleChange}
            error={errors.phoneNumber}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Type
            </label>
            <select
              name="vehicleType"
              value={formData.vehicleType}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select Vehicle Type</option>
              <option value="Motorcycle">Motorcycle</option>
              <option value="Bicycle">Bicycle</option>
              <option value="Van">Van</option>
              <option value="Truck">Truck</option>
              <option value="Car">Car</option>
            </select>
          </div>
          <Input
            label="Vehicle ID"
            name="vehicleId"
            value={formData.vehicleId}
            onChange={handleChange}
            placeholder="e.g., NG456789"
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <Input
            label="Delivery Rate (per delivery)"
            name="deliveryRate"
            type="number"
            step="0.01"
            value={formData.deliveryRate}
            onChange={handleChange}
            error={errors.deliveryRate}
            placeholder="0.00"
          />
          <Input
            label="Location"
            name="location"
            value={formData.location}
            onChange={handleChange}
            placeholder="e.g., GH, Accra"
          />
        </div>

        <div className="mb-6">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              name="isActive"
              checked={formData.isActive}
              onChange={handleChange}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Active Status</span>
          </label>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Updating...' : 'Update Agent'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
