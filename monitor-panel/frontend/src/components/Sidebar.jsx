import React from 'react'

function getConversationId(conv){
  return conv?.conversation_id ?? conv?.id ?? null
}

export default function Sidebar({ conversations = [], onSelect, selected }){
  return (
    <div className="sidebar">
      <div className="sidebar-header">Conversations</div>
      <div className="conversation-list">
        {conversations.map(conv => {
          const id = getConversationId(conv)
          return (
            <div key={id ?? `${conv.contact_number}-${conv.last_message_at}`} className={`conversation-item ${selected===id? 'selected':''}`} onClick={()=>id && onSelect(id)}>
              <div className="conv-title">{conv.contact_name || conv.contact_number}</div>
              <div className="conv-preview">{conv.preview || ''}</div>
              <div className="conv-time">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleString() : ''}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
