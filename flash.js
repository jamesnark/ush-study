/* Shared flashcards + practice test engine.
   Flashcards: recall prompt on the front, tap to flip, gap notes synced across devices.
   Quiz: distractors drawn from the SAME category, and the answer is blanked out of the prompt. */
(function(){
const SB_URL='https://qfgvtrifvgtttvlaspqn.supabase.co';
const SB_KEY='sb_publishable_H3HI2vdy2okpATAjXR75Kw_LcGHFblP';
const ROW='james_study';
const H=()=>({apikey:SB_KEY,Authorization:'Bearer '+SB_KEY,'Content-Type':'application/json'});

let GAPS={}, STATS={}, pushT=null;
const cacheGet=()=>{try{return JSON.parse(localStorage.getItem('flash.gaps'))||{}}catch(e){return {}}};
const statGet=()=>{try{return JSON.parse(localStorage.getItem('flash.stats'))||{}}catch(e){return {}}};
const cacheSet=()=>{localStorage.setItem('flash.gaps',JSON.stringify(GAPS));localStorage.setItem('flash.stats',JSON.stringify(STATS))};
/* merge stats by trusting whichever side has seen the question more often */
function mergeStats(a,b){
  const out=Object.assign({},a);
  for(const k in b){
    const x=out[k],y=b[k];
    if(!x||((y.right+y.wrong)>(x.right+x.wrong)))out[k]=y;
  }
  return out;
}
async function pull(){
  try{
    const r=await fetch(SB_URL+'/rest/v1/hub_state?id=eq.'+ROW+'&select=data',{headers:H(),cache:'no-store'});
    if(!r.ok)throw 0;
    const j=await r.json(), d=(j[0]&&j[0].data)||{};
    GAPS=Object.assign({},d.gaps||{},GAPS);
    STATS=mergeStats(STATS,d.stats||{});
    cacheSet();
  }catch(e){}
}
function push(){
  clearTimeout(pushT);cacheSet();
  pushT=setTimeout(()=>{
    fetch(SB_URL+'/rest/v1/hub_state?on_conflict=id',{method:'POST',
      headers:Object.assign(H(),{Prefer:'resolution=merge-duplicates,return=minimal'}),
      body:JSON.stringify({id:ROW,data:{gaps:GAPS,stats:STATS},updated_at:new Date().toISOString()})}).catch(()=>{});
  },600);
}

/* ===================== PER-QUESTION STATS ===================== */
function stat(sk){return STATS[sk]||null}
function record(sk,label,ok){
  const s=STATS[sk]||{right:0,wrong:0,streak:0,label:label,hist:[]};
  s.label=label||s.label;
  if(ok){s.right++;s.streak=Math.max(0,s.streak)+1}else{s.wrong++;s.streak=0}
  s.last=new Date().toISOString();
  s.hist=(s.hist||[]).concat(ok?1:0).slice(-12);
  STATS[sk]=s;push();
}
function accOf(s){const n=s.right+s.wrong;return n?s.right/n:0}
/* New -> Learning -> Solid -> Mastered. Mastered ones are shown far less often. */
function statusOf(sk){
  const s=stat(sk);
  if(!s||(s.right+s.wrong)===0)return{k:'new',label:'Not seen yet'};
  if(s.streak>=5&&accOf(s)>=0.8)return{k:'mastered',label:'Mastered — rarely shown'};
  if(s.streak>=3)return{k:'solid',label:'Solid — shown less often'};
  if(accOf(s)<0.5)return{k:'weak',label:'Struggling — shown more often'};
  return{k:'learning',label:'Learning'};
}
/* how likely this question is to appear in the next test */
function weightOf(sk){
  const s=stat(sk);
  if(!s||(s.right+s.wrong)===0)return 3;
  let w=3;
  if(s.streak>=1)w=2;
  if(s.streak>=2)w=1.2;
  if(s.streak>=3)w=0.4;
  if(s.streak>=5)w=0.12;
  if(accOf(s)<0.5)w=Math.max(w,4.5);
  if(s.last){const days=(Date.now()-new Date(s.last).getTime())/864e5;if(days>3)w*=2.2}
  return w;
}
function weightedPick(items,skOf,n){
  const pool=items.slice(),out=[];
  while(out.length<n&&pool.length){
    const ws=pool.map(x=>weightOf(skOf(x)));
    let total=ws.reduce((a,b)=>a+b,0),r=Math.random()*total,i=0;
    while(i<pool.length&&(r-=ws[i])>0)i++;
    if(i>=pool.length)i=pool.length-1;
    out.push(pool.splice(i,1)[0]);
  }
  return out;
}
function statPanel(sk){
  const s=stat(sk),st=statusOf(sk);
  if(!s)return '<div class="qstats"><b>'+st.label+'</b><div class="tiny">No attempts recorded yet.</div></div>';
  const n=s.right+s.wrong;
  const dots=(s.hist||[]).map(h=>'<i class="hd '+(h?'g':'r')+'"></i>').join('');
  return '<div class="qstats"><div class="qsrow"><b>'+esc(s.label||'')+'</b><span class="badge '+st.k+'">'+st.label+'</span></div>'
   +'<div class="qsgrid">'
   +'<div><span>'+n+'</span>seen</div>'
   +'<div><span style="color:var(--good)">'+s.right+'</span>right</div>'
   +'<div><span style="color:var(--bad)">'+s.wrong+'</span>wrong</div>'
   +'<div><span>'+Math.round(accOf(s)*100)+'%</span>accuracy</div>'
   +'<div><span>'+s.streak+'</span>streak</div></div>'
   +(dots?'<div class="tiny" style="margin-top:7px">recent: '+dots+'</div>':'')
   +(s.last?'<div class="tiny">last seen '+new Date(s.last).toLocaleString()+'</div>':'')
   +'<div style="margin-top:7px"><button class="btn sm qsreset">Reset this question</button></div></div>';
}
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const esc2=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function stripTags(h){
  const d=document.createElement('div');
  d.innerHTML=String(h).replace(/<(br|\/li|\/p|\/div|\/ul|li)[^>]*>/gi,' $& ');
  return (d.textContent||'').replace(/\s+/g,' ').replace(/\s+([.,;:])/g,'$1').trim();
}
/* stop the sentence splitter from breaking B.C., A.D., U.S. and friends */
const ABBR=/\b(B\.C\.E\.|B\.C\.|A\.D\.|C\.E\.|U\.S\.A\.|U\.S\.|Mr\.|Mrs\.|Ms\.|Dr\.|St\.|Ch\.|No\.|vs\.|e\.g\.|i\.e\.|approx\.)/g;
const hide=t=>t.replace(ABBR,m=>m.replace(/\./g,'\u0001'));
const show=t=>t.replace(/\u0001/g,'.');
function firstSents(h,n){
  const t=hide(stripTags(h));const p=t.match(/[^.!?]+[.!?]+/g);
  if(!p)return show(t).slice(0,200);
  return show(p.slice(0,n||1).join(' ').trim());
}
/* keep adding sentences until the option is substantial enough to be a real choice,
   otherwise you get answers like "1767." next to a full paragraph and it's a giveaway */
function snippet(h,minLen,maxLen){
  const t=hide(stripTags(h));const p=t.match(/[^.!?]+[.!?]+/g)||[t];
  let out='';
  for(let i=0;i<p.length;i++){
    out=(out+' '+p[i]).trim();
    if(out.length>=(minLen||80))break;
  }
  if(out.length<(minLen||80)&&t.length>out.length)out=t;
  const mx=maxLen||210;
  if(out.length>mx)out=out.slice(0,mx).replace(/\s+\S*$/,'')+'\u2026';
  return show(out);
}
/* blank the answer out of the prompt so it can't give itself away */
function scrub(text,term,light){
  let out=text;const plain=stripTags(term);
  out=out.replace(new RegExp(esc2(plain),'ig'),'_____');
  /* light mode only removes the exact name. full mode also removes its distinctive words,
     which is right when the term is the answer but shreds readability when it isn't */
  if(!light)plain.split(/[\s/]+/).forEach(w=>{
    const bare=w.replace(/[^A-Za-z0-9]/g,'');
    if(bare.length>4)out=out.replace(new RegExp('\\b'+esc2(bare)+'(s|es|ing)?\\b','ig'),'_____');
  });
  return out.replace(/(_____[\s,]*){2,}/g,'_____ ');
}

/* ===================== FLASHCARDS ===================== */
function mount(opts){
  const host=opts.host, cards=opts.cards, deck=opts.deckId;
  const key=c=>deck+'|'+c.t;
  let list=[],pos=0,known=new Set(),flipped=false;
  const sections=[...new Set(cards.map(c=>c.s))];
  host.innerHTML=
   '<div class="bar"><select class="fsel"><option value="all">All topics ('+cards.length+')</option>'
   +'<option value="__gaps">Just my gaps</option>'
   +sections.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('')+'</select>'
   +'<button class="btn fshuf">Shuffle</button><button class="btn freset">Reset</button>'
   +'<span class="stat">Known <b class="fk">0</b> &middot; Left <b class="fl">0</b></span></div>'
   +'<div class="prog"><i class="fbar"></i></div>'
   +'<div class="fcard"><div class="tag"><span class="ftag"></span><span class="fgap"></span></div>'
     +'<div class="term fterm"></div><div class="fask"></div>'
     +'<div class="hint hidden fhint"></div><div class="defn hidden fdef"></div>'
     +'<div class="ftapnote">tap the card to flip</div></div>'
   +'<div class="row"><button class="btn fhintb">Hint</button>'
   +'<button class="btn fagain">Review again</button>'
   +'<button class="btn primary fgot">I knew it &rarr;</button></div>'
   +'<div class="fnotewrap"><label class="fnlabel">What did you miss on this one? <span class="tiny">(optional &mdash; saved, and you can re-drill just these)</span></label>'
   +'<textarea class="fnote" rows="2" placeholder="e.g. knew the dates, blanked on why Saratoga mattered"></textarea>'
   +'<div class="frow2"><button class="btn sm fsave">Save gap</button><button class="btn sm fclear">Clear gap</button><span class="tiny fsync"></span></div></div>';
  const q=s=>host.querySelector(s);
  function build(){
    const v=q('.fsel').value;
    list=(v==='__gaps')?cards.filter(c=>GAPS[key(c)]):cards.filter(c=>v==='all'||c.s===v);
    list.sort((a,b)=>(GAPS[key(b)]?1:0)-(GAPS[key(a)]?1:0));
    pos=0;known.clear();draw();
  }
  function draw(){
    const n=cards.filter(c=>GAPS[key(c)]).length;
    const o=q('.fsel').querySelector('option[value="__gaps"]');
    o.textContent='Just my gaps ('+n+')';o.disabled=n===0;
    if(!list.length){q('.fterm').textContent='Nothing flagged yet';q('.fask').innerHTML='';q('.ftag').textContent='';
      q('.fdef').innerHTML='';q('.fnote').value='';return}
    if(pos>=list.length)pos=0;
    const c=list[pos],g=GAPS[key(c)];flipped=false;
    q('.ftag').textContent=c.s+'  —  '+(pos+1)+' / '+list.length;
    q('.fgap').innerHTML=g?' <span class="gapbadge">flagged</span>':'';
    q('.fterm').innerHTML=c.t;
    q('.fask').innerHTML=c.a?'<div class="asklabel">Say out loud:</div><ul class="asklist">'
      +(Array.isArray(c.a)?c.a:[c.a]).map(x=>'<li>'+x+'</li>').join('')+'</ul>':'';
    q('.fhint').innerHTML=c.h||'';q('.fdef').innerHTML=c.d;
    q('.fdef').classList.add('hidden');q('.fhint').classList.add('hidden');
    q('.ftapnote').textContent='tap the card to flip';
    q('.fnote').value=g?g.note:'';
    q('.fk').textContent=known.size;q('.fl').textContent=list.length-known.size;
    q('.fbar').style.width=(list.length?known.size/list.length*100:0)+'%';
    q('.fsync').textContent='';
  }
  q('.fcard').onclick=e=>{if(e.target.closest('textarea,button,a'))return;
    flipped=!flipped;q('.fdef').classList.toggle('hidden',!flipped);
    q('.ftapnote').textContent=flipped?'tap again to hide':'tap the card to flip'};
  q('.fhintb').onclick=e=>{e.stopPropagation();q('.fhint').classList.toggle('hidden')};
  q('.fgot').onclick=()=>{known.add(list[pos].t);pos++;draw()};
  q('.fagain').onclick=()=>{const c=list.splice(pos,1)[0];list.push(c);draw()};
  q('.fshuf').onclick=()=>{list.sort(()=>Math.random()-.5);pos=0;draw()};
  q('.freset').onclick=build;
  q('.fsel').onchange=build;
  q('.fsave').onclick=()=>{const c=list[pos];if(!c)return;const v=q('.fnote').value.trim();
    if(!v)delete GAPS[key(c)];else GAPS[key(c)]={note:v,at:new Date().toISOString(),term:c.t,deck:deck};
    push();q('.fsync').textContent='saved';draw()};
  q('.fclear').onclick=()=>{const c=list[pos];if(!c)return;delete GAPS[key(c)];q('.fnote').value='';push();q('.fsync').textContent='cleared';draw()};
  build();pull().then(draw);
}

/* ===================== PRACTICE TEST ===================== */
function pickDistractors(card,pool,n){
  const same=pool.filter(c=>c.t!==card.t&&c.cat&&card.cat&&c.cat===card.cat).sort(()=>Math.random()-.5);
  const out=same.slice(0,n);
  if(out.length<n){
    const rest=pool.filter(c=>c.t!==card.t&&out.indexOf(c)<0).sort(()=>Math.random()-.5);
    out.push.apply(out,rest.slice(0,n-out.length));
  }
  return out;
}
function quiz(opts){
  const host=opts.host, cards=opts.cards, deck=opts.deckId, N=opts.count||20;
  const key=c=>deck+'|'+c.t;
  const extrasFn=opts.extras||null;   /* () => [{q, choices:[{label,right}], why}] */
  host.innerHTML='<div class="bar"><button class="btn primary qnew">New '+N+'-question test</button>'
   +'<label class="tiny"><input type="checkbox" class="qgapsonly" style="width:auto;margin-right:5px">only my flagged cards</label>'
   +'<label class="tiny"><input type="checkbox" class="qallin" style="width:auto;margin-right:5px">include mastered</label>'
   +'<span class="stat">Score <b class="qsc">0 / 0</b></span></div>'
   +'<div class="tiny qmeta" style="margin:-4px 0 10px"></div><div class="qbody"></div>';
  const q=s=>host.querySelector(s);
  let sc=0,dn=0;
  function build(){
    sc=0;dn=0;q('.qsc').textContent='0 / 0';
    let pool=cards.slice();
    if(q('.qgapsonly').checked){const g=cards.filter(c=>GAPS[key(c)]);if(g.length>=4)pool=g}
    const b=q('.qbody');b.innerHTML='';
    /* build a mixed question list: some from cards, some hand-generated */
    let items=[];
    const extras=(extrasFn&&!q('.qgapsonly').checked)?extrasFn():[];
    const nCards=Math.max(0,N-extras.length);
    /* drop questions you've already nailed repeatedly, unless you ask for them back */
    const allIn=q('.qallin').checked;
    const masteredList=pool.filter(c=>statusOf(key(c)).k==='mastered');
    let usable=allIn?pool:pool.filter(c=>statusOf(key(c)).k!=='mastered');
    const retired=masteredList.length;
    if(usable.length<Math.min(nCards,4))usable=pool;
    /* when you explicitly ask for mastered ones, weight everything evenly so they actually turn up */
    const picked=allIn
      ? usable.slice().sort(()=>Math.random()-.5).slice(0,Math.min(nCards,usable.length))
      : weightedPick(usable,c=>key(c),Math.min(nCards,usable.length));
    picked.forEach(c=>{items.push({kind:'card',card:c,reverse:Math.random()<0.45})});
    extras.forEach(x=>items.push({kind:'custom',x:x}));
    items=items.sort(()=>Math.random()-.5);
    q('.qmeta').innerHTML=allIn
      ? 'Showing everything, mastered included ('+retired+' mastered).'
      : (retired
        ? retired+' question'+(retired===1?'':'s')+' held back because you keep getting them right. Tick “include mastered” to see them.'
        : 'Questions you miss come back more often; ones you keep getting right fade out.');
    if(items.length<1){b.innerHTML='<div class="empty">Not enough cards for a test.</div>';return}
    items.forEach((it,i)=>{
      const div=document.createElement('div');div.className='q';
      let optEls,why,flagCard=null,sk,lbl;
      if(it.kind==='custom'){
        sk=deck+'|#'+(it.x.topic||'custom');lbl=it.x.topic||'Custom question';
        div.innerHTML='<h4>'+(i+1)+'. '+it.x.q+'</h4>';
        optEls=it.x.choices.map(o=>({label:o.label,right:!!o.right}));
        why=it.x.why;
      }else{
        sk=key(it.card);lbl=it.card.t;
        const c=it.card;flagCard=c;
        const wrong=pickDistractors(c,pool.length>=5?pool:cards,3);
        if(!it.reverse){
          div.innerHTML='<h4>'+(i+1)+'. '+esc(scrub(snippet(c.d,110,260),c.t))+'</h4>';
          optEls=[c].concat(wrong).sort(()=>Math.random()-.5).map(o=>({label:esc(o.t),right:o.t===c.t}));
        }else{
          div.innerHTML='<h4>'+(i+1)+'. Which of these is true of <b>'+esc(c.t)+'</b>?</h4>';
          optEls=[c].concat(wrong).sort(()=>Math.random()-.5)
            .map(o=>({label:esc(scrub(snippet(o.d,95,200),o.t,true)),right:o.t===c.t}));
        }
        why='<b>'+c.t+':</b> '+c.d;
      }
      /* corner button: per-question stats */
      const corner=document.createElement('button');
      corner.className='qstatbtn';corner.title='stats for this question';corner.innerHTML='&#9202;';
      const panel=document.createElement('div');panel.className='qspanel';panel.style.display='none';
      corner.onclick=()=>{
        if(panel.style.display==='none'){panel.innerHTML=statPanel(sk);panel.style.display='block';
          const rb=panel.querySelector('.qsreset');
          if(rb)rb.onclick=()=>{delete STATS[sk];push();panel.innerHTML=statPanel(sk);};
        }else panel.style.display='none';
      };
      div.appendChild(corner);div.appendChild(panel);
      const badge=statusOf(sk);
      if(badge.k!=='new'){const bg=document.createElement('span');bg.className='badge '+badge.k+' qinline';
        bg.textContent=badge.k;div.querySelector('h4').appendChild(bg)}
      optEls.forEach(o=>{
        const btn=document.createElement('button');btn.className='opt';btn.innerHTML=o.label;
        btn.onclick=()=>{
          if(div.dataset.done)return;div.dataset.done='1';
          [].forEach.call(div.querySelectorAll('.opt'),x=>{x.disabled=true});
          if(!o.right)btn.classList.add('wrong');
          const idx=optEls.map(z=>!!z.right).indexOf(true);
          div.querySelectorAll('.opt')[idx].classList.add('right');
          if(o.right)sc++;dn++;q('.qsc').textContent=sc+' / '+dn;
          record(sk,lbl,!!o.right);
          const nb=div.querySelector('.qinline'),ns=statusOf(sk);
          if(nb){nb.className='badge '+ns.k+' qinline';nb.textContent=ns.k}
          if(panel.style.display!=='none')panel.innerHTML=statPanel(sk);
          const w=document.createElement('div');w.className='why';
          w.innerHTML=why+((!o.right&&flagCard)?'<div style="margin-top:7px"><button class="btn sm qflag">Flag this for re-drill</button></div>':'');
          div.appendChild(w);
          const fb=w.querySelector('.qflag');
          if(fb)fb.onclick=()=>{GAPS[key(flagCard)]={note:'got this wrong on a practice test',at:new Date().toISOString(),term:flagCard.t,deck:deck};push();fb.textContent='flagged';fb.disabled=true};
        };
        div.appendChild(btn);
      });
      b.appendChild(div);
    });
  }
  q('.qnew').onclick=build;q('.qgapsonly').onchange=build;q('.qallin').onchange=build;
  build();pull().then(build);
}

const CSS='.fcard{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px 20px;min-height:200px;'
+'display:flex;flex-direction:column;justify-content:center;position:relative;cursor:pointer;transition:border-color .15s}'
+'.fcard:hover{border-color:#3a4150}'
+'.fcard .tag{display:flex;align-items:center;gap:8px}'
+'.gapbadge{background:rgba(255,176,32,.16);color:var(--warn);border-radius:20px;padding:2px 9px;font-size:10px;letter-spacing:.4px}'
+'.asklabel{margin-top:14px;font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--accent);font-weight:600}'
+'.asklist{margin:6px 0 0;padding-left:18px;color:#cdd4e0;font-size:14px}.asklist li{margin:3px 0}'
+'.ftapnote{position:absolute;bottom:9px;left:0;right:0;text-align:center;font-size:10.5px;color:var(--dim);opacity:.65}'
+'.fnotewrap{margin-top:14px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}'
+'.fnlabel{display:block;font-size:12.5px;color:var(--dim);margin-bottom:7px}'
+'.fnote{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px 10px;font:inherit;font-size:13.5px;resize:vertical}'
+'.fnote:focus{outline:none;border-color:var(--accent)}'
+'.frow2{display:flex;gap:7px;align-items:center;margin-top:7px}'
+'.btn.sm{padding:4px 10px;font-size:12px}'
+'.tiny{font-size:11px;color:var(--dim)}'
+'.q{position:relative}'
+'.qstatbtn{position:absolute;top:8px;right:8px;background:none;border:1px solid var(--line);color:var(--dim);'
+'border-radius:7px;width:26px;height:26px;cursor:pointer;font-size:13px;line-height:1;padding:0}'
+'.qstatbtn:hover{border-color:var(--accent);color:var(--accent)}'
+'.q h4{padding-right:34px}'
+'.qspanel{background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:11px 13px;margin:0 0 10px}'
+'.qsrow{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;font-size:13px}'
+'.qsgrid{display:flex;gap:14px;flex-wrap:wrap}'
+'.qsgrid div{font-size:10.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px}'
+'.qsgrid span{display:block;font-size:17px;color:var(--ink);text-transform:none;letter-spacing:0;font-weight:600}'
+'.badge{font-size:10px;padding:2px 8px;border-radius:20px;letter-spacing:.3px;white-space:nowrap}'
+'.badge.new{background:rgba(155,163,178,.15);color:var(--dim)}'
+'.badge.learning{background:rgba(91,140,255,.15);color:var(--accent)}'
+'.badge.weak{background:rgba(255,92,92,.15);color:var(--bad)}'
+'.badge.solid{background:rgba(62,207,142,.13);color:var(--good)}'
+'.badge.mastered{background:rgba(62,207,142,.2);color:var(--good)}'
+'.qinline{margin-left:8px;vertical-align:middle}'
+'.hd{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px}'
+'.hd.g{background:var(--good)}.hd.r{background:var(--bad)}';
const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);

GAPS=cacheGet();STATS=statGet();
window.Flash={mount:mount,quiz:quiz,gaps:function(){return GAPS},stats:function(){return STATS},
  statusOf:statusOf,weightOf:weightOf,pull:pull};
})();
