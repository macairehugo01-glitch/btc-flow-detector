export async function sendTelegramMessage(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  console.log('[Telegram] token value:', token)
  console.log('[Telegram] chatId value:', chatId)

  if (!token || !chatId) {
    console.warn('[Telegram] not configured')
    return
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      }
    )
    const json = await res.json()
    console.log('[Telegram] response:', JSON.stringify(json))
  } catch (err) {
    console.error('[Telegram] error:', err)
  }
}
