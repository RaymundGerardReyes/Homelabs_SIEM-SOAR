import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocketStream } from '../../shared/hooks';
import { Badge } from '../../shared/ui';

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  isDecision?: boolean;
}

export default function WarRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', sender: 'System', text: 'War Room initialized. Incident Commander not yet assigned.', timestamp: new Date(Date.now() - 3600000).toISOString() },
    { id: '2', sender: 'Alice (IC)', text: 'I am taking Incident Commander. Let\'s isolate the host.', timestamp: new Date(Date.now() - 3500000).toISOString(), isDecision: true }
  ]);
  const [draft, setDraft] = useState('');
  const [isDecisionToggle, setIsDecisionToggle] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const [bridgeLink, setBridgeLink] = useState('https://zoom.us/j/123456789 (Draft)');
  const [isEditingBridge, setIsEditingBridge] = useState(false);

  const [roles] = useState({ commander: 'Alice', techLead: 'Bob', commsLead: 'Unassigned' });
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [showPostMortemModal, setShowPostMortemModal] = useState(false);

  const { isConnected } = useWebSocketStream<ChatMessage>(`/ws/incidents/war-room/${id}`, (msg) => {
    setMessages(prev => [...prev, msg]);
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'You', text: draft, timestamp: new Date().toISOString(), isDecision: isDecisionToggle }]);
    setDraft('');
    setIsDecisionToggle(false);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 pt-16 overflow-hidden">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center space-y-3 md:space-y-0">
        <div className="flex items-center">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white mr-4 flex items-center justify-center w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 transition-colors">&larr;</button>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-xl font-bold text-white tracking-tight">Crisis War Room: {id}</h1>
              <Badge severity={isConnected ? 'S4' : 'S1'}>{isConnected ? 'LIVE' : 'DISCONNECTED'}</Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Coordination, Decisions, and Response</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
           <button onClick={() => setShowBroadcastModal(true)} className="px-3 py-1.5 bg-blue-900/30 text-blue-400 border border-blue-500/30 hover:bg-blue-900/50 rounded text-xs transition-colors">
             Broadcast Status
           </button>
           <button onClick={() => setShowPostMortemModal(true)} className="px-3 py-1.5 bg-emerald-900/30 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-900/50 rounded text-xs transition-colors">
             Resolve & Draft Post-Mortem
           </button>
        </div>
      </header>

      {/* Cross-Environment Pivot Alert (Section 5 CDM Correlation) */}
      <div className="bg-red-950/80 border-b border-red-900 p-3 flex items-center justify-center">
         <div className="flex items-center space-x-3 text-red-200 text-sm">
            <span className="animate-pulse text-red-500 font-bold">🚨 CRITICAL PIVOT DETECTED:</span>
            <span>Edge (PaaS app)</span>
            <svg className="w-4 h-4 text-red-500 mx-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
            <span>Internal Tunnel (Local server)</span>
            <span className="ml-4 px-2 py-0.5 bg-red-900/50 rounded border border-red-700 text-xs font-mono">CF-Ray: 7d8f9a1b2c3d4e5f</span>
         </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Info */}
        <div className="w-64 bg-slate-900 border-r border-slate-800 p-4 flex flex-col overflow-y-auto hidden md:flex shrink-0">
           <div className="mb-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Bridge Integration</h3>
              {isEditingBridge ? (
                <div className="flex flex-col space-y-2">
                  <input type="text" value={bridgeLink} onChange={e => setBridgeLink(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white text-xs p-1.5 rounded" />
                  <button onClick={() => setIsEditingBridge(false)} className="px-2 py-1 bg-slate-800 text-white text-xs rounded hover:bg-slate-700">Save</button>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-slate-950 border border-slate-800 p-2 rounded">
                  <a href={bridgeLink} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-xs truncate mr-2">{bridgeLink || 'No link set'}</a>
                  <button onClick={() => setIsEditingBridge(true)} className="text-slate-500 hover:text-white text-xs">✏️</button>
                </div>
              )}
           </div>

           <div className="mb-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Role Assignments</h3>
              <div className="space-y-2">
                 <div className="flex justify-between items-center bg-slate-950 border border-slate-800 p-2 rounded text-xs">
                    <span className="text-slate-400">Commander</span>
                    <span className={`font-medium ${roles.commander !== 'Unassigned' ? 'text-white' : 'text-slate-600'}`}>{roles.commander}</span>
                 </div>
                 <div className="flex justify-between items-center bg-slate-950 border border-slate-800 p-2 rounded text-xs">
                    <span className="text-slate-400">Tech Lead</span>
                    <span className={`font-medium ${roles.techLead !== 'Unassigned' ? 'text-white' : 'text-slate-600'}`}>{roles.techLead}</span>
                 </div>
                 <div className="flex justify-between items-center bg-slate-950 border border-slate-800 p-2 rounded text-xs">
                    <span className="text-slate-400">Comms Lead</span>
                    <span className={`font-medium ${roles.commsLead !== 'Unassigned' ? 'text-white' : 'text-slate-600'}`}>{roles.commsLead}</span>
                 </div>
              </div>
           </div>
           
           <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Decisions Log</h3>
              <div className="space-y-3">
                 {messages.filter(m => m.isDecision).map(m => (
                    <div key={m.id} className="bg-yellow-900/10 border-l-2 border-yellow-500 p-2 text-xs">
                       <span className="text-yellow-500 font-bold block mb-0.5">{m.sender}</span>
                       <span className="text-slate-300">{m.text}</span>
                    </div>
                 ))}
                 {messages.filter(m => m.isDecision).length === 0 && <span className="text-xs text-slate-600">No decisions logged yet.</span>}
              </div>
           </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col bg-[#0d1117]">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && <div className="text-center text-slate-500 mt-10">Welcome to the War Room. Communications are encrypted.</div>}
            {messages.map(msg => (
              <div key={msg.id} className={`flex flex-col ${msg.sender === 'You' ? 'items-end' : 'items-start'}`}>
                <span className="text-xs text-slate-500 mb-1 font-mono">{msg.sender} • {new Date(msg.timestamp).toLocaleTimeString()}</span>
                <div className={`px-4 py-2 rounded-lg max-w-2xl ${msg.isDecision ? 'bg-yellow-900/20 border border-yellow-500/50 text-yellow-100 shadow-[0_0_10px_rgba(234,179,8,0.1)]' : msg.sender === 'You' ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-800 text-slate-200 border border-slate-700'}`}>
                  {msg.isDecision && <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1 flex items-center">⚡ Decision Made</span>}
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="p-4 bg-slate-900 border-t border-slate-800">
            <form onSubmit={sendMessage} className="flex items-center space-x-3">
              <label className="flex items-center cursor-pointer text-xs text-slate-400 hover:text-yellow-500 transition-colors" title="Mark as Decision">
                 <input type="checkbox" checked={isDecisionToggle} onChange={e => setIsDecisionToggle(e.target.checked)} className="hidden" />
                 <div className={`w-6 h-6 rounded flex items-center justify-center border ${isDecisionToggle ? 'bg-yellow-500/20 border-yellow-500 text-yellow-500' : 'bg-slate-800 border-slate-700 text-slate-600'}`}>
                    ⚡
                 </div>
              </label>
              <input 
                type="text" 
                className={`flex-1 bg-slate-950 border ${isDecisionToggle ? 'border-yellow-500/50 focus:border-yellow-500' : 'border-slate-700 focus:border-blue-500'} rounded-lg px-4 py-3 text-white focus:outline-none transition-colors`}
                placeholder={isDecisionToggle ? "Log a formal decision..." : "Type a message..."}
                value={draft}
                onChange={e => setDraft(e.target.value)}
              />
              <button type="submit" disabled={!draft.trim() || !isConnected} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-bold disabled:opacity-50 transition-colors shadow-lg">
                Send
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Broadcast Status Modal */}
      {showBroadcastModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-lg w-full shadow-2xl">
             <h2 className="text-xl font-bold text-white mb-2">Broadcast Status Update</h2>
             <p className="text-slate-400 text-sm mb-4">Send a non-technical summary to stakeholder channels (Slack/Email).</p>
             <div className="space-y-4 mb-6">
                <div>
                   <label className="block text-xs text-slate-500 mb-1 uppercase tracking-wider font-bold">Audience</label>
                   <select className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded text-sm">
                     <option>Exec Team (#incident-execs)</option>
                     <option>All Engineering (#eng-general)</option>
                   </select>
                </div>
                <div>
                   <label className="block text-xs text-slate-500 mb-1 uppercase tracking-wider font-bold">Message Preview</label>
                   <textarea 
                     className="w-full h-32 bg-slate-950 border border-slate-700 text-white p-3 rounded text-sm focus:outline-none focus:border-blue-500" 
                     defaultValue={`[INCIDENT UPDATE] We are actively investigating an issue involving unusual endpoint activity. Containment steps are underway. No customer data impact detected at this time. Next update in 30 mins.`}
                   />
                </div>
             </div>
             <div className="flex justify-end space-x-3">
                <button onClick={() => setShowBroadcastModal(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">Cancel</button>
                <button onClick={() => setShowBroadcastModal(false)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors shadow-[0_0_15px_rgba(37,99,235,0.5)]">Broadcast Now</button>
             </div>
          </div>
        </div>
      )}

      {/* Post-Mortem Draft Modal */}
      {showPostMortemModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-emerald-500/50 rounded-lg p-6 max-w-3xl w-full shadow-[0_0_50px_rgba(16,185,129,0.1)]">
             <h2 className="text-2xl font-bold text-white mb-2 flex items-center">
               <span className="mr-2 text-emerald-500">✓</span> Incident Resolved
             </h2>
             <p className="text-slate-400 text-sm mb-6">The war room session has ended. A draft post-mortem has been auto-generated from the timeline.</p>
             
             <div className="bg-slate-950 border border-slate-800 p-6 rounded mb-6 h-96 overflow-y-auto font-mono text-sm text-slate-300">
                <h1 className="text-xl font-bold text-white mb-4">Draft Post-Mortem: {id}</h1>
                
                <h2 className="text-white font-bold mt-4 mb-2 border-b border-slate-800 pb-1">1. Summary</h2>
                <p className="mb-4">[Required: Describe the business impact and duration here...]</p>
                
                <h2 className="text-white font-bold mt-4 mb-2 border-b border-slate-800 pb-1">2. Responders</h2>
                <ul className="list-disc list-inside mb-4">
                  <li>{roles.commander} (Incident Commander)</li>
                  <li>{roles.techLead} (Tech Lead)</li>
                </ul>

                <h2 className="text-white font-bold mt-4 mb-2 border-b border-slate-800 pb-1">3. Key Decisions Timeline</h2>
                <ul className="space-y-2">
                   {messages.filter(m => m.isDecision).map((m, i) => (
                      <li key={i}><span className="text-slate-500">{new Date(m.timestamp).toISOString().split('T')[1].slice(0,8)}</span> - {m.text} ({m.sender})</li>
                   ))}
                   {messages.filter(m => m.isDecision).length === 0 && <li>No explicit decisions logged.</li>}
                </ul>
             </div>
             
             <div className="flex justify-end space-x-3">
                <button onClick={() => setShowPostMortemModal(false)} className="px-6 py-2 text-slate-400 hover:text-white">Close</button>
                <button onClick={() => { setShowPostMortemModal(false); navigate('/incidents/closed'); }} className="px-6 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-500 transition-colors shadow-lg">
                  Save & Exit to Closed Incidents
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
