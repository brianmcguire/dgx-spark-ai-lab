// User-described illustration only. Never use this to infer device health or routing.
export function normalizeSparkSetup(value) {
  if (value != null && (typeof value !== "object" || Array.isArray(value))) {
    throw new Error("Spark setup must be an object.");
  }
  const count = value?.count ?? 1;
  const layout = value?.layout ?? "independent";
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new Error("Spark count must be a whole number from 1 to 4.");
  }
  if (!["independent", "linked"].includes(layout)) {
    throw new Error("Spark layout must be independent or linked.");
  }
  return { count, layout };
}

// Match the artwork's 62-unit rear/left chassis height. No lateral offset:
// upper chassis occlude the lower top surfaces instead of floating above them.
export const SPARK_STACK_PITCH = 62;

export function sparkStackUnits(count) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    x: 0,
    y: index * SPARK_STACK_PITCH,
  }));
}
