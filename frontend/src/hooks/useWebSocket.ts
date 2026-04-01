import { useEffect, useRef, useState, useCallback } from 'react'

export interface WsStats {
  downloadBps: number
  uploadBps: number
  downloadStreams: number
  uploadStreams: number
  uptimeSeconds: number
  running: boolean
  sessionDownloadBytes: number
  sessionUploadBytes: number
  healthyServers: number
  totalServers: number
}

const EMPTY: WsStats = {
  downloadBps: 0,
  uploadBps: 0,
  downloadStreams: 0,
  uploadStreams: 0,
  uptimeSeconds: 0,
  running: false,
  sessionDownloadBytes: 0,
  sessionUploadBytes: 0,
  healthyServers: 0,
  totalServers: 0,
}

export function useWebSocket() {
  const [stats, setStats] = useState<WsStats>(EMPTY)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsStats
        setStats(data)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws.close()
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { stats, connected }
}
