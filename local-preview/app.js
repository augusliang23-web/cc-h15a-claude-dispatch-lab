'use strict';
const $=id=>document.getElementById(id);
let view=null,busy=false;
const statusText={RESTART_REQUIRES_REFRESH:'重啟後待核對',PAGE_RELOAD_REQUIRES_REFRESH:'頁面已開啟 · 請重新核對',REVIEW_READY:'已核對 · 只可本機預覽',LOCAL_PREVIEW_APPROVED:'本機預覽已批准',LOCAL_PREVIEW_REJECTED:'本機預覽已拒絕',PREVIEW_STALE_REFRESH_REQUIRED:'預覽過期 · 請重新核對',SOURCE_OR_LEDGER_UNAVAILABLE_HOLD:'來源或歷史無法核對 · HOLD',LEDGER_OR_CLOCK_HOLD:'歷史或時間不可信 · HOLD',CLOCK_UNTRUSTED:'時間異常 · HOLD',LEDGER_HOLD:'紀錄損毀、鎖定或中斷 · HOLD',DECISION_RECHECK_FAILED_HOLD:'版本重核失敗 · HOLD'};
function render(v){view=v;$('badge').textContent=statusText[v.status]||'HOLD';$('message').textContent=statusText[v.status]||'狀態不明，請停止並核對。';
 $('approve').disabled=busy||!v.can_decide;$('reject').disabled=busy||!v.can_decide;$('refresh').disabled=busy;
 $('fields').replaceChildren();
 if(v.preview){const p=v.preview,b=p.binding,synthetic=p.source==='SYNTHETIC_FIXTURE';
  $('title').textContent=synthetic?'合成示範：檢視一項 dry-run 任務':'GitHub 唯讀任務預覽';
  $('summary').textContent=synthetic?'SYNTHETIC FIXTURE · 非真實 GitHub 任務。只示範批准與拒絕流程。':'唯讀來源觀察；目前頁面不具執行能力。';
  for(const [label,value] of [['來源',synthetic?'本機合成資料（不需要網路）':'GitHub GET-only adapter'],['儲存庫',b.repository],['Issue / 身分',`#${b.issue_number} · ${b.issue_id}`],['任務',b.task_id],['精確版本 SHA-256',b.issue_content_digest],['任務內容摘要 SHA-256',b.task_digest],['提議代理 / 模型',`${b.agent} / ${b.model}`],['模式與範圍',`${b.execution_mode} · 只記錄本機決定；零遠端變更`],['本次來源核對時間',new Date(p.observed_at).toLocaleString()]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('fields').append(dt,dd);}
 }
 $('history').replaceChildren();$('history-empty').hidden=v.history.length>0;
 for(const e of v.history){const li=document.createElement('li');li.textContent=`#${e.sequence} · ${statusText[e.decision]} · ${new Date(e.at).toLocaleString()} · ${e.source} · Issue #${e.binding.issue_number} · ${e.binding.issue_content_digest.slice(0,12)}`;$('history').append(li);}
}
async function request(path,body){const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('BLOCKED');return r.json();}
async function action(path,extra={}){if(busy||!view)return;busy=true;render(view);try{render(await request(path,{csrf:view.csrf,...extra}));}catch{$('message').textContent='操作被封鎖或結果不確定。請重新核對；不要重複送出。';try{render(await request('/api/state'));}catch{}}finally{busy=false;if(view)render(view);}}
$('refresh').onclick=()=>action('/api/refresh');
$('approve').onclick=()=>{if(view?.can_decide&&!busy)$('confirm').showModal();};
$('cancel').onclick=()=>$('confirm').close();
$('confirm-approve').onclick=()=>{$('confirm').close();return action('/api/decision',{decision:'LOCAL_PREVIEW_APPROVED',sequence:view.sequence,review_id:view.review_id});};
$('reject').onclick=()=>action('/api/decision',{decision:'LOCAL_PREVIEW_REJECTED',sequence:view.sequence,review_id:view.review_id});
$('stop').onclick=async()=>{if(busy||!view)return;try{await request('/api/stop',{csrf:view.csrf});$('message').textContent='服務已停止。可以關閉此頁面。';for(const id of ['stop','refresh','approve','reject'])$(id).disabled=true;}catch{$('message').textContent='無法確認停止，請關閉啟動視窗或檢查服務。';}};
(async()=>{try{const capability=location.hash.slice(1);history.replaceState(null,'','/');if(capability)await request('/session',{token:capability});const initial=await request('/api/state');render(initial.status==='LEDGER_HOLD'?initial:await request('/api/start',{csrf:initial.csrf}));}catch{$('message').textContent='無法建立本機工作階段。請使用雙擊入口重新開啟；不要分享網址。';}})();
