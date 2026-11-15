const target = process.argv[2];
if (!['win32', 'darwin', 'linux'].includes(target) || target !== process.platform) {
  console.error(`Build ${target} packages on a native ${target} host or the Desktop Platforms CI runner. Current host: ${process.platform}/${process.arch}.`);
  process.exitCode = 1;
}
