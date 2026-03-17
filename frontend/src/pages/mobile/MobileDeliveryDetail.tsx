import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, MapPin, Camera, Check, X, AlertTriangle, RotateCcw } from 'lucide-react';
import { deliveriesService, DeliveryListItem, formatDeliveryAddress } from '../../services/deliveries.service';
import { ordersService } from '../../services/orders.service';
import { resizeImage } from '../../utils/imageResize';
import { Skeleton } from '../../components/ui/Skeleton';
import { OrderStatus } from '../../types';
import toast from 'react-hot-toast';

const STEPS = ['Pickup', 'In Transit', 'Delivered'] as const;

function getStepIndex(status: string): number {
  if (status === 'ready_for_pickup') return 0;
  if (status === 'out_for_delivery') return 1;
  if (status === 'delivered') return 2;
  if (status === 'failed_delivery') return 1;
  return 0;
}

function StatusStepper({ status }: { status: string }) {
  const current = getStepIndex(status);
  const isFailed = status === 'failed_delivery';

  return (
    <div className="flex items-center justify-between px-2">
      {STEPS.map((step, i) => {
        const isActive = i <= current;
        const isFailedStep = isFailed && i === 1;
        return (
          <div key={step} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                  isFailedStep
                    ? 'bg-red-500 text-white'
                    : isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isFailedStep ? '!' : isActive && i < current ? '✓' : i + 1}
              </div>
              <span className={`text-[10px] mt-1 ${isFailedStep ? 'text-red-600 font-medium' : isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                {isFailedStep ? 'Failed' : step}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${i < current ? (isFailed && i === 0 ? 'bg-red-300' : 'bg-blue-400') : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MobileDeliveryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [delivery, setDelivery] = useState<DeliveryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Complete sheet
  const [showCompleteSheet, setShowCompleteSheet] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [codAmount, setCodAmount] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive preview URL from photo File — avoids passing string through state (CodeQL safe)
  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  // Failed sheet
  const [showFailedSheet, setShowFailedSheet] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [reschedule, setReschedule] = useState(false);

  const fetchDelivery = useCallback(async () => {
    if (!id) return;
    try {
      const data = await deliveriesService.getDeliveryById(id);
      setDelivery(data);
    } catch {
      toast.error('Failed to load delivery');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDelivery();
  }, [fetchDelivery]);

  const orderStatus = delivery?.order?.status || '';
  const customer = delivery?.order?.customer;
  const items = delivery?.order?.orderItems || [];
  const totalAmount = delivery?.order?.totalAmount || 0;

  const address = formatDeliveryAddress(delivery?.order);

  const handlePickup = async () => {
    if (!delivery?.order?.id) return;
    setActionLoading(true);
    try {
      await ordersService.updateOrderStatus(delivery.order.id, 'out_for_delivery' as OrderStatus);
      toast.success('Order picked up');
      await fetchDelivery();
    } catch {
      toast.error('Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const openCompleteSheet = () => {
    setRecipientName(customer ? `${customer.firstName} ${customer.lastName}` : '');
    setCodAmount(totalAmount.toFixed(2));
    setPhoto(null);
    setShowCompleteSheet(true);
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeImage(file);
      setPhoto(resized);
    } catch {
      toast.error('Failed to process photo');
    }
  };

  const handleComplete = async () => {
    if (!delivery?.id || !recipientName.trim()) {
      toast.error('Recipient name is required');
      return;
    }
    setActionLoading(true);
    try {
      let proofData = '';
      if (photo) {
        const result = await deliveriesService.uploadImage(photo);
        proofData = result.imageUrl;
      }
      const parsedAmount = parseFloat(codAmount);
      if (!parsedAmount || parsedAmount <= 0) {
        toast.error('Please enter a valid COD amount');
        setActionLoading(false);
        return;
      }
      await deliveriesService.completeDelivery(delivery.id, {
        codAmount: parsedAmount,
        proofType: photo ? 'photo' : 'otp',
        proofData,
        recipientName: recipientName.trim(),
      });
      toast.success('Delivery completed');
      setShowCompleteSheet(false);
      await fetchDelivery();
    } catch {
      toast.error('Failed to complete delivery');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFailed = async () => {
    if (!delivery?.order?.id || !failReason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    setActionLoading(true);
    try {
      const newStatus: OrderStatus = reschedule ? 'ready_for_pickup' : 'failed_delivery';
      await ordersService.updateOrderStatus(delivery.order.id, newStatus, failReason.trim());
      toast.success(reschedule ? 'Rescheduled for tomorrow' : 'Marked as failed');
      setShowFailedSheet(false);
      setFailReason('');
      setReschedule(false);
      await fetchDelivery();
    } catch {
      toast.error('Failed to update delivery');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-50 min-h-full p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-gray-400">
        <AlertTriangle size={48} />
        <p className="mt-3 text-sm">Delivery not found</p>
        <button onClick={() => navigate('/m/deliveries')} className="mt-4 text-blue-600 text-sm font-medium">
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-full pb-24">
      {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center gap-3 border-b sticky top-0 z-10">
        <button onClick={() => navigate('/m/deliveries')} className="p-1 -ml-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold text-gray-900">
          Delivery #{delivery.order?.id || delivery.id}
        </h1>
      </div>

      <div className="p-4 space-y-4">
        {/* Status Stepper */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <StatusStepper status={orderStatus} />
        </div>

        {/* Customer Info */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">Customer</h2>
          <p className="font-semibold text-gray-900 text-sm">
            {customer ? `${customer.firstName} ${customer.lastName}` : 'Unknown'}
          </p>
          {customer?.phoneNumber && (
            <a href={`tel:${customer.phoneNumber}`} className="flex items-center gap-2 mt-2 text-sm text-blue-600">
              <Phone size={14} /> {customer.phoneNumber}
            </a>
          )}
          {delivery.order?.deliveryAddress && (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 mt-2 text-sm text-blue-600"
            >
              <MapPin size={14} /> {address}
            </a>
          )}
        </div>

        {/* Order Items */}
        {items.length > 0 && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">Order Items</h2>
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {item.product?.name || 'Item'} <span className="text-gray-400">×{item.quantity}</span>
                  </span>
                  <span className="font-medium text-gray-900">GH₵{(item.totalPrice ?? item.unitPrice * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border-t mt-3 pt-3 flex justify-between">
              <span className="font-semibold text-sm">COD Total</span>
              <span className="font-bold text-sm">GH₵{totalAmount.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* COD Total (when no items available) */}
        {items.length === 0 && totalAmount > 0 && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">Order</h2>
            <div className="flex justify-between">
              <span className="font-semibold text-sm">COD Total</span>
              <span className="font-bold text-sm">GH₵{totalAmount.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Notes */}
        {(delivery.notes || delivery.order?.notes) && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">Notes</h2>
            <p className="text-sm text-gray-700">{delivery.notes || delivery.order?.notes}</p>
          </div>
        )}

        {/* Attempts */}
        {delivery.deliveryAttempts > 0 && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">Delivery Attempts</h2>
            <p className="text-sm text-gray-700">{delivery.deliveryAttempts}</p>
          </div>
        )}

        {/* Status Banners */}
        {orderStatus === 'delivered' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
              <Check size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-green-800 text-sm">Delivery Completed</p>
              <p className="text-xs text-green-600">
                {delivery.actualDeliveryTime
                  ? `Completed ${new Date(delivery.actualDeliveryTime).toLocaleString()}`
                  : 'Successfully delivered'}
              </p>
            </div>
          </div>
        )}

        {orderStatus === 'failed_delivery' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-red-800 text-sm">Delivery Failed</p>
              <p className="text-xs text-red-600">
                {delivery.deliveryAttempts > 0 ? `${delivery.deliveryAttempts} attempt(s)` : 'Failed delivery'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons - Fixed at bottom */}
      {orderStatus === 'ready_for_pickup' && (
        <div className="fixed bottom-16 left-0 right-0 p-4 bg-white border-t">
          <button
            onClick={handlePickup}
            disabled={actionLoading}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 active:bg-blue-700"
          >
            {actionLoading ? 'Updating...' : 'Pick Up Order'}
          </button>
        </div>
      )}

      {orderStatus === 'out_for_delivery' && (
        <div className="fixed bottom-16 left-0 right-0 p-4 bg-white border-t flex gap-3">
          <button
            onClick={() => { setFailReason(''); setReschedule(false); setShowFailedSheet(true); }}
            disabled={actionLoading}
            className="flex-1 py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl font-semibold text-sm disabled:opacity-50 active:bg-red-100"
          >
            Failed
          </button>
          <button
            onClick={openCompleteSheet}
            disabled={actionLoading}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 active:bg-green-700"
          >
            Mark Delivered
          </button>
        </div>
      )}

      {/* Complete Delivery Sheet */}
      {showCompleteSheet && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !actionLoading && setShowCompleteSheet(false)} />
          <div className="relative w-full bg-white rounded-t-2xl p-5 pb-8 max-h-[85vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Complete Delivery</h3>
              <button onClick={() => !actionLoading && setShowCompleteSheet(false)} className="p-1">
                <X size={20} className="text-gray-400" />
              </button>
            </div>

            {/* Photo Capture */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
            />
            {photoPreview ? (
              <div className="mb-4 relative">
                <img src={photoPreview} alt="Proof" className="w-full h-40 object-cover rounded-lg" />
                <button
                  onClick={() => setPhoto(null)}
                  className="absolute top-2 right-2 p-1 bg-black/50 rounded-full"
                >
                  <X size={14} className="text-white" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full mb-4 py-3 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center gap-2 text-sm text-gray-500 active:bg-gray-50"
              >
                <Camera size={18} /> Capture Photo (Optional)
              </button>
            )}

            {/* Recipient Name */}
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Name</label>
            <input
              type="text"
              value={recipientName}
              onChange={e => setRecipientName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Name of person receiving"
            />

            {/* COD Amount */}
            <label className="block text-sm font-medium text-gray-700 mb-1">COD Amount Collected</label>
            <div className="relative mb-5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">GH₵</span>
              <input
                type="number"
                inputMode="decimal"
                value={codAmount}
                onChange={e => setCodAmount(e.target.value)}
                className="w-full pl-12 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleComplete}
              disabled={actionLoading || !recipientName.trim()}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 active:bg-green-700"
            >
              {actionLoading ? 'Completing...' : 'Confirm Delivery'}
            </button>
          </div>
        </div>
      )}

      {/* Failed Delivery Sheet */}
      {showFailedSheet && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !actionLoading && setShowFailedSheet(false)} />
          <div className="relative w-full bg-white rounded-t-2xl p-5 pb-8 animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Report Failed Delivery</h3>
              <button onClick={() => !actionLoading && setShowFailedSheet(false)} className="p-1">
                <X size={20} className="text-gray-400" />
              </button>
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              value={failReason}
              onChange={e => setFailReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Why couldn't the delivery be completed?"
            />

            <button
              type="button"
              onClick={() => setReschedule(!reschedule)}
              className="flex items-center gap-3 mb-5 cursor-pointer"
            >
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  reschedule ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                }`}
              >
                {reschedule && <Check size={14} className="text-white" />}
              </div>
              <div className="flex items-center gap-1.5 text-sm text-gray-700">
                <RotateCcw size={14} /> Reschedule for tomorrow
              </div>
            </button>

            <button
              onClick={handleFailed}
              disabled={actionLoading || !failReason.trim()}
              className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 active:bg-red-700"
            >
              {actionLoading ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
