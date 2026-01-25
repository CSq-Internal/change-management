"use client";
import { useStore } from '@/lib/store';

export default function Changes(){
  const { changes, update } = useStore();
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold">Change Log</h2>
      <ul className="mt-4 grid gap-2">
        {changes.map(c => (
          <li key={c.id} className="border rounded p-3">
            <div className="font-medium">{c.title}</div>
            <div className="text-sm text-gray-600">{c.status} • {new Date(c.updatedAt).toLocaleString()}</div>
            <div className="mt-2 flex gap-2 text-sm">
              <button className="border px-2 py-1 rounded" onClick={()=>update(c.id,{ status:'implemented' })}>Mark Implemented</button>
              <button className="border px-2 py-1 rounded" onClick={()=>update(c.id,{ status:'verified' })}>Mark Verified</button>
              <button className="border px-2 py-1 rounded" onClick={()=>update(c.id,{ status:'closed' })}>Close</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
