import React, { useState, useEffect } from 'react';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  subYears,
  addMonths,
  subMonths,
} from 'date-fns';
import { Calendar, X } from 'lucide-react';
import { CalendarGrid } from './calendar/CalendarGrid';
import { isSameDay } from './calendar/calendarUtils';

interface DateRangePickerProps {
  startDate?: string;
  endDate?: string;
  onChange: (startDate: string | undefined, endDate: string | undefined) => void;
  placeholder?: string;
}

type PresetKey = 'this-year' | 'last-year' | 'today' | 'yesterday' | 'this-week' | 'this-month' | 'last-7-days' | 'last-30-days';

interface Preset {
  label: string;
  getValue: () => { from: Date; to: Date };
}

const presets: Record<PresetKey, Preset> = {
  'this-year': {
    label: 'This year',
    getValue: () => ({
      from: startOfYear(new Date()),
      to: endOfYear(new Date())
    })
  },
  'last-year': {
    label: 'Last year',
    getValue: () => ({
      from: startOfYear(subYears(new Date(), 1)),
      to: endOfYear(subYears(new Date(), 1))
    })
  },
  'today': {
    label: 'Today',
    getValue: () => ({
      from: new Date(),
      to: new Date()
    })
  },
  'yesterday': {
    label: 'Yesterday',
    getValue: () => {
      const yesterday = subDays(new Date(), 1);
      return {
        from: yesterday,
        to: yesterday
      };
    }
  },
  'this-week': {
    label: 'This week',
    getValue: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: endOfWeek(new Date(), { weekStartsOn: 1 })
    })
  },
  'this-month': {
    label: 'This month',
    getValue: () => ({
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date())
    })
  },
  'last-7-days': {
    label: 'Last 7 days',
    getValue: () => ({
      from: subDays(new Date(), 6),
      to: new Date()
    })
  },
  'last-30-days': {
    label: 'Last 30 days',
    getValue: () => ({
      from: subDays(new Date(), 29),
      to: new Date()
    })
  }
};

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onChange,
  placeholder = 'Filter by date range',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tempRange, setTempRange] = useState<{ from: Date | undefined; to: Date | undefined }>(() => {
    if (startDate && endDate) {
      return {
        from: new Date(startDate),
        to: new Date(endDate),
      };
    }
    return { from: undefined, to: undefined };
  });

  const [selectedPreset, setSelectedPreset] = useState<PresetKey | null>(null);

  // Track which month to display in each calendar
  const [firstMonth, setFirstMonth] = useState(new Date());
  const [secondMonth, setSecondMonth] = useState(addMonths(new Date(), 1));

  // Sync with prop changes
  useEffect(() => {
    if (startDate && endDate) {
      setTempRange({
        from: new Date(startDate),
        to: new Date(endDate)
      });
    }
  }, [startDate, endDate]);

  const handlePresetClick = (presetKey: PresetKey) => {
    const range = presets[presetKey].getValue();
    setTempRange(range);
    setSelectedPreset(presetKey);

    // Update displayed months to match the preset range
    setFirstMonth(range.from);
    setSecondMonth(addMonths(range.from, 1));
  };

  const handleDateClick = (date: Date) => {
    setSelectedPreset(null);

    if (!tempRange.from || (tempRange.from && tempRange.to)) {
      // Start new range
      setTempRange({ from: date, to: undefined });
    } else {
      // Complete the range
      if (date < tempRange.from) {
        setTempRange({ from: date, to: tempRange.from });
      } else {
        setTempRange({ from: tempRange.from, to: date });
      }
    }
  };

  const handleApply = () => {
    if (tempRange.from && tempRange.to) {
      const formattedStart = format(tempRange.from, 'yyyy-MM-dd');
      const endOfDay = new Date(tempRange.to);
      endOfDay.setHours(23, 59, 59, 999);
      const formattedEnd = endOfDay.toISOString();

      console.log('[DateRangePicker] Applying range:', {
        from: tempRange.from,
        to: tempRange.to,
        formattedStart,
        formattedEnd
      });

      onChange(formattedStart, formattedEnd);
      setIsOpen(false);
    }
  };

  const handleCancel = () => {
    // Reset to current values
    if (startDate && endDate) {
      setTempRange({
        from: new Date(startDate),
        to: new Date(endDate)
      });
    } else {
      setTempRange({ from: undefined, to: undefined });
    }
    setSelectedPreset(null);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTempRange({ from: undefined, to: undefined });
    setSelectedPreset(null);
    onChange(undefined, undefined);
  };

  const handleReset = () => {
    setTempRange({ from: undefined, to: undefined });
    setSelectedPreset(null);
  };

  const formatDisplayDate = () => {
    if (!tempRange.from) return placeholder;
    if (!tempRange.to) return format(tempRange.from, 'MMM dd, yyyy');
    return `${format(tempRange.from, 'MMM dd, yyyy')} - ${format(tempRange.to, 'MMM dd, yyyy')}`;
  };

  // Navigation handlers
  const handleFirstMonthPrev = () => {
    const newFirst = subMonths(firstMonth, 1);
    setFirstMonth(newFirst);
    setSecondMonth(addMonths(newFirst, 1));
  };

  const handleFirstMonthNext = () => {
    const newFirst = addMonths(firstMonth, 1);
    setFirstMonth(newFirst);
    setSecondMonth(addMonths(newFirst, 1));
  };

  const handleSecondMonthPrev = () => {
    const newSecond = subMonths(secondMonth, 1);
    setSecondMonth(newSecond);
    setFirstMonth(subMonths(newSecond, 1));
  };

  const handleSecondMonthNext = () => {
    const newSecond = addMonths(secondMonth, 1);
    setSecondMonth(newSecond);
    setFirstMonth(subMonths(newSecond, 1));
  };

  const handleFirstMonthChange = (month: number) => {
    const newDate = new Date(firstMonth.getFullYear(), month, 1);
    setFirstMonth(newDate);
    setSecondMonth(addMonths(newDate, 1));
  };

  const handleFirstYearChange = (year: number) => {
    const newDate = new Date(year, firstMonth.getMonth(), 1);
    setFirstMonth(newDate);
    setSecondMonth(addMonths(newDate, 1));
  };

  const handleSecondMonthChange = (month: number) => {
    const newDate = new Date(secondMonth.getFullYear(), month, 1);
    setSecondMonth(newDate);
    setFirstMonth(subMonths(newDate, 1));
  };

  const handleSecondYearChange = (year: number) => {
    const newDate = new Date(year, secondMonth.getMonth(), 1);
    setSecondMonth(newDate);
    setFirstMonth(subMonths(newDate, 1));
  };

  return (
    <div className="date-range-picker-container">
      <style>{`
        .date-range-picker-container {
          position: relative;
        }

        .date-range-trigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          background-color: white;
          transition: all 0.2s;
          cursor: pointer;
          width: 340px;
        }

        .date-range-trigger:hover {
          background-color: #f9fafb;
        }

        .date-range-trigger:focus {
          outline: none;
          ring: 2px;
          ring-color: #3b82f6;
        }

        .date-range-trigger-content {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .date-range-trigger-text {
          color: #111827;
        }

        .date-range-trigger-placeholder {
          color: #6b7280;
        }

        .date-range-clear-btn {
          padding: 0.25rem;
          border-radius: 0.25rem;
          transition: background-color 0.2s;
        }

        .date-range-clear-btn:hover {
          background-color: #e5e7eb;
        }

        .date-range-backdrop {
          position: fixed;
          inset: 0;
          z-index: 40;
        }

        .date-range-popover {
          position: absolute;
          top: calc(100% + 0.5rem);
          right: 0;
          background-color: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.75rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          z-index: 50;
          overflow: hidden;
          display: flex;
        }

        /* Preset sidebar */
        .date-range-presets {
          width: 130px;
          padding: 0.375rem;
          border-right: 1px solid #e5e7eb;
          background-color: #ffffff;
        }

        .date-range-preset-btn {
          width: 100%;
          text-align: left;
          padding: 0.5rem 0.75rem;
          font-size: 0.8125rem;
          color: #374151;
          background-color: transparent;
          border: none;
          border-radius: 0.375rem;
          transition: all 0.2s;
          cursor: pointer;
          margin-bottom: 0.125rem;
        }

        .date-range-preset-btn:hover {
          background-color: #f3f4f6;
        }

        .date-range-preset-btn.active {
          background-color: #eff6ff;
          color: #2563eb;
          font-weight: 500;
        }

        /* Calendar area */
        .date-range-calendars {
          display: flex;
          flex-direction: column;
          padding: 0.75rem;
        }

        .calendars-row {
          display: flex;
          gap: 1rem;
        }

        /* Calendar grid */
        .calendar-grid-container {
          width: 256px;
        }

        .calendar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.75rem;
          gap: 0.5rem;
        }

        .calendar-nav-button {
          padding: 0.375rem;
          background-color: transparent;
          border: none;
          border-radius: 0.25rem;
          cursor: pointer;
          transition: background-color 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .calendar-nav-button:hover {
          background-color: #f3f4f6;
        }

        .calendar-nav-button svg {
          fill: #374151;
        }

        .calendar-selects {
          display: flex;
          gap: 0.5rem;
          flex: 1;
          justify-content: center;
        }

        .calendar-month-select,
        .calendar-year-select {
          font-size: 0.875rem;
          font-weight: 600;
          color: #111827;
          border: 1px solid #d1d5db;
          border-radius: 0.25rem;
          padding: 0.25rem 0.5rem;
          background-color: white;
          cursor: pointer;
        }

        .calendar-month-select:focus,
        .calendar-year-select:focus {
          outline: none;
          ring: 2px;
          ring-color: #3b82f6;
        }

        .calendar-reset-button {
          padding: 0.375rem;
          background-color: transparent;
          border: none;
          border-radius: 0.25rem;
          cursor: pointer;
          transition: background-color 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .calendar-reset-button svg {
          width: 20px;
          height: 20px;
        }

        .calendar-reset-button:hover {
          background-color: #f3f4f6;
        }

        .calendar-reset-button svg {
          fill: #6b7280;
        }

        .calendar-weekdays {
          display: grid;
          grid-template-columns: 32px repeat(7, 32px);
          margin-bottom: 0.375rem;
        }

        .calendar-week-header {
          font-size: 0.75rem;
          font-weight: 500;
          color: #9ca3af;
          text-align: center;
          padding: 0.375rem;
          text-transform: uppercase;
        }

        .calendar-weekday {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6b7280;
          text-align: center;
          padding: 0.375rem;
          text-transform: capitalize;
        }

        .calendar-days-grid {
          display: grid;
          grid-template-columns: 32px repeat(7, 32px);
          gap: 0;
        }

        .calendar-week-number {
          font-size: 0.75rem;
          color: #9ca3af;
          text-align: center;
          padding: 0.5rem 0.125rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .calendar-day {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          color: #374151;
          cursor: pointer;
          border-radius: 0.25rem;
          transition: all 0.2s;
          position: relative;
        }

        .calendar-day:hover {
          background-color: #f3f4f6;
        }

        .calendar-day.is-start-date,
        .calendar-day.is-end-date {
          background-color: #4a5568;
          color: white;
          font-weight: 500;
        }

        .calendar-day.is-in-range {
          background-color: #e5e7eb;
          color: #374151;
        }

        .calendar-day.is-today {
          font-weight: 600;
          color: #2563eb;
        }

        .calendar-day-empty {
          width: 32px;
          height: 32px;
        }

        /* Action buttons */
        .date-range-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.5rem;
          padding-top: 0.75rem;
          border-top: 1px solid #e5e7eb;
          margin-top: 0.75rem;
        }

        .date-range-cancel-btn,
        .date-range-apply-btn {
          padding: 0.5rem 1.25rem;
          font-size: 0.875rem;
          font-weight: 500;
          border-radius: 0.375rem;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .date-range-cancel-btn {
          background-color: #e5e7eb;
          color: #374151;
        }

        .date-range-cancel-btn:hover {
          background-color: #d1d5db;
        }

        .date-range-apply-btn {
          background-color: #4a5568;
          color: white;
        }

        .date-range-apply-btn:hover {
          background-color: #374151;
        }

        .date-range-apply-btn:disabled {
          background-color: #d1d5db;
          color: #9ca3af;
          cursor: not-allowed;
        }
      `}</style>

      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="date-range-trigger"
      >
        <div className="date-range-trigger-content">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className={tempRange.from ? 'date-range-trigger-text' : 'date-range-trigger-placeholder'}>
            {formatDisplayDate()}
          </span>
        </div>
        {tempRange.from && (
          <button
            onClick={handleClear}
            className="date-range-clear-btn"
            title="Clear dates"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        )}
      </button>

      {/* Calendar Popover */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="date-range-backdrop" onClick={handleCancel} />

          {/* Main Popover */}
          <div className="date-range-popover">
            {/* Left Sidebar - Presets */}
            <div className="date-range-presets">
              {(Object.keys(presets) as PresetKey[]).map((presetKey) => (
                <button
                  key={presetKey}
                  onClick={() => handlePresetClick(presetKey)}
                  className={`date-range-preset-btn ${selectedPreset === presetKey ? 'active' : ''}`}
                >
                  {presets[presetKey].label}
                </button>
              ))}
            </div>

            {/* Right Side - Calendars + Actions */}
            <div className="date-range-calendars">
              <div className="calendars-row">
                {/* First Calendar */}
                <CalendarGrid
                  year={firstMonth.getFullYear()}
                  month={firstMonth.getMonth()}
                  selectedRange={tempRange}
                  onDateClick={handleDateClick}
                  onPrevMonth={handleFirstMonthPrev}
                  onNextMonth={handleFirstMonthNext}
                  onMonthChange={handleFirstMonthChange}
                  onYearChange={handleFirstYearChange}
                  showLeftNav={true}
                  showRightNav={false}
                />

                {/* Second Calendar */}
                <CalendarGrid
                  year={secondMonth.getFullYear()}
                  month={secondMonth.getMonth()}
                  selectedRange={tempRange}
                  onDateClick={handleDateClick}
                  onPrevMonth={handleSecondMonthPrev}
                  onNextMonth={handleSecondMonthNext}
                  onMonthChange={handleSecondMonthChange}
                  onYearChange={handleSecondYearChange}
                  showReset={true}
                  onReset={handleReset}
                  showLeftNav={false}
                  showRightNav={true}
                />
              </div>

              {/* Action Buttons */}
              <div className="date-range-actions">
                <button onClick={handleCancel} className="date-range-cancel-btn">
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={!tempRange.from || !tempRange.to}
                  className="date-range-apply-btn"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
