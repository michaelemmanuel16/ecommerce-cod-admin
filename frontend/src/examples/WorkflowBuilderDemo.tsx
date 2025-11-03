import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  TriggerSelector,
  ConditionBuilder,
  WorkflowCanvas,
  AssignUserAction,
  ConditionGroup,
  AssignUserConfig,
} from '../components/workflows';
import { ChevronRight, Save } from 'lucide-react';

/**
 * Demo page showcasing the visual workflow builder components
 *
 * This page demonstrates:
 * 1. TriggerSelector - Card-based trigger selection
 * 2. ConditionBuilder - Visual IF/ELSE builder
 * 3. AssignUserAction - User assignment with traffic distribution
 * 4. WorkflowCanvas - Node-based workflow visualization
 */
export const WorkflowBuilderDemo: React.FC = () => {
  const [selectedTrigger, setSelectedTrigger] = useState<string>('status_change');
  const [conditions, setConditions] = useState<ConditionGroup>({
    id: 'root',
    operator: 'AND',
    rules: [],
  });
  const [assignUserConfig, setAssignUserConfig] = useState<AssignUserConfig>({
    userType: 'sales_rep',
    assignments: [],
    distributionMode: 'even',
    onlyUnassigned: true,
  });

  const handleSaveWorkflow = () => {
    const workflow = {
      trigger: selectedTrigger,
      conditions,
      actions: {
        assignUser: assignUserConfig,
      },
    };
    console.log('Workflow Configuration:', workflow);
    alert('Workflow saved! Check console for details.');
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Visual Workflow Builder Demo
          </h1>
          <p className="text-gray-600">
            Interactive demonstration of workflow builder components
          </p>
        </div>
        <Button variant="primary" onClick={handleSaveWorkflow}>
          <Save className="w-4 h-4 mr-2" />
          Save Workflow
        </Button>
      </div>

      {/* Step 1: Trigger Selection */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500 text-white font-bold">
            1
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            Select Trigger
          </h2>
        </div>
        <TriggerSelector
          selectedTrigger={selectedTrigger}
          onSelectTrigger={setSelectedTrigger}
        />
      </Card>

      {/* Arrow */}
      <div className="flex justify-center">
        <ChevronRight className="w-6 h-6 text-gray-400 rotate-90" />
      </div>

      {/* Step 2: Define Conditions */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500 text-white font-bold">
            2
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            Define Conditions (Optional)
          </h2>
        </div>
        <ConditionBuilder
          conditions={conditions}
          onChange={setConditions}
        />
      </Card>

      {/* Arrow */}
      <div className="flex justify-center">
        <ChevronRight className="w-6 h-6 text-gray-400 rotate-90" />
      </div>

      {/* Step 3: Configure Actions */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500 text-white font-bold">
            3
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            Configure Actions
          </h2>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Assign User Action
          </h3>
          <AssignUserAction
            config={assignUserConfig}
            onChange={setAssignUserConfig}
          />
        </div>
      </Card>

      {/* Arrow */}
      <div className="flex justify-center">
        <ChevronRight className="w-6 h-6 text-gray-400 rotate-90" />
      </div>

      {/* Step 4: Visual Workflow Preview */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-500 text-white font-bold">
            4
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            Workflow Visualization
          </h2>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          This is a visual representation of your workflow. Drag nodes to rearrange,
          and connect them to define the flow.
        </p>
        <WorkflowCanvas />
      </Card>

      {/* Summary Card */}
      <Card className="bg-blue-50 border-blue-200">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">
          Current Configuration Summary
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="font-medium text-blue-900">Trigger:</span>
            <span className="text-blue-700">{selectedTrigger}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-blue-900">Conditions:</span>
            <span className="text-blue-700">
              {conditions.rules.length === 0
                ? 'None (apply to all)'
                : `${conditions.rules.length} rule(s) with ${conditions.operator} logic`}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-blue-900">Actions:</span>
            <span className="text-blue-700">
              Assign to {assignUserConfig.assignments.length}{' '}
              {assignUserConfig.userType === 'sales_rep' ? 'sales rep(s)' : 'delivery agent(s)'}{' '}
              ({assignUserConfig.distributionMode} distribution)
            </span>
          </div>
        </div>
      </Card>

      {/* Instructions */}
      <Card className="bg-gray-50">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          How to Use These Components
        </h3>
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-1">1. TriggerSelector</h4>
            <p>
              Select what event will start the workflow. Click on any trigger card
              to select it. The selected trigger will be highlighted in blue.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-1">2. ConditionBuilder</h4>
            <p>
              Add conditions to control when the workflow executes. Click "Add Rule"
              to create a new condition. Use AND/OR toggle to change logic between rules.
              The visual logic display shows the complete condition statement.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-1">3. AssignUserAction</h4>
            <p>
              Configure user assignment with traffic distribution. Choose between
              sales reps or delivery agents, select users, and set distribution mode.
              In weighted mode, adjust sliders to control the percentage of orders
              assigned to each user. The visual preview shows the traffic distribution.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-1">4. WorkflowCanvas</h4>
            <p>
              Visualize the complete workflow as a node graph. The canvas shows
              triggers (blue), conditions (purple diamonds), and actions (white boxes).
              Drag nodes to rearrange, use controls to zoom/pan, and see the minimap
              for navigation.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default WorkflowBuilderDemo;
