import React, { useCallback, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  Connection,
  Edge,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { TriggerNode } from './TriggerNode';
import { ActionNode } from './ActionNode';
import { ConditionNode } from './ConditionNode';
import { NodeConfig } from './NodeConfig';
import { Button } from '../ui/Button';
import { Save } from 'lucide-react';

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
};

const initialNodes = [
  {
    id: '1',
    type: 'trigger',
    data: { label: 'Order Created', config: {} },
    position: { x: 250, y: 50 },
  },
];

export const WorkflowBuilder: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const addNode = (type: 'trigger' | 'action' | 'condition') => {
    const newNode = {
      id: (nodes.length + 1).toString(),
      type,
      data: { label: `New ${type}`, config: {} },
      position: { x: Math.random() * 400, y: Math.random() * 400 },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  return (
    <div className="h-full relative">
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <Button onClick={() => addNode('trigger')} size="sm">
          Add Trigger
        </Button>
        <Button onClick={() => addNode('action')} size="sm">
          Add Action
        </Button>
        <Button onClick={() => addNode('condition')} size="sm">
          Add Condition
        </Button>
        <Button variant="primary" size="sm">
          <Save className="w-4 h-4 mr-2" />
          Save Workflow
        </Button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      <NodeConfig nodeId={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
};
