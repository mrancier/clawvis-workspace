/**
 * Skills API — reads MegaMaCluw skills registry
 * Registry: /root/MegaMaCluw/.claude/claudeclaw/skills-registry.json
 * Learned skills: /root/MegaMaCluw/.claude/skills/learned/*.md
 * Claudeclaw built-in skills: /root/MegaMaCluw/.claude/claudeclaw/skills/*.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

const REGISTRY_PATH = '/root/MegaMaCluw/.claude/claudeclaw/skills-registry.json'
const LEARNED_DIR = '/root/MegaMaCluw/.claude/skills/learned'
const BUILTIN_DIR = '/root/MegaMaCluw/.claude/claudeclaw/skills'

function readRegistry(): { version: number; skills: object[]; last_synthesized: string } {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
  } catch {
    return { version: 1, skills: [], last_synthesized: '' }
  }
}

function skillFromRegistryEntry(entry: Record<string, unknown>, idx: number): object {
  const name = String(entry.name || `skill-${idx}`)
  const triggers = Array.isArray(entry.triggers) ? entry.triggers as string[] : []
  let content = ''
  try {
    if (entry.file && fs.existsSync(String(entry.file))) {
      content = fs.readFileSync(String(entry.file), 'utf-8').slice(0, 500)
    }
  } catch { /* ok */ }
  return {
    id: name,
    slug: name,
    name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: triggers.slice(0, 3).join(', ') || 'MegaMaCluw learned skill',
    author: 'MegaMaCluw',
    triggers,
    tags: ['learned', 'auto-synthesized'],
    homepage: null,
    category: 'Learned',
    icon: '🧠',
    content: content.slice(0, 200),
    fileCount: 1,
    sourcePath: String(entry.file || ''),
    installed: true,
    enabled: true,
    builtin: false,
    security: { level: 'safe', flags: [], score: 0 },
    created: entry.created || null,
  }
}

function getBuiltinSkills(): object[] {
  const dirs = [LEARNED_DIR, BUILTIN_DIR].filter(d => {
    try { return fs.statSync(d).isDirectory() } catch { return false }
  })
  const registry = readRegistry()
  const registryNames = new Set((registry.skills as Record<string, unknown>[]).map(s => String(s.name)))
  const extra: object[] = []
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const name = f.replace(/\.md$/, '')
        if (registryNames.has(name)) continue
        const fullPath = path.join(dir, f)
        let content = ''
        try { content = fs.readFileSync(fullPath, 'utf-8').slice(0, 200) } catch { /* ok */ }
        extra.push({
          id: name,
          slug: name,
          name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: content.split('\n').find(l => l.trim() && !l.startsWith('#')) || '',
          author: 'MegaMaCluw',
          triggers: [],
          tags: ['builtin'],
          homepage: null,
          category: 'Built-in',
          icon: '⚡',
          content: content,
          fileCount: 1,
          sourcePath: fullPath,
          installed: true,
          enabled: true,
          builtin: true,
          security: { level: 'safe', flags: [], score: 0 },
        })
      }
    } catch { /* ok */ }
  }
  return extra
}

function allSkills(): object[] {
  const registry = readRegistry()
  const fromRegistry = (registry.skills as Record<string, unknown>[]).map(skillFromRegistryEntry)
  const builtins = getBuiltinSkills()
  return [...fromRegistry, ...builtins]
}

export const Route = createFileRoute('/api/skills')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, { status: 401 })
        const url = new URL(request.url)
        const tab = url.searchParams.get('tab') || 'installed'
        const q = (url.searchParams.get('q') || '').toLowerCase()
        const category = url.searchParams.get('category') || 'All'

        let skills = allSkills() as Record<string, unknown>[]

        if (q) {
          skills = skills.filter(s =>
            String(s.name).toLowerCase().includes(q) ||
            String(s.description).toLowerCase().includes(q) ||
            (Array.isArray(s.triggers) && (s.triggers as string[]).some(t => t.toLowerCase().includes(q)))
          )
        }
        if (category !== 'All') {
          skills = skills.filter(s => s.category === category)
        }

        const registry = readRegistry()
        return json({
          skills,
          total: skills.length,
          tab,
          categories: ['All', 'Learned', 'Built-in'],
          registry_version: registry.version,
          last_synthesized: registry.last_synthesized,
        })
      },
    },
  },
})
