import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rafd-backup-token, x-rafd-sha256, x-rafd-schema-version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
}
const bucket = 'rafd-backups'
const idPattern = /^[A-Za-z0-9_-]+$/

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

function response(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers }
  })
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return hex(await crypto.subtle.digest('SHA-256', input))
}

function safeId(value: string | undefined): boolean {
  return Boolean(value && value.length <= 160 && idPattern.test(value))
}

async function authenticate(request: Request, storeId: string): Promise<boolean> {
  const token = request.headers.get('x-rafd-backup-token') ?? ''
  if (!safeId(storeId) || token.length < 16) return false
  const tokenHash = await sha256(token)
  const { data, error } = await supabase
    .from('rafd_backup_clients')
    .select('store_id')
    .eq('store_id', storeId)
    .eq('token_hash', tokenHash)
    .eq('active', true)
    .maybeSingle()
  return !error && Boolean(data)
}

function routeParts(request: Request): string[] {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  const index = parts.lastIndexOf('backup-api')
  return index >= 0 ? parts.slice(index + 1) : parts
}

function objectPath(storeId: string, backupId: string): string {
  if (!safeId(storeId) || !safeId(backupId)) throw new Error('invalid backup path')
  return `${storeId}/${backupId}.rafd.enc`
}

async function listBackups(storeId: string) {
  const { data, error } = await supabase.storage.from(bucket).list(storeId, {
    limit: 100,
    offset: 0,
    sortBy: { column: 'created_at', order: 'desc' }
  })
  if (error) throw error
  return data ?? []
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const parts = routeParts(request)
    const storeId = parts[0]
    const backupId = parts[1]
    if (!storeId || !(await authenticate(request, storeId))) return response({ error: 'unauthorized' }, 401)

    if (request.method === 'GET' && !backupId) {
      return response({ items: await listBackups(storeId) })
    }
    if (!backupId || !safeId(backupId)) return response({ error: 'invalid_backup_id' }, 400)
    const path = objectPath(storeId, backupId)

    if (request.method === 'GET') {
      const { data, error } = await supabase.storage.from(bucket).download(path)
      if (error || !data) return response({ error: 'backup_not_found' }, 404)
      return new Response(data, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }
      })
    }

    if (request.method === 'POST') {
      const body = await request.arrayBuffer()
      if (body.byteLength === 0 || body.byteLength > 512 * 1024 * 1024) {
        return response({ error: 'invalid_backup_size' }, 400)
      }
      const expectedHash = request.headers.get('x-rafd-sha256') ?? ''
      const actualHash = await sha256(body)
      if (!/^[a-f0-9]{64}$/.test(expectedHash) || expectedHash !== actualHash) {
        return response({ error: 'checksum_mismatch' }, 400)
      }
      const { error } = await supabase.storage.from(bucket).upload(path, body, {
        contentType: 'application/octet-stream',
        upsert: true,
        cacheControl: '0'
      })
      if (error) return response({ error: 'storage_upload_failed', detail: error.message }, 502)
      return response({ ok: true, store_id: storeId, backup_id: backupId, sha256: actualHash })
    }

    if (request.method === 'DELETE') {
      const { error } = await supabase.storage.from(bucket).remove([path])
      if (error) return response({ error: 'storage_delete_failed', detail: error.message }, 502)
      return response({ ok: true })
    }

    return response({ error: 'method_not_allowed' }, 405)
  } catch (error) {
    console.error(error)
    return response({ error: 'internal_error' }, 500)
  }
})
