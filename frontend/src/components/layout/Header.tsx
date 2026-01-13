import React, { useState } from 'react';
import { Bell, Search, HelpCircle, BookOpen, FileText, RotateCcw } from 'lucide-react';
import { NotificationBell } from '../common/NotificationBell';
import { UserMenu } from '../common/UserMenu';
import { useOnboardingContext } from '../onboarding';
import { useAuthStore } from '../../stores/authStore';

export const Header: React.FC = () => {
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const { startTour } = useOnboardingContext();
  const { user } = useAuthStore();

  const isSalesRep = user?.role === 'sales_rep';

  const handleRestartTour = () => {
    setIsHelpMenuOpen(false);
    startTour();
  };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex-1 max-w-lg">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search orders, customers..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <NotificationBell />

          {/* Help Menu - Only visible for sales reps */}
          {isSalesRep && (
            <div className="relative">
              <button
                onClick={() => setIsHelpMenuOpen(!isHelpMenuOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Help & Support"
              >
                <HelpCircle className="w-5 h-5 text-gray-600" />
              </button>

              {isHelpMenuOpen && (
                <>
                  {/* Backdrop to close dropdown */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsHelpMenuOpen(false)}
                  />

                  {/* Dropdown Menu */}
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-20">
                    <button
                      onClick={handleRestartTour}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Take Tour Again
                    </button>

                    <button
                      onClick={() => {
                        setIsHelpMenuOpen(false);
                        window.open('/docs/guides/CUSTOMER_REP_ONBOARDING.html', '_blank');
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                    >
                      <BookOpen className="w-4 h-4" />
                      View Full Guide
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <UserMenu />
        </div>
      </div>
    </header>
  );
};
