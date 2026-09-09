import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const deploymentFiles = [
    "deployment/docker-compose.yml",
    "deployment/docker-compose.rollback-readonly.yml",
];
const readRepositoryFile = relativePath => readFile(path.join(root, relativePath), "utf8");
const serviceBlock = (compose, serviceName) => compose.match(new RegExp(
    `^  ${serviceName}:[\\s\\S]*?(?=^  [a-z]|^volumes:)`,
    "m",
))?.[0] || "";

const deployedServices = [
    [ "deployment/docker-compose.yml", [
        "labeling-database",
        "labeling-study-prepare",
        "labeling-server",
        "labeling-caddy",
    ] ],
    [ "deployment/docker-compose.rollback-readonly.yml", [
        "labeling-database",
        "labeling-server",
        "labeling-caddy",
    ] ],
];

test("deployment images are pinned and never use latest", async () => {
    const deployments = await Promise.all(deploymentFiles.map(async file => [ file, await readRepositoryFile(file) ]));

    for (const [file, compose] of deployments) {
        assert.doesNotMatch(compose, /^\s*image:\s*[^\n]*:latest(?:\s*(?:#.*)?)?$/mi, file);
    }
});

test("Node and PostgreSQL runtimes retain pinned, non-root, internally healthy images", async () => {
    const [serverDockerfile, databaseDockerfile] = await Promise.all([
        readRepositoryFile("deployment/server/Dockerfile"),
        readRepositoryFile("deployment/database/Dockerfile"),
    ]);

    assert.match(serverDockerfile, /^FROM node:22\.13\.1-alpine AS build$/m);
    assert.match(serverDockerfile, /^FROM node:22\.13\.1-alpine$/m);
    assert.match(serverDockerfile, /npm prune --omit=dev/);
    assert.match(serverDockerfile, /COPY --from=build build \./);
    assert.match(serverDockerfile, /^USER node$/m);
    assert.match(serverDockerfile, /HEALTHCHECK[\s\S]*http:\/\/localhost:3000\/actuator\/health/);
    assert.match(databaseDockerfile, /^FROM postgres:17\.6-alpine$/m);
    assert.match(databaseDockerfile, /HEALTHCHECK[\s\S]*pg_isready/);
    assert.doesNotMatch(`${serverDockerfile}\n${databaseDockerfile}`, /^FROM .*:latest$/m);
});

test("every Compose runtime has a read-only root filesystem and bounded writable tmpfs", async () => {
    for (const [file, services] of deployedServices) {
        const compose = await readRepositoryFile(file);
        for (const serviceName of services) {
            const block = serviceBlock(compose, serviceName);

            assert.match(block, /^ {4}read_only:\s*true$/m, `${file}: ${serviceName}`);
            assert.match(
                block,
                /^ {4}tmpfs:\n(?:^ {6}- .*$\n)*?^ {6}- \/[^\n]*:rw(?=[^\n]*\bsize=\d+(?:[kmg]i?b)?\b)[^\n]*$/mi,
                `${file}: ${serviceName}`,
            );
        }
    }
});

test("every Compose runtime drops capabilities and has CPU, memory, and process limits", async () => {
    for (const [file, services] of deployedServices) {
        const compose = await readRepositoryFile(file);
        for (const serviceName of services) {
            const block = serviceBlock(compose, serviceName);

            assert.match(block, /^ {4}cap_drop:\n {6}- ALL$/m, `${file}: ${serviceName}`);
            assert.match(block, /^ {4}pids_limit:\s*\d+$/m, `${file}: ${serviceName}`);
            assert.match(block, /^ {4}deploy:[\s\S]*?^ {8}resources:\n[\s\S]*?^ {10}limits:\n[\s\S]*?^ {12}cpus:\s*["']?\d/m, `${file}: ${serviceName}`);
            assert.match(block, /^ {4}deploy:[\s\S]*?^ {8}resources:\n[\s\S]*?^ {10}limits:\n[\s\S]*?^ {12}memory:\s*\d+(?:[kmg]i?b)?$/mi, `${file}: ${serviceName}`);
        }
    }
});

test("Caddy supplies an internal healthcheck without probing the public edge", async () => {
    const deployments = await Promise.all(deploymentFiles.map(async file => [ file, await readRepositoryFile(file) ]));

    for (const [file, compose] of deployments) {
        const caddy = serviceBlock(compose, "labeling-caddy");

        assert.match(caddy, /^ {4}healthcheck:[\s\S]*127\.0\.0\.1/m, file);
        assert.doesNotMatch(caddy, /healthcheck:[\s\S]*(?:PUBLIC_HOSTNAME|labeling-server)/, file);
    }
});
