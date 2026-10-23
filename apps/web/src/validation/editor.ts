import { z } from "zod";

import { idSchema } from "@/validation/common";

/** `POST /api/editor/token` — the experiment whose tested page the editor opens. */
export const editorTokenRequestSchema = z.object({ experimentId: idSchema }).strict();
