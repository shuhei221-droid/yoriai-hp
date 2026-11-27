// ━━ GAS エンドポイント ━━
const GAS_URL = 'YOUR_GAS_WEBAPP_URL_HERE';

// ━━ GTM dataLayer helper (自動学習用イベント送信) ━━
function dl(event, label, value) {
  window.dataLayer = window.dataLayer || [];
  dataLayer.push({event, label: label||'', value: value||'', timestamp: Date.now()});
}

// ━━ スクロール深度トラッキング ━━
(function(){
  var marks={25:0,50:0,75:0,100:0};
  window.addEventListener('scroll',function(){
    var pct=Math.round((window.scrollY/(document.body.scrollHeight-window.innerHeight))*100);
    [25,50,75,100].forEach(function(m){if(pct>=m&&!marks[m]){marks[m]=1;dl('scroll_depth',m+'%');}});
  },{passive:true});
})();

// ━━ 時間滞在トラッキング ━━
(function(){
  var marks={30:0,60:0,120:0,300:0};
  setInterval(function(){
    var t=Math.floor((Date.now()-performance.timing.navigationStart)/1000);
    [30,60,120,300].forEach(function(s){if(t>=s&&!marks[s]){marks[s]=1;dl('time_on_page',s+'sec');}});
  },5000);
})();

// ━━ Drawers ━━
function openD(id){document.getElementById('d-'+id).classList.add('open');document.body.style.overflow='hidden';}
function closeD(id){document.getElementById(id).classList.remove('open');document.body.style.overflow='';}
function closeDG(e,id){if(e.target===document.getElementById(id))closeD(id);}

// ━━ Exit Popup ━━
var _ps=false;
function showP(){if(!document.getElementById('exit-popup'))return;try{if(_ps||sessionStorage.getItem('pd'))return;}catch(e){if(_ps)return;}_ps=true;document.getElementById('exit-popup').classList.add('open');dl('exit_intent_shown');}
function closeP(){var p=document.getElementById('exit-popup');if(p)p.classList.remove('open');try{sessionStorage.setItem('pd','1');}catch(e){}}
document.addEventListener('mouseleave',function(e){if(e.clientY<10)showP();});
if(window.innerWidth<768)setTimeout(showP,30000);

// ━━ Escape ━━
document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;document.querySelectorAll('.dbg.open,.pbg.open').forEach(function(el){el.classList.remove('open');document.body.style.overflow='';});});

// ━━ Form Submit ━━
var _form=document.getElementById('inquiry-form');
if(_form)_form.addEventListener('submit',async function(e){
  e.preventDefault();
  var btn=document.getElementById('f-submit');
  var res=document.getElementById('f-result');
  btn.disabled=true;btn.textContent='送信中...';res.className='fr';res.textContent='';
  var data=Object.fromEntries(new FormData(this).entries());
  data.page=location.href;data.ts=new Date().toISOString();
  dl('form_submit',data.plan);
  try{
    if(!GAS_URL||GAS_URL==='YOUR_GAS_WEBAPP_URL_HERE')throw new Error('not_configured');
    // text/plain で送る：GAS はブラウザからの application/json を CORS で受け付けないため
    var r=await(await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(data)})).json();
    if(r.status==='ok'){res.className='fr ok';res.textContent='送信しました。自動返信メールをご確認ください。担当者より原則1営業日以内にご連絡します。';this.reset();dl('form_success',data.plan);}
    else throw new Error(r.message);
  }catch(err){res.className='fr err';res.textContent='送信に失敗しました。お電話（080-5360-8397）またはメール（info@yoriai-info.jp）でご連絡ください。';dl('form_error',String(err&&err.message||''));}
  finally{btn.disabled=false;btn.textContent='無料相談を申し込む';}
});
// ━━ 表示演出（ナビの区切り線・スクロール表示・プランカードのキーボード操作） ━━
(function(){
  var nav=document.getElementById('nav');
  function onScroll(){nav.classList.toggle('scrolled',window.scrollY>8);}
  window.addEventListener('scroll',onScroll,{passive:true});onScroll();
  var els=document.querySelectorAll('.rv');
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px'});
    els.forEach(function(el){io.observe(el);});
  }else{els.forEach(function(el){el.classList.add('in');});}
  document.querySelectorAll('.plan-row[role="button"]').forEach(function(el){
    el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});
  });
})();

// ━━ メニュー（スマホ） ━━
(function(){
  var nav=document.getElementById('nav'),tg=document.getElementById('nav-tg');
  if(!tg)return;
  function set(open){nav.classList.toggle('open',open);tg.setAttribute('aria-expanded',open?'true':'false');tg.setAttribute('aria-label',open?'メニューを閉じる':'メニューを開く');document.body.style.overflow=open?'hidden':'';}
  tg.addEventListener('click',function(){set(!nav.classList.contains('open'));dl('nav_menu_toggle');});
  document.querySelectorAll('#nav-links a').forEach(function(a){a.addEventListener('click',function(){set(false);});});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&nav.classList.contains('open'))set(false);});
})();

// ━━ お問い合わせ：プランの初期選択（?plan=） ━━
(function(){
  var sel=document.querySelector('#inquiry-form select[name="plan"]');
  if(!sel)return;
  var p='';try{p=new URLSearchParams(location.search).get('plan')||'';}catch(e){}
  if(!p)return;
  for(var i=0;i<sel.options.length;i++){if(sel.options[i].text.indexOf(p)===0){sel.selectedIndex=i;break;}}
})();
