import React from 'react'

function Statistics({ sentCount, recvCount, lastRTT, stats }) {
  const formatRTT = (value) => {
    if (!isFinite(value)) return '-'
    return (Math.round(value * 1000) / 1000).toFixed(3)
  }

  const avgRTT = recvCount > 0 ? stats.sum / recvCount : 0

  return (
    <div className="statistics">
      <h2>統計情報</h2>
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-label">送信数:</span>
          <span className="stat-value">{sentCount}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">受信数:</span>
          <span className="stat-value">{recvCount}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">最終RTT (ms):</span>
          <span className="stat-value">{formatRTT(lastRTT)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">最小RTT (ms):</span>
          <span className="stat-value">{formatRTT(stats.min)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">最大RTT (ms):</span>
          <span className="stat-value">{formatRTT(stats.max)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">平均RTT (ms):</span>
          <span className="stat-value">{formatRTT(avgRTT)}</span>
        </div>
      </div>
    </div>
  )
}

export default Statistics
