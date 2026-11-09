import { useEffect, useState, useCallback } from 'react';
import { repService, type ShellSummary } from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';

const REFETCH_EVENTS = [
  'order:created',
  'order:updated',
  'order:assigned',
  'order:status_changed',
  'notification',
];

export function useRepSummary() {
  const [summary, setSummary] = useState<ShellSummary>({
    queue: 0,
    inbox: 0,
    todayConfirmed: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await repService.getSummary();
      setSummary(data);
    } catch {
      // keep existing counts on transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();

    // 60-second interval refresh
    const timer = setInterval(() => {
      void fetchSummary();
    }, 60000);

    // Socket events
    const socket = useAuthStore.getState().socket;
    if (socket) {
      REFETCH_EVENTS.forEach((event) => {
        socket.on(event, fetchSummary);
      });
    }

    return () => {
      clearInterval(timer);
      if (socket) {
        REFETCH_EVENTS.forEach((event) => {
          socket.off(event, fetchSummary);
        });
      }
    };
  }, [fetchSummary]);

  return {
    summary,
    loading,
    refetch: fetchSummary,
  };
}
