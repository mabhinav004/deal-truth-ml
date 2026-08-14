import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReferenceDoc {
  name: string;
  title: string;
  body: string;
}

const DOCS_DIR = join(process.cwd(), 'docs');

const DOC_META: Record<string, { title: string }> = {
  'README.md': { title: 'Design doc index' },
  'API.md': { title: 'HTTP API' },
  'MODELS.md': { title: 'Model routing' },
  'PROMPTS.md': { title: 'Prompt library' },
  'HOSTING.md': { title: 'Local and production hosting' },
  'DEPLOYMENT.md': { title: 'Deployment' },
  'PROJECT_CONTEXT.md': { title: 'Project context' },
  'LICENSE_AUDIT.md': { title: 'License audit' },
};

function loadDoc(name: string): string {
  return readFileSync(join(DOCS_DIR, name), 'utf8');
}

export function listReferenceDocs(
  pathPrefix: string,
): { name: string; title: string; path: string }[] {
  return Object.entries(DOC_META).map(([name, doc]) => ({
    name,
    title: doc.title,
    path: `${pathPrefix}/${name}`,
  }));
}

export function getReferenceDoc(name: string): ReferenceDoc | null {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return null;
  }
  const meta = DOC_META[name];
  if (!meta) {
    return null;
  }
  return { name, title: meta.title, body: loadDoc(name) };
}
