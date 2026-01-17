/**
 * EXAMPLE FILE - Not part of production code
 * This file demonstrates how to use the form components and validation schemas
 */

import React from 'react';
import { useFormValidation, getErrorMessage } from '../hooks/useFormValidation';
import { FormInput, FormTextarea, FormSelect, FormCheckbox } from '../components/forms';
import { createProductSchema, CreateProductFormData } from '../validation/schemas';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export const ProductFormExample: React.FC = () => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useFormValidation<CreateProductFormData>({
    schema: createProductSchema,
    defaultValues: {
      name: '',
      description: '',
      price: 0,
      stock: 0,
      category: '',
      sku: '',
      lowStockThreshold: 10,
      isActive: true,
    }
  });

  const onSubmit = async (data: CreateProductFormData) => {
    console.log('Form submitted:', data);
    // Call your API here
    // await productsService.createProduct(data);
  };

  const categoryOptions = [
    { value: 'electronics', label: 'Electronics' },
    { value: 'clothing', label: 'Clothing' },
    { value: 'food', label: 'Food & Beverages' },
    { value: 'books', label: 'Books' },
  ];

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card>
        <div className="p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Create New Product
          </h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Product Name */}
            <FormInput
              label="Product Name"
              required
              placeholder="Enter product name"
              error={getErrorMessage(errors.name)}
              {...register('name')}
            />

            {/* Description */}
            <FormTextarea
              label="Description"
              required
              placeholder="Enter product description"
              rows={4}
              error={getErrorMessage(errors.description)}
              helperText="Minimum 10 characters"
              {...register('description')}
            />

            {/* Price and Stock - Side by Side */}
            <div className="grid grid-cols-2 gap-4">
              <FormInput
                label="Price"
                required
                type="number"
                step="0.01"
                placeholder="0.00"
                error={getErrorMessage(errors.price)}
                {...register('price', { valueAsNumber: true })}
              />

              <FormInput
                label="Stock Quantity"
                required
                type="number"
                placeholder="0"
                error={getErrorMessage(errors.stock)}
                {...register('stock', { valueAsNumber: true })}
              />
            </div>

            {/* Category and SKU - Side by Side */}
            <div className="grid grid-cols-2 gap-4">
              <FormSelect
                label="Category"
                required
                placeholder="Select a category"
                options={categoryOptions}
                error={getErrorMessage(errors.category)}
                {...register('category')}
              />

              <FormInput
                label="SKU"
                required
                placeholder="Enter SKU"
                error={getErrorMessage(errors.sku)}
                helperText="Unique product identifier"
                {...register('sku')}
              />
            </div>

            {/* Low Stock Threshold */}
            <FormInput
              label="Low Stock Threshold"
              type="number"
              placeholder="10"
              error={getErrorMessage(errors.lowStockThreshold)}
              helperText="Alert when stock falls below this number"
              {...register('lowStockThreshold', { valueAsNumber: true })}
            />

            {/* Image URL */}
            <FormInput
              label="Image URL"
              type="url"
              placeholder="https://example.com/image.jpg"
              error={getErrorMessage(errors.imageUrl)}
              helperText="Optional product image"
              {...register('imageUrl')}
            />

            {/* Is Active */}
            <FormCheckbox
              label="Active Product"
              helperText="Inactive products are hidden from customers"
              {...register('isActive')}
            />

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                variant="primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating...' : 'Create Product'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.history.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
};

// Example with nested validation (shipping address)
export const ShippingAddressFormExample: React.FC = () => {
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useFormValidation({
    schema: createProductSchema, // Use appropriate schema
  });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Shipping Address</h3>

      <FormInput
        label="Street Address"
        required
        placeholder="123 Main St"
        error={getErrorMessage(errors.shippingAddress?.street)}
        {...register('shippingAddress.street')}
      />

      <FormInput
        label="State"
        required
        placeholder="NY"
        error={getErrorMessage(errors.shippingAddress?.state)}
        {...register('shippingAddress.state')}
      />
      <FormInput
        label="Area"
        required
        placeholder="Central Park"
        error={getErrorMessage(errors.shippingAddress?.area)}
        {...register('shippingAddress.area')}
      />

      <FormInput
        label="Phone Number"
        required
        type="tel"
        placeholder="+1234567890"
        error={getErrorMessage(errors.shippingAddress?.phone)}
        {...register('shippingAddress.phone')}
      />
    </div>
  );
};

// Example of using stores with forms
export const OrderFormWithStoreExample: React.FC = () => {
  // Import your stores
  // const { createOrder, isLoading } = useOrdersStore();
  // const { customers } = useCustomersStore();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useFormValidation({
    schema: createProductSchema, // Use createOrderSchema
  });

  const onSubmit = async (data: any) => {
    try {
      // await createOrder(data);
      // toast.success('Order created successfully');
      // navigate('/orders');
    } catch (error) {
      // Error is handled by store with toast
    }
  };

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6">Create Order</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Your form fields here */}
          <Button type="submit" disabled={isSubmitting}>
            Create Order
          </Button>
        </form>
      </div>
    </Card>
  );
};
