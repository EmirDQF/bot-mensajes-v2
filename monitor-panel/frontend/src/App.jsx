import React, { useEffect, useState, useRef } from 'react'
import axios from 'axios'
import { io } from 'socket.io-client'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import Login from './components/Login'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function getConversationId(conv){
  return conv?.conversation_id ?? conv?.id ?? null
}

export default function App(){
  const [conversations, setConversations] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [auth, setAuth] = useState(null) // { username, password }
  const socketRef = useRef(null)

  useEffect(()=>{
    if (!conversations.length) return
    const firstId = getConversationId(conversations[0])
    if (!selected || !conversations.some(c => getConversationId(c) === selected)) {
      setSelected(firstId)
    }
  }, [conversations, selected])

  useEffect(()=>{
    if(!auth) return // don't connect until authenticated

    // set axios auth header for REST calls
    const token = btoa(`${auth.username}:${auth.password}`)
    axios.defaults.headers.common['Authorization'] = `Basic ${token}`

    // load conversations
    fetchConversations()

    // connect socket with auth
    const socket = io(API_URL, { auth: { username: auth.username, password: auth.password } })
    socketRef.current = socket
    socket.on('connect', () => console.log('socket connected'))
    socket.on('connect_error', (err) => {
      console.error('socket connect_error', err)
      if(err && err.message === 'Unauthorized'){
        alert('Socket auth failed: invalid credentials')
      }
    })

    const handleIncomingMessage = (msg) => {
      const conversationId = getConversationId({ conversation_id: msg.conversation_id, id: msg.conversation_id }) || msg.conversation_id
      setConversations(prev => {
        const found = prev.find(c => getConversationId(c) === conversationId)
        const preview = msg.type === 'image' ? '📷 Image' : (msg.content || '')
        if(found){
          return [{...found, last_message_at: msg.created_at || msg.timestamp, preview}, ...prev.filter(c => getConversationId(c) !== conversationId)]
        }
        const conv = { id: conversationId, conversation_id: conversationId, contact_number: conversationId, contact_name: msg.contact_name || conversationId, last_message_at: msg.created_at || msg.timestamp, preview }
        return [conv, ...prev]
      })

      if (conversationId === selected) {
        setMessages(prev => {
          const exists = prev.some(item => item.id === msg.id || (item.created_at === (msg.created_at || msg.timestamp) && item.content === msg.content && item.sender === msg.sender))
          return exists ? prev : [...prev, msg]
        })
      }
    }

    socket.on('message', handleIncomingMessage)
    socket.on('new_message', handleIncomingMessage)

    socket.on('conversation:update', (data) => {
      setConversations(prev => {
        const idx = prev.findIndex(p=>p.id===data.conversation_id)
        if(idx>=0){
          const updated = {...prev[idx], last_message_at: data.last_message_at, preview: data.preview}
          return [updated, ...prev.filter((c,i)=>i!==idx)]
        }
        return prev
      })
    })

    return ()=>{ socket.disconnect(); delete axios.defaults.headers.common['Authorization'] }
  }, [auth, selected])

  async function fetchConversations(){
    try{
      const res = await axios.get(`${API_URL}/api/conversations`)
      setConversations(res.data)
      const firstId = res.data.length ? getConversationId(res.data[0]) : null
      if (firstId && (!selected || !res.data.some(c => getConversationId(c) === selected))) {
        setSelected(firstId)
      }
    }catch(e){
      console.error('fetchConversations error', e)
      if(e.response && e.response.status === 401){
        alert('Unauthorized. Please login again.')
        setAuth(null)
      }
    }
  }

  async function openConversation(id){
    setSelected(id)
    try{
      const res = await axios.get(`${API_URL}/api/conversations/${encodeURIComponent(id)}/messages`)
      setMessages(res.data)
      // join room (optional)
      if(socketRef.current) socketRef.current.emit('join:conversation', id)
    }catch(e){
      console.error('openConversation error', e)
      if(e.response && e.response.status === 401){
        alert('Unauthorized. Please login again.')
        setAuth(null)
      }
    }
  }

  if(!auth) return <Login onLogin={setAuth} />

  return (
    <div className="app">
      <Sidebar conversations={conversations} onSelect={openConversation} selected={selected} />
      <ChatView messages={messages} selectedConversation={selected} />
    </div>
  )
}
