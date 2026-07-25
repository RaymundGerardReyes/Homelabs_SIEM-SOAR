import React, { useState, useRef, useEffect } from 'react';

export default function AgentChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'agent' | 'system', content: string }[]>([
    { role: 'system', content: 'Agent connected. Note: This channel is READ-ONLY. The agent cannot isolate hosts, disable rules, or execute playbooks.' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const connect = () => {
      const ws = new WebSocket('ws://localhost:8000/ws/agent/chat');
      
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === 'error') {
          setMessages(prev => [...prev, { role: 'system', content: `⚠ ${data.message}` }]);
          setIsTyping(false);
        } else if (data.type === 'typing') {
          setIsTyping(true);
          setMessages(prev => {
             if (prev[prev.length - 1]?.role === 'agent' && prev[prev.length - 1].content === '') return prev;
             return [...prev, { role: 'agent', content: '' }];
          });
        } else if (data.type === 'chunk') {
          setIsTyping(false);
          setMessages(prev => {
             const newMsgs = [...prev];
             const last = newMsgs[newMsgs.length - 1];
             if (last.role === 'agent') {
                 last.content += data.content;
             }
             return newMsgs;
          });
        } else if (data.type === 'done') {
          setIsTyping(false);
        }
      };

      wsRef.current = ws;
    };
    
    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [isOpen]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !wsRef.current) return;
    
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    wsRef.current.send(input);
    setInput('');
  };

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex flex-col items-end`}>
      {isOpen && (
        <div className="w-96 h-[500px] bg-slate-950 border border-slate-700 rounded-lg shadow-2xl shadow-indigo-900/20 flex flex-col mb-4 overflow-hidden">
          <div className="bg-indigo-950 border-b border-indigo-900 p-3 flex justify-between items-center">
            <div>
              <h3 className="text-indigo-400 font-bold flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
                AI Assistant
              </h3>
              <p className="text-[10px] text-indigo-300 uppercase mt-1">Read-Only Contextual Queries</p>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white">
              ✕
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[85%] rounded p-2 text-sm ${
                   m.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' :
                   m.role === 'system' ? 'bg-amber-900/30 text-amber-500 border border-amber-500/30 text-xs text-center w-full' :
                   'bg-slate-800 text-slate-300 rounded-bl-none'
                 }`}>
                   {m.content}
                 </div>
              </div>
            ))}
            {isTyping && (
               <div className="flex justify-start">
                 <div className="bg-slate-800 text-slate-400 rounded p-2 text-xs animate-pulse rounded-bl-none">
                   Thinking...
                 </div>
               </div>
            )}
            <div ref={endOfMessagesRef} />
          </div>
          
          <form onSubmit={handleSend} className="border-t border-slate-800 bg-slate-900 p-3">
            <div className="flex space-x-2">
              <input 
                type="text" 
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about an investigation..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white rounded px-4 py-2 text-sm transition-colors">
                Send
              </button>
            </div>
          </form>
        </div>
      )}
      
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)} 
          className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-full p-4 shadow-lg shadow-indigo-600/30 flex items-center justify-center transition-transform hover:scale-110"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
        </button>
      )}
    </div>
  );
}
