import React, { useEffect, useRef, useState } from 'react'

export default function ChatView({ messages = [], selectedConversation }){
  const listRef = useRef(null)
  const [lightbox, setLightbox] = useState(null)

  useEffect(()=>{
    // scroll to bottom when messages change
    if(listRef.current){
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  if(!selectedConversation) return <div className="chat-empty">Select a conversation</div>

  return (
    <div className="chat">
      <div className="chat-header">Conversation: {selectedConversation}</div>
      <div className="chat-list" ref={listRef}>
        {messages.map(m => {
          const bubbleType = m.sender === 'bot' || m.sender === 'agent' ? 'bot' : 'user'
          const mediaUrl = m.media_url || m.image_url || null
          return (
            <div key={m.id || `${m.conversation_id}-${m.created_at}-${m.content || 'image'}`} className={`message-bubble ${bubbleType}`}>
              {m.type === 'text' && <div className="message-text">{m.content}</div>}
              {(m.type === 'image' || mediaUrl) && (
                <img src={mediaUrl} alt="img" className="thumb" onClick={() => setLightbox(mediaUrl)} />
              )}
              <div className="message-time">{new Date(m.created_at || m.timestamp).toLocaleString()}</div>
            </div>
          )
        })}
      </div>

      {lightbox && (
        <div className="lightbox" onClick={()=>setLightbox(null)}>
          <img src={lightbox} alt="full" />
        </div>
      )}
    </div>
  )
}
