import { z } from "zod";
import { ValidationError, type FieldError } from "./errors.js";

export type SolControlDecision = "GOAL_COMPLETE" | "BLOCKED" | "NEEDS_HUMAN" | "PAUSED";

export interface SolControlMarker {
  schemaVersion: 1;
  type: "sol-control";
  runId: string;
  controlId: string;
  iteration: number;
  createdAt: string;
  decision: SolControlDecision;
  relatedDispatchId: string | null;
  summary: string;
}

export const solControlMarkerSchema = z
  .object({
    schemaVersion: z.literal(1, {
      errorMap: () => ({ message: "schemaVersion must be 1" })
    }),
    type: z.literal("sol-control", {
      errorMap: () => ({ message: "type must be 'sol-control'" })
    }),
    runId: z.string().trim().min(1, "runId is required").max(200),
    controlId: z.string().trim().min(1, "controlId is required").max(200),
    iteration: z.number().int("iteration must be an integer").min(0, "iteration must be >= 0"),
    createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 date-time string" }),
    decision: z.enum(["GOAL_COMPLETE", "BLOCKED", "NEEDS_HUMAN", "PAUSED"], {
      errorMap: () => ({ message: "decision must be GOAL_COMPLETE, BLOCKED, NEEDS_HUMAN, or PAUSED" })
    }),
    relatedDispatchId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .nullable()
      .optional(),
    summary: z.string().trim().min(1, "summary is required").max(4000)
  })
  .strict("Unknown properties are not allowed in sol-control marker");

export function validateSolControlMarker(input: unknown): SolControlMarker {
  const result = solControlMarkerSchema.safeParse(input);
  if (!result.success) {
    const details: FieldError[] = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message
    }));
    throw new ValidationError("Sol control marker is invalid.", details);
  }
  const data = result.data as SolControlMarker;
  return {
    ...data,
    relatedDispatchId: data.relatedDispatchId ?? null
  };
}

export function isSolControlFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");
  return /^.orca\/sol-control\/[a-zA-Z0-9_-]+\.json$/.test(normalized);
}

export function extractControlIdFromPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");
  const match = normalized.match(/^.orca\/sol-control\/([a-zA-Z0-9_-]+)\.json$/);
  return match && match[1] ? match[1] : null;
}
