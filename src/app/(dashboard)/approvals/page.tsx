"use client";
import { useStore } from '@/lib/store';

export default function Approvals(){
  const { changes, update } = useStore();
  const pending = changes.filter(c => c.status === 'pending');
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold">Approvals</h2>
      <ul className="mt-4 grid gap-2">
        {pending.map(c => (
          <li key={c.id} className="border rounded p-3">
            <div className="font-medium">{c.title}</div>
            <p className="text-sm text-gray-600">{c.description}</p>
            <div className="mt-2 flex gap-2">
              <button className="bg-emerald-600 text-white px-3 py-1 rounded" onClick={()=>update(c.id,{ status:'approved' })}>Approve</button>
              <button className="bg-rose-600 text-white px-3 py-1 rounded" onClick={()=>update(c.id,{ status:'rejected' })}>Reject</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
