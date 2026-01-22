import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useCustomerRepsStore } from '../stores/customerRepsStore';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { RepTable, RepTableData } from '../components/reps/RepTable';
import { EditRepModal } from '../components/reps/EditRepModal';
import { RepPayoutModal } from '../components/reps/RepPayoutModal';
import { DateRangePicker } from '../components/ui/DateRangePicker';

export const CustomerReps: React.FC = () => {
  const {
    reps,
    performance,
    isLoading,
    fetchReps,
    fetchPerformance,
    updateRepDetails,
  } = useCustomerRepsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRep, setSelectedRep] = useState<RepTableData | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>({});

  useEffect(() => {
    fetchReps();
  }, [fetchReps]);

  useEffect(() => {
    fetchPerformance({
      startDate: dateRange.start,
      endDate: dateRange.end
    });
  }, [fetchPerformance, dateRange]);

  // Combine reps with performance data
  const repsWithPerformance: RepTableData[] = reps.map((rep) => {
    const perfData = performance.find((p) => p.repId === rep.id);
    return {
      id: rep.id,
      name: rep.name,
      firstName: rep.firstName,
      lastName: rep.lastName,
      email: rep.email,
      phoneNumber: rep.phoneNumber,
      country: rep.country || 'N/A',
      commissionAmount: rep.commissionAmount || 0,
      totalEarnings: perfData?.totalEarnings || 0,
      monthlyEarnings: perfData?.monthlyEarnings || 0,
      successRate: perfData?.successRate || 0,
      totalOrders: perfData?.totalOrders || 0,
      deliveredOrders: perfData?.deliveredOrders || 0,
      isActive: rep.isActive,
      createdAt: rep.createdAt,
    };
  });

  const filteredReps = repsWithPerformance.filter((rep) =>
    rep.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    rep.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    rep.phoneNumber.includes(searchQuery)
  );

  const handleEdit = (rep: RepTableData) => {
    setSelectedRep(rep);
    setIsEditModalOpen(true);
  };

  const handleUpdate = async (id: string, data: any) => {
    await updateRepDetails(id, data);
    setIsEditModalOpen(false);
    setSelectedRep(null);
  };

  const handleCloseModal = () => {
    setIsEditModalOpen(false);
    setIsPayoutModalOpen(false);
    setSelectedRep(null);
  };

  const handleOpenPayout = (rep: RepTableData) => {
    setSelectedRep(rep);
    setIsPayoutModalOpen(true);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customer Representatives</h1>
        <p className="text-gray-600 mt-1">Manage representatives in Settings → User Management</p>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <div className="flex-1">
          <Card>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search reps by name, email, or phone..."
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

      <RepTable
        reps={filteredReps}
        onEdit={handleEdit}
        onViewPayments={handleOpenPayout}
        isLoading={isLoading}
      />

      <EditRepModal
        rep={selectedRep}
        isOpen={isEditModalOpen}
        onClose={handleCloseModal}
        onUpdate={handleUpdate}
      />

      <RepPayoutModal
        repId={selectedRep?.id || null}
        repName={selectedRep?.name || ''}
        isOpen={isPayoutModalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
};
