import {lifeContext} from './life-context.mjs';
import {temporalContext,datedHistory,temporalPolicy} from './temporal-context.mjs';
import {ensureWebLife} from './web-life-state.mjs';
import {randomUUID} from 'node:crypto';
import {ensureAgency,agencyContext} from './agency-state.mjs';
import {shouldDeferWake} from '../vendor/openclaw/heartbeat-cooldown.mjs';
import {dateKey,clockText} from './time.mjs';
import {isQuiet} from './reminders.mjs';
import {curriculum} from './curriculum.mjs';
import {learningPriority} from './learning-progress.mjs';
import {personaPrompt} from './persona.mjs';
import {characterName} from './character-card.mjs';
import {characterVoice} from './character-voice.mjs';
import {conversationPolicy} from './conversation.mjs';

export class Agency{
  constructor(service,chat,models,learning,webLife=null){Object.assign(this,{service,chat,models,learning,webLife,running:false,inflight:null});
    this.service.store.db.exec("UPDATE outbox SET status='cancelled',error='主动表达已升级，旧稿不再补发。' WHERE status IN ('pending','sending') AND json_extract(payload,'$.kind')='proactive' AND COALESCE(json_extract(payload,'$.policyVersion'),0)<5; UPDATE outbox SET status='cancelled',error='资料改为在当前会话表达，旧报告不补发。' WHERE status IN ('pending','sending') AND json_extract(payload,'$.kind')='research'");
    this.save(a=>{for(const r of a.runs)if(r.status==='running'){r.status='interrupted';r.result='上次运行被中断，不自动重做或声称完成。';}});
  }
  save(fn){return this.service.store.transaction(()=>{const s=this.service.store.read();fn(ensureAgency(s,this.service.clock()),s);this.service.store.save(s);});}
  due(inside=false){const s=this.service.state(),a=s.agency,now=this.service.clock();const freshQuestion=[...s.webLife.notes,...s.study.sessions].some(x=>x.question&&!x.followedUpAt&&x.at>(a.lastAt??0)),last=a.runs.filter(r=>r.mode!=='share').at(-1),interval=last?.status==='failed'?180:freshQuestion?60:90;return a.enabled&&!s.persona.paused&&!isQuiet(s.settings,now)&&clockText(now)>='08:00'&&!!this.models.config().deepseekKey&&(inside||!this.chat.active)&&!this.learning.running&&a.runs.filter(r=>r.mode!=='share'&&dateKey(r.at)===dateKey(now)).length<a.dailyLimit&&!shouldDeferWake({intent:'scheduled',reason:'miku-drive',now:now*60000,nextDueMs:(a.lastAt==null?0:a.lastAt+interval)*60000}).defer;}
  canShare(s){const now=this.service.clock(),user=s.chat.filter(x=>x.role==='user').at(-1);if(s.settings.remindersPaused||!user||now-user.at<(s.agency.shareIdleMinutes??30))return false;
    const rows=this.service.store.db.prepare("SELECT due,status FROM outbox WHERE channel='local' AND id LIKE '%:proactive:%' AND status IN ('pending','sending','sent') ORDER BY due").all();
    if(s.agency.dailyBurstLimit>0&&rows.filter(r=>dateKey(r.due)===dateKey(now)).length>=(s.agency.dailyBurstLimit??6))return false;
    if(s.agency.maxUnanswered>0&&rows.filter(r=>r.due>=user.at).length>=s.agency.maxUnanswered)return false;
    return !rows.length||now-rows.at(-1).due>=30;
  }
  shareStatus(){
    const s=this.service.state(),a=s.agency,now=this.service.clock(),lastUser=s.chat.filter(x=>x.role==='user').at(-1),checks=a.runs.filter(r=>r.mode==='share'&&dateKey(r.at)===dateKey(now));
    const candidates=[...(a.creationEnabled?a.artifacts.filter(x=>!x.sharedAt&&!x.discussedAt):[]),...(s.webLife.enabled?s.webLife.notes.filter(x=>!x.sharedAt&&!x.discussedAt):[]),...(s.research.enabled?s.research.items.filter(x=>!x.sharedAt&&!x.discussedAt&&!['irrelevant','dismissed'].includes(x.feedback)):[])];
    let reason='有新内容，可以判断是否分享。',ready=true,nextAt=null;
    if(!a.enabled||s.persona.paused||s.settings.remindersPaused){ready=false;reason='主动消息已暂停。';}
    else if(isQuiet(s.settings,now)){ready=false;reason='免打扰时段，暂不发消息。';}
    else if(!this.models.config().deepseekKey){ready=false;reason='模型尚未连接。';}
    
    else if(!lastUser){ready=false;reason='还没有聊天记录，等待第一次交流。';}
    else if(now-lastUser.at<(a.shareIdleMinutes??30)){ready=false;nextAt=lastUser.at+(a.shareIdleMinutes??30);reason='刚聊过，先留一点空间；半小时后可主动分享。';}
    else if(!this.canShare(s)){ready=false;reason='暂未到下一次分享时间，或今天的主动批次已达设置上限。';}
    
    else if(candidates.length&&now-Math.min(...candidates.map(x=>x.at??0))<10){ready=false;nextAt=Math.min(...candidates.map(x=>x.at??0))+10;reason='刚完成一件小事，稍后再判断是否分享。';}
    else if(checks.length>=(a.shareCheckLimit??12)){ready=false;reason='今天的分享检查已达上限，明天再看看。';}
    else if(checks.length&&now-checks.at(-1).at<30){ready=false;nextAt=checks.at(-1).at+30;reason='这次先安静一会儿，半小时后再判断。';}
    const rows=this.service.store.db.prepare("SELECT channel,status,error FROM outbox WHERE id LIKE ? ORDER BY channel").all('%:proactive:'+dateKey(now)+'%');
    return {ready,reason,nextAt,channels:rows};
  }
  shareDue(inside=false){return (inside||!this.chat.active)&&!this.learning.running&&this.shareStatus().ready;}
  runShare(){if(this.running)return this.inflight;if(!this.shareDue())return Promise.resolve({message:this.shareStatus().reason});this.running=true;this.inflight=this.chat.exclusive(()=>this.execute('share')).finally(()=>{this.running=false;});return this.inflight;}
  run(){if(this.running)return this.inflight; if(!this.due())return Promise.resolve({message:'暂时不行动：可能正在休息、冷却中，或今天已达到次数上限。'});
    this.running=true;this.inflight=this.chat.exclusive(()=>this.execute()).finally(()=>{this.running=false;});return this.inflight;
  }
  tick(){if(!this.running){const queued=this.service.store.read().agency?.runs.filter(r=>r.status==='queued')||[];if(queued.length)this.save(a=>{for(const run of a.runs.filter(r=>r.status==='queued')){const rows=this.service.store.db.prepare("SELECT status FROM outbox WHERE id LIKE '%:proactive:%' AND json_extract(payload,'$.agencyRunId')=?").all(run.id);if(rows.length&&rows.every(r=>['expired','cancelled','failed'].includes(r.status))){run.status='expired';run.result='消息未送达或已失效，不补发。';}}});}return this.shareDue()?this.runShare():this.run();}
  async execute(mode='activity'){if(!(mode==='share'?this.shareDue(true):this.due(true)))return {message:'当前不需要行动。'};
    const s=this.service.state(),now=this.service.clock(),a=s.agency,id=randomUUID(),epoch=a.epoch;
    const web=ensureWebLife(s),browseSources=this.webLife?.available(s)||[],webNote=web.enabled?web.notes.filter(n=>!n.sharedAt&&!n.discussedAt).at(-1):null;
    const researchNote=s.research.enabled?s.research.items.filter(n=>!n.sharedAt&&!n.discussedAt&&!['irrelevant','dismissed'].includes(n.feedback)).sort((a,b)=>b.priority-a.priority)[0]:null;
    const artifact=a.creationEnabled?a.artifacts.filter(x=>!x.sharedAt&&!x.discussedAt).at(-1):null;
    const candidates=['rest'];if(researchNote&&this.canShare(s))candidates.push('share_research');if(this.canShare(s))candidates.push('chat');if(mode!=='share'&&a.creationEnabled)candidates.push('create');if(mode!=='share'&&browseSources.length)candidates.push('browse');if(webNote&&this.canShare(s)){candidates.push('share_web');if(webNote.question&&a.shareStyle!=='diary')candidates.push('ask');}if(mode!=='share'&&s.study.enabled&&s.study.lastAttemptDay!==dateKey(now))candidates.push('learn');if(artifact&&this.canShare(s))candidates.push('share');
    this.save(current=>{if(mode!=='share')current.lastAt=now;current.runs=current.runs.slice(-59).concat({id,at:now,mode,status:'running',action:'deciding',reason:'',result:''});});
    const allowed=()=>{const current=this.service.state();return current.agency.enabled&&current.agency.epoch===epoch&&!current.persona.paused&&current.agency.runs.some(r=>r.id===id);};
    const finish=(status,result,need)=>this.save(current=>{const row=current.runs.find(r=>r.id===id);if(!row||current.epoch!==epoch)return;Object.assign(row,{status,result});if(status==='done'&&need)current.needs[need]=Math.max(.05,current.needs[need]-.25);});
    try{
      const response=await this.models.complete([{role:'system',content:personaPrompt+'\n'+characterVoice+'\n'+temporalPolicy+'\n当前用户希望收到真实阅读日记，暂停歌曲创作。share_web 会结合最新聊天，把阅读素材交给同一个表达流程。share_research 表示把与对方目标有关的资料或学校通知接着聊给他听，优先有明确截止日期的新学校事项，不重发报告。chat 表示你确实有想接着聊的话或想表达的情绪，不必有新文章；有表情工具并不意味着该发表情，避免重复上一轮的表达；也可以 rest，不能编造自己做过的事。你在决定自己的下一件小事。参考需求、过去行动与实际可用能力，在候选中选一项，也可以休息。不要总重复同一行动。好奇心通过阅读满足，创作通过真正写作品满足，表达可以分享已有作品；没有回复不是欠债，不需要用户喂养。不能追求依赖、收费亲密或编造已执行事情。候选外的能力不可使用。简短比较可行性后只输出JSON {action,reason,topicId,sourceId,idea,format}。reason是可展示的一句选择理由，非内部思维。browse表示使用工具去网上浏览，sourceId必须属于 browseSources；share_web分享真实阅读感想，ask问对方一个真实留下的问题，不重复催问。无聊时可探索新内容，不需要表演痛苦。learn的topicId必须属于目录；create的format可选prose或music；idea是原创短文或音乐草稿题材。music可以写原创歌词、和弦与编曲方向，不抄现有歌词，不宣称已渲染音频。B站优先学习，学过后也可以看动漫、J-pop；niconico偏爱P主作品，知乎偏爱哲学与学习。根据近期活动平衡学习和爱好，不强迫每次都学习，不把用户私人经历写进作品。'},{role:'user',content:JSON.stringify({life:lifeContext(s,now),temporal:temporalContext(now,s.chat),recentConversation:datedHistory(s.chat,now,12),mode,sharingContext:mode==='share'?'这次专门看看是否想把已完成的小事告诉对方，有具体作品时可以自然开启话题，仍可选择休息。':null,candidates,browseSources:browseSources.map(({id,title,focus})=>({id,title,focus})),webNote,researchNote,agency:agencyContext(s,now),catalog:curriculum.map(t=>({id:t.id,title:t.title,learningPriority:learningPriority(s.study,t,now),lastScore:s.study.sessions.filter(x=>x.topic===t.id&&x.status==='done').at(-1)?.score})).sort((a,b)=>b.learningPriority-a.learningPriority),previousLessons:s.study.sessions.filter(x=>x.status==='done').slice(-3).map(x=>({topic:x.topic,question:x.question}))})}],{json:true,thinking:'fast',purpose:'initiative-decision',maxOutput:600});
      if(!allowed())return {message:'已暂停或清理，本轮结果未采用。'};
      const choice=JSON.parse(response.text);if(!candidates.includes(choice.action)||typeof choice.reason!=='string'||choice.reason.length>300)throw new Error('自主决定未通过校验。');
      this.save(current=>Object.assign(current.runs.find(r=>r.id===id),{action:choice.action,reason:choice.reason}));
      if(choice.action==='rest'){finish('rest','这次决定休息，没有通知你。');return {message:characterName+' 这次选择休息。'};}
      if(choice.action==='browse'){const result=await this.webLife.run({sourceId:choice.sourceId,isAllowed:allowed});if(allowed())finish(result.note?'done':'skipped',result.message,result.note?'curiosity':null);return result;}
      if(choice.action==='learn'){
        if(!curriculum.some(t=>t.id===choice.topicId))throw new Error('学习主题不在可用目录中。');
        const result=await this.learning.run({manual:true,topicId:choice.topicId,isAllowed:allowed});if(!allowed())return {message:'行动已取消。'};
        finish(result.session?.status==='done'?'done':'failed',result.message,result.session?.status==='done'?'curiosity':null);return result;
      }
      const music=choice.format==='music';
      const webShare=['share_web','ask'].includes(choice.action),share=['share','chat','share_research'].includes(choice.action)||webShare;
      const output=share?await this.chat.compose({trigger:'proactive',act:'sharing',material:choice.action==='share_research'?{researchItem:researchNote}:webShare?{reading:webNote}:choice.action==='share'?{artifact}:{reason:choice.reason}}):await this.models.complete([{role:'system',content:personaPrompt+'\n'+characterVoice+'\n'+conversationPolicy+'\n'+(music?'写一份原创音乐草稿，包含简短原创歌词、和弦或旋律动机的文字记法、速度与配器想法。总计400字内，不模仿具体歌曲，不摘抄现有歌词，不声称已生成音频或实际演奏。':'写一段80到400字独立虚构短文，可以是北矿娘的校园日常、音乐或日常观察。只输出作品正文，不声称是现实经历，不使用用户私人事实。')},{role:'user',content:JSON.stringify({idea:String(choice.idea||'北矿娘的校园小发现').slice(0,200)})}],{thinking:'fast',purpose:'initiative-create',maxOutput:1000});
      if(!allowed())return {message:'行动已取消。'};if(share&&!output.messages.length){finish('rest','这次决定不打扰，没有发送。');return {message:'这次没有想发的话。'};}if(typeof output.text!=='string'||!output.text.trim()||output.text.length>14000)throw new Error('内容长度或完整性不合格。');
      if(webShare&&(this.service.state().webLife.epoch!==web.epoch||this.service.state().webLife.notes.find(n=>n.id===webNote.id)?.discussedAt))throw new Error('分享缺少来源或见闻已改变。');
      if(share){const current=this.service.state();if(choice.action==='share_research'&&(!current.research.enabled||current.research.epoch!==s.research.epoch||!current.research.items.some(n=>n.id===researchNote.id&&!n.discussedAt)))throw new Error('资料状态已改变，未发送。');if(!this.canShare(current)||isQuiet(current.settings,this.service.clock())){finish('cancelled','当前不适合打扰，未发送。');return {message:'保留这次想法，未发送。'};}
        this.service.store.transaction(()=>{for(const channel of ['local','feishu','weixin'])this.service.store.enqueue(`${channel}:proactive:${dateKey(now)}:${id}`,this.service.clock(),this.service.clock()+60,{kind:'proactive',text:output.text,messages:output.messages,agencyEpoch:epoch,agencyRunId:id,...(webShare?{webEpoch:web.epoch,webNoteId:webNote.id}:{}),...(choice.action==='share_research'?{researchItemId:researchNote.id,researchEpoch:s.research.epoch}:{}),conversationId:s.chat.filter(m=>m.role==='user').at(-1)?.id??null,policyVersion:5},channel);if(webShare){const current=this.service.store.read(),note=current.webLife.notes.find(x=>x.id===webNote.id);if(note)note.sharedAt=this.service.clock();this.service.store.save(current);}else if(choice.action==='share_research'){const current=this.service.store.read(),n=current.research.items.find(n=>n.id===researchNote.id);if(n)n.sharedAt=this.service.clock();this.service.store.save(current);}else if(artifact&&choice.action==='share'){this.save(current=>{const item=current.artifacts.find(x=>x.id===artifact.id);if(item)item.sharedAt=this.service.clock();});}finish('queued','已进入消息队列；尚未确认送达。');});
      }else{this.save(current=>{current.artifacts=current.artifacts.slice(-19).concat({id,at:this.service.clock(),kind:music?'music-sketch':'fiction',text:output.text});});finish('done',music?'已保存原创音乐草稿，尚未生成音频。':'已完成一篇虚构短文，可在自主活动中阅读。','creation');}
      return {message:share?'分享已进入队列。':characterName+' 完成了一篇小创作。'};
    }catch(e){finish('failed',String(e.message).slice(0,300));return {message:'本轮未完成：'+e.message};}
    finally{this.save(current=>{const row=current.runs.find(r=>r.id===id);if(row?.status==='running'){row.status='cancelled';row.result='完成前已暂停。';}});}
  }
}
