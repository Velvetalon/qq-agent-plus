import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNewSessionAudit} from './live/replay-session-audit.mjs';
test('no new session cannot inherit a previous case delivered audit',()=>{
 const data=collectNewSessionAudit(new Set(['prior']),[{id:'prior'}],()=>({id:'prior',socialAudit:{delivered:true}}));
 assert.equal(data.sessionId,null);assert.equal(data.socialAudit,null);assert.equal(data.outbound,null);assert.deepEqual(data.createdSessionIds,[]);
});
test('waiting follow-up does not replace this wake actual Social run audit',()=>{
 const all={old:{id:'old',socialAudit:{delivered:true}},waiting:{id:'waiting',status:'waiting'},active:{id:'active',status:'done',socialAudit:{dispatchBlocked:'target-withdrawn-or-updated',delivered:false}}};
 const data=collectNewSessionAudit(new Set(['old']),[{id:'waiting'},{id:'active'},{id:'old'}],id=>all[id]);
 assert.equal(data.sessionId,'active');assert.equal(data.socialAudit.delivered,false);assert.equal(data.socialAudit.dispatchBlocked,'target-withdrawn-or-updated');assert.deepEqual(data.createdSessionIds,['waiting','active']);
});
