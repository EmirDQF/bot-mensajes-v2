import React, { useState } from 'react'

export default function Login({ onLogin }){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function submit(e){
    e.preventDefault()
    if(!username || !password) return alert('Provide username and password')
    onLogin({ username, password })
  }

  return (
    <div style={{display:'flex',height:'100vh',alignItems:'center',justifyContent:'center'}}>
      <form onSubmit={submit} style={{width:320,padding:20,border:'1px solid #eee',borderRadius:8}}>
        <h3 style={{marginTop:0}}>Login to Monitor Panel</h3>
        <label style={{display:'block',marginBottom:8}}>Username</label>
        <input value={username} onChange={e=>setUsername(e.target.value)} style={{width:'100%',padding:8,marginBottom:12}} />
        <label style={{display:'block',marginBottom:8}}>Password</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} style={{width:'100%',padding:8,marginBottom:12}} />
        <button style={{width:'100%',padding:8}}>Login</button>
      </form>
    </div>
  )
}
