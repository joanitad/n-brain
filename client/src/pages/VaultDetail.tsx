import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ArrowLeft, FileText, Tag } from "lucide-react";
import Header from "@/components/Header";

export default function VaultDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: notes = [] } = useQuery<any[]>({ queryKey: [`/api/vaults/${id}/notes`] });

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>

        <h1 className="text-xl font-semibold mb-4">{notes.length} Notes</h1>

        <div className="space-y-2">
          {notes.map((note: any) => (
            <div key={note.id} className="border border-border rounded-lg p-3 bg-card">
              <div className="flex items-start gap-2">
                <FileText className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{note.title}</h3>
                  {note.contentPreview && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {note.contentPreview}
                    </p>
                  )}
                  {note.tags?.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      <Tag className="w-3 h-3 text-muted-foreground" />
                      {note.tags.map((tag: string) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
