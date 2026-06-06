import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Copy, ExternalLink } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Loading } from '../components/ui/Loading';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../components/ui/Table';
import { CopyURLButton, CopyEmbedButton } from '../components/forms/CopyActions';
import { CheckoutForm } from '../types/checkout-form';
import { checkoutFormsService } from '../services/checkout-forms.service';

export const CheckoutForms: React.FC = () => {
  const navigate = useNavigate();
  const [forms, setForms] = useState<CheckoutForm[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchForms();
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

  const handleCreateForm = () => navigate('/checkout-forms/new');

  const handleEditForm = (form: CheckoutForm) => navigate(`/checkout-forms/${form.id}/edit`);

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

  if (isLoading) {
    return (
      <div className="py-16">
        <Loading />
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
                        onClick={() => window.open(`/form/${form.slug}`, '_blank')}
                        title="Preview"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                      <CopyURLButton form={form} />
                      <CopyEmbedButton form={form} />
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
          <p className="text-xs text-gray-500 mt-3 px-4 pb-3">
            Need help embedding? See{' '}
            <a
              href="/docs/embed.md"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              docs/embed.md
            </a>{' '}
            for WordPress, Shopify and custom HTML steps.
          </p>
        </Card>
      )}
    </div>
  );
};
