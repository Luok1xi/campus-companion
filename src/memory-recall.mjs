import {terms} from './research-tools.mjs';
// Long-term memory recall. The newest memories always stay in context; older ones come back when the
// current conversation shares words (CJK bigrams, Latin tokens) with them. Lexical, not vector search:
// a memory phrased with entirely different words than the user's message is still not recalled.
export function recallMemories(memories,query,{limit=40,recent=16,text=m=>m.content}={}){
  if(memories.length<=limit)return memories;
  const older=memories.slice(0,-recent),wanted=[...new Set(terms(query))],bags=older.map(m=>new Set(terms(text(m))));
  const weight=new Map(wanted.map(t=>[t,Math.log(1+older.length/(1+bags.filter(b=>b.has(t)).length))]));
  const relevant=older.map((m,i)=>({i,score:wanted.reduce((n,t)=>n+(bags[i].has(t)?weight.get(t):0),0)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.i-a.i).slice(0,limit-recent);
  // Unused slots fall back to the next-newest memories, so an unrelated message keeps the old latest-N view.
  const picked=new Set(relevant.map(x=>x.i));
  for(let i=older.length-1;i>=0&&picked.size<limit-recent;i--)picked.add(i);
  return [...[...picked].sort((a,b)=>a-b).map(i=>older[i]),...memories.slice(-recent)];
}
