/**
 * Jobs API — reads/writes MegaMaCluw markdown job files
 * Jobs live in /root/MegaMaCluw/.claude/claudeclaw/jobs/*.md
 * Frontmatter: schedule, recurring, telegram, enabled
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

const JOBS_DIR = '/root/MegaMaCluw/.claude/claudeclaw/jobs'

type JobFrontmatter = {
  schedule?: string
  recurring?: boolean
  telegram?: boolean
  enabled?: boolean
  name?: string
}

function parseJob(filename: string): object | null {
  const fullPath = path.join(JOBS_DIR, filename)
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8')
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/m)
    let fm: JobFrontmatter = {}
    let prompt = raw.trim()

    if (fmMatch) {
      const fmLines = fmMatch[1].split('\n')
      for (const line of fmLines) {
        const [k, ...rest] = line.split(':')
        const v = rest.join(':').trim().replace(/^["']|["']$/g, '')
        const key = k?.trim()
        if (!key) continue
        if (key === 'schedule') fm.schedule = v
        else if (key === 'recurring') fm.recurring = v === 'true'
        else if (key === 'telegram') fm.telegram = v === 'true'
        else if (key === 'enabled') fm.enabled = v !== 'false'
        else if (key === 'name') fm.name = v
      }
      prompt = fmMatch[2].trim()
    }

    const id = filename.replace(/\.md$/, '')
    const stat = fs.statSync(fullPath)
    const deliver = fm.telegram ? ['telegram'] : []

    return {
      id,
      name: fm.name || id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      prompt,
      schedule: { cron: fm.schedule || '' },
      schedule_display: fm.schedule || 'manual',
      enabled: fm.enabled !== false,
      state: fm.enabled !== false ? 'active' : 'paused',
      next_run_at: null,
      last_run_at: null,
      last_run_success: null,
      created_at: stat.birthtime.toISOString(),
      updated_at: stat.mtime.toISOString(),
      deliver,
      recurring: fm.recurring ?? true,
      run_count: 0,
    }
  } catch {
    return null
  }
}

function listJobs(): object[] {
  try {
    return fs.readdirSync(JOBS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => parseJob(f))
      .filter(Boolean) as object[]
  } catch {
    return []
  }
}

function writeJob(id: string, name: string, prompt: string, schedule: string, deliver: string[], recurring: boolean): void {
  const telegram = deliver.includes('telegram')
  const fm = [
    `schedule: "${schedule}"`,
    `recurring: ${recurring}`,
    `telegram: ${telegram}`,
    name ? `name: ${name}` : null,
  ].filter(Boolean).join('\n')
  const content = `---\n${fm}\n---\n\n${prompt}\n`
  fs.writeFileSync(path.join(JOBS_DIR, `${id}.md`), content, 'utf-8')
}

function toggleJob(id: string, enabled: boolean): boolean {
  const fullPath = path.join(JOBS_DIR, `${id}.md`)
  if (!fs.existsSync(fullPath)) return false
  let content = fs.readFileSync(fullPath, 'utf-8')
  const hasEnabled = content.match(/^enabled:\s*.*/m)
  if (hasEnabled) {
    content = content.replace(/^enabled:\s*.*/m, `enabled: ${enabled}`)
  } else {
    content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`)
  }
  fs.writeFileSync(fullPath, content, 'utf-8')
  return true
}

export const Route = createFileRoute('/api/hermes-jobs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, { status: 401 })
        const url = new URL(request.url)
        const pathParts = url.pathname.split('/').filter(Boolean)
        const jobId = pathParts[pathParts.length - 1] !== 'hermes-jobs' ? pathParts[pathParts.length - 1] : null
        if (jobId) {
          const job = parseJob(`${jobId}.md`)
          return job ? json({ job }) : json({ error: 'Not found' }, { status: 404 })
        }
        return json({ jobs: listJobs(), total: listJobs().length })
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, { status: 401 })
        const url = new URL(request.url)
        const action = url.searchParams.get('action')
        const pathParts = url.pathname.split('/').filter(Boolean)
        const jobId = pathParts[pathParts.length - 1] !== 'hermes-jobs' ? pathParts[pathParts.length - 1] : null

        if (jobId && action === 'pause') {
          toggleJob(jobId, false)
          return json({ job: parseJob(`${jobId}.md`) })
        }
        if (jobId && action === 'resume') {
          toggleJob(jobId, true)
          return json({ job: parseJob(`${jobId}.md`) })
        }
        if (jobId && action === 'trigger') {
          return json({ ok: true, message: 'Trigger not yet wired to daemon' })
        }

        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const id = randomUUID().split('-')[0]
        const schedule = typeof body.schedule === 'string' ? body.schedule : '0 9 * * *'
        const prompt = typeof body.prompt === 'string' ? body.prompt : ''
        const name = typeof body.name === 'string' ? body.name : ''
        const deliver = Array.isArray(body.deliver) ? body.deliver as string[] : []
        const recurring = body.repeat === undefined
        writeJob(id, name, prompt, schedule, deliver, recurring)
        return json({ job: parseJob(`${id}.md`) }, { status: 201 })
      },
      PATCH: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, { status: 401 })
        const url = new URL(request.url)
        const pathParts = url.pathname.split('/').filter(Boolean)
        const jobId = pathParts[pathParts.length - 1]
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const fullPath = path.join(JOBS_DIR, `${jobId}.md`)
        if (!fs.existsSync(fullPath)) return json({ error: 'Not found' }, { status: 404 })
        const existing = parseJob(`${jobId}.md`) as Record<string, unknown>
        const schedule = typeof body.schedule === 'string' ? body.schedule : String((existing.schedule as Record<string, unknown>)?.cron || '')
        const prompt = typeof body.prompt === 'string' ? body.prompt : String(existing.prompt || '')
        const name = typeof body.name === 'string' ? body.name : String(existing.name || '')
        const deliver = Array.isArray(body.deliver) ? body.deliver as string[] : existing.deliver as string[]
        const recurring = typeof body.recurring === 'boolean' ? body.recurring : Boolean(existing.recurring)
        writeJob(jobId, name, prompt, schedule, deliver, recurring)
        if (typeof body.enabled === 'boolean') toggleJob(jobId, body.enabled)
        return json({ job: parseJob(`${jobId}.md`) })
      },
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, { status: 401 })
        const url = new URL(request.url)
        const pathParts = url.pathname.split('/').filter(Boolean)
        const jobId = pathParts[pathParts.length - 1]
        const fullPath = path.join(JOBS_DIR, `${jobId}.md`)
        if (!fs.existsSync(fullPath)) return json({ error: 'Not found' }, { status: 404 })
        fs.unlinkSync(fullPath)
        return json({ ok: true })
      },
    },
  },
})
