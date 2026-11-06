import { z } from "zod";

import { absoluteUrlSchema, idSchema } from "@/validation/common";

/** `POST /api/editor/token` — the experiment whose tested page the editor opens. */
export const editorTokenRequestSchema = z.object({ experimentId: idSchema }).strict();

/** The Event Library's element picker: a page of a project, with no experiment behind it. */
export const pickerTokenRequestSchema = z
  .object({ websiteId: idSchema, pageUrl: absoluteUrlSchema })
  .strict();
