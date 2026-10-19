import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import * as v from "valibot";

export interface experimental_CanvasInputPolicy {
  pointer?: boolean;
  /** Physical key codes forwarded only while this canvas is focused. */
  keyboard?: readonly string[];
}

const keyboardCode =
  /^(?:Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Space|Enter|Backspace|Delete|Home|End|PageUp|PageDown|ShiftLeft|ShiftRight)$/u;
const InputPolicy = v.strictObject({
  keyboard: v.optional(
    v.pipe(v.array(v.pipe(v.string(), v.regex(keyboardCode))), v.maxLength(32))
  ),
  pointer: v.optional(v.boolean()),
});

export interface experimental_CanvasPolicy {
  input?: experimental_CanvasInputPolicy;
  maxPixels?: number;
  maxFramesPerSecond?: number;
}

interface ResolvedCanvasPolicy extends experimental_CanvasPolicy {
  maxPixels: number;
  maxFramesPerSecond: number;
}

export interface experimental_CanvasProps {
  surface: string;
  width: number;
  height: number;
  ariaLabel: string;
}

/** Opt a host contract into a bounded pixel surface. */
export const experimental_canvas = (policy: experimental_CanvasPolicy = {}) => {
  const maxPixels = policy.maxPixels ?? 4_194_304;
  const maxFramesPerSecond = policy.maxFramesPerSecond ?? 60;
  if (
    !Number.isInteger(maxPixels) ||
    maxPixels < 1 ||
    maxPixels > 4_194_304 ||
    !Number.isFinite(maxFramesPerSecond) ||
    maxFramesPerSecond < 1 ||
    maxFramesPerSecond > 240
  ) {
    throw new Error("Invalid experimental canvas policy.");
  }
  const inputPolicy =
    policy.input === undefined ? undefined : v.parse(InputPolicy, policy.input);
  const fields = v.pipe(
    v.strictObject({
      ariaLabel: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512)),
      height: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4096)),
      surface: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
      width: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4096)),
    }),
    v.check(
      ({ width, height }) => width * height <= maxPixels,
      "Canvas exceeds the host pixel limit."
    )
  );
  const jsonSchema = {
    additionalProperties: false,
    properties: {
      ariaLabel: { type: "string" },
      height: { maximum: 4096, minimum: 1, type: "integer" },
      surface: { type: "string" },
      width: { maximum: 4096, minimum: 1, type: "integer" },
    },
    required: ["surface", "width", "height", "ariaLabel"],
    type: "object",
  };
  const validate = (
    input: Parameters<StandardSchemaV1["~standard"]["validate"]>[0]
  ): StandardSchemaV1.Result<experimental_CanvasProps> => {
    const parsed = v.safeParse(fields, input);
    return parsed.success
      ? { value: parsed.output }
      : { issues: parsed.issues.map(({ message }) => ({ message })) };
  };
  const standardFields: StandardSchemaV1<experimental_CanvasProps> &
    StandardJSONSchemaV1<experimental_CanvasProps> = {
    "~standard": {
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
      validate,
      vendor: "tailorkit",
      version: 1,
    },
  };
  const resolvedPolicy: ResolvedCanvasPolicy = {
    maxFramesPerSecond,
    maxPixels,
  };
  if (inputPolicy !== undefined) {
    const resolvedInput: experimental_CanvasInputPolicy = { ...inputPolicy };
    if (inputPolicy.keyboard !== undefined) {
      resolvedInput.keyboard = Object.freeze([...inputPolicy.keyboard]);
    }
    resolvedPolicy.input = Object.freeze(resolvedInput);
  }
  return {
    experimental_canvas: Object.freeze(resolvedPolicy),
    fields: standardFields,
  };
};
