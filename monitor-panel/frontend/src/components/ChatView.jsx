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
        {messages.map(m => (
          <div key={m.id} className={`message-bubble ${m.sender === 'bot'? 'bot': 'user'}`}>
            {m.type === 'text' && <div className="message-text">{m.content}</div>}
            {m.type === 'image' && (
              <img src={m.media_url} alt="img" className="thumb" onClick={() => setLightbox(m.media_url)} />
            )}
            <div className="message-time">{new Date(m.created_at).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {lightbox && (
        <div className="lightbox" onClick={()=>setLightbox(null)}>
          <img src={lightbox} alt="full" />
        </div>
      )}
    </div>
  )
}
