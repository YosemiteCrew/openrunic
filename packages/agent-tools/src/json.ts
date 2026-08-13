import { z } from 'zod';

/** The value space a tool may put on the wire. Deliberately not `unknown`. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() =>
  z.record(z.string(), jsonValueSchema)
);
