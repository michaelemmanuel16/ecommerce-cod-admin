import React from 'react';
import { Handle, Position } from 'reactflow';
import { Play } from 'lucide-react';

interface ActionNodeProps {
  data: {
    label: string;
    config: Record<string, any>;
  };
}

export const ActionNode: React.FC<ActionNodeProps> = ({ data }) => {
  return (
    <div className="bg-blue-500 text-white p-4 rounded-lg shadow-lg min-w-[200px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      <div className="flex items-center gap-2 mb-2">
        <Play className="w-5 h-5" />
        <span className="font-semibold">Action</span>
      </div>
      <p className="text-sm">{data.label}</p>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
};
