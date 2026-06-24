import { ArrowLeftRight, Sparkles } from "lucide-react";

interface ConnectionCardProps {
  noteA: { id: string; title: string; contentPreview: string };
  vaultA: string;
  noteB: { id: string; title: string; contentPreview: string };
  vaultB: string;
  similarity: number;
  bridgeScore: number;
  explanation?: string;
}

export default function ConnectionCard({
  noteA,
  vaultA,
  noteB,
  vaultB,
  similarity,
  bridgeScore,
  explanation,
}: ConnectionCardProps) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-xs font-medium text-primary">
          Bridge Score: {(bridgeScore * 100).toFixed(0)}%
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          Similarity: {(similarity * 100).toFixed(0)}%
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground mb-1">{vaultA}</p>
          <h3 className="font-medium text-sm truncate">{noteA.title}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {noteA.contentPreview}
          </p>
        </div>

        <div className="flex items-center pt-5">
          <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
        </div>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground mb-1">{vaultB}</p>
          <h3 className="font-medium text-sm truncate">{noteB.title}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {noteB.contentPreview}
          </p>
        </div>
      </div>

      {explanation && (
        <p className="mt-3 text-xs text-muted-foreground italic border-t border-border pt-2">
          {explanation}
        </p>
      )}
    </div>
  );
}
