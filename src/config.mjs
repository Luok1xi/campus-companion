import { existsSync,readFileSync,writeFileSync,mkdirSync,renameSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
export const configPath=resolve(process.env.MIKU_CONFIG||'data/config.json');
export function readConfig(){
  const saved=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{};
  return {deepseekKey:process.env.DEEPSEEK_API_KEY||saved.deepseekKey||'',deepseekModel:'deepseek-v4-pro',openaiKey:process.env.OPENAI_API_KEY||saved.openaiKey||'',openaiEnabled:saved.openaiEnabled===true,openaiModel:'gpt-6-astra',monthlyLimit:Math.min(200,Number(saved.monthlyLimit)||200),usdCny:Number(saved.usdCny)||7.5,advisorMonthlyLimit:Math.min(200,Number(saved.advisorMonthlyLimit)||30),advisorDailyLimit:Math.min(10,Number(saved.advisorDailyLimit)||4),webResearchEnabled:saved.webResearchEnabled!==false,languageLearningEnabled:saved.languageLearningEnabled!==false,feishuAppId:saved.feishuAppId||'',feishuAppSecret:saved.feishuAppSecret||'',feishuUser:saved.feishuUser||'',feishuEnabled:saved.feishuEnabled===true,
    // Search/research toolkit: web search needs one provider key; scholarly sources are keyless.
    tavilyKey:process.env.TAVILY_API_KEY||saved.tavilyKey||'',bochaKey:process.env.BOCHA_API_KEY||saved.bochaKey||'',braveKey:process.env.BRAVE_API_KEY||saved.braveKey||'',searxngUrl:saved.searxngUrl||'',s2Key:process.env.S2_API_KEY||saved.s2Key||'',
    agentEnabled:saved.agentEnabled!==false,mcpServers:Array.isArray(saved.mcpServers)?saved.mcpServers:[],
    // Voice: browser speech needs nothing installed; GPT-SoVITS / OpenAI-compatible servers run separately.
    ttsEngine:['off','browser','gpt-sovits','openai'].includes(saved.ttsEngine)?saved.ttsEngine:'browser',ttsBase:saved.ttsBase||'http://127.0.0.1:9880',ttsRefAudio:saved.ttsRefAudio||'',ttsPromptText:saved.ttsPromptText||'',ttsPromptLang:saved.ttsPromptLang||'zh',ttsModel:saved.ttsModel||'tts-1',ttsVoice:saved.ttsVoice||'alloy',ttsSpeed:Number(saved.ttsSpeed)||1,ttsKey:process.env.TTS_API_KEY||saved.ttsKey||'',agentQuickLimit:Number(saved.agentQuickLimit)||0.4,researchRunLimit:Number(saved.researchRunLimit)||2,
    ...(process.env.MIKU_TEST_MODE==='1'?{testMode:true}:{})};
}
const secretKeys=['deepseekKey','openaiKey','feishuAppSecret','tavilyKey','bochaKey','braveKey','s2Key','ttsKey'];
export function publicConfig(c){return {...c,...Object.fromEntries(secretKeys.map(k=>[k,undefined])),mcpServers:(c.mcpServers||[]).map(s=>({name:String(s?.name||''),transport:s?.url?'http':'stdio'})),deepseekConfigured:!!c.deepseekKey,openaiConfigured:!!c.openaiKey,feishuConfigured:!!(c.feishuAppId&&c.feishuAppSecret&&c.feishuUser),tavilyConfigured:!!c.tavilyKey,bochaConfigured:!!c.bochaKey,braveConfigured:!!c.braveKey,s2Configured:!!c.s2Key,ttsKeyConfigured:!!c.ttsKey};}
export function saveConfig(input){
  const current=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{};
  for(const k of ['deepseekKey','openaiKey','feishuAppId','feishuAppSecret','feishuUser','tavilyKey','bochaKey','braveKey','s2Key','ttsKey'])if(input[k]!==undefined&&input[k]!==''){if(typeof input[k]!=='string'||input[k].length>1000||/[\r\n]/.test(input[k]))throw new Error('配置字段格式不正确。');current[k]=input[k].trim();}
  for(const k of ['tavilyKey','bochaKey','braveKey','s2Key','ttsKey'])if(input['clear_'+k]===true)delete current[k];
  if(input.ttsEngine!==undefined){if(!['off','browser','gpt-sovits','openai'].includes(input.ttsEngine))throw new Error('语音方式无效。');current.ttsEngine=input.ttsEngine;}
  if(input.ttsBase!==undefined){let u;try{u=new URL(String(input.ttsBase).trim());}catch{throw new Error('语音服务地址格式不正确。');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('语音服务地址只接受 http(s)，不含账号密码。');current.ttsBase=u.origin+u.pathname.replace(/\/+$/,'');}
  for(const [k,max] of [['ttsRefAudio',500],['ttsPromptText',300],['ttsModel',100],['ttsVoice',100]])if(input[k]!==undefined){if(typeof input[k]!=='string'||input[k].length>max||/[\r\n]/.test(input[k]))throw new Error('语音设置格式不正确。');current[k]=input[k].trim();}
  if(input.ttsPromptLang!==undefined){if(!['zh','ja','en','yue','ko','auto'].includes(input.ttsPromptLang))throw new Error('参考音频语言无效。');current.ttsPromptLang=input.ttsPromptLang;}
  if(input.searxngUrl!==undefined){const v=String(input.searxngUrl).trim();if(v){let u;try{u=new URL(v);}catch{throw new Error('SearXNG 地址格式不正确。');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('SearXNG 地址只接受 http(s)，不含账号密码。');current.searxngUrl=u.origin+u.pathname.replace(/\/+$/,'');}else delete current.searxngUrl;}
  for(const k of ['openaiEnabled','feishuEnabled','webResearchEnabled','languageLearningEnabled','agentEnabled'])if(input[k]!==undefined){if(typeof input[k]!=='boolean')throw new Error('开关值不正确。');current[k]=input[k];}
  for(const [k,min,max]of [['ttsSpeed',0.5,2],['monthlyLimit',1,200],['usdCny',1,20],['advisorMonthlyLimit',1,200],['advisorDailyLimit',1,10],['agentQuickLimit',0.05,2],['researchRunLimit',0.2,10]])if(input[k]!==undefined){if(!Number.isFinite(input[k])||input[k]<min||input[k]>max)throw new Error(`${k} 超出允许范围。`);current[k]=input[k];}
  mkdirSync(dirname(configPath),{recursive:true});writeFileSync(configPath+'.tmp',JSON.stringify(current,null,2),{mode:0o600});renameSync(configPath+'.tmp',configPath);return publicConfig(readConfig());
}
