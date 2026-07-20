const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function collect(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full, out);
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const files = collect(path.join(__dirname, '..', 'js'));
for (const file of files) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(file),
        stdio: ['pipe', 'inherit', 'inherit']
    });
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`JS syntax OK (${files.length} files)`);
