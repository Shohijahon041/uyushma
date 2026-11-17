const { exec } = require('child_process');
const fs = require('fs');

let rawCmd = '';
if (process.argv[2] === '-f' && process.argv[3]) {
    rawCmd = fs.readFileSync(process.argv[3], 'utf8');
} else {
    rawCmd = process.argv.slice(2).join(' ') || 'uptime';
}

const b64 = Buffer.from(rawCmd).toString('base64');
const remoteExec = `echo ${b64} | base64 -d | bash`;

const sshCmd = `ssh -F NUL -i "C:\\Users\\User\\.ssh\\bm_vps_ed25519" -p 22 -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=10 root@189.74.100.25 "${remoteExec}"`;

console.log('Running script/command...');

const child = exec(sshCmd, { timeout: 300000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (err) {
        console.error('Exit code / error:', err.message);
        process.exit(err.code || 1);
    }
    process.exit(0);
});
