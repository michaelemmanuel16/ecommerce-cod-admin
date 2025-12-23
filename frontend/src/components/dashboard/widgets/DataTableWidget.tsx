/**
 * Data Table Widget
 * Displays tabular data with sorting and pagination
 */

import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronRight } from 'lucide-react';
import { DataTableConfig, WidgetProps } from '../../../config/types/dashboard';
import { formatValue } from '../../../utils/dashboard/formatters';

interface DataTableWidgetProps extends WidgetProps {
  config: DataTableConfig;
}

export const DataTableWidget: React.FC<DataTableWidgetProps> = ({
  config,
  data,
  loading = false,
}) => {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Process table data
  const tableData = useMemo(() => {
    if (!Array.isArray(data)) return [];

    let processedData = [...data];

    // Apply sorting
    if (sortColumn) {
      processedData.sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }

        const aStr = String(aVal);
        const bStr = String(bVal);
        return sortDirection === 'asc'
          ? aStr.localeCompare(bStr)
          : bStr.localeCompare(aStr);
      });
    }

    // Limit rows
    if (config.config.maxRows) {
      processedData = processedData.slice(0, config.config.maxRows);
    }

    return processedData;
  }, [data, sortColumn, sortDirection, config.config.maxRows]);

  const handleSort = (columnKey: string, sortable: boolean | undefined) => {
    if (!sortable) return;

    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('desc');
    }
  };

  // Handle empty state
  if (!loading && tableData.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">{config.title}</h3>
        <div
          className="flex flex-col items-center justify-center bg-gray-50 rounded-lg"
          style={{ height: config.height }}
        >
          <svg
            className="w-16 h-16 text-gray-300 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-gray-500 text-sm">No data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <h3 className="text-lg font-semibold mb-4">{config.title}</h3>

      {loading ? (
        <div
          className="bg-gray-100 animate-pulse rounded-lg"
          style={{ height: config.height }}
        />
      ) : (
        <div className="overflow-auto" style={{ maxHeight: config.height }}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                {config.config.columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-4 py-3 text-left font-medium text-gray-700 ${
                      column.sortable ? 'cursor-pointer hover:bg-gray-100' : ''
                    }`}
                    onClick={() => handleSort(column.key, column.sortable)}
                  >
                    <div className="flex items-center gap-1">
                      {column.label}
                      {column.sortable && sortColumn === column.key && (
                        <span>
                          {sortDirection === 'asc' ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                {config.config.onRowClick && <th className="w-8"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {tableData.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={`${
                    config.config.onRowClick ? 'hover:bg-gray-50 cursor-pointer' : ''
                  }`}
                >
                  {config.config.columns.map((column) => (
                    <td key={column.key} className="px-4 py-3 text-gray-900">
                      {column.format
                        ? formatValue(row[column.key], column.format).formatted
                        : row[column.key]}
                    </td>
                  ))}
                  {config.config.onRowClick && (
                    <td className="px-2 py-3 text-gray-400">
                      <ChevronRight className="w-4 h-4" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Show "View All" if there's more data */}
          {config.config.maxRows && data && Array.isArray(data) && data.length > config.config.maxRows && (
            <div className="mt-4 text-center">
              <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                View all {data.length} items
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
