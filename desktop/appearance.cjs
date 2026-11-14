const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function createBackgroundStore(directory) {
  const file = path.join(directory, 'background.webp');
  return {
    save(data) {
      if (typeof data !== 'string' || data.length > 3 * 1024 * 1024 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(data)) throw new Error('Invalid background image');
      const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
      if (bytes.length > 2 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw new Error('Expected a WebP background');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(file + '.tmp', bytes); fs.renameSync(file + '.tmp', file);
      return digest(bytes);
    },
    read(id) {
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null;
      try {
        if (fs.statSync(file).size > 2 * 1024 * 1024) return null;
        const bytes = fs.readFileSync(file);
        return digest(bytes) === id ? `data:image/webp;base64,${bytes.toString('base64')}` : null;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    remove(id) { if (this.read(id)) fs.unlinkSync(file); },
  };
}
module.exports = { createBackgroundStore };
