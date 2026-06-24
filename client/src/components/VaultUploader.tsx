import { useState, useRef } from "react";
import { Upload, FolderOpen, Loader2, Github } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

type Mode = "github" | "path" | "zip";

export default function VaultUploader() {
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [mode, setMode] = useState<Mode>("github");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file?: File) {
    setUploading(true);
    try {
      let res: Response;

      if (mode === "zip" && file) {
        const formData = new FormData();
        formData.append("name", name || "Untitled Vault");
        formData.append("vault", file);
        res = await fetch("/api/vaults/upload", { method: "POST", body: formData });
      } else {
        const body: Record<string, string> = { name: name || "Untitled Vault" };
        if (mode === "github") body.githubUrl = githubUrl;
        else if (mode === "path") body.path = folderPath;
        else return;
        res = await fetch("/api/vaults/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error("Upload failed:", errText);
        alert(`Upload failed: ${errText}`);
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/vaults"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/explore/stats"] });
      setName("");
      setFolderPath("");
      setGithubUrl("");
    } finally {
      setUploading(false);
    }
  }

  const modes: { key: Mode; label: string }[] = [
    { key: "github", label: "GitHub" },
    { key: "path", label: "Local Path" },
    { key: "zip", label: "ZIP Upload" },
  ];

  return (
    <div className="border border-dashed border-border rounded-lg p-4 bg-card">
      <h3 className="font-medium text-sm mb-3">Import Vault</h3>

      <div className="flex gap-2 mb-3">
        {modes.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`text-xs px-2 py-1 rounded ${mode === m.key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "github" && (
        <>
          <label className="text-xs text-muted-foreground mb-1 block">GitHub URL</label>
          <input
            type="url"
            placeholder="https://github.com/user/obsidian-vault"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            className="w-full text-sm px-3 py-1.5 rounded-md bg-background border border-input mb-2 text-foreground placeholder:text-muted-foreground"
          />
          <label className="text-xs text-muted-foreground mb-1 block">Vault name (optional)</label>
          <input
            type="text"
            placeholder="My Vault"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-sm px-3 py-1.5 rounded-md bg-background border border-input mb-2 text-foreground placeholder:text-muted-foreground"
          />
          <button
            onClick={() => handleUpload()}
            disabled={uploading || !githubUrl}
            className="w-full flex items-center justify-center gap-2 text-sm py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
            {uploading ? "Cloning & importing..." : "Import from GitHub"}
          </button>
        </>
      )}

      {mode === "path" && (
        <>
          <label className="text-xs text-muted-foreground mb-1 block">Folder path</label>
          <input
            type="text"
            placeholder="/path/to/obsidian/vault"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            className="w-full text-sm px-3 py-1.5 rounded-md bg-background border border-input mb-2 text-foreground placeholder:text-muted-foreground"
          />
          <label className="text-xs text-muted-foreground mb-1 block">Vault name (optional)</label>
          <input
            type="text"
            placeholder="My Vault"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-sm px-3 py-1.5 rounded-md bg-background border border-input mb-2 text-foreground placeholder:text-muted-foreground"
          />
          <button
            onClick={() => handleUpload()}
            disabled={uploading || !folderPath}
            className="w-full flex items-center justify-center gap-2 text-sm py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
            {uploading ? "Importing..." : "Import from Path"}
          </button>
        </>
      )}

      {mode === "zip" && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 text-sm py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading..." : "Upload ZIP"}
          </button>
        </>
      )}
    </div>
  );
}
