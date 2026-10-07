import {readFileSync} from 'node:fs';
// AIRI MIT-derived character prompt and emotion vocabulary; see vendor/airi/LICENSE.
// The whole identity (name, lore, art files) lives in one card so a redesign never touches code.
export const characterCard=JSON.parse(readFileSync(new URL('../vendor/airi/moyu-card.json',import.meta.url),'utf8'));
export const characterName=characterCard.name;
export const characterNames=[...new Set([characterCard.name,characterCard.nickname,...(characterCard.aliases||[]),...(characterCard.formerNames||[])].filter(Boolean))];
export const characterCardPrompt=[characterCard.identity,characterCard.personality,characterCard.voice,characterCard.care,characterCard.self,characterCard.interests,characterCard.lore].filter(Boolean).join('\n');
export const voiceVersion=characterCard.version;
export const identityVersion=characterCard.identityVersion||1;
export const voiceTraits=characterCard.stable?.traits||['温柔','单纯','可爱','开朗','好奇','聪明可靠'];
export function migrateCharacterVoice(persona,now){
  if((persona.voiceVersion||0)>=voiceVersion)return false;
  persona.stable.traits=[...voiceTraits];persona.voiceVersion=voiceVersion;
  // Keep past preferences auditable, but the user's new direction supersedes their old voice brief.
  for(const rule of persona.inner?.styleRules||[])rule.supersededAt=now;
  return true;
}
// A new look keeps the same companion: relationship, memories, feelings and style rules carry over.
export function migrateCharacterIdentity(persona,now){
  if((persona.identityVersion||0)>=identityVersion)return false;
  const previous=persona.stable.name,{stable}=characterCard;
  if(previous&&previous!==characterCard.name)persona.formerNames=[...new Set([...(persona.formerNames||[]),previous])];
  Object.assign(persona.stable,{name:characterCard.name,identity:stable.identity,traits:[...voiceTraits],interests:[...stable.interests]});
  const legacyIdeas=[stable.legacyCreationIdea,...(stable.legacyCreationIdeas||[])].filter(Boolean);
  for(const p of persona.inner?.projects||[])if(p.id==='small-creation'&&legacyIdeas.includes(p.title))p.title=stable.creationIdea;
  persona.identityVersion=identityVersion;persona.identityChangedAt=now;
  return true;
}
// Only art files that actually exist are announced, so the UI keeps its text fallback until they arrive.
export function characterPublic(exists=()=>false){
  const art=Object.fromEntries(Object.entries(characterCard.art||{}).filter(([,file])=>/^[a-z0-9-]+\.(png|webp)$/.test(file)&&exists(file)).map(([k,file])=>[k,'/art/'+file]));
  return {id:characterCard.id,name:characterCard.name,nickname:characterCard.nickname,kind:characterCard.kind,tagline:characterCard.tagline,formerNames:characterCard.formerNames||[],art};
}
export const activeStyleRules=persona=>(persona.inner?.styleRules||[]).filter(r=>r.supersededAt===undefined);
export const emotionNames=['happy','sad','angry','think','surprised','awkward','question','curious','neutral'];
export function recordCharacterFeeling(persona,value,message,now,id){
  if(!value||!emotionNames.includes(value.name)||!Number.isFinite(value.intensity)||value.intensity<0||value.intensity>1||typeof value.evidence!=='string'||!value.evidence.trim()||!message.includes(value.evidence)||!Number.isFinite(value.confidence)||value.confidence<.7)return;
  if(persona.characterFeeling?.id===id)return;
  persona.characterFeeling={name:value.name,intensity:value.intensity,evidence:value.evidence.slice(0,300),at:now,id};
}
export function characterFeeling(persona,now){
  const f=persona.characterFeeling;if(!f||persona.paused)return null;
  const intensity=f.intensity*Math.pow(.5,Math.max(0,now-f.at)/120);
  return intensity<.05?{name:'neutral',intensity:0}:{...f,intensity};
}
