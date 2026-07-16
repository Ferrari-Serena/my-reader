/**
 * my-reader Edge TTS Worker
 * Proxies Cloudflare Workers AI TTS (Deepgram Aura) for natural-sounding speech.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // TTS endpoint
    if (url.pathname === '/api/tts' && request.method === 'POST') {
      try {
        const body = await request.json()
        const text = (body.text || '').trim()
        const voice = body.voice || 'asteria' // deepgram aura voice

        if (!text) {
          return new Response(JSON.stringify({ error: 'text is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          })
        }

        // Split long text into chunks (Workers AI has limits)
        const chunks = splitText(text, 1500)

        if (chunks.length === 1) {
          // Single chunk — direct response
          const audio = await env.AI.run('@cf/deepgram/aura-2-en', {
            text: chunks[0],
            voice: voice
          })

          return new Response(audio, {
            headers: {
              'Content-Type': 'audio/mpeg',
              'X-Chunks': '1',
              ...corsHeaders
            }
          })
        }

        // Multiple chunks — concatenate
        const allAudio = []
        for (let i = 0; i < chunks.length; i++) {
          const audio = await env.AI.run('@cf/deepgram/aura-2-en', {
            text: chunks[i],
            voice: voice
          })
          allAudio.push(new Uint8Array(audio))
        }

        // Concatenate all chunks
        const totalLength = allAudio.reduce((sum, a) => sum + a.length, 0)
        const merged = new Uint8Array(totalLength)
        let offset = 0
        for (const a of allAudio) {
          merged.set(a, offset)
          offset += a.length
        }

        return new Response(merged, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'X-Chunks': String(chunks.length),
            ...corsHeaders
          }
        })

      } catch (err) {
        console.error('TTS error:', err)
        return new Response(JSON.stringify({ error: 'TTS failed', detail: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders })
  }
}

/**
 * Split text into chunks at sentence boundaries, each under maxLen characters.
 */
function splitText(text, maxLen) {
  if (text.length <= maxLen) return [text]

  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text]
  const chunks = []
  let current = ''

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue

    if ((current + ' ' + trimmed).length <= maxLen) {
      current = current ? current + ' ' + trimmed : trimmed
    } else {
      if (current) chunks.push(current)
      // If a single sentence is too long, split it at word boundaries
      if (trimmed.length > maxLen) {
        const words = trimmed.split(/\s+/)
        let subChunk = ''
        for (const word of words) {
          const candidate = subChunk ? subChunk + ' ' + word : word
          if (candidate.length > maxLen && subChunk.length > 0) {
            chunks.push(subChunk)
            subChunk = word
          } else {
            subChunk = candidate
          }
        }
        if (subChunk) current = subChunk
        else current = ''
      } else {
        current = trimmed
      }
    }
  }
  if (current) chunks.push(current)
  return chunks.length > 0 ? chunks : [text]
}
