"use client";

import { useState } from "react";
import { ResetPasswordModal } from "./ResetPasswordModal";
import { ChangeRoleModal } from "./ChangeRoleModal";
import { DeactivateConfirmModal } from "./DeactivateConfirmModal";
import type { AdminRole } from "@/lib/supabase/database.types";
import {
  BrandedButton,
  BrandedBadge,
  BrandedTable,
  BrandedTableHeader,
  BrandedTableRow,
  BrandedTableCell
} from "@/app/admin/(dashboard)/components/branded";

interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  active: boolean;
  created_at: string;
}

export function AdminUsersList({
  adminUsers,
  currentUserEmail
}: {
  adminUsers: AdminUser[];
  currentUserEmail: string;
}) {
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [changeRoleId, setChangeRoleId] = useState<string | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const currentUser = adminUsers.find((u) => u.email === currentUserEmail);
  const isCurrentUserAdmin = currentUser?.role === "ADMIN";

  return (
    <>
      <BrandedTable>
        <BrandedTableHeader>
          <BrandedTableCell>Name</BrandedTableCell>
          <BrandedTableCell>Email</BrandedTableCell>
          <BrandedTableCell>Role</BrandedTableCell>
          <BrandedTableCell>Created</BrandedTableCell>
          <BrandedTableCell>Actions</BrandedTableCell>
        </BrandedTableHeader>
        <tbody>
          {adminUsers.map((admin) => (
            <BrandedTableRow key={admin.id}>
              <BrandedTableCell className="font-medium">{admin.full_name}</BrandedTableCell>
              <BrandedTableCell>
                {admin.email}
                {admin.email === currentUserEmail && (
                  <BrandedBadge variant="info" size="sm" className="ml-2">
                    You
                  </BrandedBadge>
                )}
              </BrandedTableCell>
              <BrandedTableCell>
                <BrandedBadge
                  variant={admin.role === "ADMIN" ? "default" : "info"}
                  size="sm"
                >
                  {admin.role}
                </BrandedBadge>
              </BrandedTableCell>
              <BrandedTableCell>
                {new Date(admin.created_at).toLocaleDateString()}
              </BrandedTableCell>
              <BrandedTableCell>
                <div className="flex gap-2">
                  <BrandedButton
                    size="sm"
                    variant="secondary"
                    onClick={() => setResetPasswordId(admin.id)}
                  >
                    Reset Password
                  </BrandedButton>

                  {isCurrentUserAdmin && admin.email !== currentUserEmail && (
                    <>
                      <BrandedButton
                        size="sm"
                        variant="secondary"
                        onClick={() => setChangeRoleId(admin.id)}
                      >
                        Change Role
                      </BrandedButton>

                      {adminUsers.filter((u) => u.active).length > 1 && (
                        <BrandedButton
                          size="sm"
                          variant="danger"
                          onClick={() => setDeactivateId(admin.id)}
                        >
                          Deactivate
                        </BrandedButton>
                      )}
                    </>
                  )}
                </div>
              </BrandedTableCell>
            </BrandedTableRow>
          ))}
        </tbody>
      </BrandedTable>

      {/* Modals */}
      {resetPasswordId && (
        <ResetPasswordModal
          adminId={resetPasswordId}
          adminUser={adminUsers.find((u) => u.id === resetPasswordId)!}
          onClose={() => setResetPasswordId(null)}
        />
      )}

      {changeRoleId && (
        <ChangeRoleModal
          adminId={changeRoleId}
          adminUser={adminUsers.find((u) => u.id === changeRoleId)!}
          onClose={() => setChangeRoleId(null)}
        />
      )}

      {deactivateId && (
        <DeactivateConfirmModal
          adminId={deactivateId}
          adminUser={adminUsers.find((u) => u.id === deactivateId)!}
          onClose={() => setDeactivateId(null)}
        />
      )}
    </>
  );
}
