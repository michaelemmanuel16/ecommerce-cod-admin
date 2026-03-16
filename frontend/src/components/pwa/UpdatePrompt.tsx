import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 md:left-auto md:right-6 md:bottom-6 md:w-96">
      <div className="bg-gray-900 text-white rounded-lg shadow-lg p-4 flex items-center justify-between gap-3">
        <span className="text-sm">A new version is available.</span>
        <button
          onClick={() => updateServiceWorker(true)}
          className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-md whitespace-nowrap transition-colors"
        >
          Update
        </button>
      </div>
    </div>
  );
}
