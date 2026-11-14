const fs = require('node:fs/promises');
const path = require('node:path');

async function prepareExamples(source, userData) {
  const destination = path.join(userData, 'examples');
  await fs.mkdir(destination, { recursive: true });
  // Never overwrite examples that the user or Agent has already edited.
  await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: false });
  return destination;
}
module.exports = { prepareExamples };
