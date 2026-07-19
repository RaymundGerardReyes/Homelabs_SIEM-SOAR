// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocketStream } from '../../shared/hooks';
import { Badge } from '../../shared/ui';
import { tokenService } from '../../shared/auth/tokenService';

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
}

export default function WarRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const { isConnected } = useWebSocketStream<ChatMessage>(`/ws/incidents/war-room/${id}`, (msg) => {
    setMessages(prev => [...prev, msg]);
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'You', text: draft, timestamp: new Date().toISOString() }]);
    setDraft('');
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 ml-64 pt-16">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
        <div className="flex items-center">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white mr-4">&larr; Back</button>
          <div>
            <h1 className="text-lg font-bold text-white">War Room: {id}</h1>
            <p className="text-xs text-slate-500">Live multi-analyst collaboration</p>
          </div>
        </div>
        <Badge severity={isConnected ? 'S4' : 'S1'}>{isConnected ? 'LIVE' : 'DISCONNECTED'}</Badge>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0d1117]">
        {messages.length === 0 && <div className="text-center text-slate-500 mt-10">Welcome to the War Room. Communications are encrypted.</div>}
        {messages.map(msg => (
          <div key={msg.id} className={`flex flex-col ${msg.sender === 'You' ? 'items-end' : 'items-start'}`}>
            <span className="text-xs text-slate-500 mb-1">{msg.sender} • {new Date(msg.timestamp).toLocaleTimeString()}</span>
            <div className={`px-4 py-2 rounded-lg max-w-xl ${msg.sender === 'You' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200 border border-slate-700'}`}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="p-4 bg-slate-900 border-t border-slate-800">
        <form onSubmit={sendMessage} className="flex space-x-2">
          <input 
            type="text" 
            className="flex-1 bg-slate-800 border border-slate-700 rounded px-4 py-2 text-white focus:outline-none focus:border-blue-500" 
            placeholder="Type a message..."
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <button type="submit" disabled={!isConnected} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded font-bold disabled:opacity-50 transition-colors">Send</button>
        </form>
      </div>
    </div>
  );
}
