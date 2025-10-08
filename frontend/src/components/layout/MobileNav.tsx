import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../utils/cn';

export const MobileNav: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-gray-600 hover:text-gray-900"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-gray-900 text-white p-4">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-2xl font-bold">COD Admin</h1>
            <button onClick={() => setIsOpen(false)}>
              <X className="w-6 h-6" />
            </button>
          </div>
          <nav className="space-y-2">
            <NavLink
              to="/"
              onClick={() => setIsOpen(false)}
              className="block px-4 py-2 rounded hover:bg-gray-800"
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/orders"
              onClick={() => setIsOpen(false)}
              className="block px-4 py-2 rounded hover:bg-gray-800"
            >
              Orders
            </NavLink>
          </nav>
        </div>
      )}
    </div>
  );
};
