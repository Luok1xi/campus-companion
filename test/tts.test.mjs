import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Speech,speakable} from '../src/tts.mjs';

const base={ttsBase:'http://127.0.0.1:9880',ttsRefAudio:'D:/voices/meizha.wav',ttsPromptText:'你好呀',ttsPromptLang:'zh',ttsModel:'tts-1',ttsVoice:'alloy',ttsSpeed:1.1,ttsKey:''};
const audio=(type='audio/wav')=>new Response(new Uint8Array([82,73,70,70]),{status:200,headers:{'Content-Type':type}});

test('GPT-SoVITS gets the api_v2 /tts body, results are cached by text, and citations are not read aloud',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tts-'));try{
    const calls=[];const speech=new Speech({config:()=>({...base,ttsEngine:'gpt-sovits'}),dir,fetcher:async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return audio();}});
    const first=await speech.synthesize('今天也辛苦啦。\n\n参考来源：\n[S1] 某网页\nhttps://example.org');
    assert.equal(first.type,'audio/wav');assert.equal(first.cached,false);
    assert.equal(calls[0].url,'http://127.0.0.1:9880/tts');
    assert.deepEqual(calls[0].body,{text:'今天也辛苦啦。',text_lang:'zh',ref_audio_path:'D:/voices/meizha.wav',prompt_text:'你好呀',prompt_lang:'zh',text_split_method:'cut5',batch_size:1,media_type:'wav',streaming_mode:false,speed_factor:1.1});
    assert.equal((await speech.synthesize('今天也辛苦啦。')).cached,true);assert.equal(calls.length,1);assert.equal(readdirSync(dir).length,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('OpenAI-compatible speech sends the key only as a header, and server errors are reported, not cached',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tts-'));try{
    let seen;const speech=new Speech({config:()=>({...base,ttsEngine:'openai',ttsBase:'https://tts.example.org/',ttsKey:'secret'}),dir,fetcher:async(url,o)=>{seen={url,headers:o.headers,body:JSON.parse(o.body)};return audio('audio/mpeg');}});
    assert.equal((await speech.synthesize('[表情包：开心] 好耶')).type,'audio/mpeg');
    assert.equal(seen.url,'https://tts.example.org/v1/audio/speech');assert.equal(seen.headers.Authorization,'Bearer secret');
    assert.deepEqual(seen.body,{model:'tts-1',voice:'alloy',input:'好耶',response_format:'mp3',speed:1.1});
    const broken=new Speech({config:()=>({...base,ttsEngine:'gpt-sovits'}),dir:join(dir,'b'),fetcher:async()=>new Response(JSON.stringify({message:'ref audio missing'}),{status:400,headers:{'Content-Type':'application/json'}})});
    await assert.rejects(broken.synthesize('你好'),/HTTP 400.*ref audio missing/);
    await assert.rejects(new Speech({config:()=>({...base,ttsEngine:'browser'}),dir}).synthesize('你好'),/不需要服务器/);
    assert.equal(speakable('看这里 https://example.org 呀'),'看这里 呀');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
