/** @file WMS-603: настоящий read-only Git HTTP source внутри kind; в repo попадают только chart, values и ciphertext. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hash } = require('./tools.cjs');
const repositoryURL = 'http://git-source.warehouse-dev.svc.cluster.local:8080/repo.git';
/** Фиксированный server не исполняет hooks/CGI и не обслуживает файлы вне mount; Secret/key в mount отсутствуют. */
const server = `const h=require('node:http'),f=require('node:fs'),p=require('node:path');
h.createServer((q,r)=>{if(q.method!=='GET'){r.writeHead(405).end();return;}let name;try{name=decodeURIComponent(new URL(q.url,'http://local').pathname);}catch{r.writeHead(400).end();return;}const file=p.resolve('/git','.'+name);if(!file.startsWith('/git/repo.git/')){r.writeHead(404).end();return;}try{const s=f.statSync(file);if(!s.isFile()){r.writeHead(404).end();return;}r.setHeader('Content-Length',s.size);f.createReadStream(file).on('error',()=>r.destroy()).pipe(r);}catch{r.writeHead(404).end();}}).listen(8080,'0.0.0.0');`;
/** Создаёт отдельный Git, не меняя .git рабочего checkout. Имя/пароль/ключ оператора туда не копируются. */
function createSource(session, webImage, encrypted) {
  const root = path.join(session.directory, 'git-work');
  const bare = path.join(session.directory, 'repo.git');
  fs.mkdirSync(root);
  const git = (args, cwd = root) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  git(['init']);
  git(['config', 'user.name', 'Synthetic GitOps Operator']);
  git(['config', 'user.email', 'gitops@example.invalid']);
  // Whitelist copy вместо копирования checkout: .env, credentials и original .git недоступны Git server.
  fs.mkdirSync(path.join(root, 'infra/helm'), { recursive: true });
  fs.cpSync(path.resolve('infra/helm/warehouse'), path.join(root, 'infra/helm/warehouse'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, 'infra/kubernetes'), { recursive: true });
  fs.copyFileSync(
    'infra/kubernetes/postgres-dev.yaml',
    path.join(root, 'infra/kubernetes/postgres-dev.yaml'),
  );
  const environment = path.join(root, 'environments/local');
  fs.mkdirSync(environment, { recursive: true });
  fs.writeFileSync(path.join(environment, 'secrets.enc.json'), encrypted, { mode: 0o600 });
  function files(directory, prefix = '') {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      return entry.isDirectory() ? files(path.join(directory, entry.name), relative) : [relative];
    });
  }
  /** Каждый update публикует новый Git commit и immutable ConfigMap; mounted Git никогда не содержит plaintext. */
  function publish(values, note) {
    fs.writeFileSync(path.join(environment, 'values.yaml'), JSON.stringify(values, null, 2));
    git(['add', 'infra/helm/warehouse', 'infra/kubernetes', 'environments/local']);
    git(['commit', '--allow-empty', '-m', note]);
    const commit = git(['rev-parse', 'HEAD']);
    if (!fs.existsSync(bare)) git(['clone', '--bare', root, bare]);
    else git(['fetch', root, '+HEAD:refs/heads/main'], bare);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare);
    // Первый init может выбрать master; явно создаём main для одного одинакового wire-контракта.
    git(['update-ref', 'refs/heads/main', commit], bare);
    git(['update-server-info'], bare);
    const entries = files(bare).filter(
      (file) => !file.startsWith('hooks/') && !file.startsWith('logs/'),
    );
    const binaryData = {},
      items = [];
    entries.forEach((file, index) => {
      const key = 'file' + index;
      binaryData[key] = fs.readFileSync(path.join(bare, file)).toString('base64');
      items.push({ key, path: 'repo.git/' + file });
    });
    if (Buffer.byteLength(JSON.stringify(binaryData)) > 900000)
      throw Error('Synthetic Git source exceeds ConfigMap capacity');
    const name = 'git-source-' + hash(Buffer.from(commit)).slice(0, 12);
    session.apply({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name },
      immutable: true,
      binaryData,
    });
    session.apply({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'git-source' },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: 'git-source' } },
        template: {
          metadata: { labels: { app: 'git-source' } },
          spec: {
            automountServiceAccountToken: false,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              seccompProfile: { type: 'RuntimeDefault' },
            },
            containers: [
              {
                name: 'git',
                image: webImage,
                imagePullPolicy: 'Never',
                command: ['node', '-e', server],
                securityContext: {
                  readOnlyRootFilesystem: true,
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ['ALL'] },
                },
                resources: {
                  requests: { cpu: '50m', memory: '64Mi' },
                  limits: { cpu: '500m', memory: '128Mi' },
                },
                readinessProbe: { httpGet: { path: '/repo.git/HEAD', port: 8080 } },
                volumeMounts: [{ name: 'source', mountPath: '/git', readOnly: true }],
              },
            ],
            volumes: [{ name: 'source', configMap: { name, items } }],
          },
        },
      },
    });
    session.apply({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'git-source' },
      spec: { selector: { app: 'git-source' }, ports: [{ port: 8080 }], type: 'ClusterIP' },
    });
    session.k(['rollout', 'status', 'deployment/git-source', '--timeout=120s']);
    return commit;
  }
  return { root, git, publish, repositoryURL };
}
module.exports = { createSource, repositoryURL };
