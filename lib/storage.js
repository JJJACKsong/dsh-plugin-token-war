import {readSave,makeSave} from './game.js';
export const SAVE_KEY='dshtoken-war.save.v1';
export const BACKUP_KEY=SAVE_KEY+'.backup';
export const LOCK_KEY=SAVE_KEY+'.lease';
export const SIGNAL_KEY=SAVE_KEY+'.signal';
export function createStore(storage) {
  let available=true;
  const get=k=>{try{return storage.getItem(k);}catch{available=false;return null;}};
  const put=(k,v)=>{try{storage.setItem(k,v);return true;}catch{available=false;return false;}};
  return {
    get available(){return available;},get,put,
    load(){
      let error=null;
      for(const key of [SAVE_KEY,BACKUP_KEY]){
        const raw=get(key);if(!raw)continue;
        try{return {...readSave(raw),recovered:key===BACKUP_KEY,error};}catch(e){
          error=e.message;if(key===SAVE_KEY)put(SAVE_KEY+'.corrupt',raw.slice(0,200000));
        }
      }
      return {state:null,error};
    },
    save(state,wall){
      const text=makeSave(state,wall),prev=get(SAVE_KEY);
      if(prev){try{readSave(prev);put(BACKUP_KEY,prev);}catch{}}
      return put(SAVE_KEY,text);
    },
    lease(owner,now){
      let old;try{old=JSON.parse(get(LOCK_KEY));}catch{}
      if(old&&old.owner!==owner&&old.expires>now)return false;
      if(!put(LOCK_KEY,JSON.stringify({owner,expires:now+15000})))return true;
      try{return JSON.parse(get(LOCK_KEY)).owner===owner;}catch{return false;}
    },
    owns(owner,now){
      if(!available)return true;
      try{const l=JSON.parse(get(LOCK_KEY));return l?.owner===owner&&l.expires>now;}catch{return false;}
    },
    release(owner){
      try{const l=JSON.parse(get(LOCK_KEY));if(l?.owner===owner)storage.removeItem(LOCK_KEY);}catch{}
      put(SIGNAL_KEY,JSON.stringify({owner,at:Date.now()}));
    },
  };
}
