"use client";

import { useEffect, useState } from "react";
import { getLogsAction } from "@/app/(dashboard)/logs/actions";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

type LogEntry = Awaited<ReturnType<typeof getLogsAction>>["logs"][0];

export default function LogsList() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [skip, setSkip] = useState(0);
  const take = 50;

  const fetchLogs = async (isLoadMore = false) => {
    try {
      if (isLoadMore) setLoadingMore(true);
      
      const newSkip = isLoadMore ? skip + take : 0;
      const { logs: newLogs, totalCount: newTotal } = await getLogsAction(newSkip, take);
      
      if (isLoadMore) {
        setLogs(prev => [...prev, ...newLogs]);
      } else {
        setLogs(newLogs);
      }
      
      setSkip(newSkip);
      setTotalCount(newTotal);
    } catch (error) {
      console.error("Erreur lors de la récupération des logs", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Premier chargement
  useEffect(() => {
    fetchLogs();
  }, []);

  // Polling (Actualisation automatique) toutes les 15 secondes
  useEffect(() => {
    const interval = setInterval(() => {
      // Pour le polling on recharge juste les premiers 50 (si on est au début)
      if (skip === 0) {
        fetchLogs();
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [skip]);

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900">
          Historique d'Activité ({totalCount} événements)
        </h2>
        <Button variant="outline" onClick={() => fetchLogs()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50/50 text-gray-500 uppercase text-xs border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 font-medium w-[180px]">Date</th>
                <th className="px-4 py-3 font-medium">Utilisateur</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Adresse IP</th>
                <th className="px-4 py-3 font-medium">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    Aucun log disponible
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {format(new Date(log.createdAt), "dd MMM yyyy, HH:mm:ss", { locale: fr })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{log.user.fullName}</span>
                        <span className="text-xs text-gray-500">{log.user.email}</span>
                        <span className="text-[10px] text-gray-400 uppercase mt-0.5">{log.user.role.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 uppercase text-[10px]">
                        {log.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {log.ipAddress ? (
                        <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          {log.ipAddress.replace(/^::ffff:/i, "")}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Non disponible</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600 break-words line-clamp-2" title={log.detail ? log.detail.replace(/::ffff:/gi, "") : ""}>
                        {log.detail ? log.detail.replace(/::ffff:/gi, "") : "-"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {logs.length < totalCount && (
        <div className="flex justify-center pt-4 pb-8">
          <Button 
            variant="outline" 
            onClick={() => fetchLogs(true)} 
            disabled={loadingMore}
          >
            {loadingMore && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Charger plus de résultats ({totalCount - logs.length} restants)
          </Button>
        </div>
      )}
    </div>
  );
}
