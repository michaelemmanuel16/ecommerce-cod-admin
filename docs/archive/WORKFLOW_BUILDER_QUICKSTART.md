# Workflow Builder - Quick Start Guide

## Installation Complete ✅

The visual workflow builder has been successfully set up with the following components:

### 📦 Installed Dependencies
- `@xyflow/react@12.8.6` - For the workflow canvas

### 🎨 Components Created

1. **TriggerSelector** (`frontend/src/components/workflows/TriggerSelector.tsx`)
   - Card-based trigger selection UI
   - 6 pre-configured trigger types
   - Visual feedback and hover effects

2. **ConditionBuilder** (`frontend/src/components/workflows/ConditionBuilder.tsx`)
   - Visual IF/ELSE builder
   - Multiple rules with AND/OR logic
   - Field/operator/value configuration
   - Live condition preview

3. **AssignUserAction** (`frontend/src/components/workflows/actions/AssignUserAction.tsx`)
   - User assignment with traffic distribution
   - Even split or weighted split modes
   - Real-time validation (weights must total 100%)
   - Visual distribution preview

4. **WorkflowCanvas** (`frontend/src/components/workflows/WorkflowCanvas.tsx`)
   - Node-based workflow visualization
   - Drag-and-drop interface
   - Custom node types (Trigger, Condition, Action)
   - Zoom/pan controls and minimap

5. **Demo Page** (`frontend/src/examples/WorkflowBuilderDemo.tsx`)
   - Complete working example
   - Step-by-step workflow creation
   - Usage instructions

---

## 🚀 Quick Start

### 1. View the Demo

Add this route to your `App.tsx`:

```tsx
import WorkflowBuilderDemo from './examples/WorkflowBuilderDemo';

// In your Routes:
<Route path="/workflow-builder-demo" element={<WorkflowBuilderDemo />} />
```

Then navigate to: `http://localhost:5173/workflow-builder-demo`

### 2. Use in Your Code

```tsx
import {
  TriggerSelector,
  ConditionBuilder,
  AssignUserAction,
  WorkflowCanvas,
} from '../components/workflows';

// ... use components
```

---

## 📝 Basic Usage Example

```tsx
import React, { useState } from 'react';
import { TriggerSelector, ConditionBuilder, AssignUserAction } from './components/workflows';

const MyWorkflowEditor = () => {
  // Trigger
  const [trigger, setTrigger] = useState('status_change');

  // Conditions
  const [conditions, setConditions] = useState({
    id: 'root',
    operator: 'AND',
    rules: [],
  });

  // Actions
  const [assignConfig, setAssignConfig] = useState({
    userType: 'sales_rep',
    assignments: [],
    distributionMode: 'even',
    onlyUnassigned: true,
  });

  const handleSave = async () => {
    const workflow = {
      name: 'My Workflow',
      triggerType: trigger,
      conditions: conditions,
      actions: [{ type: 'assign_user', config: assignConfig }],
    };

    await workflowsService.createWorkflow(workflow);
  };

  return (
    <div>
      <TriggerSelector selectedTrigger={trigger} onSelectTrigger={setTrigger} />
      <ConditionBuilder conditions={conditions} onChange={setConditions} />
      <AssignUserAction config={assignConfig} onChange={setAssignConfig} />
      <button onClick={handleSave}>Save Workflow</button>
    </div>
  );
};
```

---

## 🎯 Key Features

### TriggerSelector
✅ 6 trigger types (Order Created, Status Changed, Payment, Time-Based, Manual, Webhook)
✅ Card-based UI with icons
✅ Visual selection feedback
✅ Responsive grid layout

### ConditionBuilder
✅ Add/remove rules dynamically
✅ 8 field types (Order Total, Product Name, Status, etc.)
✅ Context-aware operators
✅ AND/OR toggle
✅ Visual logic preview

### AssignUserAction
✅ Sales Reps or Delivery Agents selection
✅ Even split mode (automatic)
✅ Weighted split mode (custom percentages)
✅ Real-time validation
✅ Visual traffic preview
✅ Only unassigned orders option

