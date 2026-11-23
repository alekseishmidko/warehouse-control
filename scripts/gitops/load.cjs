/** @file WMS-604: bounded HTTP receipt load в client Pod параллельно настоящему Argo rollout; secrets идут stdin. */
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { until } = require('./session.cjs');
// Progress — временная IPC metadata, не accepted evidence. Rename исключает чтение половины JSON.
const code = `import f from 'node:fs';import c from 'node:crypto';import p from 'node:path';let raw='';for await(const b of process.stdin)raw+=b;const q=JSON.parse(raw);const root=p.join(q.progressDirectory,'wms-load-');for(const n of ['stop','progress'])f.rmSync(root+n,{force:true});let posted=0,failures=0;const times=[];const deadline=Date.now()+120000;const progress=()=>{f.writeFileSync(root+'tmp',JSON.stringify({posted,failures}));f.renameSync(root+'tmp',root+'progress');};progress();
async function request(path,body,expected){const r=await fetch('http://warehouse-api:3000/api/v1/'+path,{method:'POST',headers:{...q.auth,'Idempotency-Key':c.randomUUID()},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(r.status!==expected)throw Error('HTTP status '+r.status);return r.json();}
while(!f.existsSync(root+'stop')&&Date.now()<deadline&&posted<500){try{const receipt=await request('receipts',{warehouseId:q.fixture.warehouseId,receivingLocationId:q.fixture.receivingLocationId,lines:[{productId:q.fixture.productId,quantity:1}]},201);await request('receipts/'+receipt.id+'/post',{},200);posted++;times.push(Date.now());progress();}catch{failures++;progress();break;}await new Promise(r=>setTimeout(r,100));}const stopped=f.existsSync(root+'stop');console.log(JSON.stringify({posted,failures,stopped,times}));if(failures||!stopped)process.exitCode=1;`;
/** Читает атомарный progress только своего helper Pod; отсутствующий файл — ещё не started, не успешный workload. */
function progress(session) {
  return JSON.parse(
    session.k([
      'exec',
      'gitops-client',
      '--',
      'node',
      '-e',
      "const f=require('node:fs');console.log(f.existsSync('/tmp/wms-load-progress')?f.readFileSync('/tmp/wms-load-progress','utf8'):'null')",
    ]),
  );
}
/** Выполняет change при активном load. Даже при ошибке change останавливает workload и дожидается его результата. */
async function duringLoad(driver, change) {
  const { session } = driver;
  const args = [
    '--kubeconfig',
    session.kubeconfig,
    '--context',
    session.context,
    '-n',
    session.namespace,
    'exec',
    '-i',
    'gitops-client',
    '--',
    'node',
    '--input-type=module',
    '-e',
    code,
  ];
  const child = spawn(session.kubectl, args, {
    env: session.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 150000,
  });
  let diagnostic = '',
    exited;
  let output = '',
    oversized = false,
    inputFailed = false;
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    if (output.length > 1024 * 1024) {
      oversized = true;
      child.kill('SIGTERM');
    }
  });
  child.stderr.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk.toString()).slice(-10000);
  });
  child.stdin.on('error', () => {
    inputFailed = true;
  });
  // Promise всегда resolve status: отказ child проверяется ниже, не теряется как unhandled rejection во время change.
  const completion = new Promise((resolve) => {
    child.once('error', () => {
      exited = -1;
      resolve({ code: -1 });
    });
    child.once('close', (status) => {
      exited = status === null ? -1 : status;
      resolve({ code: status });
    });
  });
  child.stdin.end(
    JSON.stringify({ auth: driver.auth, fixture: driver.fixture, progressDirectory: '/tmp' }),
  );
  let failure, before, after, changed;
  const startedAt = new Date().toISOString();
  try {
    before = await until(
      () => {
        if (exited !== undefined) throw Error('Rolling load exited before progress');
        return progress(session);
      },
      (value) => value?.posted >= 3 || value?.failures > 0,
    );
    assert.equal(before.failures, 0, 'Load must start successfully');
    changed = await change();
    after = progress(session);
    assert.ok(after.posted > before.posted, 'Requests must complete during rollout');
    await until(
      () => {
        if (exited !== undefined) throw Error('Rolling load exited before progress');
        return progress(session);
      },
      (value) => value.posted > after.posted || value.failures > 0,
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      session.k([
        'exec',
        'gitops-client',
        '--',
        'node',
        '-e',
        "require('node:fs').writeFileSync('/tmp/wms-load-stop','stop')",
      ]);
    } catch (error) {
      failure ||= error;
      child.kill('SIGTERM');
    }
  }
  const result = await completion;
  if (result.code !== 0 || oversized || inputFailed) failure ||= Error('Rolling HTTP load failed');
  if (failure) {
    fs.mkdirSync('artifacts/release-drill', { recursive: true });
    fs.writeFileSync('artifacts/release-drill/load-private.log', diagnostic, { mode: 0o600 });
    throw failure;
  }
  const summary = JSON.parse(output.trim());
  assert.equal(summary.failures, 0);
  assert.equal(summary.stopped, true);
  assert.ok(summary.posted > after.posted);
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    posted: summary.posted,
    failures: summary.failures,
    duringRollout: after.posted - before.posted,
    stopped: true,
    change: changed,
  };
}
module.exports = { duringLoad, loadProgram: code };
