import React from 'react'

function ConnectionStatus({ status }) {
  const getStatusClass = () => {
    switch (status) {
      case 'open': return 'status-open'
      case 'connecting': return 'status-connecting'
      case 'closed': return 'status-closed'
      case 'error': return 'status-error'
      default: return ''
    }
  }

  return (
    <div className="connection-status">
      <h2>接続状態</h2>
      <div className={`status-indicator ${getStatusClass()}`}>
        {status}
      </div>
    </div>
  )
}

export default ConnectionStatus
