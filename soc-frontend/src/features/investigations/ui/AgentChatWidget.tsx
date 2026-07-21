import React, { useState, useRef, useEffect } from 'react';

export default function AgentChatWidget({ defaultOpen = false, defaultInput = '' }: { defaultOpen?: boolean, defaultInput?: string }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [input, setInput] = useState(defaultInput);
  const [messages, setMessages] = useState<{role: 'user' | 'agent', text: string, provider?: string}[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && !wsRef.current) {
       const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
       // Vite proxy handles /api to backend 8000
       const wsUrl = `${protocol}//${window.location.host}/api/ws/agent/chat`;
       
       const ws = new WebSocket(wsUrl);
       ws.onopen = () => console.log('Chat WS connected');
       ws.onmessage = (e) => {
         const data = JSON.parse(e.data);
         if (data.error) {
            setMessages(prev => [...prev, {role: 'agent', text: `Error: ${data.error}`}]);
            setIsTyping(false);
            return;
         }
         
         setMessages(prev => {
            const newMsgs = [...prev];
            if (newMsgs.length === 0 || newMsgs[newMsgs.length - 1].role === 'user') {
                newMsgs.push({ role: 'agent', text: data.chunk, provider: data.provider });
            } else {
                newMsgs[newMsgs.length - 1].text += data.chunk;
                newMsgs[newMsgs.length - 1].provider = data.provider || newMsgs[newMsgs.length - 1].provider;
            }
            return newMsgs;
         });
         if (data.done) setIsTyping(false);
       };
       ws.onclose = () => { wsRef.current = null; };
       wsRef.current = ws;
    }
    return () => {
      if (!isOpen && wsRef.current) {
         wsRef.current.close();
         wsRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !wsRef.current) return;
    setMessages(prev => [...prev, {role: 'user', text: input}]);
    wsRef.current.send(input);
    setInput('');
    setIsTyping(true);
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-[0_0_20px_rgba(79,70,229,0.5)] flex items-center justify-center transition-transform hover:scale-110 z-50"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden">
       <div className="bg-slate-950 p-4 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h3 className="text-white font-bold text-sm flex items-center">
               <svg className="w-4 h-4 mr-2 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
               AI Assistant
            </h3>
            <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Read-only Context • Cannot Isolate Hosts</p>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white">
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
       </div>

       <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
             <div className="text-center text-slate-500 text-xs mt-10">
                Ask me to summarize alerts, explain risks, or correlate events.
             </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
               <div className={`max-w-[80%] rounded-lg p-3 text-sm ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200 border border-slate-700'}`}>
                  {m.text}
               </div>
               {m.role === 'agent' && m.provider && (
                 <div className="text-[9px] text-slate-500 mt-1 ml-1">Generated via {m.provider}</div>
               )}
            </div>
          ))}
          {isTyping && (
             <div className="flex space-x-1 text-indigo-400 items-center p-2">
               <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{animationDelay: '0s'}}></span>
               <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
               <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></span>
             </div>
          )}
          <div ref={endRef} />
       </div>

       <form onSubmit={handleSubmit} className="p-3 border-t border-slate-800 bg-slate-950 flex">
          <input 
            type="text" value={input} onChange={e => setInput(e.target.value)}
            placeholder="Ask the AI..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-l px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 px-4 rounded-r text-white transition-colors">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
          </button>
       </form>
    </div>
  );
}
