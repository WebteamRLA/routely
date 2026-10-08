import { z } from "zod";

import { emailSchema, idSchema } from "@/validation/common";

/**
 * Team members — a SERVICE SEAM. These inputs store and edit `ProjectMember` rows, which are
 * shown in Settings → Team but grant no access: authorization is still owner-only.
 */

/** Owner is never a member row, so only the two lesser roles are assignable. Accepts the UI's
 * capitalised labels as well as the enum names. */
export const memberRoleSchema = z
  .enum(["EDITOR", "VIEWER", "Editor", "Viewer", "editor", "viewer"], {
    error: "Choose Editor or Viewer.",
  })
  .transform(
    (role) => (role.toUpperCase() === "VIEWER" ? "VIEWER" : "EDITOR") as "EDITOR" | "VIEWER",
  );

export const inviteMemberSchema = z.object({
  projectId: idSchema,
  email: emailSchema,
  role: memberRoleSchema.default("EDITOR"),
});

export const changeMemberRoleSchema = z.object({
  projectId: idSchema,
  memberId: idSchema,
  role: memberRoleSchema,
});

export const removeMemberSchema = z.object({
  projectId: idSchema,
  memberId: idSchema,
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
