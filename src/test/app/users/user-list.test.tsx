import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UserList from '@/app/(dashboard)/users/user-list'
import type { DbUser } from '@/app/(dashboard)/users/types'

const users: DbUser[] = [
  {
    id: 'u1', name: 'Ada', email: 'ada@csquared.com', isActive: true,
    opcoAssignments: [{ role: 'admin', isActive: true, opco: { name: 'Ghana', slug: 'ghana' } }],
  },
  {
    id: 'u2', name: 'Bo', email: 'bo@csquared.com', isActive: false,
    opcoAssignments: [{ role: 'requester', isActive: false, opco: { name: 'Uganda', slug: 'uganda' } }],
  },
]

describe('UserList', () => {
  it('shows active users and hides inactive ones by default', () => {
    render(
      <UserList
        users={users}
        isAdmin
        language="en"
        onEdit={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    )
    expect(screen.getByText('ada@csquared.com')).toBeInTheDocument()
    expect(screen.queryByText('bo@csquared.com')).not.toBeInTheDocument()
  })
})
