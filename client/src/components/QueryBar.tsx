import { useState } from "react";
import { Search, Loader2 } from "lucide-react";

export interface QueryResult {
  answer: string;
  cypher?: string;
  rawResults?: any[];
}

interface QueryBarProps {
  onResult: (result: QueryResult | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

export default function QueryBar({ onResult, loading, setLoading }: QueryBarProps) {
  const [question, setQuestion] = useState("");

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    onResult(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error(await res.text());
      onResult(await res.json());
    } catch (err: any) {
      onResult({ answer: `Error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-4 pb-3">
      <form onSubmit={handleQuery} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about the graph... e.g. 'Find generalist notes that span multiple domains'"
            className="w-full text-sm pl-9 pr-3 py-2 rounded-md bg-card border border-input focus:border-primary focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Query"}
        </button>
      </form>
    </div>
  );
}

export function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/^- (.*$)/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/<\/ul>\s*<ul>/g, "")
    .replace(/\n{2,}/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}
