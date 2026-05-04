import React from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

interface NoSessionProps {
  icon: LucideIcon;
  title: string;
  description: string;
  buttonText: string;
}

export const NoSession: React.FC<NoSessionProps> = ({ 
  icon: Icon, 
  title, 
  description, 
  buttonText 
}) => {
  return (
    <div className="w-full max-w-2xl text-center py-20 bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 px-6 animate-in fade-in zoom-in duration-300">
      <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mx-auto mb-6">
        <Icon size={32} />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{title}</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-sm mx-auto">
        {description}
      </p>
      <Link 
        to="/login" 
        className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm active:scale-95 transition-transform"
      >
        {buttonText}
      </Link>
    </div>
  );
};
