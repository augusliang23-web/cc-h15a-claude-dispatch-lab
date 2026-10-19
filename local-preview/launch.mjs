// Fixed OS browser opener only; never launches an agent, shell or remote command.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startPreview} from './server.mjs';
const app=await startPreview({directory:fileURLToPath(new URL('.demo-state',import.meta.url))});
const stop=()=>{void app.stop();};process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('SIGHUP',stop);
if(process.platform==='darwin'){
 const browser=spawn('/usr/bin/open',[`${app.origin}/#${app.launchToken}`],{stdio:'ignore'});
 browser.on('error',()=>{console.error('無法開啟瀏覽器；服務將停止。');void app.stop();});
 browser.on('exit',code=>{if(code!==0)void app.stop();});
}else {console.error('雙擊示範入口僅支援 Mac；服務將停止。');await app.stop();}
console.log('本機預覽已開啟。只記錄合成資料的本機決定，不會執行 AI。');
console.log('請在頁面按「停止並關閉服務」。此視窗保持前景；沒有安裝背景服務。');
await app.stopped;console.log('本機預覽服務已停止。');
