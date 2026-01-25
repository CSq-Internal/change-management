"use client";
import { useStore } from '@/lib/store';
import { useState } from 'react';

export default function Requests(){
  const { changes, add } = useStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold">New Request</h2>
      <div className="mt-3 flex flex-col gap-2 max-w-xl">
        <input className="border rounded p-2" placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} />
        <textarea className="border rounded p-2" placeholder="Description" value={description} onChange={e=>setDescription(e.target.value)} />
        <button className="bg-black text-white px-3 py-2 rounded w-fit" onClick={()=>{
          if(!title) return;
          add({ title, description, requester: 'you', assignees: [], riskLevel: 'medium', status: 'pending', category: 'software' });
          setTitle(''); setDescription('');
        }}>Submit</button>
      </div>
      <h3 className="text-lg font-medium mt-6">My Requests</h3>
      <ul className="mt-3 grid gap-2">
        {changes.map(c => (
          <li key={c.id} className="border rounded p-3">
            <div className="font-medium">{c.title}</div>
            <div className="text-sm text-gray-600">{c.status} • {new Date(c.createdAt).toLocaleString()}</div>
            <p className="mt-1 text-sm">{c.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
