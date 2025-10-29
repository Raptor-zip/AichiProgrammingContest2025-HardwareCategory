import React, { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import ConnectionStatus from './components/ConnectionStatus'
import ControlPanel from './components/ControlPanel'
import Statistics from './components/Statistics'
import LogTable from './components/LogTable'
import { useWebSocket } from './hooks/useWebSocket'

function App() {
  const [interval, setInterval] = useState(1000)
  const [logs, setLogs] = useState([])
  const {
    wsStatus,
    stats,
    sentCount,
    recvCount,
    isRunning,
    startPing,
    stopPing,
    lastRTT
  } = useWebSocket(interval, (logEntry) => {
    setLogs(prev => [logEntry, ...prev.slice(0, 199)])
  })

  return (
    <div className="app">
      <header>
        <h1>ESP32 WebSocket Ping測定</h1>
      </header>

      <main>
        <ConnectionStatus status={wsStatus} />

        <ControlPanel
          interval={interval}
          onIntervalChange={setInterval}
          onStart={startPing}
          onStop={stopPing}
          isRunning={isRunning}
          canStart={wsStatus === 'open'}
        />

        <Statistics
          sentCount={sentCount}
          recvCount={recvCount}
          lastRTT={lastRTT}
          stats={stats}
        />

        <LogTable logs={logs} />
      </main>
    </div>
  )
}

export default App
