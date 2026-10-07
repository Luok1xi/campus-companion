import {character} from './character.js';
// Stage: a visual-novel view of her replies. Each line switches the bust sprite by its expression, is typed
// out, then waits for her voice (or a reading pause) before the next. Sprites are the three panels of the
// V8 expression sheet: 01 bright, 02 calm/thinking, 03 puffed cheeks (tired, hurt, embarrassed).
const panel={happy:0,surprised:0,think:1,question:1,curious:1,neutral:1,sad:2,angry:2,awkward:2};
export function initStage({voice}){
  const button=document.createElement('button');button.type='button';button.className='stage-launch';button.textContent='舞台模式';
  document.querySelector('.chat-heading')?.append(button);
  const root=document.createElement('div');root.className='stage';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
  root.innerHTML='<div class="stage-sprite" aria-hidden="true"></div><div class="stage-box"><div class="stage-name"></div><p class="stage-text" aria-live="polite"></p><small class="stage-hint">点一下继续</small></div><form class="stage-input"><input maxlength="8000" aria-label="对她说的话" placeholder="对她说点什么…"><button class="primary">发送</button></form><button type="button" class="stage-close">退出舞台</button>';
  document.body.append(root);
  const sprite=root.querySelector('.stage-sprite'),nameplate=root.querySelector('.stage-name'),line=root.querySelector('.stage-text'),hint=root.querySelector('.stage-hint');
  let queue=[],playing=false,skip=null,generation=0;
  function setSprite(expression){
    const sheet=character.art?.expressions,fallback=character.art?.portrait;
    sprite.classList.toggle('full',!sheet);sprite.style.backgroundImage=sheet||fallback?`url(${sheet||fallback})`:'none';
    const x=['0%','50%','100%'][panel[expression]??1];if(sheet&&sprite.style.backgroundPositionX!==x){sprite.style.backgroundPositionX=x;sprite.classList.remove('swap');void sprite.offsetWidth;sprite.classList.add('swap');}
  }
  function open(){root.hidden=false;document.body.classList.add('stage-open');root.setAttribute('aria-label',character.name+' 的舞台');nameplate.textContent=character.name;setSprite('neutral');if(!line.textContent)line.textContent='她在这里，等你开口。';hint.hidden=true;root.querySelector('.stage-input input').focus();}
  function close(){root.hidden=true;document.body.classList.remove('stage-open');generation++;queue=[];playing=false;skip=null;voice?.stop();button.focus();}
  button.onclick=open;root.querySelector('.stage-close').onclick=close;
  document.addEventListener('keydown',e=>{if(root.hidden)return;if(e.key==='Escape')close();else if((e.key===' '||e.key==='Enter')&&document.activeElement===document.body){e.preventDefault();skip?.();}});
  // Clicking the dialog box finishes the current line, then skips to the next one.
  root.querySelector('.stage-box').onclick=()=>skip?.();
  root.querySelector('.stage-input').onsubmit=e=>{e.preventDefault();const input=e.target.querySelector('input'),value=input.value.trim();if(!value)return;input.value='';
    document.querySelector('#message').value=value;document.querySelector('#chat-form').requestSubmit();line.textContent='……';hint.hidden=true;setSprite('think');};
  const pause=(ms,run)=>new Promise(resolve=>{const t=setTimeout(resolve,ms);skip=()=>{clearTimeout(t);resolve();};if(run!==generation)resolve();});
  async function typeOut(text,run){line.textContent='';hint.hidden=true;let done=false;skip=()=>{done=true;};
    for(const ch of text){if(done||run!==generation)break;line.textContent+=ch;await new Promise(r=>setTimeout(r,26));}line.textContent=text;hint.hidden=false;}
  async function play(){if(playing)return;playing=true;const run=generation;
    while(queue.length&&run===generation){const m=queue.shift();setSprite(m.expression);
      const speaking=voice?.enabled()?voice.say(m.text).catch(()=>{}):null;await typeOut(m.text,run);
      if(speaking)await Promise.race([speaking,new Promise(r=>{skip=()=>{voice.stop();r();};})]);else await pause(Math.min(6000,1200+m.text.length*90),run);}
    if(run===generation){skip=null;playing=false;}}
  document.addEventListener('companion:reply',e=>{if(root.hidden)return;const d=e.detail;
    if(d.silent){line.textContent='（她这次没有回话。）';hint.hidden=true;setSprite('awkward');return;}
    queue.push(...(d.messages||[]).filter(m=>m.type==='text'&&m.text.trim()));void play();});
  return {open,close};
}
