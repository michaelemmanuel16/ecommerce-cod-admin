import { startOfWeek, getWeek, getISOWeek, format } from 'date-fns';

/**
 * Get the ISO week number for a given date
 * Returns format like "53 / 1" for year transition weeks
 */
export function getWeekNumber(date: Date): string {
  const week = getISOWeek(date);
  const year = date.getFullYear();
  const month = date.getMonth();

  // Check if it's a year transition week
  if (month === 0 && week > 50) {
    // First days of January that belong to last week of previous year
    return `${week} / 1`;
  } else if (month === 11 && week === 1) {
    // Last days of December that belong to first week of next year
    return `${getWeek(date)} / ${week}`;
  }

  return week.toString();
}

/**
 * Get all days in a month arranged in calendar grid
 * Returns array of dates including padding days from previous/next month
 */
export function getMonthCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Get day of week for first day (0 = Sunday, 1 = Monday, etc.)
  // We want Monday as first day, so adjust
  const firstDayOfWeek = firstDay.getDay();
  const startPadding = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  // Calculate total days to show (complete weeks)
  const daysInMonth = lastDay.getDate();
  const lastDayOfWeek = lastDay.getDay();
  const endPadding = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;

  const totalDays = startPadding + daysInMonth + endPadding;
  const days: (Date | null)[] = [];

  // Add padding days from previous month
  for (let i = 0; i < startPadding; i++) {
    days.push(null);
  }

  // Add days of current month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }

  // Add padding days from next month
  for (let i = 0; i < endPadding; i++) {
    days.push(null);
  }

  return days;
}

/**
 * Get week numbers for a month's calendar grid
 */
export function getMonthWeekNumbers(year: number, month: number): string[] {
  const days = getMonthCalendarDays(year, month);
  const weekNumbers: string[] = [];

  // Process days in groups of 7 (weeks)
  for (let i = 0; i < days.length; i += 7) {
    // Find first non-null day in the week to get week number
    const weekDays = days.slice(i, i + 7);
    const firstValidDay = weekDays.find(d => d !== null);

    if (firstValidDay) {
      weekNumbers.push(getWeekNumber(firstValidDay));
    }
  }

  return weekNumbers;
}

/**
 * Check if a date is within a range
 */
export function isDateInRange(
  date: Date,
  startDate: Date | undefined,
  endDate: Date | undefined
): boolean {
  if (!startDate || !endDate) return false;

  const time = date.getTime();
  const start = startDate.getTime();
  const end = endDate.getTime();

  return time >= start && time <= end;
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date | undefined, date2: Date | undefined): boolean {
  if (!date1 || !date2) return false;

  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Format date for display
 */
export function formatDateDisplay(date: Date): string {
  return format(date, 'MMM dd, yyyy');
}
