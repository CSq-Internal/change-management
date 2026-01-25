"use client";
import Link from 'next/link';

export default function Home(){
  const nav = [
    { href: '/requests', label: 'Requests' },
    { href: '/approvals', label: 'Approvals' },
    { href: '/changes', label: 'Changes' },
    { href: '/audits', label: 'Audits' },
  ];
  return (
    <main className="min-h-screen p-6">
      <h1 className="text-2xl font-semibold">Change Management System</h1>
      <p className="text-gray-600 mt-2">Internal ISO compliance workflows: raise, approve, implement, and audit changes.</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {nav.map(n => (
          <li key={n.href} className="border rounded p-4 hover:bg-gray-50">
            <Link href={n.href} className="font-medium">{n.label} →</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
