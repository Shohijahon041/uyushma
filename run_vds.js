const { spawn } = require('child_process');
const fs = require('fs');

let rawCmd = '';
if (process.argv[2] === '-f' && process.argv[3]) {
  rawCmd = fs.readFileSync(process.argv[3], 'utf8');
} else {
  rawCmd = process.argv.slice(2).join(' ') || 'uptime';
}

const sshArgs = [
  '-F', 'NUL',
  '-i', 'C:\\Users\\User\\.ssh\\bm_vps_ed25519',
  '-p', '22',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=10',
  'root@189.74.100.25',
  'bash -s'
];

console.log('Running script/command...');
const child = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

child.stdout.on('data', d => process.stdout.write(d));
child.stderr.on('data', d => process.stderr.write(d));

child.on('close', code => {
  if (code !== 0) {
    console.error('Exit code:', code);
    process.exit(code || 1);
  }
  process.exit(0);
});

child.stdin.write(rawCmd);
child.stdin.end();
