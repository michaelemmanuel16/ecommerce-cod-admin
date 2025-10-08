import React from 'react';
import { Handle, Position } from 'reactflow';
import { Zap } from 'lucide-react';

interface TriggerNodeProps {
  data: {
    label: string;
    config: Record<string, any>;
  };
}

export const TriggerNode: React.FC<TriggerNodeProps> = ({ data }) => {
  return (
    <div className="bg-purple-500 text-white p-4 rounded-lg shadow-lg min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-5 h-5" />
        <span className="font-semibold">Trigger</span>
      </div>
      <p className="text-sm">{data.label}</p>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
};
