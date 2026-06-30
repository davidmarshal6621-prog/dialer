import { useState, useEffect, useRef } from "react";

// ════════════════════════════════════════════════════════════
// BACKEND API URL — empty string = same origin (same server)
// ════════════════════════════════════════════════════════════
const API_URL = "";

// ════════════════════════════════════════════════════════════
// TWILIO SDK LOADER — loads from CDN dynamically
// ════════════════════════════════════════════════════════════
const loadTwilioSDK = () => new Promise((resolve, reject) => {
  if (window.Twilio) { resolve(window.Twilio); return; }
  const script = document.createElement("script");
  script.src = "https://sdk.twilio.com/js/client/releases/1.14.0/twilio.min.js";
  script.onload = () => resolve(window.Twilio);
  script.onerror = () => reject(new Error("Twilio SDK failed to load"));
  document.head.appendChild(script);
});

// ════════════════════════════════════════════════════════════
// SECURITY LAYER — sanitize all user inputs, no XSS, no eval
// ════════════════════════════════════════════════════════════
const sanitize = (str) => String(str || "").replace(/[<>"'`]/g, "").trim().slice(0, 200);
const sanitizePhone = (str) => String(str || "").replace(/[^+\d\s\-().]/g, "").slice(0, 20);
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isStrongPassword = (p) => p.length >= 8 && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
const hashPassword = (p) => btoa(encodeURIComponent(p + "_voicelink_salt_2024")); // demo only; use bcrypt server-side
const rateLimiter = (() => {
  const attempts = {};
  return (key, max = 5, windowMs = 60000) => {
    const now = Date.now();
    if (!attempts[key]) attempts[key] = [];
    attempts[key] = attempts[key].filter(t => now - t < windowMs);
    if (attempts[key].length >= max) return false;
    attempts[key].push(now);
    return true;
  };
})();

// ════════════════════════════════════════════════════════════
// ROLES & PERMISSIONS
// ════════════════════════════════════════════════════════════
const ROLES = {
  owner:  { label: "Owner",        color: "#f59e0b", perms: ["all"] },
  admin:  { label: "Admin",        color: "#6366f1", perms: ["manage_users","manage_plans","manage_settings","view_analytics","record_calls","manage_ivr"] },
  agent:  { label: "Agent",        color: "#22c55e", perms: ["make_calls","view_contacts","send_sms","stop_own_recording"] },
  viewer: { label: "Viewer",       color: "#64748b", perms: ["view_analytics","view_logs"] },
};
const can = (user, perm) => user && (ROLES[user.role]?.perms.includes("all") || ROLES[user.role]?.perms.includes(perm));

// ════════════════════════════════════════════════════════════
// MOCK DB (in-memory — replace with real DB on backend)
// ════════════════════════════════════════════════════════════
const INIT_USERS = [
  { id: 1, name: "Owais Malik",   email: "owner@demo.com",  password: hashPassword("Owner@123"),  role: "owner", status: "active",   plan: "enterprise", avatar: "O", googleLinked: false, createdAt: "2024-01-01" },
  { id: 2, name: "Admin User",    email: "admin@demo.com",  password: hashPassword("Admin@123"),  role: "admin", status: "active",   plan: "pro",        avatar: "A", googleLinked: true,  createdAt: "2024-02-10" },
  { id: 3, name: "Ali Agent",     email: "agent@demo.com",  password: hashPassword("Agent@123"),  role: "agent", status: "active",   plan: "starter",    avatar: "A", googleLinked: false, createdAt: "2024-03-05" },
  { id: 4, name: "Sara Viewer",   email: "viewer@demo.com", password: hashPassword("Viewer@1!"),  role: "viewer",status: "suspended",plan: "starter",    avatar: "S", googleLinked: false, createdAt: "2024-03-20" },
];

const MOCK_CONTACTS = [
  { id: 1, name: "Ahmed Khan",    number: "+923001234567", tag: "VIP" },
  { id: 2, name: "Sara Malik",    number: "+923121234567", tag: "Client" },
  { id: 3, name: "Bilal Raza",    number: "+923451234567", tag: "" },
  { id: 4, name: "Nadia Hussain", number: "+923331234567", tag: "Client" },
];
const MOCK_LOGS = [
  { id:1, name:"Ahmed Khan",  number:"+923001234567", type:"incoming", duration:"3:24", time:"Today, 10:15 AM", recorded:true },
  { id:2, name:"Sara Malik",  number:"+923121234567", type:"outgoing", duration:"1:07", time:"Today, 9:02 AM",  recorded:false },
  { id:3, name:"Unknown",     number:"+12025551234",  type:"missed",   duration:"—",    time:"Yesterday, 6:44 PM",recorded:false },
  { id:4, name:"Bilal Raza",  number:"+923451234567", type:"outgoing", duration:"8:51", time:"Yesterday, 3:30 PM",recorded:true },
];
const INIT_PLANS = [
  { id:"starter",    name:"Starter",    price:9,   priceLabel:"$9/mo",   features:["1 DID Number","500 mins/mo","SMS","Basic Analytics"], color:"#64748b" },
  { id:"pro",        name:"Pro",        price:29,  priceLabel:"$29/mo",  features:["5 DID Numbers","2000 mins/mo","SMS+MMS","Call Recording","Advanced Analytics","IVR/Auto-Attendant"], color:"#6366f1" },
  { id:"enterprise", name:"Enterprise", price:79,  priceLabel:"$79/mo",  features:["Unlimited Numbers","Unlimited mins","All features","IP Phone Support","AI Notifications","Priority Support"], color:"#f59e0b" },
];

// ════════════════════════════════════════════════════════════
// ICONS
// ════════════════════════════════════════════════════════════
const Ic = ({ d, size=18, fill="none", stroke="currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
);
const PhoneIc = ({size=18}) => <Ic size={size} fill="currentColor" stroke="none" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>;

// ════════════════════════════════════════════════════════════
// DIALPAD — tap any key, long-press 0 for "+"
// ════════════════════════════════════════════════════════════
function Dialpad({ onPress }) {
  const holdRef = useRef(null);
  const didHold = useRef(false);
  const keys = [
    ["1",""],["2","ABC"],["3","DEF"],
    ["4","GHI"],["5","JKL"],["6","MNO"],
    ["7","PQRS"],["8","TUV"],["9","WXYZ"],
    ["*",""],["0","+"],["#",""]
  ];

  const btnStyle = {
    background:"rgba(255,255,255,0.08)",
    border:"1px solid rgba(255,255,255,0.1)",
    borderRadius:12, padding:"14px 0",
    cursor:"pointer", color:"#fff",
    display:"flex", flexDirection:"column",
    alignItems:"center", gap:2,
    WebkitUserSelect:"none", userSelect:"none",
    touchAction:"manipulation",
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,padding:"0 4px"}}>
      {keys.map(([n,s])=>{
        const isZero = n === "0";
        const handleDown = () => {
          if(!isZero){ onPress(n); return; }
          didHold.current = false;
          holdRef.current = setTimeout(()=>{
            didHold.current = true;
            onPress("+");
          }, 650);
        };
        const handleUp = () => {
          if(!isZero) return;
          clearTimeout(holdRef.current);
          if(!didHold.current) onPress("0");
        };
        const handleLeave = () => clearTimeout(holdRef.current);
        return (
          <button key={n}
            onPointerDown={handleDown}
            onPointerUp={handleUp}
            onPointerLeave={handleLeave}
            onContextMenu={e=>e.preventDefault()}
            style={btnStyle}>
            <span style={{fontSize:21,fontWeight:500,fontFamily:"monospace",lineHeight:1}}>{n}</span>
            {isZero
              ? <span style={{fontSize:11,color:"#6366f1",fontWeight:700,lineHeight:1}}>+</span>
              : <span style={{fontSize:9,letterSpacing:"0.8px",color:"#555",lineHeight:1}}>{s||" "}</span>
            }
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ACTIVE CALL OVERLAY — Speaker + Network Quality indicator
// ════════════════════════════════════════════════════════════
function ActiveCall({ contact, onEnd, currentUser, callStatus="" }) {
  const [elapsed,setElapsed]   = useState(0);
  const [muted,setMuted]       = useState(false);
  const [speakerOn,setSpeaker] = useState(false);
  const [videoOn,setVideoOn]   = useState(false);
  const [recording,setRecording]= useState(can(currentUser,"record_calls"));
  const [held,setHeld]         = useState(false);
  const [netQuality,setNetQuality] = useState(4); // 1–4 bars (simulated)
  const timer = useRef(null);
  const netTimer = useRef(null);

  useEffect(()=>{
    timer.current = setInterval(()=>setElapsed(e=>e+1), 1000);
    // Simulate real-time network quality changes
    netTimer.current = setInterval(()=>{
      setNetQuality(Math.floor(Math.random()*4)+1);
    }, 3000);
    return()=>{ clearInterval(timer.current); clearInterval(netTimer.current); };
  },[]);

  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  // Network quality config
  const netConfig = {
    1:{ color:"#ef4444", label:"Poor",    bars:[1,0,0,0] },
    2:{ color:"#f59e0b", label:"Fair",    bars:[1,1,0,0] },
    3:{ color:"#eab308", label:"Good",    bars:[1,1,1,0] },
    4:{ color:"#22c55e", label:"Strong",  bars:[1,1,1,1] },
  }[netQuality];

  const NetworkBars = () => (
    <div style={{display:"flex",alignItems:"flex-end",gap:2,height:16}}>
      {netConfig.bars.map((on,i)=>(
        <div key={i} style={{
          width:4, borderRadius:2,
          height: 5 + i*3,
          background: on ? netConfig.color : "rgba(255,255,255,0.15)",
          transition:"background 0.4s"
        }}/>
      ))}
    </div>
  );

  const CB = ({onClick,label,active,icon,color}) => (
    <button onClick={onClick} title={label} style={{
      background: active ? (color?`${color}33`:"rgba(99,102,241,0.35)") : "rgba(255,255,255,0.08)",
      border:`1px solid ${active?(color||"#6366f1"):"rgba(255,255,255,0.12)"}`,
      borderRadius:"50%", width:52, height:52,
      display:"flex", alignItems:"center", justifyContent:"center",
      cursor:"pointer", color: active?(color||"#a5b4fc"):"#fff",
      flexShrink:0, transition:"all 0.2s"
    }}>
      {icon}
    </button>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(5,5,15,0.96)",backdropFilter:"blur(24px)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:2000,color:"#fff",gap:0}}>

      {/* Network quality — top bar */}
      <div style={{position:"absolute",top:20,right:20,display:"flex",alignItems:"center",gap:6}}>
        <NetworkBars/>
        <span style={{fontSize:11,color:netConfig.color,fontWeight:600}}>{netConfig.label}</span>
      </div>

      {/* Avatar */}
      <div style={{width:86,height:86,borderRadius:"50%",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,fontWeight:700,marginBottom:16,boxShadow:"0 0 40px rgba(99,102,241,0.3)"}}>
        {contact.name[0]}
      </div>

      {/* Name + status */}
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontSize:22,fontWeight:700}}>{contact.name}</div>
        <div style={{color:"#666",fontSize:13,marginTop:3}}>{contact.number}</div>
        <div style={{marginTop:8,fontSize:15,fontVariantNumeric:"tabular-nums",color:held?"#f59e0b":callStatus==="calling"?"#f59e0b":"#22c55e",fontWeight:500}}>
          {held ? "⏸ On Hold" : callStatus==="calling" ? "📞 Ringing..." : callStatus==="connected" ? fmt(elapsed) : callStatus==="ended" ? "Call Ended" : fmt(elapsed)}
        </div>
        {recording && (
          <div style={{marginTop:6,display:"flex",alignItems:"center",gap:5,justifyContent:"center"}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",display:"inline-block",animation:"pulse 1s infinite"}}/>
            <span style={{fontSize:11,color:"#ef4444",letterSpacing:"0.5px"}}>REC</span>
          </div>
        )}
      </div>

      {/* Call control buttons */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center",maxWidth:300,marginBottom:28}}>
        <CB onClick={()=>setMuted(m=>!m)} active={muted} label={muted?"Unmute":"Mute"}
          icon={<Ic size={20} d={muted
            ?"M19 19L5 5M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"
            :"M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"}/>}
        />

        {/* SPEAKER button */}
        <CB onClick={()=>setSpeaker(s=>!s)} active={speakerOn} color="#f59e0b" label={speakerOn?"Speaker Off":"Speaker On"}
          icon={
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {speakerOn
                ? <><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></>
                : <><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></>
              }
            </svg>
          }
        />

        <CB onClick={()=>setVideoOn(v=>!v)} active={videoOn} label="Video"
          icon={<Ic size={20} d="M15 10l5-3v10l-5-3V10zM4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z"/>}
        />

        <CB onClick={()=>setHeld(h=>!h)} active={held} label={held?"Resume":"Hold"}
          icon={<Ic d={held?"M5 3l14 9-14 9V3z":"M6 5h2v14H6V5zm10 0h2v14h-2V5z"}/>}
        />

        {can(currentUser,"record_calls") && (
          <CB onClick={()=>setRecording(r=>!r)} active={recording} color="#ef4444" label={recording?"Stop Recording":"Record"}
            icon={<svg width={20} height={20} viewBox="0 0 24 24" fill={recording?"#ef4444":"none"} stroke={recording?"#ef4444":"currentColor"} strokeWidth="2"><circle cx="12" cy="12" r="6"/>{!recording&&<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>}</svg>}
          />
        )}
      </div>

      {/* Network detail strip */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:28,padding:"8px 20px",background:"rgba(255,255,255,0.05)",borderRadius:20,border:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#444"}}>SIGNAL</div>
          <div style={{display:"flex",justifyContent:"center",marginTop:2}}><NetworkBars/></div>
        </div>
        <div style={{width:1,height:24,background:"rgba(255,255,255,0.08)"}}/>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#444"}}>LATENCY</div>
          <div style={{fontSize:12,color:netQuality>=3?"#22c55e":netQuality===2?"#f59e0b":"#ef4444",fontWeight:600,marginTop:1}}>
            {netQuality===4?"18ms":netQuality===3?"45ms":netQuality===2?"120ms":"350ms"}
          </div>
        </div>
        <div style={{width:1,height:24,background:"rgba(255,255,255,0.08)"}}/>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#444"}}>CODEC</div>
          <div style={{fontSize:11,color:"#666",marginTop:1}}>G.711</div>
        </div>
        <div style={{width:1,height:24,background:"rgba(255,255,255,0.08)"}}/>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#444"}}>SPEAKER</div>
          <div style={{fontSize:11,color:speakerOn?"#f59e0b":"#555",marginTop:1,fontWeight:600}}>{speakerOn?"ON":"OFF"}</div>
        </div>
      </div>

      {/* End call */}
      <button onClick={onEnd} style={{width:68,height:68,borderRadius:"50%",background:"linear-gradient(135deg,#ef4444,#dc2626)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",boxShadow:"0 0 28px rgba(239,68,68,0.5)"}}>
        <svg width={28} height={28} viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" transform="rotate(135 12 12)"/></svg>
      </button>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}} @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════
export default function App() {
  // ── AUTH STATE ──────────────────────────────────────────
  const [screen, setScreen]     = useState("login"); // login | signup | forgot | app
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers]       = useState(INIT_USERS);
  const [plans, setPlans]       = useState(INIT_PLANS);
  const [authErr, setAuthErr]   = useState("");
  const [authMsg, setAuthMsg]   = useState("");

  // login form
  const [loginEmail, setLoginEmail]   = useState("");
  const [loginPass,  setLoginPass]    = useState("");
  const [showPass,   setShowPass]     = useState(false);

  // signup form
  const [suName,  setSuName]   = useState("");
  const [suEmail, setSuEmail]  = useState("");
  const [suPass,  setSuPass]   = useState("");
  const [suPass2, setSuPass2]  = useState("");
  const [suRole,  setSuRole]   = useState("agent");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);

  // forgot
  const [forgotEmail, setForgotEmail] = useState("");

  // profile edit
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName]   = useState("");
  const [profilePass,  setProfilePass]  = useState("");
  const [profilePass2, setProfilePass2] = useState("");

  // app state
  const [tab, setTab]           = useState("dialer");
  const [dialInput, setDialInput] = useState("");
  const [activeCall, setActiveCall] = useState(null);
  // contacts managed above
  const [logs]                  = useState(MOCK_LOGS);
  const [searchContact, setSearchContact] = useState("");
  const [sipConnected, setSipConnected]   = useState(false);
  const [sipConnecting, setSipConnecting] = useState(false);
  const [sipErr, setSipErr]               = useState("");
  const [sipDomain, setSipDomain]         = useState("");
  const [sipUser, setSipUser]             = useState("");
  const [sipPass, setSipPass]             = useState("");
  const [showSipPass, setShowSipPass]     = useState(false);
  const [twilioNumber, setTwilioNumber]   = useState("");

  // Twilio device + call state
  const [twilioReady, setTwilioReady]     = useState(false);
  const [callStatus, setCallStatus]       = useState(""); // idle|calling|connected|ended
  const twilioDeviceRef                   = useRef(null);
  const activeCallRef                     = useRef(null);

  // Recordings
  const [recordings, setRecordings]       = useState([]);
  const [recLoading, setRecLoading]       = useState(false);
  const [playingRec, setPlayingRec]       = useState(null);
  const audioRef                          = useRef(null);
  const [adminRecord, setAdminRecord]     = useState(true);
  const [userStopRecord, setUserStopRecord] = useState(true);
  const [videoEnabled, setVideoEnabled]   = useState(true);
  const [screenShareEnabled, setScreenShareEnabled] = useState(true);

  // IVR Routes state
  const [ivrRoutes, setIvrRoutes] = useState([
    { id:1, label:"Sales",   ext:"101", action:"ring_group", dest:"+923001234567" },
    { id:2, label:"Support", ext:"102", action:"voicemail",  dest:"support@demo.com" },
    { id:3, label:"Billing", ext:"103", action:"ring_group", dest:"+923121234567" },
  ]);
  const [editingIvr, setEditingIvr]   = useState(null); // route id being edited
  const [ivrDraft,   setIvrDraft]     = useState(null); // draft copy
  const [addingIvr,  setAddingIvr]    = useState(false);
  const [newIvr,     setNewIvr]       = useState({ label:"", ext:"", action:"ring_group", dest:"" });

  // user management
  const [userMgmtTab, setUserMgmtTab] = useState("list");
  const [editingUser, setEditingUser] = useState(null);
  const [newUserData, setNewUserData] = useState({ name:"", email:"", role:"agent", plan:"starter" });

  // plan editing
  const [editingPlan, setEditingPlan] = useState(null);
  const [planDraft, setPlanDraft]     = useState(null);

  // dialer extras
  const [showSaveContact, setShowSaveContact] = useState(false);
  const [saveContactName, setSaveContactName] = useState("");
  const [contacts, setContacts] = useState(MOCK_CONTACTS);
  const [editContact, setEditContact] = useState(null);
  const [showEmojiPad, setShowEmojiPad] = useState(false);
  const QUICK_REPLIES = [
    "On my way!", "I'll call you back.", "In a meeting, will call later.",
    "Please call me.", "Reached safely.", "Running late, 10 mins.",
    "Can we reschedule?", "Thanks!"
  ];

  // sms
  const [smsContact, setSmsContact] = useState(null);
  const [smsText, setSmsText]       = useState("");
  const [smsThreads, setSmsThreads] = useState({
    1: [
      { id:1, text:"Hello, I'll call you shortly!", from:"me",   status:"read",      time:"10:12 AM" },
      { id:2, text:"Sure, I'll be available.",       from:"them", status:"read",      time:"10:13 AM" },
    ],
    2: [
      { id:3, text:"Please check the document.",    from:"me",   status:"delivered", time:"9:00 AM" },
    ],
  });

  // voicemail
  const voicemail = [
    {id:1,from:"Ahmed Khan",    time:"Today 9:15 AM",      duration:"0:32"},
    {id:2,from:"+12025550001",  time:"Yesterday 4:00 PM",  duration:"1:05"},
  ];

  // ── STYLES ─────────────────────────────────────────────
  const S = {
    page:  { minHeight:"100vh", background:"#0c0c12", color:"#e2e8f0", fontFamily:"'Inter',-apple-system,sans-serif", display:"flex", flexDirection:"column", maxWidth:440, margin:"0 auto", position:"relative" },
    card:  { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, padding:16, marginBottom:12 },
    label: { fontSize:11, color:"#555", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:8, fontWeight:600 },
    input: (err)=>({ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${err?"#ef4444":"rgba(255,255,255,0.1)"}`, borderRadius:10, padding:"11px 14px", color:"#e2e8f0", fontSize:14, outline:"none", boxSizing:"border-box" }),
    btn:   (v="primary")=>({ padding:"11px 20px", borderRadius:10, border:"none", cursor:"pointer", fontWeight:600, fontSize:14,
      background:v==="primary"?"linear-gradient(135deg,#6366f1,#8b5cf6)":v==="danger"?"#ef4444":v==="success"?"#22c55e":"rgba(255,255,255,0.08)",
      color:"#fff", width:"100%", transition:"opacity 0.2s"
    }),
    toggle:(on)=>({ width:42, height:24, borderRadius:12, background:on?"#6366f1":"#333", border:"none", cursor:"pointer", position:"relative", transition:"background 0.3s", flexShrink:0 }),
    header:{ padding:"14px 18px 10px", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"space-between" },
    logo:  { fontSize:17, fontWeight:800, background:"linear-gradient(90deg,#6366f1,#a78bfa)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" },
    nav:   { display:"flex", overflowX:"auto", borderTop:"1px solid rgba(255,255,255,0.06)", background:"#09090f" },
    navB:  (a)=>({ display:"flex", flexDirection:"column", alignItems:"center", gap:2, padding:"9px 4px", flex:1, minWidth:46, border:"none", background:"none", color:a?"#6366f1":"#444", cursor:"pointer", fontSize:8.5, fontWeight:500, borderTop:a?"2px solid #6366f1":"2px solid transparent" }),
    err:   { color:"#ef4444", fontSize:12, marginTop:6 },
    badge: (c)=>({ fontSize:10, padding:"2px 8px", borderRadius:20, background:`${c}22`, color:c, border:`1px solid ${c}44` }),
  };

  // ── AUTH HANDLERS ───────────────────────────────────────
  const handleLogin = () => {
    setAuthErr("");
    if (!rateLimiter(`login_${loginEmail}`, 5, 60000)) { setAuthErr("Too many attempts. Wait 1 minute."); return; }
    const u = users.find(x => x.email.toLowerCase() === loginEmail.toLowerCase() && x.password === hashPassword(loginPass));
    if (!u) { setAuthErr("Invalid email or password."); return; }
    if (u.status === "suspended") { setAuthErr("Account suspended. Contact administrator."); return; }
    setCurrentUser(u);
    setScreen("app");
    setLoginEmail(""); setLoginPass("");
  };

  const handleGoogleLogin = () => {
    // In production: OAuth2 flow with Google. Here we simulate.
    const u = users.find(x => x.googleLinked);
    if (u) { setCurrentUser(u); setScreen("app"); }
    else setAuthErr("No Google account linked. Sign up first.");
  };

  const handleSignup = () => {
    setAuthErr("");
    const name  = sanitize(suName);
    const email = sanitize(suEmail).toLowerCase();
    if (!name)                         { setAuthErr("Name required."); return; }
    if (!isValidEmail(email))          { setAuthErr("Valid email required."); return; }
    if (!isStrongPassword(suPass))     { setAuthErr("Password: 8+ chars, uppercase, number, symbol."); return; }
    if (suPass !== suPass2)            { setAuthErr("Passwords do not match."); return; }
    if (!agreeTerms || !agreePrivacy)  { setAuthErr("Accept Terms & Privacy Policy."); return; }
    if (users.find(x=>x.email===email)){ setAuthErr("Email already registered."); return; }
    const newUser = { id:Date.now(), name, email, password:hashPassword(suPass), role:suRole, status:"active", plan:"starter", avatar:name[0].toUpperCase(), googleLinked:false, createdAt:new Date().toISOString().slice(0,10) };
    setUsers(prev=>[...prev,newUser]);
    setAuthMsg("Account created! Please log in.");
    setScreen("login");
    setSuName(""); setSuEmail(""); setSuPass(""); setSuPass2(""); setAgreeTerms(false); setAgreePrivacy(false);
  };

  const handleForgot = () => {
    setAuthErr("");
    if (!isValidEmail(forgotEmail)) { setAuthErr("Enter a valid email."); return; }
    if (!users.find(x=>x.email.toLowerCase()===forgotEmail.toLowerCase())) { setAuthErr("Email not found."); return; }
    setAuthMsg("Password reset link sent (demo mode — check console).");
    console.log("[SECURITY] Password reset requested for:", forgotEmail);
    setForgotEmail("");
  };

  const handleLogout = () => {
    if (twilioDeviceRef.current) { try { twilioDeviceRef.current.destroy(); } catch(e){} }
    setCurrentUser(null); setScreen("login"); setTab("dialer");
  };

  // Init Twilio SDK when user logs in
  const initTwilio = async () => {
    try {
      const res = await fetch(`${API_URL}/api/token?identity=${currentUser?.email||"user"}`);
      if (!res.ok) throw new Error("Token fetch failed");
      const { token } = await res.json();
      const Twilio = await loadTwilioSDK();
      if (!Twilio) { console.warn("Twilio SDK not loaded"); return; }
      const device = new Twilio.Device(token, { codecPreferences:["opus","pcmu"], enableRingingState:true });
      device.on("ready",    ()=>{ setTwilioReady(true); console.log("Twilio ready"); });
      device.on("error",    (e)=>{ console.error("Twilio error",e); setCallStatus(""); });
      device.on("connect",  ()=>{ setCallStatus("connected"); });
      device.on("disconnect",()=>{ setCallStatus("ended"); setActiveCall(null); setTimeout(()=>setCallStatus(""),1500); });
      device.on("incoming", (conn)=>{ conn.accept(); setActiveCall({name:"Incoming Call",number:conn.parameters.From}); setCallStatus("connected"); });
      twilioDeviceRef.current = device;
    } catch(e) { console.warn("Twilio init failed (backend not running):", e.message); }
  };

  useEffect(()=>{ if(currentUser) initTwilio(); },[currentUser]);

  // Make real call
  const makeRealCall = (number, name) => {
    setActiveCall({ name: name||number, number });
    if (twilioDeviceRef.current && twilioReady) {
      try {
        const conn = twilioDeviceRef.current.connect({ To: number });
        activeCallRef.current = conn;
        setCallStatus("calling");
      } catch(e) { console.warn("Call failed:", e); setCallStatus("connected"); }
    } else {
      // Demo mode — no backend
      setCallStatus("connected");
    }
  };

  // End real call
  const endRealCall = () => {
    if (activeCallRef.current) { try { activeCallRef.current.disconnect(); } catch(e){} activeCallRef.current = null; }
    if (twilioDeviceRef.current) { try { twilioDeviceRef.current.disconnectAll(); } catch(e){} }
    setActiveCall(null); setCallStatus("");
  };

  // Send real SMS
  const sendRealSMS = async (to, body) => {
    try {
      const res = await fetch(`${API_URL}/api/sms/send`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ to, body })
      });
      const data = await res.json();
      return data.success ? "sent" : "failed";
    } catch(e) { return "failed"; }
  };

  // Fetch recordings
  const fetchRecordings = async () => {
    setRecLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/recordings`);
      const data = await res.json();
      setRecordings(data);
    } catch(e) {
      // Demo recordings if no backend
      setRecordings([
        { id:"RE001", callSid:"CA001", url:"", duration:184, createdAt:"2024-06-01T10:15:00Z" },
        { id:"RE002", callSid:"CA002", url:"", duration:67,  createdAt:"2024-06-01T09:02:00Z" },
      ]);
    }
    setRecLoading(false);
  };

  // SIP validate via backend
  const validateSIP = async () => {
    setSipConnecting(true); setSipErr("");
    try {
      const res = await fetch(`${API_URL}/api/sip/validate`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ domain:sipDomain, username:sipUser, password:sipPass, number:twilioNumber })
      });
      const data = await res.json();
      setSipConnecting(false);
      if (data.valid) { setSipConnected(true); }
      else { setSipErr(data.error||"Validation failed"); setSipConnected(false); }
    } catch(e) {
      setSipConnecting(false);
      setSipErr("Cannot reach backend server. Check API_URL in frontend.");
    }
  };

  const handleSaveProfile = () => {
    setAuthErr("");
    const name = sanitize(profileName);
    if (!name) { setAuthErr("Name required."); return; }
    if (profilePass && !isStrongPassword(profilePass)) { setAuthErr("Weak password."); return; }
    if (profilePass && profilePass !== profilePass2) { setAuthErr("Passwords don't match."); return; }
    const updated = { ...currentUser, name, avatar:name[0].toUpperCase(), ...(profilePass ? { password:hashPassword(profilePass) } : {}) };
    setUsers(prev=>prev.map(u=>u.id===currentUser.id?updated:u));
    setCurrentUser(updated);
    setEditingProfile(false);
    setProfilePass(""); setProfilePass2("");
    setAuthMsg("Profile updated.");
  };

  const linkGoogle = () => {
    const updated = { ...currentUser, googleLinked:true };
    setUsers(prev=>prev.map(u=>u.id===currentUser.id?updated:u));
    setCurrentUser(updated);
    setAuthMsg("Google account linked (demo).");
  };

  // ── USER MANAGEMENT (admin/owner) ───────────────────────
  const saveUserEdit = () => {
    if (!editingUser) return;
    setUsers(prev=>prev.map(u=>u.id===editingUser.id?{...u,...editingUser}:u));
    setEditingUser(null);
  };
  const toggleUserStatus = (uid) => {
    setUsers(prev=>prev.map(u=>u.id===uid?{...u,status:u.status==="active"?"suspended":"active"}:u));
  };
  const addUser = () => {
    const name  = sanitize(newUserData.name);
    const email = sanitize(newUserData.email).toLowerCase();
    if (!name || !isValidEmail(email)) { alert("Valid name & email required."); return; }
    if (users.find(x=>x.email===email)) { alert("Email exists."); return; }
    const u = { id:Date.now(), name, email, password:hashPassword("Temp@1234"), role:newUserData.role, status:"active", plan:newUserData.plan, avatar:name[0].toUpperCase(), googleLinked:false, createdAt:new Date().toISOString().slice(0,10) };
    setUsers(prev=>[...prev,u]);
    setNewUserData({name:"",email:"",role:"agent",plan:"starter"});
    setUserMgmtTab("list");
    setAuthMsg("User added. Temp password: Temp@1234");
  };

  // ── PLAN EDIT (owner only) ──────────────────────────────
  const startEditPlan = (p) => { setEditingPlan(p.id); setPlanDraft({...p}); };
  const savePlan = () => {
    setPlans(prev=>prev.map(p=>p.id===editingPlan?{...p,...planDraft,price:Number(planDraft.price),priceLabel:`$${planDraft.price}/mo`}:p));
    setEditingPlan(null); setPlanDraft(null);
  };

  // ── TABS ────────────────────────────────────────────────
  const ALL_TABS = [
    { id:"dialer",   label:"Dialer",   perm:null,              icon:"M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.12 1.2 2 2 0 012.11 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91A16 16 0 0016 17.91l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" },
    { id:"contacts", label:"Contacts", perm:"view_contacts",   icon:"M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" },
    { id:"logs",     label:"Logs",     perm:"view_logs",       icon:"M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" },
    { id:"sms",      label:"SMS",      perm:"send_sms",        icon:"M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
    { id:"voicemail",label:"VoiceMail",perm:null,              icon:"M5.5 8.5a4 4 0 004 4h5a4 4 0 000-8h-5a4 4 0 00-4 4zM2 20h20" },
    { id:"analytics",label:"Analytics",perm:"view_analytics",  icon:"M18 20V10M12 20V4M6 20v-6" },
    { id:"users",    label:"Users",    perm:"manage_users",    icon:"M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M20 8v6M23 11h-6M9 11a4 4 0 100-8 4 4 0 000 8z" },
    { id:"plans",    label:"Plans",    perm:null,              icon:"M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" },
    { id:"records",  label:"Recordings",perm:null,             icon:"M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" },
    { id:"settings", label:"Settings", perm:"manage_settings", icon:"M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" },
    { id:"profile",  label:"Profile",  perm:null,              icon:"M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" },
  ];
  const visibleTabs = ALL_TABS.filter(t => t.perm === null || can(currentUser, t.perm));

  // ── RENDER AUTH ─────────────────────────────────────────
  const AuthWrap = ({ title, sub, children }) => (
    <div style={{ minHeight:"100vh", background:"#0c0c12", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ width:"100%", maxWidth:380 }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:26, fontWeight:800, background:"linear-gradient(90deg,#6366f1,#a78bfa)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>VoiceLink Pro</div>
          <div style={{ fontSize:18, fontWeight:600, color:"#fff", marginTop:10 }}>{title}</div>
          {sub && <div style={{ fontSize:13, color:"#555", marginTop:4 }}>{sub}</div>}
        </div>
        {authErr  && <div style={{ background:"rgba(239,68,68,0.12)", border:"1px solid #ef444444", borderRadius:10, padding:"10px 14px", fontSize:13, color:"#ef4444", marginBottom:14 }}>⚠ {authErr}</div>}
        {authMsg  && <div style={{ background:"rgba(34,197,94,0.12)", border:"1px solid #22c55e44", borderRadius:10, padding:"10px 14px", fontSize:13, color:"#22c55e", marginBottom:14 }}>✓ {authMsg}</div>}
        {children}
      </div>
    </div>
  );

  if (screen === "login") return (
    <AuthWrap title="Sign In" sub="Demo: owner@demo.com / Owner@123">
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <input style={S.input()} placeholder="Email address" value={loginEmail} onChange={e=>setLoginEmail(sanitize(e.target.value))} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoComplete="email"/>
        <div style={{ position:"relative" }}>
          <input style={{...S.input(),paddingRight:44}} placeholder="Password" type={showPass?"text":"password"} value={loginPass} onChange={e=>setLoginPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoComplete="current-password"/>
          <button onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:16 }}>{showPass?"🙈":"👁"}</button>
        </div>
        <button style={S.btn("primary")} onClick={handleLogin}>Sign In</button>
        <button onClick={handleGoogleLogin} style={{ ...S.btn("ghost"), display:"flex", alignItems:"center", justifyContent:"center", gap:8, border:"1px solid rgba(255,255,255,0.12)" }}>
          <span style={{ fontSize:16 }}>G</span> Continue with Google
        </button>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
          <button onClick={()=>{setScreen("forgot");setAuthErr("");setAuthMsg("");}} style={{ background:"none", border:"none", color:"#6366f1", cursor:"pointer", fontSize:13 }}>Forgot password?</button>
          <button onClick={()=>{setScreen("signup");setAuthErr("");setAuthMsg("");}} style={{ background:"none", border:"none", color:"#6366f1", cursor:"pointer", fontSize:13 }}>Create account</button>
        </div>
        <div style={{ marginTop:12, padding:"12px 14px", background:"rgba(99,102,241,0.08)", borderRadius:10, fontSize:11, color:"#666", lineHeight:1.6 }}>
          <strong style={{color:"#888"}}>Demo accounts:</strong><br/>
          owner@demo.com / Owner@123<br/>
          admin@demo.com / Admin@123<br/>
          agent@demo.com / Agent@123
        </div>
      </div>
    </AuthWrap>
  );

  if (screen === "forgot") return (
    <AuthWrap title="Reset Password" sub="Enter your registered email">
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <input style={S.input()} placeholder="Email address" value={forgotEmail} onChange={e=>setForgotEmail(sanitize(e.target.value))} autoComplete="email"/>
        <button style={S.btn("primary")} onClick={handleForgot}>Send Reset Link</button>
        <button onClick={()=>{setScreen("login");setAuthErr("");}} style={{ background:"none", border:"none", color:"#6366f1", cursor:"pointer", fontSize:13, textAlign:"center" }}>← Back to Login</button>
      </div>
    </AuthWrap>
  );

  if (screen === "signup") return (
    <AuthWrap title="Create Account" sub="All fields required">
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <input style={S.input()} placeholder="Full name" value={suName} onChange={e=>setSuName(sanitize(e.target.value))} autoComplete="name"/>
        <input style={S.input()} placeholder="Email address" value={suEmail} onChange={e=>setSuEmail(sanitize(e.target.value))} autoComplete="email"/>
        <div style={{ position:"relative" }}>
          <input style={{...S.input(),paddingRight:44}} placeholder="Password (8+, A-Z, 0-9, symbol)" type={showPass?"text":"password"} value={suPass} onChange={e=>setSuPass(e.target.value)} autoComplete="new-password"/>
          <button onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#555", cursor:"pointer" }}>{showPass?"🙈":"👁"}</button>
        </div>
        {suPass && (
          <div style={{ display:"flex", gap:4, marginTop:-4 }}>
            {[suPass.length>=8,/[A-Z]/.test(suPass),/[0-9]/.test(suPass),/[^A-Za-z0-9]/.test(suPass)].map((ok,i)=>(
              <div key={i} style={{ flex:1, height:3, borderRadius:3, background:ok?"#22c55e":"#333" }}/>
            ))}
          </div>
        )}
        <input style={S.input()} placeholder="Confirm password" type="password" value={suPass2} onChange={e=>setSuPass2(e.target.value)} autoComplete="new-password"/>
        <div>
          <div style={{ fontSize:11, color:"#555", marginBottom:5 }}>Account Type</div>
          <select style={{...S.input(),color:"#e2e8f0"}} value={suRole} onChange={e=>setSuRole(e.target.value)}>
            <option value="agent">Agent — Make calls, SMS</option>
            <option value="viewer">Viewer — Analytics only</option>
          </select>
        </div>
        <label style={{ display:"flex", gap:10, alignItems:"flex-start", fontSize:13, color:"#888", cursor:"pointer" }}>
          <input type="checkbox" checked={agreeTerms} onChange={e=>setAgreeTerms(e.target.checked)} style={{ marginTop:2, accentColor:"#6366f1", flexShrink:0 }}/>
          I agree to the <span style={{ color:"#6366f1" }}>Terms of Service</span>
        </label>
        <label style={{ display:"flex", gap:10, alignItems:"flex-start", fontSize:13, color:"#888", cursor:"pointer" }}>
          <input type="checkbox" checked={agreePrivacy} onChange={e=>setAgreePrivacy(e.target.checked)} style={{ marginTop:2, accentColor:"#6366f1", flexShrink:0 }}/>
          I agree to the <span style={{ color:"#6366f1" }}>Privacy Policy</span>
        </label>
        <button style={S.btn("primary")} onClick={handleSignup}>Create Account</button>
        <button onClick={handleGoogleLogin} style={{ ...S.btn("ghost"), display:"flex", alignItems:"center", justifyContent:"center", gap:8, border:"1px solid rgba(255,255,255,0.12)" }}>
          <span style={{ fontSize:16 }}>G</span> Sign up with Google
        </button>
        <button onClick={()=>{setScreen("login");setAuthErr("");}} style={{ background:"none", border:"none", color:"#6366f1", cursor:"pointer", fontSize:13, textAlign:"center" }}>Already have an account? Sign In</button>
      </div>
    </AuthWrap>
  );

  // ── RENDER APP ──────────────────────────────────────────
  const filteredContacts = contacts.filter(c=>c.name.toLowerCase().includes(searchContact.toLowerCase())||c.number.includes(searchContact));

  const renderTab = () => {
    switch(tab) {

      case "dialer": return (
        <div>
          {/* Number display */}
          <div style={{ textAlign:"center", marginBottom:16, position:"relative" }}>
            <div style={{ fontSize:28, fontWeight:300, letterSpacing:3, minHeight:44, color:dialInput?"#fff":"#333", fontVariantNumeric:"tabular-nums", fontFamily:"monospace" }}>
              {dialInput||"Enter number"}
            </div>
            <div style={{ fontSize:11, color:"#444", marginTop:2 }}>
              via {twilioNumber} {sipConnected?<span style={{color:"#22c55e"}}>● SIP</span>:<span style={{color:"#ef4444"}}>○ SIP Offline</span>}
            </div>
            {/* Save contact button — appears when number typed */}
            {dialInput && (
              <button onClick={()=>{setSaveContactName("");setShowSaveContact(true);}} style={{position:"absolute",right:0,top:0,background:"rgba(99,102,241,0.15)",border:"1px solid #6366f144",borderRadius:8,padding:"4px 10px",color:"#a5b4fc",cursor:"pointer",fontSize:11}}>
                + Save
              </button>
            )}
          </div>

          {/* Save contact modal */}
          {showSaveContact && (
            <div style={{background:"rgba(99,102,241,0.08)",border:"1px solid #6366f133",borderRadius:12,padding:14,marginBottom:14}}>
              <div style={{fontSize:12,color:"#888",marginBottom:8}}>Save number as contact</div>
              <input style={{...S.input(),marginBottom:8}} placeholder="Contact name" value={saveContactName} onChange={e=>setSaveContactName(sanitize(e.target.value))} autoFocus/>
              <div style={{display:"flex",gap:8}}>
                <button style={{...S.btn("primary"),fontSize:12}} onClick={()=>{
                  if(!saveContactName.trim()) return;
                  setContacts(prev=>[...prev,{id:Date.now(),name:saveContactName.trim(),number:dialInput,tag:""}]);
                  setShowSaveContact(false); setSaveContactName(""); setAuthMsg("Contact saved!");
                }}>Save Contact</button>
                <button style={{...S.btn("ghost"),fontSize:12}} onClick={()=>setShowSaveContact(false)}>Cancel</button>
              </div>
            </div>
          )}

          <Dialpad onPress={(d, isPlus)=>{
            if(isPlus) setDialInput(p=>p+"+");
            else setDialInput(p=>p+sanitizePhone(d));
          }}/>

          {/* Call / backspace row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:20, marginTop:20 }}>
            <button onClick={()=>setDialInput("")} style={{ width:48, height:48, borderRadius:"50%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", cursor:"pointer", color:"#555", fontSize:12 }} title="Clear">CLR</button>
            <button
              disabled={!can(currentUser,"make_calls")||!dialInput}
              onClick={()=>{
                if(!can(currentUser,"make_calls")||!dialInput) return;
                const name = contacts.find(c=>c.number===dialInput)?.name||dialInput;
                makeRealCall(dialInput, name);
              }}
              style={{ width:64, height:64, borderRadius:"50%", background:can(currentUser,"make_calls")&&dialInput?"linear-gradient(135deg,#22c55e,#16a34a)":"#222", border:"none", cursor:can(currentUser,"make_calls")&&dialInput?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", boxShadow:dialInput?"0 0 20px rgba(34,197,94,0.3)":"none", transition:"all 0.2s" }}>
              <PhoneIc size={26}/>
            </button>
            <button onClick={()=>setDialInput(p=>p.slice(0,-1))} style={{ width:48, height:48, borderRadius:"50%", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", cursor:"pointer", color:"#888", fontSize:18 }}>⌫</button>
          </div>

          {!can(currentUser,"make_calls")&&<div style={{ textAlign:"center", marginTop:10, fontSize:12, color:"#ef4444" }}>⚠ Your role cannot make calls</div>}

          {/* Hint for + */}
          <div style={{textAlign:"center",marginTop:10,fontSize:11,color:"#333"}}>Hold <span style={{color:"#6366f1",fontWeight:700}}>0</span> to type <span style={{color:"#6366f1"}}>+</span> for international</div>
        </div>
      );

      case "contacts": return (
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={S.label}>Contacts</div>
            <button onClick={()=>setEditContact({id:"new",name:"",number:"",tag:""})} style={{background:"rgba(99,102,241,0.2)",border:"1px solid #6366f144",borderRadius:8,padding:"5px 12px",color:"#a5b4fc",cursor:"pointer",fontSize:12,fontWeight:600}}>+ Add</button>
          </div>
          <input style={{...S.input(),marginBottom:12}} placeholder="Search name or number..." value={searchContact} onChange={e=>setSearchContact(sanitize(e.target.value))}/>

          {/* Add / Edit contact form */}
          {editContact && (
            <div style={{background:"rgba(99,102,241,0.08)",border:"1px solid #6366f133",borderRadius:12,padding:14,marginBottom:14}}>
              <div style={{fontSize:12,color:"#a5b4fc",fontWeight:600,marginBottom:10}}>{editContact.id==="new"?"New Contact":"Edit Contact"}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <input style={S.input()} placeholder="Full name *" value={editContact.name} onChange={e=>setEditContact(p=>({...p,name:sanitize(e.target.value)}))}/>
                <input style={S.input()} placeholder="Phone number e.g. +923001234567 *" value={editContact.number} onChange={e=>setEditContact(p=>({...p,number:sanitizePhone(e.target.value)}))}/>
                <input style={S.input()} placeholder="Tag (optional: VIP, Client...)" value={editContact.tag} onChange={e=>setEditContact(p=>({...p,tag:sanitize(e.target.value)}))}/>
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.btn("primary"),fontSize:12}} onClick={()=>{
                    if(!editContact.name.trim()||!editContact.number.trim()){setAuthErr("Name and number required.");return;}
                    if(editContact.id==="new"){
                      setContacts(prev=>[...prev,{id:Date.now(),name:editContact.name.trim(),number:editContact.number.trim(),tag:editContact.tag.trim()}]);
                      setAuthMsg("Contact added!");
                    } else {
                      setContacts(prev=>prev.map(c=>c.id===editContact.id?{...c,...editContact}:c));
                      setAuthMsg("Contact updated!");
                    }
                    setEditContact(null);
                  }}>Save</button>
                  {editContact.id!=="new" && (
                    <button style={{...S.btn("danger"),fontSize:12,width:"auto",padding:"10px 14px"}} onClick={()=>{
                      setContacts(prev=>prev.filter(c=>c.id!==editContact.id));
                      setEditContact(null); setAuthMsg("Contact deleted.");
                    }}>Delete</button>
                  )}
                  <button style={{...S.btn("ghost"),fontSize:12}} onClick={()=>{setEditContact(null);setAuthErr("");}}>Cancel</button>
                </div>
                {authErr&&<div style={{color:"#ef4444",fontSize:12}}>⚠ {authErr}</div>}
              </div>
            </div>
          )}

          {filteredContacts.length===0&&<div style={{textAlign:"center",color:"#444",fontSize:13,marginTop:20}}>No contacts found</div>}
          {filteredContacts.map(c=>(
            <div key={c.id} style={{...S.card,display:"flex",alignItems:"center",gap:10}}>
              <div style={{ width:40, height:40, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, flexShrink:0 }}>{c.name[0]}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:14}}>{c.name}</div>
                <div style={{color:"#555",fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.number}</div>
                {c.tag&&<span style={{...S.badge("#6366f1"),display:"inline-block",marginTop:3}}>{c.tag}</span>}
              </div>
              <button onClick={()=>setEditContact({...c})} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"5px 10px",color:"#888",cursor:"pointer",fontSize:11}}>Edit</button>
              {can(currentUser,"make_calls")&&<button style={{background:"rgba(34,197,94,0.15)",border:"none",borderRadius:7,padding:"5px 10px",color:"#22c55e",cursor:"pointer"}} onClick={()=>makeRealCall(c.number,c.name)}><PhoneIc size={16}/></button>}
            </div>
          ))}
        </div>
      );

      case "logs": return (
        <div>
          <div style={S.label}>Call Logs</div>
          {logs.map(l=>(
            <div key={l.id} style={{...S.card,display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontSize:20}}>{l.type==="incoming"?"📥":l.type==="outgoing"?"📤":"❌"}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:14}}>{l.name}</div>
                <div style={{color:"#555",fontSize:12}}>{l.number} · {l.time}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:12,color:l.type==="missed"?"#ef4444":"#888"}}>{l.duration}</div>
                {l.recorded&&<div style={{fontSize:10,color:"#ef4444",marginTop:2}}>● REC</div>}
              </div>
              {can(currentUser,"make_calls")&&<button style={{background:"none",border:"none",color:"#22c55e",cursor:"pointer"}} onClick={()=>makeRealCall(l.number,l.name)}><PhoneIc size={16}/></button>}
            </div>
          ))}
        </div>
      );

      case "sms": return (
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={S.label}>SMS Messages</div>
            <button onClick={()=>setSmsContact({id:"new",name:"New Number",number:""})} style={{background:"rgba(99,102,241,0.2)",border:"1px solid #6366f144",borderRadius:8,padding:"5px 12px",color:"#a5b4fc",cursor:"pointer",fontSize:12,fontWeight:600}}>+ New SMS</button>
          </div>
          {contacts.map(c=>{
            const thread = (smsThreads[c.id]||[]);
            const last = thread[thread.length-1];
            return (
              <div key={c.id} style={{...S.card,cursor:"pointer",display:"flex",alignItems:"center",gap:12}} onClick={()=>{ setSmsContact(c); setTimeout(()=>{ setSmsThreads(prev=>{ const t=[...(prev[c.id]||[])]; const updated=t.map(m=>m.from==="them"&&m.status!=="read"?{...m,status:"read"}:m); return {...prev,[c.id]:updated}; }); },800); }}>
                <div style={{ width:38, height:38, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, flexShrink:0 }}>{c.name[0]}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:14}}>{c.name}</div>
                  <div style={{color:"#555",fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{last ? last.text : "Tap to message"}</div>
                </div>
                {last?.from==="them" && last?.status!=="read" && <div style={{width:9,height:9,borderRadius:"50%",background:"#6366f1",flexShrink:0}}/>}
                <span style={{color:"#444",fontSize:16}}>›</span>
              </div>
            );
          })}

          {smsContact&&(()=>{
            // status tick component
            const Ticks = ({status}) => {
              if(status==="sending") return <span style={{fontSize:11,color:"#555",marginLeft:4}}>✓</span>;
              if(status==="sent")    return <span style={{fontSize:11,color:"#888",marginLeft:4}}>✓✓</span>;
              if(status==="delivered") return (
                <span style={{marginLeft:4,display:"inline-flex"}}>
                  <svg width="16" height="11" viewBox="0 0 16 11"><path d="M1 5.5l3.5 3.5 6-7" stroke="#888" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5l3.5 3.5 6-7" stroke="#888" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
              );
              if(status==="read") return (
                <span style={{marginLeft:4,display:"inline-flex"}}>
                  <svg width="16" height="11" viewBox="0 0 16 11"><path d="M1 5.5l3.5 3.5 6-7" stroke="#3b82f6" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5l3.5 3.5 6-7" stroke="#3b82f6" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
              );
              return null;
            };

            // For "new" SMS: use phone number as thread key
            const threadKey = smsContact.id === "new" ? ("num_"+smsContact.number) : smsContact.id;
            const thread = smsThreads[threadKey] || [];

            const sendMsg = () => {
              if(!smsText.trim()) return;
              if(smsContact.id==="new" && !smsContact.number.trim()) return;
              const msgId = Date.now();
              const msg = { id:msgId, text:smsText.trim(), from:"me", status:"sending", time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) };
              setSmsThreads(prev=>({...prev,[threadKey]:[...(prev[threadKey]||[]),msg]}));
              setSmsText("");
              // Try real backend SMS, fallback to simulation
              sendRealSMS(smsContact.number, msg.text).then(()=>{
                setTimeout(()=>setSmsThreads(prev=>({...prev,[threadKey]:(prev[threadKey]||[]).map(m=>m.id===msgId?{...m,status:"sent"}:m)})),600);
                setTimeout(()=>setSmsThreads(prev=>({...prev,[threadKey]:(prev[threadKey]||[]).map(m=>m.id===msgId?{...m,status:"delivered"}:m)})),1800);
                setTimeout(()=>setSmsThreads(prev=>({...prev,[threadKey]:(prev[threadKey]||[]).map(m=>m.id===msgId?{...m,status:"read"}:m)})),4000);
              });
              // Demo auto-reply
              setTimeout(()=>{
                const reply = { id:Date.now()+1, text:"Got it! Thanks 👍", from:"them", status:"read", time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) };
                setSmsThreads(prev=>({...prev,[threadKey]:[...(prev[threadKey]||[]),reply]}));
              },6000);
            };

            return (
              <div style={{ position:"fixed", inset:0, background:"#0c0c12", zIndex:1500, display:"flex", flexDirection:"column" }}>
                {/* Header */}
                <div style={{ padding:"14px 18px", borderBottom:"1px solid rgba(255,255,255,0.08)", display:"flex", alignItems:"center", gap:12, background:"#0f0f16" }}>
                  <button onClick={()=>setSmsContact(null)} style={{ background:"none", border:"none", color:"#6366f1", cursor:"pointer", fontSize:22, lineHeight:1 }}>←</button>
                  {smsContact.id==="new" ? (
                    <div style={{flex:1}}>
                      <input
                        style={{...S.input(),fontSize:14}}
                        placeholder="Type number e.g. +923001234567"
                        value={smsContact.number}
                        onChange={e=>{
                          const v = e.target.value;
                          setSmsContact(prev=>({...prev,number:v,name:v||"New Number"}));
                        }}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <>
                      <div style={{ width:34, height:34, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:14 }}>{(smsContact.name||"?")[0]}</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:15}}>{smsContact.name}</div>
                        <div style={{color:"#555",fontSize:11}}>{smsContact.number}</div>
                      </div>
                    </>
                  )}
                </div>

                {/* Messages */}
                <div style={{ flex:1, overflowY:"auto", padding:"16px 14px", display:"flex", flexDirection:"column", gap:6 }}>
                  {thread.length===0 && (
                    <div style={{textAlign:"center",color:"#333",fontSize:13,marginTop:40}}>
                      {smsContact.id==="new" && !smsContact.number ? <span style={{color:"#555"}}>Enter a number above to start chatting</span> : "No messages yet. Say hello! 👋"}
                    </div>
                  )}
                  {thread.map(m=>(
                    <div key={m.id} style={{ display:"flex", flexDirection:"column", alignItems:m.from==="me"?"flex-end":"flex-start" }}>
                      <div style={{
                        background: m.from==="me" ? "linear-gradient(135deg,#6366f1,#7c3aed)" : "rgba(255,255,255,0.07)",
                        borderRadius: m.from==="me" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                        padding:"9px 13px", maxWidth:"75%", fontSize:14, color:m.from==="me"?"#fff":"#e2e8f0",
                        wordBreak:"break-word"
                      }}>
                        {m.text}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:3, marginTop:2, paddingRight: m.from==="me"?2:0, paddingLeft: m.from==="them"?2:0 }}>
                        <span style={{fontSize:10,color:"#444"}}>{m.time}</span>
                        {m.from==="me" && <Ticks status={m.status}/>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Status legend */}
                <div style={{ padding:"4px 14px 0", display:"flex", gap:14, justifyContent:"flex-end" }}>
                  {[
                    {label:"Sending", el:<span style={{fontSize:11,color:"#555"}}>✓</span>},
                    {label:"Sent",    el:<span style={{fontSize:11,color:"#888"}}>✓✓</span>},
                    {label:"Delivered",el:<svg width="16" height="11" viewBox="0 0 16 11"><path d="M1 5.5l3.5 3.5 6-7" stroke="#888" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5l3.5 3.5 6-7" stroke="#888" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>},
                    {label:"Read",    el:<svg width="16" height="11" viewBox="0 0 16 11"><path d="M1 5.5l3.5 3.5 6-7" stroke="#3b82f6" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5l3.5 3.5 6-7" stroke="#3b82f6" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>},
                  ].map(s=>(
                    <div key={s.label} style={{display:"flex",alignItems:"center",gap:3}}>
                      {s.el}<span style={{fontSize:9,color:"#444"}}>{s.label}</span>
                    </div>
                  ))}
                </div>

                {/* Quick Replies */}
                {showEmojiPad==="quick" && (
                  <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",padding:"10px 12px",background:"#0a0a10",display:"flex",flexWrap:"wrap",gap:6,maxHeight:140,overflowY:"auto"}}>
                    {QUICK_REPLIES.map(q=>(
                      <button key={q} onClick={()=>{setSmsText(q);setShowEmojiPad(null);}} style={{background:"rgba(99,102,241,0.15)",border:"1px solid #6366f133",borderRadius:20,padding:"5px 12px",color:"#c7d2fe",cursor:"pointer",fontSize:12,whiteSpace:"nowrap"}}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
                {/* Emoji Pad */}
                {showEmojiPad==="emoji" && (
                  <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",padding:"10px 12px",background:"#0a0a10",display:"flex",flexWrap:"wrap",gap:4,maxHeight:140,overflowY:"auto"}}>
                    {"😊😂❤️👍🙏😍🤝👋😅😎🔥✅💯🎉👏😢😡🤔💪🫡📞📩🕐✓".split("").map((e,i)=>(
                      <button key={i} onClick={()=>{setSmsText(p=>p+e);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:22,padding:"2px 4px",borderRadius:6}}>{e}</button>
                    ))}
                  </div>
                )}
                {/* Input */}
                <div style={{ padding:"8px 12px 12px", borderTop:"1px solid rgba(255,255,255,0.06)", background:"#0f0f16" }}>
                  <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
                    <button onClick={()=>setShowEmojiPad(p=>p==="emoji"?null:"emoji")} style={{background:showEmojiPad==="emoji"?"rgba(99,102,241,0.25)":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:16,color:"#fff"}}>😊</button>
                    <button onClick={()=>setShowEmojiPad(p=>p==="quick"?null:"quick")} style={{background:showEmojiPad==="quick"?"rgba(99,102,241,0.25)":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:11,color:"#a5b4fc",fontWeight:600,whiteSpace:"nowrap"}}>⚡ Quick</button>
                    <input
                      style={{...S.input(),flex:1,borderRadius:20,padding:"9px 14px",fontSize:13}}
                      placeholder="Type a message..."
                      value={smsText}
                      onChange={e=>setSmsText(sanitize(e.target.value))}
                      onKeyDown={e=>{ if(e.key==="Enter"&&smsContact.id!=="new") sendMsg(); }}
                      maxLength={160}
                    />
                    <button onClick={()=>{ if(smsContact.id==="new"&&!smsContact.number) return; sendMsg(); }} style={{ width:42, height:42, borderRadius:"50%", background:smsText.trim()?"linear-gradient(135deg,#6366f1,#7c3aed)":"rgba(255,255,255,0.08)", border:"none", cursor:smsText.trim()?"pointer":"default", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexShrink:0, transition:"background 0.2s" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                  </div>
                  <div style={{textAlign:"right",fontSize:10,color:"#333"}}>{smsText.length}/160</div>
                </div>
              </div>
            );
          })()}
        </div>
      );

      case "voicemail": return (
        <div>
          <div style={S.label}>Voicemail</div>
          {voicemail.map(v=>(
            <div key={v.id} style={{...S.card,display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontSize:24}}>📩</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:14}}>{v.from}</div>
                <div style={{color:"#555",fontSize:12}}>{v.time} · {v.duration}</div>
              </div>
              <button style={{background:"rgba(99,102,241,0.2)",border:"1px solid #6366f144",borderRadius:8,padding:"6px 12px",color:"#a5b4fc",cursor:"pointer",fontSize:12}}>▶ Play</button>
            </div>
          ))}
        </div>
      );

      case "analytics": return (
        <div>
          <div style={S.label}>Call Analytics</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
            {[{l:"Total Calls",v:"248",d:"+12%"},{l:"Avg Duration",v:"4:32",d:"+18s"},{l:"Missed",v:"18",d:"-3",bad:true},{l:"Recorded",v:"134",d:"+22"}].map(m=>(
              <div key={m.l} style={S.card}>
                <div style={{fontSize:22,fontWeight:700,color:"#6366f1"}}>{m.v}</div>
                <div style={{fontSize:11,color:"#555",marginTop:2}}>{m.l}</div>
                <div style={{fontSize:11,color:m.bad?"#ef4444":"#22c55e",marginTop:3}}>{m.d}</div>
              </div>
            ))}
          </div>
          <div style={S.card}>
            <div style={S.label}>This Week</div>
            <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:70 }}>
              {[40,65,50,80,60,90,55].map((h,i)=>(
                <div key={i} style={{ flex:1, background:"linear-gradient(180deg,#6366f1,#8b5cf6)", borderRadius:"3px 3px 0 0", height:`${h}%` }}/>
              ))}
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
              {["Mo","Tu","We","Th","Fr","Sa","Su"].map(d=><div key={d} style={{flex:1,textAlign:"center",fontSize:10,color:"#444"}}>{d}</div>)}
            </div>
          </div>
          <div style={S.card}>
            <div style={S.label}>Spam Blocked</div>
            <div style={{fontSize:26,fontWeight:700,color:"#f59e0b"}}>34</div>
            <div style={{fontSize:12,color:"#555",marginTop:4}}>AI spam filter blocks this month</div>
          </div>
        </div>
      );

      case "users": return can(currentUser,"manage_users") ? (
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:14 }}>
            {["list","add"].map(t=>(
              <button key={t} onClick={()=>setUserMgmtTab(t)} style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:userMgmtTab===t?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)", color:userMgmtTab===t?"#a5b4fc":"#666", cursor:"pointer", fontWeight:600, fontSize:13 }}>{t==="list"?"All Users":"Add User"}</button>
            ))}
          </div>
          {userMgmtTab==="list" && users.map(u=>(
            <div key={u.id} style={S.card}>
              {editingUser?.id===u.id ? (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <input style={S.input()} value={editingUser.name} onChange={e=>setEditingUser(p=>({...p,name:sanitize(e.target.value)}))} placeholder="Name"/>
                  <select style={{...S.input(),color:"#e2e8f0"}} value={editingUser.role} onChange={e=>setEditingUser(p=>({...p,role:e.target.value}))}>
                    {Object.entries(ROLES).filter(([r])=>r!=="owner"||can(currentUser,"all")).map(([r,d])=><option key={r} value={r}>{d.label}</option>)}
                  </select>
                  <select style={{...S.input(),color:"#e2e8f0"}} value={editingUser.plan} onChange={e=>setEditingUser(p=>({...p,plan:e.target.value}))}>
                    {plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div style={{display:"flex",gap:8}}>
                    <button style={{...S.btn("primary"),fontSize:12}} onClick={saveUserEdit}>Save</button>
                    <button style={{...S.btn("ghost"),fontSize:12}} onClick={()=>setEditingUser(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{ width:38, height:38, borderRadius:"50%", background:`linear-gradient(135deg,${ROLES[u.role]?.color||"#555"},#333)`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, flexShrink:0 }}>{u.avatar}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13,display:"flex",alignItems:"center",gap:6}}>{u.name} {u.googleLinked&&<span title="Google linked" style={{fontSize:12}}>🔗</span>}</div>
                    <div style={{color:"#555",fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                    <div style={{display:"flex",gap:5,marginTop:4,flexWrap:"wrap"}}>
                      <span style={S.badge(ROLES[u.role]?.color||"#555")}>{ROLES[u.role]?.label}</span>
                      <span style={S.badge("#64748b")}>{u.plan}</span>
                      <span style={S.badge(u.status==="active"?"#22c55e":"#ef4444")}>{u.status}</span>
                    </div>
                  </div>
                  {u.id !== currentUser.id && (
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      <button onClick={()=>setEditingUser({...u})} style={{background:"rgba(99,102,241,0.2)",border:"none",borderRadius:6,padding:"4px 10px",color:"#a5b4fc",cursor:"pointer",fontSize:11}}>Edit</button>
                      <button onClick={()=>toggleUserStatus(u.id)} style={{background:u.status==="active"?"rgba(239,68,68,0.15)":"rgba(34,197,94,0.15)",border:"none",borderRadius:6,padding:"4px 8px",color:u.status==="active"?"#ef4444":"#22c55e",cursor:"pointer",fontSize:11}}>{u.status==="active"?"Suspend":"Activate"}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {userMgmtTab==="add" && (
            <div style={S.card}>
              <div style={S.label}>New User</div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <input style={S.input()} placeholder="Full name" value={newUserData.name} onChange={e=>setNewUserData(p=>({...p,name:sanitize(e.target.value)}))}/>
                <input style={S.input()} placeholder="Email" value={newUserData.email} onChange={e=>setNewUserData(p=>({...p,email:sanitize(e.target.value)}))}/>
                <select style={{...S.input(),color:"#e2e8f0"}} value={newUserData.role} onChange={e=>setNewUserData(p=>({...p,role:e.target.value}))}>
                  {Object.entries(ROLES).map(([r,d])=><option key={r} value={r}>{d.label}</option>)}
                </select>
                <select style={{...S.input(),color:"#e2e8f0"}} value={newUserData.plan} onChange={e=>setNewUserData(p=>({...p,plan:e.target.value}))}>
                  {plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div style={{fontSize:11,color:"#555"}}>Temp password: Temp@1234 (user must change on first login)</div>
                <button style={S.btn("primary")} onClick={addUser}>Add User</button>
              </div>
            </div>
          )}
        </div>
      ) : <div style={{color:"#555",textAlign:"center",marginTop:40}}>Access denied</div>;

      case "plans": return (
        <div>
          <div style={S.label}>Pricing Plans {can(currentUser,"all")&&<span style={{color:"#f59e0b",fontWeight:400}}>(Owner — editable)</span>}</div>
          {plans.map(p=>(
            <div key={p.id} style={{...S.card,border:`1px solid ${p.color}33`}}>
              {editingPlan===p.id && can(currentUser,"all") ? (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <input style={S.input()} value={planDraft.name} onChange={e=>setPlanDraft(d=>({...d,name:sanitize(e.target.value)}))} placeholder="Plan name"/>
                  <input style={S.input()} type="number" value={planDraft.price} onChange={e=>setPlanDraft(d=>({...d,price:e.target.value}))} placeholder="Price (USD/mo)"/>
                  <textarea style={{...S.input(),resize:"vertical",minHeight:80}} value={planDraft.features.join("\n")} onChange={e=>setPlanDraft(d=>({...d,features:e.target.value.split("\n").filter(Boolean)}))} placeholder="Features (one per line)"/>
                  <div style={{display:"flex",gap:8}}>
                    <button style={{...S.btn("primary"),fontSize:12}} onClick={savePlan}>Save Plan</button>
                    <button style={{...S.btn("ghost"),fontSize:12}} onClick={()=>{setEditingPlan(null);setPlanDraft(null);}}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontWeight:700,fontSize:16,color:p.color}}>{p.name}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontWeight:700,color:p.color}}>{p.priceLabel}</span>
                      {can(currentUser,"all")&&<button onClick={()=>startEditPlan(p)} style={{background:"rgba(245,158,11,0.15)",border:"1px solid #f59e0b44",borderRadius:6,padding:"3px 10px",color:"#f59e0b",cursor:"pointer",fontSize:11}}>Edit</button>}
                    </div>
                  </div>
                  {p.features.map(f=><div key={f} style={{fontSize:12,color:"#777",padding:"3px 0"}}>✓ {f}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      );

      case "records": return (
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={S.label}>Call Recordings</div>
            <button onClick={fetchRecordings} style={{background:"rgba(99,102,241,0.2)",border:"1px solid #6366f144",borderRadius:8,padding:"5px 12px",color:"#a5b4fc",cursor:"pointer",fontSize:12}}>
              {recLoading?"Loading...":"↻ Refresh"}
            </button>
          </div>
          {recordings.length===0 && !recLoading && (
            <div style={{textAlign:"center",padding:30,color:"#444",fontSize:13}}>
              No recordings yet.<br/>
              <span style={{fontSize:11,color:"#333"}}>Enable recording in Settings, then make calls.</span>
            </div>
          )}
          {recordings.map(r=>{
            const dur = `${Math.floor(r.duration/60)}:${String(r.duration%60).padStart(2,"0")}`;
            const date = r.createdAt ? new Date(r.createdAt).toLocaleString() : "Unknown";
            const isPlaying = playingRec===r.id;
            return (
              <div key={r.id} style={{...S.card}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:40,height:40,borderRadius:"50%",background:"rgba(239,68,68,0.15)",border:"1px solid #ef444433",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <span style={{fontSize:16}}>🎙</span>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13}}>Call Recording</div>
                    <div style={{color:"#555",fontSize:11,marginTop:1}}>{date}</div>
                    <div style={{color:"#444",fontSize:11}}>Duration: {dur} · ID: {r.id.slice(0,8)}</div>
                  </div>
                </div>
                {/* Playback bar */}
                <div style={{marginTop:10,background:"rgba(255,255,255,0.04)",borderRadius:8,padding:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <button
                      onClick={()=>{
                        if(isPlaying){ audioRef.current?.pause(); setPlayingRec(null); return; }
                        if(!r.url){ alert("No URL — backend not connected yet."); return; }
                        setPlayingRec(r.id);
                        if(audioRef.current){ audioRef.current.src=`${API_URL}/api/recordings/${r.id}/download`; audioRef.current.play().catch(()=>setPlayingRec(null)); }
                      }}
                      style={{width:34,height:34,borderRadius:"50%",background:isPlaying?"#ef4444":"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",cursor:"pointer",color:"#fff",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      {isPlaying?"⏸":"▶"}
                    </button>
                    <div style={{flex:1,height:4,background:"rgba(255,255,255,0.08)",borderRadius:2}}>
                      <div style={{width:isPlaying?"40%":"0%",height:"100%",background:"#6366f1",borderRadius:2,transition:"width 0.3s"}}/>
                    </div>
                    <span style={{fontSize:11,color:"#555",flexShrink:0}}>{dur}</span>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <a
                      href={r.url?`${API_URL}/api/recordings/${r.id}/download`:"#"}
                      download={`recording-${r.id}.mp3`}
                      onClick={e=>{ if(!r.url){ e.preventDefault(); alert("Backend not connected — no URL available."); } }}
                      style={{flex:1,padding:"7px 0",borderRadius:8,background:"rgba(34,197,94,0.15)",border:"1px solid #22c55e33",color:"#22c55e",cursor:"pointer",fontSize:12,fontWeight:600,textAlign:"center",textDecoration:"none"}}>
                      ⬇ Download MP3
                    </a>
                    <button
                      onClick={()=>{ if(!r.url){ alert("Backend not connected."); return; } navigator.clipboard.writeText(`${API_URL}/api/recordings/${r.id}/download`); setAuthMsg("Link copied!"); }}
                      style={{padding:"7px 12px",borderRadius:8,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#888",cursor:"pointer",fontSize:12}}>
                      🔗 Copy Link
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <audio ref={audioRef} onEnded={()=>setPlayingRec(null)} style={{display:"none"}}/>
        </div>
      );

      case "settings": return can(currentUser,"manage_settings") ? (
        <div>
          <div style={S.label}>SIP / Twilio Configuration</div>
          <div style={S.card}>
            <div style={{fontSize:12,color:"#555",marginBottom:6}}>SIP Domain *</div>
            <input style={{...S.input(),marginBottom:10,borderColor:sipErr&&!sipDomain.includes(".")?"#ef4444":undefined}} value={sipDomain} onChange={e=>{setSipDomain(sanitize(e.target.value));setSipConnected(false);setSipErr("");}}/>
            <div style={{fontSize:12,color:"#555",marginBottom:6}}>SIP Username *</div>
            <input style={{...S.input(),marginBottom:10}} value={sipUser} onChange={e=>{setSipUser(sanitize(e.target.value));setSipConnected(false);setSipErr("");}} placeholder="e.g. your_account_sid"/>
            <div style={{fontSize:12,color:"#555",marginBottom:6}}>SIP Password *</div>
            <div style={{position:"relative",marginBottom:10}}>
              <input style={{...S.input(),paddingRight:44}} type={showSipPass?"text":"password"} value={sipPass} onChange={e=>{setSipPass(e.target.value);setSipConnected(false);setSipErr("");}} placeholder="SIP auth password"/>
              <button onClick={()=>setShowSipPass(v=>!v)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:15}}>{showSipPass?"🙈":"👁"}</button>
            </div>
            <div style={{fontSize:12,color:"#555",marginBottom:6}}>DID Number (Twilio) *</div>
            <input style={{...S.input(),marginBottom:12}} value={twilioNumber} onChange={e=>{setTwilioNumber(sanitizePhone(e.target.value));setSipConnected(false);setSipErr("");}} placeholder="+1 800 000 0000"/>

            {sipErr && <div style={{color:"#ef4444",fontSize:12,marginBottom:8,padding:"8px 12px",background:"rgba(239,68,68,0.08)",borderRadius:8}}>⚠ {sipErr}</div>}

            {sipConnecting && (
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,fontSize:13,color:"#6366f1"}}>
                <span style={{display:"inline-block",animation:"spin 1s linear infinite",fontSize:14}}>⟳</span>
                Connecting to SIP server...
              </div>
            )}

            <button style={{...S.btn(sipConnected?"danger":"primary")}} onClick={()=>{
              if(sipConnected){ setSipConnected(false); setSipErr(""); return; }
              if(!sipDomain.trim()||!sipDomain.includes(".")){setSipErr("Valid SIP domain required.");return;}
              if(!sipUser.trim()){setSipErr("SIP username required.");return;}
              if(!sipPass.trim()||sipPass.length<6){setSipErr("SIP password: min 6 chars.");return;}
              if(!twilioNumber.trim()||!twilioNumber.startsWith("+")){setSipErr("Number must start with +");return;}
              validateSIP();
            }}>
              {sipConnected?"Disconnect SIP":sipConnecting?"Verifying...":"Connect & Verify SIP"}
            </button>

            {sipConnected && (
              <div style={{marginTop:10,padding:"10px 14px",background:"rgba(34,197,94,0.08)",border:"1px solid #22c55e33",borderRadius:10}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",animation:"pulse 2s infinite"}}/>
                  <span style={{color:"#22c55e",fontWeight:600,fontSize:13}}>SIP Connected</span>
                </div>
                <div style={{fontSize:11,color:"#555"}}>Server: {sipDomain}</div>
                <div style={{fontSize:11,color:"#555"}}>DID: {twilioNumber}</div>
              </div>
            )}
          </div>
          <div style={S.label}>Access Controls</div>
          <div style={S.card}>
            {[
              {l:"Admin Can Record Calls",   v:adminRecord,       s:setAdminRecord},
              {l:"Agents Can Stop Recording",v:userStopRecord,    s:setUserStopRecord},
              {l:"Video Calling",            v:videoEnabled,      s:setVideoEnabled},
              {l:"Screen Sharing",           v:screenShareEnabled,s:setScreenShareEnabled},
            ].map(({l,v,s})=>(
              <div key={l} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                <span style={{fontSize:13}}>{l}</span>
                <button style={S.toggle(v)} onClick={()=>s(x=>!x)}>
                  <div style={{position:"absolute",top:3,left:v?20:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left 0.3s"}}/>
                </button>
              </div>
            ))}
          </div>
          <div style={S.label}>IVR / Auto-Attendant Routes</div>
          <div style={S.card}>
            {ivrRoutes.map(r=>(
              <div key={r.id}>
                {editingIvr===r.id ? (
                  <div style={{display:"flex",flexDirection:"column",gap:8,padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
                    <div style={{fontSize:11,color:"#555",marginBottom:2}}>Menu Label (e.g. "Sales")</div>
                    <input style={S.input()} value={ivrDraft.label} onChange={e=>setIvrDraft(d=>({...d,label:sanitize(e.target.value)}))} placeholder="Label"/>
                    <div style={{fontSize:11,color:"#555"}}>Extension Number</div>
                    <input style={S.input()} value={ivrDraft.ext} onChange={e=>setIvrDraft(d=>({...d,ext:sanitize(e.target.value)}))} placeholder="e.g. 101" maxLength={4}/>
                    <div style={{fontSize:11,color:"#555"}}>Action</div>
                    <select style={{...S.input(),color:"#e2e8f0"}} value={ivrDraft.action} onChange={e=>setIvrDraft(d=>({...d,action:e.target.value}))}>
                      <option value="ring_group">Ring Group (forward to number)</option>
                      <option value="voicemail">Voicemail</option>
                      <option value="queue">Call Queue</option>
                      <option value="announcement">Play Announcement</option>
                    </select>
                    <div style={{fontSize:11,color:"#555"}}>Destination (number or email)</div>
                    <input style={S.input()} value={ivrDraft.dest} onChange={e=>setIvrDraft(d=>({...d,dest:sanitize(e.target.value)}))} placeholder="e.g. +923001234567"/>
                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      <button style={{...S.btn("primary"),fontSize:12}} onClick={()=>{setIvrRoutes(prev=>prev.map(x=>x.id===r.id?{...x,...ivrDraft}:x));setEditingIvr(null);setIvrDraft(null);}}>Save Route</button>
                      <button style={{...S.btn("ghost"),fontSize:12}} onClick={()=>{setEditingIvr(null);setIvrDraft(null);}}>Cancel</button>
                      <button style={{...S.btn("danger"),fontSize:12,width:"auto",padding:"10px 14px"}} onClick={()=>{setIvrRoutes(prev=>prev.filter(x=>x.id!==r.id));setEditingIvr(null);}}>Delete</button>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                    <div>
                      <div style={{fontSize:13,color:"#e2e8f0",fontWeight:600}}>Press {r.ext} → {r.label}</div>
                      <div style={{fontSize:11,color:"#555",marginTop:2}}>{r.action==="ring_group"?"Forward to":r.action==="voicemail"?"Voicemail:":r.action==="queue"?"Queue:":"Announcement:"} {r.dest||"—"}</div>
                    </div>
                    <button onClick={()=>{setEditingIvr(r.id);setIvrDraft({...r});}} style={{background:"rgba(99,102,241,0.2)",border:"1px solid #6366f144",borderRadius:7,padding:"5px 12px",color:"#a5b4fc",cursor:"pointer",fontSize:11,fontWeight:600}}>Edit</button>
                  </div>
                )}
              </div>
            ))}

            {addingIvr ? (
              <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.08)"}}>
                <div style={{fontSize:12,color:"#888",fontWeight:600}}>New Route</div>
                <input style={S.input()} value={newIvr.label} onChange={e=>setNewIvr(d=>({...d,label:sanitize(e.target.value)}))} placeholder="Label (e.g. Billing)"/>
                <input style={S.input()} value={newIvr.ext} onChange={e=>setNewIvr(d=>({...d,ext:sanitize(e.target.value)}))} placeholder="Extension (e.g. 104)" maxLength={4}/>
                <select style={{...S.input(),color:"#e2e8f0"}} value={newIvr.action} onChange={e=>setNewIvr(d=>({...d,action:e.target.value}))}>
                  <option value="ring_group">Ring Group</option>
                  <option value="voicemail">Voicemail</option>
                  <option value="queue">Call Queue</option>
                  <option value="announcement">Announcement</option>
                </select>
                <input style={S.input()} value={newIvr.dest} onChange={e=>setNewIvr(d=>({...d,dest:sanitize(e.target.value)}))} placeholder="Destination number or email"/>
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.btn("primary"),fontSize:12}} onClick={()=>{if(!newIvr.label||!newIvr.ext)return;setIvrRoutes(prev=>[...prev,{id:Date.now(),...newIvr}]);setNewIvr({label:"",ext:"",action:"ring_group",dest:""});setAddingIvr(false);}}>Add Route</button>
                  <button style={{...S.btn("ghost"),fontSize:12}} onClick={()=>{setAddingIvr(false);setNewIvr({label:"",ext:"",action:"ring_group",dest:""});}}>Cancel</button>
                </div>
              </div>
            ) : (
              <button style={{...S.btn("ghost"),marginTop:10,fontSize:12}} onClick={()=>setAddingIvr(true)}>+ Add New Route</button>
            )}
          </div>
        </div>
      ) : <div style={{color:"#555",textAlign:"center",marginTop:40}}>Access denied</div>;

      case "profile": return (
        <div>
          <div style={{ textAlign:"center", padding:"10px 0 20px" }}>
            <div style={{ width:72, height:72, borderRadius:"50%", background:`linear-gradient(135deg,${ROLES[currentUser.role]?.color||"#555"},#333)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, fontWeight:700, margin:"0 auto 10px" }}>{currentUser.avatar}</div>
            <div style={{fontWeight:700,fontSize:18}}>{currentUser.name}</div>
            <div style={{color:"#555",fontSize:13}}>{currentUser.email}</div>
            <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:8,flexWrap:"wrap"}}>
              <span style={S.badge(ROLES[currentUser.role]?.color||"#555")}>{ROLES[currentUser.role]?.label}</span>
              <span style={S.badge("#64748b")}>{currentUser.plan}</span>
              {currentUser.googleLinked&&<span style={S.badge("#22c55e")}>Google Linked</span>}
            </div>
          </div>

          {authMsg&&<div style={{background:"rgba(34,197,94,0.12)",border:"1px solid #22c55e44",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#22c55e",marginBottom:12}}>✓ {authMsg}</div>}

          {editingProfile ? (
            <div style={S.card}>
              <div style={S.label}>Edit Profile</div>
              {authErr&&<div style={{...S.err,marginBottom:8}}>⚠ {authErr}</div>}
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <input style={S.input()} value={profileName} onChange={e=>setProfileName(sanitize(e.target.value))} placeholder="Full name"/>
                <input style={S.input()} type="password" value={profilePass} onChange={e=>setProfilePass(e.target.value)} placeholder="New password (leave blank to keep)"/>
                {profilePass&&<input style={S.input()} type="password" value={profilePass2} onChange={e=>setProfilePass2(e.target.value)} placeholder="Confirm new password"/>}
                <button style={S.btn("primary")} onClick={handleSaveProfile}>Save Changes</button>
                <button style={S.btn("ghost")} onClick={()=>{setEditingProfile(false);setAuthErr("");}}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={S.card}>
              <div style={S.label}>Account</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <button style={S.btn("ghost")} onClick={()=>{setEditingProfile(true);setProfileName(currentUser.name);setAuthErr("");setAuthMsg("");}}>✏ Edit Name & Password</button>
                {!currentUser.googleLinked
                  ? <button style={{...S.btn("ghost"),display:"flex",alignItems:"center",justifyContent:"center",gap:8,border:"1px solid rgba(255,255,255,0.12)"}} onClick={linkGoogle}><span style={{fontSize:15}}>G</span> Link Google Account</button>
                  : <div style={{textAlign:"center",fontSize:13,color:"#22c55e",padding:8}}>✓ Google account linked</div>
                }
                <button style={S.btn("danger")} onClick={handleLogout}>Sign Out</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={S.label}>Security Info</div>
            <div style={{fontSize:12,color:"#555",lineHeight:1.8}}>
              Member since: {currentUser.createdAt}<br/>
              Last login: Just now<br/>
              2FA: Not enabled<br/>
              Sessions: 1 active
            </div>
          </div>

          <div style={S.card}>
            <div style={S.label}>Your Permissions</div>
            {(ROLES[currentUser.role]?.perms||[]).map(p=>(
              <div key={p} style={{fontSize:12,color:"#22c55e",padding:"3px 0"}}>✓ {p.replace(/_/g," ")}</div>
            ))}
          </div>
        </div>
      );

      default: return null;
    }
  };

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.logo}>VoiceLink Pro</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {/* SIP + Network indicator */}
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{display:"flex",alignItems:"flex-end",gap:1,height:14}}>
              {[1,2,3,4].map(i=>(
                <div key={i} style={{width:3,borderRadius:1,height:3+i*2.5,background:sipConnected?(i<=2?"#22c55e":i===3?"#22c55e":"#22c55e"):"#333",transition:"background 0.3s"}}/>
              ))}
            </div>
            <span style={{fontSize:10,color:sipConnected?"#22c55e":"#ef4444",fontWeight:600}}>{sipConnected?"SIP":"OFF"}</span>
          </div>
          <span style={S.badge(ROLES[currentUser?.role]?.color||"#555")}>{ROLES[currentUser?.role]?.label}</span>
          <div onClick={()=>setTab("profile")} style={{ width:32, height:32, borderRadius:"50%", background:`linear-gradient(135deg,${ROLES[currentUser?.role]?.color||"#555"},#333)`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, cursor:"pointer" }}>{currentUser?.avatar}</div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:18 }}>{renderTab()}</div>

      <nav style={S.nav}>
        {visibleTabs.map(t=>(
          <button key={t.id} style={S.navB(tab===t.id)} onClick={()=>{setTab(t.id);setAuthErr("");setAuthMsg("");}}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon}/>
            </svg>
            {t.label}
          </button>
        ))}
      </nav>

      {activeCall&&<ActiveCall contact={activeCall} onEnd={endRealCall} callStatus={callStatus} currentUser={currentUser}/>}
    </div>
  );
}
