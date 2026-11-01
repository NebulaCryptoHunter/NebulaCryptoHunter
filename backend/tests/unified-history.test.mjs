import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {unifiedHistory} from '../workers/research-api.mjs';

function fixtureDB(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec([
  'CREATE TABLE predictions(id INTEGER PRIMARY KEY,token_ca TEXT,token_name TEXT,token_symbol TEXT,decision TEXT,ai_score REAL,created_at TEXT,version TEXT,learning_status TEXT);',
  'CREATE TABLE prediction_candidates(id INTEGER PRIMARY KEY,mint TEXT,pair_address TEXT,observed_at TEXT,decision TEXT,ai_score REAL,model TEXT);',
  'CREATE TABLE scanner_snapshots(id INTEGER PRIMARY KEY,mint TEXT,pair_address TEXT,observed_at TEXT,payload_json TEXT,UNIQUE(mint,pair_address,observed_at));',
  'CREATE TABLE candidate_evaluations(id INTEGER PRIMARY KEY,candidate_id INTEGER UNIQUE,status TEXT,roi_pct REAL);',
  "INSERT INTO predictions VALUES (1,'legacyMint','Old Token','OLD','AVOID',12,'2026-10-26 12:00:00','V108','PENDING');",
  "INSERT INTO predictions VALUES (2,'legacyMint2','Old Two','OLD2','WATCH',33,'2026-10-26 12:05:00','V108','EVALUATED');",
  "INSERT INTO prediction_candidates VALUES (1,'scannerMint','pairAlpha','2026-11-01T07:50:00.000Z','WATCH',41,'heuristic-v1');",
  "INSERT INTO scanner_snapshots VALUES (5,'scannerMint','pairAlpha','2026-11-01T07:50:00.000Z','{\"base\":{\"symbol\":\"NEW\"}}');",
  "INSERT INTO candidate_evaluations VALUES (3,1,'COMPLETED',-14.2);"
 ].join('\n'));
 sqlite.exec(fs.readFileSync('backend/migrations/0010_nebula_unified_read_model.sql','utf8'));
 const adapter={
  prepare(sql){
   let args=[];
   return {
    bind(...v){args=v;return this},
    all(){return {results:sqlite.prepare(sql).all(...args)}}
   };
  },
  async batch(statements){return statements.map(s=>s.all())}
 };
 return {sqlite,adapter};
}

test('canonical read view contains every historical and scanner record, without duplicating snapshots',async()=>{
 const {sqlite,adapter}=fixtureDB();
 try{
  const total=sqlite.prepare('SELECT COUNT(*) AS n FROM nebula_unified_records_v1').get().n;
  assert.equal(total,3); // 2 legacy + 1 candidate, not +1 snapshot
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM predictions').get().n,2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM scanner_snapshots').get().n,1);
  const result=await unifiedHistory(adapter,{limit:25,offset:0});
  assert.equal(result.total,3);
  assert.equal(result.source,'nebula-db');
  assert.deepEqual(result.items.map(x=>x.record_key),['scanner:1','legacy:2','legacy:1']);
  assert.deepEqual(result.items.map(x=>x.record_source),['SCANNER','LEGACY','LEGACY']);
  assert.equal(result.items[0].symbol,'NEW');
  assert.equal(result.items[0].roi_pct,-14.2);
  assert.equal(result.items[0].evaluation_status,'COMPLETED');
  assert.equal(result.items[2].roi_pct,null);
  assert.equal(result.items[2].evaluation_status,'PENDING');
  // Both source tables have ID=1. Prefix prevents accidental record-key collisions.
  assert.equal(new Set(result.items.map(x=>x.record_key)).size,3);
 }finally{sqlite.close()}
});
test('unified D1 history paginates deterministically and clamps arbitrary limit/offset',async()=>{
 const {sqlite,adapter}=fixtureDB();
 try{
  const first=await unifiedHistory(adapter,{limit:1,offset:0});
  const second=await unifiedHistory(adapter,{limit:1,offset:1});
  assert.deepEqual(first.items.map(x=>x.record_key),['scanner:1']);
  assert.deepEqual(second.items.map(x=>x.record_key),['legacy:2']);
  assert.equal(second.total,3);
  const bounded=await unifiedHistory(adapter,{limit:100000,offset:-3});
  assert.equal(bounded.limit,100);
  assert.equal(bounded.offset,0);
  assert.equal(bounded.items.length,3);
 }finally{sqlite.close()}
});
