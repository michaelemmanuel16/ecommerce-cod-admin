import React from 'react';
import { X } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface NodeConfigProps {
  nodeId: string | null;
  onClose: () => void;
}

export const NodeConfig: React.FC<NodeConfigProps> = ({ nodeId, onClose }) => {
  if (!nodeId) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-lg p-6 border-l">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">Node Configuration</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="space-y-4">
        <Input label="Node Name" placeholder="Enter node name" />
        <Input label="Description" placeholder="Enter description" />
        <Button variant="primary" className="w-full">
          Save Configuration
        </Button>
      </div>
    </div>
  );
};
