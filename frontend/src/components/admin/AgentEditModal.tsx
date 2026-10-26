import React, { useState, useEffect } from 'react';
import { Button, Input, Modal, Select } from '../ui-v2';
import { apiErrorMessage } from '../../utils/apiError';
import { DeliveryAgent } from '../../services/delivery-agents.service';
import { useDeliveryAgentsStore } from '../../stores/deliveryAgentsStore';

interface AgentEditModalProps {
  onClose: () => void;
  agent: DeliveryAgent;
}

export const AgentEditModal: React.FC<AgentEditModalProps> = ({
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
    deliveryRate: (agent.deliveryRate ?? (agent as any).commissionAmount)?.toString() || '',
    location: agent.location || '',
    isActive: agent.isActive
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setFormData({
      firstName: agent.firstName,
      lastName: agent.lastName,
      email: agent.email,
      phoneNumber: agent.phoneNumber || '',
      vehicleType: agent.vehicleType || '',
      vehicleId: agent.vehicleId || '',
      deliveryRate: (agent.deliveryRate ?? (agent as any).commissionAmount)?.toString() || '',
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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (isSubmitting || !validate()) return;

    setIsSubmitting(true);
    setSaveError(null);
    try {
      const updateData: any = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phoneNumber: formData.phoneNumber || undefined,
        vehicleType: formData.vehicleType || undefined,
        vehicleId: formData.vehicleId || undefined,
        deliveryRate: formData.deliveryRate ? Number(formData.deliveryRate) : undefined,
        commissionAmount: formData.deliveryRate ? Number(formData.deliveryRate) : undefined,
        location: formData.location || undefined,
        isActive: formData.isActive
      };

      await updateAgent(agent.id, updateData);
      onClose();
    } catch (error) {
      setSaveError(apiErrorMessage(error, 'The changes could not be saved.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit delivery agent"
      footer={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button variant="primary" disabled={isSubmitting} onClick={() => void handleSubmit()}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <form className="cform" noValidate onSubmit={(e) => void handleSubmit(e)}>
        <Input label="First name" name="firstName" value={formData.firstName} onChange={handleChange} error={errors.firstName} required />
        <Input label="Last name" name="lastName" value={formData.lastName} onChange={handleChange} error={errors.lastName} required />
        <Input label="Email" name="email" type="email" value={formData.email} onChange={handleChange} error={errors.email} required />
        <Input label="Phone number" name="phoneNumber" type="tel" value={formData.phoneNumber} onChange={handleChange} />
        <Select label="Vehicle type" name="vehicleType" value={formData.vehicleType} onChange={handleChange}>
          <option value="">Select vehicle type</option>
          <option value="Motorcycle">Motorcycle</option>
          <option value="Bicycle">Bicycle</option>
          <option value="Van">Van</option>
          <option value="Truck">Truck</option>
          <option value="Car">Car</option>
        </Select>
        <Input label="Vehicle ID" name="vehicleId" value={formData.vehicleId} onChange={handleChange} placeholder="e.g., NG456789" />
        <Input label="Delivery rate (per delivery)" name="deliveryRate" type="number" step="0.01" value={formData.deliveryRate} onChange={handleChange} error={errors.deliveryRate} placeholder="0.00" />
        <Input label="Location" name="location" value={formData.location} onChange={handleChange} placeholder="e.g., GH, Accra" />
        <label className="chk span2">
          <input type="checkbox" name="isActive" checked={formData.isActive} onChange={handleChange} />
          Active
        </label>
        <button type="submit" hidden />
      </form>
      {saveError && <p className="err" role="alert">{saveError}</p>}
    </Modal>
  );
};
