import React from 'react';
import { getMonthCalendarDays, getMonthWeekNumbers, isDateInRange, isSameDay } from './calendarUtils';

interface CalendarGridProps {
  year: number;
  month: number;
  selectedRange?: { from: Date | undefined; to: Date | undefined };
  onDateClick: (date: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
  showReset?: boolean;
  onReset?: () => void;
  showLeftNav?: boolean;
  showRightNav?: boolean;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CELL_SIZE = 32; // Calendar cell size in pixels
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const CalendarGrid: React.FC<CalendarGridProps> = ({
  year,
  month,
  selectedRange,
  onDateClick,
  onPrevMonth,
  onNextMonth,
  onMonthChange,
  onYearChange,
  showReset = false,
  onReset,
  showLeftNav = true,
  showRightNav = true,
}) => {
  const days = getMonthCalendarDays(year, month);
  const weekNumbers = getMonthWeekNumbers(year, month);

  // Generate year options (1990-2025)
  const yearOptions = Array.from({ length: 36 }, (_, i) => 2025 - i);

  const getDayClassName = (date: Date | null): string => {
    if (!date) return 'calendar-day-empty';

    const isStart = selectedRange?.from && isSameDay(date, selectedRange.from);
    const isEnd = selectedRange?.to && isSameDay(date, selectedRange.to);
    const isInRange = isDateInRange(date, selectedRange?.from, selectedRange?.to);
    const isToday = isSameDay(date, new Date());

    const classes = ['calendar-day'];

    if (isStart) classes.push('is-start-date');
    else if (isEnd) classes.push('is-end-date');
    else if (isInRange) classes.push('is-in-range');

    if (isToday && !isStart && !isEnd) classes.push('is-today');

    return classes.join(' ');
  };

  return (
    <div className="calendar-grid-container">
      {/* Header with navigation and selects */}
      <div className="calendar-header">
        {showLeftNav && (
          <button
            type="button"
            className="calendar-nav-button"
            onClick={onPrevMonth}
            aria-label="Previous month"
          >
            <svg width="11" height="16" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.919 0l2.748 2.667L5.333 8l5.334 5.333L7.919 16 0 8z" fillRule="nonzero" />
            </svg>
          </button>
        )}

        <div className="calendar-selects">
          <select
            className="calendar-month-select"
            value={month}
            onChange={(e) => onMonthChange(parseInt(e.target.value))}
          >
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>

          <select
            className="calendar-year-select"
            value={year}
            onChange={(e) => onYearChange(parseInt(e.target.value))}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {showRightNav && (
          <button
            type="button"
            className="calendar-nav-button"
            onClick={onNextMonth}
            aria-label="Next month"
          >
            <svg width="11" height="16" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.748 16L0 13.333 5.333 8 0 2.667 2.748 0l7.919 8z" fillRule="nonzero" />
            </svg>
          </button>
        )}

        {showReset && onReset && (
          <button type="button" className="calendar-reset-button" onClick={onReset} aria-label="Reset">
            <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24">
              <path d="M0 0h24v24H0z" fill="none" />
              <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
            </svg>
          </button>
        )}
      </div>

      {/* Weekday headers */}
      <div className="calendar-weekdays">
        <div className="calendar-week-header">W</div>
        {WEEKDAYS.map((day) => (
          <div key={day} className="calendar-weekday" title={day + 'day'}>
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid with week numbers */}
      <div className="calendar-days-grid">
        {days.map((date, index) => {
          const weekIndex = Math.floor(index / 7);
          const dayInWeek = index % 7;

          return (
            <React.Fragment key={index}>
              {/* Week number at start of each week */}
              {dayInWeek === 0 && (
                <div className="calendar-week-number">{weekNumbers[weekIndex]}</div>
              )}

              {/* Day cell */}
              {date ? (
                <div
                  className={getDayClassName(date)}
                  onClick={() => onDateClick(date)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onDateClick(date);
                    }
                  }}
                >
                  {date.getDate()}
                </div>
              ) : (
                <div className="calendar-day-empty" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
