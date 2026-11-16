const { execSync } = require('child_process');
const path = require('path');
const keyPath = path.join(process.env.USERPROFILE, '.ssh', 'bm_vps_ed25519');

const cmd = process.argv[2] || 'uptime';

for (let i = 1; i <= 6; i++) {
    try {
        const out = execSync(`ssh -i "${keyPath}" -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@189.74.100.25 "${cmd}"`, { stdio: 'pipe' }).toString();
        console.log(out.trim());
        process.exit(0);
    } catch (e) {
        const s = Date.now();
        while (Date.now() - s < 3000) {}
    }
}
process.exit(1);
