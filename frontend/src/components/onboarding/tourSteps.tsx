import { Step } from 'react-joyride';

/**
 * Customer Rep Onboarding Tour Steps
 *
 * An 11-step guided tour for new sales reps covering:
 * - Dashboard metrics (earnings, pending orders)
 * - Order management (creating, updating status, logging calls)
 * - Customer management
 *
 * Each step targets specific CSS classes added to components for highlighting.
 */
export const customerRepTourSteps: Step[] = [
  // Step 1: Welcome
  {
    target: 'body',
    content: (
      <div>
        <h2 className="text-xl font-bold mb-2">Welcome to Your Dashboard!</h2>
        <p className="mb-2">
          Let's take a quick 2-3 minute tour of the 4 main tasks you'll do every day:
        </p>
        <ul className="list-disc ml-6 space-y-1 text-sm">
          <li>Creating new orders</li>
          <li>Following up on pending orders</li>
          <li>Adding customers</li>
          <li>Updating order status</li>
        </ul>
        <p className="mt-3 text-sm text-gray-600">
          You can skip this tour anytime by clicking "Skip" or restart it later from the Help menu.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },

  // Step 2: Earnings Card
  {
    target: '.onboarding-earnings-card',
    content: (
      <div>
        <h3 className="font-bold mb-2">💰 Your Commission Earnings</h3>
        <p>
          This shows your commission from delivered orders. Your goal is to grow this number by:
        </p>
        <ul className="list-disc ml-6 mt-2 space-y-1 text-sm">
          <li>Creating more orders</li>
          <li>Following up quickly on pending orders</li>
          <li>Ensuring orders get delivered successfully</li>
        </ul>
      </div>
    ),
    placement: 'bottom',
  },

  // Step 3: Pending Orders Card (CRITICAL - Most Important!)
  {
    target: '.onboarding-pending-orders',
    content: (
      <div>
        <h3 className="font-bold mb-2 text-red-600">⚠️ PENDING ORDERS - YOUR #1 PRIORITY!</h3>
        <p className="mb-2">
          <strong>This is the most important metric!</strong> These orders need your attention ASAP.
        </p>
        <div className="bg-yellow-50 border border-yellow-200 rounded p-2 my-2">
          <p className="text-sm font-semibold">Why this matters:</p>
          <p className="text-sm">
            Pending orders are potential lost sales! The longer they sit, the more likely the customer changes their mind.
            <strong> Follow up within 24 hours!</strong>
          </p>
        </div>
        <p className="text-sm">
          Click on this card to see all pending orders and start calling customers to confirm them.
        </p>
      </div>
    ),
    placement: 'bottom',
    styles: {
      spotlight: {
        borderColor: '#ef4444',
        borderWidth: 3,
        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },

  // Step 4: Other Stats Cards
  {
    target: '.onboarding-stats-cards',
    content: (
      <div>
        <h3 className="font-bold mb-2">📊 Track Your Performance</h3>
        <p className="mb-2">These cards help you monitor your productivity:</p>
        <ul className="list-disc ml-6 space-y-1 text-sm">
          <li><strong>Total Orders:</strong> All orders you've created</li>
          <li><strong>Conversion Rate:</strong> % of orders that get delivered (aim for 70%+)</li>
        </ul>
      </div>
    ),
    placement: 'bottom',
  },

  // Step 5: Navigate to Orders
  {
    target: 'a[href="/orders"]',
    content: (
      <div>
        <h3 className="font-bold mb-2">📋 Orders Page</h3>
        <p>
          Click here to view all your orders, create new ones, and update order status.
          Let's go there now!
        </p>
      </div>
    ),
    placement: 'right',
  },

  // Step 6: New Order Button
  {
    target: '.onboarding-new-order-btn',
    content: (
      <div>
        <h3 className="font-bold mb-2">➕ Create New Orders</h3>
        <p className="mb-2">
          Click this button whenever a customer wants to place an order. You'll be able to:
        </p>
        <ul className="list-disc ml-6 space-y-1 text-sm">
          <li>Search for existing customers or create new ones</li>
          <li>Select products and quantities</li>
          <li>Enter delivery address details</li>
          <li>Add notes about the order</li>
        </ul>
      </div>
    ),
    placement: 'bottom',
  },

  // Step 7: Orders Table and Status Management
  {
    target: '.onboarding-orders-table-header',
    content: (
      <div>
        <h3 className="font-bold mb-2">📝 Your Orders List</h3>
        <p className="mb-2">
          This table shows all orders assigned to you. Here you can:
        </p>
        <ul className="list-disc ml-6 space-y-1 text-sm">
          <li>View order details by clicking on any order</li>
          <li>Update order status using the dropdown (especially pending → confirmed)</li>
          <li>Log customer calls and add notes</li>
          <li>Filter orders by status, date, or customer</li>
        </ul>
        <div className="mt-3 p-2 bg-blue-50 rounded text-sm">
          <p className="font-semibold mb-1">💡 Status Update Tips:</p>
          <p><strong>Customer confirmed?</strong> → Change to "Confirmed"</p>
          <p><strong>No answer?</strong> → Keep as "Pending", add note, try again</p>
          <p><strong>Customer cancelled?</strong> → Change to "Cancelled"</p>
        </div>
      </div>
    ),
    placement: 'bottom',
  },

  // Step 8: Search Bar
  {
    target: '.onboarding-search-bar',
    content: (
      <div>
        <h3 className="font-bold mb-2">🔍 Search Orders</h3>
        <p>
          Quickly find orders by searching for:
        </p>
        <ul className="list-disc ml-6 mt-2 space-y-1 text-sm">
          <li>Customer name</li>
          <li>Phone number</li>
          <li>Order ID</li>
        </ul>
      </div>
    ),
    placement: 'bottom',
  },

  // Step 9: Navigate to Customers
  {
    target: 'a[href="/customers"]',
    content: (
      <div>
        <h3 className="font-bold mb-2">👥 Customers Page</h3>
        <p>
          Click here to manage your customer database. You'll need to add customers
          before creating orders for them. Let's check it out!
        </p>
      </div>
    ),
    placement: 'right',
  },

  // Step 10: Add Customer Button
  {
    target: '.onboarding-add-customer-btn',
    content: (
      <div>
        <h3 className="font-bold mb-2">➕ Add New Customers</h3>
        <p className="mb-2">
          Click this button to add a new customer to your database. You'll need:
        </p>
        <ul className="list-disc ml-6 space-y-1 text-sm">
          <li>Customer's full name</li>
          <li>Phone number (required)</li>
          <li>Email (optional)</li>
          <li>Complete delivery address</li>
        </ul>
        <p className="mt-2 text-sm font-semibold">
          💡 Tip: Add customers first, then create orders for them!
        </p>
      </div>
    ),
    placement: 'bottom',
  },

  // Step 11: Tour Complete
  {
    target: 'body',
    content: (
      <div>
        <h2 className="text-xl font-bold mb-2">🎉 Tour Complete!</h2>
        <p className="mb-3">
          Great! You now know the basics. Remember these 3 key things:
        </p>
        <div className="space-y-2 mb-3">
          <div className="bg-red-50 border border-red-200 rounded p-2">
            <strong className="text-red-600">1. Follow up on pending orders ASAP</strong>
            <p className="text-sm">This is your #1 priority - don't let orders sit!</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded p-2">
            <strong className="text-blue-600">2. Always add notes after calls</strong>
            <p className="text-sm">Document what happened so everyone is informed</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded p-2">
            <strong className="text-green-600">3. Keep customer info accurate</strong>
            <p className="text-sm">Double-check phone numbers and addresses</p>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          Need to see this tour again? Go to <strong>Help → Take Tour Again</strong>
        </p>
        <p className="text-sm text-gray-600 mt-2">
          For the full guide with screenshots, go to <strong>Help → View Full Guide</strong>
        </p>
      </div>
    ),
    placement: 'center',
  },
];

/**
 * Additional configuration for the tour
 */
export const tourConfig = {
  continuous: true,
  showProgress: true,
  showSkipButton: true,
  disableOverlayClose: true,
  disableCloseOnEsc: false,
  spotlightClicks: false,
  styles: {
    options: {
      zIndex: 10100,
      primaryColor: '#2563eb', // Blue primary color (Tailwind blue-600)
      textColor: '#1f2937', // Dark gray text
      backgroundColor: '#ffffff',
      overlayColor: 'rgba(0, 0, 0, 0.5)',
      arrowColor: '#ffffff',
      width: 400,
    },
    tooltip: {
      borderRadius: 8,
      padding: 20,
    },
    tooltipContainer: {
      textAlign: 'left' as const,
    },
    buttonNext: {
      backgroundColor: '#2563eb',
      fontSize: 14,
      padding: '8px 16px',
      borderRadius: 6,
    },
    buttonBack: {
      marginRight: 10,
      color: '#6b7280',
      fontSize: 14,
    },
    buttonSkip: {
      color: '#6b7280',
      fontSize: 14,
    },
  },
  locale: {
    back: 'Back',
    close: 'Close',
    last: 'Finish Tour',
    next: 'Next',
    skip: 'Skip Tour',
  },
};
