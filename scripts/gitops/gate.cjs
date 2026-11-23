/** @file WMS-603: реальный Argo/SOPS/Git drift/failed migration gate; target всегда новый local kind ARM64. */
const { runRehearsal } = require('./rehearsal.cjs');
if (require.main === module)
  runRehearsal('gitops-gate').catch((error) => {
    console.error('GitOps gate failed: ' + error.message);
    process.exitCode = 1;
  });
