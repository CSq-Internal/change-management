import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { setGroupRole, setUserAssignments } = vi.hoisted(() => ({
  setGroupRole: vi.fn(async () => undefined),
  setUserAssignments: vi.fn(async () => undefined),
}))
vi.mock('@/server/actions/users', () => ({ setGroupRole, setUserAssignments }))
vi.mock('@/components/ui/toaster', () => ({ useToast: () => ({ toast: vi.fn() }) }))

import EditUserDialog from '@/app/(dashboard)/users/edit-user-dialog'
import type { DbUser } from '@/app/(dashboard)/users/types'

const auditor: DbUser = {
  id: 'u1', name: 'Ada', email: 'ada@csquared.com', isActive: true, isGroupAdmin: false, isGroupAuditor: true,
  accessStatus: null, opcoAssignments: [],
}

function renderDialog(canSetGroupRole: boolean) {
  return render(
    <EditUserDialog user={auditor} language="en" opcos={[]} canSetGroupRole={canSetGroupRole} onClose={vi.fn()} onSaved={vi.fn()} />
  )
}

describe('EditUserDialog group role', () => {
  it('hides the group role control from a viewer who is not a group admin', () => {
    renderDialog(false)
    expect(screen.queryByLabelText('Group role')).not.toBeInTheDocument()
  })

  it('shows the current group role to a group admin', () => {
    renderDialog(true)
    expect(screen.getByLabelText('Group role')).toHaveValue('group_auditor')
  })

  it('saves the group role without touching OpCo assignments', async () => {
    renderDialog(true)
    fireEvent.change(screen.getByLabelText('Group role'), { target: { value: 'group_admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save group role' }))
    await waitFor(() => expect(setGroupRole).toHaveBeenCalledWith('u1', 'group_admin'))
    expect(setUserAssignments).not.toHaveBeenCalled()
  })

  it('sends null for None', async () => {
    renderDialog(true)
    fireEvent.change(screen.getByLabelText('Group role'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save group role' }))
    await waitFor(() => expect(setGroupRole).toHaveBeenCalledWith('u1', null))
  })
})