### WorkflowCanvas
✅ Drag-and-drop nodes
✅ Custom node types (Trigger/Condition/Action)
✅ Animated connections
✅ Zoom/pan controls
✅ Minimap navigation
✅ Read-only mode

---

## 📁 File Locations

```
frontend/
├── src/
│   ├── components/
│   │   └── workflows/
│   │       ├── TriggerSelector.tsx
│   │       ├── ConditionBuilder.tsx
│   │       ├── WorkflowCanvas.tsx
│   │       ├── actions/
│   │       │   └── AssignUserAction.tsx
│   │       └── index.ts
│   └── examples/
│       └── WorkflowBuilderDemo.tsx
└── WORKFLOW_BUILDER_COMPONENTS.md (detailed docs)
```

---

## 🔧 Integration Options

### Option 1: Replace Current Editor
Replace the existing form-based workflow editor with the new visual components.

### Option 2: Add Visual Mode
Add a toggle in the current editor to switch between "Simple" and "Visual" modes.

### Option 3: New Advanced Editor
Create a new route `/workflows/visual-editor/:id` for the visual builder.

---

## ✅ Validation

All components include validation:
- TriggerSelector: Ensures a trigger is selected
- ConditionBuilder: Validates rule completeness
- AssignUserAction: Validates weights total 100% in weighted mode
- WorkflowCanvas: Validates node connections

---

## 🎨 Styling

All components use:
- **Tailwind CSS** - Consistent with the rest of the app
- **Responsive design** - Mobile-friendly
- **Smooth animations** - Professional feel
- **Accessibility** - ARIA labels, keyboard navigation

---

## 🧪 Testing Recommendations

### Unit Tests
```tsx
// Example test for TriggerSelector
describe('TriggerSelector', () => {
  it('should call onSelectTrigger when trigger is clicked', () => {
    const onSelect = jest.fn();
    render(<TriggerSelector onSelectTrigger={onSelect} />);
    fireEvent.click(screen.getByText('Order Created'));
    expect(onSelect).toHaveBeenCalledWith('order_created');
  });
});
```

### Integration Tests
- Test full workflow creation flow
- Verify API calls with correct data structure
- Test error handling

---

## 🐛 Known Issues

None currently. All components are working correctly with no TypeScript errors.

The pre-existing TypeScript errors in other files are unrelated to the workflow builder:
- `src/hooks/usePermissions.ts` - Role type mismatch
- `src/pages/CustomerDetails.tsx` - Filter options
- `src/pages/Customers.tsx` - Card onClick prop

---

## 📚 Next Steps

1. **View the Demo**: Navigate to `/workflow-builder-demo`
2. **Review Components**: Check out each component file
3. **Read Full Docs**: See `WORKFLOW_BUILDER_COMPONENTS.md` for details
4. **Integrate**: Choose an integration option above
5. **Customize**: Adapt components to your specific needs

---

## 💡 Usage Tips

### TriggerSelector
- Use clear, descriptive trigger labels
- Add more triggers by extending the `triggerTypes` array

### ConditionBuilder
- Start with simple rules, add complexity as needed
- Use the visual preview to verify logic
- Consider limits on number of rules (recommend max 10)

### AssignUserAction
- Even split is recommended for most use cases
- Use weighted split for advanced load balancing
- Consider adding a "preview" mode before saving

### WorkflowCanvas
- Keep workflows simple (max 10-15 nodes)
- Use clear node labels
- Consider auto-layout for complex workflows

---

## 🤝 Contributing

To extend the workflow builder:

1. **New Action Types**: Create new components in `actions/` directory
2. **New Field Types**: Add to `fieldOptions` in ConditionBuilder
3. **New Trigger Types**: Add to `triggerTypes` in TriggerSelector
4. **Custom Node Types**: Add to `nodeTypes` in WorkflowCanvas

---

## 📞 Support

- Full documentation: `WORKFLOW_BUILDER_COMPONENTS.md`
- Demo page: `/workflow-builder-demo`
- Component source: `frontend/src/components/workflows/`

---

**Status:** ✅ Ready to Use
**Version:** 1.0.0
**Last Updated:** January 2025
