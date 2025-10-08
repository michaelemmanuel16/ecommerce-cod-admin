import React from 'react';
import { Handle, Position } from 'reactflow';
import { GitBranch } from 'lucide-react';

interface ConditionNodeProps {
  data: {
    label: string;
    config: Record<string, any>;
  };
}

export const ConditionNode: React.FC<ConditionNodeProps> = ({ data }) => {
  return (
    <div className="bg-yellow-500 text-white p-4 rounded-lg shadow-lg min-w-[200px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="w-5 h-5" />
        <span className="font-semibold">Condition</span>
      </div>
      <p className="text-sm">{data.label}</p>
      <Handle type="source" position={Position.Bottom} id="true" className="w-3 h-3 left-1/4" />
      <Handle type="source" position={Position.Bottom} id="false" className="w-3 h-3 left-3/4" />
    </div>
  );
};
