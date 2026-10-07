// Voice: settings card plus playback. Browser speech starts instantly; server engines fetch each line from
// /api/tts while the previous line is still playing, so long replies do not wait for the whole batch.
const strip=text=>String(text||'').replace(/\n*参考来源：[\s\S]*$/,'').replace(/https?:\/\/\S+/g,'').trim();
export function initVoice({api,guard,notify,token,config}){
  const form=document.createElement('form');form.className='card';form.id='voice-form';
  form.innerHTML=`<p class="eyebrow">VOICE</p><h2>她的声音</h2><p>浏览器朗读不用安装，马上能用。GPT-SoVITS 或兼容 OpenAI 语音接口的服务需要你在电脑上另外启动，声音更像她。</p>
  <label>语音方式<select name="ttsEngine"><option value="off">不朗读</option><option value="browser">浏览器朗读（免安装）</option><option value="gpt-sovits">GPT-SoVITS 本地服务</option><option value="openai">兼容 OpenAI 的语音接口</option></select></label>
  <label>服务地址<input name="ttsBase" placeholder="http://127.0.0.1:9880"></label>
  <label>参考音频路径（GPT-SoVITS 所在电脑上的文件）<input name="ttsRefAudio" placeholder="D:/voices/meizha.wav"></label>
  <label>参考音频里说的话<input name="ttsPromptText"></label>
  <label>参考音频语言<select name="ttsPromptLang"><option value="zh">中文</option><option value="ja">日语</option><option value="en">英语</option><option value="yue">粤语</option><option value="ko">韩语</option><option value="auto">自动</option></select></label>
  <label>模型（兼容 OpenAI 接口）<input name="ttsModel"></label><label>音色<input name="ttsVoice"></label>
  <label>语速<input name="ttsSpeed" type="number" min="0.5" max="2" step="0.1"></label>
  <label>接口密钥（可选，不回显）<input name="ttsKey" type="password" autocomplete="off"></label>
  <div class="actions"><button class="primary">保存语音设置</button><button type="button" data-voice-test>试听一句</button></div>`;
  document.querySelector('#settings').append(form);
  const fill=()=>{const c=config();if(!c)return;for(const k of ['ttsEngine','ttsBase','ttsRefAudio','ttsPromptText','ttsPromptLang','ttsModel','ttsVoice','ttsSpeed'])if(c[k]!==undefined)form.elements[k].value=c[k];};setTimeout(fill);
  form.onsubmit=guard(async e=>{e.preventDefault();const f=form.elements,data={ttsEngine:f.ttsEngine.value,ttsBase:f.ttsBase.value,ttsRefAudio:f.ttsRefAudio.value,ttsPromptText:f.ttsPromptText.value,ttsPromptLang:f.ttsPromptLang.value,ttsModel:f.ttsModel.value,ttsVoice:f.ttsVoice.value,ttsSpeed:Number(f.ttsSpeed.value)||1};if(f.ttsKey.value)data.ttsKey=f.ttsKey.value;Object.assign(config(),await api('/api/config',data));f.ttsKey.value='';notify('语音设置已保存。');});
  form.querySelector('[data-voice-test]').onclick=guard(async()=>{await say('我是小煤渣，这是我现在的声音。');});
  // Auto-read toggle lives next to the chat box; remembered per browser.
  let auto=false;try{auto=localStorage.getItem('voice:auto')==='1';}catch{}
  const toggle=document.createElement('label');toggle.className='voice-toggle';toggle.innerHTML='<input type="checkbox"> 朗读她的回复';const box=toggle.querySelector('input');box.checked=auto;
  box.onchange=()=>{auto=box.checked;try{localStorage.setItem('voice:auto',auto?'1':'0');}catch{}if(!auto)stop();};document.querySelector('#chat-form')?.after(toggle);
  let current=null,generation=0;
  function stop(){generation++;if('speechSynthesis' in window)speechSynthesis.cancel();current?.pause();current=null;}
  function browserSay(text){return new Promise(resolve=>{if(!('speechSynthesis' in window)){resolve();return;}const u=new SpeechSynthesisUtterance(text),voice=speechSynthesis.getVoices().find(v=>/^zh/i.test(v.lang));if(voice)u.voice=voice;u.lang='zh-CN';u.rate=Number(config().ttsSpeed)||1;u.pitch=1.1;u.onend=u.onerror=()=>resolve();speechSynthesis.speak(u);});}
  async function fetchAudio(text){const res=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json','X-Miku-Token':token()},body:JSON.stringify({text})});if(!res.ok)throw new Error((await res.json().catch(()=>({}))).error||'语音合成失败。');return URL.createObjectURL(await res.blob());}
  function play(url,run){return new Promise(resolve=>{if(run!==generation){resolve();return;}const audio=new Audio(url);current=audio;audio.onended=audio.onerror=()=>{URL.revokeObjectURL(url);resolve();};audio.play().catch(()=>resolve());});}
  // Speaks one line and resolves when it has finished; the stage waits on this to advance.
  async function say(text,next){const engine=config().ttsEngine,line=strip(text);if(!line||engine==='off')return;const run=generation;
    if(engine==='browser')return browserSay(line);
    const url=await (next||fetchAudio(line));return play(url,run);}
  async function sayAll(lines){stop();const run=generation,texts=lines.map(strip).filter(Boolean);let pending=null;
    for(let i=0;i<texts.length&&run===generation;i++){const engine=config().ttsEngine;if(engine==='off')return;
      if(engine==='browser'){await browserSay(texts[i]);continue;}
      const url=await (pending||fetchAudio(texts[i]));pending=i+1<texts.length?fetchAudio(texts[i+1]):null;await play(url,run);}}
  document.addEventListener('companion:reply',e=>{if(!auto||e.detail.silent||document.body.classList.contains('stage-open'))return;const lines=(e.detail.messages||[]).filter(m=>m.type==='text').map(m=>m.text);void sayAll(lines).catch(err=>notify(err.message,true));});
  return {say,stop,fetchAudio,enabled:()=>auto&&config().ttsEngine!=='off',refresh:fill};
}
