import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ArrowLeft, Upload, X } from 'lucide-react';
import { productsService } from '../services/products.service';
import { Product } from '../types';
import { apiClient } from '../services/api';
import { useConfigStore } from '../stores/configStore';
import { getCurrencySymbol } from '../utils/countries';

export const ProductForm: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEditMode = Boolean(id);
    const { currency } = useConfigStore();
    const currencySymbol = getCurrencySymbol(currency);

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string>('');
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        sku: '',
        price: '',
        cogs: '',
        stockQuantity: '',
        lowStockThreshold: '10',
        category: '',
        imageUrl: '',
        isActive: true,
    });

    useEffect(() => {
        if (isEditMode && id) {
            loadProduct();
        }
    }, [id]);

    const loadProduct = async () => {
        if (!id) return;
        const numericId = parseInt(id, 10);
        if (isNaN(numericId)) {
            console.error('Invalid product ID');
            return;
        }

        setLoading(true);
        try {
            const product = await productsService.getProductById(numericId);

            // Handle case where product data might be incomplete
            if (!product) {
                throw new Error('Product not found');
            }

            setFormData({
                name: product.name || '',
                description: product.description || '',
                sku: product.sku || '',
                price: product.price?.toString() || '',
                cogs: product.cogs?.toString() || '',
                stockQuantity: (product.stockQuantity ?? product.stock ?? 0).toString(),
                lowStockThreshold: (product.lowStockThreshold ?? 10).toString(),
                category: product.category || '',
                imageUrl: product.imageUrl || '',
                isActive: product.isActive ?? true,
            });

            if (product.imageUrl) {
                setImagePreview(product.imageUrl);
            }
        } catch (error: any) {
            console.error('Error loading product:', error);
            const message = error.response?.data?.message || error.message || 'Failed to load product';
            alert(message);
            // Navigate back to products list if product not found
            if (error.response?.status === 404 || error.response?.status === 401) {
                navigate('/products');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;

        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Validate file type
            if (!file.type.startsWith('image/')) {
                alert('Please select an image file');
                return;
            }
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert('Image size should be less than 5MB');
                return;
            }

            setImageFile(file);

            // Create preview
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRemoveImage = () => {
        setImageFile(null);
        setImagePreview('');
        setFormData((prev) => ({ ...prev, imageUrl: '' }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!formData.name.trim()) {
            alert('Product name is required');
            return;
        }
        if (!formData.sku.trim()) {
            alert('SKU is required');
            return;
        }
        if (!formData.price || parseFloat(formData.price) <= 0) {
            alert('Valid price is required');
            return;
        }
        if (!formData.cogs || parseFloat(formData.cogs) <= 0) {
            alert('Valid cost price is required');
            return;
        }
        if (!formData.stockQuantity || parseInt(formData.stockQuantity) < 0) {
            alert('Valid stock quantity is required');
            return;
        }

        setSaving(true);
        try {
            let finalImageUrl = formData.imageUrl;

            // If there's a new image file, upload it first
            if (imageFile) {
                const formDataUpload = new FormData();
                formDataUpload.append('image', imageFile);

                try {
                    // Upload image to server using apiClient (includes auth token)
                    const uploadResponse = await apiClient.post('/api/upload', formDataUpload, {
                        headers: {
                            'Content-Type': 'multipart/form-data',
                        },
                    });

                    finalImageUrl = uploadResponse.data.url || uploadResponse.data.imageUrl;
                } catch (uploadError) {
                    console.error('Image upload failed:', uploadError);
                    alert('Failed to upload image. Product will be saved without image.');
                    finalImageUrl = '';
                }
            }

            const productData = {
                name: formData.name.trim(),
                description: formData.description.trim(),
                sku: formData.sku.trim().toUpperCase(),
                price: parseFloat(formData.price),
                cogs: parseFloat(formData.cogs),
                stockQuantity: parseInt(formData.stockQuantity),
                lowStockThreshold: parseInt(formData.lowStockThreshold),
                category: formData.category.trim(),
                imageUrl: finalImageUrl || undefined,
                isActive: formData.isActive,
            };

            if (isEditMode && id) {
                const numericId = parseInt(id, 10);
                if (isNaN(numericId)) throw new Error('Invalid product ID');
                await productsService.updateProduct(numericId, productData);
            } else {
                await productsService.createProduct(productData);
            }

            navigate('/products');
        } catch (error: any) {
            console.error('Error saving product:', error);
            alert(error.response?.data?.message || 'Failed to save product');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-gray-500">Loading product...</div>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <Button
                    variant="ghost"
                    onClick={() => navigate('/products')}
                    className="mb-4"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Products
                </Button>
                <h1 className="text-2xl font-bold text-gray-900">
                    {isEditMode ? 'Edit Product' : 'Add New Product'}
                </h1>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit}>
                <Card className="mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Product Information
                    </h2>
                    <div className="space-y-4">
                        <Input
                            label="Product Name"
                            name="name"
                            value={formData.name}
                            onChange={handleInputChange}
                            placeholder="e.g., Wireless Bluetooth Headphones"
                            required
                        />

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Description
                            </label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleInputChange}
                                placeholder="Detailed product description..."
                                rows={4}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="SKU"
                                name="sku"
                                value={formData.sku}
                                onChange={handleInputChange}
                                placeholder="e.g., PROD-001"
                                required
                                disabled={isEditMode}
                            />
                            <Input
                                label="Category"
                                name="category"
                                value={formData.category}
                                onChange={handleInputChange}
                                placeholder="e.g., Electronics"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Product Image
                            </label>
                            {imagePreview ? (
                                <div className="relative inline-block">
                                    <img
                                        src={imagePreview}
                                        alt="Product preview"
                                        className="w-32 h-32 object-cover rounded-lg border-2 border-gray-200"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleRemoveImage}
                                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                                        title="Remove image"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
                                    <input
                                        type="file"
                                        id="image-upload"
                                        accept="image/*"
                                        onChange={handleImageChange}
                                        className="hidden"
                                    />
                                    <label
                                        htmlFor="image-upload"
                                        className="cursor-pointer flex flex-col items-center"
                                    >
                                        <Upload className="w-12 h-12 text-gray-400 mb-2" />
                                        <span className="text-sm text-gray-600 mb-1">
                                            Click to upload product image
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            PNG, JPG, GIF up to 5MB
                                        </span>
                                    </label>
                                </div>
                            )}
                        </div>
                    </div>
                </Card>

                <Card className="mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Pricing & Inventory
                    </h2>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label={`Selling Price (${currencySymbol})`}
                                name="price"
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.price}
                                onChange={handleInputChange}
                                placeholder="0.00"
                                required
                            />
                            <Input
                                label={`Cost Price (${currencySymbol})`}
                                name="cogs"
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.cogs}
                                onChange={handleInputChange}
                                placeholder="0.00"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="Stock Quantity"
                                name="stockQuantity"
                                type="number"
                                min="0"
                                value={formData.stockQuantity}
                                onChange={handleInputChange}
                                placeholder="0"
                                required
                            />
                            <div className="flex items-center pt-7 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                                <span className="text-sm text-gray-600 mr-2">Profit Margin:</span>
                                <span className="text-sm font-semibold text-green-600">
                                    {formData.price && formData.cogs
                                        ? `${currencySymbol}${(parseFloat(formData.price) - parseFloat(formData.cogs)).toFixed(2)} (${(((parseFloat(formData.price) - parseFloat(formData.cogs)) / parseFloat(formData.price)) * 100).toFixed(1)}%)`
                                        : '—'}
                                </span>
                            </div>
                        </div>

                        <Input
                            label="Low Stock Threshold"
                            name="lowStockThreshold"
                            type="number"
                            min="0"
                            value={formData.lowStockThreshold}
                            onChange={handleInputChange}
                            placeholder="10"
                        />
                        <p className="text-sm text-gray-500 -mt-2">
                            Alert when stock falls below this number
                        </p>

                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                id="isActive"
                                name="isActive"
                                checked={formData.isActive}
                                onChange={handleInputChange}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
                                Active (product is available for sale)
                            </label>
                        </div>
                    </div>
                </Card>

                {/* Actions */}
                <div className="flex justify-end gap-3 pb-8">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => navigate('/products')}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={saving}>
                        {saving
                            ? 'Saving...'
                            : isEditMode
                                ? 'Update Product'
                                : 'Create Product'}
                    </Button>
                </div>
            </form>
        </div>
    );
};
