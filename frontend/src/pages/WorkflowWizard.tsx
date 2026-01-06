import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { WizardStepper, Step } from '../components/workflows/WizardStepper';
import { workflowsService } from '../services/workflows.service';
import { ConditionGroup } from '../components/workflows/ConditionBuilder';

// Step Components (to be created)
import { BasicInfoStep } from '../components/workflows/steps/BasicInfoStep';
import { TriggerStep } from '../components/workflows/steps/TriggerStep';
import { ConditionsStep } from '../components/workflows/steps/ConditionsStep';
import { ActionsStep } from '../components/workflows/steps/ActionsStep';
import { ReviewStep } from '../components/workflows/steps/ReviewStep';

export interface WorkflowAction {
  id: string;
  type: string;
  config: any;
  conditions?: ConditionGroup;
}

export interface WorkflowFormData {
  name: string;
  description: string;
  isActive: boolean;
  triggerType: string;
  triggerConfig: any;
  conditions?: ConditionGroup;
  actions: WorkflowAction[];
}

const wizardSteps: Step[] = [
  { id: 1, title: 'Basic Info', description: 'Name and details' },
  { id: 2, title: 'Trigger', description: 'When to run' },
  { id: 3, title: 'Conditions', description: 'Optional filters' },
  { id: 4, title: 'Actions', description: 'What to do' },
  { id: 5, title: 'Review', description: 'Test and save' },
];

export const WorkflowWizard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const isEditMode = id && id !== 'new';

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form data
  const [formData, setFormData] = useState<WorkflowFormData>({
    name: '',
    description: '',
    isActive: true,
    triggerType: 'order_created',
    triggerConfig: {},
    conditions: undefined,
    actions: [],
  });

  // Load workflow if editing
  useEffect(() => {
    if (isEditMode) {
      loadWorkflow();
    }

    // Check if template was passed from workflows page
    if (location.state?.template) {
      loadTemplate(location.state.template);
    }
  }, [id]);

  const loadWorkflow = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await workflowsService.getWorkflow(id);
      setFormData({
        name: data.name || '',
        description: data.description || '',
        isActive: data.isActive !== undefined ? data.isActive : true,
        triggerType: data.triggerType || 'order_created',
        triggerConfig: data.triggerData || {},
        conditions: data.conditions,
        actions: Array.isArray(data.actions) ? data.actions : [],
      });
    } catch (error) {
      console.error('Error loading workflow:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplate = (template: any) => {
    setFormData({
      name: template.name || '',
      description: template.description || '',
      isActive: true,
      triggerType: template.trigger?.type || 'order_created',
      triggerConfig: template.trigger?.config || {},
      conditions: template.conditions,
      actions: template.actions || [],
    });
  };

  const updateFormData = (updates: Partial<WorkflowFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    if (currentStep < wizardSteps.length) {
      setCurrentStep((prev) => prev + 1);
      // Scroll to top when changing steps
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleStepClick = (stepId: number) => {
    if (stepId < currentStep) {
      setCurrentStep(stepId);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSave = async (activate: boolean = false) => {
    // Validate required fields
    if (!formData.name.trim()) {
      alert('Please enter a workflow name');
      return;
    }

    if (formData.actions.length === 0) {
      alert('Please add at least one action');
      return;
    }

    setSaving(true);
    try {
      const workflowData = {
        name: formData.name,
        description: formData.description,
        triggerType: formData.triggerType as any,
        triggerData: formData.triggerConfig,
        conditions: formData.conditions,
        actions: formData.actions,
        isActive: activate ? true : formData.isActive,
      };

      if (isEditMode && id) {
        await workflowsService.updateWorkflow(id, workflowData);
      } else {
        await workflowsService.createWorkflow(workflowData);
      }

      navigate('/workflows');
    } catch (error) {
      console.error('Error saving workflow:', error);
      alert('Failed to save workflow. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return formData.name.trim().length > 0;
      case 2:
        return formData.triggerType.length > 0;
      case 3:
        return true; // Conditions are optional
      case 4:
        return formData.actions.length > 0;
      case 5:
        return true;
      default:
        return false;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-8">
      {/* Header */}
      <div className="mb-4">
        <Button
          variant="ghost"
          onClick={() => navigate('/workflows')}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Workflows
        </Button>
        <h1 className="text-2xl font-bold text-gray-900">
          {isEditMode ? 'Edit Workflow' : 'Create New Workflow'}
        </h1>
      </div>

      {/* Progress Stepper */}
      <WizardStepper
        steps={wizardSteps}
        currentStep={currentStep}
        onStepClick={handleStepClick}
      />

      {/* Step Content */}
      <div className="mt-8">
        {currentStep === 1 && (
          <BasicInfoStep
            formData={formData}
            onUpdate={updateFormData}
          />
        )}

        {currentStep === 2 && (
          <TriggerStep
            formData={formData}
            onUpdate={updateFormData}
          />
        )}

        {currentStep === 3 && (
          <ConditionsStep
            formData={formData}
            onUpdate={updateFormData}
          />
        )}

        {currentStep === 4 && (
          <ActionsStep
            formData={formData}
            onUpdate={updateFormData}
          />
        )}

        {currentStep === 5 && (
          <ReviewStep
            formData={formData}
            isEditMode={isEditMode}
            workflowId={id}
            onEdit={(stepId) => setCurrentStep(stepId)}
            onSave={handleSave}
            onBack={handleBack}
            saving={saving}
          />
        )}
      </div>

      {/* Navigation Footer - Only show for steps 1-4 */}
      {currentStep < 5 && (
        <div className="mt-8 flex items-center justify-between border-t border-gray-200 pt-6">
          <div>
            {currentStep > 1 && (
              <Button variant="ghost" onClick={handleBack}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/workflows')}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleNext}
              disabled={!canProceed()}
            >
              Next: {wizardSteps[currentStep]?.title || 'Continue'}
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
