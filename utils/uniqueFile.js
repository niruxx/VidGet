const fs = require('fs');
const path = require('path');

async function getUniqueDestination(dir, baseName, ext) {
  let candidate = path.join(dir, `${baseName}${ext}`);
  let n = 1;
  while (await fs.promises.access(candidate).then(() => true).catch(() => false)) {
    candidate = path.join(dir, `${baseName} (${n})${ext}`);
    n++;
  }
  return candidate;
}

module.exports = { getUniqueDestination };
