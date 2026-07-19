import React from 'react';

export default function SettingsPage() {
  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-2xl font-bold text-white mb-6">Platform Settings</h1>
      <div className="max-w-3xl space-y-6">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h2 className="text-lg font-bold text-white mb-4">General Configuration</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Tenant Name</label>
              <input type="text" className="w-full bg-slate-800 border border-slate-700 text-white rounded px-4 py-2" defaultValue="Global Org" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Data Retention (Days)</label>
              <input type="number" className="w-full bg-slate-800 border border-slate-700 text-white rounded px-4 py-2" defaultValue={90} />
            </div>
            <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}
