import {execFile} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";

const execute = promisify(execFile);
let result;

const hostContracts = () => {
    result ??= execute("docker", ["run", "--rm", "--network", "none", "--read-only",
        "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=128m",
        "--mount", `type=bind,src=${path.resolve(new URL("..", import.meta.url).pathname)},dst=/workspace,readonly`,
        "--workdir", "/workspace", "python:3.12-alpine", "python3", "-B", "-m", "unittest",
        "discover", "-s", "test", "-p", "test_release_host_*.py", "-v"], {timeout: 600000, maxBuffer: 1048576})
        .then(({stdout, stderr}) => `${stdout}${stderr}`);
    return result;
};

export {hostContracts};
