import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Copy, ExternalLink, Code2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../components/ui/Table';
import { CheckoutFormBuilder } from '../components/forms/CheckoutFormBuilder';
import { EmbedCodeModal } from '../components/forms/EmbedCodeModal';
import { CheckoutForm } from '../types/checkout-form';
import { Product } from '../types';
import { productsService } from '../services/products.service';
import { checkoutFormsService } from '../services/checkout-forms.service';

export const CheckoutForms: React.FC = () => {
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [selectedForm, setSelectedForm] = useState<CheckoutForm | undefined>();
  const [embedModalOpen, setEmbedModalOpen] = useState(false);
  const [selectedFormForEmbed, setSelectedFormForEmbed] = useState<CheckoutForm | null>(null);
  const [forms, setForms] = useState<CheckoutForm[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchForms();
    fetchProducts();
  }, []);

  const fetchForms = async () => {
    setIsLoading(true);
    try {
      const data = await checkoutFormsService.getCheckoutForms();
      setForms(data);
    } catch (error) {
      console.error('Failed to fetch forms:', error);
      alert('Failed to load checkout forms. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const data = await productsService.getProducts();
      setProducts(data);
    } catch (error) {
      console.error('Failed to fetch products:', error);
    }
  };

  const handleCreateForm = () => {
    setSelectedForm(undefined);
    setIsBuilderOpen(true);
  };

  const handleEditForm = (form: CheckoutForm) => {
    setSelectedForm(form);
    setIsBuilderOpen(true);
  };

  const handleSaveForm = async (formData: Partial<CheckoutForm>) => {
    try {
      // Validate product selection
      if (!formData.productId || formData.productId === 0) {
        alert('Please select a product for this checkout form.');
        return;
      }

      if (selectedForm) {
        await checkoutFormsService.updateCheckoutForm(selectedForm.id, formData);
        alert('Checkout form updated successfully!');
      } else {
        await checkoutFormsService.createCheckoutForm(formData);
        alert('Checkout form created successfully!');
      }
      setIsBuilderOpen(false);
      await fetchForms();
    } catch (error: any) {
      console.error('Failed to save form:', error);
      const errorMessage = error?.response?.data?.message || 'Failed to save checkout form. Please try again.';
      alert(errorMessage);
    }
  };

  const handleDeleteForm = async (id: number) => {
    if (!confirm('Are you sure you want to delete this checkout form?')) return;

    try {
      await checkoutFormsService.deleteCheckoutForm(id);
      alert('Checkout form deleted successfully!');
      await fetchForms();
    } catch (error: any) {
      console.error('Failed to delete form:', error);
      const errorMessage = error?.response?.data?.message || 'Failed to delete checkout form. Please try again.';
      alert(errorMessage);
    }
  };

  const handleDuplicateForm = async (form: CheckoutForm) => {
    try {
      // TODO: Duplicate form
      console.log('Duplicating form:', form);
      fetchForms();
    } catch (error) {
      console.error('Failed to duplicate form:', error);
    }
  };

  const handleToggleStatus = async (id: number, isActive: boolean) => {
    try {
      await checkoutFormsService.updateCheckoutForm(id, { isActive });
      await fetchForms();
    } catch (error: any) {
      console.error('Failed to toggle form status:', error);
      const errorMessage = error?.response?.data?.message || 'Failed to update form status. Please try again.';
      alert(errorMessage);
    }
  };

  const handleShowEmbedCode = (form: CheckoutForm) => {
    setSelectedFormForEmbed(form);
    setEmbedModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading checkout forms...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Checkout Forms</h1>
          <p className="text-gray-600 mt-1">
            Create and manage checkout forms for your products
          </p>
        </div>
        <Button onClick={handleCreateForm}>
          <Plus className="w-5 h-5 mr-2" />
          Create Form
        </Button>
      </div>

      {forms.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Plus className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No checkout forms yet
            </h3>
            <p className="text-gray-600 mb-6">
              Get started by creating your first checkout form
            </p>
            <Button onClick={handleCreateForm}>
              <Plus className="w-5 h-5 mr-2" />
              Create Your First Form
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell isHeader>Name</TableCell>
                <TableCell isHeader>Description</TableCell>
                <TableCell isHeader>Fields</TableCell>
                <TableCell isHeader>Packages</TableCell>
                <TableCell isHeader>Upsells</TableCell>
                <TableCell isHeader>Status</TableCell>
                <TableCell isHeader>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {forms.map(form => (
                <TableRow key={form.id}>
                  <TableCell className="font-medium">
                    {form.name || 'Untitled Form'}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {form.description || 'No description'}
                  </TableCell>
                  <TableCell>{form.fields.length}</TableCell>
                  <TableCell>{form.packages.length}</TableCell>
                  <TableCell>{form.upsells.length}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={form.isActive ? 'success' : 'secondary'}>
                        {form.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.isActive}
                          onChange={(e) => handleToggleStatus(form.id, e.target.checked)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                      </label>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleEditForm(form)}
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDuplicateForm(form)}
                        title="Clone"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => window.open(`/order/${form.slug}`, '_blank')}
                        title="Preview"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleShowEmbedCode(form)}
                        title="Get Embed Code"
                      >
                        <Code2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDeleteForm(form.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <CheckoutFormBuilder
        isOpen={isBuilderOpen}
        onClose={() => {
          setIsBuilderOpen(false);
          setSelectedForm(undefined);
        }}
        onSave={handleSaveForm}
        initialData={selectedForm}
        products={products}
      />

      <EmbedCodeModal
        isOpen={embedModalOpen}
        form={selectedFormForEmbed}
        onClose={() => {
          setEmbedModalOpen(false);
          setSelectedFormForEmbed(null);
        }}
      />
    </div>
  );
};
