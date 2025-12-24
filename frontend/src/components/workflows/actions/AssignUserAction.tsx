import React, { useState, useEffect } from 'react';
import { Users, AlertCircle, TrendingUp, PieChart } from 'lucide-react';
import { customerRepsService, CustomerRep } from '../../../services/customer-reps.service';
import { deliveryAgentsService, DeliveryAgent } from '../../../services/delivery-agents.service';
import { cn } from '../../../utils/cn';

export interface UserAssignment {
  userId: string;
  weight: number; // Percentage (0-100)
}

export interface AssignUserConfig {
  userType: 'sales_rep' | 'delivery_agent';
  assignments: UserAssignment[];
  distributionMode: 'even' | 'weighted';
  onlyUnassigned: boolean;
}

interface AssignUserActionProps {
  config: AssignUserConfig;
  onChange: (config: AssignUserConfig) => void;
}

type User = (CustomerRep | DeliveryAgent) & { name: string };

export const AssignUserAction: React.FC<AssignUserActionProps> = ({
  config,
  onChange,
}) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, [config.userType]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      if (config.userType === 'sales_rep') {
        const reps = await customerRepsService.getCustomerReps();
        setUsers(reps.filter((rep) => rep.isActive));
      } else {
        const agents = await deliveryAgentsService.getDeliveryAgents();
        setUsers(agents.filter((agent) => agent.isActive));
      }
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUserTypeChange = (userType: 'sales_rep' | 'delivery_agent') => {
    onChange({
      ...config,
      userType,
      assignments: [], // Reset assignments when changing user type
    });
  };

  const handleDistributionModeChange = (mode: 'even' | 'weighted') => {
    const newConfig = { ...config, distributionMode: mode };

    if (mode === 'even') {
      // Distribute evenly
      const evenWeight = config.assignments.length > 0
        ? 100 / config.assignments.length
        : 0;
      newConfig.assignments = config.assignments.map((assignment) => ({
        ...assignment,
        weight: Number(evenWeight.toFixed(2)),
      }));
    }

    onChange(newConfig);
  };

  const toggleUserSelection = (userId: string) => {
    const isSelected = config.assignments.some((a) => a.userId === userId);

    if (isSelected) {
      // Remove user
      const newAssignments = config.assignments.filter((a) => a.userId !== userId);

      if (config.distributionMode === 'even' && newAssignments.length > 0) {
        const evenWeight = 100 / newAssignments.length;
        onChange({
          ...config,
          assignments: newAssignments.map((a) => ({
            ...a,
            weight: Number(evenWeight.toFixed(2)),
          })),
        });
      } else {
        onChange({ ...config, assignments: newAssignments });
      }
    } else {
      // Add user
      const newAssignments = [...config.assignments];

      if (config.distributionMode === 'even') {
        const evenWeight = 100 / (newAssignments.length + 1);
        newAssignments.push({ userId, weight: Number(evenWeight.toFixed(2)) });
        onChange({
          ...config,
          assignments: newAssignments.map((a) => ({
            ...a,
            weight: Number(evenWeight.toFixed(2)),
          })),
        });
      } else {
        newAssignments.push({ userId, weight: 0 });
        onChange({ ...config, assignments: newAssignments });
      }
    }
  };

  const distributeEvenly = () => {
    if (config.assignments.length === 0) return;

    const evenWeight = 100 / config.assignments.length;
    onChange({
      ...config,
      assignments: config.assignments.map((assignment) => ({
        ...assignment,
        weight: Number(evenWeight.toFixed(2)),
      })),
    });
  };

  const updateWeight = (userId: string, newWeight: number) => {
    // Clamp weight between 0 and 100
    const targetWeight = Math.max(0, Math.min(100, Number(newWeight) || 0));

    // Get other assignments (not the one being updated)
    const otherAssignments = config.assignments.filter((a) => a.userId !== userId);

    // If only one user, set to 100%
    if (otherAssignments.length === 0) {
      onChange({
        ...config,
        assignments: [{ userId, weight: 100 }],
      });
      return;
    }

    // Calculate remaining percentage for other users
    const remaining = 100 - targetWeight;

    // Calculate current total of other users
    const othersTotal = otherAssignments.reduce((sum, a) => sum + a.weight, 0);

    // Proportionally redistribute remaining percentage among other users
    const normalizedAssignments = otherAssignments.map((assignment) => {
      let newWeight: number;

      if (othersTotal > 0) {
        // Maintain proportions: each gets their share of the remaining percentage
        newWeight = (assignment.weight / othersTotal) * remaining;
      } else {
        // If all others are 0%, distribute evenly
        newWeight = remaining / otherAssignments.length;
      }

      return {
        ...assignment,
        weight: Number(newWeight.toFixed(2)),
      };
    });

    onChange({
      ...config,
      assignments: [
        { userId, weight: Number(targetWeight.toFixed(2)) },
        ...normalizedAssignments,
      ],
    });
  };

  const getUserById = (userId: string) => {
    return users.find((u) => u.id === userId);
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading users...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* User Type Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          User Type
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleUserTypeChange('sales_rep')}
            className={cn(
              'p-4 rounded-lg border-2 transition-all text-left',
              config.userType === 'sales_rep'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300'
            )}
          >
            <Users className="w-5 h-5 mb-2 text-blue-600" />
            <div className="font-semibold text-gray-900">Sales Reps</div>
            <div className="text-xs text-gray-600">Customer representatives</div>
          </button>
          <button
            onClick={() => handleUserTypeChange('delivery_agent')}
            className={cn(
              'p-4 rounded-lg border-2 transition-all text-left',
              config.userType === 'delivery_agent'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300'
            )}
          >
            <TrendingUp className="w-5 h-5 mb-2 text-blue-600" />
            <div className="font-semibold text-gray-900">Delivery Agents</div>
            <div className="text-xs text-gray-600">Field agents</div>
          </button>
        </div>
      </div>

      {/* Distribution Mode Toggle */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Distribution Mode
        </label>
        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
          <button
            onClick={() => handleDistributionModeChange('even')}
            className={cn(
              'flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all',
              config.distributionMode === 'even'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            Even Split
          </button>
          <button
            onClick={() => handleDistributionModeChange('weighted')}
            className={cn(
              'flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all',
              config.distributionMode === 'weighted'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            Weighted Split
          </button>
        </div>
        {/* Distribute Evenly Helper Button */}
        {config.distributionMode === 'weighted' && config.assignments.length > 1 && (
          <button
            onClick={distributeEvenly}
            className="mt-3 w-full px-3 py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg border border-blue-200 transition-colors flex items-center justify-center gap-2"
          >
            <PieChart className="w-4 h-4" />
            Reset to Even Distribution
          </button>
        )}
      </div>

      {/* User Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select {config.userType === 'sales_rep' ? 'Sales Reps' : 'Delivery Agents'}
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
          {users.map((user) => {
            const isSelected = config.assignments.some((a) => a.userId === user.id);
            const assignment = config.assignments.find((a) => a.userId === user.id);

            return (
              <div
                key={user.id}
                className={cn(
                  'p-3 rounded-lg border-2 transition-all',
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                )}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleUserSelection(user.id)}
                    className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {user.name}
                    </div>
                    <div className="text-xs text-gray-600 truncate">
                      {user.email}
                    </div>
                    {user.isAvailable && (
                      <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                        Available
                      </span>
                    )}
                  </div>
                </div>

                {/* Weight Slider + Input for Weighted Mode */}
                {isSelected && config.distributionMode === 'weighted' && assignment && (
                  <div className="mt-3 pt-3 border-t border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-700">
                        Weight
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={assignment.weight.toFixed(1)}
                          onChange={(e) =>
                            updateWeight(user.id, parseFloat(e.target.value))
                          }
                          className="w-16 px-2 py-1 text-sm font-semibold text-blue-600 text-right border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm font-semibold text-blue-600">
                          %
                        </span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={assignment.weight}
                      onChange={(e) =>
                        updateWeight(user.id, parseFloat(e.target.value))
                      }
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Visual Preview */}
      {config.assignments.length > 0 && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PieChart className="w-5 h-5 text-green-600" />
              <h4 className="text-sm font-semibold text-green-900">
                Traffic Distribution Preview
              </h4>
            </div>
            {/* Total Indicator - Always 100% */}
            <div className="flex items-center gap-1.5 px-3 py-1 bg-green-100 rounded-full">
              <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-bold text-green-800">
                Total: 100%
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {config.assignments.map((assignment) => {
              const user = getUserById(assignment.userId);
              return (
                <div key={assignment.userId} className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-green-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${assignment.weight}%` }}
                    />
                  </div>
                  <div className="text-sm text-gray-900 w-32 truncate">
                    {user?.name}
                  </div>
                  <div className="text-sm font-semibold text-green-700 w-16 text-right">
                    {assignment.weight.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Only Unassigned Option */}
      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
        <input
          type="checkbox"
          id="onlyUnassigned"
          checked={config.onlyUnassigned}
          onChange={(e) =>
            onChange({ ...config, onlyUnassigned: e.target.checked })
          }
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label htmlFor="onlyUnassigned" className="flex-1">
          <div className="text-sm font-medium text-gray-900">
            Only apply to unassigned orders
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Skip orders that already have an assigned user
          </div>
        </label>
      </div>
    </div>
  );
};
