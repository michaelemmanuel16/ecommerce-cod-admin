import React, { useState } from 'react';
import { Sparkles, FileText, ChevronRight } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { WorkflowTemplateGallery } from '../WorkflowTemplateGallery';
import { WorkflowFormData } from '../../../pages/WorkflowWizard';

interface BasicInfoStepProps {
  formData: WorkflowFormData;
  onUpdate: (updates: Partial<WorkflowFormData>) => void;
  onNext: () => void;
}

export const BasicInfoStep: React.FC<BasicInfoStepProps> = ({
  formData,
  onUpdate,
  onNext,
}) => {
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);

  const handleSelectTemplate = (template: any) => {
    onUpdate({
      name: template.name || '',
      description: template.description || '',
      triggerType: template.trigger?.type || 'order_created',
      triggerConfig: template.trigger?.config || {},
      conditions: template.conditions,
      actions: template.actions || [],
    });
    setShowTemplateGallery(false);
  };

  const handleNext = () => {
    if (formData.name.trim()) {
      onNext();
    }
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Basic Information</h2>
        <p className="text-gray-600 mt-2">
          Start with a template or create your workflow from scratch
        </p>
      </div>

      {/* Template Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Start from Template Card */}
        <button
          onClick={() => setShowTemplateGallery(true)}
          className="relative p-6 rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 text-left group focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Start from Template
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Choose from 12+ pre-built workflow templates to get started quickly
            </p>
            <div className="text-blue-600 font-medium flex items-center">
              Browse Templates
              <ChevronRight className="w-4 h-4 ml-1" />
            </div>
          </div>
        </button>

        {/* Blank Workflow Card */}
        <div className="relative p-6 rounded-lg border-2 border-gray-300 bg-gray-50">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-gray-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Blank Workflow
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Start fresh with no preset configuration
            </p>
            <div className="text-gray-500 font-medium">
              Continue below →
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="relative flex items-center">
        <div className="flex-grow border-t border-gray-300"></div>
        <span className="flex-shrink mx-4 text-gray-500 text-sm font-medium">
          OR ENTER DETAILS MANUALLY
        </span>
        <div className="flex-grow border-t border-gray-300"></div>
      </div>

      {/* Form Fields */}
      <Card>
        <div className="space-y-6">
          <div>
            <Input
              label="Workflow Name"
              value={formData.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder="e.g., Auto-assign orders by product type"
              required
              className="text-lg"
            />
            <p className="text-xs text-gray-500 mt-2">
              Give your workflow a clear, descriptive name
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="Describe what this workflow does and when it should be used..."
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-500 mt-2">
              Help others understand the purpose of this workflow
            </p>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => onUpdate({ isActive: e.target.checked })}
                  className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                />
              </div>
              <div className="ml-3">
                <label
                  htmlFor="isActive"
                  className="font-medium text-gray-900 cursor-pointer"
                >
                  Activate workflow immediately
                </label>
                <p className="text-sm text-gray-600 mt-1">
                  When enabled, this workflow will run automatically based on the trigger you configure
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Help Text */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-blue-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              What's next?
            </h3>
            <p className="mt-1 text-sm text-blue-700">
              After completing this step, you'll configure when this workflow should run (trigger),
              add conditions to filter when it executes, and define what actions it should perform.
            </p>
          </div>
        </div>
      </div>

      {/* Template Gallery Modal */}
      {showTemplateGallery && (
        <WorkflowTemplateGallery
          onSelectTemplate={handleSelectTemplate}
          onClose={() => setShowTemplateGallery(false)}
        />
      )}

      {/* Next Button - Prominent */}
      <div className="flex justify-end pt-4">
        <Button
          variant="primary"
          onClick={handleNext}
          disabled={!formData.name.trim()}
          size="lg"
          className="min-w-[200px]"
        >
          Next: Choose Trigger
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
};
