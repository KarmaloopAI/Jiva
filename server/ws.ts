import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { Server } from 'http'

let wss: WebSocketServer | null = null
const clients = new Set<WebSocket>()

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))
  })
}

export function broadcast(type: string, payload: unknown) {
  if (!wss) return
  const msg = JSON.stringify({ type, ...( payload !== null && typeof payload === 'object' ? payload : { data: payload }) })
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg)
    }
  }
}
