import React from 'react';

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string;
  isLoading?: boolean;
}

export function DataTable<T>({ data, columns, keyExtractor, isLoading }: DataTableProps<T>) {
  if (isLoading) {
    return <div className="p-4"><div className="animate-pulse space-y-4">
      {Array.from({length: 5}).map((_, i) => <div key={i} className="h-10 bg-slate-800 rounded"></div>)}
    </div></div>;
  }

  if (!data || data.length === 0) {
    return <div className="p-8 text-center text-slate-500">No records found.</div>;
  }

  return (
    <div className="overflow-x-auto w-full">
      <table className="w-full text-sm text-left text-slate-300">
        <thead className="text-xs uppercase bg-slate-800/50 text-slate-400">
          <tr>
            {columns.map(col => (
              <th key={String(col.key)} className="px-4 py-3">{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={keyExtractor(item)} className="border-b border-slate-700/50 hover:bg-slate-800/30">
              {columns.map(col => (
                <td key={String(col.key)} className="px-4 py-3">
                  {col.render ? col.render(item) : String((item as any)[col.key] || '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
