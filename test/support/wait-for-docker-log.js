import {execFileSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";

const dockerOutput = (argumentsList, deadline, containerName, marker) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for ${marker} from ${containerName}.`);
    try {
        return execFileSync("docker", argumentsList, {encoding: "utf8", timeout: remaining});
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ETIMEDOUT") {
            throw new Error(`Timed out waiting for ${marker} from ${containerName}.`, {cause: error});
        }
        throw error;
    }
};

const waitForDockerLog = async (containerName, marker, timeoutMilliseconds) => {
    const deadline = Date.now() + timeoutMilliseconds;
    while (true) {
        const logOutput = dockerOutput(["logs", containerName], deadline, containerName, marker);
        const readyLine = logOutput.split(/\r?\n/).find(line => line.startsWith(`${marker} `));
        const running = dockerOutput(["inspect", "--format", "{{.State.Running}}", containerName],
            deadline, containerName, marker).trim();
        if (running !== "true") throw new Error(`${containerName} exited before ${marker}.`);
        if (readyLine) {
            process.stdout.write(`${readyLine.slice(marker.length + 1)}\n`);
            return;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`Timed out waiting for ${marker} from ${containerName}.`);
        await delay(Math.min(50, remaining));
    }
};

const [containerName, marker, timeoutText] = process.argv.slice(2);
const timeoutMilliseconds = Number(timeoutText);
if (!containerName || !marker || !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 0) {
    throw new Error("Usage: wait-for-docker-log.js <container> <marker> <timeout-ms>");
}

await waitForDockerLog(containerName, marker, timeoutMilliseconds);
