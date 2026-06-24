import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BookOpen, Network, ArrowRight, Trash2 } from "lucide-react";
import Header from "@/components/Header";
import VaultUploader from "@/components/VaultUploader";
import ConnectionCard from "@/components/ConnectionCard";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

export default function Dashboard() {
  const { data: vaults = [] } = useQuery<any[]>({ queryKey: ["/api/vaults"] });
  const { data: feed = [] } = useQuery<any[]>({ queryKey: ["/api/feed"] });
  const { data: stats } = useQuery<any>({ queryKey: ["/api/explore/stats"] });

  async function deleteVault(id: string) {
    await apiRequest("DELETE", `/api/vaults/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/vaults"] });
    queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
    queryClient.invalidateQueries({ queryKey: ["/api/explore/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/explore/graph"] });
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-6">
        {stats && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: "Vaults", value: stats.vaults },
              { label: "Notes", value: stats.notes },
              { label: "Links", value: stats.links },
              { label: "Bridges", value: stats.bridges },
            ].map(({ label, value }) => (
              <div key={label} className="border border-border rounded-lg p-3 bg-card text-center">
                <p className="text-2xl font-semibold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-[300px_1fr] gap-6">
          <div className="space-y-4">
            <VaultUploader />

            <div>
              <h2 className="font-medium text-sm mb-2 text-muted-foreground">Imported Vaults</h2>
              {vaults.length === 0 ? (
                <p className="text-xs text-muted-foreground">No vaults yet. Import one to get started.</p>
              ) : (
                <div className="space-y-2">
                  {vaults.map((v: any) => (
                    <div key={v.id} className="border border-border rounded-lg p-3 bg-card group">
                      <div className="flex items-center justify-between">
                        <Link href={`/vaults/${v.id}`} className="flex items-center gap-2 text-foreground hover:text-primary">
                          <BookOpen className="w-4 h-4" />
                          <span className="text-sm font-medium">{v.name}</span>
                        </Link>
                        <button
                          onClick={() => deleteVault(v.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {v.noteCount} notes
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium flex items-center gap-2">
                <Network className="w-4 h-4 text-primary" />
                Serendipity Feed
              </h2>
              {feed.length > 0 && (
                <Link href="/explore" className="text-xs text-primary flex items-center gap-1 hover:underline">
                  Explore graph <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>

            {feed.length === 0 ? (
              <div className="border border-dashed border-border rounded-lg p-8 text-center">
                <Network className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Import at least two vaults to discover cross-vault connections.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {feed.map((c: any, i: number) => (
                  <ConnectionCard key={i} {...c} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
