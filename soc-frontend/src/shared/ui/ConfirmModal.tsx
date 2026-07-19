import React from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen, title, message, confirmText = 'Confirm', cancelText = 'Cancel', isDestructive = false, onConfirm, onCancel
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg shadow-2xl max-w-md w-full animate-in fade-in zoom-in-95 duration-200">
        <h3 className={`text-xl font-bold mb-2 ${isDestructive ? 'text-red-500' : 'text-white'}`}>{title}</h3>
        <p className="text-slate-300 mb-6">{message}</p>
        
        <div className="flex justify-end space-x-3">
          <button onClick={onCancel} className="px-4 py-2 rounded text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors">
            {cancelText}
          </button>
          <button 
            onClick={onConfirm} 
            className={`px-4 py-2 rounded text-sm font-bold transition-colors ${
              isDestructive 
                ? 'bg-red-600 hover:bg-red-500 text-white' 
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
