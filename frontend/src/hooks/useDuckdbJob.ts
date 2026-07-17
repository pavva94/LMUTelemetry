import { useCallback, useRef, useState } from "react";
import { api } from "../api/client";
import type { DuckdbJobStatus } from "../types/lmuDuckdb";

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function useDuckdbJob() {
  const [progress, setProgress] = useState<DuckdbJobStatus | null>(null);
  const generation = useRef(0);

  const run = useCallback(async <T,>(start: () => Promise<DuckdbJobStatus>): Promise<T> => {
    const currentGeneration = ++generation.current;
    const started = await start();
    setProgress(started);
    let status = started;
    while (status.status === "queued" || status.status === "running") {
      await wait(120);
      status = await api.duckdbJobStatus(status.job_id);
      if (generation.current === currentGeneration) setProgress(status);
    }
    if (status.status === "failed") throw new Error(status.error || status.message || "Session job failed");
    const result = await api.duckdbJobResult<T>(status.job_id);
    if (generation.current === currentGeneration) setProgress(status);
    return result;
  }, []);

  const clearProgress = useCallback(() => setProgress(null), []);
  return { run, progress, clearProgress };
}
