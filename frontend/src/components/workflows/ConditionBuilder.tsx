import React from 'react';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';

export interface ConditionRule {
  id: string;
  field: string;
  operator: string;
  value: string;
}

export interface ConditionGroup {
  id: string;
  logic: 'AND' | 'OR';
  rules: ConditionRule[];
}

interface ConditionBuilderProps {
  conditions?: ConditionGroup;
  onChange: (conditions?: ConditionGroup) => void;
}

const fieldOptions = [
  { value: 'orderTotal', label: 'Order Total' },
  { value: 'productName', label: 'Product Name' },
  { value: 'customerType', label: 'Customer Type' },
  { value: 'status', label: 'Order Status' },
  { value: 'paymentMethod', label: 'Payment Method' },
  { value: 'state', label: 'State' },
  { value: 'country', label: 'Country' },
  { value: 'itemCount', label: 'Item Count' },
];

const operatorOptions: Record<string, { value: string; label: string }[]> = {
  orderTotal: [
    { value: 'equals', label: 'Equals' },
    { value: 'greaterThan', label: 'Greater Than' },
    { value: 'lessThan', label: 'Less Than' },
    { value: 'between', label: 'Between' },
  ],
  itemCount: [
    { value: 'equals', label: 'Equals' },
    { value: 'greaterThan', label: 'Greater Than' },
    { value: 'lessThan', label: 'Less Than' },
  ],
  productName: [
    { value: 'equals', label: 'Equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'startsWith', label: 'Starts With' },
  ],
  customerType: [
    { value: 'equals', label: 'Equals' },
    { value: 'in', label: 'Is One Of' },
  ],
  status: [
    { value: 'equals', label: 'Equals' },
    { value: 'in', label: 'Is One Of' },
  ],
  paymentMethod: [
    { value: 'equals', label: 'Equals' },
    { value: 'in', label: 'Is One Of' },
  ],
  state: [
    { value: 'equals', label: 'Equals' },
    { value: 'contains', label: 'Contains' },
  ],
  country: [
    { value: 'equals', label: 'Equals' },
    { value: 'in', label: 'Is One Of' },
  ],
};

export const ConditionBuilder: React.FC<ConditionBuilderProps> = ({
  conditions,
  onChange,
}) => {
  const addRule = () => {
    const newRule: ConditionRule = {
      id: `rule-${Date.now()}`,
      field: 'orderTotal',
      operator: 'greaterThan',
      value: '',
    };

    if (!conditions || !conditions.rules) {
      onChange({
        id: `group-${Date.now()}`,
        logic: 'AND',
        rules: [newRule],
      });
    } else {
      onChange({
        ...conditions,
        rules: [...conditions.rules, newRule],
      });
    }
  };

  const removeRule = (ruleId: string) => {
    if (!conditions || !conditions.rules) return;

    const newRules = conditions.rules.filter((rule) => rule.id !== ruleId);

    if (newRules.length === 0) {
      onChange(undefined);
    } else {
      onChange({
        ...conditions,
        rules: newRules,
      });
    }
  };

  const updateRule = (
    ruleId: string,
    field: keyof ConditionRule,
    value: string
  ) => {
    if (!conditions || !conditions.rules) return;

    onChange({
      ...conditions,
      rules: conditions.rules.map((rule) => {
        if (rule.id === ruleId) {
          // Reset operator when field changes
          if (field === 'field') {
            const defaultOperator = operatorOptions[value]?.[0]?.value || 'equals';
            return { ...rule, field: value, operator: defaultOperator, value: '' };
          }
          return { ...rule, [field]: value };
        }
        return rule;
      }),
    });
  };

  const toggleOperator = () => {
    if (!conditions) return;

    onChange({
      ...conditions,
      logic: conditions.logic === 'AND' ? 'OR' : 'AND',
    });
  };

  const getOperatorsForField = (field: string) => {
    return operatorOptions[field] || [{ value: 'equals', label: 'Equals' }];
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            Conditions
          </h3>
          <p className="text-sm text-gray-600">
            Define rules for when this workflow should execute
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={addRule}>
          <Plus className="w-4 h-4 mr-2" />
          Add Rule
        </Button>
      </div>

      {!conditions || !conditions.rules || conditions.rules.length === 0 ? (
        <div className="p-8 border-2 border-dashed border-gray-300 rounded-lg text-center">
          <HelpCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600 mb-4">
            No conditions defined. This workflow will run for all events.
          </p>
          <Button variant="ghost" onClick={addRule}>
            <Plus className="w-4 h-4 mr-2" />
            Add First Condition
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {conditions.rules.map((rule, index) => (
            <div key={rule.id}>
              {index > 0 && (
                <div className="flex items-center justify-center my-2">
                  <button
                    onClick={toggleOperator}
                    className={cn(
                      'px-4 py-1 rounded-full text-xs font-semibold transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500',
                      conditions.logic === 'AND'
                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                    )}
                  >
                    {conditions.logic}
                  </button>
                </div>
              )}

              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Field Selector */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Field
                    </label>
                    <select
                      value={rule.field}
                      onChange={(e) =>
                        updateRule(rule.id, 'field', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      {fieldOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Operator Selector */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Operator
                    </label>
                    <select
                      value={rule.operator}
                      onChange={(e) =>
                        updateRule(rule.id, 'operator', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      {getOperatorsForField(rule.field).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Value Input */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Value
                    </label>
                    <input
                      type="text"
                      value={rule.value}
                      onChange={(e) =>
                        updateRule(rule.id, 'value', e.target.value)
                      }
                      placeholder="Enter value..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                </div>

                <button
                  onClick={() => removeRule(rule.id)}
                  className="mt-6 text-red-600 hover:text-red-800 transition-colors p-2"
                  title="Remove rule"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Visual Logic Display */}
      {conditions && conditions.rules && conditions.rules.length > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">
            Condition Logic:
          </h4>
          <p className="text-sm text-blue-800 font-mono">
            IF (
            {conditions.rules.map((rule, index) => (
              <span key={rule.id}>
                {index > 0 && (
                  <span className="font-bold"> {conditions.logic} </span>
                )}
                <span className="text-blue-900">
                  {fieldOptions.find((f) => f.value === rule.field)?.label}
                </span>{' '}
                <span className="text-blue-700">{rule.operator}</span>{' '}
                <span className="text-blue-900">
                  "{rule.value || '___'}"
                </span>
              </span>
            ))}
            ) THEN execute actions
          </p>
        </div>
      )}
    </div>
  );
};
