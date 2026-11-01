import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {researchData} from '../backend/workers/research-api.mjs';

test('D1 latest research uses bounded recent rows and preserves newest unique Solana pairs',async()=>{
 const queries=[];
 const db={
  prepare(sql){return {sql}},
  async batch(statements){
   queries.push(...statements.map(s=>s.sql));
   if(statements.length===1)return [{results:[{database_records:100,total_records:20,unique_mints:12}]}];
   return [
    {results:[
     {id:5,mint:'mintA',pair_address:'pool1',observed_at:'2026-11-02T01:00:00Z',score:55},
     {id:4,mint:'mintA',pair_address:'pool1',observed_at:'2026-11-01T22:00:00Z',score:41},
     {id:3,mint:'mintB',pair_address:'pool2',observed_at:'2026-11-01T23:00:00Z',score:33},
     {id:2,mint:'mintA',pair_address:'poolX',observed_at:'2026-11-01T12:00:00Z',score:22}
    ]},
    {results:[{id:1,status:'COMPLETED'}]},
    {results:[]},
    {results:[]}
   ];
  }
 };
 const result=await researchData(db);
 assert.deepEqual(result.items.map(x=>[x.mint,x.pair_address,x.id]),[
  ['mintA','pool1',5],['mintB','pool2',3],['mintA','poolX',2]]);
 assert.equal(result.counts.database_records,100);
 const latest=queries.find(q=>q.includes('FROM (SELECT * FROM scanner_snapshots'));
 assert.ok(latest,'The latest scanner query must be bounded');
 assert.match(latest,/ORDER BY id DESC LIMIT 800/);
 assert.match(latest,/ORDER BY x\.id DESC LIMIT 1/);
 assert.doesNotMatch(latest,/WHERE s\.observed_at=\(SELECT MAX/);
 assert.ok(!latest.includes('SELECT * FROM scanner_snapshots s LEFT JOIN'),'Avoid unbounded primary source');
});

test('public research cache budgets do not exceed a 10 minute latest query and 30 minute history',()=>{
 const gateway=readFileSync(new URL('../backend/workers/frontend-gateway.mjs',import.meta.url),'utf8');
 const research=readFileSync(new URL('../backend/workers/research-api.mjs',import.meta.url),'utf8');
 assert.match(gateway,/researchData\(env\.RESEARCH_DB\)[\s\S]{0,220}freshMs:600000/);
 assert.match(gateway,/unifiedHistory\(env\.RESEARCH_DB,\{limit,offset\}\),\{freshMs:1800000\}/);
 assert.match(research,/canonical-d1-aggregate-v2/);
 assert.match(research,/public,max-age=21600/);
 assert.match(research,/countsAsOf/);
});

test('only evaluation Worker invokes research evaluator on 30 minute scheduled triggers',()=>{
 const scanner=readFileSync(new URL('../backend/workers/nebula-scanner.mjs',import.meta.url),'utf8');
 const evalWorker=readFileSync(new URL('../backend/workers/nebula-evaluation.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(scanner,/evaluateResearch\(env\.STAGE_DB\)/);
 assert.match(scanner,/await runScheduledScan\(event,env\)/);
 assert.match(evalWorker,/evaluateResearch\(env\.RESEARCH_DB\)/);
});

test('scanner Wrangler resolves its main relative to backend and preserves required secret names',()=>{
 const config=JSON.parse(readFileSync(new URL('../backend/wrangler.scanner.jsonc',import.meta.url),'utf8'));
 assert.equal(config.name,'nebula-scanner');
 assert.ok(existsSync(new URL('../backend/'+config.main,import.meta.url)));
 assert.deepEqual(config.secrets.required,['INTERNAL_TOKEN','MANUAL_SCAN_TOKEN']);
 assert.equal(config.d1_databases[0].database_name,'nebula-db');
 assert.deepEqual(config.triggers.crons,['*/30 * * * *']);
});
