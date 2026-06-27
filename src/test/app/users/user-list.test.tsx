import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UserList from '@/app/(dashboard)/users/user-list'
import type { DbUser } from '@/app/(dashboard)/users/types'

const users: DbUser[] = [
  {
    id: 'u1', name: 'Ada', email: 'ada@csquared.com', isActive: true, accessStatus: 'approved',
    opcoAssignments: [{ role: 'admin', isActive: true, opco: { name: 'Ghana', slug: 'ghana' } }],
  },
  {
    id: 'u2', name: 'Bo', email: 'bo@csquared.com', isActive: false, accessStatus: 'approved',
    opcoAssignments: [{ role: 'requester', isActive: false, opco: { name: 'Uganda', slug: 'uganda' } }],
  },
]

const noAccessUsers: DbUser[] = [
  { id: 'p1', name: 'Pia', email: 'pia@csquared.com', isActive: true, accessStatus: 'pending', opcoAssignments: [] },
  { id: 'd1', name: 'Dex', email: 'dex@csquared.com', isActive: true, accessStatus: 'denied', opcoAssignments: [] },
  { id: 'n1', name: 'Nan', email: 'nan@csquared.com', isActive: true, accessStatus: null, opcoAssignments: [] },
]

function renderList(list: DbUser[]) {
  return render(
    <UserList
      users={list}
      isAdmin
      language="en"
      onEdit={vi.fn()}
      onDeactivate={vi.fn()}
      onReactivate={vi.fn()}
    />
  )
}

describe('UserList', () => {
  it('shows active users and hides inactive ones by default', () => {
    renderList(users)
    expect(screen.getByText('ada@csquared.com')).toBeInTheDocument()
    expect(screen.queryByText('bo@csquared.com')).not.toBeInTheDocument()
  })

  it('groups zero-assignment users into a No access section with status tags', () => {
    renderList([users[0], ...noAccessUsers])
    expect(screen.getByText('No access / Pending')).toBeInTheDocument()
    expect(screen.getByText('pia@csquared.com')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Denied')).toBeInTheDocument()
    expect(screen.getByText('No request')).toBeInTheDocument()
  })

  it('omits the No access section when every user has an assignment', () => {
    renderList(users)
    expect(screen.queryByText('No access / Pending')).not.toBeInTheDocument()
  })
})
