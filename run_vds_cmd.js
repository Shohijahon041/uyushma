const { execSync } = require('child_process');
const path = require('path');
const keyPath = path.join(process.env.USERPROFILE, '.ssh', 'bm_vps_ed25519');

const fs = require('fs');
let cmd = process.argv[2];

if (!cmd) {
    try {
        cmd = fs.readFileSync(0, 'utf8');
    } catch (e) {
        cmd = 'uptime';
    }
} else if (fs.existsSync(cmd)) {
    cmd = fs.readFileSync(cmd, 'utf8');
}
if (!cmd || !cmd.trim()) cmd = 'uptime';

const b64 = Buffer.from(cmd, 'utf8').toString('base64');
const remoteCmd = `echo ${b64} | base64 -d | bash`;

for (let i = 1; i <= 3; i++) {
    try {
        const out = execSync(`ssh -i "${keyPath}" -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@189.74.100.25 "${remoteCmd}"`, { stdio: 'pipe' }).toString();
        console.log(out.trim());
        process.exit(0);
    } catch (e) {
        if (e.stdout) console.log(e.stdout.toString());
        if (e.stderr) console.error(e.stderr.toString());
        const s = Date.now();
        while (Date.now() - s < 1000) {}
    }
}
process.exit(1);
