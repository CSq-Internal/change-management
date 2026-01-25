"use client";
import { useStore } from '@/lib/store';

export default function Audits(){
  const { changes } = useStore();
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold">Audit Evidence</h2>
      <p className="text-gray-600">Export change records for ISO audits. (Stubbed UI)</p>
      <pre className="mt-4 bg-gray-50 p-3 rounded text-xs overflow-auto">{JSON.stringify(changes, null, 2)}</pre>
    </div>
  );
}
