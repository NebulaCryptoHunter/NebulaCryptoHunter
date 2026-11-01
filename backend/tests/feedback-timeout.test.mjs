import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('let scanFeedbackDismissTimer=null;'),html.indexOf('const Scanner = (()=>{'));

test('scan feedback disappears after ten seconds and newer notices restart the timer',()=>{
 const element={hidden:true,textContent:''},timers=new Map();let next=0;
 const show=new Function('$','setTimeout','clearTimeout',source+';return showScanFeedback')(
  ()=>element,
  (fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id},
  id=>timers.delete(id)
 );
 show('Sync complete');assert.equal(element.hidden,false);assert.equal(element.textContent,'Sync complete');
 assert.equal(timers.get(1).ms,10000);
 show('New notice');assert.equal(timers.has(1),false);assert.equal(timers.size,1);
 assert.equal(timers.get(2).ms,10000);assert.equal(element.textContent,'New notice');
 timers.get(2).fn();assert.equal(element.hidden,true);
});

test('feedback helper tolerates a missing status element',()=>{
 const show=new Function('$','setTimeout','clearTimeout',source+';return showScanFeedback')(
  ()=>null,()=>assert.fail('No timer should be created'),()=>{}
 );
 assert.doesNotThrow(()=>show('Sync'));
});
