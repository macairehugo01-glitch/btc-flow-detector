export async function sendTelegramMessage(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    console.warn('[Telegram] not configured')
    return
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const body = JSON.stringify({
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
  })

  // Retry 3 fois avec délai croissant
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      const json = await res.json()
      console.log(`[Telegram] attempt ${attempt} response:`, JSON.stringify(json))

      if (res.ok) return // succès, on sort

      console.warn(`[Telegram] attempt ${attempt} failed:`, json)
    } catch (err) {
      console.error(`[Telegram] attempt ${attempt} error:`, err)
    }

    // Attendre avant retry (500ms, 1s, 2s)
    await new Promise((r) => setTimeout(r, attempt * 500))
  }

  console.error('[Telegram] all attempts failed')
}
