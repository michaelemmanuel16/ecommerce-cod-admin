import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from '../ui/Modal';
import { FormInput } from '../forms/FormInput';
import { Button } from '../ui/Button';
import { RepTableData } from './RepTable';

const editRepSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phoneNumber: z.string().min(1, 'Phone number is required'),
  country: z.string().min(1, 'Country is required'),
  commissionAmount: z.number().min(0, 'Commission must be 0 or greater'),
  isActive: z.boolean(),
});

type EditRepFormData = z.infer<typeof editRepSchema>;

interface EditRepModalProps {
  rep: RepTableData | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (id: string, data: EditRepFormData) => Promise<void>;
}

const COUNTRIES = [
  'Ghana',
  'Nigeria',
  'Kenya',
  'South Africa',
  'Egypt',
  'Tanzania',
  'Uganda',
  'Ethiopia',
  'Morocco',
  'Algeria',
  'USA',
  'UK',
  'Canada',
  'Australia',
];

export const EditRepModal: React.FC<EditRepModalProps> = ({
  rep,
  isOpen,
  onClose,
  onUpdate,
}) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    watch,
  } = useForm<EditRepFormData>({
    resolver: zodResolver(editRepSchema),
  });

  const isActive = watch('isActive');

  useEffect(() => {
    if (rep) {
      reset({
        firstName: rep.firstName,
        lastName: rep.lastName,
        email: rep.email,
        phoneNumber: rep.phoneNumber,
        country: rep.country,
        commissionAmount: rep.commissionAmount,
        isActive: rep.isActive,
      });
    }
  }, [rep, reset]);

  const onSubmit = async (data: EditRepFormData) => {
    if (!rep) return;

    try {
      await onUpdate(rep.id, data);
      onClose();
    } catch (error) {
      console.error('Failed to update rep:', error);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      reset();
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit Representative" size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            label="First Name"
            required
            {...register('firstName')}
            error={errors.firstName?.message}
            placeholder="John"
          />
          <FormInput
            label="Last Name"
            required
            {...register('lastName')}
            error={errors.lastName?.message}
            placeholder="Doe"
          />
        </div>

        <FormInput
          label="Email"
          type="email"
          required
          {...register('email')}
          error={errors.email?.message}
          placeholder="john.doe@example.com"
        />

        <FormInput
          label="Phone Number"
          type="tel"
          required
          {...register('phoneNumber')}
          error={errors.phoneNumber?.message}
          placeholder="+233 XX XXX XXXX"
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Country
            <span className="text-red-500 ml-1">*</span>
          </label>
          <select
            {...register('country')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select a country</option>
            {COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
          {errors.country && (
            <p className="text-sm text-red-600 mt-1">{errors.country.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Commission Amount
            <span className="text-red-500 ml-1">*</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            {...register('commissionAmount', { valueAsNumber: true })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="50.00"
          />
          {errors.commissionAmount && (
            <p className="text-sm text-red-600 mt-1">{errors.commissionAmount.message}</p>
          )}
          <p className="text-sm text-gray-500 mt-1">
            Representative will earn this amount for each successful delivery
          </p>
        </div>

        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div>
            <label className="text-sm font-medium text-gray-700">Active Account</label>
            <p className="text-xs text-gray-500">
              Inactive representatives cannot be assigned new orders
            </p>
          </div>
          <button
            type="button"
            onClick={() => setValue('isActive', !isActive)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isActive ? 'bg-blue-600' : 'bg-gray-300'
              }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'
                }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-4 border-t">
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isSubmitting}
            disabled={isSubmitting}
            className="bg-purple-600 hover:bg-purple-700 focus:ring-purple-500"
          >
            Update Representative
          </Button>
        </div>
      </form>
    </Modal>
  );
};
