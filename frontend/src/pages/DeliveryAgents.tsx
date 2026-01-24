import React, { useEffect, useState } from 'react';
import { Search, Edit2, MapPin, TrendingUp, Mail, Phone } from 'lucide-react';
import { useDeliveryAgentsStore } from '../stores/deliveryAgentsStore';
import { Card } from '../components/ui/Card';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { AgentEditModal } from '../components/admin/AgentEditModal';
import { DeliveryAgent } from '../services/delivery-agents.service';
import { formatCurrency } from '../utils/format';
import { DateRangePicker } from '../components/ui/DateRangePicker';

export const DeliveryAgents: React.FC = () => {
  const {
    agents,
    performance,
    isLoading,
    fetchAgents,
    fetchPerformance,
  } = useDeliveryAgentsStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<DeliveryAgent | null>(null);
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>({});

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    fetchPerformance({
      startDate: dateRange.start,
      endDate: dateRange.end
    });
  }, [fetchPerformance, dateRange]);

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.phoneNumber?.includes(searchQuery)
  );

  const getPerformanceForAgent = (agentId: string) => {
    return performance.find(p => p.userId === agentId);
  };

  const handleEditClick = (agent: DeliveryAgent) => {
    setSelectedAgent(agent);
    setIsEditModalOpen(true);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Delivery Agents</h1>
        <p className="text-gray-600 mt-1">Manage agents in Settings → User Management</p>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <div className="flex-1">
          <Card>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search agents by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </Card>
        </div>
        <div className="w-full md:w-auto">
          <DateRangePicker
            startDate={dateRange.start}
            endDate={dateRange.end}
            onChange={(start, end) => setDateRange({ start, end })}
          />
        </div>
      </div>

      {isLoading ? (
        <Card>
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-gray-200 rounded"></div>
            <div className="h-16 bg-gray-100 rounded"></div>
            <div className="h-16 bg-gray-100 rounded"></div>
            <div className="h-16 bg-gray-100 rounded"></div>
          </div>
        </Card>
      ) : filteredAgents.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-gray-600">
              {searchQuery ? 'No delivery agents found matching your search.' : 'No delivery agents yet. Add your first agent to get started.'}
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell isHeader>DeliveryAgent</TableCell>
                  <TableCell isHeader>Contact</TableCell>
                  <TableCell isHeader>Vehicle</TableCell>
                  <TableCell isHeader>Performance</TableCell>
                  <TableCell isHeader>Earnings</TableCell>
                  <TableCell isHeader>Status</TableCell>
                  <TableCell isHeader>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredAgents.map((agent) => {
                  const agentPerformance = getPerformanceForAgent(agent.id);
                  const successRate = agentPerformance?.successRate || 0;
                  const completedCount = agentPerformance?.completed || 0;
                  const totalAssigned = agentPerformance?.totalAssigned || 0;

                  return (
                    <TableRow key={agent.id} className="hover:bg-gray-50">
                      {/* DeliveryAgent Column */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">{agent.name}</span>
                          <span className="text-sm text-gray-500">ID: {agent.id}</span>
                        </div>
                      </TableCell>

                      {/* Contact Column */}
                      <TableCell>
                        <div className="flex flex-col space-y-1">
                          <div className="flex items-center text-sm text-gray-600">
                            <Mail className="w-3 h-3 mr-1" />
                            <span className="truncate max-w-[200px]">{agent.email}</span>
                          </div>
                          {agent.phoneNumber && (
                            <div className="flex items-center text-sm text-gray-600">
                              <Phone className="w-3 h-3 mr-1" />
                              <span>{agent.phoneNumber}</span>
                            </div>
                          )}
                          {agent.location && (
                            <div className="flex items-center text-sm text-gray-600">
                              <MapPin className="w-3 h-3 mr-1" />
                              <span>{agent.location}</span>
                            </div>
                          )}
                        </div>
                      </TableCell>

                      {/* Vehicle Column */}
                      <TableCell>
                        {agent.vehicleType || agent.vehicleId ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-gray-900">{agent.vehicleType || 'N/A'}</span>
                            {agent.vehicleId && (
                              <span className="text-sm text-gray-500">{agent.vehicleId}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">Not set</span>
                        )}
                      </TableCell>

                      {/* Performance Column */}
                      <TableCell>
                        <div className="flex flex-col space-y-1">
                          <div className="flex items-center">
                            <TrendingUp className={`w-4 h-4 mr-1 ${successRate >= 80 ? 'text-green-500' : successRate >= 60 ? 'text-yellow-500' : 'text-red-500'}`} />
                            <span className={`font-semibold ${successRate >= 80 ? 'text-green-600' : successRate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {successRate.toFixed(1)}%
                            </span>
                          </div>
                          <span className="text-sm text-gray-500">
                            {completedCount} of {totalAssigned} completed
                          </span>
                        </div>
                      </TableCell>

                      {/* Earnings Column */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-900">
                            {formatCurrency(agentPerformance?.totalEarnings ?? (agent.deliveryRate || 0) * completedCount)}
                          </span>
                          {(agentPerformance?.deliveryRate || agent.deliveryRate) !== undefined && (agentPerformance?.deliveryRate || agent.deliveryRate || 0) > 0 && (
                            <span className="text-sm text-gray-500">
                              {formatCurrency(agentPerformance?.deliveryRate || agent.deliveryRate || 0)} per delivery
                            </span>
                          )}
                          {completedCount > 0 && (
                            <span className="text-xs text-gray-400">
                              {completedCount} completed deliveries
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Status Column */}
                      <TableCell>
                        <div className="flex flex-col space-y-1">
                          <Badge variant={agent.isActive ? 'success' : 'secondary'}>
                            {agent.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          <Badge variant={agent.isAvailable ? 'success' : 'secondary'}>
                            {agent.isAvailable ? 'Available' : 'Unavailable'}
                          </Badge>
                        </div>
                      </TableCell>

                      {/* Actions Column */}
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleEditClick(agent)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit agent"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Modals */}
      {selectedAgent && (
        <AgentEditModal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedAgent(null);
          }}
          agent={selectedAgent}
        />
      )}
    </div>
  );
};
