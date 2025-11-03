import React, { useCallback } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, Diamond, Zap } from 'lucide-react';
import { cn } from '../../utils/cn';

// Custom Node Components
const TriggerNode = ({ data }: { data: any }) => {
  return (
    <div className="px-6 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg shadow-lg border-2 border-blue-700 min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-5 h-5" />
        <div className="font-semibold">Trigger</div>
      </div>
      <div className="text-sm opacity-90">{data.label}</div>
    </div>
  );
};

const ConditionNode = ({ data }: { data: any }) => {
  return (
    <div className="relative">
      <div className="w-40 h-40 bg-gradient-to-br from-purple-500 to-purple-600 transform rotate-45 shadow-lg border-2 border-purple-700">
        <div className="absolute inset-0 flex items-center justify-center transform -rotate-45">
          <div className="text-center text-white">
            <Diamond className="w-6 h-6 mx-auto mb-1" />
            <div className="font-semibold text-sm">Condition</div>
            <div className="text-xs opacity-90 px-2">{data.label}</div>
          </div>
        </div>
      </div>
      {/* YES/NO Labels */}
      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs font-semibold text-gray-600">
        YES
      </div>
      <div className="absolute top-1/2 -right-8 -translate-y-1/2 text-xs font-semibold text-gray-600">
        NO
      </div>
    </div>
  );
};

const ActionNode = ({ data }: { data: any }) => {
  return (
    <div className="px-6 py-4 bg-white rounded-lg shadow-lg border-2 border-gray-300 min-w-[200px] hover:border-blue-500 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-5 h-5 text-blue-600" />
        <div className="font-semibold text-gray-900">Action</div>
      </div>
      <div className="text-sm text-gray-600">{data.label}</div>
    </div>
  );
};

// Node type mapping
const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
};

interface WorkflowCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  readOnly?: boolean;
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  initialNodes = [],
  initialEdges = [],
  onNodesChange,
  onEdgesChange,
  readOnly = false,
}) => {
  // Default demo nodes if none provided
  const defaultNodes: Node[] = [
    {
      id: '1',
      type: 'trigger',
      position: { x: 250, y: 0 },
      data: { label: 'Order Status Changed' },
    },
    {
      id: '2',
      type: 'condition',
      position: { x: 220, y: 150 },
      data: { label: 'Order Total > $100' },
    },
    {
      id: '3',
      type: 'action',
      position: { x: 100, y: 350 },
      data: { label: 'Send SMS' },
    },
    {
      id: '4',
      type: 'action',
      position: { x: 350, y: 350 },
      data: { label: 'Assign Agent' },
    },
  ];

  const defaultEdges: Edge[] = [
    {
      id: 'e1-2',
      source: '1',
      target: '2',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
      id: 'e2-3',
      source: '2',
      target: '3',
      label: 'YES',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#10b981' },
    },
    {
      id: 'e2-4',
      source: '2',
      target: '4',
      label: 'NO',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#ef4444' },
    },
  ];

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(
    initialNodes.length > 0 ? initialNodes : defaultNodes
  );
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(
    initialEdges.length > 0 ? initialEdges : defaultEdges
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (readOnly) return;
      const newEdges = addEdge(
        {
          ...params,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
        },
        edges
      );
      setEdges(newEdges);
      if (onEdgesChange) {
        onEdgesChange(newEdges);
      }
    },
    [edges, readOnly, onEdgesChange]
  );

  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChangeInternal(changes);
      if (onNodesChange && nodes) {
        onNodesChange(nodes);
      }
    },
    [nodes, onNodesChange, onNodesChangeInternal]
  );

  const handleEdgesChange = useCallback(
    (changes: any) => {
      onEdgesChangeInternal(changes);
      if (onEdgesChange && edges) {
        onEdgesChange(edges);
      }
    },
    [edges, onEdgesChange, onEdgesChangeInternal]
  );

  return (
    <div className="w-full h-[600px] bg-gray-50 rounded-lg border-2 border-gray-200 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        className="bg-gray-50"
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
      >
        <Background color="#d1d5db" gap={16} />
        <Controls
          className="bg-white shadow-lg rounded-lg border border-gray-200"
        />
        <MiniMap
          className="bg-white shadow-lg rounded-lg border border-gray-200"
          nodeColor={(node) => {
            switch (node.type) {
              case 'trigger':
                return '#3b82f6';
              case 'condition':
                return '#a855f7';
              case 'action':
                return '#ffffff';
              default:
                return '#d1d5db';
            }
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
};
