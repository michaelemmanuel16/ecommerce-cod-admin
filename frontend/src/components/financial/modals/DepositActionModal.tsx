import React, { useEffect } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { useFinancialStore } from '../../../stores/financialStore';
import { formatCurrency } from '../../../utils/format';
import { CheckCircle, Loader2, X, CheckSquare, Square } from 'lucide-react';
import { Badge } from '../../ui/Badge';

interface DepositActionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    verified: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
};

export const DepositActionModal: React.FC<DepositActionModalProps> = ({
    isOpen,
    onClose,
}) => {
    const {
        currentAgentDeposits,
        selectedDepositIds,
        fetchAgentDeposits,
        verifyDeposit,
        bulkVerifyDeposits,
        toggleDepositSelection,
        toggleAllDeposits,
        clearDepositSelection,
        loadingStates
    } = useFinancialStore();

    useEffect(() => {
        if (isOpen) {
            fetchAgentDeposits({ status: 'pending' });
            clearDepositSelection();
        }
    }, [isOpen, fetchAgentDeposits, clearDepositSelection]);

    const handleVerify = async (depositId: number) => {
        await verifyDeposit(depositId);
    };

    const handleBulkVerify = async () => {
        if (selectedDepositIds.length === 0) return;
        if (selectedDepositIds.length > 50) {
            alert('Cannot verify more than 50 deposits at once');
            return;
        }
        await bulkVerifyDeposits(selectedDepositIds);
    };

    const allSelected = currentAgentDeposits.length > 0 &&
        selectedDepositIds.length === currentAgentDeposits.length;

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Agent Deposits - Pending Verification"
            size="xl"
        >
            <div className="space-y-4">
                {/* Bulk Actions Toolbar */}
                {currentAgentDeposits.length > 0 && (
                    <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={toggleAllDeposits}
                                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                            >
                                {allSelected ? (
                                    <CheckSquare className="w-5 h-5 text-blue-600" />
                                ) : (
                                    <Square className="w-5 h-5" />
                                )}
                                Select All
                            </button>
                            {selectedDepositIds.length > 0 && (
                                <span className="text-sm text-gray-600">
                                    {selectedDepositIds.length} selected
                                </span>
                            )}
                        </div>
                        {selectedDepositIds.length > 0 && (
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={handleBulkVerify}
                                    disabled={selectedDepositIds.length > 50}
                                >
                                    <CheckCircle className="w-4 h-4 mr-1" />
                                    Verify Selected ({selectedDepositIds.length})
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={clearDepositSelection}
                                >
                                    Clear
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {loadingStates.deposits && currentAgentDeposits.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                                        <button
                                            onClick={toggleAllDeposits}
                                            className="flex items-center"
                                        >
                                            {allSelected ? (
                                                <CheckSquare className="w-5 h-5 text-blue-600" />
                                            ) : (
                                                <Square className="w-5 h-5" />
                                            )}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agent</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {currentAgentDeposits.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                                            No pending deposits found.
                                        </td>
                                    </tr>
                                ) : (
                                    currentAgentDeposits.map((deposit) => (
                                        <tr key={deposit.id} className={selectedDepositIds.includes(deposit.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <button
                                                    onClick={() => toggleDepositSelection(deposit.id)}
                                                    className="flex items-center"
                                                >
                                                    {selectedDepositIds.includes(deposit.id) ? (
                                                        <CheckSquare className="w-5 h-5 text-blue-600" />
                                                    ) : (
                                                        <Square className="w-5 h-5 text-gray-400" />
                                                    )}
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {deposit.agent?.firstName} {deposit.agent?.lastName}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">
                                                {formatCurrency(deposit.amount)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {deposit.depositMethod.replace('_', ' ').toUpperCase()}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {deposit.referenceNumber}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {new Date(deposit.depositDate).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <Badge className={statusColors[deposit.status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'}>
                                                    {deposit.status.charAt(0).toUpperCase() + deposit.status.slice(1)}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                                <div className="flex justify-end gap-2">
                                                    {deposit.status === 'pending' && (
                                                        <Button
                                                            size="sm"
                                                            variant="primary"
                                                            onClick={() => handleVerify(deposit.id)}
                                                        >
                                                            <CheckCircle className="w-4 h-4 mr-1" />
                                                            Verify
                                                        </Button>
                                                    )}
                                                    {deposit.status === 'verified' && (
                                                        <span className="text-green-600 text-sm">✓ Verified</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {selectedDepositIds.length > 50 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                        <X className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-yellow-800">
                            You have selected {selectedDepositIds.length} deposits. Maximum 50 deposits can be verified at once.
                            Please reduce your selection.
                        </p>
                    </div>
                )}
            </div>
        </Modal>
    );
};
