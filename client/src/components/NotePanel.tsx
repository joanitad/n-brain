import { useQuery } from "@tanstack/react-query";
import { X, Tag, ArrowLeftRight, GitBranch, Brain } from "lucide-react";

interface NotePanelProps {
  noteId: string;
  onClose: () => void;
  onSelectNote: (id: string) => void;
  vaultColorMap: Record<string, string>;
}

export default function NotePanel({ noteId, onClose, onSelectNote, vaultColorMap }: NotePanelProps) {
  const { data: note, isLoading } = useQuery<any>({
    queryKey: [`/api/notes/${noteId}`],
    enabled: !!noteId,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (!note) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm truncate text-foreground">{note.title}</h2>
          <p className="text-xs text-muted-foreground">{note.vault}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 ml-2">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {note.tags?.length > 0 && (
          <div className="px-4 py-2 border-b border-border">
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="w-3 h-3 text-muted-foreground shrink-0" />
              {note.tags.map((tag: string) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {(note.betweenness || note.community != null) && (
          <div className="px-4 py-2 border-b border-border flex gap-3 text-xs text-muted-foreground">
            {note.betweenness > 0 && (
              <span className="flex items-center gap-1">
                <Brain className="w-3 h-3" /> Centrality: {Math.round(note.betweenness)}
              </span>
            )}
            {note.community != null && (
              <span>Community: {typeof note.community === "object" ? note.community.low : note.community}</span>
            )}
          </div>
        )}

        {note.content && (
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
              {note.content.length > 800 ? note.content.slice(0, 800) + "..." : note.content}
            </p>
          </div>
        )}

        {note.bridges?.length > 0 && (
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <ArrowLeftRight className="w-3 h-3" /> Cross-vault bridges ({note.bridges.length})
            </h3>
            <div className="space-y-1.5">
              {note.bridges.map((b: any) => (
                <button
                  key={b.id}
                  onClick={() => onSelectNote(b.id)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground group-hover:text-primary truncate">
                      {b.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {(b.similarity * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{b.vault}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {note.links?.length > 0 && (
          <div className="px-4 py-3">
            <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <GitBranch className="w-3 h-3" /> Wikilinks ({note.links.length})
            </h3>
            <div className="space-y-1">
              {note.links.map((l: any) => (
                <button
                  key={l.id}
                  onClick={() => onSelectNote(l.id)}
                  className="w-full text-left px-2 py-1 rounded hover:bg-secondary/50 text-xs text-foreground truncate"
                >
                  {l.title}
                  <span className="text-muted-foreground ml-1">({l.vault})</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
