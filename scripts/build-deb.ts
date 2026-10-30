/**
 * Compiles the standalone binary and packages it as
 * dist/wt61-driver_<version>_<arch>.deb, for each architecture.
 *
 *   bun run package:deb          # amd64 and arm64
 *   bun run package:deb arm64    # one of them
 *
 * The package installs /usr/bin/wt61-driver, the systemd unit
 * (packaging/wt61-driver.service) and /etc/default/wt61.conf (a conffile, from
 * etc/configs/config.sample.conf; the binary reads it by default). The unit is
 * not enabled or started: packaging/debian/postinst.
 *
 * Needs GNU tar, not dpkg: the .deb (an ar archive) is written here.
 */
import { $ } from 'bun'
import { chmod, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import pkg from '../package.json'

/** Debian architecture → Bun target. x64 baseline runs without AVX2 (older Atom/Celeron). */
const TARGETS = {
  amd64: 'bun-linux-x64-baseline',
  arm64: 'bun-linux-arm64',
} as const
type Arch = keyof typeof TARGETS

const NAME = 'wt61-driver'
const ROOT = path.join(import.meta.dir, '..')
const DIST = path.join(ROOT, 'dist')

const args = process.argv.slice(2)
for (const arg of args) {
  if (!(arg in TARGETS)) throw new Error(`unknown architecture ${arg} (${Object.keys(TARGETS).join(', ')})`)
}
for (const arch of (args.length > 0 ? args : Object.keys(TARGETS)) as Arch[]) {
  console.log(`wrote ${path.relative(ROOT, await buildDeb(arch))}`)
}

async function buildDeb(arch: Arch): Promise<string> {
  const work = path.join(DIST, arch)
  const data = path.join(work, 'data')
  const control = path.join(work, 'control')
  await rm(work, { recursive: true, force: true })

  // data: the files dpkg installs
  const bin = path.join(data, 'usr/bin', NAME)
  await $`bun build ./index.ts --compile --target=${TARGETS[arch]} --outfile ${bin}`.cwd(ROOT)
  await chmod(bin, 0o755)
  await install('packaging/wt61-driver.service', path.join(data, 'usr/lib/systemd/system/wt61-driver.service'), 0o644)
  await install('etc/configs/config.sample.conf', path.join(data, 'etc/default/wt61.conf'), 0o644)

  // control: the metadata and the maintainer scripts
  for (const script of ['postinst', 'prerm', 'postrm']) {
    await install(`packaging/debian/${script}`, path.join(control, script), 0o755)
  }
  await install('packaging/debian/conffiles', path.join(control, 'conffiles'), 0o644)
  await Bun.write(path.join(control, 'control'), controlFile(arch, installedSizeKb(data)))

  await tarGz(control, path.join(work, 'control.tar.gz'))
  await tarGz(data, path.join(work, 'data.tar.gz'))

  const deb = path.join(DIST, `${NAME}_${pkg.version}_${arch}.deb`)
  await writeAr(deb, [
    ['debian-binary', '2.0\n'],
    ['control.tar.gz', await Bun.file(path.join(work, 'control.tar.gz')).bytes()],
    ['data.tar.gz', await Bun.file(path.join(work, 'data.tar.gz')).bytes()],
  ])
  return deb
}

function controlFile(arch: Arch, installedSize: number): string {
  return [
    `Package: ${NAME}`,
    `Version: ${pkg.version}`,
    `Architecture: ${arch}`,
    `Maintainer: ${pkg.author}`,
    `Installed-Size: ${installedSize}`,
    // the newest glibc symbol either binary links (objdump -T); Bun embeds the rest
    'Depends: libc6 (>= 2.17)',
    'Section: misc',
    'Priority: optional',
    `Description: ${pkg.description}`,
    ' Reads a WitMotion WT61 (WT61C-TTL) IMU over serial and serves its samples',
    ' as NDJSON over TCP for microservice.hm. The systemd unit is installed but',
    ' not enabled: sudo systemctl enable --now wt61-driver',
    '',
  ].join('\n')
}

async function install(from: string, to: string, mode: number) {
  await mkdir(path.dirname(to), { recursive: true })
  await Bun.write(to, Bun.file(path.join(ROOT, from)))
  await chmod(to, mode)
}

/** In KiB, as dpkg counts it: each file rounded up. */
function installedSizeKb(dir: string): number {
  let kb = 0
  for (const file of new Bun.Glob('**').scanSync({ cwd: dir })) {
    kb += Math.ceil(Bun.file(path.join(dir, file)).size / 1024)
  }
  return kb
}

/** Owned by root, and modes that do not depend on the builder's umask. */
async function tarGz(dir: string, out: string) {
  await $`tar --create --gzip --file=${out} --sort=name --owner=0 --group=0 --numeric-owner --mode=u+rwX,go+rX,go-w --directory=${dir} .`
}

/** A .deb is an ar archive of these three members, in this order. */
async function writeAr(out: string, members: [name: string, data: string | Uint8Array<ArrayBuffer>][]) {
  const mtime = Math.floor(Date.now() / 1000)
  const parts: (string | Uint8Array<ArrayBuffer>)[] = ['!<arch>\n']
  for (const [name, data] of members) {
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length
    // name, mtime, uid, gid, mode (octal), size, then the magic `\n
    parts.push(
      name.padEnd(16) + String(mtime).padEnd(12) + '0'.padEnd(6) + '0'.padEnd(6) +
        '100644'.padEnd(8) + String(size).padEnd(10) + '`\n',
      data,
    )
    if (size % 2 === 1) parts.push('\n')
  }
  await Bun.write(out, new Blob(parts))
}
