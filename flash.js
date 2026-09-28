/* Shared flashcards + practice test engine.
   Flashcards: recall prompt on the front, tap to flip, gap notes synced across devices.
   Quiz: distractors drawn from the SAME category, and the answer is blanked out of the prompt. */
(function(){
const SB_URL='https://qfgvtrifvgtttvlaspqn.supabase.co';
const SB_KEY='sb_publishable_H3HI2vdy2okpATAjXR75Kw_LcGHFblP';
const ROW='james_study';
const H=()=>({apikey:SB_KEY,Authorization:'Bearer '+SB_KEY,'Content-Type':'application/json'});

let GAPS={}, pushT=null;
const cacheGet=()=>{try{return JSON.parse(localStorage.getItem('flash.gaps'))||{}}catch(e){return {}}};
const cacheSet=()=>localStorage.setItem('flash.gaps',JSON.stringify(GAPS));
async function pull(){
  try{
    const r=await fetch(SB_URL+'/rest/v1/hub_state?id=eq.'+ROW+'&select=data',{headers:H(),cache:'no-store'});
    if(!r.ok)throw 0;
    const j=await r.json();
    GAPS=Object.assign({},(j[0]&&j[0].data&&j[0].data.gaps)||{},GAPS);
    cacheSet();
  }catch(e){}
}
function push(){
  clearTimeout(pushT);cacheSet();
  pushT=setTimeout(()=>{
    fetch(SB_URL+'/rest/v1/hub_state?on_conflict=id',{method:'POST',
      headers:Object.assign(H(),{Prefer:'resolution=merge-duplicates,return=minimal'}),
      body:JSON.stringify({id:ROW,data:{gaps:GAPS},updated_at:new Date().toISOString()})}).catch(()=>{});
  },600);
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
  const host=opts.host, cards=opts.cards, deck=opts.deckId, N=Math.min(opts.count||20,cards.length);
  const key=c=>deck+'|'+c.t;
  host.innerHTML='<div class="bar"><button class="btn primary qnew">New '+N+'-question test</button>'
   +'<label class="tiny"><input type="checkbox" class="qgapsonly" style="width:auto;margin-right:5px">only my flagged cards</label>'
   +'<span class="stat">Score <b class="qsc">0 / 0</b></span></div><div class="qbody"></div>';
  const q=s=>host.querySelector(s);
  let sc=0,dn=0;
  function build(){
    sc=0;dn=0;q('.qsc').textContent='0 / 0';
    let pool=cards.slice();
    if(q('.qgapsonly').checked){const g=cards.filter(c=>GAPS[key(c)]);if(g.length>=4)pool=g}
    const chosen=pool.slice().sort(()=>Math.random()-.5).slice(0,Math.min(N,pool.length));
    const b=q('.qbody');b.innerHTML='';
    if(chosen.length<4){b.innerHTML='<div class="empty">Not enough cards for a test.</div>';return}
    chosen.forEach((c,i)=>{
      const wrong=pickDistractors(c,pool.length>=5?pool:cards,3);
      const reverse=Math.random()<0.45;   /* mix both directions */
      const div=document.createElement('div');div.className='q';
      let optEls;
      if(!reverse){
        /* definition -> term */
        div.innerHTML='<h4>'+(i+1)+'. '+esc(scrub(snippet(c.d,110,260),c.t))+'</h4>';
        optEls=[c].concat(wrong).sort(()=>Math.random()-.5).map(o=>({label:esc(o.t),right:o.t===c.t}));
      }else{
        /* term -> which statement is true. every option is padded to a similar size
           so you can't spot the answer by length alone */
        div.innerHTML='<h4>'+(i+1)+'. Which of these is true of <b>'+esc(c.t)+'</b>?</h4>';
        optEls=[c].concat(wrong).sort(()=>Math.random()-.5)
          .map(o=>({label:esc(scrub(snippet(o.d,95,200),o.t,true)),right:o.t===c.t}));
      }
      optEls.forEach(o=>{
        const btn=document.createElement('button');btn.className='opt';btn.innerHTML=o.label;
        btn.onclick=()=>{
          if(div.dataset.done)return;div.dataset.done='1';
          [].forEach.call(div.querySelectorAll('.opt'),x=>{x.disabled=true});
          [].forEach.call(div.querySelectorAll('.opt'),x=>{if(x===btn&&!o.right)x.classList.add('wrong')});
          const idx=optEls.findIndex(z=>z.right);
          div.querySelectorAll('.opt')[idx].classList.add('right');
          if(o.right)sc++;dn++;q('.qsc').textContent=sc+' / '+dn;
          const w=document.createElement('div');w.className='why';
          w.innerHTML='<b>'+c.t+':</b> '+c.d
            +(o.right?'':'<div style="margin-top:7px"><button class="btn sm qflag">Flag this for re-drill</button></div>');
          div.appendChild(w);
          const fb=w.querySelector('.qflag');
          if(fb)fb.onclick=()=>{GAPS[key(c)]={note:'got this wrong on a practice test',at:new Date().toISOString(),term:c.t,deck:deck};push();fb.textContent='flagged';fb.disabled=true};
        };
        div.appendChild(btn);
      });
      b.appendChild(div);
    });
  }
  q('.qnew').onclick=build;q('.qgapsonly').onchange=build;
  build();pull();
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
+'.tiny{font-size:11px;color:var(--dim)}';
const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);

GAPS=cacheGet();
window.Flash={mount:mount,quiz:quiz,gaps:function(){return GAPS},pull:pull};
})();
