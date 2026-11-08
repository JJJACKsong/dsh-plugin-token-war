import test from 'node:test';import assert from 'node:assert/strict';
import {createStore,SAVE_KEY,BACKUP_KEY,LOCK_KEY} from '../lib/storage.js';
import {createGame} from '../lib/game.js';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),data};};
test('valid main save and backup can be recovered',()=>{const m=memory(),s=createStore(m),g=createGame();s.save(g,1);s.save(g,2);assert.equal(s.load().savedAt,2);m.setItem(SAVE_KEY,'broken');assert.equal(s.load().savedAt,1);assert.equal(s.load().recovered,true);assert.equal(m.getItem(SAVE_KEY+'.corrupt'),'broken');});
test('unavailable local storage degrades without throwing',()=>{const s=createStore({getItem(){throw Error();},setItem(){throw Error();}});assert.equal(s.load().state,null);assert.equal(s.save(createGame(),0),false);assert.equal(s.available,false);});
test('fallback lease excludes a second owner until released',()=>{const m=memory(),a=createStore(m),b=createStore(m);assert.equal(a.lease('a',100),true);assert.equal(b.lease('b',100),false);a.release('a');assert.equal(b.lease('b',200),true);assert.equal(a.owns('a',201),false);});
test('fallback lease expires after abandoned page',()=>{const m=memory(),s=createStore(m);s.lease('a',100);assert.equal(s.lease('b',15101),true);assert.equal(s.owns('b',15102),true);});
test('saving does not overwrite unrelated data',()=>{const m=memory();m.setItem('user-project','keep');createStore(m).save(createGame(),100);assert.equal(m.getItem('user-project'),'keep');});
