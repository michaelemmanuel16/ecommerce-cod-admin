import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Product, CreateShipmentPayload, InventoryShipment } from '../../types';
import { formatCurrency } from '../../utils/format';

interface AddShipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateShipmentPayload) => Promise<void>;
  products: Product[];
  editingShipment?: InventoryShipment | null;
}

const emptyForm = {
  productId: '',
  supplier: '',
  quantity: '',
  unitCost: '',
  shippingCost: '',
  customsDuties: '',
  otherCosts: '',
  expectedArrivalDate: '',
  notes: '',
};

export const AddShipmentModal: React.FC<AddShipmentModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  products,
  editingShipment,
}) => {
  const [formData, setFormData] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = !!editingShipment;

  useEffect(() => {
    if (editingShipment) {
      setFormData({
        productId: String(editingShipment.productId),
        supplier: editingShipment.supplier || '',
        quantity: String(editingShipment.quantity),
        unitCost: String(Number(editingShipment.unitCost)),
        shippingCost: Number(editingShipment.shippingCost) !== 0 ? String(Number(editingShipment.shippingCost)) : '',
        customsDuties: Number(editingShipment.customsDuties) !== 0 ? String(Number(editingShipment.customsDuties)) : '',
        otherCosts: Number(editingShipment.otherCosts) !== 0 ? String(Number(editingShipment.otherCosts)) : '',
        expectedArrivalDate: editingShipment.expectedArrivalDate
          ? new Date(editingShipment.expectedArrivalDate).toISOString().split('T')[0]
          : '',
        notes: editingShipment.notes || '',
      });
    } else {
      setFormData(emptyForm);
    }
  }, [editingShipment, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const qty = parseInt(formData.quantity) || 0;
  const uc = parseFloat(formData.unitCost) || 0;
  const sc = parseFloat(formData.shippingCost) || 0;
  const cd = parseFloat(formData.customsDuties) || 0;
  const oc = parseFloat(formData.otherCosts) || 0;
  const totalCost = (uc * qty) + sc + cd + oc;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.productId || qty < 1) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        productId: parseInt(formData.productId),
        supplier: formData.supplier || undefined,
        quantity: qty,
        unitCost: uc,
        shippingCost: sc || undefined,
        customsDuties: cd || undefined,
        otherCosts: oc || undefined,
        expectedArrivalDate: formData.expectedArrivalDate || undefined,
        notes: formData.notes || undefined,
      });
      setFormData(emptyForm);
      onClose();
    } catch {
      // Error handled by caller
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit Shipment' : 'Add Incoming Shipment'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Product & Supplier</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
          <select
            name="productId"
            value={formData.productId}
            onChange={handleChange}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            required
            disabled={isEditing}
          >
            <option value="">Select a product</option>
            {products.filter(p => p.isActive).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
          <input
            type="text"
            name="supplier"
            value={formData.supplier}
            onChange={handleChange}
            placeholder="e.g. AliExpress, local supplier..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <h3 className="text-sm font-semibold text-gray-700 mt-4">Cost Breakdown</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
            <input
              type="number"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              min="1"
              placeholder="0"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unit Cost (GHS) *</label>
            <input
              type="number"
              name="unitCost"
              value={formData.unitCost}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Cost (GHS)</label>
            <input
              type="number"
              name="shippingCost"
              value={formData.shippingCost}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customs / Duties (GHS)</label>
            <input
              type="number"
              name="customsDuties"
              value={formData.customsDuties}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Other Costs (GHS)</label>
            <input
              type="number"
              name="otherCosts"
              value={formData.otherCosts}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-end">
            <div className="w-full rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-xs text-gray-500">Total Cost</p>
              <p className="text-sm font-semibold text-gray-900">{formatCurrency(totalCost)}</p>
            </div>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-gray-700 mt-4">Details</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Expected Arrival Date</label>
          <input
            type="date"
            name="expectedArrivalDate"
            value={formData.expectedArrivalDate}
            onChange={handleChange}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={2}
            placeholder="Order reference, tracking number, etc."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting} disabled={!formData.productId || qty < 1}>
            {isEditing ? 'Save Changes' : 'Add Shipment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
