import React from 'react'

function LogTable({ logs }) {
  const formatTime = (timestamp) => {
    if (typeof timestamp === 'number') {
      return timestamp.toFixed(3)
    }
    return timestamp
  }

  const formatRTT = (rtt) => {
    return rtt.toFixed(3)
  }

  return (
    <div className="log-table-container">
      <h2>通信ログ (最新200件)</h2>
      <div className="table-wrapper">
        <table className="log-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>送信時刻</th>
              <th>受信時刻</th>
              <th>RTT (ms)</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, index) => (
              <tr key={`${log.id}-${index}`}>
                <td>{log.id}</td>
                <td>{formatTime(log.sentTime)}</td>
                <td>{formatTime(log.recvTime)}</td>
                <td>{formatRTT(log.rtt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default LogTable
