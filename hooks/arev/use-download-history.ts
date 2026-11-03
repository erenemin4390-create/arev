import { useCallback, useEffect, useState } from "react";

import { clearHistory, readHistory, type DownloadRecord } from "@/lib/media/client";

export function useDownloadHistory() {
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    setRecords(await readHistory());
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- persisted history hydrates after mount.
  useEffect(() => { void refresh(); }, [refresh]);
  const clear = useCallback(async () => { await clearHistory(); setRecords([]); }, []);
  return { records, loading, refresh, clear };
}
