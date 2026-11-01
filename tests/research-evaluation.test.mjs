import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {evaluateResearch} from '../backend/workers/research-evaluation.mjs';
function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE scanner_snapshots(id INTEGER PRIMARY KEY,mint TEXT,pair_address TEXT,observed_at TEXT,payload_json TEXT);CREATE TABLE prediction_candidates(id INTEGER PRIMARY KEY,mint TEXT,pair_address TEXT,observed_at TEXT);`);
 db.exec(fs.readFileSync('backend/migrations/0007_candidate_evaluations.sql','utf8'));
 const adapter={prepare(sql){return {async run(){return {meta:{changes:db.prepare(sql).run().changes}}}}}};
 const snapshot=(id,time,price,pair='pair',payload={})=>db.prepare('INSERT INTO scanner_snapshots VALUES(?,?,?,?,?)').run(id,'mint',pair,time,JSON.stringify({priceUsd:price,base:{mint:'mint'},pairAddress:pair,...payload}));
 return {db,adapter,snapshot};
}
test('evaluation uses first valid same-pool future observation and is idempotent',async()=>{
 const {db,adapter,snapshot}=setup();
 snapshot(1,'2026-10-27T10:00:00Z',2);snapshot(2,'2026-10-27T10:30:00Z',99,'other');snapshot(3,'2026-10-27T10:31:00Z',3);
 db.exec("INSERT INTO prediction_candidates VALUES(1,'mint','pair','2026-10-27T10:00:00Z')");
 assert.equal((await evaluateResearch(adapter)).inserted,1);assert.equal((await evaluateResearch(adapter)).inserted,0);
 const e=db.prepare('SELECT * FROM candidate_evaluations').get();assert.equal(e.roi_pct,50);assert.equal(e.exit_snapshot_id,3);assert.equal(e.window_seconds,1860);assert.equal(e.model,'observed-return-v2');db.close();
});
test('missing later observation does not fabricate an evaluation',async()=>{const {db,adapter}=setup();assert.equal((await evaluateResearch(adapter)).inserted,0);db.close()});
test('invalid prices, malformed JSON, payload identity mismatch and wrong horizons are excluded',async()=>{
 for(const bad of ['2',true,null,-1]){const {db,adapter,snapshot}=setup();snapshot(1,'2026-10-27T10:00:00Z',bad);snapshot(2,'2026-10-27T10:31:00Z',3);db.exec("INSERT INTO prediction_candidates VALUES(1,'mint','pair','2026-10-27T10:00:00Z')");assert.equal((await evaluateResearch(adapter)).inserted,0);db.close()}
 const {db,adapter,snapshot}=setup();snapshot(1,'2026-10-27T10:00:00Z',2);snapshot(2,'2026-10-27T10:20:00Z',9);snapshot(3,'2026-10-27T10:31:00Z',9,'pair',{base:{mint:'other'}});snapshot(4,'2026-10-27T11:31:00Z',9);snapshot(5,'2099-10-27T10:31:00Z',9);snapshot(6,'2026-10-27T10:32:00Z','abc');
 db.exec("INSERT INTO scanner_snapshots VALUES(7,'mint','pair','2026-10-27T10:33:00Z','broken JSON');INSERT INTO prediction_candidates VALUES(1,'mint','pair','2026-10-27T10:00:00Z')");
 assert.equal((await evaluateResearch(adapter)).inserted,0);db.close();
});
test('same-time ties have a stable snapshot id and future-dated candidates never evaluate',async()=>{
 const {db,adapter,snapshot}=setup();snapshot(1,'2026-10-27T10:00:00Z',2);snapshot(2,'2026-10-27T10:30:00Z',3);snapshot(3,'2026-10-27T10:30:00Z',99);
 db.exec("INSERT INTO prediction_candidates VALUES(1,'mint','pair','2026-10-27T10:00:00Z')");await evaluateResearch(adapter);assert.equal(db.prepare('SELECT exit_snapshot_id FROM candidate_evaluations').get().exit_snapshot_id,2);
 snapshot(4,'2099-10-27T10:00:00Z',2);snapshot(5,'2099-10-27T10:30:00Z',3);db.exec("INSERT INTO prediction_candidates VALUES(2,'mint','pair','2099-10-27T10:00:00Z')");assert.equal((await evaluateResearch(adapter)).inserted,0);db.close();
});
