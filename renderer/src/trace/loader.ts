import type { Trace } from "./schema";

export async function loadTrace(url: string): Promise<Trace> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load trace: ${res.status} ${url}`);
  const trace = (await res.json()) as Trace;
  return trace;
}
