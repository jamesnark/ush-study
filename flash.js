/* Shared flashcard engine: prompt-on-front, click-to-flip, gap notes synced across devices. */
(function(){
const SB_URL='https://qfgvtrifvgtttvlaspqn.supabase.co';
const SB_KEY='sb_publishable_H3HI2vdy2okpATAjXR75Kw_LcGHFblP';
const ROW='james_study';
const H=()=>({apikey:SB_KEY,Authorization:'Bearer '+SB_KEY,'Content-Type':'application/json'});

let GAPS={};                       /* "deck|term" -> {note, at} */
let synced=false, pushT=null;
const cacheGet=()=>{try{return JSON.parse(localStorage.getItem('flash.gaps'))||{}}catch(e){return {}}};
const cacheSet=()=>localStorage.setItem('flash.gaps',JSON.stringify(GAPS));

async function pull(){
  try{
    const r=await fetch(SB_URL+'/rest/v1/hub_state?id=eq.'+ROW+'&select=data',{headers:H(),cache:'no-store'});
    if(!r.ok)throw 0;
    const j=await r.json();
    const remote=(j[0]&&j[0].data&&j[0].data.gaps)||{};
    GAPS=Object.assign({},remote,GAPS);
    cacheSet();synced=true;
  }catch(e){synced=false}
}
function push(){
  clearTimeout(pushT);cacheSet();
  pushT=setTimeout(async()=>{
    try{await fetch(SB_URL+'/rest/v1/hub_state?on_conflict=id',{method:'POST',
      headers:Object.assign(H(),{Prefer:'resolution=merge-duplicates,return=minimal'}),
      body:JSON.stringify({id:ROW,data:{gaps:GAPS},updated_at:new Date().toISOString()})});
      synced=true;}catch(e){synced=false}
    const b=document.querySelector('.fsync');if(b)b.textContent=synced?'saved':'saved on this device';
  },600);
}

const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function mount(opts){
  const host=opts.host, cards=opts.cards, deck=opts.deckId;
  const key=c=>deck+'|'+c.t;
  let list=[],pos=0,known=new Set(),flipped=false;

  const sections=[...new Set(cards.map(c=>c.s))];
  host.innerHTML=
   '<div class="bar">'
   +'<select class="fsel"><option value="all">All topics ('+cards.length+')</option>'
   +'<option value="__gaps">Just my gaps</option>'
   +sections.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('')+'</select>'
   +'<button class="btn fshuf">Shuffle</button><button class="btn freset">Reset</button>'
   +'<span class="stat">Known <b class="fk">0</b> &middot; Left <b class="fl">0</b></span></div>'
   +'<div class="prog"><i class="fbar"></i></div>'
   +'<div class="fcard" style="cursor:pointer">'
     +'<div class="tag"><span class="ftag"></span><span class="fgap"></span></div>'
     +'<div class="term fterm"></div>'
     +'<div class="fask"></div>'
     +'<div class="hint hidden fhint"></div>'
     +'<div class="defn hidden fdef"></div>'
     +'<div class="ftapnote">tap the card to flip</div>'
   +'</div>'
   +'<div class="row"><button class="btn fhintb">Hint</button>'
   +'<button class="btn fagain">Review again</button>'
   +'<button class="btn primary fgot">I knew it &rarr;</button></div>'
   +'<div class="fnotewrap"><label class="fnlabel">What did you miss on this one? <span class="tiny">(optional &mdash; it gets saved and you can re-drill just these)</span></label>'
   +'<textarea class="fnote" rows="2" placeholder="e.g. knew the dates, blanked on why Saratoga mattered"></textarea>'
   +'<div class="frow2"><button class="btn sm fsave">Save gap</button><button class="btn sm fclear">Clear gap</button><span class="tiny fsync"></span></div></div>';

  const q=s=>host.querySelector(s);
  function build(){
    const v=q('.fsel').value;
    if(v==='__gaps')list=cards.filter(c=>GAPS[key(c)]);
    else list=cards.filter(c=>v==='all'||c.s===v);
    /* things you flagged come first */
    list.sort((a,b)=>(GAPS[key(b)]?1:0)-(GAPS[key(a)]?1:0));
    pos=0;known.clear();draw();
  }
  function draw(){
    const n=cards.filter(c=>GAPS[key(c)]).length;
    const opt=q('.fsel').querySelector('option[value="__gaps"]');
    opt.textContent='Just my gaps ('+n+')';opt.disabled=n===0;
    if(!list.length){q('.fterm').textContent='Nothing here yet';q('.fask').innerHTML='';
      q('.ftag').textContent='';q('.fdef').innerHTML='';q('.fnote').value='';return}
    if(pos>=list.length)pos=0;
    const c=list[pos],g=GAPS[key(c)];
    flipped=false;
    q('.ftag').textContent=c.s+'  —  '+(pos+1)+' / '+list.length;
    q('.fgap').innerHTML=g?' <span class="gapbadge">flagged</span>':'';
    q('.fterm').innerHTML=c.t;
    q('.fask').innerHTML=c.a?'<div class="asklabel">Say out loud:</div><ul class="asklist">'
      +(Array.isArray(c.a)?c.a:[c.a]).map(x=>'<li>'+x+'</li>').join('')+'</ul>':'';
    q('.fhint').innerHTML=c.h||'';
    q('.fdef').innerHTML=c.d;
    q('.fdef').classList.add('hidden');q('.fhint').classList.add('hidden');
    q('.ftapnote').textContent='tap the card to flip';
    q('.fnote').value=g?g.note:'';
    q('.fk').textContent=known.size;q('.fl').textContent=list.length-known.size;
    q('.fbar').style.width=(list.length?known.size/list.length*100:0)+'%';
    q('.fsync').textContent='';
  }
  function flip(){
    flipped=!flipped;
    q('.fdef').classList.toggle('hidden',!flipped);
    q('.ftapnote').textContent=flipped?'tap again to hide':'tap the card to flip';
  }
  q('.fcard').onclick=e=>{if(e.target.closest('textarea,button,a'))return;flip()};
  q('.fhintb').onclick=e=>{e.stopPropagation();q('.fhint').classList.toggle('hidden')};
  q('.fgot').onclick=()=>{known.add(list[pos].t);pos++;draw()};
  q('.fagain').onclick=()=>{const c=list.splice(pos,1)[0];list.push(c);draw()};
  q('.fshuf').onclick=()=>{list.sort(()=>Math.random()-.5);pos=0;draw()};
  q('.freset').onclick=build;
  q('.fsel').onchange=build;
  q('.fsave').onclick=()=>{
    const c=list[pos];if(!c)return;
    const v=q('.fnote').value.trim();
    if(!v){delete GAPS[key(c)]}else{GAPS[key(c)]={note:v,at:new Date().toISOString(),term:c.t,deck:deck}}
    push();q('.fsync').textContent='saving…';draw();
  };
  q('.fclear').onclick=()=>{const c=list[pos];if(!c)return;delete GAPS[key(c)];q('.fnote').value='';push();q('.fsync').textContent='cleared';draw()};

  build();
  pull().then(()=>draw());
  return {rebuild:build};
}

const CSS=`
.fcard{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px 20px;min-height:200px;
 display:flex;flex-direction:column;justify-content:center;transition:border-color .15s;position:relative}
.fcard:hover{border-color:#3a4150}
.fcard .tag{display:flex;align-items:center;gap:8px}
.gapbadge{background:rgba(255,176,32,.16);color:var(--warn);border-radius:20px;padding:2px 9px;font-size:10px;letter-spacing:.4px}
.asklabel{margin-top:14px;font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--accent);font-weight:600}
.asklist{margin:6px 0 0;padding-left:18px;color:#cdd4e0;font-size:14px}
.asklist li{margin:3px 0}
.ftapnote{position:absolute;bottom:9px;left:0;right:0;text-align:center;font-size:10.5px;color:var(--dim);opacity:.65;letter-spacing:.3px}
.fnotewrap{margin-top:14px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.fnlabel{display:block;font-size:12.5px;color:var(--dim);margin-bottom:7px}
.fnote{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;
 padding:8px 10px;font:inherit;font-size:13.5px;resize:vertical}
.fnote:focus{outline:none;border-color:var(--accent)}
.frow2{display:flex;gap:7px;align-items:center;margin-top:7px}
.btn.sm{padding:4px 10px;font-size:12px}
.tiny{font-size:11px;color:var(--dim)}
`;
const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);

GAPS=cacheGet();
window.Flash={mount:mount,gaps:()=>GAPS,pull:pull};
})();
