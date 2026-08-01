import { spawn } from "node:child_process";

export interface GitCommandResult {
  exitCode: number;
  output: string;
}

export type GitCommand = (
  args: string[],
  cwd: string,
  maxOutputBytes?: number
) => Promise<GitCommandResult>;

export function createGitCommand(environment: NodeJS.ProcessEnv): GitCommand {
  const commandEnvironment = { ...environment, GIT_OPTIONAL_LOCKS: "0" };
  return (args, cwd, maxOutputBytes = 32_000) => new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      env: commandEnvironment
    });

    let output = "";
    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > maxOutputBytes) {
        output = output.slice(output.length - maxOutputBytes);
      }
    };

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, output });
    });
  });
}
