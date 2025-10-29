import React from 'react'

function ControlPanel({ interval, onIntervalChange, onStart, onStop, isRunning, canStart }) {
  return (
    <div className="control-panel">
      <h2>制御パネル</h2>
      <div className="controls">
        <label>
          送信間隔 (ms):
          <input
            type="number"
            value={interval}
            onChange={(e) => onIntervalChange(Number(e.target.value))}
            min="100"
            step="100"
            disabled={isRunning}
          />
        </label>

        <div className="button-group">
          <button
            onClick={onStart}
            disabled={!canStart || isRunning}
            className="btn-start"
          >
            開始
          </button>
          <button
            onClick={onStop}
            disabled={!isRunning}
            className="btn-stop"
          >
            停止
          </button>
        </div>
      </div>
    </div>
  )
}

export default ControlPanel
