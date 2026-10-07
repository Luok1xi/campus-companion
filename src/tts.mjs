import {createHash} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
// Speech synthesis. "browser" speaks inside the page with the Web Speech API: no server and no wait.
// GPT-SoVITS (api_v2 /tts) and OpenAI-compatible /v1/audio/speech servers return audio, cached by text.
export const ttsEngines=['off','browser','gpt-sovits','openai'];
export const speakable=text=>String(text||'').replace(/\n*参考来源：[\s\S]*$/,'').replace(/\[表情包：[^\]]*\]/g,'').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().slice(0,600);
export class Speech{
  constructor({config,dir,fetcher=fetch,limit=200}){Object.assign(this,{config,dir,fetcher,limit});}
  status(){const c=this.config();return {engine:c.ttsEngine,server:['gpt-sovits','openai'].includes(c.ttsEngine),speed:c.ttsSpeed};}
  async synthesize(text){
    const c=this.config(),input=speakable(text);
    if(!['gpt-sovits','openai'].includes(c.ttsEngine))throw new Error('当前语音方式不需要服务器合成。');
    if(!input)throw new Error('没有可以朗读的文字。');
    const key=createHash('sha256').update(JSON.stringify([c.ttsEngine,c.ttsBase,c.ttsModel,c.ttsVoice,c.ttsRefAudio,c.ttsPromptText,c.ttsSpeed,input])).digest('hex').slice(0,32);
    const type=c.ttsEngine==='gpt-sovits'?'audio/wav':'audio/mpeg',file=join(this.dir,key+(type==='audio/wav'?'.wav':'.mp3'));
    if(existsSync(file))return {audio:readFileSync(file),type,cached:true};
    const base=new URL(c.ttsBase).href.replace(/\/+$/,'');
    const request=c.ttsEngine==='gpt-sovits'
      ?{url:base+'/tts',body:{text:input,text_lang:'zh',ref_audio_path:c.ttsRefAudio,prompt_text:c.ttsPromptText,prompt_lang:c.ttsPromptLang,text_split_method:'cut5',batch_size:1,media_type:'wav',streaming_mode:false,speed_factor:c.ttsSpeed}}
      :{url:base+'/v1/audio/speech',body:{model:c.ttsModel,voice:c.ttsVoice,input,response_format:'mp3',speed:c.ttsSpeed},auth:c.ttsKey};
    const res=await this.fetcher(request.url,{method:'POST',headers:{'Content-Type':'application/json',...(request.auth?{Authorization:'Bearer '+request.auth}:{})},body:JSON.stringify(request.body),signal:AbortSignal.timeout(45000)});
    const audio=Buffer.from(await res.arrayBuffer());
    if(!res.ok||!/^audio\//.test(res.headers.get('content-type')||'')){let detail='';try{detail=JSON.parse(audio.toString('utf8')).message||'';}catch{}throw new Error('语音合成失败（HTTP '+res.status+'）'+(detail?'：'+String(detail).slice(0,200):'')+'。');}
    if(audio.length>10*1024*1024)throw new Error('合成的音频过大。');
    mkdirSync(this.dir,{recursive:true});writeFileSync(file,audio);this.prune();
    return {audio,type,cached:false};
  }
  prune(){const files=readdirSync(this.dir).map(name=>({name,at:statSync(join(this.dir,name)).mtimeMs})).sort((a,b)=>b.at-a.at);for(const f of files.slice(this.limit))unlinkSync(join(this.dir,f.name));}
}
