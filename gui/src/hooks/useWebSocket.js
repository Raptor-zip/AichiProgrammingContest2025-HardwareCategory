import { useState, useEffect, useRef, useCallback } from 'react'

// 高精度タイムスタンプを返す
function nowMs() {
  if (window.performance && typeof performance.now === 'function' && typeof performance.timeOrigin === 'number') {
    return performance.timeOrigin + performance.now()
  }
  return Date.now()
}

export function useWebSocket(interval, onLogEntry) {
  const [wsStatus, setWsStatus] = useState('disconnected')
  const [sentCount, setSentCount] = useState(0)
  const [recvCount, setRecvCount] = useState(0)
  const [lastRTT, setLastRTT] = useState(0)
  const [stats, setStats] = useState({ min: Infinity, max: -Infinity, sum: 0 })
  const [isRunning, setIsRunning] = useState(false)

  const wsRef = useRef(null)
  const timerRef = useRef(null)
  const seqRef = useRef(0)

  // WebSocket接続
  useEffect(() => {
    const h = window.location.hostname || '192.168.4.1'
    const url = `ws://${h}:81/`

    setWsStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setWsStatus('open')
    }

    ws.onclose = () => {
      setWsStatus('closed')
      setIsRunning(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    ws.onerror = (e) => {
      console.error('WS error', e)
      setWsStatus('error')
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'ping') {
          const now = nowMs()
          const rtt = now - msg.t

          setRecvCount(prev => prev + 1)
          setLastRTT(rtt)

          setStats(prev => ({
            min: Math.min(prev.min, rtt),
            max: Math.max(prev.max, rtt),
            sum: prev.sum + rtt
          }))

          // ログエントリを親に渡す
          if (onLogEntry) {
            onLogEntry({
              id: msg.id,
              sentTime: msg.t,
              recvTime: now,
              rtt: rtt
            })
          }
        }
      } catch (e) {
        console.warn('Invalid JSON from server', e)
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      ws.close()
    }
  }, [onLogEntry])

  const startPing = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert('WebSocket not open')
      return
    }

    seqRef.current = 0
    setSentCount(0)
    setRecvCount(0)
    setStats({ min: Infinity, max: -Infinity, sum: 0 })
    setIsRunning(true)

    timerRef.current = setInterval(() => {
      seqRef.current++
      const payload = { type: 'ping', id: seqRef.current, t: nowMs() }
      wsRef.current.send(JSON.stringify(payload))
      setSentCount(prev => prev + 1)
    }, interval)
  }, [interval])

  const stopPing = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsRunning(false)
  }, [])

  return {
    wsStatus,
    stats,
    sentCount,
    recvCount,
    lastRTT,
    isRunning,
    startPing,
    stopPing
  }
}
