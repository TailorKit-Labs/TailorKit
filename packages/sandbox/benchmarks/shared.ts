import * as v from "valibot";

export const Configuration = v.object({
  frames: v.optional(v.number(), 120),
  mode: v.picklist([
    "frames",
    "evaluation",
    "unregistered",
    "concurrent",
    "preserve-buffer",
    "legacy-input",
    "native-input",
    "wrong-size",
    "flood",
    "revoke",
  ]),
});
export type BenchmarkConfiguration = v.InferOutput<typeof Configuration>;
export const Result = v.object({
  elapsedMs: v.optional(v.number()),
  equivalentMegabytesPerSecond: v.optional(v.number()),
  error: v.optional(v.string()),
  frames: v.optional(v.number()),
  framesPerSecond: v.optional(v.number()),
  height: v.optional(v.number()),
  p95FrameMs: v.optional(v.number()),
  passed: v.boolean(),
  width: v.optional(v.number()),
});
export type BenchmarkResultData = v.InferOutput<typeof Result>;
