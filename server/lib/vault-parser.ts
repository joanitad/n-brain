import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

export interface ParsedNote {
  id: string;
  title: string;
  content: string;
  contentPreview: string;
  tags: string[];
  outgoingLinks: string[];
}

export async function parseVaultDirectory(vaultPath: string): Promise<ParsedNote[]> {
  const notes: ParsedNote[] = [];
  await walkDir(vaultPath, vaultPath, notes);
  return notes;
}

async function walkDir(dir: string, root: string, notes: ParsedNote[]) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, root, notes);
    } else if (entry.name.endsWith(".md")) {
      const content = await fs.promises.readFile(fullPath, "utf-8");
      notes.push(parseMarkdownNote(entry.name.replace(/\.md$/, ""), content));
    }
  }
}

function parseMarkdownNote(title: string, raw: string): ParsedNote {
  let content = raw;
  const tags: string[] = [];

  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontmatterMatch) {
    content = raw.slice(frontmatterMatch[0].length);
    const tagLine = frontmatterMatch[1].match(/tags:\s*\[([^\]]*)\]/);
    if (tagLine) {
      tags.push(...tagLine[1].split(",").map((t) => t.trim().replace(/['"]/g, "")).filter(Boolean));
    }
    const tagLines = frontmatterMatch[1].match(/tags:\s*\n((?:\s*-\s*.+\n?)*)/);
    if (tagLines) {
      tags.push(
        ...tagLines[1]
          .split("\n")
          .map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/['"]/g, ""))
          .filter(Boolean),
      );
    }
  }

  const inlineTags = content.match(/#([a-zA-Z][\w-/]*)/g);
  if (inlineTags) {
    tags.push(...inlineTags.map((t) => t.slice(1)));
  }

  const wikilinks = Array.from(content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)).map((m) => m[1]);

  const plainText = content
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/!\[\[.*?\]\]/g, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
    .replace(/[#*_`~>\[\]]/g, "")
    .trim();

  return {
    id: nanoid(),
    title,
    content: plainText,
    contentPreview: plainText.slice(0, 200),
    tags: Array.from(new Set(tags)),
    outgoingLinks: Array.from(new Set(wikilinks)),
  };
}
