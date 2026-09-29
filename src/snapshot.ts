import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { inside, safeRelativePath } from "./config.js";

const exec = promisify(execFile);

async function git(repo: string, args: string[]): Promise<Buffer> {
  const { stdout } = await exec("git", args, { cwd: repo, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  return stdout as Buffer;
}

export async function resolveBase(repo: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith("-")) throw new Error("Invalid base ref");
  const sha = (await git(repo, ["rev-parse", "--verify", `${ref}^{commit}`])).toString("utf8").trim();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("Could not resolve base commit");
  return sha;
}

export async function copyBaseWiki(repo: string, sha: string, wiki: string, destination: string): Promise<void> {
  const output = await git(repo, ["ls-tree", "-r", "-z", sha, "--", wiki]);
  const entries = output.toString("utf8").split("\0").filter(Boolean);
  if (entries.length === 0) throw new Error(`No files in ${wiki} at base ${sha.slice(0, 8)}`);
  for (const entry of entries) {
    const match = /^(100644|100755) blob [0-9a-f]+\t(.*)$/s.exec(entry);
    if (!match) throw new Error("Git baseline contains a symlink, submodule, or unsupported entry");
    const name = match[2]!;
    if (!name.startsWith(`${wiki}/`)) continue;
    const subpath = name.slice(wiki.length + 1);
    if (!safeRelativePath(subpath)) throw new Error(`Unsafe Git path: ${name}`);
    const target = inside(destination, subpath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await git(repo, ["show", `${sha}:${name}`]));
  }
}

export async function copyWorkingWiki(repo: string, wiki: string, destination: string): Promise<void> {
  const source = resolve(repo, wiki);
  const root = resolve(repo);
  if (!source.startsWith(`${root}/`)) throw new Error("Wiki path escapes repository");
  if (!(await lstat(source)).isDirectory()) throw new Error("Wiki must be a directory");
  async function walk(directory: string): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const from = join(directory, item.name);
      const rel = relative(source, from).split("\\").join("/");
      const to = inside(destination, rel);
      if (item.isSymbolicLink()) throw new Error(`Symlinks are not allowed in wiki: ${rel}`);
      if (item.isDirectory()) {
        await mkdir(to, { recursive: true });
        await walk(from);
      } else if (item.isFile()) {
        await mkdir(dirname(to), { recursive: true });
        await writeFile(to, await readFile(from));
      } else {
        throw new Error(`Unsupported wiki entry: ${rel}`);
      }
    }
  }
  await walk(source);
}
