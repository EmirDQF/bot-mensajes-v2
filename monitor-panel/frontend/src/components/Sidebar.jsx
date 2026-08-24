import React from 'react'

export default function Sidebar({ conversations = [], onSelect, selected }){
  return (
    <div className="sidebar">
      <div className="sidebar-header">Conversations</div>
      <div className="conversation-list">
        {conversations.map(conv => (
          <div key={conv.id} className={`conversation-item ${selected===conv.id? 'selected':''}`} onClick={()=>onSelect(conv.id)}>
            <div className="conv-title">{conv.contact_name || conv.contact_number}</div>
            <div className="conv-preview">{conv.preview || ''}</div>
            <div className="conv-time">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleString() : ''}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
